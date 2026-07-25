import {
  type DriveSetupItem,
  type GoogleDriveClient,
} from "./google-drive";
import type { GoogleCalendarClient } from "./google-calendar-client";
import type { WorkspaceBlueprint } from "./workspace-blueprint";
import type { WorkspaceResource } from "./workspace-effective-config";
import {
  workspaceReconcileDesiredResources,
  type WorkspaceReconcileActualResource,
  type WorkspaceReconcileDesiredResource,
} from "./workspace-reconcile";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const LEGACY_ROOT_KEYS = new Set(["client-accounts", "projects"]);

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
  "findSetupItemsByIdentity" | "getSetupItem" | "listSetupChildren"
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
  }> = {},
): WorkspaceReconcileActualResource | null {
  const uniqueIdentities = new Map(
    workspaceReconcileDriveIdentities(item).map((identity) => [`${identity.resourceType}:${identity.key}`, identity]),
  );
  const identity = uniqueIdentities.size === 1 ? [...uniqueIdentities.values()][0] : null;
  const resourceType = identity?.resourceType
    ?? options.fallbackResourceType
    ?? (item.mimeType === FOLDER_MIME_TYPE
      ? "drive.folder"
      : item.mimeType === SPREADSHEET_MIME_TYPE
        ? "sheets.spreadsheet"
        : "drive.file");
  const key = identity?.key ?? options.fallbackKey ?? null;
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

function resourceIdentityProperty(resourceType: WorkspaceReconcileDesiredResource["resourceType"]) {
  if (resourceType === "drive.folder") return "fciRootKey" as const;
  if (resourceType === "drive.file") return "fciTemplateKey" as const;
  if (resourceType === "sheets.spreadsheet") return "fciResourceKind" as const;
  return null;
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

  // Folder order is parent-before-child, so expected-parent checks can use only
  // identities that were already confirmed in their own managed location.
  for (const resource of desired.filter((candidate) => candidate.resourceType === "drive.folder")) {
    const canonical = await input.drive.findSetupItemsByIdentity("fciRootKey", resource.key);
    const legacy = LEGACY_ROOT_KEYS.has(resource.key)
      ? await input.drive.findSetupItemsByIdentity("fciWorkspaceFolder", resource.key)
      : [];
    const matches = new Map([...canonical, ...legacy].map((item) => [item.id, item]));
    const expectedParentId = resource.parentKey
      ? folderExternalIds.get(resource.parentKey) ?? null
      : input.rootExternalId;
    for (const item of matches.values()) {
      addActual(records, discoveredExternalIds, actualFromDrive(item, {
        fallbackResourceType: "drive.folder",
        fallbackKey: resource.key,
        expectedParentId,
        expectedMimeType: resource.expectedMimeType,
      }));
    }
    if (matches.size === 1) {
      const [item] = [...matches.values()];
      const identities = new Map(
        workspaceReconcileDriveIdentities(item).map((identity) => [`${identity.resourceType}:${identity.key}`, identity]),
      );
      const identity = identities.size === 1 ? [...identities.values()][0] : null;
      if (
        identity?.resourceType === "drive.folder"
        && identity.key === resource.key
        && item.mimeType === FOLDER_MIME_TYPE
        && expectedParentId !== null
        && item.parents.length === 1
        && item.parents[0] === expectedParentId
      ) {
        folderExternalIds.set(resource.key, item.id);
      }
    }
  }

  for (const resource of desired.filter((candidate) => (
    candidate.resourceType === "drive.file" || candidate.resourceType === "sheets.spreadsheet"
  )) as Array<WorkspaceReconcileDesiredResource & {
    resourceType: "drive.file" | "sheets.spreadsheet";
  }>) {
    const property = resourceIdentityProperty(resource.resourceType)!;
    const expectedParentId = resource.parentKey
      ? folderExternalIds.get(resource.parentKey) ?? null
      : input.rootExternalId;
    const matches = await input.drive.findSetupItemsByIdentity(property, resource.key);
    for (const item of matches) {
      addActual(records, discoveredExternalIds, actualFromDrive(item, {
        fallbackResourceType: resource.resourceType,
        fallbackKey: resource.key,
        expectedParentId,
        expectedMimeType: resource.expectedMimeType,
      }));
    }
  }

  // Root and Templates directory listings are the bounded unmanaged-item
  // surfaces named by SET-18. Do not recurse into client/project operational
  // trees, where normal business folders would otherwise become false drift.
  for (const item of await input.drive.listSetupChildren(input.rootExternalId)) {
    addActual(records, discoveredExternalIds, actualFromDrive(item));
  }
  const templatesExternalId = folderExternalIds.get("templates");
  if (templatesExternalId) {
    for (const item of await input.drive.listSetupChildren(templatesExternalId)) {
      addActual(records, discoveredExternalIds, actualFromDrive(item));
    }
  }

  // Registry reads retain removed-from-blueprint identities and catch resources
  // that were manually moved outside their expected managed parent.
  for (const resource of input.resources.filter((candidate) => (
    candidate.resourceType === "drive.folder"
    || candidate.resourceType === "drive.file"
    || candidate.resourceType === "sheets.spreadsheet"
  )) as Array<WorkspaceResource & {
    resourceType: "drive.folder" | "drive.file" | "sheets.spreadsheet";
  }>) {
    if (discoveredExternalIds.has(resource.externalId)) continue;
    const item = await input.drive.getSetupItem(resource.externalId);
    if (!item) continue;
    const desiredResource = desired.find((candidate) => (
      candidate.resourceType === resource.resourceType && candidate.key === resource.resourceKey
    ));
    const expectedParentId = desiredResource?.parentKey
      ? folderExternalIds.get(desiredResource.parentKey) ?? null
      : desiredResource
        ? input.rootExternalId
        : undefined;
    addActual(records, discoveredExternalIds, actualFromDrive(item, {
      fallbackResourceType: resource.resourceType,
      fallbackKey: resource.resourceKey,
      expectedParentId,
      expectedMimeType: desiredResource?.expectedMimeType,
    }));
  }

  for (const registration of input.driveRegistrations ?? []) {
    if (discoveredExternalIds.has(registration.externalId)) continue;
    const item = await input.drive.getSetupItem(registration.externalId);
    if (!item) continue;
    const desiredResource = desired.find((candidate) => (
      candidate.resourceType === registration.resourceType && candidate.key === registration.key
    ));
    const expectedParentId = desiredResource?.parentKey
      ? folderExternalIds.get(desiredResource.parentKey) ?? null
      : desiredResource
        ? input.rootExternalId
        : undefined;
    addActual(records, discoveredExternalIds, actualFromDrive(item, {
      fallbackResourceType: registration.resourceType,
      fallbackKey: registration.key,
      expectedParentId,
      expectedMimeType: desiredResource?.expectedMimeType,
    }));
  }

  if (input.calendar) {
    for (const registration of input.calendarRegistrations) {
      const calendar = await input.calendar.getCalendarMetadata(registration.externalId);
      if (!calendar) continue;
      addActual(records, discoveredExternalIds, Object.freeze({
        resourceType: "calendar.calendar",
        key: registration.key,
        name: calendar.name,
        externalId: calendar.id,
        parentExternalId: null,
        url: calendar.url,
        validType: true,
        validParent: true,
        validIdentity: true,
        stamped: true,
      }));
    }
  }

  return [...records.values()];
}
