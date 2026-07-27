import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-reconcile", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24744 } },
});
const {
  WORKSPACE_RECONCILE_ACTIONS,
  adoptGoogleNameIntoWorkspaceBlueprint,
  deriveWorkspaceReconcileDrift,
  workspaceReconcileDesiredResources,
} = await vite.ssrLoadModule("/app/lib/workspace-reconcile.ts");
const {
  sanitizeWorkspaceBlueprint,
  seedWorkspaceBlueprint,
} = await vite.ssrLoadModule("/app/lib/workspace-blueprint.ts");
const {
  workspaceReconcileSimulationActual,
} = await vite.ssrLoadModule("/app/lib/workspace-reconcile-simulation.ts");

after(async () => {
  await vite.close();
});

function desired(overrides) {
  return Object.freeze({
    resourceType: "drive.folder",
    key: "folder",
    label: "Root folder",
    name: "Expected name",
    management: "owner",
    parentKey: null,
    ...overrides,
  });
}

function actual(overrides) {
  return Object.freeze({
    resourceType: "drive.folder",
    key: "folder",
    name: "Expected name",
    externalId: "drive-folder",
    parentExternalId: "shared-drive",
    url: "https://drive.google.com/drive/folders/drive-folder",
    validType: true,
    stamped: true,
    ...overrides,
  });
}

function simulationResource(overrides) {
  return Object.freeze({
    id: crypto.randomUUID(),
    connectionKey: "workspace-simulation",
    resourceType: "drive.folder",
    resourceKey: "folder",
    externalId: "folder-id",
    parentExternalId: "workspace-simulation",
    externalUrl: "https://drive.google.test/folder-id",
    origin: "created",
    metadata: Object.freeze({ name: "Expected name" }),
    createdBy: "admin@example.test",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

test("desired resources cover the bounded root tree, registered sheets/templates, and only registered calendars", () => {
  const blueprint = seedWorkspaceBlueprint();
  const resources = workspaceReconcileDesiredResources(
    blueprint,
    new Set(["client-appointments", "holidays", "not-a-blueprint-key"]),
  );

  assert.deepEqual(
    resources.map(({ resourceType, key, parentKey }) => ({ resourceType, key, parentKey })),
    [
      { resourceType: "drive.folder", key: "company-admin", parentKey: null },
      { resourceType: "drive.folder", key: "templates", parentKey: "company-admin" },
      { resourceType: "drive.folder", key: "client-accounts", parentKey: null },
      { resourceType: "drive.folder", key: "projects", parentKey: null },
      { resourceType: "drive.folder", key: "archive", parentKey: null },
      { resourceType: "drive.folder", key: "unsorted-intake", parentKey: null },
      { resourceType: "sheets.spreadsheet", key: "client-directory", parentKey: "company-admin" },
      { resourceType: "drive.file", key: "estimate-proposal", parentKey: "templates" },
      { resourceType: "drive.file", key: "installation-work-order", parentKey: "templates" },
      { resourceType: "drive.file", key: "change-order", parentKey: "templates" },
      { resourceType: "drive.file", key: "pre-install-checklist", parentKey: "templates" },
      { resourceType: "drive.file", key: "project-budget", parentKey: "templates" },
      { resourceType: "calendar.calendar", key: "client-appointments", parentKey: null },
      { resourceType: "calendar.calendar", key: "holidays", parentKey: null },
    ],
  );
  assert.equal(resources.some(({ key }) => key === "field-schedule"), false);
  assert.equal(resources.find(({ key }) => key === "client-directory").label, "Client directory spreadsheet");
  assert.equal(resources.find(({ key }) => key === "project-budget").label, "Spreadsheet template");
  assert.equal(resources.find(({ key }) => key === "estimate-proposal").label, "Document template");
  assert.ok(resources.every(Object.isFrozen));
});

test("desired resources recognize the additive Slides template kind without changing existing template MIME mappings", () => {
  const blueprint = structuredClone(seedWorkspaceBlueprint());
  blueprint.templates.push({
    key: "presentation-template",
    name: "Presentation Template",
    kind: "slides",
    targetFolderKey: "client-profile",
    management: "owner",
  });

  const resources = workspaceReconcileDesiredResources(blueprint);

  assert.deepEqual(
    resources
      .filter(({ resourceType }) => resourceType === "drive.file")
      .map(({ key, label, expectedMimeType }) => ({ key, label, expectedMimeType }))
      .slice(-2),
    [
      {
        key: "project-budget",
        label: "Spreadsheet template",
        expectedMimeType: "application/vnd.google-apps.spreadsheet",
      },
      {
        key: "presentation-template",
        label: "Slides template",
        expectedMimeType: "application/vnd.google-apps.presentation",
      },
    ],
  );
});

test("simulation uses only persisted provider metadata and fails closed on missing names or moved parents", () => {
  const blueprint = seedWorkspaceBlueprint();
  const resources = [
    simulationResource({
      resourceType: "drive.shared-drive",
      resourceKey: "primary",
      externalId: "workspace-simulation",
      parentExternalId: null,
      metadata: Object.freeze({ name: blueprint.drive.sharedDriveName }),
    }),
    simulationResource({
      resourceKey: "company-admin",
      externalId: "folder-company-admin",
      metadata: Object.freeze({ name: "00_Company Admin" }),
    }),
    simulationResource({
      resourceKey: "templates",
      externalId: "folder-templates",
      parentExternalId: "wrong-parent",
      metadata: Object.freeze({ name: "Templates" }),
    }),
    simulationResource({
      resourceKey: "client-accounts",
      externalId: "folder-client-accounts",
      metadata: Object.freeze({}),
    }),
  ];

  const actualResources = workspaceReconcileSimulationActual(blueprint, resources);
  const actualByKey = new Map(actualResources.map((resource) => [resource.key, resource]));
  assert.equal(actualByKey.get("client-accounts").name, "Provider name unavailable");
  assert.equal(actualByKey.get("client-accounts").validMetadata, false);
  assert.equal(actualByKey.get("templates").validParent, false);

  const desiredResources = workspaceReconcileDesiredResources(blueprint)
    .filter(({ key }) => key === "client-accounts" || key === "templates");
  const result = deriveWorkspaceReconcileDrift(desiredResources, actualResources);
  assert.deepEqual(result.counts, { missing: 0, renamed: 0, unmanaged: 3, inSync: 0 });
  assert.equal(
    result.drift.some(({ key, detail }) => (
      key === "client-accounts" && detail.includes("does not retain enough provider-side metadata")
    )),
    true,
  );
  assert.equal(
    result.drift.some(({ key, detail }) => (
      key === "templates" && detail.includes("outside its blueprint parent")
    )),
    true,
  );
});

test("drift matrix maps missing resources to only the existing review-first creation routes", () => {
  const desiredResources = [
    desired({ key: "missing-folder", name: "Missing Folder" }),
    desired({
      resourceType: "sheets.spreadsheet",
      key: "missing-sheet",
      label: "Import spreadsheet",
      name: "Missing Sheet",
      parentKey: "company-admin",
    }),
    desired({
      resourceType: "drive.file",
      key: "missing-template",
      label: "Document template",
      name: "Missing Template",
      parentKey: "templates",
    }),
    desired({
      resourceType: "calendar.calendar",
      key: "missing-calendar",
      label: "Workspace calendar",
      name: "Missing Calendar",
      management: "system",
    }),
  ];

  const result = deriveWorkspaceReconcileDrift(desiredResources, []);

  assert.deepEqual(result.counts, {
    missing: 4,
    renamed: 0,
    unmanaged: 0,
    inSync: 0,
  });
  assert.deepEqual(
    result.drift.map(({ key, actions, detail }) => ({ key, actions, detail })),
    [
      {
        key: "missing-calendar",
        actions: [],
        detail: "Missing Calendar is defined in the blueprint but was not found in Google.",
      },
      {
        key: "missing-template",
        actions: ["ensure-templates"],
        detail: "Missing Template is defined in the blueprint but was not found in Google.",
      },
      {
        key: "missing-folder",
        actions: ["ensure-folders"],
        detail: "Missing Folder is defined in the blueprint but was not found in Google.",
      },
      {
        key: "missing-sheet",
        actions: ["ensure-spreadsheets"],
        detail: "Missing Sheet is defined in the blueprint but was not found in Google.",
      },
    ],
  );
  assert.deepEqual([...WORKSPACE_RECONCILE_ACTIONS], [
    "ensure-folders",
    "ensure-spreadsheets",
    "ensure-templates",
    "rename-drive",
    "adopt-blueprint-name",
  ]);
});

test("folder rename actions distinguish owner-managed and system-managed identities exactly", () => {
  const desiredResources = [
    desired({ key: "owner-folder", name: "Owner Blueprint Name", management: "owner" }),
    desired({ key: "system-folder", name: "System Blueprint Name", management: "system" }),
  ];
  const actualResources = [
    actual({ key: "owner-folder", name: "Owner Google Name", externalId: "owner-id" }),
    actual({ key: "system-folder", name: "System Google Name", externalId: "system-id" }),
  ];

  const result = deriveWorkspaceReconcileDrift(desiredResources, actualResources);

  assert.deepEqual(result.counts, {
    missing: 0,
    renamed: 2,
    unmanaged: 0,
    inSync: 0,
  });
  assert.deepEqual(
    result.drift.map(({ key, expectedName, actualName, actions, detail }) => ({
      key,
      expectedName,
      actualName,
      actions,
      detail,
    })),
    [
      {
        key: "owner-folder",
        expectedName: "Owner Blueprint Name",
        actualName: "Owner Google Name",
        actions: ["rename-drive", "adopt-blueprint-name"],
        detail: "Google uses “Owner Google Name”; the blueprint expects “Owner Blueprint Name”.",
      },
      {
        key: "system-folder",
        expectedName: "System Blueprint Name",
        actualName: "System Google Name",
        actions: ["rename-drive"],
        detail: "Google uses “System Google Name”; the blueprint expects “System Blueprint Name”.",
      },
    ],
  );
});

test("removed, unstamped, duplicate, wrong-type, and wrong-parent resources stay unmanaged with no destructive action", () => {
  const desiredResources = [
    desired({ key: "duplicate", name: "Duplicate" }),
    desired({ key: "wrong-type", name: "Wrong type" }),
    desired({ key: "wrong-parent", name: "Wrong parent" }),
  ];
  const actualResources = [
    actual({ key: "duplicate", name: "Duplicate A", externalId: "duplicate-a" }),
    actual({ key: "duplicate", name: "Duplicate B", externalId: "duplicate-b" }),
    actual({ key: "wrong-type", name: "Wrong type", externalId: "wrong-type-id", validType: false }),
    actual({
      key: "wrong-parent",
      name: "Wrong parent",
      externalId: "wrong-parent-id",
      parentExternalId: "elsewhere",
      validParent: false,
    }),
    actual({ key: "removed-key", name: "Removed but retained", externalId: "removed-id" }),
    actual({
      key: "removed-unstamped",
      name: "Removed registry-only resource",
      externalId: "removed-unstamped-id",
      stamped: false,
    }),
    actual({ key: null, name: "Unstamped child", externalId: "unstamped-id", stamped: false }),
  ];

  const result = deriveWorkspaceReconcileDrift(desiredResources, actualResources);

  assert.deepEqual(result.counts, {
    missing: 0,
    renamed: 0,
    unmanaged: 7,
    inSync: 0,
  });
  assert.ok(result.drift.every(({ state }) => state === "unmanaged"));
  assert.ok(result.drift.every(({ actions }) => actions.length === 0));
  assert.equal(result.drift.some(({ state }) => state === "missing"), false);
  assert.deepEqual(
    result.drift.map(({ key, externalId, label, detail }) => ({
      key,
      externalId,
      label,
      detail,
    })),
    [
      {
        key: null,
        externalId: "unstamped-id",
        label: "Unstamped Google resource",
        detail: "This item is inside a managed setup location but has no FCI setup identity. It remains in Google.",
      },
      {
        key: "duplicate",
        externalId: "duplicate-a",
        label: "Identity-stamped Google resource",
        detail: "More than one Google resource carries the blueprint identity duplicate. Resolve the duplicate in Google before running setup again; nothing was deleted.",
      },
      {
        key: "duplicate",
        externalId: "duplicate-b",
        label: "Identity-stamped Google resource",
        detail: "More than one Google resource carries the blueprint identity duplicate. Resolve the duplicate in Google before running setup again; nothing was deleted.",
      },
      {
        key: "removed-key",
        externalId: "removed-id",
        label: "Identity-stamped Google resource",
        detail: "The Google resource still carries identity removed-key, but that key is no longer in the blueprint. It remains in Google.",
      },
      {
        key: "removed-unstamped",
        externalId: "removed-unstamped-id",
        label: "Unstamped Google resource",
        detail: "The registered Google resource is associated with former blueprint key removed-unstamped, but it does not carry that setup identity. It remains in Google.",
      },
      {
        key: "wrong-parent",
        externalId: "wrong-parent-id",
        label: "Identity-stamped Google resource",
        detail: "The identity wrong-parent is outside its blueprint parent. It remains in Google and no create or destructive action is offered.",
      },
      {
        key: "wrong-type",
        externalId: "wrong-type-id",
        label: "Identity-stamped Google resource",
        detail: "The identity wrong-type is attached to the wrong Google resource type. It remains in Google and no destructive action is offered.",
      },
    ],
  );
});

test("identity matches stay in sync while non-folder name drift is honest and non-actionable", () => {
  const desiredResources = [
    desired({ key: "folder", name: "Folder" }),
    desired({
      resourceType: "sheets.spreadsheet",
      key: "sheet",
      name: "Blueprint sheet name",
      label: "Reference spreadsheet",
    }),
    desired({
      resourceType: "drive.file",
      key: "template",
      name: "Blueprint template name",
      label: "Document template",
    }),
    desired({
      resourceType: "calendar.calendar",
      key: "calendar",
      name: "Blueprint calendar name",
      label: "Workspace calendar",
      management: "system",
    }),
  ];
  const actualResources = [
    actual({ key: "folder", name: "Folder" }),
    actual({ resourceType: "sheets.spreadsheet", key: "sheet", name: "Google sheet name", externalId: "sheet-id" }),
    actual({ resourceType: "drive.file", key: "template", name: "Google template name", externalId: "template-id" }),
    actual({
      resourceType: "calendar.calendar",
      key: "calendar",
      name: "Google calendar name",
      externalId: "calendar-id",
      parentExternalId: null,
      url: null,
    }),
  ];

  const result = deriveWorkspaceReconcileDrift(desiredResources, actualResources);

  assert.deepEqual(result.counts, {
    missing: 0,
    renamed: 3,
    unmanaged: 0,
    inSync: 1,
  });
  assert.deepEqual(
    result.drift.map(({ key, state, actions }) => ({ key, state, actions })),
    [
      { key: "calendar", state: "renamed", actions: [] },
      { key: "template", state: "renamed", actions: [] },
      { key: "sheet", state: "renamed", actions: [] },
    ],
  );
});

test("adopting an owner Google name returns a sanitized copy for folders, sheets, and templates", () => {
  const draft = structuredClone(seedWorkspaceBlueprint());
  draft.spreadsheets.push({
    key: "owner-register",
    name: "Owner Register",
    targetFolderKey: "company-admin",
    management: "owner",
    role: "reference",
  });
  const blueprint = sanitizeWorkspaceBlueprint(draft);

  const folderResult = adoptGoogleNameIntoWorkspaceBlueprint(
    blueprint,
    "drive.folder",
    "client-accounts",
    "  Customer Accounts  ",
  );
  const sheetResult = adoptGoogleNameIntoWorkspaceBlueprint(
    blueprint,
    "sheets.spreadsheet",
    "owner-register",
    "  Field Register  ",
  );
  const templateResult = adoptGoogleNameIntoWorkspaceBlueprint(
    blueprint,
    "drive.file",
    "estimate-proposal",
    "  Customer Estimate  ",
  );

  assert.equal(folderResult.drive.roots.find(({ key }) => key === "client-accounts").name, "Customer Accounts");
  assert.equal(sheetResult.spreadsheets.find(({ key }) => key === "owner-register").name, "Field Register");
  assert.equal(templateResult.templates.find(({ key }) => key === "estimate-proposal").name, "Customer Estimate");
  assert.equal(blueprint.drive.roots.find(({ key }) => key === "client-accounts").name, "01_Client Accounts");
  assert.equal(blueprint.spreadsheets.find(({ key }) => key === "owner-register").name, "Owner Register");
  assert.equal(blueprint.templates.find(({ key }) => key === "estimate-proposal").name, "Estimate Proposal");
  assert.equal(Object.isFrozen(folderResult), true);
  assert.equal(Object.isFrozen(sheetResult.spreadsheets), true);
  assert.equal(Object.isFrozen(templateResult.templates), true);
});

test("adopt-name rejects system resources, unsupported calendars, and unknown keys", () => {
  const blueprint = seedWorkspaceBlueprint();

  assert.throws(
    () => adoptGoogleNameIntoWorkspaceBlueprint(
      blueprint,
      "drive.folder",
      "unsorted-intake",
      "Owner override",
    ),
    /System-managed resource names cannot be adopted into the blueprint\./u,
  );
  assert.throws(
    () => adoptGoogleNameIntoWorkspaceBlueprint(
      blueprint,
      "sheets.spreadsheet",
      "client-directory",
      "Owner override",
    ),
    /System-managed resource names cannot be adopted into the blueprint\./u,
  );
  assert.throws(
    () => adoptGoogleNameIntoWorkspaceBlueprint(
      blueprint,
      "calendar.calendar",
      "client-appointments",
      "Owner override",
    ),
    /The selected owner-managed blueprint resource was not found\./u,
  );
  assert.throws(
    () => adoptGoogleNameIntoWorkspaceBlueprint(
      blueprint,
      "drive.file",
      "not-a-template",
      "Unknown",
    ),
    /The selected owner-managed blueprint resource was not found\./u,
  );
});
