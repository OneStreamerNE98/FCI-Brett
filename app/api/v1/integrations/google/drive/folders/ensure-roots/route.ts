import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import { GoogleDriveClient } from "../../../../../../../lib/google-drive";
import { googleIntegrationErrorResponse } from "../../../../../../../lib/google-integration-error";
import {
  assertWorkspaceReconcileParentChainInSync,
  assertWorkspaceReconcileRegistryParentChainInSync,
} from "../../../../../../../lib/google-workspace-reconcile";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
} from "../../../../../../../lib/google-oauth-sites";
import { GoogleIntegrationError } from "../../../../../../../lib/google-oauth";
import { flattenWorkspaceRootFolders } from "../../../../../../../lib/workspace-blueprint";
import {
  parseWorkspaceReconcileMissingReview,
  type WorkspaceReconcileMissingReview,
} from "../../../../../../../lib/workspace-reconcile-review";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../../_workspace-data";
import { noStoreJson as response, noStoreResponse } from "../../../../../../../lib/no-store-json";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  let reconcileReview: WorkspaceReconcileMissingReview | null = null;
  if (request.body) {
    const parsed = await parseBoundedJsonObject(request, {
      maximumBytes: 1_000,
      invalidMessage: "Provide an empty JSON object to ensure the Shared Drive root folders.",
      tooLargeMessage: "The Drive root-folder ensure request is too large.",
    });
    if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
    const review = parseWorkspaceReconcileMissingReview(parsed.body);
    if (!review.ok) {
      return response({
        error: "Provide no fields, or only mode reconcile-missing, resourceKey, and expectedVersion when ensuring one reviewed root folder.",
      }, 400);
    }
    reconcileReview = review.review;
  }
  await ensureWorkspaceSchema();

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, blueprintVersion, resources } = setup;
  if (reconcileReview && reconcileReview.expectedVersion !== blueprintVersion) {
    return response({
      error: "The reviewed missing folder is stale. Check Workspace drift again before creating anything.",
      code: "workspace_reconcile_review_stale",
      currentVersion: blueprintVersion,
    }, 409);
  }
  if (!config.connectReady || !config.drive.rootFolderId) {
    return response({ error: "Adopt and verify the Shared Drive before creating its blueprint folders.", code: "shared_drive_not_adopted" }, 409);
  }
  const sharedDrive = resources.find((resource) => resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary");
  if (!sharedDrive) {
    return response({ error: "Adopt the Shared Drive into the app-managed registry before creating its blueprint folders.", code: "shared_drive_not_adopted" }, 409);
  }
  const allRoots = flattenWorkspaceRootFolders(blueprint);
  const roots = reconcileReview
    ? allRoots.filter((root) => root.key === reconcileReview.resourceKey)
    : allRoots;
  if (reconcileReview && roots.length !== 1) {
    return response({
      error: "The reviewed missing folder is no longer in the saved blueprint. Check Workspace drift again.",
      code: "workspace_reconcile_review_stale",
      currentVersion: blueprintVersion,
    }, 409);
  }

  const now = Date.now();
  const lease = await acquireWorkspaceSetupLease(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    action: "drive-roots",
    scopeKey: "drive-roots",
    actor: auth.user.email,
    now,
  });
  if (!lease) return response({ error: "A root-folder setup request is already in progress. Try again shortly.", code: "workspace_setup_lease_conflict" }, 409);

  try {
    const existingByKey = new Map(
      resources
        .filter((resource) => resource.resourceType === "drive.folder")
        .map((resource) => [resource.resourceKey, resource]),
    );
    const ensuredByKey = new Map<string, { id: string }>();
    const drive = config.simulation
      ? null
      : new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
    let latestReviewSetup: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>> | null = null;
    if (reconcileReview) {
      if (config.simulation && existingByKey.has(reconcileReview.resourceKey)) {
        throw new GoogleIntegrationError(
          "workspace_reconcile_review_stale",
          "The reviewed folder already exists in simulation. Check Workspace drift again.",
          409,
        );
      }
      if (drive) {
        const canonical = await drive.findSetupItemsByIdentity("fciRootKey", reconcileReview.resourceKey);
        const legacy = ["client-accounts", "projects"].includes(reconcileReview.resourceKey)
          ? await drive.findSetupItemsByIdentity("fciWorkspaceFolder", reconcileReview.resourceKey)
          : [];
        if (new Set([...canonical, ...legacy].map((item) => item.id)).size > 0) {
          throw new GoogleIntegrationError(
            "workspace_reconcile_review_stale",
            "The reviewed folder identity now exists or moved in Google Drive. Check Workspace drift again before creating anything.",
            409,
          );
        }
      }
      const latest = await getEffectiveGoogleRuntimeSetup();
      latestReviewSetup = latest;
      if (
        latest.blueprintVersion !== reconcileReview.expectedVersion
        || !flattenWorkspaceRootFolders(latest.blueprint).some((root) => root.key === reconcileReview.resourceKey)
        || (
          !existingByKey.has(reconcileReview.resourceKey)
          && latest.resources.some((resource) => (
            resource.resourceType === "drive.folder"
            && resource.resourceKey === reconcileReview.resourceKey
          ))
        )
      ) {
        throw new GoogleIntegrationError(
          "workspace_reconcile_review_stale",
          "The saved blueprint changed after this missing-folder review. Check Workspace drift again.",
          409,
        );
      }
    }
    const results: Array<{
      key: string;
      name: string;
      path: string;
      management: "owner" | "system";
      outcome: "found" | "created" | "adopted";
      id: string;
      url: string;
    }> = [];

    for (const root of roots) {
      let parentId = root.parentKey
        ? (reconcileReview
          ? existingByKey.get(root.parentKey)?.externalId
          : ensuredByKey.get(root.parentKey)?.id)
        : config.drive.rootFolderId;
      if (!parentId) throw new GoogleIntegrationError("drive_parent_missing", `The parent for ${root.path} was not ensured.`, 409);
      const existing = existingByKey.get(root.key);
      const savedProviderName = typeof existing?.metadata.name === "string"
        ? existing.metadata.name.trim()
        : "";
      if (reconcileReview) {
        const latestRootId = latestReviewSetup?.config.drive.rootFolderId;
        if (!latestReviewSetup || !latestRootId) {
          throw new GoogleIntegrationError(
            "workspace_reconcile_review_stale",
            "The Shared Drive changed after this missing-folder review. Check Workspace drift again.",
            409,
          );
        }
        const parentReview = {
          blueprint: latestReviewSetup.blueprint,
          resources: latestReviewSetup.resources,
          rootExternalId: latestRootId,
          parentKey: root.parentKey,
        };
        parentId = drive
          ? await assertWorkspaceReconcileParentChainInSync({ drive, ...parentReview })
          : assertWorkspaceReconcileRegistryParentChainInSync(parentReview);
      }
      const ensured = drive
        ? await drive.ensureBlueprintFolder({ parentId, key: root.key, name: root.name, reuseByName: true })
        : {
          outcome: existing ? "found" as const : "created" as const,
          folder: {
            id: existing?.externalId ?? `workspace-simulation-folder-${root.key}`,
            name: existing ? savedProviderName || root.name : root.name,
            url: `/settings?section=google-workspace&workspace-simulation=folder-${encodeURIComponent(root.key)}`,
            parents: [parentId],
          },
        };
      ensuredByKey.set(root.key, ensured.folder);
      const completedAt = Date.now();
      await upsertWorkspaceResource(env.DB, {
        id: existing?.id ?? crypto.randomUUID(),
        connectionKey: config.connectionKey,
        resourceType: "drive.folder",
        resourceKey: root.key,
        externalId: ensured.folder.id,
        parentExternalId: parentId,
        externalUrl: ensured.folder.url,
        origin: existing?.externalId === ensured.folder.id
          ? existing.origin
          : ensured.outcome === "created" ? "created" : "adopted",
        metadata: { name: ensured.folder.name, path: root.path, management: root.management },
        createdBy: existing?.createdBy ?? auth.user.email,
        createdAt: existing?.createdAt ?? completedAt,
        updatedAt: completedAt,
      });
      results.push({
        key: root.key,
        name: ensured.folder.name,
        path: root.path,
        management: root.management,
        outcome: ensured.outcome,
        id: ensured.folder.id,
        url: ensured.folder.url,
      });
    }

    const counts = results.reduce((summary, item) => {
      summary[item.outcome] += 1;
      return summary;
    }, { found: 0, created: 0, adopted: 0 });
    await writeGoogleIntegrationEvent(
      config,
      "setup.drive_roots_ensured",
      auth.user.email,
      "workspace",
      config.drive.rootFolderId,
      `found=${counts.found};created=${counts.created};adopted=${counts.adopted}`,
    );
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return response({
      ensured: true,
      simulated: config.simulation,
      counts,
      folders: results,
      ...(reconcileReview ? {
        reconciled: true,
        resourceKey: reconcileReview.resourceKey,
        version: blueprintVersion,
      } : {}),
    }, counts.created > 0 ? 201 : 200);
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "drive_roots_ensure_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Shared Drive root folders could not be ensured. Try again."));
  }
}
