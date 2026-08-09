import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const APP_ORIGIN = "https://fci.example.test";
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-reconcile-route", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false },
});

const [route, blueprintModule, oauthModule] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/integrations/google/setup/reconcile/route.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth.ts"),
]);

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

beforeEach(() => {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  globalThis.fetch = async () => {
    throw new Error("Workspace simulation reconciliation must never contact Google.");
  };
});

function routeRequest({
  email = ADMIN_EMAIL,
  body = {},
  origin = APP_ORIGIN,
} = {}) {
  const url = new URL("/api/v1/integrations/google/setup/reconcile", APP_ORIGIN);
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

function resource({
  id,
  type,
  key,
  externalId,
  parentExternalId = null,
  name,
  management = "owner",
  connectionKey = "workspace-simulation",
}) {
  return {
    id,
    connection_key: connectionKey,
    resource_type: type,
    resource_key: key,
    external_id: externalId,
    parent_external_id: parentExternalId,
    external_url: `https://drive.google.test/${externalId}`,
    origin: "created",
    metadata_json: JSON.stringify({ name, management }),
    created_by: ADMIN_EMAIL,
    created_at: 1,
    updated_at: 1,
  };
}

function fakeDatabase({ resources, blueprint = blueprintModule.seedWorkspaceBlueprint() }) {
  const state = { resources, events: [], queries: [], connection: null };
  return {
    state,
    prepare(sql) {
      const query = { sql, values: [] };
      state.queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async all() {
          if (/FROM workspace_resources WHERE connection_key = \?/u.test(sql)) {
            return {
              results: state.resources.filter((row) => row.connection_key === query.values[0]),
            };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async first() {
          if (/FROM workspace_settings WHERE id = \?/u.test(sql)) return null;
          if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) {
            return {
              id: "blueprint-fixture",
              connection_key: query.values[0],
              version: 4,
              blueprint_json: JSON.stringify(blueprint),
              created_by: ADMIN_EMAIL,
              created_at: 1,
              updated_by: ADMIN_EMAIL,
              updated_at: 1,
            };
          }
          if (/FROM google_connections WHERE connection_key = \?/u.test(sql)) {
            return state.connection;
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          if (sql.startsWith("UPDATE google_connections SET")) {
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO google_drive_operations")) {
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE google_drive_operations SET")) {
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO google_integration_events")) {
            const [
              id,
              connectionKey,
              eventType,
              actor,
              entityType,
              entityId,
              detail,
              createdAt,
            ] = query.values;
            state.events.push({
              id,
              connectionKey,
              eventType,
              actor,
              entityType,
              entityId,
              detail,
              createdAt,
            });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

function simulationEnvironment(database) {
  Object.assign(workerEnvironment, {
    NODE_ENV: "development",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: database,
  });
}

async function workspaceEnvironment(database, overrides = {}) {
  const encryptionKey = Buffer.alloc(32, 23).toString("base64url");
  const values = {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,sheets",
    GOOGLE_WORKSPACE_CLIENT_ID: "workspace-client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "workspace-client-secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: `${APP_ORIGIN}/api/v1/integrations/google/callback`,
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "shared-drive-live",
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "env-client-directory-sheet",
    ...overrides,
  };
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, values, { DB: database });
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

function adoptedSimulationResources() {
  return [
    resource({
      id: "shared-drive-row",
      type: "drive.shared-drive",
      key: "primary",
      externalId: "sim-shared-drive",
      name: "FCI Operations",
    }),
    resource({
      id: "client-accounts-row",
      type: "drive.folder",
      key: "client-accounts",
      externalId: "sim-client-accounts",
      parentExternalId: "sim-shared-drive",
      name: "Client Accounts renamed in Google",
    }),
  ];
}

test("simulation reconcile is admin/origin/bounded and emits a no-store count audit without Google calls", async (t) => {
  await t.test("successful review-only read", async () => {
    const database = fakeDatabase({ resources: adoptedSimulationResources() });
    simulationEnvironment(database);
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("Simulation must not call Google.");
    };

    const response = await route.POST(routeRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.reconciled, true);
    assert.equal(body.simulated, true);
    assert.equal(body.blueprintVersion, 4);
    const renamed = body.drift.find((item) => item.key === "client-accounts");
    assert.equal(renamed.state, "renamed");
    assert.deepEqual(renamed.actions, ["rename-drive", "adopt-blueprint-name"]);
    assert.equal(providerCalls, 0);
    assert.equal(database.state.events.length, 1);
    assert.equal(database.state.events[0].eventType, "setup.reconcile_run");
    assert.equal(database.state.events[0].actor, ADMIN_EMAIL);
    assert.match(
      database.state.events[0].detail,
      /^missing=\d+;renamed=1;unmanaged=0;in_sync=0$/u,
    );
  });

  await t.test("office user is denied before persistence", async () => {
    const database = fakeDatabase({ resources: adoptedSimulationResources() });
    simulationEnvironment(database);
    const response = await route.POST(routeRequest({ email: OFFICE_EMAIL }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(database.state.queries.length, 0);
  });

  await t.test("cross-origin request is denied before persistence", async () => {
    const database = fakeDatabase({ resources: adoptedSimulationResources() });
    simulationEnvironment(database);
    const response = await route.POST(routeRequest({ origin: "https://attacker.example" }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(database.state.queries.length, 0);
  });

  await t.test("unknown input is rejected without an audit", async () => {
    const database = fakeDatabase({ resources: adoptedSimulationResources() });
    simulationEnvironment(database);
    const response = await route.POST(routeRequest({ body: { repairEverything: true } }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.error, "Provide no fields when checking Workspace drift.");
    assert.equal(database.state.events.length, 0);
  });
});

test("reconcile fails closed until the Shared Drive is adopted", async () => {
  const database = fakeDatabase({ resources: [] });
  simulationEnvironment(database);

  const response = await route.POST(routeRequest());
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.code, "shared_drive_not_adopted");
  assert.equal(database.state.events.length, 0);
});

test("live reconcile reads an environment-adopted client sheet by direct ID and never offers duplicate creation", async () => {
  const database = fakeDatabase({
    resources: [resource({
      id: "shared-drive-row",
      type: "drive.shared-drive",
      key: "primary",
      externalId: "shared-drive-live",
      name: "FCI Operations",
      connectionKey: "google-workspace",
    })],
  });
  await workspaceEnvironment(database);
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, method: String(init.method ?? "GET").toUpperCase() });
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    if (url.pathname === "/drive/v3/files/shared-drive-live") {
      return Response.json({
        id: "shared-drive-live",
        name: "FCI Operations",
        mimeType: "application/vnd.google-apps.folder",
        parents: [],
        trashed: false,
        webViewLink: "https://drive.google.test/shared-drive-live",
        appProperties: {},
      });
    }
    if (url.pathname === "/drive/v3/files/env-client-directory-sheet") {
      return Response.json({
        id: "env-client-directory-sheet",
        name: "Legacy environment directory",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: ["shared-drive-live"],
        trashed: false,
        webViewLink: "https://drive.google.test/env-client-directory-sheet",
        appProperties: {},
      });
    }
    if (url.pathname === "/drive/v3/files") return Response.json({ files: [] });
    throw new Error(`Unexpected live reconcile request: ${init.method ?? "GET"} ${url}`);
  };

  const response = await route.POST(routeRequest());
  const body = await response.json();

  assert.equal(
    response.status,
    200,
    JSON.stringify({
      body,
      calls: calls.map(({ url, method }) => `${method} ${url.href}`),
      queries: database.state.queries.map(({ sql }) => sql),
    }),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.simulated, false);
  const clientDirectoryRows = body.drift.filter((item) => item.key === "client-directory");
  assert.equal(clientDirectoryRows.some((item) => item.state === "missing"), false);
  assert.equal(clientDirectoryRows.some((item) => item.state === "unmanaged"), true);
  assert.deepEqual(clientDirectoryRows.flatMap((item) => item.actions), []);
  assert.equal(
    calls.some(({ url, method }) => (
      method === "GET" && url.pathname === "/drive/v3/files/env-client-directory-sheet"
    )),
    true,
  );
  assert.equal(calls.some(({ method }) => method !== "GET" && method !== "POST"), false);
  assert.equal(database.state.events.at(-1).eventType, "setup.reconcile_run");
});

test("live reconcile reports registered Calendar drift unavailable before any provider read", async () => {
  const database = fakeDatabase({
    resources: [
      resource({
        id: "shared-drive-row",
        type: "drive.shared-drive",
        key: "primary",
        externalId: "shared-drive-live",
        name: "FCI Operations",
        connectionKey: "google-workspace",
      }),
      resource({
        id: "calendar-row",
        type: "calendar.calendar",
        key: "client-appointments",
        externalId: "appointments@example.com",
        name: "FCI Client Appointments",
        management: "system",
        connectionKey: "google-workspace",
      }),
    ],
  });
  await workspaceEnvironment(database, {
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive",
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "",
  });
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Calendar capability denial must precede provider access.");
  };

  const response = await route.POST(routeRequest());
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.code, "calendar_reconcile_unavailable");
  assert.match(body.error, /Calendar reconciliation is unavailable/u);
  assert.equal(providerCalls, 0);
  assert.equal(database.state.events.length, 0);
});
