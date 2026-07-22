import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import { GoogleDriveClient } from "../../../../../../../lib/google-drive";
import { mapGoogleIntegrationError } from "../../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
} from "../../../../../../../lib/google-oauth-sites";
import { GoogleIntegrationError } from "../../../../../../../lib/google-oauth";
import { flattenWorkspaceRootFolders } from "../../../../../../../lib/workspace-blueprint";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../../_workspace-data";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const mapped = mapGoogleIntegrationError(error, "The Shared Drive root folders could not be ensured. Try again.");
  return response(mapped.body, mapped.status);
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  if (request.body) {
    const parsed = await parseBoundedJsonObject(request, {
      maximumBytes: 1_000,
      invalidMessage: "Provide an empty JSON object to ensure the Shared Drive root folders.",
      tooLargeMessage: "The Drive root-folder ensure request is too large.",
    });
    if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
    if (Object.keys(parsed.body).length > 0) return response({ error: "Provide no fields when ensuring the Shared Drive root folders." }, 400);
  }

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, resources } = setup;
  if (!config.connectReady || !config.drive.rootFolderId) {
    return response({ error: "Adopt and verify the Shared Drive before creating its blueprint folders.", code: "shared_drive_not_adopted" }, 409);
  }
  const sharedDrive = resources.find((resource) => resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary");
  if (!sharedDrive) {
    return response({ error: "Adopt the Shared Drive into the app-managed registry before creating its blueprint folders.", code: "shared_drive_not_adopted" }, 409);
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
    const roots = flattenWorkspaceRootFolders(blueprint);
    const existingByKey = new Map(
      resources
        .filter((resource) => resource.resourceType === "drive.folder")
        .map((resource) => [resource.resourceKey, resource]),
    );
    const ensuredByKey = new Map<string, { id: string }>();
    const drive = config.simulation
      ? null
      : new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
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
      const parentId = root.parentKey
        ? ensuredByKey.get(root.parentKey)?.id
        : config.drive.rootFolderId;
      if (!parentId) throw new GoogleIntegrationError("drive_parent_missing", `The parent for ${root.path} was not ensured.`, 409);
      const existing = existingByKey.get(root.key);
      const ensured = drive
        ? await drive.ensureBlueprintFolder({ parentId, key: root.key, name: root.name, reuseByName: true })
        : {
          outcome: existing ? "found" as const : "created" as const,
          folder: {
            id: existing?.externalId ?? `workspace-simulation-folder-${root.key}`,
            name: root.name,
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
    return response({ ensured: true, simulated: config.simulation, counts, folders: results }, counts.created > 0 ? 201 : 200);
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "drive_roots_ensure_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return errorResponse(error);
  }
}
