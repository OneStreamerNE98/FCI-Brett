import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-drive-client", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24736 } },
});
const [{ GoogleDriveClient }, { seedWorkspaceBlueprint }] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-drive.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
]);

after(async () => {
  await vite.close();
});

function config(rootFolderId = "shared-drive-root") {
  return {
    drive: { mode: "shared-drive", rootFolderId },
  };
}

function inMemoryDriveProvider(initialFiles) {
  const files = new Map(initialFiles.map((file) => [file.id, structuredClone(file)]));
  const calls = [];
  let nextId = 1;
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const parentId = query.match(/^'([^']+)' in parents/u)?.[1];
      const name = query.match(/name = '([^']+)'/u)?.[1];
      const propertyFilters = [...query.matchAll(/key='([^']+)' and value='([^']+)'/gu)]
        .map((match) => [match[1], match[2]]);
      const matches = [...files.values()].filter((file) => (
        !file.trashed
        && file.mimeType === "application/vnd.google-apps.folder"
        && (parentId === undefined || file.parents?.includes(parentId))
        && (name === undefined || file.name === name)
        && propertyFilters.every(([key, value]) => file.appProperties?.[key] === value)
      ));
      return Response.json({ files: matches });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const file = {
        id: `created-folder-${nextId++}`,
        name: body.name,
        mimeType: body.mimeType,
        parents: body.parents,
        trashed: false,
        webViewLink: `https://drive.google.test/created-folder-${nextId - 1}`,
        appProperties: body.appProperties ?? {},
      };
      files.set(file.id, file);
      return Response.json(file);
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/u)?.[1];
    if (fileId && method === "GET") {
      const file = files.get(decodeURIComponent(fileId));
      return file
        ? Response.json(file)
        : Response.json({ error: { message: "missing" } }, { status: 404 });
    }
    if (fileId && method === "PATCH") {
      const file = files.get(decodeURIComponent(fileId));
      if (!file) return Response.json({ error: { message: "missing" } }, { status: 404 });
      const nextProperties = { ...(file.appProperties ?? {}) };
      for (const [key, value] of Object.entries(body.appProperties ?? {})) {
        if (value === null) delete nextProperties[key];
        else nextProperties[key] = value;
      }
      Object.assign(file, { appProperties: nextProperties });
      return Response.json(file);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return {
    calls,
    files,
    fetcher,
    children(parentId) {
      return [...files.values()].filter((file) => file.parents?.includes(parentId));
    },
  };
}

test("Drive client gets and exhaustively finds Shared Drives with restriction flags", async () => {
  const calls = [];
  let listPage = 0;
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith("/drives/shared-drive-root")) {
      return Response.json({
        id: "shared-drive-root",
        name: "FCI Operations",
        restrictions: { domainUsersOnly: true, driveMembersOnly: true },
      });
    }
    if (url.pathname.endsWith("/drives")) {
      listPage += 1;
      if (listPage === 1) {
        return Response.json({
          nextPageToken: "next-page",
          drives: [{ id: "drive-one", name: "FCI Operations", restrictions: { domainUsersOnly: true } }],
        });
      }
      assert.equal(url.searchParams.get("pageToken"), "next-page");
      return Response.json({
        drives: [{ id: "drive-two", name: "FCI Operations", restrictions: { domainUsersOnly: false } }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const exact = await client.getSharedDrive("shared-drive-root");
  assert.equal(exact.id, "shared-drive-root");
  assert.equal(exact.restrictions.domainUsersOnly, true);
  assert.equal(exact.restrictions.copyRequiresWriterPermission, null);

  const matches = await client.findSharedDriveByName("FCI Operations");
  assert.deepEqual(matches.map((drive) => drive.id), ["drive-one", "drive-two"]);
  const listCalls = calls.filter((call) => call.url.pathname.endsWith("/drives"));
  assert.equal(listCalls.length, 2);
  assert.equal(listCalls[0].url.searchParams.get("pageSize"), "100");
  assert.equal(listCalls[0].url.searchParams.get("q"), "name = 'FCI Operations'");
  assert.ok(calls.every((call) => (call.init.method ?? "GET") !== "DELETE"));
});

test("blueprint folder ensure looks up identity before name, adopts and stamps once, then is idempotent", async () => {
  const calls = [];
  let stamped = false;
  const folder = () => ({
    id: "manual-company-admin",
    name: "00_Company Admin",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
    webViewLink: "https://drive.google.test/manual-company-admin",
    appProperties: stamped ? { fciRootKey: "company-admin" } : {},
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, init, method });
    if (url.pathname.endsWith("/files") && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("appProperties has")) return Response.json({ files: stamped ? [folder()] : [] });
      if (query.includes("name = '00_Company Admin'")) return Response.json({ files: [folder()] });
    }
    if (url.pathname.endsWith("/files/manual-company-admin") && method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body, { appProperties: { fciRootKey: "company-admin" } });
      stamped = true;
      return Response.json(folder());
    }
    if (url.pathname.endsWith("/files/manual-company-admin") && method === "GET") return Response.json(folder());
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const first = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "company-admin",
    name: "00_Company Admin",
    reuseByName: true,
  });
  assert.equal(first.outcome, "adopted");
  assert.equal(stamped, true);

  const callsAfterFirst = calls.length;
  const second = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "company-admin",
    name: "00_Company Admin",
    reuseByName: true,
  });
  assert.equal(second.outcome, "found");
  const secondCalls = calls.slice(callsAfterFirst);
  assert.equal(secondCalls.length, 1);
  assert.match(secondCalls[0].url.searchParams.get("q"), /appProperties has/u);
  assert.doesNotMatch(secondCalls[0].url.searchParams.get("q"), /name =/u);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.ok(calls.every((call) => call.method !== "DELETE"));
});

test("blueprint folder ensure repairs supplemental appProperties without duplicate creation", async () => {
  const calls = [];
  let appProperties = { fciRootKey: "templates" };
  const folder = () => ({
    id: "templates-folder",
    name: "03_Templates",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
    webViewLink: "https://drive.google.test/templates-folder",
    appProperties,
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, init, method });
    if (url.pathname.endsWith("/files") && method === "GET") {
      assert.match(url.searchParams.get("q"), /fciRootKey/u);
      return Response.json({ files: [folder()] });
    }
    if (url.pathname.endsWith("/files/templates-folder") && method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body, {
        appProperties: { fciRootKey: "templates", fciFolderKind: "templates" },
      });
      appProperties = body.appProperties;
      return Response.json(folder());
    }
    if (url.pathname.endsWith("/files/templates-folder") && method === "GET") return Response.json(folder());
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const first = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "templates",
    name: "03_Templates",
    reuseByName: true,
    appProperties: { fciRootKey: "ignored-caller-value", fciFolderKind: "templates" },
  });
  assert.equal(first.outcome, "adopted");
  assert.deepEqual(appProperties, { fciRootKey: "templates", fciFolderKind: "templates" });

  const second = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "templates",
    name: "03_Templates",
    reuseByName: true,
    appProperties: { fciFolderKind: "templates" },
  });
  assert.equal(second.outcome, "found");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 0);
});

test("folder rename is contained, bounded to PATCH metadata, and confirms the provider response", async () => {
  const calls = [];
  let name = "01_Client Accounts";
  const folder = () => ({
    id: "client-accounts-id",
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
    appProperties: { fciRootKey: "client-accounts" },
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, init, method });
    if (url.pathname.endsWith("/files/client-accounts-id") && method === "GET") return Response.json(folder());
    if (url.pathname.endsWith("/files/client-accounts-id") && method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body, { name: "01_Custom Clients" });
      name = body.name;
      return Response.json(folder());
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const renamed = await client.renameFolder("client-accounts-id", "01_Custom Clients");
  assert.equal(renamed.previousName, "01_Client Accounts");
  assert.equal(renamed.folder.name, "01_Custom Clients");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.ok(calls.every((call) => call.url.searchParams.get("supportsAllDrives") === "true"));
  assert.ok(calls.every((call) => call.method !== "DELETE"));
});

test("same-name reuse never steals a different blueprint folder identity", async () => {
  const calls = [];
  const conflicting = {
    id: "already-managed-folder",
    name: "03_Duplicate Name",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
    appProperties: { fciRootKey: "first-sibling" },
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.pathname.endsWith("/files") && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("appProperties has")) return Response.json({ files: [] });
      if (query.includes("name = '03_Duplicate Name'")) return Response.json({ files: [conflicting] });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  await assert.rejects(
    client.ensureBlueprintFolder({
      parentId: "shared-drive-root",
      key: "second-sibling",
      name: "03_Duplicate Name",
      reuseByName: true,
    }),
    (error) => error.code === "drive_folder_identity_conflict" && error.status === 409,
  );
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

test("legacy provisioning roots are found after a rename and canonicalized without creating a duplicate", async () => {
  const provider = inMemoryDriveProvider([
    {
      id: "shared-drive-root",
      name: "FCI Operations",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
      trashed: false,
      appProperties: {},
    },
    {
      id: "legacy-client-accounts",
      name: "01_Renamed Client Accounts",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["shared-drive-root"],
      trashed: false,
      appProperties: { fciWorkspaceFolder: "client-accounts" },
    },
  ]);
  const client = new GoogleDriveClient("test-token", config(), provider.fetcher);

  const first = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "client-accounts",
    name: "01_Renamed Client Accounts",
    reuseByName: true,
  });
  assert.equal(first.outcome, "adopted");
  assert.equal(first.folder.id, "legacy-client-accounts");
  assert.deepEqual(provider.files.get("legacy-client-accounts").appProperties, { fciRootKey: "client-accounts" });

  const second = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "client-accounts",
    name: "01_Renamed Client Accounts",
    reuseByName: true,
  });
  assert.equal(second.outcome, "found");
  assert.equal(second.folder.id, "legacy-client-accounts");

  const patches = provider.calls.filter((call) => call.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].body, {
    appProperties: { fciWorkspaceFolder: null, fciRootKey: "client-accounts" },
  });
  assert.equal(provider.calls.some((call) => call.method === "POST"), false);
  assert.equal(provider.calls.some((call) => call.method === "DELETE"), false);
});

test("canonical and legacy provisioning roots with the same key fail closed as a duplicate", async () => {
  const provider = inMemoryDriveProvider([
    {
      id: "shared-drive-root",
      name: "FCI Operations",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
      trashed: false,
      appProperties: {},
    },
    {
      id: "canonical-client-accounts",
      name: "01_Canonical Clients",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["shared-drive-root"],
      trashed: false,
      appProperties: { fciRootKey: "client-accounts" },
    },
    {
      id: "legacy-client-accounts",
      name: "01_Legacy Clients",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["shared-drive-root"],
      trashed: false,
      appProperties: { fciWorkspaceFolder: "client-accounts" },
    },
  ]);
  const client = new GoogleDriveClient("test-token", config(), provider.fetcher);

  await assert.rejects(
    client.ensureBlueprintFolder({
      parentId: "shared-drive-root",
      key: "client-accounts",
      name: "01_Current Clients",
      reuseByName: true,
    }),
    (error) => error?.code === "duplicate_drive_folder" && error?.status === 409,
  );
  assert.equal(provider.calls.some((call) => ["POST", "PATCH", "DELETE"].includes(call.method)), false);
});

test("blueprint folder identity writes fail closed when Google drops canonical appProperties", async (t) => {
  await t.test("name-adoption PATCH", async () => {
    const manual = {
      id: "manual-client-accounts",
      name: "01_Current Clients",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["shared-drive-root"],
      trashed: false,
      appProperties: {},
    };
    const fetcher = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      if (url.pathname === "/drive/v3/files" && method === "GET") {
        const query = url.searchParams.get("q") ?? "";
        return Response.json({ files: query.includes("name = '01_Current Clients'") ? [manual] : [] });
      }
      if (url.pathname === "/drive/v3/files/manual-client-accounts" && method === "PATCH") {
        return Response.json(manual);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    };
    const client = new GoogleDriveClient("test-token", config(), fetcher);
    await assert.rejects(
      client.ensureBlueprintFolder({
        parentId: "shared-drive-root",
        key: "client-accounts",
        name: "01_Current Clients",
      }),
      (error) => error?.code === "invalid_drive_folder" && error?.status === 503,
    );
  });

  await t.test("new-folder POST", async () => {
    let created = null;
    const fetcher = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      if (url.pathname === "/drive/v3/files" && method === "GET") return Response.json({ files: [] });
      if (url.pathname === "/drive/v3/files" && method === "POST") {
        const body = JSON.parse(String(init.body));
        created = {
          id: "created-without-identity",
          name: body.name,
          mimeType: body.mimeType,
          parents: body.parents,
          trashed: false,
          appProperties: {},
        };
        return Response.json(created);
      }
      if (url.pathname === "/drive/v3/files/created-without-identity" && method === "GET") {
        return Response.json(created);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    };
    const client = new GoogleDriveClient("test-token", config(), fetcher);
    await assert.rejects(
      client.ensureBlueprintFolder({
        parentId: "shared-drive-root",
        key: "client-accounts",
        name: "01_Current Clients",
      }),
      (error) => error?.code === "drive_create_invalid_response" && error?.status === 503,
    );
  });
});

test("simulated Drive provider provisions beneath renamed roots from the persisted project blueprint", async () => {
  const blueprint = structuredClone(seedWorkspaceBlueprint());
  blueprint.drive.roots.find((folder) => folder.key === "client-accounts").name = "01_Renamed Client Accounts";
  blueprint.drive.roots.find((folder) => folder.key === "projects").name = "02_Renamed Projects";
  blueprint.drive.projectFolders.find((folder) => folder.key === "lead-proposal").name = "01_Custom Lead Package";
  blueprint.drive.projectFolders.push({
    key: "field-notes",
    name: "07_Field Notes",
    management: "owner",
    children: [{ key: "daily-logs", name: "Daily Logs", management: "owner", children: [] }],
  });
  const provider = inMemoryDriveProvider([
    {
      id: "shared-drive-root",
      name: "FCI Operations",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
      trashed: false,
      appProperties: {},
    },
    {
      id: "client-accounts-root",
      name: "01_Renamed Client Accounts",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["shared-drive-root"],
      trashed: false,
      appProperties: { fciRootKey: "client-accounts" },
    },
    {
      id: "projects-root",
      name: "02_Renamed Projects",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["shared-drive-root"],
      trashed: false,
      appProperties: { fciRootKey: "projects" },
    },
  ]);
  const client = new GoogleDriveClient("test-token", config(), provider.fetcher);

  const provisioned = await client.provisionProjectFolders({
    client: { id: "client-1", code: "FCI TEST", name: "DO NOT USE" },
    project: { id: "project-1", number: "FCI2026-001", name: "FCI TEST — DO NOT USE", year: "2026" },
    blueprint,
  });

  assert.equal(provider.files.get(provisioned.clientFolder.id).parents[0], "client-accounts-root");
  const yearFolder = provider.children("projects-root").find((folder) => folder.name === "2026");
  assert.ok(yearFolder);
  assert.equal(provider.files.get(provisioned.projectFolder.id).parents[0], yearFolder.id);
  const projectChildren = provider.children(provisioned.projectFolder.id);
  assert.ok(projectChildren.some((folder) => folder.name === "01_Custom Lead Package"));
  assert.equal(projectChildren.some((folder) => folder.name === "01_Lead & Proposal"), false);
  const fieldNotes = projectChildren.find((folder) => folder.name === "07_Field Notes");
  assert.ok(fieldNotes);
  assert.ok(provider.children(fieldNotes.id).some((folder) => folder.name === "Daily Logs"));
  assert.deepEqual(
    provider.children("shared-drive-root").map((folder) => folder.id).sort(),
    ["client-accounts-root", "projects-root"],
  );
  assert.equal(provider.calls.some((call) => call.method === "POST" && ["01_Client Accounts", "02_Projects"].includes(call.body?.name)), false);
  assert.equal(provider.calls.some((call) => call.method === "DELETE"), false);
});

test("project provisioning creates missing blueprint roots with only canonical fciRootKey identities", async () => {
  const blueprint = structuredClone(seedWorkspaceBlueprint());
  const provider = inMemoryDriveProvider([{
    id: "shared-drive-root",
    name: "FCI Operations",
    mimeType: "application/vnd.google-apps.folder",
    parents: [],
    trashed: false,
    appProperties: {},
  }]);
  const client = new GoogleDriveClient("test-token", config(), provider.fetcher);

  await client.provisionProjectFolders({
    client: { id: "client-2", code: "FCI TEST", name: "DO NOT USE" },
    project: { id: "project-2", number: "FCI2026-002", name: "FCI TEST — DO NOT USE", year: "2026" },
    blueprint,
  });

  const rootCreates = provider.calls.filter((call) => (
    call.method === "POST" && call.body?.parents?.[0] === "shared-drive-root"
  ));
  assert.deepEqual(rootCreates.map((call) => call.body.name).sort(), ["01_Client Accounts", "02_Projects"]);
  assert.deepEqual(rootCreates.map((call) => call.body.appProperties), [
    { fciRootKey: "client-accounts" },
    { fciRootKey: "projects" },
  ]);
  assert.ok(rootCreates.every((call) => !("fciWorkspaceFolder" in call.body.appProperties)));
  assert.equal(provider.calls.some((call) => call.method === "DELETE"), false);
});

test("project provisioning fails before provider access when a required blueprint root is absent", async () => {
  const blueprint = structuredClone(seedWorkspaceBlueprint());
  blueprint.drive.roots = blueprint.drive.roots.filter((folder) => folder.key !== "projects");
  const calls = [];
  const client = new GoogleDriveClient("test-token", config(), async (input, init = {}) => {
    calls.push({ input, init });
    throw new Error("The provider must not be called for an invalid provisioning blueprint.");
  });

  await assert.rejects(
    client.provisionProjectFolders({
      client: { id: "client-1", code: "FCI TEST", name: "DO NOT USE" },
      project: { id: "project-1", number: "FCI2026-001", name: "FCI TEST — DO NOT USE", year: "2026" },
      blueprint,
    }),
    (error) => error?.code === "workspace_blueprint_root_missing" && error?.status === 409,
  );
  assert.equal(calls.length, 0);
});

test("project provisioning is wired to effective setup and has no static root or project-folder seed reads", async () => {
  const [driveSource, routeSource] = await Promise.all([
    readFile(new URL("../app/lib/google-drive.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/projects/[projectId]/drive/route.ts", import.meta.url), "utf8"),
  ]);
  const provisionSource = driveSource.slice(driveSource.indexOf("async provisionProjectFolders"));

  assert.doesNotMatch(provisionSource, /01_Client Accounts|02_Projects|DRIVE_BLUEPRINT/u);
  assert.match(driveSource, /blueprint\.drive\.roots/u);
  assert.match(driveSource, /blueprint\.drive\.projectFolders/u);
  assert.match(provisionSource, /buildProjectDriveBlueprintPlan\(input\.blueprint\)/u);
  assert.match(provisionSource, /blueprintPlan\.projectFolderPaths/u);
  assert.match(routeSource, /getEffectiveGoogleRuntimeSetup/u);
  assert.match(routeSource, /const \{ config, blueprint, resources \} = setup/u);
  assert.match(routeSource, /blueprint,\s*\n\s*\}\);/u);
});

test("blueprint spreadsheet ensure searches the Shared Drive identity, creates with appProperties, and is idempotent after a move", async () => {
  const calls = [];
  let created = false;
  const spreadsheet = () => ({
    id: "sheet-client-directory",
    name: "FCI Operations Directory",
    mimeType: "application/vnd.google-apps.spreadsheet",
    parents: [created ? "archive-folder" : "company-admin-folder"],
    trashed: false,
    webViewLink: "https://docs.google.test/sheet-client-directory",
    appProperties: { fciResourceKind: "client-directory" },
  });
  const folder = {
    id: "company-admin-folder",
    name: "00_Company Admin",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, init, method });
    if (url.pathname.endsWith("/files/company-admin-folder") && method === "GET") return Response.json(folder);
    if (url.pathname.endsWith("/files") && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      assert.match(query, /fciResourceKind/u);
      assert.match(query, /client-directory/u);
      assert.doesNotMatch(query, /in parents/u);
      assert.equal(url.searchParams.get("corpora"), "drive");
      return Response.json({ files: created ? [spreadsheet()] : [] });
    }
    if (url.pathname.endsWith("/files") && method === "POST") {
      assert.equal(url.searchParams.get("supportsAllDrives"), "true");
      assert.equal(url.searchParams.get("corpora"), null);
      assert.deepEqual(JSON.parse(String(init.body)), {
        name: "FCI Operations Directory",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: ["company-admin-folder"],
        appProperties: { fciResourceKind: "client-directory" },
      });
      created = true;
      return Response.json({ ...spreadsheet(), parents: ["company-admin-folder"] });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const first = await client.ensureBlueprintSpreadsheet({
    parentId: "company-admin-folder",
    key: "client-directory",
    name: "FCI Operations Directory",
  });
  assert.equal(first.created, true);
  assert.equal(first.file.appProperties.fciResourceKind, "client-directory");

  const second = await client.ensureBlueprintSpreadsheet({
    parentId: "company-admin-folder",
    key: "client-directory",
    name: "FCI Operations Directory",
  });
  assert.equal(second.created, false);
  assert.deepEqual(second.file.parents, ["archive-folder"]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.ok(calls.every((call) => call.method !== "DELETE"));
});

test("blueprint spreadsheet reuse accepts a stamped file contained inside the configured My Drive root", async () => {
  const calls = [];
  const folders = new Map([
    ["managed-folder", {
      id: "managed-folder",
      name: "00_Company Admin",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["managed-root"],
      trashed: false,
    }],
    ["inside-folder", {
      id: "inside-folder",
      name: "Managed archive",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["managed-root"],
      trashed: false,
    }],
  ]);
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      return Response.json({ files: [{
        id: "sheet-client-directory",
        name: "FCI Operations Directory",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: ["inside-folder"],
        trashed: false,
        appProperties: { fciResourceKind: "client-directory" },
      }] });
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/u)?.[1];
    if (fileId && method === "GET" && folders.has(decodeURIComponent(fileId))) {
      return Response.json(folders.get(decodeURIComponent(fileId)));
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", {
    drive: { mode: "my-drive", rootFolderId: "managed-root" },
  }, fetcher);

  const ensured = await client.ensureBlueprintSpreadsheet({
    parentId: "managed-folder",
    key: "client-directory",
    name: "FCI Operations Directory",
  });
  assert.equal(ensured.created, false);
  assert.equal(ensured.file.id, "sheet-client-directory");
  assert.equal(calls.some((call) => ["POST", "PATCH", "DELETE"].includes(call.method)), false);
});

test("blueprint spreadsheet reuse rejects a stamped file moved outside the configured My Drive root", async () => {
  const calls = [];
  const folders = new Map([
    ["managed-folder", {
      id: "managed-folder",
      name: "00_Company Admin",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["managed-root"],
      trashed: false,
    }],
    ["outside-folder", {
      id: "outside-folder",
      name: "Outside FCI",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["other-root"],
      trashed: false,
    }],
    ["other-root", {
      id: "other-root",
      name: "Other root",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
      trashed: false,
    }],
  ]);
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      assert.equal(url.searchParams.get("corpora"), null);
      return Response.json({ files: [{
        id: "sheet-client-directory",
        name: "FCI Operations Directory",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: ["outside-folder"],
        trashed: false,
        appProperties: { fciResourceKind: "client-directory" },
      }] });
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/u)?.[1];
    if (fileId && method === "GET" && folders.has(decodeURIComponent(fileId))) {
      return Response.json(folders.get(decodeURIComponent(fileId)));
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", {
    drive: { mode: "my-drive", rootFolderId: "managed-root" },
  }, fetcher);

  await assert.rejects(
    client.ensureBlueprintSpreadsheet({
      parentId: "managed-folder",
      key: "client-directory",
      name: "FCI Operations Directory",
    }),
    (error) => error?.code === "drive_root_escape" && error?.status === 409,
  );
  assert.equal(calls.some((call) => ["POST", "PATCH", "DELETE"].includes(call.method)), false);
});

test("blueprint spreadsheet ensure rejects duplicate identities and wrong MIME types", async (t) => {
  const folder = {
    id: "company-admin-folder",
    name: "00_Company Admin",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
  };
  for (const fixture of [
    {
      name: "duplicates",
      files: [
        { id: "sheet-one", name: "One", mimeType: "application/vnd.google-apps.spreadsheet", appProperties: { fciResourceKind: "client-directory" } },
        { id: "sheet-two", name: "Two", mimeType: "application/vnd.google-apps.spreadsheet", appProperties: { fciResourceKind: "client-directory" } },
      ],
      code: "duplicate_drive_file",
    },
    {
      name: "wrong MIME",
      files: [{ id: "doc-one", name: "One", mimeType: "application/vnd.google-apps.document", appProperties: { fciResourceKind: "client-directory" } }],
      code: "invalid_blueprint_spreadsheet",
    },
  ]) {
    await t.test(fixture.name, async () => {
      const fetcher = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/files/company-admin-folder")) return Response.json(folder);
        if (url.pathname.endsWith("/files")) return Response.json({ files: fixture.files });
        throw new Error(`Unexpected request: ${url}`);
      };
      const client = new GoogleDriveClient("test-token", config(), fetcher);
      await assert.rejects(
        client.ensureBlueprintSpreadsheet({ parentId: "company-admin-folder", key: "client-directory", name: "Directory" }),
        (error) => error.code === fixture.code && error.status === 409,
      );
    });
  }
});

test("managed file upload separates Google-native metadata MIME from media MIME and remains idempotent", async () => {
  const calls = [];
  const source = "<!doctype html><title>Estimate proposal</title>";
  const bytes = new TextEncoder().encode(source);
  let uploaded = false;
  const managedFile = () => ({
    id: "template-estimate-proposal",
    name: "Estimate Proposal",
    mimeType: "application/vnd.google-apps.document",
    parents: ["shared-drive-root"],
    trashed: false,
    webViewLink: "https://docs.google.test/template-estimate-proposal",
    appProperties: { fciTemplateKey: "estimate-proposal" },
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, init, method });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      assert.match(url.searchParams.get("q"), /fciTemplateKey/u);
      assert.match(url.searchParams.get("q"), /estimate-proposal/u);
      return Response.json({ files: uploaded ? [managedFile()] : [] });
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      assert.equal(url.searchParams.get("uploadType"), "multipart");
      assert.equal(url.searchParams.get("supportsAllDrives"), "true");
      const contentType = init.headers["Content-Type"];
      const boundary = contentType.match(/^multipart\/related; boundary=(.+)$/u)?.[1];
      assert.ok(boundary);
      assert.ok(init.body instanceof Blob);
      const body = new TextDecoder().decode(await init.body.arrayBuffer());
      assert.equal(body, [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify({
          name: "Estimate Proposal",
          mimeType: "application/vnd.google-apps.document",
          parents: ["shared-drive-root"],
          appProperties: { fciTemplateKey: "estimate-proposal" },
        }),
        `--${boundary}`,
        "Content-Type: text/html",
        "Content-Transfer-Encoding: binary",
        "",
        source,
        `--${boundary}--`,
        "",
      ].join("\r\n"));
      uploaded = true;
      return Response.json(managedFile());
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const first = await client.findOrUploadManagedFile({
    parentId: "shared-drive-root",
    name: "Estimate Proposal",
    mimeType: "application/vnd.google-apps.document",
    mediaMimeType: "text/html",
    bytes,
    appProperties: { fciTemplateKey: "estimate-proposal" },
  });
  assert.equal(first.created, true);
  assert.equal(first.file.mimeType, "application/vnd.google-apps.document");

  const second = await client.findOrUploadManagedFile({
    parentId: "shared-drive-root",
    name: "Estimate Proposal",
    mimeType: "application/vnd.google-apps.document",
    mediaMimeType: "text/html",
    bytes,
    appProperties: { fciTemplateKey: "estimate-proposal" },
  });
  assert.equal(second.created, false);
  assert.equal(calls.filter((call) => call.url.pathname === "/upload/drive/v3/files").length, 1);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 0);
});

test("managed file upload rejects a provider response that drops its stable appProperties identity", async () => {
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    if (url.pathname === "/drive/v3/files" && method === "GET") return Response.json({ files: [] });
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      return Response.json({
        id: "template-without-identity",
        name: "Estimate Proposal",
        mimeType: "application/vnd.google-apps.document",
        parents: ["shared-drive-root"],
        trashed: false,
        appProperties: {},
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  await assert.rejects(
    client.findOrUploadManagedFile({
      parentId: "shared-drive-root",
      name: "Estimate Proposal",
      mimeType: "application/vnd.google-apps.document",
      mediaMimeType: "text/html",
      bytes: new TextEncoder().encode("<p>Estimate</p>"),
      appProperties: { fciTemplateKey: "estimate-proposal" },
    }),
    (error) => error?.code === "drive_upload_invalid_response" && error?.status === 503,
  );
});
