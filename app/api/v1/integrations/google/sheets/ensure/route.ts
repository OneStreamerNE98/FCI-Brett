import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} from "../../../../../../adapters/d1/workspace-setup-leases";
import { upsertWorkspaceResource } from "../../../../../../adapters/d1/workspace-resources";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import { GoogleDriveClient } from "../../../../../../lib/google-drive";
import { googleIntegrationErrorResponse } from "../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  getGoogleConnectionStatus,
  writeGoogleIntegrationEvent,
} from "../../../../../../lib/google-oauth-sites";
import { GoogleIntegrationError } from "../../../../../../lib/google-oauth";
import {
  GoogleSheetsClient,
  prepareGoogleDirectorySpreadsheet,
  prepareGoogleImportSpreadsheet,
} from "../../../../../../lib/google-sheets";
import {
  parseWorkspaceReconcileMissingReview,
  type WorkspaceReconcileMissingReview,
} from "../../../../../../lib/workspace-reconcile-review";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { noStoreJson as response, noStoreResponse } from "../../../../../../lib/no-store-json";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  let reconcileReview: WorkspaceReconcileMissingReview | null = null;
  if (request.body) {
    const parsed = await parseBoundedJsonObject(request, {
      maximumBytes: 1_000,
      invalidMessage: "Provide an empty JSON object to ensure the Workspace spreadsheets.",
      tooLargeMessage: "The spreadsheet ensure request is too large.",
    });
    if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
    const review = parseWorkspaceReconcileMissingReview(parsed.body);
    if (!review.ok) {
      return response({
        error: "Provide no fields, or only mode reconcile-missing, resourceKey, and expectedVersion when ensuring one reviewed spreadsheet.",
      }, 400);
    }
    reconcileReview = review.review;
  }
  await ensureWorkspaceSchema();

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, blueprintVersion, resources } = setup;
  if (reconcileReview && reconcileReview.expectedVersion !== blueprintVersion) {
    return response({
      error: "The reviewed missing spreadsheet is stale. Check Workspace drift again before creating anything.",
      code: "workspace_reconcile_review_stale",
      currentVersion: blueprintVersion,
    }, 409);
  }
  if (!config.connectReady || !config.drive.rootFolderId) {
    return response({ error: "Adopt and verify the Shared Drive before ensuring spreadsheets.", code: "shared_drive_not_adopted" }, 409);
  }
  const sharedDrive = resources.find((resource) => resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary");
  if (!sharedDrive) {
    return response({ error: "Adopt the Shared Drive into the app-managed registry before ensuring spreadsheets.", code: "shared_drive_not_adopted" }, 409);
  }

  const foldersByKey = new Map(
    resources
      .filter((resource) => resource.resourceType === "drive.folder")
      .map((resource) => [resource.resourceKey, resource]),
  );
  const selectedSpreadsheets = reconcileReview
    ? blueprint.spreadsheets.filter((spreadsheet) => spreadsheet.key === reconcileReview.resourceKey)
    : blueprint.spreadsheets;
  if (reconcileReview && selectedSpreadsheets.length !== 1) {
    return response({
      error: "The reviewed missing spreadsheet is no longer in the saved blueprint. Check Workspace drift again.",
      code: "workspace_reconcile_review_stale",
      currentVersion: blueprintVersion,
    }, 409);
  }
  const missingTargets = selectedSpreadsheets
    .filter((spreadsheet) => !foldersByKey.has(spreadsheet.targetFolderKey))
    .map((spreadsheet) => spreadsheet.targetFolderKey);
  if (missingTargets.length) {
    return response({
      error: `Ensure the Shared Drive root folders before spreadsheets. Missing target folder${missingTargets.length === 1 ? "" : "s"}: ${[...new Set(missingTargets)].join(", ")}.`,
      code: "spreadsheet_target_folder_missing",
    }, 409);
  }

  let providerToken: string | null = null;
  try {
    if (!config.simulation) {
      const connection = await getGoogleConnectionStatus(config);
      if (!connection.services.drive || !connection.services.sheets) {
        return response({ error: "Reconnect Google and approve both Drive and Sheets before ensuring spreadsheets.", code: "spreadsheet_permissions_missing" }, 409);
      }
      // One connected OAuth access token carries the approved Drive and Sheets
      // scopes; avoid refreshing it separately for each client.
      providerToken = await getGoogleAccessToken(config, "drive");
    }
  } catch (error) {
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Workspace spreadsheets could not be ensured. Try again."));
  }

  const lease = await acquireWorkspaceSetupLease(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    action: "spreadsheets",
    scopeKey: "spreadsheets",
    actor: auth.user.email,
    now: Date.now(),
  });
  if (!lease) return response({ error: "A spreadsheet setup request is already in progress. Try again shortly.", code: "workspace_setup_lease_conflict" }, 409);

  try {
    const existingByKey = new Map(
      resources
        .filter((resource) => resource.resourceType === "sheets.spreadsheet")
        .map((resource) => [resource.resourceKey, resource]),
    );
    const drive = providerToken ? new GoogleDriveClient(providerToken, config) : null;
    if (reconcileReview) {
      if (config.simulation && existingByKey.has(reconcileReview.resourceKey)) {
        throw new GoogleIntegrationError(
          "workspace_reconcile_review_stale",
          "The reviewed spreadsheet already exists in simulation. Check Workspace drift again.",
          409,
        );
      }
      if (drive) {
        const matches = await drive.findSetupItemsByIdentity("fciResourceKind", reconcileReview.resourceKey);
        if (matches.length > 0) {
          throw new GoogleIntegrationError(
            "workspace_reconcile_review_stale",
            "The reviewed spreadsheet identity now exists or moved in Google Drive. Check Workspace drift again before creating anything.",
            409,
          );
        }
      }
      const latest = await getEffectiveGoogleRuntimeSetup();
      if (
        latest.blueprintVersion !== reconcileReview.expectedVersion
        || !latest.blueprint.spreadsheets.some((spreadsheet) => spreadsheet.key === reconcileReview.resourceKey)
        || (
          !existingByKey.has(reconcileReview.resourceKey)
          && latest.resources.some((resource) => (
            resource.resourceType === "sheets.spreadsheet"
            && resource.resourceKey === reconcileReview.resourceKey
          ))
        )
      ) {
        throw new GoogleIntegrationError(
          "workspace_reconcile_review_stale",
          "The saved blueprint changed after this missing-spreadsheet review. Check Workspace drift again.",
          409,
        );
      }
    }
    const results: Array<{
      key: string;
      name: string;
      role: "system-mirror" | "import" | "reference";
      management: "owner" | "system";
      targetFolderKey: string;
      outcome: "found" | "created" | "adopted";
      id: string;
      url: string;
    }> = [];

    for (const spreadsheet of selectedSpreadsheets) {
      const target = foldersByKey.get(spreadsheet.targetFolderKey)!;
      const existing = existingByKey.get(spreadsheet.key);
      const savedProviderName = typeof existing?.metadata.name === "string"
        ? existing.metadata.name.trim()
        : "";
      const ensured = drive
        ? await drive.ensureBlueprintSpreadsheet({ parentId: target.externalId, key: spreadsheet.key, name: spreadsheet.name })
        : {
          created: !existing,
          file: {
            id: existing?.externalId ?? (spreadsheet.key === "client-directory"
              ? "workspace-simulation-directory-sheet"
              : `workspace-simulation-spreadsheet-${spreadsheet.key}`),
            name: existing ? savedProviderName || spreadsheet.name : spreadsheet.name,
            mimeType: "application/vnd.google-apps.spreadsheet",
            parents: [target.externalId],
            url: existing?.externalUrl ?? `/settings?section=google-workspace&workspace-simulation=spreadsheet-${encodeURIComponent(spreadsheet.key)}`,
            appProperties: { fciResourceKind: spreadsheet.key },
            checksum: null,
            size: null,
          },
        };
      const outcome = ensured.created
        ? "created" as const
        : existing?.externalId === ensured.file.id
          ? "found" as const
          : "adopted" as const;

      if (providerToken && spreadsheet.role !== "reference") {
        const sheets = new GoogleSheetsClient(providerToken, ensured.file.id);
        if (spreadsheet.role === "system-mirror") await prepareGoogleDirectorySpreadsheet(sheets);
        else await prepareGoogleImportSpreadsheet(sheets);
      }

      const completedAt = Date.now();
      await upsertWorkspaceResource(env.DB, {
        id: existing?.id ?? crypto.randomUUID(),
        connectionKey: config.connectionKey,
        resourceType: "sheets.spreadsheet",
        resourceKey: spreadsheet.key,
        externalId: ensured.file.id,
        parentExternalId: ensured.file.parents[0] ?? target.externalId,
        externalUrl: ensured.file.url,
        origin: outcome === "created" ? "created" : outcome === "adopted" ? "adopted" : existing?.origin ?? "adopted",
        metadata: {
          name: ensured.file.name,
          management: spreadsheet.management,
          role: spreadsheet.role,
          targetFolderKey: spreadsheet.targetFolderKey,
        },
        createdBy: existing?.createdBy ?? auth.user.email,
        createdAt: existing?.createdAt ?? completedAt,
        updatedAt: completedAt,
      });
      results.push({
        key: spreadsheet.key,
        name: ensured.file.name,
        role: spreadsheet.role,
        management: spreadsheet.management,
        targetFolderKey: spreadsheet.targetFolderKey,
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
      "setup.spreadsheets_ensured",
      auth.user.email,
      "workspace",
      config.drive.rootFolderId,
      `found=${counts.found};created=${counts.created};adopted=${counts.adopted};outcomes=${results.map((item) => `${item.key}:${item.outcome}`).join(",")}`,
    );
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return response({
      ensured: true,
      simulated: config.simulation,
      counts,
      spreadsheets: results,
      ...(reconcileReview ? {
        reconciled: true,
        resourceKey: reconcileReview.resourceKey,
        version: blueprintVersion,
      } : {}),
    }, counts.created > 0 ? 201 : 200);
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "spreadsheets_ensure_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Workspace spreadsheets could not be ensured. Try again."));
  }
}
