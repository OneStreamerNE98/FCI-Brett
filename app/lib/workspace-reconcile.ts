import {
  flattenWorkspaceRootFolders,
  sanitizeWorkspaceBlueprint,
  type WorkspaceBlueprint,
  type WorkspaceBlueprintManagement,
} from "./workspace-blueprint";
import type { WorkspaceResourceType } from "./workspace-effective-config";

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const GOOGLE_PRESENTATION_MIME_TYPE = "application/vnd.google-apps.presentation";

export const WORKSPACE_RECONCILE_ACTIONS = [
  "ensure-folders",
  "ensure-spreadsheets",
  "ensure-templates",
  "rename-drive",
  "adopt-blueprint-name",
] as const;

export type WorkspaceReconcileAction = (typeof WORKSPACE_RECONCILE_ACTIONS)[number];
export type WorkspaceReconcileState = "missing" | "renamed" | "unmanaged";

export type WorkspaceReconcileDesiredResource = Readonly<{
  resourceType: Exclude<WorkspaceResourceType, "drive.shared-drive">;
  key: string;
  label: string;
  name: string;
  management: WorkspaceBlueprintManagement;
  parentKey: string | null;
  expectedMimeType: string | null;
}>;

export type WorkspaceReconcileActualResource = Readonly<{
  resourceType: Exclude<WorkspaceResourceType, "drive.shared-drive">;
  key: string | null;
  name: string;
  externalId: string;
  parentExternalId: string | null;
  url: string | null;
  validType: boolean;
  validParent?: boolean;
  validIdentity?: boolean;
  validMetadata?: boolean;
  stamped: boolean;
}>;

export type WorkspaceReconcileDrift = Readonly<{
  id: string;
  state: WorkspaceReconcileState;
  resourceType: Exclude<WorkspaceResourceType, "drive.shared-drive">;
  key: string | null;
  label: string;
  management: WorkspaceBlueprintManagement | null;
  expectedName: string | null;
  actualName: string | null;
  externalId: string | null;
  url: string | null;
  detail: string;
  actions: readonly WorkspaceReconcileAction[];
}>;

export type WorkspaceReconcileResult = Readonly<{
  drift: readonly WorkspaceReconcileDrift[];
  counts: Readonly<Record<WorkspaceReconcileState, number> & { inSync: number }>;
}>;

const STATE_ORDER = Object.freeze({
  missing: 0,
  renamed: 1,
  unmanaged: 2,
} satisfies Record<WorkspaceReconcileState, number>);

function desiredIdentity(resource: Pick<WorkspaceReconcileDesiredResource, "resourceType" | "key">) {
  return `${resource.resourceType}:${resource.key}`;
}

function actualIdentity(resource: Pick<WorkspaceReconcileActualResource, "resourceType" | "key">) {
  return resource.key ? `${resource.resourceType}:${resource.key}` : null;
}

function stableId(
  state: WorkspaceReconcileState,
  resourceType: WorkspaceReconcileDrift["resourceType"],
  key: string | null,
  externalId: string | null,
) {
  return [state, resourceType, key ?? "unstamped", externalId ?? "absent"]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function missingActions(resourceType: WorkspaceReconcileDesiredResource["resourceType"]) {
  if (resourceType === "drive.folder") return ["ensure-folders"] as const;
  if (resourceType === "sheets.spreadsheet") return ["ensure-spreadsheets"] as const;
  if (resourceType === "drive.file") return ["ensure-templates"] as const;
  // Calendar creation remains owner/scope-gated by SET-20. Reconcile reports
  // registered Calendar drift honestly without fabricating an unavailable action.
  return [] as const;
}

function renamedActions(resource: WorkspaceReconcileDesiredResource) {
  if (resource.resourceType === "drive.folder") {
    return resource.management === "system"
      ? ["rename-drive"] as const
      : ["rename-drive", "adopt-blueprint-name"] as const;
  }
  if (
    resource.management === "owner"
    && (
      resource.resourceType === "sheets.spreadsheet"
      || resource.resourceType === "drive.file"
    )
  ) {
    return ["adopt-blueprint-name"] as const;
  }
  return [] as const;
}

function templatePresentation(kind: string) {
  if (kind === "sheet") {
    return {
      label: "Spreadsheet template",
      expectedMimeType: GOOGLE_SPREADSHEET_MIME_TYPE,
    } as const;
  }
  if (kind === "slides") {
    return {
      label: "Slides template",
      expectedMimeType: GOOGLE_PRESENTATION_MIME_TYPE,
    } as const;
  }
  return {
    label: "Document template",
    expectedMimeType: GOOGLE_DOCUMENT_MIME_TYPE,
  } as const;
}

export function workspaceReconcileDesiredResources(
  blueprint: WorkspaceBlueprint,
  registeredCalendarKeys: ReadonlySet<string> = new Set(),
): WorkspaceReconcileDesiredResource[] {
  return [
    ...flattenWorkspaceRootFolders(blueprint).map((folder) => Object.freeze({
      resourceType: "drive.folder" as const,
      key: folder.key,
      label: folder.parentKey ? "Workspace subfolder" : "Root folder",
      name: folder.name,
      management: folder.management,
      parentKey: folder.parentKey,
      expectedMimeType: GOOGLE_FOLDER_MIME_TYPE,
    })),
    ...blueprint.spreadsheets.map((spreadsheet) => Object.freeze({
      resourceType: "sheets.spreadsheet" as const,
      key: spreadsheet.key,
      label: spreadsheet.role === "system-mirror"
        ? "Client directory spreadsheet"
        : spreadsheet.role === "import"
          ? "Import spreadsheet"
          : "Reference spreadsheet",
      name: spreadsheet.name,
      management: spreadsheet.management,
      parentKey: spreadsheet.targetFolderKey,
      expectedMimeType: GOOGLE_SPREADSHEET_MIME_TYPE,
    })),
    ...blueprint.templates.map((template) => {
      const presentation = templatePresentation(template.kind);
      return Object.freeze({
        resourceType: "drive.file" as const,
        key: template.key,
        label: presentation.label,
        name: template.name,
        management: template.management,
        parentKey: "templates",
        expectedMimeType: presentation.expectedMimeType,
      });
    }),
    ...blueprint.calendars
      .filter((calendar) => registeredCalendarKeys.has(calendar.key))
      .map((calendar) => Object.freeze({
        resourceType: "calendar.calendar" as const,
        key: calendar.key,
        label: "Workspace calendar",
        name: calendar.name,
        management: calendar.management,
        parentKey: null,
        expectedMimeType: null,
      })),
  ];
}

function missingDrift(
  resource: WorkspaceReconcileDesiredResource,
  parentChainInSync: boolean,
): WorkspaceReconcileDrift {
  const actions = missingActions(resource.resourceType);
  const blockedByParent = actions.length > 0 && !parentChainInSync;
  return Object.freeze({
    id: stableId("missing", resource.resourceType, resource.key, null),
    state: "missing",
    resourceType: resource.resourceType,
    key: resource.key,
    label: resource.label,
    management: resource.management,
    expectedName: resource.name,
    actualName: null,
    externalId: null,
    url: null,
    detail: blockedByParent
      ? `${resource.name} is defined in the blueprint but was not found in Google. Create is unavailable until every blueprint parent is in sync.`
      : `${resource.name} is defined in the blueprint but was not found in Google.`,
    actions: Object.freeze(blockedByParent ? [] : [...actions]),
  });
}

function renamedDrift(
  desired: WorkspaceReconcileDesiredResource,
  actual: WorkspaceReconcileActualResource,
): WorkspaceReconcileDrift {
  return Object.freeze({
    id: stableId("renamed", desired.resourceType, desired.key, actual.externalId),
    state: "renamed",
    resourceType: desired.resourceType,
    key: desired.key,
    label: desired.label,
    management: desired.management,
    expectedName: desired.name,
    actualName: actual.name,
    externalId: actual.externalId,
    url: actual.url,
    detail: `Google uses “${actual.name}”; the blueprint expects “${desired.name}”.`,
    actions: Object.freeze([...renamedActions(desired)]),
  });
}

function unmanagedDrift(
  actual: WorkspaceReconcileActualResource,
  detail: string,
): WorkspaceReconcileDrift {
  return Object.freeze({
    id: stableId("unmanaged", actual.resourceType, actual.key, actual.externalId),
    state: "unmanaged",
    resourceType: actual.resourceType,
    key: actual.key,
    label: actual.stamped ? "Identity-stamped Google resource" : "Unstamped Google resource",
    management: null,
    expectedName: null,
    actualName: actual.name,
    externalId: actual.externalId,
    url: actual.url,
    detail,
    actions: Object.freeze([]),
  });
}

/**
 * Compares desired blueprint identities with a bounded provider snapshot.
 * No mutation decision is inferred here: the returned closed action catalog
 * points only at existing review-first routes.
 */
export function deriveWorkspaceReconcileDrift(
  desired: readonly WorkspaceReconcileDesiredResource[],
  actual: readonly WorkspaceReconcileActualResource[],
): WorkspaceReconcileResult {
  const desiredByIdentity = new Map(desired.map((resource) => [desiredIdentity(resource), resource]));
  const actualByIdentity = new Map<string, WorkspaceReconcileActualResource[]>();
  const unkeyed: WorkspaceReconcileActualResource[] = [];
  let inSync = 0;

  for (const resource of actual) {
    const identity = actualIdentity(resource);
    if (!identity) {
      unkeyed.push(resource);
      continue;
    }
    const matches = actualByIdentity.get(identity) ?? [];
    matches.push(resource);
    actualByIdentity.set(identity, matches);
  }
  const allActualByIdentity = new Map(
    [...actualByIdentity].map(([identity, matches]) => [identity, [...matches]]),
  );

  const exactInSync = (resource: WorkspaceReconcileDesiredResource) => {
    const matches = allActualByIdentity.get(desiredIdentity(resource)) ?? [];
    if (matches.length !== 1) return false;
    const [match] = matches;
    return match.validMetadata !== false
      && match.validIdentity !== false
      && match.validType
      && match.validParent !== false
      && match.name === resource.name;
  };
  const parentChainInSync = (resource: WorkspaceReconcileDesiredResource) => {
    const visited = new Set<string>();
    let parentKey = resource.parentKey;
    while (parentKey) {
      if (visited.has(parentKey)) return false;
      visited.add(parentKey);
      const parent = desiredByIdentity.get(`drive.folder:${parentKey}`);
      if (!parent || !exactInSync(parent)) return false;
      parentKey = parent.parentKey;
    }
    return true;
  };

  const drift: WorkspaceReconcileDrift[] = [];
  for (const resource of desired) {
    const identity = desiredIdentity(resource);
    const matches = actualByIdentity.get(identity) ?? [];
    if (matches.length === 0) {
      drift.push(missingDrift(resource, parentChainInSync(resource)));
      continue;
    }
    actualByIdentity.delete(identity);
    if (matches.length > 1) {
      drift.push(...matches.map((match) => unmanagedDrift(
        match,
        `More than one Google resource carries the blueprint identity ${resource.key}. Resolve the duplicate in Google before running setup again; nothing was deleted.`,
      )));
      continue;
    }
    const [match] = matches;
    if (match.validMetadata === false) {
      drift.push(unmanagedDrift(
        match,
        `The simulation registry does not retain enough provider-side metadata for ${resource.key}. No action is offered until setup records the resource again.`,
      ));
      continue;
    }
    if (match.validIdentity === false) {
      drift.push(unmanagedDrift(
        match,
        match.stamped
          ? `The Google resource carries conflicting setup identities for ${resource.key}. It remains in Google and no action is offered.`
          : `The registered Google resource is missing the setup identity ${resource.key}. It remains in Google and no create action is offered.`,
      ));
      continue;
    }
    if (!match.validType) {
      drift.push(unmanagedDrift(
        match,
        `The identity ${resource.key} is attached to the wrong Google resource type. It remains in Google and no destructive action is offered.`,
      ));
      continue;
    }
    if (match.validParent === false) {
      drift.push(unmanagedDrift(
        match,
        `The identity ${resource.key} is outside its blueprint parent. It remains in Google and no create or destructive action is offered.`,
      ));
      continue;
    }
    // Only folders have an existing provider rename surface. Owner-managed
    // sheets and templates can still adopt the reviewed Google display name
    // into the blueprint without mutating Google.
    if (match.name !== resource.name) {
      drift.push(renamedDrift(resource, match));
    } else {
      inSync += 1;
    }
  }

  for (const matches of actualByIdentity.values()) {
    for (const resource of matches) {
      const identity = actualIdentity(resource)!;
      const expected = desiredByIdentity.get(identity);
      if (expected) continue;
      drift.push(unmanagedDrift(
        resource,
        resource.key && resource.stamped
          ? `The Google resource still carries identity ${resource.key}, but that key is no longer in the blueprint. It remains in Google.`
          : resource.key
            ? `The registered Google resource is associated with former blueprint key ${resource.key}, but it does not carry that setup identity. It remains in Google.`
          : "This Google resource is not managed by the blueprint. It remains in Google.",
      ));
    }
  }
  drift.push(...unkeyed.map((resource) => unmanagedDrift(
    resource,
    "This item is inside a managed setup location but has no FCI setup identity. It remains in Google.",
  )));

  drift.sort((left, right) => (
    STATE_ORDER[left.state] - STATE_ORDER[right.state]
    || left.resourceType.localeCompare(right.resourceType)
    || (left.key ?? "").localeCompare(right.key ?? "")
    || (left.actualName ?? left.expectedName ?? "").localeCompare(right.actualName ?? right.expectedName ?? "")
  ));
  const counts = Object.freeze({
    missing: drift.filter((item) => item.state === "missing").length,
    renamed: drift.filter((item) => item.state === "renamed").length,
    unmanaged: drift.filter((item) => item.state === "unmanaged").length,
    inSync,
  });
  return Object.freeze({ drift: Object.freeze(drift), counts });
}

type MutableWorkspaceFolder = {
  key: string;
  name: string;
  management: WorkspaceBlueprintManagement;
  children: MutableWorkspaceFolder[];
};

/** Applies an explicitly reviewed Google display name to one owner blueprint node. */
export function adoptGoogleNameIntoWorkspaceBlueprint(
  blueprint: WorkspaceBlueprint,
  resourceType: WorkspaceReconcileDesiredResource["resourceType"],
  key: string,
  name: string,
): WorkspaceBlueprint {
  const mutable = structuredClone(blueprint) as unknown as {
    drive: { roots: MutableWorkspaceFolder[] };
    spreadsheets: Array<{ key: string; name: string; management: WorkspaceBlueprintManagement }>;
    templates: Array<{ key: string; name: string; management: WorkspaceBlueprintManagement }>;
  };
  let matched = false;

  if (resourceType === "drive.folder") {
    const visit = (folders: MutableWorkspaceFolder[]) => {
      for (const folder of folders) {
        if (folder.key === key) {
          if (folder.management !== "owner") throw new TypeError("System-managed resource names cannot be adopted into the blueprint.");
          folder.name = name;
          matched = true;
        }
        visit(folder.children);
      }
    };
    visit(mutable.drive.roots);
  } else if (resourceType === "sheets.spreadsheet") {
    const spreadsheet = mutable.spreadsheets.find((candidate) => candidate.key === key);
    if (spreadsheet) {
      if (spreadsheet.management !== "owner") throw new TypeError("System-managed resource names cannot be adopted into the blueprint.");
      spreadsheet.name = name;
      matched = true;
    }
  } else if (resourceType === "drive.file") {
    const template = mutable.templates.find((candidate) => candidate.key === key);
    if (template) {
      if (template.management !== "owner") throw new TypeError("System-managed resource names cannot be adopted into the blueprint.");
      template.name = name;
      matched = true;
    }
  }

  if (!matched) throw new TypeError("The selected owner-managed blueprint resource was not found.");
  return sanitizeWorkspaceBlueprint(mutable);
}
