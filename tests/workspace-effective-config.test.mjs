import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const TEST_KEY = Buffer.alloc(32, 0x5a).toString("base64url");
const rootUrl = new URL("../", import.meta.url);

function completeEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail,calendar,sheets",
    GOOGLE_WORKSPACE_CLIENT_ID: "workspace-client.apps.googleusercontent.com",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "FCI TEST connector secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://ops.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION: "1",
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "environment-shared-drive-id",
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "environment-directory-sheet-id",
    GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID: "environment-client-calendar-id",
    GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID: "environment-field-calendar-id",
    GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED: "true",
    ...overrides,
  };
}

function rawResource({
  id = "resource-id",
  connectionKey = "google-workspace",
  resourceType,
  resourceKey,
  externalId,
  origin = "adopted",
  metadata = {},
  createdAt = 1_784_611_200_000,
  updatedAt = createdAt,
}) {
  return {
    id,
    connectionKey,
    resourceType,
    resourceKey,
    externalId,
    parentExternalId: null,
    externalUrl: null,
    origin,
    metadata,
    createdBy: "admin@example.test",
    createdAt,
    updatedAt,
  };
}

function d1Row(resource) {
  return {
    id: resource.id,
    connection_key: resource.connectionKey,
    resource_type: resource.resourceType,
    resource_key: resource.resourceKey,
    external_id: resource.externalId,
    parent_external_id: resource.parentExternalId,
    external_url: resource.externalUrl,
    origin: resource.origin,
    metadata_json: JSON.stringify(resource.metadata),
    created_by: resource.createdBy,
    created_at: resource.createdAt,
    updated_at: resource.updatedAt,
  };
}

const compositionResource = rawResource({
  id: "saved-shared-drive",
  resourceType: "drive.shared-drive",
  resourceKey: "primary",
  externalId: "app-shared-drive-id",
});

globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = {
  ...completeEnvironment(),
  DB: {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async all() {
          assert.match(sql, /FROM workspace_resources WHERE connection_key = \?/);
          assert.deepEqual(statement.values, ["google-workspace"]);
          return { results: [d1Row(compositionResource)] };
        },
      };
      return statement;
    },
  },
};

const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/workspace-effective-config",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24730 } },
});

const [oauth, effective, adapter, oauthSites] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth.ts"),
  vite.ssrLoadModule("/app/lib/workspace-effective-config.ts"),
  vite.ssrLoadModule("/app/adapters/d1/workspace-resources.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
]);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

const RESOURCE_CASES = [
  {
    name: "sharedDrive",
    resourceType: "drive.shared-drive",
    resourceKey: "primary",
    envVar: "GOOGLE_WORKSPACE_SHARED_DRIVE_ID",
    read: (config) => config.drive.rootFolderId,
  },
  {
    name: "clientDirectorySheet",
    resourceType: "sheets.spreadsheet",
    resourceKey: "client-directory",
    envVar: "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID",
    read: (config) => config.clientDirectorySheetId,
  },
  {
    name: "clientAppointmentsCalendar",
    resourceType: "calendar.calendar",
    resourceKey: "client-appointments",
    envVar: "GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID",
    read: (config) => config.clientAppointmentsCalendarId,
  },
  {
    name: "fieldScheduleCalendar",
    resourceType: "calendar.calendar",
    resourceKey: "field-schedule",
    envVar: "GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID",
    read: (config) => config.fieldScheduleCalendarId,
  },
];

test("base getGoogleRuntimeConfig remains pinned on a complete fixture environment", () => {
  assert.deepEqual(oauth.getGoogleRuntimeConfig(completeEnvironment()), {
    environment: "workspace",
    simulation: false,
    modeIsValid: true,
    connectionKey: "google-workspace",
    clientId: "workspace-client.apps.googleusercontent.com",
    clientSecret: "FCI TEST connector secret",
    redirectUri: "https://ops.example.test/api/v1/integrations/google/callback",
    tokenEncryptionKey: TEST_KEY,
    tokenEncryptionKeyVersion: "1",
    expectedGoogleEmails: ["operations@cherryhillfci.com"],
    allowedDomains: ["cherryhillfci.com"],
    drive: {
      mode: "shared-drive",
      modeIsValid: true,
      rootFolderId: "environment-shared-drive-id",
      storageLabel: "Company Shared Drive",
      storageName: "FCI Operations",
      storageRequirementLabel: "Shared Drive ID",
    },
    clientDirectorySheetId: "environment-directory-sheet-id",
    clientDirectorySheetIdInvalid: false,
    intakeMailbox: "operations@cherryhillfci.com",
    clientAppointmentsCalendarId: "environment-client-calendar-id",
    fieldScheduleCalendarId: "environment-field-calendar-id",
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    serviceScopes: {
      drive: "https://www.googleapis.com/auth/drive",
      gmail: "https://www.googleapis.com/auth/gmail.modify",
      calendar: "https://www.googleapis.com/auth/calendar.events",
      sheets: "https://www.googleapis.com/auth/spreadsheets",
    },
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    missing: [],
    missingDetails: [],
    oauthReady: true,
    provisioningEnabled: true,
    gmailEnabled: true,
    calendarEnabled: true,
    sheetsEnabled: true,
    broadScopeAcknowledged: true,
  });
});

test("resolver covers every app-presence by environment-presence combination for all four IDs", () => {
  for (const resourceCase of RESOURCE_CASES) {
    for (const appPresent of [false, true]) {
      for (const envPresent of [false, true]) {
        const environment = completeEnvironment({ [resourceCase.envVar]: envPresent ? `env-${resourceCase.name}-identifier` : undefined });
        const config = oauth.getGoogleRuntimeConfig(environment);
        const savedRows = appPresent
          ? [rawResource({
              id: `saved-${resourceCase.name}`,
              resourceType: resourceCase.resourceType,
              resourceKey: resourceCase.resourceKey,
              externalId: `app-${resourceCase.name}-identifier`,
            })]
          : [];
        const resources = effective.resolveEffectiveWorkspaceResources(config, savedRows);
        const resolved = resources[resourceCase.name];
        const expectedSource = appPresent ? "app" : envPresent ? "env" : "none";
        const expectedId = appPresent
          ? `app-${resourceCase.name}-identifier`
          : envPresent
            ? `env-${resourceCase.name}-identifier`
            : undefined;

        assert.equal(resolved.source, expectedSource, `${resourceCase.name}: app=${appPresent}, env=${envPresent}`);
        assert.equal(resolved.externalId, expectedId, `${resourceCase.name}: app=${appPresent}, env=${envPresent}`);
        assert.equal(resourceCase.read(effective.applyEffectiveWorkspaceConfig(config, resources)), expectedId);
      }
    }
  }
});

test("connectReady ignores only resource-ID gaps while oauthReady still requires effective resources", () => {
  const withoutResourceIds = completeEnvironment({
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,calendar,sheets",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: undefined,
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: undefined,
    GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID: undefined,
    GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID: undefined,
  });
  const base = oauth.getGoogleRuntimeConfig(withoutResourceIds);
  const noSavedResources = effective.applyEffectiveWorkspaceConfig(
    base,
    effective.resolveEffectiveWorkspaceResources(base, []),
  );
  assert.equal(noSavedResources.connectReady, true);
  assert.equal(noSavedResources.oauthReady, false);

  const savedRows = RESOURCE_CASES.map((resourceCase) => rawResource({
    id: `saved-${resourceCase.name}`,
    resourceType: resourceCase.resourceType,
    resourceKey: resourceCase.resourceKey,
    externalId: `app-${resourceCase.name}-identifier`,
  }));
  const appSatisfied = effective.applyEffectiveWorkspaceConfig(
    base,
    effective.resolveEffectiveWorkspaceResources(base, savedRows),
  );
  assert.equal(appSatisfied.connectReady, true);
  assert.equal(appSatisfied.oauthReady, true);

  const missingClientSecretBase = oauth.getGoogleRuntimeConfig({
    ...withoutResourceIds,
    GOOGLE_WORKSPACE_CLIENT_SECRET: undefined,
  });
  const missingClientSecret = effective.applyEffectiveWorkspaceConfig(
    missingClientSecretBase,
    effective.resolveEffectiveWorkspaceResources(missingClientSecretBase, savedRows),
  );
  assert.equal(missingClientSecret.connectReady, false);
  assert.equal(missingClientSecret.oauthReady, false);
  assert.ok(missingClientSecret.missing.includes("Google OAuth client secret"));
});

test("simulation fixture IDs remain usable without being mislabeled as environment values", () => {
  const base = oauth.getGoogleRuntimeConfig({ NODE_ENV: "development" });
  const resources = effective.resolveEffectiveWorkspaceResources(base, []);
  const applied = effective.applyEffectiveWorkspaceConfig(base, resources);

  assert.equal(base.simulation, true);
  assert.equal(resources.sharedDrive.source, "none");
  assert.equal(resources.sharedDrive.externalId, "workspace-simulation-drive");
  assert.equal(resources.clientAppointmentsCalendar.source, "none");
  assert.equal(resources.fieldScheduleCalendar.source, "none");
  assert.equal(applied.drive.rootFolderId, "workspace-simulation-drive");
  assert.equal(applied.clientAppointmentsCalendarId, "simulation-client-appointments");
  assert.equal(applied.fieldScheduleCalendarId, "simulation-field-schedule");
  assert.equal(applied.connectReady, true);
  assert.equal(applied.oauthReady, true);
});

test("apply filters app-satisfied resource details without rewriting retained base entries", () => {
  const base = oauth.getGoogleRuntimeConfig({
    ...completeEnvironment(),
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,calendar,sheets",
    GOOGLE_WORKSPACE_CLIENT_ID: undefined,
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: undefined,
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: undefined,
    GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID: undefined,
    GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID: undefined,
  });
  const syntheticSheetDetail = Object.freeze({
    label: "client directory spreadsheet ID",
    envVar: "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID",
    secret: false,
  });
  const fixture = {
    ...base,
    missingDetails: [...base.missingDetails, syntheticSheetDetail],
    missing: [...base.missing, syntheticSheetDetail.label],
    oauthReady: false,
  };
  const originalDetails = [...fixture.missingDetails];
  const savedRows = RESOURCE_CASES.map((resourceCase) => rawResource({
    id: `saved-${resourceCase.name}`,
    resourceType: resourceCase.resourceType,
    resourceKey: resourceCase.resourceKey,
    externalId: `app-${resourceCase.name}-identifier`,
  }));

  const applied = effective.applyEffectiveWorkspaceConfig(
    fixture,
    effective.resolveEffectiveWorkspaceResources(fixture, savedRows),
  );
  const retainedClientId = originalDetails.find((detail) => detail.envVar === "GOOGLE_WORKSPACE_CLIENT_ID");

  assert.deepEqual(fixture.missingDetails, originalDetails, "the base fixture is not mutated");
  assert.deepEqual(applied.missingDetails, [retainedClientId]);
  assert.equal(applied.missingDetails[0], retainedClientId, "retained details preserve object identity");
  assert.equal(applied.missing[0], retainedClientId.label);
  assert.equal(applied.connectReady, false);
  assert.equal(applied.oauthReady, false);
  assert.ok(Object.isFrozen(applied));
  assert.ok(Object.isFrozen(applied.drive));
  assert.ok(Object.isFrozen(applied.missing));
  assert.ok(Object.isFrozen(applied.missingDetails));
});

test("D1 registry list and upsert use the unique connector/type/key identity", async () => {
  const queries = [];
  const stored = d1Row(rawResource({
    id: "resource-existing",
    resourceType: "calendar.calendar",
    resourceKey: "client-appointments",
    externalId: "calendar-before",
    metadata: { color: "blue" },
  }));
  const database = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async all() {
          queries.push({ kind: "all", sql, values: statement.values });
          return { results: [stored] };
        },
        async run() {
          queries.push({ kind: "run", sql, values: statement.values });
          return { meta: { changes: 1 } };
        },
        async first() {
          queries.push({ kind: "first", sql, values: statement.values });
          return {
            ...stored,
            external_id: "calendar-after",
            origin: "created",
            metadata_json: JSON.stringify({ color: "green" }),
            updated_at: stored.updated_at + 1,
          };
        },
      };
      return statement;
    },
  };

  const listed = await adapter.listWorkspaceResources(database, "google-workspace");
  assert.deepEqual(listed, [{
    id: "resource-existing",
    connectionKey: "google-workspace",
    resourceType: "calendar.calendar",
    resourceKey: "client-appointments",
    externalId: "calendar-before",
    parentExternalId: null,
    externalUrl: null,
    origin: "adopted",
    metadata: { color: "blue" },
    createdBy: "admin@example.test",
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  }]);

  const upserted = await adapter.upsertWorkspaceResource(database, {
    id: "resource-new-attempt",
    connectionKey: "google-workspace",
    resourceType: "calendar.calendar",
    resourceKey: "client-appointments",
    externalId: "calendar-after",
    origin: "created",
    metadata: { color: "green" },
    createdBy: "admin@example.test",
    createdAt: stored.created_at,
    updatedAt: stored.updated_at + 1,
  });
  assert.equal(upserted.id, "resource-existing", "the existing registry identity is retained");
  assert.equal(upserted.externalId, "calendar-after");
  assert.deepEqual(upserted.metadata, { color: "green" });
  assert.match(queries.find((query) => query.kind === "run").sql, /ON CONFLICT\(connection_key, resource_type, resource_key\) DO UPDATE/);
  assert.deepEqual(queries.at(-1).values, ["google-workspace", "calendar.calendar", "client-appointments"]);
});

test("Sites composition asynchronously applies registry rows over environment values", async () => {
  const config = await oauthSites.getEffectiveGoogleRuntimeConfig();
  assert.equal(config.drive.rootFolderId, "app-shared-drive-id");
  assert.equal(config.clientDirectorySheetId, "environment-directory-sheet-id");
  assert.equal(config.connectReady, true);
  assert.equal(config.oauthReady, true);
});
