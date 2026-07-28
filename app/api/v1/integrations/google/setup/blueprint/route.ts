import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import {
  getWorkspaceBlueprint,
  saveWorkspaceBlueprint,
} from "../../../../../../adapters/d1/workspace-blueprints";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import {
  type DriveSetupItem,
  GoogleDriveClient,
} from "../../../../../../lib/google-drive";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  getGoogleRuntimeConfig,
} from "../../../../../../lib/google-oauth-sites";
import { mapGoogleIntegrationError, GoogleIntegrationError } from "../../../../../../lib/google-integration-error";
import { workspaceReconcileDriveIdentities } from "../../../../../../lib/google-workspace-reconcile";
import { noStoreJson, noStoreResponse } from "../../../../../../lib/no-store-json";
import {
  adoptGoogleNameIntoWorkspaceBlueprint,
  workspaceReconcileDesiredResources,
} from "../../../../../../lib/workspace-reconcile";
import {
  flattenWorkspaceRootFolders,
  sanitizeWorkspaceBlueprint,
  seedWorkspaceBlueprint,
  summarizeWorkspaceBlueprintChanges,
  type WorkspaceBlueprint,
  WorkspaceBlueprintValidationError,
} from "../../../../../../lib/workspace-blueprint";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

const MAXIMUM_BLUEPRINT_BODY_BYTES = 64 * 1024;
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const LEGACY_ROOT_KEYS = new Set(["client-accounts", "projects"]);

type ReconcileBlueprintResourceType = "drive.folder" | "sheets.spreadsheet" | "drive.file";

type ReconcileBlueprintReview = Readonly<{
  resourceType: ReconcileBlueprintResourceType;
  key: string;
  expectedExternalId: string;
  expectedActualName: string;
  expectedVersion: number;
}>;

function invalidBody(error: string, status = 400) {
  return noStoreJson({ error }, status);
}

function staleReconcileReview() {
  return new GoogleIntegrationError(
    "workspace_reconcile_review_stale",
    "The reviewed Google resource changed after the drift check. Check for drift again before using its name.",
    409,
  );
}

function isReconcileBlueprintResourceType(value: unknown): value is ReconcileBlueprintResourceType {
  return value === "drive.folder"
    || value === "sheets.spreadsheet"
    || value === "drive.file";
}

function parseReconcileBlueprintReview(value: unknown): ReconcileBlueprintReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const review = value as Record<string, unknown>;
  const keys = Object.keys(review);
  if (
    keys.length !== 5
    || !keys.includes("resourceType")
    || !keys.includes("key")
    || !keys.includes("expectedExternalId")
    || !keys.includes("expectedActualName")
    || !keys.includes("expectedVersion")
    || !isReconcileBlueprintResourceType(review.resourceType)
    || typeof review.key !== "string"
    || !review.key.trim()
    || review.key.trim().length > 41
    || typeof review.expectedExternalId !== "string"
    || !review.expectedExternalId.trim()
    || review.expectedExternalId.trim().length > 200
    || typeof review.expectedActualName !== "string"
    || !review.expectedActualName.trim()
    || review.expectedActualName.trim().length > 500
    || /[\u0000-\u001f\u007f]/u.test(review.expectedActualName)
    || !Number.isSafeInteger(review.expectedVersion)
    || (review.expectedVersion as number) < 0
  ) {
    return null;
  }
  return Object.freeze({
    resourceType: review.resourceType,
    key: review.key.trim(),
    expectedExternalId: review.expectedExternalId.trim(),
    expectedActualName: review.expectedActualName.trim(),
    expectedVersion: review.expectedVersion as number,
  });
}

function sameBlueprint(left: WorkspaceBlueprint, right: WorkspaceBlueprint) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function driveIdentityIsExact(
  item: DriveSetupItem,
  resourceType: ReconcileBlueprintResourceType,
  key: string,
) {
  const identities = new Set(
    workspaceReconcileDriveIdentities(item)
      .map((identity) => `${identity.resourceType}:${identity.key}`),
  );
  return identities.size === 1 && identities.has(`${resourceType}:${key}`);
}

async function resolveLiveFolderChain(
  drive: GoogleDriveClient,
  blueprint: WorkspaceBlueprint,
  rootFolderId: string,
  leafKey: string | null,
) {
  const foldersByKey = new Map(
    flattenWorkspaceRootFolders(blueprint).map((folder) => [folder.key, folder]),
  );
  const chain = [];
  const seen = new Set<string>();
  let cursor = leafKey ? foldersByKey.get(leafKey) : undefined;
  while (cursor) {
    if (seen.has(cursor.key)) throw staleReconcileReview();
    seen.add(cursor.key);
    chain.unshift(cursor);
    cursor = cursor.parentKey ? foldersByKey.get(cursor.parentKey) : undefined;
  }
  if (leafKey && chain.length === 0) throw staleReconcileReview();

  let expectedParentId = rootFolderId;
  let reviewed: DriveSetupItem | null = null;
  for (const folder of chain) {
    const canonical = await drive.findSetupItemsByIdentity("fciRootKey", folder.key);
    const legacy = LEGACY_ROOT_KEYS.has(folder.key)
      ? await drive.findSetupItemsByIdentity("fciWorkspaceFolder", folder.key)
      : [];
    const matches = new Map([...canonical, ...legacy].map((item) => [item.id, item]));
    const [match] = matches.values();
    if (
      matches.size !== 1
      || !match
      || match.mimeType !== GOOGLE_FOLDER_MIME_TYPE
      || match.parents.length !== 1
      || match.parents[0] !== expectedParentId
      || !driveIdentityIsExact(match, "drive.folder", folder.key)
    ) {
      throw staleReconcileReview();
    }
    reviewed = match;
    expectedParentId = match.id;
  }
  return { parentId: expectedParentId, reviewed };
}

async function assertLiveReconcileReview(
  drive: GoogleDriveClient,
  blueprint: WorkspaceBlueprint,
  rootFolderId: string,
  review: ReconcileBlueprintReview,
) {
  const desired = workspaceReconcileDesiredResources(blueprint).find((resource) => (
    resource.resourceType === review.resourceType && resource.key === review.key
  ));
  if (!desired || desired.management !== "owner") throw staleReconcileReview();

  const identityProperty = review.resourceType === "sheets.spreadsheet"
    ? "fciResourceKind"
    : "fciTemplateKey";
  const { parentId, reviewed: reviewedFolder } = await resolveLiveFolderChain(
    drive,
    blueprint,
    rootFolderId,
    review.resourceType === "drive.folder" ? review.key : desired.parentKey,
  );
  let reviewedResource = review.resourceType === "drive.folder"
    ? reviewedFolder
    : null;
  if (review.resourceType !== "drive.folder") {
    const matches = await drive.findSetupItemsByIdentity(identityProperty, review.key);
    reviewedResource = matches.length === 1 ? matches[0] : null;
    if (
      !reviewedResource
      || reviewedResource.mimeType !== desired.expectedMimeType
      || reviewedResource.parents.length !== 1
      || reviewedResource.parents[0] !== parentId
      || !driveIdentityIsExact(reviewedResource, review.resourceType, review.key)
    ) {
      throw staleReconcileReview();
    }
  }
  if (
    !reviewedResource
    || reviewedResource.id !== review.expectedExternalId
    || reviewedResource.name !== review.expectedActualName
  ) {
    throw staleReconcileReview();
  }
}

function resolveSimulationFolderChain(
  blueprint: WorkspaceBlueprint,
  resources: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["resources"],
  rootFolderId: string,
  leafKey: string | null,
) {
  const foldersByKey = new Map(
    flattenWorkspaceRootFolders(blueprint).map((folder) => [folder.key, folder]),
  );
  const chain = [];
  const seen = new Set<string>();
  let cursor = leafKey ? foldersByKey.get(leafKey) : undefined;
  while (cursor) {
    if (seen.has(cursor.key)) throw staleReconcileReview();
    seen.add(cursor.key);
    chain.unshift(cursor);
    cursor = cursor.parentKey ? foldersByKey.get(cursor.parentKey) : undefined;
  }
  if (leafKey && chain.length === 0) throw staleReconcileReview();

  let expectedParentId = rootFolderId;
  let reviewed: (typeof resources)[number] | null = null;
  for (const folder of chain) {
    const matches = resources.filter((resource) => (
      resource.resourceType === "drive.folder" && resource.resourceKey === folder.key
    ));
    const [match] = matches;
    const identitiesForExternalId = match
      ? resources.filter((resource) => resource.externalId === match.externalId)
      : [];
    if (
      matches.length !== 1
      || !match
      || identitiesForExternalId.length !== 1
      || match.parentExternalId !== expectedParentId
    ) {
      throw staleReconcileReview();
    }
    reviewed = match;
    expectedParentId = match.externalId;
  }
  return { parentId: expectedParentId, reviewed };
}

function assertSimulationReconcileReview(
  blueprint: WorkspaceBlueprint,
  resources: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["resources"],
  rootFolderId: string,
  review: ReconcileBlueprintReview,
) {
  const desired = workspaceReconcileDesiredResources(blueprint).find((resource) => (
    resource.resourceType === review.resourceType && resource.key === review.key
  ));
  if (!desired || desired.management !== "owner") throw staleReconcileReview();

  const { parentId, reviewed: reviewedFolder } = resolveSimulationFolderChain(
    blueprint,
    resources,
    rootFolderId,
    review.resourceType === "drive.folder" ? review.key : desired.parentKey,
  );
  const matches = review.resourceType === "drive.folder"
    ? reviewedFolder ? [reviewedFolder] : []
    : resources.filter((resource) => (
      resource.resourceType === review.resourceType && resource.resourceKey === review.key
    ));
  const [reviewed] = matches;
  const identitiesForExternalId = reviewed
    ? resources.filter((resource) => resource.externalId === reviewed.externalId)
    : [];
  const reviewedName = typeof reviewed?.metadata.name === "string"
    ? reviewed.metadata.name.trim()
    : "";
  if (
    matches.length !== 1
    || !reviewed
    || identitiesForExternalId.length !== 1
    || (
      review.resourceType !== "drive.folder"
      && reviewed.parentExternalId !== parentId
    )
    || reviewed.externalId !== review.expectedExternalId
    || reviewedName !== review.expectedActualName
  ) {
    throw staleReconcileReview();
  }
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const config = getGoogleRuntimeConfig();
  const persisted = await getWorkspaceBlueprint(env.DB, config.connectionKey);
  return noStoreJson({
    blueprint: persisted?.blueprint ?? seedWorkspaceBlueprint(),
    version: persisted?.version ?? 0,
    seeded: persisted === null,
  });
}

export async function PUT(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAXIMUM_BLUEPRINT_BODY_BYTES,
    invalidMessage: "Provide a valid Workspace blueprint and expectedVersion.",
    tooLargeMessage: "The Workspace blueprint request is too large.",
  });
  if (!parsed.ok) return invalidBody(parsed.error, parsed.status);

  const keys = Object.keys(parsed.body);
  const genericSave = keys.length === 2
    && keys.includes("blueprint")
    && keys.includes("expectedVersion");
  const reconcileSave = keys.length === 3
    && keys.includes("blueprint")
    && keys.includes("expectedVersion")
    && keys.includes("reconcileReview");
  if (!genericSave && !reconcileSave) {
    return invalidBody("Provide only blueprint and expectedVersion.");
  }
  const expectedVersion = parsed.body.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) {
    return invalidBody("expectedVersion must be a non-negative whole number.");
  }
  const reconcileReview = reconcileSave
    ? parseReconcileBlueprintReview(parsed.body.reconcileReview)
    : null;
  if (reconcileSave && !reconcileReview) {
    return invalidBody("Provide a valid closed reconcileReview for one owner-managed Workspace resource.");
  }
  await ensureWorkspaceSchema();

  let blueprint;
  try {
    blueprint = sanitizeWorkspaceBlueprint(parsed.body.blueprint);
  } catch (error) {
    if (error instanceof WorkspaceBlueprintValidationError) {
      return noStoreJson({ error: error.message, path: error.path }, 400);
    }
    throw error;
  }

  let config = getGoogleRuntimeConfig();
  let previousBlueprint: WorkspaceBlueprint;
  if (reconcileReview) {
    const setup = await getEffectiveGoogleRuntimeSetup();
    config = setup.config;
    if (
      reconcileReview.expectedVersion !== expectedVersion
      || setup.blueprintVersion !== expectedVersion
    ) {
      return noStoreJson({
        error: "The Workspace blueprint changed after this drift review. Check for drift again before using the Google name.",
        code: "workspace_blueprint_version_conflict",
        currentVersion: setup.blueprintVersion,
      }, 409);
    }
    const currentResource = workspaceReconcileDesiredResources(setup.blueprint)
      .find((resource) => (
        resource.resourceType === reconcileReview.resourceType
        && resource.key === reconcileReview.key
      ));
    if (!currentResource || currentResource.management !== "owner") {
      return invalidBody("Only an owner-managed Workspace resource name can be adopted.");
    }
    let reviewedBlueprint: WorkspaceBlueprint;
    try {
      reviewedBlueprint = adoptGoogleNameIntoWorkspaceBlueprint(
        setup.blueprint,
        reconcileReview.resourceType,
        reconcileReview.key,
        reconcileReview.expectedActualName,
      );
    } catch (error) {
      if (error instanceof WorkspaceBlueprintValidationError) {
        return noStoreJson({ error: error.message, path: error.path }, 400);
      }
      throw error;
    }
    if (!sameBlueprint(reviewedBlueprint, blueprint)) {
      return invalidBody("A reconcile review may change only the reviewed owner-managed resource name.");
    }
    if (!setup.config.drive.rootFolderId) {
      return noStoreJson({
        error: "The Shared Drive registration changed after this drift review. Check for drift again before using the Google name.",
        code: "workspace_reconcile_review_stale",
      }, 409);
    }
    try {
      if (setup.config.simulation) {
        assertSimulationReconcileReview(
          setup.blueprint,
          setup.resources,
          setup.config.drive.rootFolderId,
          reconcileReview,
        );
      } else {
        const drive = new GoogleDriveClient(
          await getGoogleAccessToken(setup.config, "drive"),
          setup.config,
        );
        await assertLiveReconcileReview(
          drive,
          setup.blueprint,
          setup.config.drive.rootFolderId,
          reconcileReview,
        );
      }
    } catch (error) {
      const mapped = mapGoogleIntegrationError(
        error,
        "Google Drive could not revalidate the reviewed resource. Check for drift again before retrying.",
      );
      return noStoreJson(mapped.body, mapped.status);
    }
    previousBlueprint = setup.blueprint;
  } else {
    const previous = await getWorkspaceBlueprint(env.DB, config.connectionKey);
    previousBlueprint = previous?.blueprint ?? seedWorkspaceBlueprint();
  }
  const changeSummary = summarizeWorkspaceBlueprintChanges(previousBlueprint, blueprint);
  const result = await saveWorkspaceBlueprint(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    expectedVersion: expectedVersion as number,
    blueprint,
    actor: auth.user.email,
    now: Date.now(),
    auditEvent: {
      id: crypto.randomUUID(),
      eventType: "setup.blueprint_updated",
      entityType: "workspace-blueprint",
      entityId: config.connectionKey,
      detail: `version=${(expectedVersion as number) + 1};${changeSummary}`,
    },
  });
  if (!result.saved) {
    return noStoreJson({
      error: "The Workspace blueprint changed after this editor loaded. Load the latest version before saving again.",
      code: "workspace_blueprint_version_conflict",
      currentVersion: result.currentVersion,
    }, 409);
  }
  return noStoreJson({
    blueprint: result.record.blueprint,
    version: result.record.version,
    seeded: false,
  });
}
