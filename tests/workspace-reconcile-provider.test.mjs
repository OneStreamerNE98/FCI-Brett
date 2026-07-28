import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-reconcile-provider", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
const [
  { discoverWorkspaceReconcileActual },
  { deriveWorkspaceReconcileDrift, workspaceReconcileDesiredResources },
  { GoogleDriveClient },
  { GoogleCalendarClient },
] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-workspace-reconcile.ts"),
  vite.ssrLoadModule("/app/lib/workspace-reconcile.ts"),
  vite.ssrLoadModule("/app/lib/google-drive.ts"),
  vite.ssrLoadModule("/app/lib/google-calendar-client.ts"),
]);

after(async () => {
  await vite.close();
});

const FOLDER = "application/vnd.google-apps.folder";
const SHEET = "application/vnd.google-apps.spreadsheet";
const DOC = "application/vnd.google-apps.document";

function setupItem({
  id,
  name,
  mimeType = FOLDER,
  parent = "workspace-root",
  appProperties = {},
}) {
  return Object.freeze({
    id,
    name,
    mimeType,
    parents: Object.freeze(parent === null ? [] : [parent]),
    url: `https://drive.google.test/${encodeURIComponent(id)}`,
    appProperties: Object.freeze({ ...appProperties }),
  });
}

function resource({
  resourceType,
  resourceKey,
  externalId,
  parentExternalId = null,
}) {
  return Object.freeze({
    id: `registry-${resourceType}-${resourceKey}`,
    connectionKey: "workspace",
    resourceType,
    resourceKey,
    externalId,
    parentExternalId,
    externalUrl: `https://provider.test/${encodeURIComponent(externalId)}`,
    origin: "created",
    metadata: Object.freeze({ name: resourceKey }),
    createdBy: "admin@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
}

const blueprint = Object.freeze({
  business: Object.freeze({ displayName: "FCI TEST — DO NOT USE" }),
  naming: Object.freeze({
    clientFolderPattern: "{code} — {name}",
    projectFolderPattern: "{number} — {name}",
  }),
  drive: Object.freeze({
    sharedDriveName: "FCI TEST — DO NOT USE",
    roots: Object.freeze([
      Object.freeze({
        key: "company-admin",
        name: "00_Company Admin",
        management: "owner",
        children: Object.freeze([
          Object.freeze({
            key: "templates",
            name: "Templates",
            management: "owner",
            children: Object.freeze([]),
          }),
        ]),
      }),
      Object.freeze({
        key: "client-accounts",
        name: "01_Client Accounts",
        management: "owner",
        children: Object.freeze([]),
      }),
      Object.freeze({
        key: "system-root",
        name: "99_System",
        management: "system",
        children: Object.freeze([]),
      }),
    ]),
    clientFolders: Object.freeze([]),
    projectFolders: Object.freeze([]),
  }),
  spreadsheets: Object.freeze([
    Object.freeze({
      key: "client-directory",
      name: "FCI Operations Directory",
      targetFolderKey: "company-admin",
      management: "system",
      role: "system-mirror",
    }),
    Object.freeze({
      key: "missing-import",
      name: "First-run import",
      targetFolderKey: "company-admin",
      management: "owner",
      role: "import",
    }),
  ]),
  templates: Object.freeze([
    Object.freeze({
      key: "estimate-proposal",
      name: "Estimate Proposal",
      kind: "doc",
      targetFolderKey: "templates",
      management: "owner",
    }),
  ]),
  gmail: Object.freeze({ labels: Object.freeze([]) }),
  calendars: Object.freeze([
    Object.freeze({
      key: "client-appointments",
      name: "FCI Client Appointments",
      management: "system",
      defaultEventMinutes: 60,
      workingHours: Object.freeze({
        days: Object.freeze(["monday"]),
        start: "08:00",
        end: "17:00",
      }),
    }),
    Object.freeze({
      key: "field-schedule",
      name: "FCI Field Schedule",
      management: "system",
      defaultEventMinutes: 480,
      workingHours: Object.freeze({
        days: Object.freeze(["monday"]),
        start: "07:00",
        end: "17:00",
      }),
    }),
  ]),
});

test("provider discovery covers managed listings, registered resources, duplicates, moved identities, and unmanaged items", async () => {
  const companyAdmin = setupItem({
    id: "folder-company-admin",
    name: "00_Company Admin",
    appProperties: { fciRootKey: "company-admin" },
  });
  const templates = setupItem({
    id: "folder-templates",
    name: "Templates",
    parent: companyAdmin.id,
    appProperties: { fciRootKey: "templates", fciFolderKind: "templates" },
  });
  const clientAccountsA = setupItem({
    id: "folder-client-a",
    name: "01_Client Accounts",
    appProperties: { fciRootKey: "client-accounts" },
  });
  const clientAccountsB = setupItem({
    id: "folder-client-b",
    name: "01_Client Accounts duplicate",
    appProperties: { fciRootKey: "client-accounts" },
  });
  const movedSystemRoot = setupItem({
    id: "folder-system-moved",
    name: "99_System",
    parent: "outside-workspace",
    appProperties: { fciRootKey: "system-root" },
  });
  const directorySheet = setupItem({
    id: "sheet-client-directory",
    name: "Directory renamed without changing identity",
    mimeType: SHEET,
    parent: companyAdmin.id,
    appProperties: { fciResourceKind: "client-directory" },
  });
  const proposalTemplate = setupItem({
    id: "template-estimate",
    name: "Proposal renamed without changing identity",
    mimeType: DOC,
    parent: "workspace-root",
    appProperties: { fciTemplateKey: "estimate-proposal" },
  });
  const removedRoot = setupItem({
    id: "folder-removed-root",
    name: "Removed blueprint root",
    appProperties: { fciRootKey: "removed-root" },
  });
  const removedSheet = setupItem({
    id: "sheet-removed",
    name: "Removed spreadsheet",
    mimeType: SHEET,
    parent: companyAdmin.id,
    appProperties: { fciResourceKind: "removed-sheet" },
  });
  const environmentRegisteredSheet = setupItem({
    id: "sheet-env-import",
    name: "Environment-registered import sheet",
    mimeType: SHEET,
    parent: companyAdmin.id,
    appProperties: {},
  });
  const unstampedRootItem = setupItem({
    id: "root-unmanaged",
    name: "Manual root item",
    mimeType: DOC,
    appProperties: {},
  });
  const unstampedTemplateItem = setupItem({
    id: "template-unmanaged",
    name: "Manual template item",
    mimeType: DOC,
    parent: templates.id,
    appProperties: {},
  });
  const operationalProjectFolder = setupItem({
    id: "project-100",
    name: "P-100 — Operational project",
    appProperties: { fciProjectId: "project-100", fciFolderKind: "project" },
  });
  const operationalTemplateChild = setupItem({
    id: "project-template-child",
    name: "Operational child",
    parent: templates.id,
    appProperties: { fciFolderKind: "project-child" },
  });

  const calls = [];
  const drive = {
    async listSetupChildren(parentId) {
      calls.push(["children", parentId]);
      if (parentId === "workspace-root") {
        return [
          companyAdmin,
          clientAccountsA,
          clientAccountsB,
          proposalTemplate,
          removedRoot,
          unstampedRootItem,
          operationalProjectFolder,
        ];
      }
      if (parentId === templates.id) {
        return [unstampedTemplateItem, operationalTemplateChild];
      }
      throw new Error(`Unexpected setup listing for ${parentId}`);
    },
    async getSetupItem(externalId) {
      calls.push(["registered", externalId]);
      if (externalId === templates.id) return templates;
      if (externalId === movedSystemRoot.id) return movedSystemRoot;
      if (externalId === directorySheet.id) return directorySheet;
      if (externalId === "sheet-removed") return removedSheet;
      if (externalId === environmentRegisteredSheet.id) return environmentRegisteredSheet;
      throw new Error(`Unexpected registered resource read for ${externalId}`);
    },
  };
  const calendarCalls = [];
  const calendar = {
    async getCalendarMetadata(externalId) {
      calendarCalls.push(externalId);
      if (externalId === "calendar-client") {
        return Object.freeze({
          id: externalId,
          name: "Client calendar renamed",
          timeZone: "America/New_York",
          url: "https://calendar.google.test/client",
        });
      }
      if (externalId === "calendar-removed") {
        return Object.freeze({
          id: externalId,
          name: "Removed blueprint calendar",
          timeZone: "America/New_York",
          url: "https://calendar.google.test/removed",
        });
      }
      if (externalId === "calendar-field-missing") return null;
      throw new Error(`Unexpected calendar read for ${externalId}`);
    },
  };
  const calendarRegistrations = Object.freeze([
    Object.freeze({ key: "client-appointments", externalId: "calendar-client" }),
    Object.freeze({ key: "field-schedule", externalId: "calendar-field-missing" }),
    Object.freeze({ key: "removed-calendar", externalId: "calendar-removed" }),
  ]);
  const resources = Object.freeze([
    resource({
      resourceType: "drive.folder",
      resourceKey: "templates",
      externalId: templates.id,
      parentExternalId: companyAdmin.id,
    }),
    resource({
      resourceType: "drive.folder",
      resourceKey: "system-root",
      externalId: movedSystemRoot.id,
      parentExternalId: "workspace-root",
    }),
    resource({
      resourceType: "sheets.spreadsheet",
      resourceKey: "client-directory",
      externalId: directorySheet.id,
      parentExternalId: companyAdmin.id,
    }),
    resource({
      resourceType: "drive.file",
      resourceKey: "estimate-proposal",
      externalId: proposalTemplate.id,
      parentExternalId: templates.id,
    }),
    resource({
      resourceType: "sheets.spreadsheet",
      resourceKey: "removed-sheet",
      externalId: removedSheet.id,
      parentExternalId: companyAdmin.id,
    }),
  ]);

  const actual = await discoverWorkspaceReconcileActual({
    blueprint,
    rootExternalId: "workspace-root",
    resources,
    driveRegistrations: Object.freeze([Object.freeze({
      resourceType: "sheets.spreadsheet",
      key: "missing-import",
      externalId: environmentRegisteredSheet.id,
    })]),
    calendarRegistrations,
    drive,
    calendar,
  });
  const actualById = new Map(actual.map((item) => [item.externalId, item]));

  assert.deepEqual(
    calls.filter(([kind]) => kind === "children"),
    [["children", "workspace-root"], ["children", "folder-templates"]],
    "reconcile must enumerate exactly the Shared Drive root and Templates children",
  );
  assert.deepEqual(
    calls.filter(([kind]) => kind === "registered"),
    [
      ["registered", "folder-templates"],
      ["registered", "folder-system-moved"],
      ["registered", "sheet-client-directory"],
      ["registered", "sheet-removed"],
      ["registered", "sheet-env-import"],
    ],
    "root-listed resources must not be fetched twice and every other resource is read by its retained ID",
  );
  assert.deepEqual(calendarCalls, ["calendar-client", "calendar-field-missing", "calendar-removed"]);
  assert.equal(actualById.get(companyAdmin.id).key, "company-admin");
  assert.equal(actualById.get(templates.id).key, "templates");
  assert.equal(actualById.get(directorySheet.id).key, "client-directory");
  assert.equal(actualById.get(proposalTemplate.id).key, "estimate-proposal");
  assert.equal(
    actualById.get(proposalTemplate.id).validParent,
    false,
    "a template moved to the Shared Drive root must not be overwritten as in-sync by the root listing",
  );
  assert.equal(actualById.get(movedSystemRoot.id).validType, true);
  assert.equal(actualById.get(movedSystemRoot.id).validParent, false, "a moved identity is not accepted as in-sync");
  assert.equal(actualById.get(removedSheet.id).key, "removed-sheet");
  assert.equal(actualById.get(environmentRegisteredSheet.id).key, "missing-import");
  assert.equal(
    actualById.get(environmentRegisteredSheet.id).validIdentity,
    false,
    "an unstamped environment registration blocks create instead of being fabricated as an identity match",
  );
  assert.equal(actualById.get(unstampedRootItem.id).key, null);
  assert.equal(actualById.get(unstampedTemplateItem.id).key, null);
  assert.equal(actualById.get(operationalProjectFolder.id).key, null);
  assert.equal(actualById.get(operationalTemplateChild.id).key, null);
  assert.equal(actualById.has("calendar-field-missing"), false);
  assert.equal(actualById.get("calendar-removed").key, "removed-calendar");

  const desired = workspaceReconcileDesiredResources(
    blueprint,
    new Set(calendarRegistrations.map(({ key }) => key)),
  );
  const result = deriveWorkspaceReconcileDrift(desired, actual);
  assert.deepEqual(result.counts, {
    missing: 1,
    renamed: 2,
    unmanaged: 12,
    inSync: 2,
  });
  assert.deepEqual(
    result.drift.filter(({ state }) => state === "missing").map(({ key }) => key).sort(),
    ["field-schedule"],
    "provider 404/null reads must become honest missing drift",
  );
  assert.deepEqual(
    result.drift.find(({ key }) => key === "missing-import"),
    {
      id: `unmanaged:sheets.spreadsheet:missing-import:${environmentRegisteredSheet.id}`,
      state: "unmanaged",
      resourceType: "sheets.spreadsheet",
      key: "missing-import",
      label: "Unstamped Google resource",
      management: null,
      expectedName: null,
      actualName: environmentRegisteredSheet.name,
      externalId: environmentRegisteredSheet.id,
      url: environmentRegisteredSheet.url,
      detail: "The registered Google resource is missing the setup identity missing-import. It remains in Google and no create action is offered.",
      actions: [],
    },
    "an environment-only registration must block a duplicate-creating ensure action",
  );
  assert.equal(
    result.drift.filter(({ key, externalId }) => key === "client-accounts" && externalId !== null).length,
    2,
  );
  assert.equal(
    result.drift.some(({ state, key, detail }) => (
      state === "unmanaged"
      && key === "removed-sheet"
      && detail.includes("no longer in the blueprint")
    )),
    true,
  );
  assert.equal(
    result.drift.some(({ state, resourceType, key, externalId, detail }) => (
      state === "unmanaged"
      && resourceType === "calendar.calendar"
      && key === "removed-calendar"
      && externalId === "calendar-removed"
      && detail.includes("no longer in the blueprint")
    )),
    true,
    "a registered Calendar removed from the blueprint remains provider-visible as unmanaged drift",
  );
  assert.equal(result.drift.some(({ actualName }) => actualName === operationalProjectFolder.name), true);
  assert.equal(result.drift.some(({ actualName }) => actualName === operationalTemplateChild.name), true);
});

test("provider discovery bounds direct registry reads and treats a missing or trashed registered item as missing drift", async () => {
  const calls = [];
  const drive = {
    async listSetupChildren(parentId) {
      calls.push(["children", parentId]);
      return [];
    },
    async getSetupItem(externalId) {
      calls.push(["registered", externalId]);
      return null;
    },
  };
  const registration = Object.freeze({
    resourceType: "sheets.spreadsheet",
    key: "missing-import",
    externalId: "trashed-import-sheet",
  });
  const actual = await discoverWorkspaceReconcileActual({
    blueprint,
    rootExternalId: "workspace-root",
    resources: Object.freeze([]),
    driveRegistrations: Object.freeze([registration]),
    calendarRegistrations: Object.freeze([]),
    drive,
    calendar: null,
  });
  const result = deriveWorkspaceReconcileDrift(
    workspaceReconcileDesiredResources(blueprint),
    actual,
  );
  assert.equal(result.drift.find(({ key }) => key === "missing-import").state, "missing");
  assert.deepEqual(calls, [
    ["children", "workspace-root"],
    ["registered", "trashed-import-sheet"],
  ]);

  let providerCalled = false;
  await assert.rejects(
    () => discoverWorkspaceReconcileActual({
      blueprint,
      rootExternalId: "workspace-root",
      resources: Object.freeze([]),
      driveRegistrations: Object.freeze(Array.from({ length: 201 }, (_, index) => Object.freeze({
        resourceType: "drive.file",
        key: `removed-${index}`,
        externalId: `registered-${index}`,
      }))),
      calendarRegistrations: Object.freeze([]),
      drive: {
        async listSetupChildren() {
          providerCalled = true;
          return [];
        },
        async getSetupItem() {
          providerCalled = true;
          return null;
        },
      },
      calendar: null,
    }),
    (error) => {
      assert.equal(error.code, "drive_reconcile_read_limit");
      return true;
    },
  );
  assert.equal(providerCalled, false, "an oversized registry must fail before any provider request");
});

test("Google Drive setup readers paginate exact read-only queries and treat files.get 404 as absence", async () => {
  const requests = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    requests.push({ url, method, body: init.body });
    assert.equal(method, "GET");
    assert.equal(init.body, undefined);

    if (url.pathname === "/drive/v3/files" && url.searchParams.get("q")?.includes("in parents")) {
      if (!url.searchParams.has("pageToken")) {
        return Response.json({
          files: [{
            id: "child-one",
            name: "Child one",
            mimeType: DOC,
            parents: ["workspace-root"],
            trashed: false,
            appProperties: {},
          }],
          nextPageToken: "children-page-2",
        });
      }
      assert.equal(url.searchParams.get("pageToken"), "children-page-2");
      return Response.json({
        files: [{
          id: "child-two",
          name: "Child two",
          mimeType: DOC,
          parents: ["workspace-root"],
          trashed: false,
          appProperties: {},
        }],
      });
    }
    if (url.pathname === "/drive/v3/files" && url.searchParams.get("q")?.includes("appProperties")) {
      if (!url.searchParams.has("pageToken")) {
        return Response.json({
          files: [{
            id: "identity-one",
            name: "Identity one",
            mimeType: FOLDER,
            parents: ["workspace-root"],
            trashed: false,
            appProperties: { fciRootKey: "client's-root" },
          }],
          nextPageToken: "identity-page-2",
        });
      }
      assert.equal(url.searchParams.get("pageToken"), "identity-page-2");
      return Response.json({
        files: [{
          id: "identity-two",
          name: "Identity two",
          mimeType: FOLDER,
          parents: ["workspace-root"],
          trashed: false,
          appProperties: { fciRootKey: "client's-root" },
        }],
      });
    }
    if (url.pathname === "/drive/v3/files/registered-sheet") {
      return Response.json({
        id: "registered-sheet",
        name: "Registered sheet",
        mimeType: SHEET,
        parents: ["workspace-root"],
        trashed: false,
        appProperties: {
          fciResourceKind: "client-directory",
          ignoredProviderData: "not retained by reconcile",
        },
      });
    }
    if (url.pathname === "/drive/v3/files/trashed-sheet") {
      return Response.json({
        id: "trashed-sheet",
        name: "Trashed registered sheet",
        mimeType: SHEET,
        parents: ["workspace-root"],
        trashed: true,
        appProperties: { fciResourceKind: "client-directory" },
      });
    }
    if (url.pathname === "/drive/v3/files/missing-sheet") {
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    }
    throw new Error(`Unexpected Drive request: ${url}`);
  };
  const client = new GoogleDriveClient("test-token", {
    drive: { mode: "shared-drive", rootFolderId: "workspace-root" },
  }, fetcher);

  const children = await client.listSetupChildren("workspace-root");
  const identities = await client.findSetupItemsByIdentity("fciRootKey", "client's-root");
  const registered = await client.getSetupItem("registered-sheet");
  const missing = await client.getSetupItem("missing-sheet");
  const trashed = await client.getSetupItem("trashed-sheet");

  assert.deepEqual(children.map(({ id }) => id), ["child-one", "child-two"]);
  assert.deepEqual(identities.map(({ id }) => id), ["identity-one", "identity-two"]);
  assert.equal(registered.id, "registered-sheet");
  assert.deepEqual(registered.appProperties, { fciResourceKind: "client-directory" });
  assert.equal(missing, null);
  assert.equal(trashed, null, "a well-formed trashed registry row is honest absence, not a provider abort");
  const listRequests = requests.filter(({ url }) => url.pathname === "/drive/v3/files");
  assert.equal(listRequests.length, 4);
  for (const { url } of listRequests) {
    assert.equal(url.searchParams.get("pageSize"), "100");
    assert.equal(url.searchParams.get("supportsAllDrives"), "true");
    assert.equal(url.searchParams.get("includeItemsFromAllDrives"), "true");
    assert.equal(url.searchParams.get("corpora"), "drive");
    assert.equal(url.searchParams.get("driveId"), "workspace-root");
    assert.match(
      url.searchParams.get("fields"),
      /^nextPageToken,files\(id,name,mimeType,parents,trashed,webViewLink,appProperties\)$/u,
    );
  }
  const childQueries = listRequests
    .map(({ url }) => url.searchParams.get("q"))
    .filter((query) => query.includes("in parents"));
  assert.deepEqual(childQueries, [
    "'workspace-root' in parents and trashed = false",
    "'workspace-root' in parents and trashed = false",
  ]);
  const identityQueries = listRequests
    .map(({ url }) => url.searchParams.get("q"))
    .filter((query) => query.includes("appProperties"));
  assert.deepEqual(identityQueries, [
    "trashed = false and appProperties has { key='fciRootKey' and value='client\\'s-root' }",
    "trashed = false and appProperties has { key='fciRootKey' and value='client\\'s-root' }",
  ]);
  assert.equal(requests.every(({ method, body }) => method === "GET" && body === undefined), true);
});

test("Google Drive setup readers fail closed on page, total-item, provider-name, and recognized-identity bounds", async () => {
  const config = {
    drive: { mode: "shared-drive", rootFolderId: "workspace-root" },
  };

  let pageRequest = 0;
  const tooManyPages = new GoogleDriveClient("test-token", config, async () => {
    pageRequest += 1;
    return Response.json({
      files: [],
      nextPageToken: `page-${pageRequest + 1}`,
    });
  });
  await assert.rejects(
    () => tooManyPages.listSetupChildren("workspace-root"),
    (error) => {
      assert.equal(error.code, "drive_list_incomplete");
      return true;
    },
  );
  assert.equal(pageRequest, 10, "the provider page bound must fail without reading an eleventh page");

  let itemPage = 0;
  const totalItemBound = new GoogleDriveClient("test-token", config, async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/drive/v3/files") {
      itemPage += 1;
      const files = Array.from({ length: 100 }, (_, index) => ({
        id: `bounded-${itemPage}-${index}`,
        name: `Bounded item ${itemPage}-${index}`,
        mimeType: DOC,
        parents: ["workspace-root"],
        trashed: false,
        appProperties: {},
      }));
      return Response.json({
        files,
        ...(itemPage % 5 === 0 ? {} : { nextPageToken: `items-${itemPage + 1}` }),
      });
    }
    if (url.pathname === "/drive/v3/files/one-more") {
      return Response.json({
        id: "one-more",
        name: "One more registered item",
        mimeType: DOC,
        parents: ["workspace-root"],
        trashed: false,
        appProperties: {},
      });
    }
    throw new Error(`Unexpected Drive request: ${url}`);
  });
  assert.equal((await totalItemBound.listSetupChildren("workspace-root")).length, 500);
  assert.equal((await totalItemBound.listSetupChildren("workspace-root")).length, 500);
  await assert.rejects(
    () => totalItemBound.getSetupItem("one-more"),
    (error) => {
      assert.equal(error.code, "drive_reconcile_read_limit");
      return true;
    },
  );

  const invalidMetadata = new GoogleDriveClient("test-token", config, async (input) => {
    const id = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1));
    return Response.json({
      id,
      name: id === "long-name" ? "x".repeat(181) : "Provider item",
      mimeType: DOC,
      parents: ["workspace-root"],
      trashed: false,
      appProperties: id === "bad-identity" ? { fciTemplateKey: " padded-key " } : {},
    });
  });
  await assert.rejects(
    () => invalidMetadata.getSetupItem("long-name"),
    (error) => {
      assert.equal(error.code, "drive_invalid_response");
      return true;
    },
  );
  await assert.rejects(
    () => invalidMetadata.getSetupItem("bad-identity"),
    (error) => {
      assert.equal(error.code, "drive_invalid_response");
      return true;
    },
  );
});

test("Google Calendar metadata uses one bounded events GET allowed by the existing scope and maps provider 404 to null", async () => {
  const requests = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, method: init.method ?? "GET", body: init.body });
    if (url.pathname.endsWith("/calendars/missing%40example.com/events")) {
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    }
    return Response.json({
      summary: "FCI Appointments",
      timeZone: "America/New_York",
      items: [],
    });
  };
  const client = new GoogleCalendarClient("test-token", {
    enabledServices: ["calendar"],
    oauthReady: true,
  }, {
    fetch: fetcher,
    now: () => new Date("2026-07-25T12:00:00.000Z"),
  });

  const found = await client.getCalendarMetadata("appointments@example.com");
  const missing = await client.getCalendarMetadata("missing@example.com");

  assert.deepEqual(found, {
    id: "appointments@example.com",
    name: "FCI Appointments",
    timeZone: "America/New_York",
    url: "https://calendar.google.com/calendar/u/0?cid=appointments%40example.com",
  });
  assert.equal(missing, null);
  assert.equal(requests.length, 2);
  for (const { url, method, body } of requests) {
    assert.equal(method, "GET");
    assert.equal(body, undefined);
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.match(url.pathname, /\/calendars\/[^/]+\/events$/u);
    assert.equal(url.searchParams.get("maxResults"), "1");
    assert.equal(url.searchParams.get("showDeleted"), "false");
    assert.equal(url.searchParams.get("fields"), "summary,timeZone,items(id)");
  }
});
