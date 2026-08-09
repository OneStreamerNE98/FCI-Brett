import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import {
  GoogleDriveClient,
  PROJECT_FILE_KIND_MIME_TYPES,
} from "../../../../../../../lib/google-drive";
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
import { assertProvisionableWorkspaceBlueprint } from "../../../../../../../lib/workspace-blueprint-provisioning";
import {
  parseWorkspaceReconcileMissingReview,
  type WorkspaceReconcileMissingReview,
} from "../../../../../../../lib/workspace-reconcile-review";
import { renderWorkspaceTemplate } from "../../../../../../../lib/workspace-templates";
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
      invalidMessage: "Provide an empty JSON object to ensure the Workspace templates.",
      tooLargeMessage: "The template ensure request is too large.",
    });
    if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
    const review = parseWorkspaceReconcileMissingReview(parsed.body);
    if (!review.ok) {
      return response({
        error: "Provide no fields, or only mode reconcile-missing, resourceKey, and expectedVersion when ensuring one reviewed template.",
      }, 400);
    }
    reconcileReview = review.review;
  }
  await ensureWorkspaceSchema();

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, blueprintVersion, resources } = setup;
  if (reconcileReview && reconcileReview.expectedVersion !== blueprintVersion) {
    return response({
      error: "The reviewed missing template is stale. Check Workspace drift again before creating anything.",
      code: "workspace_reconcile_review_stale",
      currentVersion: blueprintVersion,
    }, 409);
  }
  if (!config.connectReady || !config.drive.rootFolderId) {
    return response({ error: "Adopt and verify the Shared Drive before ensuring templates.", code: "shared_drive_not_adopted" }, 409);
  }
  const sharedDrive = resources.find((resource) => resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary");
  if (!sharedDrive) {
    return response({ error: "Adopt the Shared Drive into the app-managed registry before ensuring templates.", code: "shared_drive_not_adopted" }, 409);
  }

  const templateFolder = flattenWorkspaceRootFolders(blueprint).find((folder) => folder.key === "templates");
  if (!templateFolder) {
    return response({
      error: "The Workspace blueprint must define the central Templates folder before templates can be ensured.",
      code: "templates_folder_definition_missing",
    }, 409);
  }
  const existingFoldersByKey = new Map(
    resources
      .filter((resource) => resource.resourceType === "drive.folder")
      .map((resource) => [resource.resourceKey, resource]),
  );
  const existingTemplateFolder = existingFoldersByKey.get("templates");
  const selectedTemplates = reconcileReview
    ? blueprint.templates.filter((template) => template.key === reconcileReview.resourceKey)
    : blueprint.templates;
  if (reconcileReview && selectedTemplates.length !== 1) {
    return response({
      error: "The reviewed missing template is no longer in the saved blueprint. Check Workspace drift again.",
      code: "workspace_reconcile_review_stale",
      currentVersion: blueprintVersion,
    }, 409);
  }
  if (reconcileReview && !existingTemplateFolder) {
    return response({
      error: "Create the blueprint Templates folder before creating this reviewed template.",
      code: "templates_folder_missing",
    }, 409);
  }
  const parent = templateFolder.parentKey
    ? existingFoldersByKey.get(templateFolder.parentKey)
    : sharedDrive;
  if (!parent) {
    return response({
      error: `Ensure the Shared Drive root folders before templates. Missing parent folder: ${templateFolder.parentKey}.`,
      code: "templates_parent_folder_missing",
    }, 409);
  }

  // This route creates a root-tree folder by blueprint name (`reuseByName` below), so it
  // fails closed on a duplicate sibling name before the lease, the token exchange, and
  // every provider mutation — the same preflight ensure-roots and project provisioning use.
  try {
    assertProvisionableWorkspaceBlueprint(blueprint);
  } catch (error) {
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Workspace templates could not be ensured. Try again."));
  }

  const lease = await acquireWorkspaceSetupLease(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    action: "templates",
    scopeKey: "templates",
    actor: auth.user.email,
    now: Date.now(),
    connectionFence: googleConnectionLeaseFence(config),
  });
  if (!lease) return response({ error: "A template setup request is already in progress. Try again shortly.", code: "workspace_setup_lease_conflict" }, 409);

  try {
    const existingTemplatesByKey = new Map(
      resources
        .filter((resource) => resource.resourceType === "drive.file")
        .map((resource) => [resource.resourceKey, resource]),
    );
    const drive = config.simulation
      ? null
      : new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
    let latestReviewSetup: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>> | null = null;
    if (reconcileReview) {
      if (config.simulation && existingTemplatesByKey.has(reconcileReview.resourceKey)) {
        throw new GoogleIntegrationError(
          "workspace_reconcile_review_stale",
          "The reviewed template already exists in simulation. Check Workspace drift again.",
          409,
        );
      }
      if (drive) {
        const matches = await drive.findSetupItemsByIdentity("fciTemplateKey", reconcileReview.resourceKey);
        if (matches.length > 0) {
          throw new GoogleIntegrationError(
            "workspace_reconcile_review_stale",
            "The reviewed template identity now exists or moved in Google Drive. Check Workspace drift again before creating anything.",
            409,
          );
        }
      }
      const latest = await getEffectiveGoogleRuntimeSetup();
      latestReviewSetup = latest;
      if (
        latest.blueprintVersion !== reconcileReview.expectedVersion
        || !latest.blueprint.templates.some((template) => template.key === reconcileReview.resourceKey)
        || (
          !existingTemplatesByKey.has(reconcileReview.resourceKey)
          && latest.resources.some((resource) => (
            resource.resourceType === "drive.file"
            && resource.resourceKey === reconcileReview.resourceKey
          ))
        )
      ) {
        throw new GoogleIntegrationError(
          "workspace_reconcile_review_stale",
          "The saved blueprint changed after this missing-template review. Check Workspace drift again.",
          409,
        );
      }
    }
    const savedTemplateFolderName = typeof existingTemplateFolder?.metadata.name === "string"
      ? existingTemplateFolder.metadata.name.trim()
      : "";
    const ensuredFolder = reconcileReview
      ? {
        outcome: "found" as const,
        folder: {
          id: existingTemplateFolder!.externalId,
          name: savedTemplateFolderName || templateFolder.name,
          url: existingTemplateFolder!.externalUrl
            ?? "/settings?section=google-workspace&workspace-simulation=folder-templates",
          parents: [parent.externalId],
        },
      }
      : drive
        ? await drive.ensureBlueprintFolder({
        parentId: parent.externalId,
        key: "templates",
        name: templateFolder.name,
        reuseByName: true,
        appProperties: { fciFolderKind: "templates" },
      })
        : {
          outcome: existingTemplateFolder ? "found" as const : "created" as const,
          folder: {
            id: existingTemplateFolder?.externalId ?? "workspace-simulation-folder-templates",
            name: existingTemplateFolder
              ? savedTemplateFolderName || templateFolder.name
              : templateFolder.name,
            url: existingTemplateFolder?.externalUrl ?? "/settings?section=google-workspace&workspace-simulation=folder-templates",
            parents: [parent.externalId],
          },
        };
    if (!reconcileReview) {
      const folderCompletedAt = Date.now();
      const folderOrigin = existingTemplateFolder?.externalId === ensuredFolder.folder.id
        ? existingTemplateFolder.origin
        : ensuredFolder.outcome === "created"
          ? "created"
          : "adopted";
      await upsertWorkspaceResource(env.DB, {
        id: existingTemplateFolder?.id ?? crypto.randomUUID(),
        connectionKey: config.connectionKey,
        resourceType: "drive.folder",
        resourceKey: "templates",
        externalId: ensuredFolder.folder.id,
        parentExternalId: parent.externalId,
        externalUrl: ensuredFolder.folder.url,
        origin: folderOrigin,
        metadata: {
          name: ensuredFolder.folder.name,
          path: templateFolder.path,
          management: templateFolder.management,
          folderKind: "templates",
        },
        createdBy: existingTemplateFolder?.createdBy ?? auth.user.email,
        createdAt: existingTemplateFolder?.createdAt ?? folderCompletedAt,
        updatedAt: folderCompletedAt,
      });
    }

    const results: Array<{
      key: string;
      name: string;
      kind: "doc" | "sheet" | "slides";
      management: "owner";
      targetFolderKey: string;
      outcome: "found" | "created" | "adopted";
      id: string;
      url: string;
    }> = [];
    for (const template of selectedTemplates) {
      const expectedMimeType = PROJECT_FILE_KIND_MIME_TYPES[template.kind];
      const rendered = template.kind === "slides"
        ? null
        : renderWorkspaceTemplate(template, blueprint.business.displayName);
      const existing = existingTemplatesByKey.get(template.key);
      const savedProviderName = typeof existing?.metadata.name === "string"
        ? existing.metadata.name.trim()
        : "";
      let targetFolderId = ensuredFolder.folder.id;
      if (reconcileReview) {
        const latestRootId = latestReviewSetup?.config.drive.rootFolderId;
        if (!latestReviewSetup || !latestRootId) {
          throw new GoogleIntegrationError(
            "workspace_reconcile_review_stale",
            "The Shared Drive changed after this missing-template review. Check Workspace drift again.",
            409,
          );
        }
        const parentReview = {
          blueprint: latestReviewSetup.blueprint,
          resources: latestReviewSetup.resources,
          rootExternalId: latestRootId,
          parentKey: "templates",
        };
        targetFolderId = drive
          ? await assertWorkspaceReconcileParentChainInSync({ drive, ...parentReview })
          : assertWorkspaceReconcileRegistryParentChainInSync(parentReview);
      }
      const ensured = drive
        ? template.kind === "slides"
          ? await drive.findOrCreateManagedNativeFile({
            parentId: targetFolderId,
            name: template.name,
            mimeType: expectedMimeType,
            appProperties: { fciTemplateKey: template.key },
          })
          : await drive.findOrUploadManagedFile({
            parentId: targetFolderId,
            name: template.name,
            mimeType: rendered!.metadataMimeType,
            mediaMimeType: rendered!.mediaMimeType,
            bytes: rendered!.bytes,
            appProperties: { fciTemplateKey: template.key },
          })
        : {
          created: !existing,
          file: {
            id: existing?.externalId ?? `workspace-simulation-template-${template.key}`,
            name: existing ? savedProviderName || template.name : template.name,
            mimeType: expectedMimeType,
            parents: [targetFolderId],
            url: existing?.externalUrl ?? `/settings?section=google-workspace&workspace-simulation=template-${encodeURIComponent(template.key)}`,
            appProperties: { fciTemplateKey: template.key },
            checksum: null,
            size: rendered?.bytes.byteLength ?? null,
          },
        };
      if (ensured.file.mimeType !== expectedMimeType) {
        throw new GoogleIntegrationError(
          "invalid_blueprint_template",
          `The blueprint identity ${template.key} belongs to a file with the wrong Google template type.`,
          409,
        );
      }
      const outcome = ensured.created
        ? "created" as const
        : existing?.externalId === ensured.file.id
          ? "found" as const
          : "adopted" as const;
      const completedAt = Date.now();
      await upsertWorkspaceResource(env.DB, {
        id: existing?.id ?? crypto.randomUUID(),
        connectionKey: config.connectionKey,
        resourceType: "drive.file",
        resourceKey: template.key,
        externalId: ensured.file.id,
        parentExternalId: targetFolderId,
        externalUrl: ensured.file.url,
        origin: outcome === "created" ? "created" : outcome === "adopted" ? "adopted" : existing?.origin ?? "adopted",
        metadata: {
          name: ensured.file.name,
          kind: template.kind,
          management: template.management,
          targetFolderKey: template.targetFolderKey,
          sourceFolderKey: "templates",
          metadataMimeType: expectedMimeType,
          ...(rendered ? { mediaMimeType: rendered.mediaMimeType } : {}),
        },
        createdBy: existing?.createdBy ?? auth.user.email,
        createdAt: existing?.createdAt ?? completedAt,
        updatedAt: completedAt,
      });
      results.push({
        key: template.key,
        name: ensured.file.name,
        kind: template.kind,
        management: template.management,
        targetFolderKey: template.targetFolderKey,
        outcome,
        id: ensured.file.id,
        url: ensured.file.url,
      });
    }

    const counts = results.reduce((summary, item) => {
      summary[item.outcome] += 1;
      return summary;
    }, { found: 0, created: 0, adopted: 0 });
    await writeGoogleIntegrationEvent(
      config,
      "setup.templates_ensured",
      auth.user.email,
      "workspace",
      config.drive.rootFolderId,
      `folder=${ensuredFolder.outcome};found=${counts.found};created=${counts.created};adopted=${counts.adopted};outcomes=${results.map((item) => `${item.key}:${item.outcome}`).join(",")}`,
    );
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    const created = ensuredFolder.outcome === "created" || counts.created > 0;
    return response({
      ensured: true,
      simulated: config.simulation,
      folder: {
        key: "templates",
        name: ensuredFolder.folder.name,
        outcome: ensuredFolder.outcome,
        id: ensuredFolder.folder.id,
        url: ensuredFolder.folder.url,
      },
      counts,
      templates: results,
      ...(reconcileReview ? {
        reconciled: true,
        resourceKey: reconcileReview.resourceKey,
        version: blueprintVersion,
      } : {}),
    }, created ? 201 : 200);
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "templates_ensure_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Workspace templates could not be ensured. Try again."));
  }
}
