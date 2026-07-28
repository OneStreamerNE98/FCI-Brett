import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import { saveWorkspaceBlueprint } from "../../../../../../../adapters/d1/workspace-blueprints";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import {
  type DriveSetupItem,
  GoogleDriveClient,
} from "../../../../../../../lib/google-drive";
import { googleIntegrationErrorResponse } from "../../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
} from "../../../../../../../lib/google-oauth-sites";
import { workspaceReconcileDriveIdentities } from "../../../../../../../lib/google-workspace-reconcile";
import { GoogleIntegrationError } from "../../../../../../../lib/google-oauth";
import {
  flattenWorkspaceRootFolders,
  renameWorkspaceRootFolder,
  WorkspaceBlueprintValidationError,
} from "../../../../../../../lib/workspace-blueprint";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../../_workspace-data";
import { noStoreJson as response, noStoreResponse } from "../../../../../../../lib/no-store-json";

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

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
    try {
      await writeGoogleIntegrationEvent(
        config,
        "setup.folder_rename_compensation_failed",
        actor,
        "drive.folder",
        externalId,
        "The blueprint save failed and the prior Drive name could not be restored; run reconciliation before retrying.",
      );
    } catch {
      // The provider restoration result is the primary signal. An unavailable
      // audit store must not hide that compensation also failed.
    }
    return false;
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: 8_000,
    invalidMessage: "Provide a blueprint folder key and rename action as valid JSON.",
    tooLargeMessage: "The Drive folder rename request is too large.",
  });
  if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
  const bodyKeys = Object.keys(parsed.body);
  const ordinaryRename = bodyKeys.length === 2 && bodyKeys.includes("key") && bodyKeys.includes("name");
  const reconcileDriveName = bodyKeys.length === 5
    && bodyKeys.includes("key")
    && bodyKeys.includes("mode")
    && bodyKeys.includes("expectedVersion")
    && bodyKeys.includes("externalId")
    && bodyKeys.includes("actualName")
    && parsed.body.mode === "reconcile-drive-name";
  if (!ordinaryRename && !reconcileDriveName) {
    return response({ error: "Provide only key and name, or key, mode reconcile-drive-name, expectedVersion, externalId, and actualName." }, 400);
  }
  if (
    typeof parsed.body.key !== "string"
    || (ordinaryRename && typeof parsed.body.name !== "string")
    || (
      reconcileDriveName
      && (
        typeof parsed.body.expectedVersion !== "number"
        || !Number.isSafeInteger(parsed.body.expectedVersion)
        || parsed.body.expectedVersion < 0
        || typeof parsed.body.externalId !== "string"
        || !parsed.body.externalId.trim()
        || parsed.body.externalId.trim().length > 200
        || typeof parsed.body.actualName !== "string"
        || !parsed.body.actualName.trim()
        || parsed.body.actualName.trim().length > 500
        || /[\u0000-\u001f\u007f]/.test(parsed.body.actualName)
      )
    )
  ) {
    return response({ error: "Provide a valid blueprint folder key and rename action." }, 400);
  }
  await ensureWorkspaceSchema();

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, resources, blueprint, blueprintVersion } = setup;
  const key = parsed.body.key.trim();
  if (reconcileDriveName && Number(parsed.body.expectedVersion) !== blueprintVersion) {
    return response({
      error: "The Workspace blueprint changed after this drift review. Check for drift again before renaming in Drive.",
      code: "workspace_blueprint_version_conflict",
      currentVersion: blueprintVersion,
    }, 409);
  }
  const current = flattenWorkspaceRootFolders(blueprint).find((folder) => folder.key === key);
  if (!current) {
    return response({ error: "Choose a folder key that exists in the current Workspace blueprint." }, 400);
  }
  let updatedBlueprint = blueprint;
  let renamedNode = current;
  if (ordinaryRename) {
    try {
      updatedBlueprint = renameWorkspaceRootFolder(blueprint, key, parsed.body.name as string);
    } catch (error) {
      if (error instanceof WorkspaceBlueprintValidationError) {
        return response({ error: error.message, path: error.path }, 400);
      }
      throw error;
    }
    renamedNode = flattenWorkspaceRootFolders(updatedBlueprint).find((folder) => folder.key === key)!;
    if (renamedNode.name === current.name) return response({ error: "Choose a different folder name." }, 400);
  }

  const registered = resources.find((resource) => resource.resourceType === "drive.folder" && resource.resourceKey === key);
  const reviewedExternalId = reconcileDriveName ? (parsed.body.externalId as string).trim() : null;
  const reviewedActualName = reconcileDriveName ? (parsed.body.actualName as string).trim() : null;
  if (
    !config.drive.rootFolderId
    || (ordinaryRename && !registered)
    || (
      reconcileDriveName
      && config.simulation
      && (!registered || registered.externalId !== reviewedExternalId)
    )
  ) {
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
  let simulationRenamed = false;
  const targetExternalId = reviewedExternalId ?? registered!.externalId;
  let targetExternalUrl = registered?.externalUrl ?? null;
  let providerPreviousName = reviewedActualName
    ?? (typeof registered?.metadata.name === "string" && registered.metadata.name.trim()
    ? registered.metadata.name.trim()
    : current.name);
  const writeSimulationMetadata = async (metadata: Readonly<Record<string, unknown>>) => {
    if (!registered) {
      throw new GoogleIntegrationError(
        "drive_folder_not_registered",
        "The simulated folder is not registered. Check for drift again before renaming.",
        409,
      );
    }
    await upsertWorkspaceResource(env.DB, {
      id: registered.id,
      connectionKey: registered.connectionKey,
      resourceType: registered.resourceType,
      resourceKey: registered.resourceKey,
      externalId: registered.externalId,
      parentExternalId: registered.parentExternalId,
      externalUrl: registered.externalUrl,
      origin: registered.origin,
      metadata,
      createdBy: registered.createdBy,
      createdAt: registered.createdAt,
      updatedAt: Date.now(),
    });
  };
  try {
    if (ordinaryRename && !config.simulation) {
      drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
      const providerRename = await drive.renameFolder(registered!.externalId, renamedNode.name);
      providerPreviousName = providerRename.previousName;
      driveRenamed = true;
    }

    if (ordinaryRename) {
      const ordinaryRegistered = registered!;
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
            entityId: ordinaryRegistered.externalId,
            detail: `key=${key};from=${current.name};to=${renamedNode.name}`,
          },
        });
      } catch (error) {
        if (drive && driveRenamed) {
          const compensated = await compensateDriveName(drive, ordinaryRegistered.externalId, providerPreviousName, config, auth.user.email);
          if (!compensated) {
            throw new GoogleIntegrationError("drive_rename_compensation_failed", "Drive was renamed but the blueprint could not be saved or restored. Run reconciliation before retrying.", 503);
          }
        }
        throw error;
      }
      if (!saved.saved) {
        if (drive && driveRenamed) {
          const compensated = await compensateDriveName(drive, ordinaryRegistered.externalId, providerPreviousName, config, auth.user.email);
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

      if (config.simulation) {
        await writeSimulationMetadata({
            ...ordinaryRegistered.metadata,
            name: renamedNode.name,
            path: renamedNode.path,
            management: renamedNode.management,
        });
      }
      await completeWorkspaceSetupLease(env.DB, lease, Date.now());
      return response({
        renamed: true,
        simulated: config.simulation,
        key,
        previousName: current.name,
        folder: { id: ordinaryRegistered.externalId, name: renamedNode.name, url: ordinaryRegistered.externalUrl },
        blueprint: saved.record.blueprint,
        version: saved.record.version,
      });
    }

    const assertReviewedBlueprintCurrent = async () => {
      const latest = await getEffectiveGoogleRuntimeSetup();
      const latestFolder = flattenWorkspaceRootFolders(latest.blueprint)
        .find((folder) => folder.key === key);
      if (
        latest.blueprintVersion !== blueprintVersion
        || !latestFolder
        || latestFolder.name !== renamedNode.name
      ) {
        throw new GoogleIntegrationError(
          "workspace_blueprint_version_conflict",
          "The Workspace blueprint changed after this drift review. Check for drift again before renaming in Drive.",
          409,
        );
      }
    };
    await assertReviewedBlueprintCurrent();

    if (!config.simulation) {
      drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
      const staleReview = () => new GoogleIntegrationError(
        "workspace_reconcile_review_stale",
        "The reviewed Drive folder changed after the drift check. Check for drift again before renaming.",
        409,
      );
      const foldersByKey = new Map(
        flattenWorkspaceRootFolders(blueprint).map((folder) => [folder.key, folder]),
      );
      const resolveBlueprintFolder = async (folderKey: string): Promise<DriveSetupItem> => {
        const chain = [];
        const seen = new Set<string>();
        let cursor = foldersByKey.get(folderKey);
        while (cursor) {
          if (seen.has(cursor.key)) throw staleReview();
          seen.add(cursor.key);
          chain.unshift(cursor);
          cursor = cursor.parentKey ? foldersByKey.get(cursor.parentKey) : undefined;
        }
        if (chain.length === 0) throw staleReview();

        let expectedParentId = config.drive.rootFolderId!;
        let resolved: DriveSetupItem | null = null;
        for (const folder of chain) {
          const canonical = await drive!.findSetupItemsByIdentity("fciRootKey", folder.key);
          const legacy = (folder.key === "client-accounts" || folder.key === "projects")
            ? await drive!.findSetupItemsByIdentity("fciWorkspaceFolder", folder.key)
            : [];
          const matches = new Map([...canonical, ...legacy].map((item) => [item.id, item]));
          const [match] = matches.values();
          const identities = match
            ? new Set(workspaceReconcileDriveIdentities(match).map((identity) => `${identity.resourceType}:${identity.key}`))
            : new Set<string>();
          if (
            matches.size !== 1
            || !match
            || match.mimeType !== GOOGLE_FOLDER_MIME_TYPE
            || match.parents.length !== 1
            || match.parents[0] !== expectedParentId
            || identities.size !== 1
            || !identities.has(`drive.folder:${folder.key}`)
          ) {
            throw staleReview();
          }
          resolved = match;
          expectedParentId = match.id;
        }
        return resolved!;
      };
      const reviewed = await resolveBlueprintFolder(key);
      if (
        reviewed.id !== targetExternalId
        || reviewed.name !== reviewedActualName
      ) {
        throw staleReview();
      }
      targetExternalUrl = reviewed.url;
      await assertReviewedBlueprintCurrent();
      const providerRename = await drive.renameFolder(
        targetExternalId,
        renamedNode.name,
        { expectedCurrentName: reviewedActualName! },
      );
      providerPreviousName = providerRename.previousName;
      driveRenamed = true;
    } else {
      const simulationName = typeof registered?.metadata.name === "string"
        ? registered.metadata.name.trim()
        : "";
      if (
        !registered
        || registered.externalId !== targetExternalId
        || !simulationName
        || simulationName !== reviewedActualName
      ) {
        throw new GoogleIntegrationError(
          "workspace_reconcile_review_stale",
          "The reviewed simulated folder changed after the drift check. Check for drift again before renaming.",
          409,
        );
      }
      await assertReviewedBlueprintCurrent();
      await writeSimulationMetadata({
        ...registered.metadata,
        name: renamedNode.name,
        path: renamedNode.path,
        management: renamedNode.management,
      });
      simulationRenamed = true;
    }

    const restoreReviewedName = async () => {
      if (drive && driveRenamed) {
        return compensateDriveName(
          drive,
          targetExternalId,
          providerPreviousName,
          config,
          auth.user.email,
        );
      }
      if (config.simulation && simulationRenamed && registered) {
        try {
          await writeSimulationMetadata(registered.metadata);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    };

    try {
      await assertReviewedBlueprintCurrent();
    } catch (versionError) {
      if (!await restoreReviewedName()) {
        throw new GoogleIntegrationError(
          "drive_rename_compensation_failed",
          "Drive was renamed after a stale review and the prior name could not be restored. Run reconciliation before retrying.",
          503,
        );
      }
      throw versionError;
    }
    try {
      await writeGoogleIntegrationEvent(
        config,
        "setup.folder_renamed",
        auth.user.email,
        "drive.folder",
        targetExternalId,
        `mode=reconcile-drive-name;key=${key};from=${providerPreviousName};to=${renamedNode.name}`,
      );
    } catch (auditError) {
      const compensated = await restoreReviewedName();
      if (!compensated) {
        throw new GoogleIntegrationError(
          "drive_rename_compensation_failed",
          "Drive was renamed but the audit could not be saved or the prior name restored. Run reconciliation before retrying.",
          503,
        );
      }
      throw auditError;
    }
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return response({
      renamed: true,
      reconciled: true,
      simulated: config.simulation,
      key,
      previousName: providerPreviousName,
      folder: { id: targetExternalId, name: renamedNode.name, url: targetExternalUrl },
      blueprint,
      version: blueprintVersion,
    });
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "drive_folder_rename_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return noStoreResponse(googleIntegrationErrorResponse(error, "The managed Drive folder could not be renamed. Try again."));
  }
}
