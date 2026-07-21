import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import { saveWorkspaceBlueprint } from "../../../../../../../adapters/d1/workspace-blueprints";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import { GoogleDriveClient } from "../../../../../../../lib/google-drive";
import { mapGoogleIntegrationError } from "../../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
} from "../../../../../../../lib/google-oauth-sites";
import { GoogleIntegrationError } from "../../../../../../../lib/google-oauth";
import {
  flattenWorkspaceRootFolders,
  renameWorkspaceRootFolder,
  WorkspaceBlueprintValidationError,
} from "../../../../../../../lib/workspace-blueprint";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../../_workspace-data";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const mapped = mapGoogleIntegrationError(error, "The managed Drive folder could not be renamed. Try again.");
  return response(mapped.body, mapped.status);
}

async function compensateDriveName(
  drive: GoogleDriveClient,
  externalId: string,
  previousName: string,
  config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["config"],
  actor: string,
) {
  try {
    await drive.renameFolder(externalId, previousName);
    return true;
  } catch {
    await writeGoogleIntegrationEvent(
      config,
      "setup.folder_rename_compensation_failed",
      actor,
      "drive.folder",
      externalId,
      "The blueprint save failed and the prior Drive name could not be restored; run reconciliation before retrying.",
    );
    return false;
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: 8_000,
    invalidMessage: "Provide a blueprint folder key and name as valid JSON.",
    tooLargeMessage: "The Drive folder rename request is too large.",
  });
  if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
  const bodyKeys = Object.keys(parsed.body);
  if (bodyKeys.length !== 2 || !bodyKeys.includes("key") || !bodyKeys.includes("name")) {
    return response({ error: "Provide only key and name." }, 400);
  }
  if (typeof parsed.body.key !== "string" || typeof parsed.body.name !== "string") {
    return response({ error: "Provide a valid blueprint folder key and name." }, 400);
  }

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, resources, blueprint, blueprintVersion } = setup;
  const key = parsed.body.key.trim();
  let updatedBlueprint;
  try {
    updatedBlueprint = renameWorkspaceRootFolder(blueprint, key, parsed.body.name);
  } catch (error) {
    if (error instanceof WorkspaceBlueprintValidationError) {
      return response({ error: error.message, path: error.path }, 400);
    }
    throw error;
  }
  const current = flattenWorkspaceRootFolders(blueprint).find((folder) => folder.key === key)!;
  const renamedNode = flattenWorkspaceRootFolders(updatedBlueprint).find((folder) => folder.key === key)!;
  if (renamedNode.name === current.name) return response({ error: "Choose a different folder name." }, 400);

  const registered = resources.find((resource) => resource.resourceType === "drive.folder" && resource.resourceKey === key);
  if (!registered || !config.drive.rootFolderId) {
    return response({ error: "Ensure the Shared Drive root folders before renaming this blueprint folder.", code: "drive_folder_not_registered" }, 409);
  }
  const now = Date.now();
  const lease = await acquireWorkspaceSetupLease(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    action: `folder-rename:${key}`,
    scopeKey: key,
    actor: auth.user.email,
    now,
  });
  if (!lease) return response({ error: "A rename request is already in progress for this folder. Try again shortly.", code: "workspace_setup_lease_conflict" }, 409);

  let drive: GoogleDriveClient | null = null;
  let driveRenamed = false;
  let providerPreviousName = current.name;
  try {
    if (!config.simulation) {
      drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
      const providerRename = await drive.renameFolder(registered.externalId, renamedNode.name);
      providerPreviousName = providerRename.previousName;
      driveRenamed = true;
    }

    let saved;
    try {
      saved = await saveWorkspaceBlueprint(env.DB, {
        id: crypto.randomUUID(),
        connectionKey: config.connectionKey,
        expectedVersion: blueprintVersion,
        blueprint: updatedBlueprint,
        actor: auth.user.email,
        now: Date.now(),
        auditEvent: {
          id: crypto.randomUUID(),
          eventType: "setup.folder_renamed",
          entityType: "drive.folder",
          entityId: registered.externalId,
          detail: `key=${key};from=${current.name};to=${renamedNode.name}`,
        },
      });
    } catch (error) {
      if (drive && driveRenamed) {
        const compensated = await compensateDriveName(drive, registered.externalId, providerPreviousName, config, auth.user.email);
        if (!compensated) {
          throw new GoogleIntegrationError("drive_rename_compensation_failed", "Drive was renamed but the blueprint could not be saved or restored. Run reconciliation before retrying.", 503);
        }
      }
      throw error;
    }
    if (!saved.saved) {
      if (drive && driveRenamed) {
        const compensated = await compensateDriveName(drive, registered.externalId, providerPreviousName, config, auth.user.email);
        if (!compensated) {
          throw new GoogleIntegrationError("drive_rename_compensation_failed", "Drive was renamed but the blueprint conflict could not be restored. Run reconciliation before retrying.", 503);
        }
      }
      await failWorkspaceSetupLease(env.DB, lease, "workspace_blueprint_version_conflict", Date.now());
      return response({
        error: "The Workspace blueprint changed before the folder rename could be committed. Load the latest blueprint and try again.",
        code: "workspace_blueprint_version_conflict",
        currentVersion: saved.currentVersion,
      }, 409);
    }

    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return response({
      renamed: true,
      simulated: config.simulation,
      key,
      previousName: current.name,
      folder: { id: registered.externalId, name: renamedNode.name, url: registered.externalUrl },
      blueprint: saved.record.blueprint,
      version: saved.record.version,
    });
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "drive_folder_rename_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return errorResponse(error);
  }
}
