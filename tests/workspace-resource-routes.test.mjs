import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-resource-routes", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24731 } },
});

const [authorizeRoute, callbackRoute, resourcesRoute, resetRoute] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/integrations/google/authorize/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/callback/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/setup/resources/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/simulation/reset/route.ts"),
]);

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function routeRequest(path, email, method = "GET", cookies = {}) {
  const url = new URL(path, "https://fci.example.test");
  return {
    url: url.href,
    nextUrl: url,
    headers: new Headers({
      ...(method === "GET" ? {} : { origin: url.origin }),
      "oai-authenticated-user-email": email,
    }),
    cookies: {
      get(name) {
        return cookies[name] === undefined ? undefined : { name, value: cookies[name] };
      },
    },
  };
}

function fakeDatabase({ resources = [], connection = null } = {}) {
  const queries = [];
  const oauthAttempts = [];
  const savedConnections = [];
  let currentConnection = connection;
  const database = {
    queries,
    oauthAttempts,
    savedConnections,
    prepare(sql) {
      const query = { sql, values: [], kind: "prepared" };
      queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async all() {
          query.kind = "all";
          if (/FROM workspace_resources/u.test(sql)) return { results: resources };
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async first() {
          query.kind = "first";
          if (/FROM google_oauth_attempts/u.test(sql)) {
            return oauthAttempts.find((attempt) => attempt.state_hash === query.values[0]) ?? null;
          }
          if (/FROM google_connections/u.test(sql)) return currentConnection;
          return null;
        },
        async run() {
          query.kind = "run";
          if (/^INSERT INTO google_oauth_attempts/u.test(sql)) {
            oauthAttempts.push({
              id: query.values[0],
              connection_key: query.values[1],
              state_hash: query.values[2],
              pkce_verifier_ciphertext: query.values[3],
              browser_nonce_hash: query.values[4],
              initiated_by: query.values[5],
              scopes_json: query.values[6],
              expires_at: query.values[7],
              created_at: query.values[8],
              consumed_at: null,
            });
          }
          if (/^UPDATE google_oauth_attempts SET consumed_at/u.test(sql)) {
            const attempt = oauthAttempts.find((candidate) => (
              candidate.id === query.values[1]
              && candidate.consumed_at === null
              && candidate.expires_at >= query.values[2]
            ));
            if (!attempt) return { meta: { changes: 0 } };
            attempt.consumed_at = query.values[0];
          }
          if (/^INSERT INTO google_connections/u.test(sql)) {
            currentConnection = {
              id: query.values[0],
              connection_key: query.values[1],
              google_subject: query.values[2],
              google_email: query.values[3],
              scopes_json: query.values[4],
              refresh_token_ciphertext: query.values[5],
              key_version: query.values[6],
              status: "connected",
            };
            savedConnections.push(currentConnection);
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return database;
}

function workspaceEnvironment(database, overrides = {}) {
  const encryptionKey = Buffer.alloc(32, 13).toString("base64url");
  const values = {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail,calendar,sheets",
    GOOGLE_WORKSPACE_CLIENT_ID: "workspace-client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "workspace-client-secret-never-return",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: "operations@cherryhillfci.com",
    DB: database,
    ...overrides,
  };
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, values);
}

test("authorize starts OAuth with all four resource IDs absent while retaining OAuth prerequisite denials", async (t) => {
  await t.test("resource IDs may be created after connecting", async () => {
    const database = fakeDatabase();
    workspaceEnvironment(database);

    const response = await authorizeRoute.POST(routeRequest(
      "/api/v1/integrations/google/authorize",
      ADMIN_EMAIL,
      "POST",
    ));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(body.authorizationUrl, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/u);
    assert.equal(database.queries.filter((query) => /INSERT INTO google_oauth_attempts/u.test(query.sql)).length, 1);
    assert.equal(database.queries.filter((query) => /INSERT INTO google_integration_events/u.test(query.sql)).length, 1);
  });

  for (const prerequisite of [
    ["GOOGLE_WORKSPACE_CLIENT_ID", "Google OAuth client ID"],
    ["GOOGLE_WORKSPACE_CLIENT_SECRET", "Google OAuth client secret"],
  ]) {
    await t.test(`missing ${prerequisite[0]} remains a 409`, async () => {
      const database = fakeDatabase();
      workspaceEnvironment(database, { [prerequisite[0]]: undefined });

      const response = await authorizeRoute.POST(routeRequest(
        "/api/v1/integrations/google/authorize",
        ADMIN_EMAIL,
        "POST",
      ));
      const body = await response.json();

      assert.equal(response.status, 409);
      assert.ok(body.missing.includes(prerequisite[1]));
      assert.equal(database.queries.some((query) => /INSERT INTO google_oauth_attempts/u.test(query.sql)), false);
    });
  }
});

test("OAuth callback completes the connect-first round trip without configured resource IDs", async () => {
  const database = fakeDatabase();
  workspaceEnvironment(database);

  const authorizeResponse = await authorizeRoute.POST(routeRequest(
    "/api/v1/integrations/google/authorize",
    ADMIN_EMAIL,
    "POST",
  ));
  const authorizeBody = await authorizeResponse.json();
  const authorizationUrl = new URL(authorizeBody.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");
  const nonceMatch = authorizeResponse.headers.get("set-cookie")?.match(/fci_google_oauth_nonce=([^;]+)/u);

  assert.equal(authorizeResponse.status, 200);
  assert.ok(state);
  assert.ok(nonceMatch);
  assert.equal(database.oauthAttempts.length, 1);

  const providerCalls = [];
  const callbackFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    providerCalls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "FCI_TEST_ACCESS_TOKEN",
        refresh_token: "FCI_TEST_REFRESH_TOKEN",
        scope: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/spreadsheets",
        ].join(" "),
      });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return Response.json({
        sub: "FCI_TEST_GOOGLE_SUBJECT",
        email: "operations@cherryhillfci.com",
        email_verified: true,
      });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };

  try {
    const response = await callbackRoute.GET(routeRequest(
      `/api/v1/integrations/google/callback?code=FCI_TEST_CODE&state=${encodeURIComponent(state)}`,
      ADMIN_EMAIL,
      "GET",
      { fci_google_oauth_nonce: decodeURIComponent(nonceMatch[1]) },
    ));

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "https://fci.example.test/settings?section=google-workspace&google=connected",
    );
    assert.equal(database.oauthAttempts[0].consumed_at === null, false);
    assert.equal(database.savedConnections.length, 1);
    assert.equal(database.savedConnections[0].google_email, "operations@cherryhillfci.com");
    assert.equal(database.savedConnections[0].status, "connected");
    assert.deepEqual(
      providerCalls.map((call) => call.url),
      [
        "https://oauth2.googleapis.com/token",
        "https://openidconnect.googleapis.com/v1/userinfo",
      ],
    );
    assert.equal(providerCalls.some((call) => call.url.includes("/drive/v3/")), false);
    assert.equal(
      database.queries.some((query) => (
        /^INSERT INTO google_integration_events/u.test(query.sql)
        && query.values.includes("oauth.connected")
      )),
      true,
    );
  } finally {
    globalThis.fetch = callbackFetch;
  }
});

test("OAuth callback keeps setup-needed denial when OAuth credentials are incomplete", async (t) => {
  for (const key of ["GOOGLE_WORKSPACE_CLIENT_ID", "GOOGLE_WORKSPACE_CLIENT_SECRET"]) {
    await t.test(key, async () => {
      const database = fakeDatabase();
      workspaceEnvironment(database, { [key]: undefined });
      let providerCalls = 0;
      const callbackFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        providerCalls += 1;
        throw new Error("An incomplete callback must not call Google.");
      };

      try {
        const response = await callbackRoute.GET(routeRequest(
          "/api/v1/integrations/google/callback?code=FCI_TEST_CODE&state=FCI_TEST_STATE",
          ADMIN_EMAIL,
          "GET",
          { fci_google_oauth_nonce: "FCI_TEST_NONCE" },
        ));

        assert.equal(response.status, 302);
        assert.equal(
          response.headers.get("location"),
          "https://fci.example.test/settings?section=google-workspace&google=setup-needed",
        );
        assert.equal(providerCalls, 0);
        assert.equal(database.savedConnections.length, 0);
      } finally {
        globalThis.fetch = callbackFetch;
      }
    });
  }
});

test("resources GET is admin-only, source-tagged, no-store, masked, and contains no secrets", async () => {
  const configuredSecret = "configured-client-secret-must-not-appear";
  const configuredEncryptionKey = Buffer.alloc(32, 17).toString("base64url");
  const resources = [{
    id: "resource-directory",
    connection_key: "google-workspace",
    resource_type: "sheets.spreadsheet",
    resource_key: "client-directory",
    external_id: "app-directory-sheet",
    parent_external_id: "app-shared-drive",
    external_url: "https://docs.google.com/spreadsheets/d/app-directory-sheet/edit",
    origin: "created",
    metadata_json: "{}",
    created_by: ADMIN_EMAIL,
    created_at: 1_790_000_000_000,
    updated_at: 1_790_000_001_000,
  }];
  const connection = {
    id: "connection-1",
    google_email: "operations@cherryhillfci.com",
    refresh_token_ciphertext: "encrypted-token-must-not-appear",
    key_version: "1",
    scopes_json: JSON.stringify([
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
    ]),
    status: "connected",
  };
  const database = fakeDatabase({ resources, connection });
  workspaceEnvironment(database, {
    GOOGLE_WORKSPACE_CLIENT_SECRET: configuredSecret,
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: configuredEncryptionKey,
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "env-shared-drive",
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "env-directory-sheet",
    GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID: "env-client-calendar",
    GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID: "env-field-calendar",
  });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The setup resource reader must not call Google.");
  };

  const response = await resourcesRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/resources",
    ADMIN_EMAIL,
  ));
  const serialized = await response.text();
  const body = JSON.parse(serialized);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(fetchCalls, 0);
  assert.equal(body.connectReady, true);
  assert.equal(body.simulation, false);
  assert.equal(body.identity.connectionAccount, "op•••@cherryhillfci.com");
  assert.equal(body.identity.intakeMailboxMatches, true);
  assert.deepEqual(body.identity.allowedDomains, ["cherryhillfci.com"]);
  assert.equal(body.identity.mode, "workspace");
  assert.equal(body.resources.length, 4);
  assert.deepEqual(
    body.resources.find((resource) => resource.key === "client-directory"),
    {
      key: "client-directory",
      label: "Client directory spreadsheet",
      blueprintName: "FCI Operations Directory",
      externalId: "app-directory-sheet",
      source: "app",
      origin: "created",
      url: "https://docs.google.com/spreadsheets/d/app-directory-sheet/edit",
      updatedAt: 1_790_000_001_000,
      state: "Created",
    },
  );
  assert.equal(body.resources.find((resource) => resource.key === "primary").state, "Found");
  for (const forbidden of [configuredSecret, configuredEncryptionKey, connection.refresh_token_ciphertext]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("resources identity compares the actual stored connection account to the intake mailbox", async () => {
  const database = fakeDatabase({
    connection: {
      google_email: "other-account@cherryhillfci.com",
      status: "connected",
    },
  });
  workspaceEnvironment(database, {
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "env-shared-drive",
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "env-directory-sheet",
    GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID: "env-client-calendar",
    GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID: "env-field-calendar",
  });

  const response = await resourcesRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/resources",
    ADMIN_EMAIL,
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.identity.connectionAccount, "ot•••@cherryhillfci.com");
  assert.equal(body.identity.intakeMailboxMatches, false);
  const identityQueries = database.queries.filter((query) => /FROM google_connections/u.test(query.sql));
  assert.equal(identityQueries.length, 1);
  assert.match(identityQueries[0].sql, /^SELECT google_email, status FROM google_connections/u);
  assert.doesNotMatch(identityQueries[0].sql, /refresh_token|scopes_json|google_subject/u);
});

test("resources GET returns 403 for an Office user before schema or database work", async () => {
  const database = {
    prepare() {
      throw new Error("A denied resources request must not touch D1.");
    },
  };
  workspaceEnvironment(database);

  const response = await resourcesRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/resources",
    OFFICE_EMAIL,
  ));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "An FCI administrator must complete this action." });
});

test("simulation reset deletes registry rows only for the simulation connection key", async () => {
  const database = fakeDatabase();
  workspaceEnvironment(database, {
    NODE_ENV: "development",
    GOOGLE_INTEGRATION_MODE: "simulation",
  });

  const response = await resetRoute.POST(routeRequest(
    "/api/v1/integrations/google/simulation/reset",
    ADMIN_EMAIL,
    "POST",
  ));
  const registryDeletes = database.queries.filter((query) => /DELETE FROM workspace_resources/u.test(query.sql));
  const blueprintDeletes = database.queries.filter((query) => /DELETE FROM workspace_blueprints/u.test(query.sql));

  assert.equal(response.status, 200);
  assert.equal(registryDeletes.length, 1);
  assert.deepEqual(registryDeletes[0].values, ["workspace-simulation"]);
  assert.match(registryDeletes[0].sql, /WHERE connection_key = \?/u);
  assert.doesNotMatch(registryDeletes[0].sql, /google-workspace/u);
  assert.equal(blueprintDeletes.length, 1);
  assert.deepEqual(blueprintDeletes[0].values, ["workspace-simulation"]);
  assert.match(blueprintDeletes[0].sql, /WHERE connection_key = \?/u);

  const resourcesResponse = await resourcesRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/resources",
    ADMIN_EMAIL,
  ));
  const resourcesBody = await resourcesResponse.json();
  assert.equal(resourcesResponse.status, 200);
  assert.ok(resourcesBody.resources.every((resource) => resource.state === "Simulated"));
  assert.ok(resourcesBody.resources.every((resource) => resource.source === "none"));
});
