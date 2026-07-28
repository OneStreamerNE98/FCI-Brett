import type { WorkspaceBlueprint } from "./workspace-blueprint";
import type { WorkspaceResource } from "./workspace-effective-config";
import {
  workspaceReconcileDesiredResources,
  type WorkspaceReconcileActualResource,
} from "./workspace-reconcile";

export type WorkspaceReconcileSimulationFixture = WorkspaceReconcileActualResource;

/**
 * SET-18 simulation has no provider listing. Registry rows are the durable
 * physical-resource fixture: ensures add rows, blueprint removal leaves them
 * present, and their saved metadata retains the provider-side display name.
 */
export function workspaceReconcileSimulationActual(
  blueprint: WorkspaceBlueprint,
  resources: readonly WorkspaceResource[],
  additionalFixtures: readonly WorkspaceReconcileSimulationFixture[] = [],
): WorkspaceReconcileActualResource[] {
  const calendarKeys = new Set(
    resources
      .filter((resource) => resource.resourceType === "calendar.calendar")
      .map((resource) => resource.resourceKey),
  );
  const desiredByIdentity = new Map(
    workspaceReconcileDesiredResources(blueprint, calendarKeys)
      .map((resource) => [`${resource.resourceType}:${resource.key}`, resource]),
  );
  const registeredFolders = new Map(
    resources
      .filter((resource) => resource.resourceType === "drive.folder")
      .map((resource) => [resource.resourceKey, resource.externalId]),
  );
  const sharedDriveExternalId = resources.find((resource) => (
    resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary"
  ))?.externalId ?? null;
  const actual = resources
    .filter((resource): resource is WorkspaceResource & {
      resourceType: Exclude<WorkspaceResource["resourceType"], "drive.shared-drive">;
    } => resource.resourceType !== "drive.shared-drive")
    .map((resource): WorkspaceReconcileActualResource => {
      const desired = desiredByIdentity.get(`${resource.resourceType}:${resource.resourceKey}`);
      const metadataName = typeof resource.metadata.name === "string"
        ? resource.metadata.name.trim()
        : "";
      const expectedParentExternalId = desired?.resourceType === "calendar.calendar"
        ? null
        : desired?.parentKey
          ? registeredFolders.get(desired.parentKey) ?? null
          : desired
            ? sharedDriveExternalId
            : undefined;
      return Object.freeze({
        resourceType: resource.resourceType,
        key: resource.resourceKey,
        name: metadataName || "Provider name unavailable",
        externalId: resource.externalId,
        parentExternalId: resource.parentExternalId,
        url: resource.externalUrl,
        validType: true,
        validParent: desired?.resourceType === "calendar.calendar"
          || expectedParentExternalId === undefined
          || (
            expectedParentExternalId !== null
            && resource.parentExternalId === expectedParentExternalId
          ),
        validIdentity: true,
        validMetadata: Boolean(metadataName),
        stamped: true,
      });
    });
  const byClaim = new Map<string, WorkspaceReconcileActualResource>();
  const registeredExternalIds = new Set(actual.map((resource) => resource.externalId));
  for (const resource of actual) {
    byClaim.set(
      `${resource.externalId}:${resource.resourceType}:${resource.key ?? "unstamped"}`,
      resource,
    );
  }
  for (const resource of additionalFixtures) {
    if (resource.key === null && registeredExternalIds.has(resource.externalId)) continue;
    const claimKey = `${resource.externalId}:${resource.resourceType}:${resource.key ?? "unstamped"}`;
    if (!byClaim.has(claimKey)) byClaim.set(claimKey, resource);
  }
  const claimCounts = new Map<string, Set<string>>();
  for (const resource of byClaim.values()) {
    const claims = claimCounts.get(resource.externalId) ?? new Set<string>();
    claims.add(`${resource.resourceType}:${resource.key ?? "unstamped"}`);
    claimCounts.set(resource.externalId, claims);
  }
  return [...byClaim.values()].map((resource) => (
    (claimCounts.get(resource.externalId)?.size ?? 0) > 1
      ? Object.freeze({ ...resource, validIdentity: false })
      : resource
  ));
}
