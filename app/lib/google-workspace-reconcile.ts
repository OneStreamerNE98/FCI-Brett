import {
  type DriveSetupItem,
  type GoogleDriveClient,
} from "./google-drive";
import type { GoogleCalendarClient } from "./google-calendar-client";
import { GoogleIntegrationError } from "./google-oauth";
import {
  flattenWorkspaceRootFolders,
  type WorkspaceBlueprint,
} from "./workspace-blueprint";
import type { WorkspaceResource } from "./workspace-effective-config";
import {
  workspaceReconcileDesiredResources,
  type WorkspaceReconcileActualResource,
  type WorkspaceReconcileDesiredResource,
} from "./workspace-reconcile";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const LEGACY_ROOT_KEYS = new Set(["client-accounts", "projects"]);
const MAX_REGISTERED_DRIVE_RESOURCES = 200;

export type WorkspaceCalendarRegistration = Readonly<{
  key: string;
  externalId: string;
}>;

export type WorkspaceDriveRegistration = Readonly<{
  resourceType: "drive.folder" | "drive.file" | "sheets.spreadsheet";
  key: string;
  externalId: string;
}>;

type WorkspaceReconcileDriveReader = Pick<
  GoogleDriveClient,
  "getSetupItem" | "listSetupChildren"
>;

type WorkspaceReconcileCalendarReader = Pick<GoogleCalendarClient, "getCalendarMetadata">;

export function workspaceReconcileDriveIdentities(item: DriveSetupItem) {
  return [
    item.appProperties.fciRootKey
      ? { resourceType: "drive.folder" as const, key: item.appProperties.fciRootKey }
      : null,
    item.appProperties.fciTemplateKey
      ? { resourceType: "drive.file" as const, key: item.appProperties.fciTemplateKey }
      : null,
    item.appProperties.fciResourceKind
      ? { resourceType: "sheets.spreadsheet" as const, key: item.appProperties.fciResourceKind }
      : null,
    LEGACY_ROOT_KEYS.has(item.appProperties.fciWorkspaceFolder)
      ? { resourceType: "drive.folder" as const, key: item.appProperties.fciWorkspaceFolder }
      : null,
  ].filter((identity): identity is NonNullable<typeof identity> => identity !== null);
}

function validDriveType(
  resourceType: WorkspaceReconcileActualResource["resourceType"],
  item: DriveSetupItem,
  expectedMimeType?: string | null,
) {
  if (resourceType === "drive.folder") return item.mimeType === FOLDER_MIME_TYPE;
  if (resourceType === "sheets.spreadsheet") return item.mimeType === SPREADSHEET_MIME_TYPE;
  if (resourceType === "drive.file") {
    return expectedMimeType
      ? item.mimeType === expectedMimeType
      : item.mimeType !== FOLDER_MIME_TYPE;
  }
  return false;
}

function actualFromDrive(
  item: DriveSetupItem,
  options: Readonly<{
    fallbackResourceType?: Exclude<WorkspaceReconcileActualResource["resourceType"], "calendar.calendar">;
    fallbackKey?: string | null;
    expectedParentId?: string | null;
    expectedMimeType?: string | null;
    preferFallbackIdentity?: boolean;
  }> = {},
): WorkspaceReconcileActualResource | null {
  const uniqueIdentities = new Map(
    workspaceReconcileDriveIdentities(item).map((identity) => [`${identity.resourceType}:${identity.key}`, identity]),
  );
  const identity = uniqueIdentities.size === 1 ? [...uniqueIdentities.values()][0] : null;
  const resourceType = (options.preferFallbackIdentity ? options.fallbackResourceType : identity?.resourceType)
    ?? identity?.resourceType
    ?? options.fallbackResourceType
    ?? (item.mimeType === FOLDER_MIME_TYPE
      ? "drive.folder"
      : item.mimeType === SPREADSHEET_MIME_TYPE
        ? "sheets.spreadsheet"
        : "drive.file");
  const key = (options.preferFallbackIdentity ? options.fallbackKey : identity?.key)
    ?? identity?.key
    ?? options.fallbackKey
    ?? null;
  const expectedParentId = options.expectedParentId;
  const parentValid = expectedParentId === undefined
    || (expectedParentId !== null && item.parents.length === 1 && item.parents[0] === expectedParentId);
  const fallbackIdentityValid = options.fallbackKey === undefined
    || (
      identity?.key === options.fallbackKey
      && identity.resourceType === options.fallbackResourceType
    );
  return Object.freeze({
    resourceType,
    key,
    name: item.name,
    externalId: item.id,
    parentExternalId: item.parents[0] ?? null,
    url: item.url,
    validType: validDriveType(resourceType, item, options.expectedMimeType),
    validParent: parentValid,
    validIdentity: uniqueIdentities.size <= 1 && fallbackIdentityValid,
    stamped: uniqueIdentities.size > 0,
  });
}

function addActual(
  records: Map<string, WorkspaceReconcileActualResource>,
  discoveredExternalIds: Set<string>,
  resource: WorkspaceReconcileActualResource | null,
) {
  if (!resource) return;
  // A directory listing of an object already discovered by an exact identity
  // adds no information. Conflicting identities deliberately retain one
  // invalid record per claimed key so none of those desired keys can become a
  // misleading Create action.
  if (resource.key === null && discoveredExternalIds.has(resource.externalId)) return;
  const recordKey = `${resource.externalId}:${resource.resourceType}:${resource.key ?? "unstamped"}`;
  if (records.has(recordKey)) return;
  records.set(recordKey, resource);
  discoveredExternalIds.add(resource.externalId);
}

type RegisteredDriveClaim = Readonly<{
  resourceType: "drive.folder" | "drive.file" | "sheets.spreadsheet";
  key: string;
  externalId: string;
}>;

function expectedParentExternalId(
  resource: WorkspaceReconcileDesiredResource,
  folderExternalIds: ReadonlyMap<string, string>,
  rootExternalId: string,
) {
  return resource.parentKey
    ? folderExternalIds.get(resource.parentKey) ?? null
    : rootExternalId;
}

function exactDriveIdentity(
  item: DriveSetupItem,
  resourceType: RegisteredDriveClaim["resourceType"],
  key: string,
) {
  const identities = new Map(
    workspaceReconcileDriveIdentities(item).map((identity) => [`${identity.resourceType}:${identity.key}`, identity]),
  );
  if (identities.size !== 1) return false;
  const [identity] = [...identities.values()];
  return identity.resourceType === resourceType && identity.key === key;
}

function staleParentReview(): never {
  throw new GoogleIntegrationError(
    "workspace_reconcile_review_stale",
    "A blueprint parent changed in Google Drive after this review. Check Workspace drift again before creating anything.",
    409,
  );
}

export function assertWorkspaceReconcileRegistryParentChainInSync(input: Readonly<{
  blueprint: WorkspaceBlueprint;
  resources: readonly WorkspaceResource[];
  rootExternalId: string;
  parentKey: string | null;
}>): string {
  const sharedDrive = input.resources.find((resource) => (
    resource.resourceType === "drive.shared-drive"
    && resource.resourceKey === "primary"
  ));
  if (!sharedDrive || sharedDrive.externalId !== input.rootExternalId) staleParentReview();

  const desiredFolders = new Map(
    flattenWorkspaceRootFolders(input.blueprint).map((folder) => [folder.key, folder]),
  );
  const registeredFolders = new Map(
    input.resources
      .filter((resource) => resource.resourceType === "drive.folder")
      .map((resource) => [resource.resourceKey, resource]),
  );
  const driveClaimCounts = new Map<string, number>();
  for (const resource of input.resources) {
    if (resource.resourceType === "calendar.calendar") continue;
    driveClaimCounts.set(
      resource.externalId,
      (driveClaimCounts.get(resource.externalId) ?? 0) + 1,
    );
  }
  const chain: ReturnType<typeof flattenWorkspaceRootFolders> = [];
  const visited = new Set<string>();
  let key = input.parentKey;
  while (key) {
    if (visited.has(key)) staleParentReview();
    visited.add(key);
    const folder = desiredFolders.get(key);
    if (!folder) staleParentReview();
    chain.unshift(folder);
    key = folder.parentKey;
  }

  let expectedParentId = input.rootExternalId;
  for (const folder of chain) {
    const registered = registeredFolders.get(folder.key);
    const registeredName = typeof registered?.metadata.name === "string"
      ? registered.metadata.name.trim()
      : "";
    if (
      !registered
      || driveClaimCounts.get(registered.externalId) !== 1
      || registeredName !== folder.name
      || registered.parentExternalId !== expectedParentId
    ) {
      staleParentReview();
    }
    expectedParentId = registered.externalId;
  }
  return expectedParentId;
}

/**
 * Re-reads the complete folder ancestry for one reviewed create immediately
 * before its provider write. Registry IDs are hints only: every parent must
 * still have one exact identity, type, name, and provider parent.
 */
export async function assertWorkspaceReconcileParentChainInSync(input: Readonly<{
  drive: Pick<GoogleDriveClient, "findSetupItemsByIdentity">;
  blueprint: WorkspaceBlueprint;
  resources: readonly WorkspaceResource[];
  rootExternalId: string;
  parentKey: string | null;
}>): Promise<string> {
  const registeredParentId = assertWorkspaceReconcileRegistryParentChainInSync(input);

  const desiredFolders = new Map(
    flattenWorkspaceRootFolders(input.blueprint).map((folder) => [folder.key, folder]),
  );
  const registeredFolders = new Map(
    input.resources
      .filter((resource) => resource.resourceType === "drive.folder")
      .map((resource) => [resource.resourceKey, resource]),
  );
  const chain: ReturnType<typeof flattenWorkspaceRootFolders> = [];
  const visited = new Set<string>();
  let key = input.parentKey;
  while (key) {
    if (visited.has(key)) staleParentReview();
    visited.add(key);
    const folder = desiredFolders.get(key);
    if (!folder) staleParentReview();
    chain.unshift(folder);
    key = folder.parentKey;
  }

  let expectedParentId = input.rootExternalId;
  for (const folder of chain) {
    const registered = registeredFolders.get(folder.key);
    if (!registered) staleParentReview();
    const canonical = await input.drive.findSetupItemsByIdentity("fciRootKey", folder.key);
    const legacy = LEGACY_ROOT_KEYS.has(folder.key)
      ? await input.drive.findSetupItemsByIdentity("fciWorkspaceFolder", folder.key)
      : [];
    const matches = [...new Map(
      [...canonical, ...legacy].map((item) => [item.id, item]),
    ).values()];
    if (
      matches.length !== 1
      || matches[0].id !== registered.externalId
      || !exactDriveIdentity(matches[0], "drive.folder", folder.key)
      || matches[0].mimeType !== FOLDER_MIME_TYPE
      || matches[0].name !== folder.name
      || matches[0].parents.length !== 1
      || matches[0].parents[0] !== expectedParentId
    ) {
      staleParentReview();
    }
    expectedParentId = matches[0].id;
  }
  if (expectedParentId !== registeredParentId) staleParentReview();
  return expectedParentId;
}

function providerIdentityActual(
  item: DriveSetupItem,
  desired: readonly WorkspaceReconcileDesiredResource[],
  folderExternalIds: ReadonlyMap<string, string>,
  rootExternalId: string,
  listedParentId?: string,
) {
  const identities = new Map(
    workspaceReconcileDriveIdentities(item).map((identity) => [`${identity.resourceType}:${identity.key}`, identity]),
  );
  const identity = identities.size === 1 ? [...identities.values()][0] : null;
  const desiredResource = identity
    ? desired.find((candidate) => (
      candidate.resourceType === identity.resourceType && candidate.key === identity.key
    ))
    : null;
  return actualFromDrive(item, {
    expectedParentId: desiredResource
      ? expectedParentExternalId(desiredResource, folderExternalIds, rootExternalId)
      : listedParentId,
    expectedMimeType: desiredResource?.expectedMimeType,
  });
}

function retainProviderItem(
  items: Map<string, DriveSetupItem | null>,
  item: DriveSetupItem,
) {
  const existing = items.get(item.id);
  if (existing === undefined || existing === null) {
    items.set(item.id, item);
    return;
  }
  if (JSON.stringify(existing) !== JSON.stringify(item)) {
    throw new GoogleIntegrationError(
      "drive_reconcile_changed",
      "Google Drive setup metadata changed while reconciliation was reading it. Retry the check.",
      409,
    );
  }
}

export async function discoverWorkspaceReconcileActual(input: Readonly<{
  blueprint: WorkspaceBlueprint;
  rootExternalId: string;
  resources: readonly WorkspaceResource[];
  driveRegistrations?: readonly WorkspaceDriveRegistration[];
  calendarRegistrations: readonly WorkspaceCalendarRegistration[];
  drive: WorkspaceReconcileDriveReader;
  calendar?: WorkspaceReconcileCalendarReader | null;
}>): Promise<WorkspaceReconcileActualResource[]> {
  const calendarKeys = new Set(input.calendarRegistrations.map((calendar) => calendar.key));
  const desired = workspaceReconcileDesiredResources(input.blueprint, calendarKeys);
  const records = new Map<string, WorkspaceReconcileActualResource>();
  const discoveredExternalIds = new Set<string>();
  const folderExternalIds = new Map<string, string>();
  const claims = [
    ...input.resources.filter((candidate) => (
    candidate.resourceType === "drive.folder"
    || candidate.resourceType === "drive.file"
    || candidate.resourceType === "sheets.spreadsheet"
    )).map((resource) => Object.freeze({
      resourceType: resource.resourceType as RegisteredDriveClaim["resourceType"],
      key: resource.resourceKey,
      externalId: resource.externalId,
    })),
    ...(input.driveRegistrations ?? []),
  ];
  const uniqueClaims = [...new Map(
    claims.map((claim) => [`${claim.resourceType}:${claim.key}:${claim.externalId}`, claim]),
  ).values()];
  if (uniqueClaims.length > MAX_REGISTERED_DRIVE_RESOURCES) {
    throw new GoogleIntegrationError(
      "drive_reconcile_read_limit",
      "Workspace reconciliation has too many registered Google Drive resources to read safely.",
      503,
    );
  }

  // SET-18 deliberately inventories only two provider-owned collections:
  // direct Shared Drive root children and direct Templates children. Every
  // other active or removed resource is reached by its retained registry ID;
  // this prevents one global appProperties search per blueprint key.
  const providerItems = new Map<string, DriveSetupItem | null>();
  const rootItems = await input.drive.listSetupChildren(input.rootExternalId);
  for (const item of rootItems) retainProviderItem(providerItems, item);
  for (const externalId of new Set(uniqueClaims.map((claim) => claim.externalId))) {
    if (providerItems.has(externalId)) continue;
    providerItems.set(externalId, await input.drive.getSetupItem(externalId));
  }

  // Folder order is parent-before-child. Only an exact, unique provider stamp
  // in the expected parent can become authority for a child listing/parent
  // check; a registry claim alone never turns an unstamped object into a match.
  const providerValues = () => [...providerItems.values()].filter(
    (item): item is DriveSetupItem => item !== null,
  );
  for (const resource of desired.filter((candidate) => candidate.resourceType === "drive.folder")) {
    const expectedParentId = expectedParentExternalId(resource, folderExternalIds, input.rootExternalId);
    const matches = providerValues().filter((item) => (
      exactDriveIdentity(item, "drive.folder", resource.key)
      && item.mimeType === FOLDER_MIME_TYPE
      && expectedParentId !== null
      && item.parents.length === 1
      && item.parents[0] === expectedParentId
    ));
    if (matches.length === 1) folderExternalIds.set(resource.key, matches[0].id);
  }

  const templatesExternalId = folderExternalIds.get("templates");
  const templateItems = templatesExternalId
    ? await input.drive.listSetupChildren(templatesExternalId)
    : [];
  for (const item of templateItems) retainProviderItem(providerItems, item);

  // Claim-specific records preserve strict key/type/parent validity. They also
  // keep a missing or changed stamp from becoming a duplicate-creating Create
  // action merely because a registry ID still points at a physical file.
  for (const claim of uniqueClaims) {
    const item = providerItems.get(claim.externalId);
    if (!item) continue;
    const desiredResource = desired.find((candidate) => (
      candidate.resourceType === claim.resourceType && candidate.key === claim.key
    ));
    addActual(records, discoveredExternalIds, actualFromDrive(item, {
      fallbackResourceType: claim.resourceType,
      fallbackKey: claim.key,
      expectedParentId: desiredResource
        ? expectedParentExternalId(desiredResource, folderExternalIds, input.rootExternalId)
        : undefined,
      expectedMimeType: desiredResource?.expectedMimeType,
      preferFallbackIdentity: true,
    }));
  }

  for (const item of rootItems) {
    addActual(records, discoveredExternalIds, providerIdentityActual(
      item,
      desired,
      folderExternalIds,
      input.rootExternalId,
      input.rootExternalId,
    ));
  }
  for (const item of templateItems) {
    addActual(records, discoveredExternalIds, providerIdentityActual(
      item,
      desired,
      folderExternalIds,
      input.rootExternalId,
      templatesExternalId,
    ));
  }
  for (const item of providerValues()) {
    addActual(records, discoveredExternalIds, providerIdentityActual(
      item,
      desired,
      folderExternalIds,
      input.rootExternalId,
    ));
  }

  if (input.calendar) {
    for (const registration of input.calendarRegistrations) {
      const metadata = await input.calendar.getCalendarMetadata(registration.externalId);
      if (!metadata) continue;
      addActual(records, discoveredExternalIds, Object.freeze({
        resourceType: "calendar.calendar",
        key: registration.key,
        name: metadata.name,
        externalId: registration.externalId,
        parentExternalId: null,
        url: metadata.url,
        validType: true,
        validParent: true,
        validIdentity: true,
        stamped: true,
      }));
    }
  }

  return [...records.values()];
}
