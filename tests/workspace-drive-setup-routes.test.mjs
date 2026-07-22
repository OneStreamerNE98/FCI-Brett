import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const APP_ORIGIN = "https://fci.example.test";
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

let activeDatabase = null;
const sheetsDatabaseProxy = {
  prepare(...args) {
    if (!activeDatabase) throw new Error("No active spreadsheet route database fixture.");
    return activeDatabase.prepare(...args);
  },
};
const workerEnvironment = { DB: sheetsDatabaseProxy };
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-drive-setup-routes", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24738 } },
});

const [adoptRoute, ensureRoute, renameRoute, templateEnsureRoute, sheetEnsureRoute, sheetStatusRoute, sheetSyncRoute, verifyRoute, projectDriveRoute, blueprintModule, oauthModule] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/integrations/google/drive/shared-drive/adopt/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/drive/folders/ensure-roots/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/drive/folders/rename/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/drive/templates/ensure/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/sheets/ensure/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/sheets/status/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/sheets/sync/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/drive/verify/route.ts"),
  vite.ssrLoadModule("/app/api/v1/projects/[projectId]/drive/route.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
]);

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function routeRequest(path, email = ADMIN_EMAIL, body = {}, origin = APP_ORIGIN) {
  const url = new URL(path, APP_ORIGIN);
  const request = new Request(url, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "oai-authenticated-user-email": email,
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function resourceRow(values) {
  return {
    id: values[0],
    connection_key: values[1],
    resource_type: values[2],
    resource_key: values[3],
    external_id: values[4],
    parent_external_id: values[5],
    external_url: values[6],
    origin: values[7],
    metadata_json: values[8],
    created_by: values[9],
    created_at: values[10],
    updated_at: values[11],
  };
}

function fakeDatabase({ blueprint = null, blueprintConnectionKey = "workspace-simulation" } = {}) {
  const state = {
    resources: [],
    blueprint: blueprint ? {
      id: "blueprint-fixture",
      connection_key: blueprintConnectionKey,
      version: 1,
      blueprint_json: JSON.stringify(blueprint),
      created_by: ADMIN_EMAIL,
      created_at: 1,
      updated_by: ADMIN_EMAIL,
      updated_at: 1,
    } : null,
    connection: null,
    events: [],
    activities: [],
    mappings: [],
    leases: new Map(),
    queries: [],
    lastBlueprintSaveChanged: false,
    forceBlueprintConflict: false,
    loseLeaseBeforeNextBatch: false,
    project: null,
    mapping: null,
    sheetStates: [],
  };

  const database = {
    state,
    prepare(sql) {
      const query = { sql, values: [], kind: "prepared" };
      state.queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async all() {
          query.kind = "all";
          if (/FROM workspace_resources WHERE connection_key = \?/u.test(sql)) {
            return { results: state.resources.filter((row) => row.connection_key === query.values[0]) };
          }
          if (/FROM google_sheet_sync_state WHERE connection_key = \?/u.test(sql)) {
            return { results: state.sheetStates.filter((row) => row.connection_key === query.values[0]) };
          }
          if (/^SELECT c\.id, c\.client_code/u.test(sql) || /^SELECT p\.id, p\.project_number/u.test(sql)) {
            return { results: [] };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async first() {
          query.kind = "first";
          if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) {
            return state.blueprint?.connection_key === query.values[0] ? state.blueprint : null;
          }
          if (/FROM workspace_resources WHERE connection_key = \? AND resource_type = \? AND resource_key = \?/u.test(sql)) {
            return state.resources.find((row) => (
              row.connection_key === query.values[0]
              && row.resource_type === query.values[1]
              && row.resource_key === query.values[2]
            )) ?? null;
          }
          if (/FROM google_connections WHERE connection_key = \?/u.test(sql)) return state.connection;
          if (/FROM projects p JOIN clients c/u.test(sql)) return state.project;
          if (/FROM drive_folder_mappings/u.test(sql)) {
            return state.mapping ?? state.mappings.find((mapping) => (
              mapping.connectionKey === query.values[0]
              && mapping.entityType === "project"
              && mapping.entityId === query.values[1]
              && mapping.folderKey === "project-root"
            )) ?? null;
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          query.kind = "run";
          const leasePredicate = "EXISTS (SELECT 1 FROM google_drive_operations WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?)";
          if (sql.includes(leasePredicate)) {
            const [operationKey, expectedLease] = query.values.slice(-2);
            const current = state.leases.get(operationKey);
            if (current?.status !== "in-progress" || current.leaseExpiresAt !== expectedLease) {
              return { meta: { changes: 0 } };
            }
          }
          if (sql.startsWith("INSERT INTO workspace_resources")) {
            const next = resourceRow(query.values);
            const index = state.resources.findIndex((row) => (
              row.connection_key === next.connection_key
              && row.resource_type === next.resource_type
              && row.resource_key === next.resource_key
            ));
            if (index === -1) state.resources.push(next);
            else state.resources[index] = {
              ...state.resources[index],
              external_id: next.external_id,
              parent_external_id: next.parent_external_id,
              external_url: next.external_url,
              origin: next.origin,
              metadata_json: next.metadata_json,
              updated_at: next.updated_at,
            };
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO google_drive_operations")) {
            const [id, connectionKey, operationKey, projectId, leaseExpiresAt, actor, createdAt, updatedAt, now] = query.values;
            const current = state.leases.get(operationKey);
            if (current?.status === "in-progress" && current.leaseExpiresAt >= now) return { meta: { changes: 0 } };
            state.leases.set(operationKey, {
              id, connectionKey, operationKey, projectId, status: "in-progress", leaseExpiresAt,
              errorCode: null, actor, createdAt, updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE google_drive_operations SET status = 'completed'")) {
            const [updatedAt, operationKey, leaseExpiresAt] = query.values;
            const current = state.leases.get(operationKey);
            if (current?.status !== "in-progress" || current.leaseExpiresAt !== leaseExpiresAt) return { meta: { changes: 0 } };
            state.leases.set(operationKey, { ...current, status: "completed", leaseExpiresAt: null, errorCode: null, updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE google_drive_operations SET status = 'failed'")) {
            const [errorCode, updatedAt, operationKey, leaseExpiresAt] = query.values;
            const current = state.leases.get(operationKey);
            if (current?.status !== "in-progress" || current.leaseExpiresAt !== leaseExpiresAt) return { meta: { changes: 0 } };
            state.leases.set(operationKey, { ...current, status: "failed", leaseExpiresAt: null, errorCode, updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO workspace_blueprints")) {
            const [id, connectionKey, version, blueprintJson, createdBy, createdAt, updatedBy, updatedAt, expectedVersion] = query.values;
            const currentVersion = state.blueprint?.connection_key === connectionKey ? state.blueprint.version : 0;
            if (state.forceBlueprintConflict || currentVersion !== expectedVersion) {
              state.lastBlueprintSaveChanged = false;
              return { meta: { changes: 0 } };
            }
            state.blueprint = {
              id: state.blueprint?.id ?? id,
              connection_key: connectionKey,
              version,
              blueprint_json: blueprintJson,
              created_by: state.blueprint?.created_by ?? createdBy,
              created_at: state.blueprint?.created_at ?? createdAt,
              updated_by: updatedBy,
              updated_at: updatedAt,
            };
            state.lastBlueprintSaveChanged = true;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO google_integration_events")) {
            if (sql.includes("FROM workspace_blueprints") && !state.lastBlueprintSaveChanged) return { meta: { changes: 0 } };
            const [id, connectionKey, eventType, actor, entityType, entityId, detail, createdAt] = query.values;
            state.events.push({ id, connectionKey, eventType, actor, entityType, entityId, detail, createdAt });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO drive_folder_mappings")) {
            const entityType = sql.match(/(?:VALUES|SELECT) \?, \?, '([^']+)'/u)?.[1];
            const folderKey = sql.match(/, '([^']+)', \?, NULL/u)?.[1];
            const [id, connectionKey, entityId, driveFileId, driveUrl, createdAt, updatedAt] = query.values;
            const next = { id, connectionKey, entityType, entityId, folderKey, driveFileId, driveUrl, createdAt, updatedAt };
            const index = state.mappings.findIndex((mapping) => (
              mapping.connectionKey === connectionKey
              && mapping.entityType === entityType
              && mapping.entityId === entityId
              && mapping.folderKey === folderKey
            ));
            if (index === -1) state.mappings.push(next);
            else state.mappings[index] = next;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO activity_events")) {
            state.activities.push({ values: [...query.values] });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE google_connections SET last_success_at")) return { meta: { changes: 1 } };
          if (sql.startsWith("UPDATE google_connections SET")) return { meta: { changes: 1 } };
          if (sql.startsWith("INSERT INTO google_sheet_sync_state")) {
            const [connectionKey, entityType, status, lastSyncedAt, lastErrorCode, lastErrorMessage, lastAttemptAt] = query.values;
            const next = {
              connection_key: connectionKey,
              entity_type: entityType,
              status,
              last_synced_at: lastSyncedAt,
              last_error_code: lastErrorCode,
              last_error_message: lastErrorMessage,
              last_attempt_at: lastAttemptAt,
            };
            const index = state.sheetStates.findIndex((row) => row.connection_key === connectionKey && row.entity_type === entityType);
            if (index === -1) state.sheetStates.push(next);
            else state.sheetStates[index] = next;
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
      return statement;
    },
    async batch(statements) {
      if (state.loseLeaseBeforeNextBatch) {
        state.loseLeaseBeforeNextBatch = false;
        for (const [operationKey, operation] of state.leases) {
          if (operation.status === "in-progress") {
            state.leases.set(operationKey, { ...operation, leaseExpiresAt: operation.leaseExpiresAt + 1 });
          }
        }
      }
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
  Object.assign(workerEnvironment, values, { DB: database });
}

function simulationEnvironment(database) {
  applyEnvironment(database, {
    NODE_ENV: "development",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
  });
}

async function workspaceEnvironment(database, overrides = {}) {
  const encryptionKey = Buffer.alloc(32, 19).toString("base64url");
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
    ...overrides,
  };
  applyEnvironment(database, values);
  const config = oauthModule.getGoogleRuntimeConfig(values);
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
}

function installProvider({ matches = [], driveNames = {}, fileParents = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    if (url.pathname === "/drive/v3/drives") {
      return Response.json({ drives: matches.map((drive) => ({
        id: drive.id,
        name: drive.name,
        restrictions: drive.restrictions ?? { domainUsersOnly: true, driveMembersOnly: true },
      })) });
    }
    const driveId = url.pathname.match(/^\/drive\/v3\/drives\/([^/]+)$/u)?.[1];
    if (driveId) {
      const decoded = decodeURIComponent(driveId);
      return Response.json({
        id: decoded,
        name: driveNames[decoded] ?? "FCI Operations",
        restrictions: { domainUsersOnly: true, driveMembersOnly: true },
      });
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/u)?.[1];
    if (fileId && (init.method ?? "GET") === "GET") {
      const decoded = decodeURIComponent(fileId);
      return Response.json({
        id: decoded,
        name: driveNames[decoded] ?? "FCI Operations",
        mimeType: "application/vnd.google-apps.folder",
        parents: fileParents[decoded] ?? [],
        trashed: false,
        webViewLink: `https://drive.google.test/${decoded}`,
      });
    }
    throw new Error(`Unexpected provider request: ${(init.method ?? "GET")} ${url}`);
  };
  return calls;
}

function installRenameProvider({ folderId, rootId, initialName, failCompensation = false }) {
  const patchNames = [];
  let currentName = initialName;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    if (url.pathname !== `/drive/v3/files/${folderId}`) {
      throw new Error(`Unexpected provider request: ${(init.method ?? "GET")} ${url}`);
    }
    if ((init.method ?? "GET") === "PATCH") {
      const name = JSON.parse(String(init.body)).name;
      patchNames.push(name);
      if (failCompensation && patchNames.length === 2) {
        return Response.json({ error: { message: "simulated compensation failure" } }, { status: 503 });
      }
      currentName = name;
    }
    return Response.json({
      id: folderId,
      name: currentName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootId],
      trashed: false,
      webViewLink: `https://drive.google.test/${folderId}`,
      appProperties: { fciRootKey: "client-accounts" },
    });
  };
  return { patchNames, currentName: () => currentName };
}

function installEnsureProvider(rootId, initialFolders = []) {
  const folders = structuredClone(initialFolders);
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const parentId = query.match(/^'([^']+)' in parents/u)?.[1];
      const identity = query.match(/key='([^']+)' and value='([^']+)'/u);
      const name = query.match(/name = '([^']+)'/u)?.[1];
      return Response.json({ files: folders.filter((folder) => (
        folder.parents.includes(parentId)
        && (!identity || folder.appProperties?.[identity[1]] === identity[2])
        && (name === undefined || folder.name === name)
      )) });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const body = JSON.parse(String(init.body));
      const folder = {
        id: `provider-folder-${body.appProperties.fciRootKey}`,
        name: body.name,
        mimeType: "application/vnd.google-apps.folder",
        parents: body.parents,
        trashed: false,
        appProperties: body.appProperties,
      };
      folders.push(folder);
      return Response.json(folder);
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/u)?.[1];
    if (fileId && method === "PATCH") {
      const folder = folders.find((candidate) => candidate.id === decodeURIComponent(fileId));
      if (!folder) throw new Error(`Unknown provider folder: ${decodeURIComponent(fileId)}`);
      const body = JSON.parse(String(init.body));
      const appProperties = { ...(folder.appProperties ?? {}) };
      for (const [key, value] of Object.entries(body.appProperties ?? {})) {
        if (value === null) delete appProperties[key];
        else appProperties[key] = value;
      }
      folder.appProperties = appProperties;
      return Response.json(folder);
    }
    if (fileId && method === "GET") {
      const folder = folders.find((candidate) => candidate.id === decodeURIComponent(fileId));
      if (folder) return Response.json(folder);
      if (decodeURIComponent(fileId) === rootId) {
        return Response.json({ id: rootId, name: "FCI Operations", mimeType: "application/vnd.google-apps.folder", parents: [], trashed: false });
      }
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };
  return { folders, calls };
}

function installSpreadsheetProvider({ rootId, targetFolderId, existing = [] }) {
  const files = new Map(existing.map((file) => [file.appProperties.fciResourceKind, file]));
  const tabs = new Map();
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const serializedBody = init.body ? String(init.body) : "";
    const body = serializedBody.trimStart().startsWith("{") ? JSON.parse(serializedBody) : null;
    calls.push({ url, method, body });
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    if (url.pathname === `/drive/v3/files/${targetFolderId}` && method === "GET") {
      return Response.json({
        id: targetFolderId,
        name: "00_Company Admin",
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootId],
        trashed: false,
      });
    }
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const key = (url.searchParams.get("q") ?? "").match(/value='([^']+)'/u)?.[1];
      return Response.json({ files: key && files.has(key) ? [files.get(key)] : [] });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const key = body.appProperties.fciResourceKind;
      const file = {
        id: `provider-sheet-${key}`,
        name: body.name,
        mimeType: body.mimeType,
        parents: body.parents,
        trashed: false,
        webViewLink: `https://docs.google.test/${key}`,
        appProperties: body.appProperties,
      };
      files.set(key, file);
      return Response.json(file);
    }
    const spreadsheetId = url.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(?::batchUpdate)?/u)?.[1];
    if (spreadsheetId) {
      const decoded = decodeURIComponent(spreadsheetId);
      const sheetTabs = tabs.get(decoded) ?? new Map();
      tabs.set(decoded, sheetTabs);
      if (url.pathname.endsWith(":batchUpdate") && method === "POST") {
        for (const request of body.requests ?? []) {
          const title = request.addSheet?.properties?.title;
          if (title && !sheetTabs.has(title)) sheetTabs.set(title, sheetTabs.size + 1);
        }
        return Response.json({ replies: [] });
      }
      if (url.pathname.endsWith("/values:batchUpdate") && method === "POST") return Response.json({ totalUpdatedRows: 2 });
      if (url.pathname.includes("/values/") && url.pathname.endsWith(":clear") && method === "POST") return Response.json({ clearedRange: "Project Register" });
      if (url.pathname.includes("/values/") && method === "GET") return Response.json({ values: [] });
      if (method === "GET") {
        return Response.json({ sheets: [...sheetTabs].map(([title, sheetId]) => ({ properties: { title, sheetId } })) });
      }
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };
  return { calls, files, tabs };
}

function installTemplateProvider({ rootId, parentFolderId, templateFolderId }) {
  const templateFolder = {
    id: templateFolderId,
    name: "Templates",
    mimeType: "application/vnd.google-apps.folder",
    parents: [parentFolderId],
    trashed: false,
    webViewLink: `https://drive.google.test/${templateFolderId}`,
    appProperties: {},
  };
  const files = new Map();
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const templateKey = query.match(/key='fciTemplateKey' and value='([^']+)'/u)?.[1];
      if (templateKey) return Response.json({ files: files.has(templateKey) ? [files.get(templateKey)] : [] });
      const rootKey = query.match(/key='fciRootKey' and value='([^']+)'/u)?.[1];
      const name = query.match(/name = '([^']+)'/u)?.[1];
      const matchesIdentity = rootKey === undefined || templateFolder.appProperties.fciRootKey === rootKey;
      const matchesName = name === undefined || templateFolder.name === name;
      return Response.json({ files: matchesIdentity && matchesName ? [templateFolder] : [] });
    }
    if (url.pathname === `/drive/v3/files/${templateFolderId}` && method === "PATCH") {
      const body = JSON.parse(String(init.body));
      templateFolder.appProperties = { ...templateFolder.appProperties, ...body.appProperties };
      return Response.json(templateFolder);
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/u)?.[1];
    if (fileId && method === "GET") {
      const decoded = decodeURIComponent(fileId);
      if (decoded === templateFolderId) return Response.json(templateFolder);
      if (decoded === parentFolderId) {
        return Response.json({
          id: parentFolderId,
          name: "00_Company Admin",
          mimeType: "application/vnd.google-apps.folder",
          parents: [rootId],
          trashed: false,
        });
      }
      if (decoded === rootId) {
        return Response.json({ id: rootId, name: "FCI Operations", mimeType: "application/vnd.google-apps.folder", parents: [], trashed: false });
      }
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      const multipart = await init.body.text();
      const metadataMatch = multipart.match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{[^\r]+\})\r\n--/u);
      if (!metadataMatch) throw new Error("Template upload did not include multipart metadata.");
      const metadata = JSON.parse(metadataMatch[1]);
      const key = metadata.appProperties.fciTemplateKey;
      const file = {
        id: `provider-template-${key}`,
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.parents,
        trashed: false,
        webViewLink: `https://docs.google.test/${key}`,
        appProperties: metadata.appProperties,
      };
      files.set(key, file);
      return Response.json(file);
    }
    throw new Error(`Unexpected provider request: ${method} ${url}`);
  };
  return { calls, files, templateFolder };
}

function savedResource({ id, connectionKey = "google-workspace", resourceType, resourceKey, externalId, parentExternalId = null, origin = "adopted", name }) {
  return {
    id,
    connection_key: connectionKey,
    resource_type: resourceType,
    resource_key: resourceKey,
    external_id: externalId,
    parent_external_id: parentExternalId,
    external_url: `https://drive.google.test/${externalId}`,
    origin,
    metadata_json: JSON.stringify({ name }),
    created_by: ADMIN_EMAIL,
    created_at: 1,
    updated_at: 1,
  };
}

function nestedKeyShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, nestedKeyShape(value[key])]),
  );
}

test("Shared Drive adoption covers explicit ID, exact-name, zero, multiple, and environment origins", async (t) => {
  await t.test("explicit ID is verified, app-adopted, audited, and becomes effective for drive verify", async () => {
    const database = fakeDatabase();
    await workspaceEnvironment(database);
    const calls = installProvider();

    const response = await adoptRoute.POST(routeRequest(
      "/api/v1/integrations/google/drive/shared-drive/adopt",
      ADMIN_EMAIL,
      { driveId: "explicit-shared-drive-123" },
    ));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.origin, "adopted");
    assert.equal(body.drive.id, "explicit-shared-drive-123");
    assert.equal(database.state.resources[0].external_id, "explicit-shared-drive-123");
    assert.equal(database.state.resources[0].origin, "adopted");
    assert.ok(database.state.events.some((event) => event.eventType === "setup.shared_drive_adopted"));

    const verifyResponse = await verifyRoute.POST(routeRequest(
      "/api/v1/integrations/google/drive/verify",
      ADMIN_EMAIL,
    ));
    const verifyBody = await verifyResponse.json();
    assert.equal(verifyResponse.status, 200);
    assert.equal(verifyBody.verified, true);
    assert.equal(verifyBody.workspace.name, "FCI Operations");
    assert.ok(calls.some((call) => call.url.pathname === "/drive/v3/files/explicit-shared-drive-123"));
  });

  await t.test("one exact blueprint-name match is adopted", async () => {
    const database = fakeDatabase();
    await workspaceEnvironment(database);
    installProvider({ matches: [{ id: "name-match-drive-123", name: "FCI Operations" }] });

    const response = await adoptRoute.POST(routeRequest("/api/v1/integrations/google/drive/shared-drive/adopt"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.drive.id, "name-match-drive-123");
    assert.equal(body.origin, "adopted");
  });

  await t.test("zero matches return checklist guidance without saving a resource", async () => {
    const database = fakeDatabase();
    await workspaceEnvironment(database);
    installProvider({ matches: [] });

    const response = await adoptRoute.POST(routeRequest("/api/v1/integrations/google/drive/shared-drive/adopt"));
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.code, "shared_drive_not_found");
    assert.match(body.error, /Create it manually using the Workspace resources checklist/u);
    assert.equal(database.state.resources.length, 0);
  });

  await t.test("multiple matches return safe candidates for an explicit re-POST", async () => {
    const database = fakeDatabase();
    await workspaceEnvironment(database);
    installProvider({ matches: [
      { id: "candidate-drive-111", name: "FCI Operations" },
      { id: "candidate-drive-222", name: "FCI Operations", restrictions: { domainUsersOnly: false } },
    ] });

    const response = await adoptRoute.POST(routeRequest("/api/v1/integrations/google/drive/shared-drive/adopt"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "shared_drive_ambiguous");
    assert.deepEqual(body.candidates.map((candidate) => candidate.id), ["candidate-drive-111", "candidate-drive-222"]);
    assert.equal(body.candidates[1].restrictions.domainUsersOnly, false);
    assert.equal(database.state.resources.length, 0);
  });

  await t.test("an environment-sourced ID is stamped env-adopted, while an explicit selection remains app-adopted", async () => {
    const database = fakeDatabase();
    await workspaceEnvironment(database, { GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "environment-drive-123" });
    installProvider();

    const envResponse = await adoptRoute.POST(routeRequest("/api/v1/integrations/google/drive/shared-drive/adopt"));
    assert.equal(envResponse.status, 200);
    assert.equal((await envResponse.json()).origin, "env-adopted");

    const explicitResponse = await adoptRoute.POST(routeRequest(
      "/api/v1/integrations/google/drive/shared-drive/adopt",
      ADMIN_EMAIL,
      { driveId: "environment-drive-123" },
    ));
    assert.equal(explicitResponse.status, 200);
    assert.equal((await explicitResponse.json()).origin, "adopted");
    assert.equal(database.state.resources[0].external_id, "environment-drive-123");
    assert.equal(database.state.resources[0].origin, "adopted");
  });
});

test("Drive verification keeps the live and simulation response shapes identical", async () => {
  const liveDatabase = fakeDatabase();
  await workspaceEnvironment(liveDatabase, { GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "live-verify-root" });
  installProvider({ driveNames: { "live-verify-root": "FCI Live Verification" } });

  const liveResponse = await verifyRoute.POST(routeRequest("/api/v1/integrations/google/drive/verify"));
  const liveBody = await liveResponse.json();
  assert.equal(liveResponse.status, 200);
  assert.equal(liveBody.simulated, false);
  assert.deepEqual(nestedKeyShape(liveBody), {
    simulated: null,
    verified: null,
    workspace: { name: null, runtimeMode: null, url: null },
  });

  const simulationDatabase = fakeDatabase();
  simulationEnvironment(simulationDatabase);
  globalThis.fetch = async () => {
    throw new Error("Simulation Drive verification must not call Google.");
  };

  const simulationResponse = await verifyRoute.POST(routeRequest("/api/v1/integrations/google/drive/verify"));
  const simulationBody = await simulationResponse.json();
  assert.equal(simulationResponse.status, 200);
  assert.equal(simulationBody.simulated, true);
  assert.deepEqual(nestedKeyShape(simulationBody), nestedKeyShape(liveBody));
});

test("setup mutations reject non-admin and cross-origin requests before database work", async () => {
  const database = {
    prepare() {
      throw new Error("A denied setup request must not touch D1.");
    },
  };
  simulationEnvironment(database);
  const cases = [
    [adoptRoute, "/api/v1/integrations/google/drive/shared-drive/adopt", {}],
    [ensureRoute, "/api/v1/integrations/google/drive/folders/ensure-roots", {}],
    [renameRoute, "/api/v1/integrations/google/drive/folders/rename", { key: "client-accounts", name: "Clients" }],
    [templateEnsureRoute, "/api/v1/integrations/google/drive/templates/ensure", {}],
    [sheetEnsureRoute, "/api/v1/integrations/google/sheets/ensure", {}],
  ];
  for (const [route, path, body] of cases) {
    const officeResponse = await route.POST(routeRequest(path, OFFICE_EMAIL, body));
    assert.equal(officeResponse.status, 403);
    const crossOriginResponse = await route.POST(routeRequest(path, ADMIN_EMAIL, body, "https://evil.example.test"));
    assert.equal(crossOriginResponse.status, 403);
  }
});

test("simulation adopt → ensure → rename → blueprint-aware project provision is end-to-end", async () => {
  const fixtureBlueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  fixtureBlueprint.drive.sharedDriveName = "FCI Custom Operations";
  fixtureBlueprint.drive.roots.push({
    key: "fixture-operations",
    name: "03_Fixture Operations",
    management: "owner",
    children: [],
  });
  fixtureBlueprint.drive.projectFolders.find((folder) => folder.key === "lead-proposal").name = "01_Custom Lead Package";
  fixtureBlueprint.drive.projectFolders.push({
    key: "field-notes",
    name: "07_Field Notes",
    management: "owner",
    children: [{ key: "daily-logs", name: "Daily Logs", management: "owner", children: [] }],
  });
  fixtureBlueprint.spreadsheets.push(
    { key: "first-run-import", name: "First-run Import", targetFolderKey: "company-admin", management: "owner", role: "import" },
    { key: "project-ledger", name: "Project Ledger", targetFolderKey: "company-admin", management: "owner", role: "reference" },
  );
  const database = fakeDatabase({ blueprint: fixtureBlueprint });
  simulationEnvironment(database);
  globalThis.fetch = async () => {
    throw new Error("Simulation setup must not call Google.");
  };

  const adoptResponse = await adoptRoute.POST(routeRequest("/api/v1/integrations/google/drive/shared-drive/adopt"));
  assert.equal(adoptResponse.status, 200);
  const adopted = await adoptResponse.json();
  assert.equal(adopted.simulated, true);
  assert.equal(adopted.drive.name, "FCI Custom Operations");

  const verifyResponse = await verifyRoute.POST(routeRequest("/api/v1/integrations/google/drive/verify"));
  const verified = await verifyResponse.json();
  assert.equal(verifyResponse.status, 200);
  assert.equal(verified.workspace.name, "FCI Custom Operations (local simulation)");

  const firstEnsureResponse = await ensureRoute.POST(routeRequest("/api/v1/integrations/google/drive/folders/ensure-roots"));
  const firstEnsure = await firstEnsureResponse.json();
  assert.equal(firstEnsureResponse.status, 201);
  assert.deepEqual(firstEnsure.counts, { found: 0, created: 7, adopted: 0 });
  assert.ok(firstEnsure.folders.some((folder) => folder.key === "fixture-operations" && folder.outcome === "created"));

  const secondEnsureResponse = await ensureRoute.POST(routeRequest("/api/v1/integrations/google/drive/folders/ensure-roots"));
  const secondEnsure = await secondEnsureResponse.json();
  assert.equal(secondEnsureResponse.status, 200);
  assert.deepEqual(secondEnsure.counts, { found: 7, created: 0, adopted: 0 });

  const firstSpreadsheetResponse = await sheetEnsureRoute.POST(routeRequest("/api/v1/integrations/google/sheets/ensure"));
  const firstSpreadsheets = await firstSpreadsheetResponse.json();
  assert.equal(firstSpreadsheetResponse.status, 201);
  assert.deepEqual(firstSpreadsheets.counts, { found: 0, created: 3, adopted: 0 });
  assert.deepEqual(firstSpreadsheets.spreadsheets.map(({ key, role }) => ({ key, role })), [
    { key: "client-directory", role: "system-mirror" },
    { key: "first-run-import", role: "import" },
    { key: "project-ledger", role: "reference" },
  ]);

  const secondSpreadsheetResponse = await sheetEnsureRoute.POST(routeRequest("/api/v1/integrations/google/sheets/ensure"));
  const secondSpreadsheets = await secondSpreadsheetResponse.json();
  assert.equal(secondSpreadsheetResponse.status, 200);
  assert.deepEqual(secondSpreadsheets.counts, { found: 3, created: 0, adopted: 0 });

  const systemRenameResponse = await renameRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/folders/rename",
    ADMIN_EMAIL,
    { key: "unsorted-intake", name: "Do not rename" },
  ));
  const systemRename = await systemRenameResponse.json();
  assert.equal(systemRenameResponse.status, 400);
  assert.match(systemRename.error, /system-managed/u);

  const renameResponse = await renameRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/folders/rename",
    ADMIN_EMAIL,
    { key: "projects", name: "02_Custom Projects" },
  ));
  const renamed = await renameResponse.json();
  assert.equal(renameResponse.status, 200);
  assert.equal(renamed.renamed, true);
  assert.equal(renamed.folder.name, "02_Custom Projects");
  assert.equal(
    JSON.parse(database.state.blueprint.blueprint_json).drive.roots.find((folder) => folder.key === "projects").name,
    "02_Custom Projects",
  );

  database.state.project = {
    id: "project-fix02",
    project_number: "FCI2026-902",
    name: "FCI TEST — DO NOT USE",
    client_id: "client-fix02",
    client_code: "FCI TEST",
    client_name: "DO NOT USE",
  };
  const rootResourcesBeforeProvision = database.state.resources.filter((row) => row.resource_type === "drive.folder").length;
  const provisionResponse = await projectDriveRoute.POST(
    routeRequest("/api/v1/projects/project-fix02/drive"),
    { params: Promise.resolve({ projectId: "project-fix02" }) },
  );
  const provisioned = await provisionResponse.json();
  assert.equal(provisionResponse.status, 201);
  assert.equal(provisioned.simulated, true);
  assert.deepEqual(provisioned.simulationPlan.roots.projects, {
    id: "workspace-simulation-folder-projects",
    name: "02_Custom Projects",
  });
  assert.equal(provisioned.simulationPlan.projectFolder.rootId, "workspace-simulation-folder-projects");
  assert.match(provisioned.simulationPlan.projectFolder.path, /^02_Custom Projects \/ 2026 \/ FCI2026-902/u);
  assert.ok(provisioned.simulationPlan.projectFolders.some((path) => path.endsWith("01_Custom Lead Package")));
  assert.ok(provisioned.simulationPlan.projectFolders.some((path) => path.endsWith("07_Field Notes / Daily Logs")));
  assert.equal(provisioned.simulationPlan.projectFolders.some((path) => path.includes("01_Lead & Proposal")), false);
  assert.equal(database.state.resources.filter((row) => row.resource_type === "drive.folder").length, rootResourcesBeforeProvision);
  assert.equal(new Set(database.state.resources.filter((row) => row.resource_type === "drive.folder").map((row) => row.resource_key)).size, rootResourcesBeforeProvision);
  assert.deepEqual(database.state.mappings.map((mapping) => mapping.entityType).sort(), ["client", "project"]);

  const eventTypes = database.state.events.map((event) => event.eventType);
  assert.ok(eventTypes.includes("setup.shared_drive_adopted"));
  assert.equal(eventTypes.filter((eventType) => eventType === "setup.drive_roots_ensured").length, 2);
  assert.equal(eventTypes.filter((eventType) => eventType === "setup.spreadsheets_ensured").length, 2);
  assert.match(database.state.events.find((event) => event.eventType === "setup.spreadsheets_ensured").detail, /outcomes=client-directory:created,first-run-import:created,project-ledger:created/u);
  assert.equal(eventTypes.filter((eventType) => eventType === "setup.folder_renamed").length, 1);
  assert.match(database.state.events.find((event) => event.eventType === "setup.folder_renamed").detail, /key=projects/u);
  assert.equal(eventTypes.filter((eventType) => eventType === "drive.simulation_project_folder_provisioned").length, 1);
});

test("simulation project provisioning returns 409 for an active lease and succeeds after it expires", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  globalThis.fetch = async () => {
    throw new Error("Simulation project provisioning must not call Google.");
  };
  database.state.project = {
    id: "project-active-lease",
    project_number: "FCI2026-903",
    name: "FCI TEST — DO NOT USE",
    client_id: "client-active-lease",
    client_code: "FCI TEST",
    client_name: "DO NOT USE",
  };
  const operationKey = "workspace-simulation:provision-project:project-active-lease";
  database.state.leases.set(operationKey, {
    status: "in-progress",
    leaseExpiresAt: Date.now() + 60_000,
  });

  const conflictResponse = await projectDriveRoute.POST(
    routeRequest("/api/v1/projects/project-active-lease/drive"),
    { params: Promise.resolve({ projectId: "project-active-lease" }) },
  );
  const conflict = await conflictResponse.json();
  assert.equal(conflictResponse.status, 409);
  assert.deepEqual(conflict, {
    error: "A Drive folder request is already in progress for this project. Try again shortly.",
  });
  assert.equal(database.state.mappings.length, 0);
  assert.equal(database.state.activities.length, 0);
  assert.equal(database.state.events.length, 0);
  assert.equal(database.state.leases.get(operationKey).status, "in-progress");
  const leaseInsert = database.state.queries.find((query) => query.sql.startsWith("INSERT INTO google_drive_operations"));
  assert.match(
    leaseInsert.sql,
    /ON CONFLICT\(operation_key\) DO UPDATE[\s\S]+WHERE google_drive_operations\.status != 'in-progress' OR google_drive_operations\.lease_expires_at < \?$/u,
  );

  database.state.leases.get(operationKey).leaseExpiresAt = Date.now() - 1;
  const retryResponse = await projectDriveRoute.POST(
    routeRequest("/api/v1/projects/project-active-lease/drive"),
    { params: Promise.resolve({ projectId: "project-active-lease" }) },
  );
  const retry = await retryResponse.json();
  assert.equal(retryResponse.status, 201, JSON.stringify(retry));
  assert.equal(retry.simulated, true);
  assert.deepEqual(database.state.mappings.map((mapping) => mapping.entityType).sort(), ["client", "project"]);
  assert.equal(database.state.activities.length, 1);
  assert.equal(
    database.state.events.filter((event) => event.eventType === "drive.simulation_project_folder_provisioned").length,
    1,
  );
  assert.equal(database.state.leases.get(operationKey).status, "completed");
  assert.equal(database.state.leases.get(operationKey).leaseExpiresAt, null);
});

test("simulation project provisioning cannot commit after its exact lease is replaced", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  globalThis.fetch = async () => {
    throw new Error("Simulation project provisioning must not call Google.");
  };
  database.state.project = {
    id: "project-stale-lease",
    project_number: "FCI2026-904",
    name: "FCI TEST — DO NOT USE",
    client_id: "client-stale-lease",
    client_code: "FCI TEST",
    client_name: "DO NOT USE",
  };
  database.state.loseLeaseBeforeNextBatch = true;

  const response = await projectDriveRoute.POST(
    routeRequest("/api/v1/projects/project-stale-lease/drive"),
    { params: Promise.resolve({ projectId: "project-stale-lease" }) },
  );
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "project_drive_lease_lost");
  assert.equal(database.state.mappings.length, 0);
  assert.equal(database.state.activities.length, 0);
  assert.equal(database.state.events.length, 0);
  const operation = database.state.leases.get("workspace-simulation:provision-project:project-stale-lease");
  assert.equal(operation.status, "in-progress");
});

test("simulation template ensure creates the central folder, covers owner shells, and is idempotent", async () => {
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.templates.push({
    key: "site-measurement",
    name: "Site Measurement",
    kind: "doc",
    targetFolderKey: "client-profile",
    management: "owner",
  });
  const database = fakeDatabase({ blueprint });
  simulationEnvironment(database);
  database.state.resources.push(
    savedResource({ id: "shared", connectionKey: "workspace-simulation", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: "workspace-simulation-shared-drive", name: "FCI Operations" }),
    savedResource({ id: "company-admin", connectionKey: "workspace-simulation", resourceType: "drive.folder", resourceKey: "company-admin", externalId: "workspace-simulation-folder-company-admin", parentExternalId: "workspace-simulation-shared-drive", name: "00_Company Admin" }),
  );
  globalThis.fetch = async () => {
    throw new Error("Simulation template setup must not call Google.");
  };

  const firstResponse = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201, JSON.stringify(first));
  assert.equal(first.simulated, true);
  assert.deepEqual(first.folder, {
    key: "templates",
    name: "Templates",
    outcome: "created",
    id: "workspace-simulation-folder-templates",
    url: "/settings?section=google-workspace&workspace-simulation=folder-templates",
  });
  assert.deepEqual(first.counts, { found: 0, created: 6, adopted: 0 });
  assert.equal(first.templates.at(-1).key, "site-measurement");
  assert.equal(first.templates.at(-1).targetFolderKey, "client-profile");
  assert.equal(database.state.resources.filter((row) => row.resource_type === "drive.file").length, 6);
  assert.ok(database.state.resources.filter((row) => row.resource_type === "drive.file").every((row) => (
    row.parent_external_id === "workspace-simulation-folder-templates"
  )));
  assert.equal(
    JSON.parse(database.state.resources.find((row) => row.resource_type === "drive.folder" && row.resource_key === "templates").metadata_json).folderKind,
    "templates",
  );

  const secondResponse = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(second.folder.outcome, "found");
  assert.deepEqual(second.counts, { found: 6, created: 0, adopted: 0 });
  assert.equal(database.state.resources.filter((row) => row.resource_type === "drive.file").length, 6);
  assert.equal(
    database.state.resources.find((row) => row.resource_type === "drive.folder" && row.resource_key === "templates").origin,
    "created",
  );
  const events = database.state.events.filter((event) => event.eventType === "setup.templates_ensured");
  assert.equal(events.length, 2);
  assert.match(events[0].detail, /site-measurement:created/u);
  assert.match(events[1].detail, /site-measurement:found/u);
});

test("live template ensure adopts and stamps one Templates folder, then avoids re-uploading", async () => {
  const rootId = "app-shared-drive-123";
  const parentFolderId = "company-admin-folder-123";
  const templateFolderId = "manual-templates-folder-123";
  const database = fakeDatabase({
    blueprint: blueprintModule.seedWorkspaceBlueprint(),
    blueprintConnectionKey: "google-workspace",
  });
  await workspaceEnvironment(database);
  database.state.resources.push(
    savedResource({ id: "shared", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: rootId, name: "FCI Operations" }),
    savedResource({ id: "company-admin", resourceType: "drive.folder", resourceKey: "company-admin", externalId: parentFolderId, parentExternalId: rootId, name: "00_Company Admin" }),
  );
  const provider = installTemplateProvider({ rootId, parentFolderId, templateFolderId });

  const firstResponse = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201, JSON.stringify(first));
  assert.equal(first.simulated, false);
  assert.equal(first.folder.outcome, "adopted");
  assert.deepEqual(first.counts, { found: 0, created: 5, adopted: 0 });
  assert.deepEqual(provider.templateFolder.appProperties, {
    fciRootKey: "templates",
    fciFolderKind: "templates",
  });
  assert.equal(provider.calls.filter((call) => call.url.pathname === `/drive/v3/files/${templateFolderId}` && call.method === "PATCH").length, 1);
  assert.equal(provider.calls.filter((call) => call.url.pathname === "/upload/drive/v3/files" && call.method === "POST").length, 5);
  assert.deepEqual([...provider.files.keys()], [
    "estimate-proposal",
    "installation-work-order",
    "change-order",
    "pre-install-checklist",
    "project-budget",
  ]);
  assert.equal(database.state.resources.filter((row) => row.resource_type === "drive.file").length, 5);
  assert.ok(database.state.resources.filter((row) => row.resource_type === "drive.file").every((row) => row.parent_external_id === templateFolderId));

  const secondResponse = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200, JSON.stringify(second));
  assert.equal(second.folder.outcome, "found");
  assert.deepEqual(second.counts, { found: 5, created: 0, adopted: 0 });
  assert.equal(provider.calls.filter((call) => call.url.pathname === `/drive/v3/files/${templateFolderId}` && call.method === "PATCH").length, 1);
  assert.equal(provider.calls.filter((call) => call.url.pathname === "/upload/drive/v3/files" && call.method === "POST").length, 5);
  assert.match(database.state.events.find((event) => event.eventType === "setup.templates_ensured").detail, /folder=adopted/u);
});

test("live template ensure preserves created provenance while supplementing the registered folder identity", async () => {
  const rootId = "app-shared-drive-123";
  const parentFolderId = "company-admin-folder-123";
  const templateFolderId = "created-templates-folder-123";
  const database = fakeDatabase({
    blueprint: blueprintModule.seedWorkspaceBlueprint(),
    blueprintConnectionKey: "google-workspace",
  });
  await workspaceEnvironment(database);
  database.state.resources.push(
    savedResource({ id: "shared", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: rootId, name: "FCI Operations" }),
    savedResource({ id: "company-admin", resourceType: "drive.folder", resourceKey: "company-admin", externalId: parentFolderId, parentExternalId: rootId, origin: "created", name: "00_Company Admin" }),
    savedResource({ id: "templates", resourceType: "drive.folder", resourceKey: "templates", externalId: templateFolderId, parentExternalId: parentFolderId, origin: "created", name: "Templates" }),
  );
  const provider = installTemplateProvider({ rootId, parentFolderId, templateFolderId });
  provider.templateFolder.appProperties = { fciRootKey: "templates" };

  const firstResponse = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201, JSON.stringify(first));
  assert.equal(first.folder.outcome, "adopted");
  assert.equal(
    database.state.resources.find((row) => row.resource_type === "drive.folder" && row.resource_key === "templates").origin,
    "created",
  );
  assert.deepEqual(provider.templateFolder.appProperties, {
    fciRootKey: "templates",
    fciFolderKind: "templates",
  });
  assert.equal(provider.calls.filter((call) => call.url.pathname === `/drive/v3/files/${templateFolderId}` && call.method === "PATCH").length, 1);

  const secondResponse = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
  assert.equal(secondResponse.status, 200);
  assert.equal(
    database.state.resources.find((row) => row.resource_type === "drive.folder" && row.resource_key === "templates").origin,
    "created",
  );
  assert.equal(provider.calls.filter((call) => call.url.pathname === `/drive/v3/files/${templateFolderId}` && call.method === "PATCH").length, 1);
});

test("template ensure fails closed on its folder prerequisites and exact setup lease", async (t) => {
  await t.test("an environment fallback does not replace Shared Drive adoption", async () => {
    const database = fakeDatabase({
      blueprint: blueprintModule.seedWorkspaceBlueprint(),
      blueprintConnectionKey: "google-workspace",
    });
    await workspaceEnvironment(database, { GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "environment-shared-drive-123" });
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("An unadopted Shared Drive must fail before provider work.");
    };

    const response = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "shared_drive_not_adopted");
    assert.match(body.error, /app-managed registry/u);
    assert.equal(database.state.leases.size, 0);
    assert.equal(database.state.events.length, 0);
    assert.equal(providerCalls, 0);
  });

  await t.test("the blueprint must keep the central Templates folder definition", async () => {
    const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
    blueprint.drive.roots.find((folder) => folder.key === "company-admin").children = [];
    blueprint.templates = [];
    const database = fakeDatabase({ blueprint });
    simulationEnvironment(database);
    database.state.resources.push(savedResource({
      id: "shared",
      connectionKey: "workspace-simulation",
      resourceType: "drive.shared-drive",
      resourceKey: "primary",
      externalId: "workspace-simulation-shared-drive",
      name: "FCI Operations",
    }));

    const response = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "templates_folder_definition_missing");
    assert.match(body.error, /central Templates folder/u);
    assert.equal(database.state.leases.size, 0);
    assert.equal(database.state.events.length, 0);
  });

  await t.test("the central Templates parent must already be registered", async () => {
    const database = fakeDatabase();
    simulationEnvironment(database);
    database.state.resources.push(savedResource({
      id: "shared",
      connectionKey: "workspace-simulation",
      resourceType: "drive.shared-drive",
      resourceKey: "primary",
      externalId: "workspace-simulation-shared-drive",
      name: "FCI Operations",
    }));

    const response = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "templates_parent_folder_missing");
    assert.match(body.error, /Missing parent folder: company-admin/u);
    assert.equal(database.state.leases.size, 0);
  });

  await t.test("an active templates lease blocks registry and provider work", async () => {
    const database = fakeDatabase();
    simulationEnvironment(database);
    database.state.resources.push(
      savedResource({ id: "shared", connectionKey: "workspace-simulation", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: "workspace-simulation-shared-drive", name: "FCI Operations" }),
      savedResource({ id: "company-admin", connectionKey: "workspace-simulation", resourceType: "drive.folder", resourceKey: "company-admin", externalId: "workspace-simulation-folder-company-admin", name: "00_Company Admin" }),
    );
    database.state.leases.set("workspace-simulation:setup:templates", {
      status: "in-progress",
      leaseExpiresAt: Date.now() + 60_000,
    });

    const response = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "workspace_setup_lease_conflict");
    assert.equal(database.state.resources.some((row) => row.resource_type === "drive.file"), false);
    assert.equal(database.state.events.length, 0);
  });

  await t.test("a wrong mid-loop Google template type fails the held setup lease", async () => {
    const rootId = "app-shared-drive-123";
    const parentFolderId = "company-admin-folder-123";
    const templateFolderId = "templates-folder-123";
    const database = fakeDatabase({
      blueprint: blueprintModule.seedWorkspaceBlueprint(),
      blueprintConnectionKey: "google-workspace",
    });
    await workspaceEnvironment(database);
    database.state.resources.push(
      savedResource({ id: "shared", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: rootId, name: "FCI Operations" }),
      savedResource({ id: "company-admin", resourceType: "drive.folder", resourceKey: "company-admin", externalId: parentFolderId, parentExternalId: rootId, origin: "created", name: "00_Company Admin" }),
      savedResource({ id: "templates", resourceType: "drive.folder", resourceKey: "templates", externalId: templateFolderId, parentExternalId: parentFolderId, origin: "created", name: "Templates" }),
    );
    const provider = installTemplateProvider({ rootId, parentFolderId, templateFolderId });
    provider.templateFolder.appProperties = { fciRootKey: "templates", fciFolderKind: "templates" };
    provider.files.set("change-order", {
      id: "wrong-type-change-order",
      name: "Change Order",
      mimeType: "application/pdf",
      parents: [templateFolderId],
      trashed: false,
      webViewLink: "https://drive.google.test/wrong-type-change-order",
      appProperties: { fciTemplateKey: "change-order" },
    });

    const response = await templateEnsureRoute.POST(routeRequest("/api/v1/integrations/google/drive/templates/ensure"));
    const body = await response.json();
    const lease = database.state.leases.get("google-workspace:setup:templates");
    assert.equal(response.status, 409);
    assert.equal(body.code, "invalid_blueprint_template");
    assert.match(body.error, /wrong Google template type/u);
    assert.equal(provider.calls.filter((call) => call.url.pathname === "/upload/drive/v3/files" && call.method === "POST").length, 2);
    assert.deepEqual(
      database.state.resources.filter((row) => row.resource_type === "drive.file").map((row) => row.resource_key),
      ["estimate-proposal", "installation-work-order"],
    );
    assert.equal(lease.status, "failed");
    assert.equal(lease.errorCode, "invalid_blueprint_template");
    assert.equal(lease.leaseExpiresAt, null);
    assert.ok(database.state.queries.some((query) => (
      query.kind === "run"
      && query.sql.startsWith("UPDATE google_drive_operations SET status = 'failed'")
      && query.values[0] === "invalid_blueprint_template"
    )));
    assert.equal(database.state.events.length, 0);
  });
});

test("live spreadsheet ensure creates, adopts, prepares by role, and stays idempotent", async () => {
  const rootId = "app-shared-drive-123";
  const targetFolderId = "company-admin-folder-123";
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.spreadsheets.push(
    { key: "first-run-import", name: "First-run Import", targetFolderKey: "company-admin", management: "owner", role: "import" },
    { key: "project-ledger", name: "Project Ledger", targetFolderKey: "company-admin", management: "owner", role: "reference" },
  );
  const database = fakeDatabase({ blueprint, blueprintConnectionKey: "google-workspace" });
  await workspaceEnvironment(database, { GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,sheets" });
  database.state.resources.push(
    savedResource({ id: "shared", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: rootId, name: "FCI Operations" }),
    savedResource({ id: "company-admin", resourceType: "drive.folder", resourceKey: "company-admin", externalId: targetFolderId, parentExternalId: rootId, name: "00_Company Admin" }),
  );
  const provider = installSpreadsheetProvider({
    rootId,
    targetFolderId,
    existing: [{
      id: "provider-import-first-run",
      name: "First-run Import",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [targetFolderId],
      trashed: false,
      webViewLink: "https://docs.google.test/first-run-import",
      appProperties: { fciResourceKind: "first-run-import" },
    }],
  });

  const firstResponse = await sheetEnsureRoute.POST(routeRequest("/api/v1/integrations/google/sheets/ensure"));
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201, JSON.stringify(first));
  assert.deepEqual(first.counts, { found: 0, created: 2, adopted: 1 });
  assert.deepEqual(first.spreadsheets.map(({ key, outcome }) => ({ key, outcome })), [
    { key: "client-directory", outcome: "created" },
    { key: "first-run-import", outcome: "adopted" },
    { key: "project-ledger", outcome: "created" },
  ]);

  const createBodies = provider.calls
    .filter((call) => call.url.pathname === "/drive/v3/files" && call.method === "POST")
    .map((call) => call.body);
  assert.deepEqual(createBodies.map((body) => body.appProperties), [
    { fciResourceKind: "client-directory" },
    { fciResourceKind: "project-ledger" },
  ]);
  assert.deepEqual([...provider.tabs.get("provider-sheet-client-directory").keys()], ["Client Directory", "Project Register"]);
  assert.deepEqual([...provider.tabs.get("provider-import-first-run").keys()], ["Clients Import", "Projects Import"]);
  assert.equal(provider.calls.some((call) => call.url.hostname === "sheets.googleapis.com" && call.url.pathname.includes("provider-sheet-project-ledger")), false);
  assert.equal(database.state.resources.filter((row) => row.resource_type === "sheets.spreadsheet").length, 3);
  const event = database.state.events.find((candidate) => candidate.eventType === "setup.spreadsheets_ensured");
  assert.equal(event.detail, "found=0;created=2;adopted=1;outcomes=client-directory:created,first-run-import:adopted,project-ledger:created");

  const statusResponse = await sheetStatusRoute.GET(routeRequest("/api/v1/integrations/google/sheets/status", OFFICE_EMAIL));
  const status = await statusResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.headers.get("cache-control"), "no-store");
  assert.equal(status.mirror.source, "app");
  assert.equal(status.mirror.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/provider-sheet-client-directory/edit");

  const callsBeforeSync = provider.calls.length;
  const syncResponse = await sheetSyncRoute.POST(routeRequest("/api/v1/integrations/google/sheets/sync"));
  const sync = await syncResponse.json();
  assert.equal(syncResponse.status, 200, JSON.stringify(sync));
  assert.equal(sync.mirror.source, "app");
  assert.equal(sync.mirror.clients.status, "synced");
  assert.ok(provider.calls.slice(callsBeforeSync).some((call) => (
    call.url.hostname === "sheets.googleapis.com"
    && call.url.pathname.includes("provider-sheet-client-directory")
  )));

  const secondResponse = await sheetEnsureRoute.POST(routeRequest("/api/v1/integrations/google/sheets/ensure"));
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(second.counts, { found: 3, created: 0, adopted: 0 });
  assert.equal(provider.calls.filter((call) => call.url.pathname === "/drive/v3/files" && call.method === "POST").length, 2);
  assert.equal(provider.calls.some((call) => call.method === "DELETE"), false);
});

test("sheet mirror status labels the environment ID as fallback when no app registry row exists", async () => {
  const database = fakeDatabase();
  await workspaceEnvironment(database, {
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,sheets",
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "environment-directory-sheet",
  });
  globalThis.fetch = async () => {
    throw new Error("Sheet status must not call Google.");
  };

  const response = await sheetStatusRoute.GET(routeRequest("/api/v1/integrations/google/sheets/status", OFFICE_EMAIL));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mirror.source, "env");
  assert.equal(body.mirror.configured, true);
  assert.equal(body.mirror.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/environment-directory-sheet/edit");
});

test("spreadsheet ensure preflights target folders and honors its exact setup lease", async (t) => {
  await t.test("missing target fails before lease or provider work", async () => {
    const database = fakeDatabase();
    simulationEnvironment(database);
    database.state.resources.push(savedResource({
      id: "shared",
      connectionKey: "workspace-simulation",
      resourceType: "drive.shared-drive",
      resourceKey: "primary",
      externalId: "workspace-simulation-shared-drive",
      name: "FCI Operations",
    }));
    globalThis.fetch = async () => {
      throw new Error("A missing target preflight must not call Google.");
    };

    const response = await sheetEnsureRoute.POST(routeRequest("/api/v1/integrations/google/sheets/ensure"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "spreadsheet_target_folder_missing");
    assert.match(body.error, /Ensure the Shared Drive root folders/u);
    assert.equal(database.state.leases.size, 0);
    assert.equal(database.state.events.length, 0);
  });

  await t.test("active spreadsheet lease returns 409 without registry writes", async () => {
    const database = fakeDatabase();
    simulationEnvironment(database);
    database.state.resources.push(
      savedResource({ id: "shared", connectionKey: "workspace-simulation", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: "workspace-simulation-shared-drive", name: "FCI Operations" }),
      savedResource({ id: "company-admin", connectionKey: "workspace-simulation", resourceType: "drive.folder", resourceKey: "company-admin", externalId: "workspace-simulation-folder-company-admin", name: "00_Company Admin" }),
    );
    database.state.leases.set("workspace-simulation:setup:spreadsheets", {
      status: "in-progress",
      leaseExpiresAt: Date.now() + 60_000,
    });

    const response = await sheetEnsureRoute.POST(routeRequest("/api/v1/integrations/google/sheets/ensure"));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "workspace_setup_lease_conflict");
    assert.equal(database.state.resources.some((row) => row.resource_type === "sheets.spreadsheet"), false);
  });
});

test("ensure-roots returns 409 while the exact connection setup lease is active", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  globalThis.fetch = async () => {
    throw new Error("Simulation setup must not call Google.");
  };
  const adoptResponse = await adoptRoute.POST(routeRequest("/api/v1/integrations/google/drive/shared-drive/adopt"));
  assert.equal(adoptResponse.status, 200);
  database.state.leases.set("workspace-simulation:setup:drive-roots", {
    status: "in-progress",
    leaseExpiresAt: Date.now() + 60_000,
  });

  const response = await ensureRoute.POST(routeRequest("/api/v1/integrations/google/drive/folders/ensure-roots"));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "workspace_setup_lease_conflict");
  assert.equal(database.state.resources.filter((row) => row.resource_type === "drive.folder").length, 0);
});

test("ensure-roots preserves created provenance while canonicalizing a registered legacy root identity", async () => {
  const rootId = "app-shared-drive-123";
  const clientRootId = "legacy-client-accounts-root";
  const database = fakeDatabase({
    blueprint: blueprintModule.seedWorkspaceBlueprint(),
    blueprintConnectionKey: "google-workspace",
  });
  await workspaceEnvironment(database);
  database.state.resources.push(
    savedResource({ id: "shared", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: rootId, name: "FCI Operations" }),
    savedResource({
      id: "client-root",
      resourceType: "drive.folder",
      resourceKey: "client-accounts",
      externalId: clientRootId,
      parentExternalId: rootId,
      origin: "created",
      name: "01_Client Accounts",
    }),
  );
  const provider = installEnsureProvider(rootId, [{
    id: clientRootId,
    name: "01_Client Accounts",
    mimeType: "application/vnd.google-apps.folder",
    parents: [rootId],
    trashed: false,
    webViewLink: `https://drive.google.test/${clientRootId}`,
    appProperties: { fciWorkspaceFolder: "client-accounts" },
  }]);

  const response = await ensureRoute.POST(routeRequest("/api/v1/integrations/google/drive/folders/ensure-roots"));
  assert.equal(response.status, 201);
  const savedClientRoot = database.state.resources.find((row) => (
    row.resource_type === "drive.folder" && row.resource_key === "client-accounts"
  ));
  assert.equal(savedClientRoot.external_id, clientRootId);
  assert.equal(savedClientRoot.origin, "created");
  assert.deepEqual(provider.folders.find((folder) => folder.id === clientRootId).appProperties, {
    fciRootKey: "client-accounts",
  });
  const identityPatch = provider.calls.find((call) => call.method === "PATCH");
  assert.deepEqual(JSON.parse(String(identityPatch.body)), {
    appProperties: { fciWorkspaceFolder: null, fciRootKey: "client-accounts" },
  });
  assert.equal(provider.calls.some((call) => call.method === "DELETE"), false);
});

test("live rename restores the provider's actual prior name when blueprint CAS loses", async () => {
  const rootId = "app-shared-drive-123";
  const folderId = "client-folder-123";
  const database = fakeDatabase({
    blueprint: blueprintModule.seedWorkspaceBlueprint(),
    blueprintConnectionKey: "google-workspace",
  });
  await workspaceEnvironment(database);
  database.state.resources.push(
    savedResource({ id: "shared", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: rootId, name: "FCI Operations" }),
    savedResource({ id: "folder", resourceType: "drive.folder", resourceKey: "client-accounts", externalId: folderId, parentExternalId: rootId, name: "01_Client Accounts" }),
  );
  database.state.forceBlueprintConflict = true;
  const provider = installRenameProvider({
    folderId,
    rootId,
    initialName: "01_Manual Provider Drift",
  });

  const response = await renameRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/folders/rename",
    ADMIN_EMAIL,
    { key: "client-accounts", name: "01_Custom Clients" },
  ));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "workspace_blueprint_version_conflict");
  assert.deepEqual(provider.patchNames, ["01_Custom Clients", "01_Manual Provider Drift"]);
  assert.equal(provider.currentName(), "01_Manual Provider Drift");
  assert.equal(database.state.events.some((event) => event.eventType === "setup.folder_renamed"), false);
  assert.equal(database.state.events.some((event) => event.eventType === "setup.folder_rename_compensation_failed"), false);
});

test("live rename reports and audits a failed compensation after blueprint CAS loses", async () => {
  const rootId = "app-shared-drive-123";
  const folderId = "client-folder-123";
  const database = fakeDatabase({
    blueprint: blueprintModule.seedWorkspaceBlueprint(),
    blueprintConnectionKey: "google-workspace",
  });
  await workspaceEnvironment(database);
  database.state.resources.push(
    savedResource({ id: "shared", resourceType: "drive.shared-drive", resourceKey: "primary", externalId: rootId, name: "FCI Operations" }),
    savedResource({ id: "folder", resourceType: "drive.folder", resourceKey: "client-accounts", externalId: folderId, parentExternalId: rootId, name: "01_Client Accounts" }),
  );
  database.state.forceBlueprintConflict = true;
  const provider = installRenameProvider({
    folderId,
    rootId,
    initialName: "01_Manual Provider Drift",
    failCompensation: true,
  });

  const response = await renameRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/folders/rename",
    ADMIN_EMAIL,
    { key: "client-accounts", name: "01_Custom Clients" },
  ));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "drive_rename_compensation_failed");
  assert.deepEqual(provider.patchNames, ["01_Custom Clients", "01_Manual Provider Drift"]);
  assert.equal(provider.currentName(), "01_Custom Clients");
  assert.equal(database.state.events.some((event) => event.eventType === "setup.folder_renamed"), false);
  assert.equal(database.state.events.filter((event) => event.eventType === "setup.folder_rename_compensation_failed").length, 1);
});

test("project Drive provisioning reads an app-adopted Shared Drive ID when the environment ID is unset", async () => {
  const rootId = "app-shared-drive-123";
  const mappedFolderId = "existing-project-folder-123";
  const database = fakeDatabase();
  await workspaceEnvironment(database, { GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED: "true" });
  database.state.resources.push(savedResource({
    id: "shared",
    resourceType: "drive.shared-drive",
    resourceKey: "primary",
    externalId: rootId,
    name: "FCI Operations",
  }));
  database.state.project = {
    id: "project-1",
    project_number: "FCI2026-001",
    name: "Test Project",
    client_id: "client-1",
    client_code: "CLI-1",
    client_name: "Test Client",
  };
  database.state.mapping = {
    drive_file_id: mappedFolderId,
    drive_url: `https://drive.google.test/${mappedFolderId}`,
  };
  const calls = installProvider({ fileParents: { [mappedFolderId]: [rootId] } });

  const response = await projectDriveRoute.POST(
    routeRequest("/api/v1/projects/project-1/drive"),
    { params: Promise.resolve({ projectId: "project-1" }) },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.created, false);
  assert.equal(body.driveFolderId, mappedFolderId);
  assert.ok(calls.some((call) => call.url.pathname === `/drive/v3/files/${mappedFolderId}`));
});

test("ensure-roots maps a conflicting same-name blueprint identity to 409 without stealing it", async () => {
  const rootId = "app-shared-drive-123";
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.drive.roots.unshift(
    { key: "first-sibling", name: "03_Duplicate Name", management: "owner", children: [] },
    { key: "second-sibling", name: "03_Duplicate Name", management: "owner", children: [] },
  );
  const database = fakeDatabase({ blueprint, blueprintConnectionKey: "google-workspace" });
  await workspaceEnvironment(database);
  database.state.resources.push(savedResource({
    id: "shared",
    resourceType: "drive.shared-drive",
    resourceKey: "primary",
    externalId: rootId,
    name: "FCI Operations",
  }));
  const provider = installEnsureProvider(rootId);

  const response = await ensureRoute.POST(routeRequest("/api/v1/integrations/google/drive/folders/ensure-roots"));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "drive_folder_identity_conflict");
  assert.deepEqual(provider.folders.map((folder) => folder.appProperties.fciRootKey), ["first-sibling"]);
  assert.equal(provider.calls.some((call) => call.method === "PATCH" || call.method === "DELETE"), false);
  assert.equal(database.state.resources.some((row) => row.resource_key === "second-sibling"), false);
});

test("setup actions reject unknown request fields before setup state changes", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  const adoptResponse = await adoptRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/shared-drive/adopt",
    ADMIN_EMAIL,
    { unexpected: true },
  ));
  assert.equal(adoptResponse.status, 400);
  assert.equal(database.state.resources.length, 0);

  const renameResponse = await renameRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/folders/rename",
    ADMIN_EMAIL,
    { key: "client-accounts", name: "Clients", unexpected: true },
  ));
  assert.equal(renameResponse.status, 400);
  assert.equal(database.state.events.length, 0);

  const ensureResponse = await ensureRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/folders/ensure-roots",
    ADMIN_EMAIL,
    { unexpected: true },
  ));
  assert.equal(ensureResponse.status, 400);
  assert.equal(database.state.resources.length, 0);

  const spreadsheetResponse = await sheetEnsureRoute.POST(routeRequest(
    "/api/v1/integrations/google/sheets/ensure",
    ADMIN_EMAIL,
    { unexpected: true },
  ));
  assert.equal(spreadsheetResponse.status, 400);
  assert.equal(database.state.resources.length, 0);

  const templateResponse = await templateEnsureRoute.POST(routeRequest(
    "/api/v1/integrations/google/drive/templates/ensure",
    ADMIN_EMAIL,
    { unexpected: true },
  ));
  assert.equal(templateResponse.status, 400);
  assert.equal(database.state.resources.length, 0);
});
