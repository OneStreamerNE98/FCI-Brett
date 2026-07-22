import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const CONNECTION_EMAIL = "operations@cherryhillfci.com";
const TOKEN_KEY = Buffer.alloc(32, 0x31).toString("base64url");
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

const ENV_IDS = Object.freeze({
  drive: "env-shared-drive",
  sheet: "env-client-directory",
  appointments: "env-client-appointments",
  fieldSchedule: "env-field-schedule",
});
const APP_IDS = Object.freeze({
  drive: "app-shared-drive",
  sheet: "app-client-directory",
  appointments: "app-client-appointments",
  fieldSchedule: "app-field-schedule",
});

const state = {
  connection: null,
  providerCalls: [],
  queries: [],
  resourceFailure: false,
  resources: [],
  tokenFailure: false,
};

const database = {
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
          if (state.resourceFailure) throw new Error("FCI TEST registry read failed");
          return { results: state.resources };
        }
        return { results: [] };
      },
      async first() {
        query.kind = "first";
        if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) return null;
        if (/FROM google_connections WHERE connection_key = \?/u.test(sql)) return state.connection;
        return null;
      },
      async run() {
        query.kind = "run";
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  },
  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  },
};

const workerEnvironment = { DB: database };
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/fix01-effective-config-consumers",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false },
});

const [
  oauthSites,
  gmailHelpers,
  calendarEventsRoute,
  calendarHoldRoute,
  clientsRoute,
  projectsRoute,
  workspaceRoute,
] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/gmail/_route-helpers.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/events/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/test-hold/route.ts"),
  vite.ssrLoadModule("/app/api/v1/clients/route.ts"),
  vite.ssrLoadModule("/app/api/v1/projects/route.ts"),
  vite.ssrLoadModule("/app/api/v1/google-workspace/route.ts"),
]);

const refreshTokenCiphertext = await oauthSites.encryptGoogleSecret(
  "FCI_TEST_REFRESH_TOKEN",
  TOKEN_KEY,
  "google-connection:google-workspace:refresh",
);

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function resourceRow(resourceType, resourceKey, externalId) {
  return {
    id: `resource-${resourceKey}`,
    connection_key: "google-workspace",
    resource_type: resourceType,
    resource_key: resourceKey,
    external_id: externalId,
    parent_external_id: null,
    external_url: null,
    origin: "adopted",
    metadata_json: "{}",
    created_by: ADMIN_EMAIL,
    created_at: 1_790_000_000_000,
    updated_at: 1_790_000_001_000,
  };
}

function appResources() {
  return [
    resourceRow("drive.shared-drive", "primary", APP_IDS.drive),
    resourceRow("sheets.spreadsheet", "client-directory", APP_IDS.sheet),
    resourceRow("calendar.calendar", "client-appointments", APP_IDS.appointments),
    resourceRow("calendar.calendar", "field-schedule", APP_IDS.fieldSchedule),
  ];
}

function configure({
  resources = [],
  ids = ENV_IDS,
  connected = true,
  resourceFailure = false,
  tokenFailure = false,
  overrides = {},
} = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: ADMIN_EMAIL,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail,calendar,sheets",
    GOOGLE_WORKSPACE_CLIENT_ID: "workspace-client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "FCI_TEST_CLIENT_SECRET",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: CONNECTION_EMAIL,
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: CONNECTION_EMAIL,
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: ids?.drive,
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: ids?.sheet,
    GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID: ids?.appointments,
    GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID: ids?.fieldSchedule,
    DB: database,
    ...overrides,
  });
  state.connection = connected ? {
    id: "connection-1",
    google_email: CONNECTION_EMAIL,
    refresh_token_ciphertext: refreshTokenCiphertext,
    key_version: "1",
    scopes_json: JSON.stringify([
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
    ]),
    status: "connected",
  } : null;
  state.providerCalls = [];
  state.queries = [];
  state.resourceFailure = resourceFailure;
  state.resources = resources;
  state.tokenFailure = tokenFailure;
}

function officeRequest(path, method = "GET", body) {
  const url = new URL(path, "https://fci.example.test");
  return new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: url.origin, "content-type": "application/json" }),
      "oai-authenticated-user-email": ADMIN_EMAIL,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  state.providerCalls.push({ url, init });
  if (url === "https://oauth2.googleapis.com/token") {
    if (state.tokenFailure) {
      return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    }
    return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN" });
  }
  if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) {
    if (init.method === "POST") {
      return Response.json({
        id: "FCI_TEST_EVENT",
        summary: "FCI Operations — Workspace test appointment",
        status: "confirmed",
        htmlLink: "https://calendar.google.com/calendar/event?eid=FCI_TEST_EVENT",
        start: { dateTime: "2026-07-22T15:00:00.000Z" },
        end: { dateTime: "2026-07-22T15:30:00.000Z" },
      });
    }
    return Response.json({ items: [] });
  }
  throw new Error(`Unexpected provider request: ${url}`);
};

function calendarProviderUrls() {
  return state.providerCalls
    .map((call) => call.url)
    .filter((url) => url.startsWith("https://www.googleapis.com/calendar/v3/calendars/"));
}

function calendarProviderCalls() {
  return state.providerCalls.filter((call) => (
    call.url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")
  ));
}

function writtenIntegrationEvents() {
  return state.queries
    .filter((query) => query.kind === "run" && /^INSERT INTO google_integration_events/u.test(query.sql))
    .map((query) => ({
      eventType: query.values[2],
      entityType: query.values[4],
      entityId: query.values[5],
      detail: query.values[6],
    }));
}

function failedDirectoryEvent() {
  return state.queries.find((query) => (
    query.kind === "run"
    && /^INSERT INTO google_integration_events/u.test(query.sql)
    && query.values[2] === "sheets.directory.failed"
  ));
}

test("Gmail resolves app-saved resources before environment values and preserves env-only fallback", async () => {
  configure({ resources: appResources(), ids: null });
  const appOnly = await gmailHelpers.getWorkspaceGmailClient();
  assert.equal(appOnly.config.oauthReady, true);
  assert.equal(appOnly.config.drive.rootFolderId, APP_IDS.drive);
  assert.equal(appOnly.config.clientDirectorySheetId, APP_IDS.sheet);
  assert.equal(appOnly.config.clientAppointmentsCalendarId, APP_IDS.appointments);
  assert.equal(appOnly.config.fieldScheduleCalendarId, APP_IDS.fieldSchedule);

  configure({ resources: appResources(), ids: ENV_IDS });
  const app = await gmailHelpers.getWorkspaceGmailClient();
  assert.equal(app.config.oauthReady, true);
  assert.equal(app.config.drive.rootFolderId, APP_IDS.drive);
  assert.equal(app.config.clientDirectorySheetId, APP_IDS.sheet);
  assert.equal(app.config.clientAppointmentsCalendarId, APP_IDS.appointments);
  assert.equal(app.config.fieldScheduleCalendarId, APP_IDS.fieldSchedule);
  assert.equal(state.providerCalls.filter((call) => call.url === "https://oauth2.googleapis.com/token").length, 1);

  configure({ resources: [], ids: ENV_IDS });
  const environment = await gmailHelpers.getWorkspaceGmailClient();
  assert.equal(environment.config.oauthReady, true);
  assert.equal(environment.config.drive.rootFolderId, ENV_IDS.drive);
  assert.equal(environment.config.clientDirectorySheetId, ENV_IDS.sheet);
  assert.equal(environment.config.clientAppointmentsCalendarId, ENV_IDS.appointments);
});

test("both Calendar routes use the app-saved calendar and retain env-only fallback", async () => {
  for (const fixture of [
    { name: "app only", resources: appResources(), ids: null, expected: APP_IDS.appointments },
    { name: "app over environment", resources: appResources(), ids: ENV_IDS, expected: APP_IDS.appointments },
    { name: "environment", resources: [], ids: ENV_IDS, expected: ENV_IDS.appointments },
  ]) {
    configure(fixture);
    const eventsResponse = await calendarEventsRoute.GET(officeRequest(
      "/api/v1/integrations/google/calendar/events",
    ));
    assert.equal(eventsResponse.status, 200, `${fixture.name} list response`);
    assert.equal(calendarProviderUrls().length, 1);
    assert.match(calendarProviderUrls()[0], new RegExp(`/calendars/${fixture.expected}/events\\?`));
    assert.equal(writtenIntegrationEvents().length, 1);
    assert.equal(writtenIntegrationEvents()[0].eventType, "calendar.workspace_events_listed");
    assert.equal(writtenIntegrationEvents()[0].entityType, "calendar");
    assert.equal(writtenIntegrationEvents()[0].entityId, fixture.expected);
    assert.match(writtenIntegrationEvents()[0].detail, /^window=.+\/.+;count=0$/u);

    state.providerCalls = [];
    const holdResponse = await calendarHoldRoute.POST(officeRequest(
      "/api/v1/integrations/google/calendar/test-hold",
      "POST",
      {},
    ));
    assert.equal(holdResponse.status, 201, `${fixture.name} hold response`);
    assert.equal(calendarProviderUrls().length, 2);
    assert.match(calendarProviderUrls()[0], new RegExp(`/calendars/${fixture.expected}/events\\?`));
    assert.match(calendarProviderUrls()[0], /privateExtendedProperty=fciTestHoldKey%3D/u);
    assert.equal(calendarProviderCalls()[0].init.method, undefined);
    assert.equal(calendarProviderCalls()[1].init.method, "POST");
    assert.deepEqual(
      writtenIntegrationEvents().map((event) => ({ eventType: event.eventType, entityType: event.entityType })),
      [
        { eventType: "calendar.workspace_events_listed", entityType: "calendar" },
        { eventType: "calendar.workspace_hold_created", entityType: "calendar_event" },
      ],
    );
    assert.match(writtenIntegrationEvents()[1].detail, /^start=.+;end=.+;visibility=private;attendees=none;notifications=none$/u);
  }
});

async function assertCreationMirror(route, path, body, resources, ids, expectedSheetId) {
  configure({ resources, ids, tokenFailure: true });
  const response = await route.POST(officeRequest(path, "POST", body));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.sheetSync.status, "pending");
  assert.equal(failedDirectoryEvent()?.values[5], expectedSheetId);
}

test("client and project create-time mirroring use app-saved sheet IDs and env-only fallback", async () => {
  for (const creation of [
    {
      route: clientsRoute,
      path: "/api/v1/clients",
      body: { name: "FCI TEST — DO NOT USE client" },
    },
    {
      route: projectsRoute,
      path: "/api/v1/projects",
      body: { clientId: "FCI_TEST_CLIENT", name: "FCI TEST — DO NOT USE project" },
    },
  ]) {
    await assertCreationMirror(
      creation.route,
      creation.path,
      creation.body,
      appResources(),
      null,
      APP_IDS.sheet,
    );
    await assertCreationMirror(
      creation.route,
      creation.path,
      creation.body,
      appResources(),
      ENV_IDS,
      APP_IDS.sheet,
    );
    await assertCreationMirror(
      creation.route,
      creation.path,
      creation.body,
      [],
      ENV_IDS,
      ENV_IDS.sheet,
    );
  }
});

test("effective-config lookup stays inside the optional post-create mirror boundary", async () => {
  for (const creation of [
    {
      durableInsert: /^INSERT INTO clients/u,
      route: clientsRoute,
      path: "/api/v1/clients",
      body: { name: "FCI TEST — DO NOT USE registry failure client" },
    },
    {
      durableInsert: /^INSERT INTO projects/u,
      route: projectsRoute,
      path: "/api/v1/projects",
      body: { clientId: "FCI_TEST_CLIENT", name: "FCI TEST — DO NOT USE registry failure project" },
    },
  ]) {
    configure({ resources: appResources(), ids: null, resourceFailure: true });
    const response = await creation.route.POST(officeRequest(creation.path, "POST", creation.body));
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.sheetSync.status, "pending");
    const durableInsertIndex = state.queries.findIndex((query) => creation.durableInsert.test(query.sql));
    const registryReadIndex = state.queries.findIndex((query) => /FROM workspace_resources/u.test(query.sql));
    assert.ok(durableInsertIndex >= 0);
    assert.ok(registryReadIndex > durableInsertIndex);
  }
});

test("Workspace summary separates connect-ready credentials from fully configured resources", async () => {
  configure({ resources: [], ids: null, connected: false });
  const connectReadyResponse = await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"));
  const connectReady = await connectReadyResponse.json();
  assert.equal(connectReadyResponse.status, 200);
  assert.equal(connectReady.credentialsPresent, true);
  assert.equal(connectReady.configured, false);

  configure({ resources: appResources(), ids: null, connected: false });
  const configuredResponse = await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"));
  const configured = await configuredResponse.json();
  assert.equal(configuredResponse.status, 200);
  assert.equal(configured.credentialsPresent, true);
  assert.equal(configured.configured, true);

  configure({
    resources: appResources(),
    ids: null,
    connected: false,
    overrides: { GOOGLE_WORKSPACE_CLIENT_SECRET: undefined },
  });
  const missingCredentialResponse = await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"));
  const missingCredential = await missingCredentialResponse.json();
  assert.equal(missingCredentialResponse.status, 200);
  assert.equal(missingCredential.credentialsPresent, false);
  assert.equal(missingCredential.configured, false);
});
