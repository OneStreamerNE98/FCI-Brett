import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const OUTSIDER_EMAIL = "outsider@example.test";
const APP_ORIGIN = "https://fci.example.test";
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

let activeDatabase = null;
const databaseProxy = {
  prepare(...args) {
    if (!activeDatabase) throw new Error("No active drive-files route database fixture.");
    return activeDatabase.prepare(...args);
  },
  batch(...args) {
    if (!activeDatabase) throw new Error("No active drive-files route database fixture.");
    return activeDatabase.batch(...args);
  },
};
const workerEnvironment = { DB: databaseProxy };
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-set22-project-drive-files", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24756 } },
});

const [filesRoute, driveModule, blueprintModule, templatesModule, oauthModule] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/projects/[projectId]/drive/files/route.ts"),
  vite.ssrLoadModule("/app/lib/google-drive.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
  vite.ssrLoadModule("/app/lib/workspace-templates.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
]);
const {
  GoogleDriveClient,
  PROJECT_FILE_KIND_MIME_TYPES,
  projectFolderCatalog,
  projectFolderPathForKey,
} = driveModule;

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

// ---------------------------------------------------------------------------
// GoogleDriveClient method contracts (blank create + template copy)
// ---------------------------------------------------------------------------

function clientConfig(rootFolderId = "shared-drive-root") {
  return { drive: { mode: "shared-drive", rootFolderId } };
}

function assertNoStore(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

function containedParentFetcher(handler, {
  parentId = "project-folder",
  rootId = "shared-drive-root",
  templateFileId = null,
  templateKey = null,
  templateMimeType = "application/vnd.google-apps.document",
  templateParentId = "templates-folder",
  templateParents = [templateParentId],
  templateTrashed = false,
  templateParentContained = true,
} = {}) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body, pathname: url.pathname });
    if (url.pathname === `/drive/v3/files/${parentId}` && method === "GET") {
      return Response.json({ id: parentId, name: "01_Lead & Proposal", mimeType: "application/vnd.google-apps.folder", parents: [rootId], trashed: false });
    }
    if (templateFileId && url.pathname === `/drive/v3/files/${templateFileId}` && method === "GET") {
      return Response.json({
        id: templateFileId,
        name: "Estimate Proposal",
        mimeType: templateMimeType,
        parents: templateParents,
        trashed: templateTrashed,
        appProperties: { fciTemplateKey: templateKey },
      });
    }
    if (templateFileId && url.pathname === `/drive/v3/files/${templateParentId}` && method === "GET") {
      return Response.json({
        id: templateParentId,
        name: "Templates",
        mimeType: "application/vnd.google-apps.folder",
        parents: templateParentContained ? [rootId] : [],
        trashed: false,
      });
    }
    const handled = await handler(url, method, body);
    if (handled) return handled;
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return { calls, fetcher };
}

test("createProjectFile creates a blank Google-native file of every kind in the project folder", async () => {
  for (const kind of ["doc", "sheet", "slides"]) {
    const { calls, fetcher } = containedParentFetcher(async (url, method, body) => {
      if (url.pathname === "/drive/v3/files" && method === "POST") {
        return Response.json({
          id: `new-${kind}`,
          name: body.name,
          mimeType: body.mimeType,
          parents: body.parents,
          trashed: false,
          webViewLink: `https://docs.google.test/${kind}`,
        });
      }
      return null;
    });
    const client = new GoogleDriveClient("test-token", clientConfig(), fetcher);
    const created = await client.createProjectFile({ parentId: "project-folder", name: `Kickoff ${kind}`, kind });

    assert.equal(created.id, `new-${kind}`);
    assert.equal(created.url, `https://docs.google.test/${kind}`);
    const createCall = calls.find((call) => call.pathname === "/drive/v3/files" && call.method === "POST");
    assert.ok(createCall, `${kind} must issue a files.create POST`);
    assert.equal(createCall.body.mimeType, PROJECT_FILE_KIND_MIME_TYPES[kind]);
    assert.deepEqual(createCall.body.parents, ["project-folder"]);
    assert.equal(createCall.body.name, `Kickoff ${kind}`);
    assert.equal(calls.some((call) => call.method === "DELETE"), false);
    assert.equal(calls.some((call) => call.method === "PATCH"), false);
    assert.equal(new URL(createCall.url).searchParams.get("supportsAllDrives"), "true");
  }
});

test("createProjectFile rejects an empty document name before any provider write", async () => {
  const calls = [];
  const client = new GoogleDriveClient("test-token", clientConfig(), async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), method: init.method ?? "GET" });
    throw new Error("The provider must not be called for an invalid document name.");
  });
  await assert.rejects(
    client.createProjectFile({ parentId: "project-folder", name: "   ", kind: "doc" }),
    (error) => error?.status === 400,
  );
  assert.equal(calls.length, 0);
});

test("copyTemplateFile copies the registered template with files.copy pinned to parent and name", async () => {
  const { calls, fetcher } = containedParentFetcher(async (url, method, body) => {
    if (url.pathname === "/drive/v3/files/template-estimate/copy" && method === "POST") {
      return Response.json({
        id: "copied-estimate",
        name: body.name,
        mimeType: "application/vnd.google-apps.document",
        parents: body.parents,
        trashed: false,
        webViewLink: "https://docs.google.test/copied-estimate",
      });
    }
    return null;
  }, { templateFileId: "template-estimate", templateKey: "estimate-proposal" });
  const client = new GoogleDriveClient("test-token", clientConfig(), fetcher);
  const copied = await client.copyTemplateFile({
    templateFileId: "template-estimate",
    templateKey: "estimate-proposal",
    parentId: "project-folder",
    name: "Smith Estimate",
    kind: "doc",
  });

  assert.equal(copied.id, "copied-estimate");
  assert.equal(copied.url, "https://docs.google.test/copied-estimate");
  const copyCall = calls.find((call) => call.pathname === "/drive/v3/files/template-estimate/copy");
  assert.ok(copyCall, "template create must issue a files.copy POST");
  assert.equal(copyCall.method, "POST");
  assert.deepEqual(copyCall.body, { name: "Smith Estimate", parents: ["project-folder"] });
  assert.equal(calls.some((call) => ["DELETE", "PATCH", "PUT"].includes(call.method)), false);
});

test("copyTemplateFile surfaces a not-found template as a Google integration error", async () => {
  const { fetcher } = containedParentFetcher(async (url, method) => {
    if (url.pathname === "/drive/v3/files/missing-template" && method === "GET") {
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    }
    return null;
  });
  const client = new GoogleDriveClient("test-token", clientConfig(), fetcher);
  await assert.rejects(
    client.copyTemplateFile({
      templateFileId: "missing-template",
      templateKey: "estimate-proposal",
      parentId: "project-folder",
      name: "Broken",
      kind: "doc",
    }),
    (error) => error?.code === "drive_not_found" && error?.status === 404,
  );
});

test("copyTemplateFile denies a poisoned source before files.copy", async () => {
  for (const poisoned of [
    { templateMimeType: "application/vnd.google-apps.spreadsheet", templateKey: "estimate-proposal" },
    { templateMimeType: "application/vnd.google-apps.document", templateKey: "other-template" },
    { templateMimeType: "application/vnd.google-apps.document", templateKey: "estimate-proposal", templateTrashed: true },
    { templateMimeType: "application/vnd.google-apps.document", templateKey: "estimate-proposal", templateParents: ["templates-folder", "other-folder"] },
  ]) {
    const { calls, fetcher } = containedParentFetcher(async () => null, {
      templateFileId: "template-estimate",
      ...poisoned,
    });
    const client = new GoogleDriveClient("test-token", clientConfig(), fetcher);
    await assert.rejects(
      client.copyTemplateFile({
        templateFileId: "template-estimate",
        templateKey: "estimate-proposal",
        parentId: "project-folder",
        name: "Smith Estimate",
        kind: "doc",
      }),
      (error) => error?.code === "invalid_blueprint_template" && error?.status === 409,
    );
    assert.equal(calls.some((call) => /\/copy$/u.test(call.pathname)), false);
    assert.equal(calls.some((call) => call.method === "DELETE"), false);
  }
});

test("copyTemplateFile denies a source whose parent escapes the managed root", async () => {
  const { calls, fetcher } = containedParentFetcher(async () => null, {
    templateFileId: "template-estimate",
    templateKey: "estimate-proposal",
    templateParentContained: false,
  });
  const client = new GoogleDriveClient("test-token", clientConfig(), fetcher);
  await assert.rejects(
    client.copyTemplateFile({
      templateFileId: "template-estimate",
      templateKey: "estimate-proposal",
      parentId: "project-folder",
      name: "Smith Estimate",
      kind: "doc",
    }),
    (error) => error?.code === "drive_root_escape" && error?.status === 409,
  );
  assert.equal(calls.some((call) => /\/copy$/u.test(call.pathname)), false);
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

test("replaceDocumentTemplateTokens sends the exact closed SET-17 catalog in one batchUpdate", async () => {
  const calls = [];
  const client = new GoogleDriveClient("test-token", clientConfig(), async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init.method ?? "GET", body });
    if (url.pathname === "/v1/documents/copied-estimate:batchUpdate") {
      return Response.json({ documentId: "copied-estimate" });
    }
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
  });
  await client.replaceDocumentTemplateTokens("copied-estimate", {
    "{{client_name}}": "FCI TEST Client",
    "{{site_address}}": "123 Test Street",
    "{{total}}": "$12,345",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "https://docs.googleapis.com");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    requests: [
      { replaceAllText: { containsText: { text: "{{client_name}}", matchCase: true }, replaceText: "FCI TEST Client" } },
      { replaceAllText: { containsText: { text: "{{site_address}}", matchCase: true }, replaceText: "123 Test Street" } },
      { replaceAllText: { containsText: { text: "{{total}}", matchCase: true }, replaceText: "$12,345" } },
    ],
  });
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

test("findOrCreateManagedNativeFile creates a Slides template without an upload body", async () => {
  const calls = [];
  const client = new GoogleDriveClient("test-token", clientConfig(), async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (url.pathname === "/drive/v3/files/project-folder" && method === "GET") {
      return Response.json({ id: "project-folder", name: "Templates", mimeType: "application/vnd.google-apps.folder", parents: ["shared-drive-root"], trashed: false });
    }
    if (url.pathname === "/drive/v3/files" && method === "GET") return Response.json({ files: [] });
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      return Response.json({
        id: "pitch-deck-file",
        name: body.name,
        mimeType: body.mimeType,
        parents: body.parents,
        trashed: false,
        appProperties: body.appProperties,
        webViewLink: "https://slides.google.test/pitch-deck",
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  const ensured = await client.findOrCreateManagedNativeFile({
    parentId: "project-folder",
    name: "Pitch Deck",
    mimeType: PROJECT_FILE_KIND_MIME_TYPES.slides,
    appProperties: { fciTemplateKey: "pitch-deck" },
  });
  assert.equal(ensured.created, true);
  const create = calls.find((call) => call.method === "POST");
  assert.deepEqual(create.body, {
    name: "Pitch Deck",
    mimeType: "application/vnd.google-apps.presentation",
    parents: ["project-folder"],
    appProperties: { fciTemplateKey: "pitch-deck" },
  });
  assert.equal(create.url.origin, "https://www.googleapis.com");
  assert.doesNotMatch(create.url.pathname, /upload/u);
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

// ---------------------------------------------------------------------------
// Route contract
// ---------------------------------------------------------------------------

function routeRequest(projectId, {
  email = OFFICE_EMAIL,
  body = {},
  origin = APP_ORIGIN,
  method = "POST",
} = {}) {
  const url = new URL(`/api/v1/projects/${projectId}/drive/files`, APP_ORIGIN);
  const request = new Request(url, {
    method,
    headers: {
      ...(method === "POST" ? { origin } : {}),
      "content-type": "application/json",
      "oai-authenticated-user-email": email,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

async function invokeRoute(projectId, options) {
  const response = await filesRoute.POST(routeRequest(projectId, options), { params: Promise.resolve({ projectId }) });
  assertNoStore(response);
  return response;
}

async function invokeCatalog(projectId, options = {}) {
  const response = await filesRoute.GET(routeRequest(projectId, { ...options, method: "GET" }), { params: Promise.resolve({ projectId }) });
  assertNoStore(response);
  return response;
}

function resourceRow({ connectionKey, resourceType, resourceKey, externalId, metadata = {} }) {
  return {
    id: `${resourceType}:${resourceKey}`,
    connection_key: connectionKey,
    resource_type: resourceType,
    resource_key: resourceKey,
    external_id: externalId,
    parent_external_id: null,
    external_url: `https://drive.google.test/${externalId}`,
    origin: "adopted",
    metadata_json: JSON.stringify(metadata),
    created_by: ADMIN_EMAIL,
    created_at: 1,
    updated_at: 1,
  };
}

function templateMetadata(kind) {
  return { kind, metadataMimeType: PROJECT_FILE_KIND_MIME_TYPES[kind] };
}

function fakeDatabase() {
  const state = { resources: [], blueprint: null, connection: null, project: null, mapping: null, activities: [], events: [], queries: [] };
  const database = {
    state,
    prepare(sql) {
      const query = { sql, values: [] };
      state.queries.push(query);
      const statement = {
        bind(...values) { query.values = values; return statement; },
        async all() {
          if (/FROM workspace_resources WHERE connection_key = \?/u.test(sql)) {
            return { results: state.resources.filter((row) => row.connection_key === query.values[0]) };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async first() {
          if (/FROM workspace_settings WHERE id = \?/u.test(sql)) return null;
          if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) {
            return state.blueprint?.connection_key === query.values[0] ? state.blueprint : null;
          }
          if (/FROM google_connections WHERE connection_key = \?/u.test(sql)) return state.connection;
          if (/FROM projects p JOIN clients c/u.test(sql)) return state.project;
          if (/FROM drive_folder_mappings/u.test(sql)) return state.mapping;
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          if (sql.startsWith("INSERT INTO activity_events")) {
            state.activities.push({ values: [...query.values] });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO google_integration_events")) {
            state.events.push({ values: [...query.values] });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE google_connections")) return { meta: { changes: 1 } };
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
      return statement;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return database;
}

function applyEnvironment(database, values) {
  activeDatabase = database;
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, values, { DB: databaseProxy });
}

function simulationEnvironment(database) {
  applyEnvironment(database, {
    NODE_ENV: "development",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
  });
}

async function workspaceEnvironment(database, rootId) {
  const encryptionKey = Buffer.alloc(32, 23).toString("base64url");
  const values = {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive",
    GOOGLE_WORKSPACE_CLIENT_ID: "workspace-client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "workspace-client-secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: `${APP_ORIGIN}/api/v1/integrations/google/callback`,
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
  };
  applyEnvironment(database, values);
  const config = oauthModule.getGoogleRuntimeConfig(values);
  database.state.resources.push(resourceRow({
    connectionKey: config.connectionKey,
    resourceType: "drive.shared-drive",
    resourceKey: "primary",
    externalId: rootId,
    metadata: { name: "FCI Operations" },
  }));
  database.state.connection = {
    id: "connection-1",
    google_email: "operations@cherryhillfci.com",
    refresh_token_ciphertext: await oauthModule.encryptGoogleSecret(
      "FCI_TEST_REFRESH_TOKEN",
      encryptionKey,
      `google-connection:${config.connectionKey}:refresh`,
    ),
    key_version: config.tokenEncryptionKeyVersion,
    scopes_json: JSON.stringify(config.enabledServices.map((service) => config.serviceScopes[service])),
    status: "connected",
  };
  return config;
}

function sampleProject() {
  return {
    id: "project-1",
    project_number: "FCI2026-001",
    name: "Cherry Hill Retail",
    client_name: "FCI TEST — DO NOT USE",
    site: "123 Test Street, Cherry Hill, NJ",
    estimated_value: 12_345,
  };
}

test("GET returns an office-safe current template and leaf-folder catalog", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  globalThis.fetch = async () => { throw new Error("Catalog reads must not contact Google."); };
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: "sim-project-project-1", drive_url: `${APP_ORIGIN}/?workspace-simulation=project` };
  database.state.resources.push(
    resourceRow({
      connectionKey: "workspace-simulation",
      resourceType: "drive.file",
      resourceKey: "estimate-proposal",
      externalId: "workspace-simulation-template-estimate-proposal",
      metadata: templateMetadata("doc"),
    }),
    resourceRow({
      connectionKey: "workspace-simulation",
      resourceType: "drive.file",
      resourceKey: "project-budget",
      externalId: "workspace-simulation-template-project-budget",
      metadata: { kind: "sheet", metadataMimeType: PROJECT_FILE_KIND_MIME_TYPES.doc },
    }),
    resourceRow({
      connectionKey: "workspace-simulation",
      resourceType: "drive.file",
      resourceKey: "removed-template",
      externalId: "workspace-simulation-template-removed",
      metadata: templateMetadata("doc"),
    }),
  );

  const response = await invokeCatalog("project-1", { email: OFFICE_EMAIL });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.provisioned, true);
  assert.deepEqual(body.templates, [{ key: "estimate-proposal", name: "Estimate Proposal", kind: "doc" }]);
  assert.ok(body.folders.some((folder) => folder.key === "lead-proposal" && folder.path === "01_Lead & Proposal"));
  assert.ok(body.folders.some((folder) => folder.key === "email-archive" && folder.path === "05_Correspondence / Email Archive"));
  assert.equal(body.folders.some((folder) => folder.key === "correspondence"), false);
  assert.equal(JSON.stringify(body).includes("externalId"), false);
  assert.equal(JSON.stringify(body).includes("business"), false);
  assert.equal(database.state.queries.some((query) => /\bcontract_value\b/u.test(query.sql)), false);
});

test("GET reports an unprovisioned project and remains office-gated", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  database.state.project = sampleProject();
  database.state.mapping = null;
  const response = await invokeCatalog("project-1");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).provisioned, false);

  const denied = await invokeCatalog("project-1", { email: OUTSIDER_EMAIL });
  assert.equal(denied.status, 403);
});

test("route allows an office non-admin, creates a blank simulated Sheet, and writes audit rows", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  globalThis.fetch = async () => { throw new Error("Simulation must not contact Google."); };
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: "sim-project-project-1", drive_url: `${APP_ORIGIN}/?workspace-simulation=project` };

  const response = await invokeRoute("project-1", { email: OFFICE_EMAIL, body: { kind: "sheet", name: "Budget Tracker" } });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.created, true);
  assert.equal(body.simulated, true);
  assert.equal(body.file.kind, "sheet");
  assert.equal(body.file.name, "Budget Tracker");
  assert.match(body.file.url, /workspace-simulation=project-file/u);
  assert.equal(database.state.activities.length, 1);
  assert.equal(database.state.activities[0].values[2], "workspace_simulation.project_file_created");
  assert.equal(database.state.events.length, 1);
  assert.equal(database.state.events[0].values[2], "drive.file_created");
  assert.equal(database.state.events[0].values[4], "project");
  assert.equal(database.state.events[0].values[5], "project-1");
  assert.equal(
    database.state.queries.some((query) => /(?:INSERT|UPDATE)\s+(?:INTO\s+)?workspace_resources/iu.test(query.sql)),
    false,
  );
});

test("route rejects a cross-origin request before touching setup", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  const response = await invokeRoute("project-1", { email: OFFICE_EMAIL, origin: "https://evil.example", body: { kind: "doc", name: "X" } });
  assert.equal(response.status, 403);
  assert.equal(database.state.queries.length, 0);
});

test("route rejects an unauthenticated caller", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  const response = await invokeRoute("project-1", { email: OUTSIDER_EMAIL, body: { kind: "doc", name: "X" } });
  assert.equal(response.status, 403);
});

test("route returns 409 with provision-first guidance for an unprovisioned project", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  database.state.project = sampleProject();
  database.state.mapping = null;
  const response = await invokeRoute("project-1", { body: { kind: "doc", name: "Kickoff" } });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "project_drive_workspace_required");
  assert.match(body.error, /Provision the project folder first/u);
  assert.equal(database.state.activities.length, 0);
});

test("route returns 404 when the project does not exist", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  database.state.project = null;
  const response = await invokeRoute("missing", { body: { kind: "doc", name: "Kickoff" } });
  assert.equal(response.status, 404);
});

test("route rejects closed-set kinds, bad names, and unknown fields with 400", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: "sim-project-project-1", drive_url: `${APP_ORIGIN}/?x` };

  const badKind = await invokeRoute("project-1", { body: { kind: "pdf", name: "X" } });
  assert.equal(badKind.status, 400);

  for (const name of ["   ", "..", "////", "***"]) {
    const badName = await invokeRoute("project-1", { body: { kind: "doc", name } });
    assert.equal(badName.status, 400, `expected ${JSON.stringify(name)} to fail closed`);
  }

  const extraField = await invokeRoute("project-1", { body: { kind: "doc", name: "X", unexpected: true } });
  assert.equal(extraField.status, 400);
  assert.match((await extraField.json()).error, /Unexpected field/u);

  assert.equal(database.state.activities.length, 0);
  assert.equal(database.state.events.length, 0);
  assert.equal(database.state.queries.length, 0);
});

test("route rejects an oversized body with the shared 413 contract", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  const response = await invokeRoute("project-1", { body: { kind: "doc", name: "x".repeat(4000) } });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "The new-document request is too large." });
});

test("route rejects an unknown template and a type-mismatched template with 400", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: "sim-project-project-1", drive_url: `${APP_ORIGIN}/?x` };
  database.state.resources.push(resourceRow({
    connectionKey: "workspace-simulation",
    resourceType: "drive.file",
    resourceKey: "estimate-proposal",
    externalId: "workspace-simulation-template-estimate-proposal",
    metadata: templateMetadata("doc"),
  }));

  const unknown = await invokeRoute("project-1", { body: { kind: "doc", name: "X", templateKey: "does-not-exist" } });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).code, "template_not_defined");

  const mismatch = await invokeRoute("project-1", { body: { kind: "sheet", name: "X", templateKey: "estimate-proposal" } });
  assert.equal(mismatch.status, 400);

  database.state.resources[0].metadata_json = JSON.stringify({
    kind: "doc",
    metadataMimeType: PROJECT_FILE_KIND_MIME_TYPES.sheet,
  });
  const poisonedRegistry = await invokeRoute("project-1", { body: { kind: "doc", name: "X", templateKey: "estimate-proposal" } });
  assert.equal(poisonedRegistry.status, 400);
  assert.equal((await poisonedRegistry.json()).code, "template_not_registered");
});

test("route rejects an unknown project folder key with 400", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: "sim-project-project-1", drive_url: `${APP_ORIGIN}/?x` };
  const response = await invokeRoute("project-1", { body: { kind: "doc", name: "X", folderKey: "not-a-folder" } });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid project folder/u);

  const groupingNode = await invokeRoute("project-1", { body: { kind: "doc", name: "X", folderKey: "correspondence" } });
  assert.equal(groupingNode.status, 400);
  assert.match((await groupingNode.json()).error, /valid project folder/u);
});

test("simulation rejects a persisted mapping that belongs to another project", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: "sim-project-other-project", drive_url: `${APP_ORIGIN}/?x` };
  const response = await invokeRoute("project-1", { body: { kind: "doc", name: "X" } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "invalid_project_drive_folder");
  assert.equal(database.state.activities.length, 0);
  assert.equal(database.state.events.length, 0);
});

test("route copies a simulated template into a named project folder without contacting Google", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  globalThis.fetch = async () => { throw new Error("Simulation must not contact Google."); };
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: "sim-project-project-1", drive_url: `${APP_ORIGIN}/?x` };
  database.state.resources.push(resourceRow({
    connectionKey: "workspace-simulation",
    resourceType: "drive.file",
    resourceKey: "estimate-proposal",
    externalId: "workspace-simulation-template-estimate-proposal",
    metadata: templateMetadata("doc"),
  }));

  const response = await invokeRoute("project-1", { body: { kind: "doc", name: "Retail Estimate", templateKey: "estimate-proposal", folderKey: "lead-proposal" } });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.simulated, true);
  assert.match(body.file.id, /copy-estimate-proposal/u);
  assert.equal(database.state.events[0].values[6], "mode=simulation;kind=doc;source=template:estimate-proposal;folder=lead-proposal");
});

function installWorkspaceProvider({
  rootId,
  projectFolderId,
  projectId = "project-1",
  templateFileId = null,
  templateKey = null,
  templateMimeType = PROJECT_FILE_KIND_MIME_TYPES.doc,
  templateParentId = "templates-folder",
  onCreate,
  onCopy,
  onDocsMerge,
}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    if (url.href === "https://oauth2.googleapis.com/token") {
      calls.push({ url, method, body: null, pathname: url.pathname });
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    const serialized = init.body ? String(init.body) : "";
    const body = serialized.trimStart().startsWith("{") ? JSON.parse(serialized) : null;
    calls.push({ url, method, body, pathname: url.pathname });
    if (url.pathname === `/drive/v3/files/${projectFolderId}` && method === "GET") {
      return Response.json({
        id: projectFolderId,
        name: "FCI2026-001 — Cherry Hill Retail",
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootId],
        trashed: false,
        appProperties: { fciFolderKind: "project", fciProjectId: projectId },
      });
    }
    if (templateFileId && url.pathname === `/drive/v3/files/${templateFileId}` && method === "GET") {
      return Response.json({
        id: templateFileId,
        name: "Estimate Proposal",
        mimeType: templateMimeType,
        parents: [templateParentId],
        trashed: false,
        appProperties: { fciTemplateKey: templateKey },
      });
    }
    if (templateFileId && url.pathname === `/drive/v3/files/${templateParentId}` && method === "GET") {
      return Response.json({
        id: templateParentId,
        name: "Templates",
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootId],
        trashed: false,
      });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST" && onCreate) return onCreate(body);
    if (/\/copy$/u.test(url.pathname) && method === "POST" && onCopy) return onCopy(url, body);
    if (url.origin === "https://docs.googleapis.com" && /:batchUpdate$/u.test(url.pathname) && method === "POST") {
      if (onDocsMerge) return onDocsMerge(url, body);
      const documentId = decodeURIComponent(url.pathname.split("/").at(-1).replace(/:batchUpdate$/u, ""));
      return Response.json({ documentId });
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };
  return calls;
}

test("route creates blank Doc, Sheet, and Slides files in workspace mode and records both audit rows", async () => {
  const database = fakeDatabase();
  const rootId = "app-shared-drive-live";
  const projectFolderId = "project-root-folder";
  await workspaceEnvironment(database, rootId);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: projectFolderId, drive_url: `https://drive.google.test/${projectFolderId}` };
  const calls = installWorkspaceProvider({
    rootId,
    projectFolderId,
    onCreate: (body) => {
      const kind = Object.entries(PROJECT_FILE_KIND_MIME_TYPES).find(([, mimeType]) => mimeType === body.mimeType)?.[0];
      return Response.json({
        id: `live-${kind}`,
        name: body.name,
        mimeType: body.mimeType,
        parents: body.parents,
        trashed: false,
        webViewLink: `https://docs.google.test/live-${kind}/edit`,
      });
    },
  });

  for (const kind of ["doc", "sheet", "slides"]) {
    const response = await invokeRoute("project-1", {
      email: OFFICE_EMAIL,
      body: { kind, name: `Blank ${kind}` },
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.simulated, undefined);
    assert.equal(body.file.kind, kind);
    assert.equal(body.file.url, `https://docs.google.test/live-${kind}/edit`);
  }
  const createCalls = calls.filter((call) => call.pathname === "/drive/v3/files" && call.method === "POST");
  assert.deepEqual(
    createCalls.map((call) => call.body.mimeType),
    [
      PROJECT_FILE_KIND_MIME_TYPES.doc,
      PROJECT_FILE_KIND_MIME_TYPES.sheet,
      PROJECT_FILE_KIND_MIME_TYPES.slides,
    ],
  );
  for (const [index, call] of createCalls.entries()) {
    assert.deepEqual(call.body.parents, [projectFolderId]);
    assert.equal(call.body.name, `Blank ${["doc", "sheet", "slides"][index]}`);
  }
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
  assert.equal(database.state.activities.length, 3);
  assert.equal(database.state.events.length, 3);
  for (const [index, event] of database.state.events.entries()) {
    assert.equal(event.values[2], "drive.file_created");
    assert.match(event.values[6], new RegExp(`mode=workspace;kind=${["doc", "sheet", "slides"][index]};source=blank`, "u"));
  }
  assert.equal(
    database.state.queries.some((query) => /(?:INSERT|UPDATE)\s+(?:INTO\s+)?workspace_resources/iu.test(query.sql)),
    false,
  );
});

test("route copies a registered template with a files.copy request pinned to parent and name", async () => {
  const database = fakeDatabase();
  const rootId = "app-shared-drive-live";
  const projectFolderId = "project-root-folder";
  await workspaceEnvironment(database, rootId);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: projectFolderId, drive_url: `https://drive.google.test/${projectFolderId}` };
  database.state.resources.push(resourceRow({
    connectionKey: "google-workspace",
    resourceType: "drive.file",
    resourceKey: "estimate-proposal",
    externalId: "template-estimate-file",
    metadata: templateMetadata("doc"),
  }));
  const calls = installWorkspaceProvider({
    rootId,
    projectFolderId,
    templateFileId: "template-estimate-file",
    templateKey: "estimate-proposal",
    onCopy: (url, body) => Response.json({ id: "copied-live", name: body.name, mimeType: "application/vnd.google-apps.document", parents: body.parents, trashed: false, webViewLink: "https://docs.google.test/copied-live/edit" }),
  });

  const response = await invokeRoute("project-1", { email: OFFICE_EMAIL, body: { kind: "doc", name: "Retail Estimate", templateKey: "estimate-proposal" } });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.file.url, "https://docs.google.test/copied-live/edit");
  const copyCall = calls.find((call) => /\/copy$/u.test(call.pathname));
  assert.equal(copyCall.pathname, "/drive/v3/files/template-estimate-file/copy");
  assert.deepEqual(copyCall.body, { name: "Retail Estimate", parents: [projectFolderId] });
  const sourceRead = calls.find((call) => call.pathname === "/drive/v3/files/template-estimate-file" && call.method === "GET");
  assert.ok(sourceRead);
  assert.ok(calls.indexOf(sourceRead) < calls.indexOf(copyCall));
  const docsMerge = calls.find((call) => call.url.origin === "https://docs.googleapis.com");
  assert.deepEqual(docsMerge.body, {
    requests: [
      { replaceAllText: { containsText: { text: "{{client_name}}", matchCase: true }, replaceText: "FCI TEST — DO NOT USE" } },
      { replaceAllText: { containsText: { text: "{{site_address}}", matchCase: true }, replaceText: "123 Test Street, Cherry Hill, NJ" } },
      { replaceAllText: { containsText: { text: "{{total}}", matchCase: true }, replaceText: "$12,345" } },
    ],
  });
  assert.equal(database.state.queries.some((query) => /\bcontract_value\b/u.test(query.sql)), false);
  assert.equal(database.state.activities.length, 1);
  assert.equal(database.state.events.length, 1);
  assert.equal(database.state.events[0].values[2], "drive.file_created");
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});

test("route denies a mapped folder owned by another project before creating a file", async () => {
  const database = fakeDatabase();
  const rootId = "app-shared-drive-live";
  const projectFolderId = "poisoned-project-root";
  await workspaceEnvironment(database, rootId);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: projectFolderId, drive_url: `https://drive.google.test/${projectFolderId}` };
  const calls = installWorkspaceProvider({
    rootId,
    projectFolderId,
    projectId: "other-project",
    onCreate: () => { throw new Error("A mismatched managed root must not create."); },
  });

  const response = await invokeRoute("project-1", { body: { kind: "doc", name: "Denied" } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "invalid_project_drive_folder");
  assert.equal(calls.some((call) => call.method === "POST" && call.pathname === "/drive/v3/files"), false);
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
  assert.equal(database.state.activities.length, 0);
  assert.equal(database.state.events.length, 0);
});

test("route verifies the physical template identity before files.copy", async () => {
  const database = fakeDatabase();
  const rootId = "app-shared-drive-live";
  const projectFolderId = "project-root-folder";
  await workspaceEnvironment(database, rootId);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: projectFolderId, drive_url: `https://drive.google.test/${projectFolderId}` };
  database.state.resources.push(resourceRow({
    connectionKey: "google-workspace",
    resourceType: "drive.file",
    resourceKey: "estimate-proposal",
    externalId: "template-estimate-file",
    metadata: templateMetadata("doc"),
  }));
  const calls = installWorkspaceProvider({
    rootId,
    projectFolderId,
    templateFileId: "template-estimate-file",
    templateKey: "poisoned-template-key",
    onCopy: () => { throw new Error("A poisoned source must not be copied."); },
  });

  const response = await invokeRoute("project-1", {
    body: { kind: "doc", name: "Denied", templateKey: "estimate-proposal" },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "invalid_blueprint_template");
  assert.equal(calls.some((call) => /\/copy$/u.test(call.pathname)), false);
  assert.equal(calls.some((call) => call.url.origin === "https://docs.googleapis.com"), false);
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
  assert.equal(database.state.activities.length, 0);
  assert.equal(database.state.events.length, 0);
});

test("route never issues a Drive deletion across create and copy paths", async () => {
  const database = fakeDatabase();
  const rootId = "app-shared-drive-live";
  const projectFolderId = "project-root-folder";
  await workspaceEnvironment(database, rootId);
  database.state.project = sampleProject();
  database.state.mapping = { drive_file_id: projectFolderId, drive_url: `https://drive.google.test/${projectFolderId}` };
  const calls = installWorkspaceProvider({
    rootId,
    projectFolderId,
    onCreate: (body) => Response.json({ id: "live-slides", name: body.name, mimeType: body.mimeType, parents: body.parents, trashed: false, webViewLink: "https://slides.google.test/live" }),
  });

  await invokeRoute("project-1", { email: OFFICE_EMAIL, body: { kind: "slides", name: "Client Deck" } });
  assert.equal(calls.some((call) => ["DELETE"].includes(call.method)), false);
  const createCall = calls.find((call) => call.pathname === "/drive/v3/files" && call.method === "POST");
  assert.equal(createCall.body.mimeType, "application/vnd.google-apps.presentation");
});

// ---------------------------------------------------------------------------
// Blueprint slides enum + template render
// ---------------------------------------------------------------------------

test("blueprint sanitizer round-trips a Slides template and rejects an unknown kind", () => {
  const draft = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  draft.templates.push({ key: "pitch-deck", name: "Pitch Deck", kind: "slides", targetFolderKey: "templates", management: "owner" });
  const sanitized = blueprintModule.sanitizeWorkspaceBlueprint(draft);
  const slides = sanitized.templates.find((template) => template.key === "pitch-deck");
  assert.ok(slides);
  assert.equal(slides.kind, "slides");

  const invalid = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  invalid.templates.push({ key: "bad-kind", name: "Bad", kind: "pdf", targetFolderKey: "templates", management: "owner" });
  assert.throws(() => blueprintModule.sanitizeWorkspaceBlueprint(invalid), (error) => /kind/u.test(error?.path ?? ""));
});

test("Slides templates cannot use the HTML upload-conversion renderer", () => {
  assert.throws(
    () => templatesModule.renderWorkspaceTemplate(
      { key: "pitch-deck", name: "Pitch Deck", kind: "slides", targetFolderKey: "templates", management: "owner" },
      "FCI TEST — DO NOT USE",
    ),
    /created as native Google presentations/u,
  );
  const values = templatesModule.workspaceTemplateTokenValues({
    clientName: " FCI TEST Client ",
    siteAddress: null,
    estimatedValue: 12_345,
  });
  assert.deepEqual(values, {
    "{{client_name}}": "FCI TEST Client",
    "{{site_address}}": "",
    "{{total}}": "$12,345",
  });
  assert.deepEqual(Object.keys(values), ["{{client_name}}", "{{site_address}}", "{{total}}"]);
});

test("project folder catalog contains leaf destinations only", () => {
  const blueprint = blueprintModule.seedWorkspaceBlueprint();
  assert.deepEqual(projectFolderPathForKey(blueprint, "lead-proposal"), ["01_Lead & Proposal"]);
  assert.deepEqual(projectFolderPathForKey(blueprint, "email-archive"), ["05_Correspondence", "Email Archive"]);
  assert.equal(projectFolderPathForKey(blueprint, "correspondence"), null);
  assert.equal(projectFolderPathForKey(blueprint, "nope"), null);
  const catalog = projectFolderCatalog(blueprint);
  assert.ok(catalog.some((folder) => folder.key === "email-archive" && folder.path === "05_Correspondence / Email Archive"));
  assert.equal(catalog.some((folder) => folder.key === "correspondence"), false);
});
