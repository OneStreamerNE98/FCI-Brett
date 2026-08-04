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
  blueprint: null,
  connection: null,
  providerCalls: [],
  queries: [],
  resourceFailure: false,
  resources: [],
  settings: null,
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
        if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) return state.blueprint;
        if (/FROM workspace_resources WHERE connection_key = \? AND resource_type = \? AND resource_key = \?/u.test(sql)) {
          return state.resources.find((row) => row.connection_key === query.values[0] && row.resource_type === query.values[1] && row.resource_key === query.values[2]) ?? null;
        }
        if (/FROM google_connections WHERE connection_key = \?/u.test(sql)) return state.connection;
        if (/FROM workspace_settings WHERE id = \?/u.test(sql)) return state.settings;
        return null;
      },
      async run() {
        query.kind = "run";
        if (/^INSERT INTO workspace_resources /u.test(sql)) {
          const [id, connection_key, resource_type, resource_key, external_id, parent_external_id, external_url, origin, metadata_json, created_by, created_at, updated_at] = query.values;
          const existing = state.resources.find((row) => row.connection_key === connection_key && row.resource_type === resource_type && row.resource_key === resource_key);
          state.resources = state.resources.filter((row) => !(row.connection_key === connection_key && row.resource_type === resource_type && row.resource_key === resource_key));
          state.resources.push({ id: existing?.id ?? id, connection_key, resource_type, resource_key, external_id, parent_external_id, external_url, origin, metadata_json, created_by: existing?.created_by ?? created_by, created_at: existing?.created_at ?? created_at, updated_at });
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
  calendarVerifyRoute,
  clientsRoute,
  projectsRoute,
  workspaceRoute,
  blueprintModule,
] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/gmail/_route-helpers.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/events/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/test-hold/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/verify/route.ts"),
  vite.ssrLoadModule("/app/api/v1/clients/route.ts"),
  vite.ssrLoadModule("/app/api/v1/projects/route.ts"),
  vite.ssrLoadModule("/app/api/v1/google-workspace/route.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
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
  blueprint = null,
  resources = [],
  ids = ENV_IDS,
  connected = true,
  resourceFailure = false,
  savedSettings = null,
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
  state.blueprint = blueprint ? {
    id: "blueprint-1",
    connection_key: "google-workspace",
    version: 3,
    blueprint_json: JSON.stringify(blueprint),
    created_by: ADMIN_EMAIL,
    created_at: 1_790_000_000_000,
    updated_by: ADMIN_EMAIL,
    updated_at: 1_790_000_001_000,
  } : null;
  state.providerCalls = [];
  state.queries = [];
  state.resourceFailure = resourceFailure;
  state.resources = resources;
  state.settings = savedSettings ? {
    id: "workspace",
    shared_drive_id: null,
    client_directory_sheet_id: null,
    intake_mailbox: null,
    settings_json: JSON.stringify(savedSettings),
    updated_by: ADMIN_EMAIL,
    updated_at: 1_790_000_001_000,
  } : null;
  state.tokenFailure = tokenFailure;
}

function officeRequest(path, method = "GET", body, email = ADMIN_EMAIL) {
  const url = new URL(path, "https://fci.example.test");
  return new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: url.origin, "content-type": "application/json" }),
      "oai-authenticated-user-email": email,
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
    if (url.includes("fields=summary")) {
      return Response.json({ summary: "FCI TEST calendar", timeZone: "America/New_York", items: [] });
    }
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

// The first fixture below was named "saved" but seeds `appResources()` — adopted
// `workspace_resources` rows, not a saved `workspace_settings` value. Those are different
// states that the resolver deliberately collapses to the same `source: "app"`
// (workspace-effective-config.ts:140-149) while the registry row OUTRANKS the saved value.
// Renamed to say what it actually covers, so the absent genuine-saved case is visible rather
// than hidden behind a reassuring name.
test("Workspace readiness reports adopted, environment, and absent Calendar sources", async () => {
  for (const fixture of [
    {
      name: "registry-adopted",
      resources: appResources(),
      ids: ENV_IDS,
      expected: {
        clientAppointments: { configured: true, source: "app", externalId: APP_IDS.appointments },
        fieldSchedule: { configured: true, source: "app", externalId: APP_IDS.fieldSchedule },
      },
    },
    {
      name: "environment",
      resources: [],
      ids: ENV_IDS,
      expected: {
        clientAppointments: { configured: true, source: "env", externalId: ENV_IDS.appointments },
        fieldSchedule: { configured: true, source: "env", externalId: ENV_IDS.fieldSchedule },
      },
    },
    {
      name: "absent",
      resources: [],
      ids: { ...ENV_IDS, appointments: undefined, fieldSchedule: undefined },
      expected: {
        clientAppointments: { configured: false, source: "none", externalId: null },
        fieldSchedule: { configured: false, source: "none", externalId: null },
      },
    },
  ]) {
    configure(fixture);
    const response = await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"));
    assert.equal(response.status, 200, fixture.name);
    const payload = await response.json();
    assert.deepEqual(payload.workspace.calendars.clientAppointments, fixture.expected.clientAppointments, `${fixture.name} appointments source`);
    assert.deepEqual(payload.workspace.calendars.fieldSchedule, fixture.expected.fieldSchedule, `${fixture.name} field source`);
  }
});

// Regression guard for the review defect: an adopted calendar outranks the value the admin
// can see and edit, and `source` alone cannot reveal that — it reads "app" either way, which
// the panel rendered as "In use (saved setting)". The payload must therefore carry the id
// runtime actually resolved, or the panel has no way to tell the operator that saving is
// inert for that calendar.
test("Workspace readiness exposes the resolved Calendar ID so an adopted override is visible", async () => {
  configure({ resources: appResources(), ids: ENV_IDS });
  const payload = await (await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"))).json();

  const appointments = payload.workspace.calendars.clientAppointments;
  assert.equal(appointments.source, "app");
  assert.equal(appointments.externalId, APP_IDS.appointments);
  // The whole point: the resolved id is NOT the environment value the panel would otherwise
  // imply, so a divergence is detectable by comparing against what the field holds.
  assert.notEqual(appointments.externalId, ENV_IDS.appointments);
  assert.equal(payload.workspace.calendars.fieldSchedule.externalId, APP_IDS.fieldSchedule);
});

test("Workspace readiness and folder-plan preview both consume the persisted blueprint", async () => {
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.naming.clientFolderPattern = "{name} [{code}]";
  blueprint.naming.projectFolderPattern = "{year} · {number} · {name}";
  blueprint.drive.clientFolders.push({ key: "site-surveys", name: "Site Surveys", management: "owner", children: [] });
  blueprint.drive.projectFolders.push({ key: "field-notes", name: "07_Field Notes", management: "owner", children: [] });
  configure({ blueprint });

  const readiness = await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"));
  assert.equal(readiness.status, 200);
  const readinessPayload = await readiness.json();
  assert.equal(readinessPayload.blueprint.naming.clientFolderPattern, "{name} [{code}]");
  assert.ok(readinessPayload.blueprint.drive.projectFolders.some((folder) => folder.key === "field-notes"));

  const preview = await workspaceRoute.POST(officeRequest(
    "/api/v1/google-workspace",
    "POST",
    {
      clientCode: "CL-042",
      clientName: "FCI TEST Client",
      projectNumber: "PR-009",
      projectName: "FCI TEST Project",
    },
  ));
  assert.equal(preview.status, 200);
  const previewPayload = await preview.json();
  assert.match(previewPayload.plan.clientFolder, /FCI TEST Client \[CL-042\]$/u);
  assert.ok(previewPayload.plan.clientFolders.includes("Site Surveys"));
  assert.match(previewPayload.plan.projectFolder, /\/\d{4}\/\d{4} · PR-009 · FCI TEST Project$/u);
  assert.ok(previewPayload.plan.projectFolders.includes("07_Field Notes"));
});

// Review defect: this route is `requireOfficeUser` with no admin option, and it is fetched by a
// non-admin-reachable page (InboxView). Returning the persisted, admin-edited blueprint here
// handed every office user the whole tenant configuration document — business name, naming
// patterns, and the full folder/template/spreadsheet/calendar layout — while every other route
// that returns that document is admin-gated. No client consumer reads the field, so non-admins
// simply do not get it.
// Review defect: `effectiveSources.intakeMailbox` was computed but no route returned it, so
// the Gmail intake row was the one App-managed row that could not name its source. It travels
// on the same channel and in the same shape as its sibling provisioningSource.
test("Workspace readiness names the intake mailbox source beside its sibling provisioning source", async () => {
  configure();
  const hosted = await (await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"))).json();
  assert.equal(hosted.workspace.intakeMailboxSource, "env",
    "with no saved value the hosted fallback is in force");
  assert.ok(["app", "env", "none"].includes(hosted.workspace.provisioningSource),
    "sibling source stays on the same SET-13 enum");

  configure({ savedSettings: { intakeMailbox: CONNECTION_EMAIL } });
  const saved = await (await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"))).json();
  assert.equal(saved.workspace.intakeMailboxSource, "app",
    "a saved mailbox reports App-saved, so the row can say which value wins");
});

// Review defect: the readiness label named BOTH addresses in full, and `missing`/
// `missingDetails` are returned to every office user — while the same response masks the same
// address one field away in `connection.account`.
test("A mailbox/account mismatch label reaches non-admins without the unmasked connected address", async () => {
  const officeEmail = "office@cherryhillfci.com";
  const savedMailbox = "dispatch@cherryhillfci.com";
  configure({
    savedSettings: { intakeMailbox: savedMailbox },
    overrides: {
      FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${officeEmail}`,
      GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: `${CONNECTION_EMAIL},${savedMailbox}`,
    },
  });

  const response = await workspaceRoute.GET(officeRequest("/api/v1/google-workspace", "GET", undefined, officeEmail));
  assert.equal(response.status, 200);
  const body = await response.text();
  const payload = JSON.parse(body);

  const mismatch = payload.missingDetails.at(-1);
  assert.equal(mismatch.label,
    `Google Workspace intake mailbox ${savedMailbox} matching connected account op•••@cherryhillfci.com`);
  assert.ok(payload.missing.includes(mismatch.label), "the flattened list carries the same masked label");
  assert.equal(body.includes(CONNECTION_EMAIL), false,
    "the unmasked connected address must not appear anywhere in a non-admin readiness payload");
  // The mask is the one already used a field away, so the two agree.
  assert.equal(payload.workspace.connectionAccount, "op•••@cherryhillfci.com");
  // The saved mailbox stays readable: the office UI already shows the selector and its options.
  assert.ok(body.includes(savedMailbox));
});

test("Workspace readiness withholds the persisted tenant blueprint from non-admin office users", async () => {
  const officeEmail = "office@cherryhillfci.com";
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.business.displayName = "FCI TEST Tenant Business";
  blueprint.naming.clientFolderPattern = "{name} [{code}]";
  blueprint.drive.sharedDriveName = "FCI TEST Tenant Drive";
  blueprint.drive.projectFolders.push({ key: "field-notes", name: "07_FCI TEST Field Notes", management: "owner", children: [] });
  blueprint.templates.push({ key: "tenant-letter", name: "FCI TEST Tenant Letter", kind: "doc", targetFolderKey: "templates", management: "owner" });
  configure({ blueprint, overrides: { FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${officeEmail}` } });

  const nonAdmin = await workspaceRoute.GET(officeRequest("/api/v1/google-workspace", "GET", undefined, officeEmail));
  assert.equal(nonAdmin.status, 200);
  const nonAdminBody = await nonAdmin.text();
  assert.equal(JSON.parse(nonAdminBody).blueprint, undefined);
  for (const persisted of [
    "FCI TEST Tenant Business",
    "{name} [{code}]",
    "07_FCI TEST Field Notes",
    "FCI TEST Tenant Letter",
  ]) {
    assert.equal(nonAdminBody.includes(persisted), false, `non-admin payload disclosed ${persisted}`);
  }
  // Boundary: `workspace.storageName` is the Shared Drive's display name. It has resolved from
  // the persisted blueprint since before this change, it is unchanged here, and it is one of
  // the fields consumers actually read — so it stays, and only the configuration document goes.
  assert.equal(JSON.parse(nonAdminBody).workspace.storageName, "FCI TEST Tenant Drive");
  // The rest of the readiness payload still has to work for a non-admin caller.
  assert.equal(JSON.parse(nonAdminBody).workspace.connectionStatus, "connected");

  const adminPayload = await (await workspaceRoute.GET(officeRequest("/api/v1/google-workspace"))).json();
  assert.equal(adminPayload.blueprint.business.displayName, "FCI TEST Tenant Business");
  assert.equal(adminPayload.blueprint.naming.clientFolderPattern, "{name} [{code}]");
  assert.ok(adminPayload.blueprint.drive.projectFolders.some((folder) => folder.key === "field-notes"));
  assert.ok(adminPayload.blueprint.templates.some((template) => template.key === "tenant-letter"));
});

// Review defect: the blueprint editor lets an owner remove the client-accounts or projects root
// in one click and the sanitizer accepts it, so the preview reached a state where it threw a
// bare Error and the route returned an unhandled 500. The sibling provisioning helper answers
// the identical condition with a typed 409, and the preview must agree.
test("Folder-plan preview answers a missing blueprint root with a typed 409, not an unhandled 500", async () => {
  for (const removedRoot of ["client-accounts", "projects"]) {
    const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
    blueprint.drive.roots = blueprint.drive.roots.filter((folder) => folder.key !== removedRoot);
    blueprint.spreadsheets = blueprint.spreadsheets.filter((sheet) => sheet.targetFolderKey !== removedRoot);
    configure({ blueprint });

    const response = await workspaceRoute.POST(officeRequest(
      "/api/v1/google-workspace",
      "POST",
      {
        clientCode: "CL-042",
        clientName: "FCI TEST Client",
        projectNumber: "PR-009",
        projectName: "FCI TEST Project",
      },
    ));
    assert.equal(response.status, 409, `${removedRoot} removed`);
    const payload = await response.json();
    assert.equal(payload.code, "workspace_blueprint_root_missing", `${removedRoot} removed`);
    assert.match(payload.error, /client-accounts and projects roots/u);
  }
});

test("Folder-plan preview rejects a widened legacy duplicate before presenting an unsafe plan", async () => {
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.drive.projectFolders.unshift(
    { key: "first-project-sibling", name: "00_Duplicate", management: "owner", children: [] },
    { key: "second-project-sibling", name: "00_Duplicate", management: "owner", children: [] },
  );
  configure({ blueprint });

  const response = await workspaceRoute.POST(officeRequest(
    "/api/v1/google-workspace",
    "POST",
    {
      clientCode: "CL-042",
      clientName: "FCI TEST Client",
      projectNumber: "PR-009",
      projectName: "FCI TEST Project",
    },
  ));
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.code, "drive_folder_identity_conflict");
  assert.match(payload.error, /duplicates the sibling folder name/u);
  assert.equal("plan" in payload, false);
});

test("Calendar verify probes events.list and adopts the ID into the registry", async () => {
  configure({ resources: [], ids: ENV_IDS });
  const response = await calendarVerifyRoute.POST(officeRequest(
    "/api/v1/integrations/google/calendar/verify",
    "POST",
    { calendarKey: "field-schedule", calendarId: " verified-field@example.test " },
  ));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.verified, true);
  assert.equal(payload.calendar.id, "verified-field@example.test");
  assert.equal(payload.calendar.name, "FCI TEST calendar");
  const providerUrl = calendarProviderUrls().at(-1);
  assert.match(providerUrl, /calendars\/verified-field%40example.test\/events\?/u);
  assert.match(providerUrl, /maxResults=1/u);
  const adopted = state.resources.find((row) => row.resource_type === "calendar.calendar" && row.resource_key === "field-schedule");
  assert.equal(adopted.external_id, "verified-field@example.test");
  assert.equal(adopted.origin, "adopted");
});

test("Calendar verify rejects non-admin callers before database or Google work", async () => {
  const officeEmail = "office@cherryhillfci.com";
  configure({ overrides: { FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${officeEmail}` } });
  const response = await calendarVerifyRoute.POST(new Request(
    "https://fci.example.test/api/v1/integrations/google/calendar/verify",
    {
      method: "POST",
      headers: {
        origin: "https://fci.example.test",
        "content-type": "application/json",
        "oai-authenticated-user-email": officeEmail,
      },
      body: JSON.stringify({ calendarKey: "client-appointments", calendarId: "calendar@example.test" }),
    },
  ));
  assert.equal(response.status, 403);
  assert.equal(state.queries.length, 0);
  assert.equal(state.providerCalls.length, 0);
});

async function assertCreationMirror(route, path, body, resources, ids, expectedSheetId) {
  configure({ resources, ids, tokenFailure: true });
  const response = await route.POST(officeRequest(path, "POST", body));
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
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
    assert.equal(response.status, 201, JSON.stringify(payload));
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
