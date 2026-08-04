import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const vite = await createServer({
  root: rootPath,
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-set40-effective-config", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24782 } },
});

const [sites, effective, chat, runtimeConfigRoute, clientDirectoryVerifyRoute] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
  vite.ssrLoadModule("/app/lib/workspace-effective-config.ts"),
  vite.ssrLoadModule("/app/lib/google-chat-notifier.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/config/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/sheets/client-directory/verify/route.ts"),
]);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function routeRequest(body) {
  const url = new URL("https://fci.example.test/api/v1/integrations/google/config");
  const request = new Request(url, {
    method: "PATCH",
    headers: {
      origin: url.origin,
      "content-type": "application/json",
      "oai-authenticated-user-email": "admin@example.test",
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("getConnectionScope executes synchronously without reading DB", () => {
  const input = {
    NODE_ENV: "development",
    GOOGLE_INTEGRATION_MODE: "simulation",
    get DB() {
      throw new Error("getConnectionScope must never read DB");
    },
  };
  const scope = sites.getConnectionScope(input);
  assert.equal(scope instanceof Promise, false);
  assert.deepEqual(scope, {
    connectionKey: "workspace-simulation",
    simulation: true,
  });
  assert.ok(Object.isFrozen(scope));
});

test("shared text and boolean resolvers pin app-first bootstrap semantics", () => {
  assert.deepEqual(
    effective.resolveEffectiveTextConfiguration("app-value", "environment-value"),
    { value: "app-value", source: "app" },
  );
  assert.deepEqual(
    effective.resolveEffectiveTextConfiguration(null, "environment-value"),
    { value: "environment-value", source: "env" },
  );
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(false, "true"),
    { value: false, source: "app" },
  );
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(undefined, "true"),
    { value: true, source: "env" },
  );
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(undefined, "TRUE"),
    { value: false, source: "none" },
  );
});

test("Drive preserves its normalized legacy gate while Chat remains literal-only", () => {
  const drive = sites.getGoogleRuntimeConfig({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED: " TRUE ",
  });
  assert.equal(drive.provisioningEnabled, true);
  assert.equal(drive.driveProvisioningEnvironmentValue, "true");
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(
      undefined,
      drive.driveProvisioningEnvironmentValue,
    ),
    { value: true, source: "env" },
  );
  assert.deepEqual(
    chat.googleChatNotificationsResolution({
      GOOGLE_CHAT_NOTIFICATIONS_ENABLED: " TRUE ",
    }),
    { value: false, source: "none" },
  );
});

test("simulation rejects Drive provisioning writes after validation and before persistence", async () => {
  let databaseCalls = 0;
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: "admin@example.test",
    FCI_ADMIN_EMAILS: "admin@example.test",
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: {
      prepare() {
        databaseCalls += 1;
        throw new Error("simulation configuration must not touch persistence");
      },
    },
  });

  const invalid = await runtimeConfigRoute.PATCH(routeRequest({
    driveProvisioningEnabled: false,
    extra: true,
  }));
  assert.equal(invalid.status, 400);

  const response = await runtimeConfigRoute.PATCH(routeRequest({
    driveProvisioningEnabled: false,
  }));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Drive provisioning is always enabled in simulation and cannot be changed.",
    code: "simulation_configuration_fixed",
  });
  assert.equal(databaseCalls, 0);
});

test("hot list GET handlers use only the synchronous connection scope", async () => {
  const routes = [
    "app/api/v1/clients/route.ts",
    "app/api/v1/projects/route.ts",
    "app/api/v1/tasks/route.ts",
    "app/api/v1/leads/route.ts",
    "app/api/v1/dashboard/route.ts",
    "app/api/v1/integrations/google/operations/route.ts",
  ];
  for (const relative of routes) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), "utf8");
    assert.match(source, /getConnectionScope\(\)/u, relative);
    const getHandler = source.split("export async function GET", 2)[1]?.split(/\nexport async function /u, 1)[0] ?? "";
    assert.doesNotMatch(getHandler, /getEffectiveGoogleRuntime(?:Config|Setup)\(/u, relative);
  }
});

test("spreadsheet adoption fields remain Administrator-only while their sources stay explicit", async () => {
  const panel = await readFile(
    new URL("../app/settings/components/GoogleWorkspacePanel.tsx", import.meta.url),
    "utf8",
  );
  const checklist = await readFile(
    new URL("../app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "Client Directory spreadsheet ID",
    "Lead-form response spreadsheet ID",
  ]) {
    const start = panel.indexOf(`aria-label="${label}"`);
    assert.notEqual(start, -1, label);
    assert.match(
      panel.slice(start, start + 500),
      /disabled=\{!isAdmin \|\| runtimeConfigurationWorking !== null\}/u,
      label,
    );
  }
  assert.match(panel, /Source: \{effectiveConfigurationSourceLabel/u);
  assert.match(checklist, /\{isAdmin && environmentNotes\}/u);
});

test("Forms review queue consumes every effective Sheet source and points remediation to Stage 1 adoption", async () => {
  const panel = await readFile(
    new URL("../app/settings/components/DirectorySyncPanel.tsx", import.meta.url),
    "utf8",
  );
  const parser = panel.slice(
    panel.indexOf("function parseFormLeadIntakeState"),
    panel.indexOf("function responseError"),
  );
  assert.match(
    parser,
    /\["simulation", "app", "env", "none"\]\.includes\(String\(value\.configurationSource\)\)/u,
  );
  assert.match(
    parser,
    /configurationSource: value\.configurationSource as FormLeadIntakeState\["configurationSource"\]/u,
  );
  const sourceLabeler = panel.slice(
    panel.indexOf("function formLeadConfigurationSourceLabel"),
    panel.indexOf("function responseError"),
  );
  assert.match(sourceLabeler, /source === "simulation"\) return "Simulation fixture"/u);
  assert.match(sourceLabeler, /source === "app"\) return "App-saved"/u);
  assert.match(sourceLabeler, /source === "env"\) return "Environment \(bootstrap fallback\)"/u);
  assert.match(sourceLabeler, /return "None"/u);
  assert.match(
    panel,
    /Effective source: <strong>\{formLeadConfigurationSourceLabel\(intake\.configurationSource\)\}<\/strong>/u,
  );
  assert.match(panel, /Google Workspace → Stage 1[\s\S]+<strong>Verify and adopt<\/strong>/u);
  assert.match(panel, /configurationName\}<\/code> is only a hosted bootstrap fallback/u);
  assert.doesNotMatch(panel, /Set <code>\{intake\.configurationName\}<\/code> in the hosted environment/u);
});

test("simulation presents Drive provisioning as forced and cannot claim a saved toggle", async () => {
  const [panel, guide] = await Promise.all([
    readFile(
      new URL("../app/settings/components/GoogleWorkspacePanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../docs/settings-guide.md", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /if \(!isAdmin \|\| simulation\) return;/u);
  assert.match(panel, /Source: \{simulation \? "Simulation fixture \(always enabled\)"/u);
  assert.match(panel, /disabled=\{simulation \|\| runtimeConfigurationWorking !== null\}/u);
  assert.match(panel, /simulation \? "Always enabled in simulation"/u);
  assert.match(guide, /Simulation fixture \(always enabled\)[\s\S]+neither the UI nor the API can save a misleading future live-mode value/u);
});

const COVERED_ENVIRONMENT_NAMES = Object.freeze([
  "GOOGLE_WORKSPACE_SHARED_DRIVE_ID",
  "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID",
  "GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID",
  "GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID",
  "GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID",
  "GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED",
  "GOOGLE_CHAT_NOTIFICATIONS_ENABLED",
  "OPENAI_MODEL",
]);
const COVERED_TOP_LEVEL_CONFIGURATION_PROPERTIES = Object.freeze([
  "clientDirectorySheetId",
  "clientAppointmentsCalendarId",
  "fieldScheduleCalendarId",
  "leadFormResponseSheetId",
  "provisioningEnabled",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoRawResolverReads(source, relative) {
  for (const name of COVERED_ENVIRONMENT_NAMES) {
    const escaped = escapeRegex(name);
    const rawRead = new RegExp(
      `(?:process\\.env|environment|env)\\s*(?:\\.\\s*${escaped}|\\[\\s*["']${escaped}["']\\s*\\])`,
      "u",
    );
    assert.doesNotMatch(source, rawRead, `${relative} reads ${name} outside its resolver owner`);
    // A covered name spelled as a string literal outside its owner is the seed
    // of every indirection idiom (const K = "NAME"; env[K] / helper("NAME")).
    // Owners export the name constants; everyone else must import them.
    const embeddedName = new RegExp(`(["'\`])${escaped}\\1`, "u");
    assert.doesNotMatch(
      source,
      embeddedName,
      `${relative} embeds covered environment name ${name} as a string literal outside its resolver owner`,
    );
  }

  // Constant-shaped (SCREAMING_SNAKE) identifier subscripts are how a covered
  // name imported from an owner reaches the environment without any literal in
  // this file. Generic runtime helpers use lower-case parameters and stay green.
  const constantSubscript = /(?:process\.env|environment|env)\s*\[\s*[A-Z][A-Z0-9_]*\s*\]/u;
  assert.doesNotMatch(
    source,
    constantSubscript,
    `${relative} performs constant-indirection bracket access on the runtime environment outside a resolver owner`,
  );

  const topLevel = COVERED_TOP_LEVEL_CONFIGURATION_PROPERTIES.map(escapeRegex).join("|");
  const destructured = `(?:${topLevel}|rootFolderId)`;
  const directAccess = new RegExp(
    `getGoogleRuntimeConfig\\([^;)]*\\)\\s*(?:(?:\\.\\s*(?:${topLevel}))|(?:\\[\\s*["'](?:${topLevel})["']\\s*\\])|(?:\\.\\s*drive\\s*\\.\\s*rootFolderId))`,
    "u",
  );
  assert.doesNotMatch(
    source,
    directAccess,
    `${relative} chains a resolver-covered field from raw configuration`,
  );
  for (const directDestructuring of source.matchAll(
    /(?:const|let)\s*\{([^;]*?)\}\s*=\s*getGoogleRuntimeConfig\([^;]*\)\s*;/gu,
  )) {
    assert.doesNotMatch(
      directDestructuring[1],
      new RegExp(`\\b${destructured}\\b`, "u"),
      `${relative} destructures a resolver-covered field from raw configuration`,
    );
  }

  for (const assignment of source.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*getGoogleRuntimeConfig\([^;]*\);/gu,
  )) {
    const variable = escapeRegex(assignment[1]);
    const boundAccess = new RegExp(
      `(?<!\\.)\\b${variable}\\s*(?:(?:\\.\\s*(?:${topLevel}))|(?:\\[\\s*["'](?:${topLevel})["']\\s*\\])|(?:\\.\\s*drive\\s*\\.\\s*rootFolderId))`,
      "u",
    );
    assert.doesNotMatch(
      source,
      boundAccess,
      `${relative} reads a resolver-covered field from raw ${assignment[1]}`,
    );
    for (const boundDestructuring of source.matchAll(
      new RegExp(`(?:const|let)\\s*\\{([^;]*?)\\}\\s*=\\s*${variable}\\s*;`, "gu"),
    )) {
      assert.doesNotMatch(
        boundDestructuring[1],
        new RegExp(`\\b${destructured}\\b`, "u"),
        `${relative} destructures a resolver-covered field from raw ${assignment[1]}`,
      );
    }
  }
}

test("raw-reader guard catches direct and bound destructuring mutations", () => {
  assert.throws(
    () => assertNoRawResolverReads(
      "const { provisioningEnabled } = getGoogleRuntimeConfig();",
      "direct-destructuring-fixture.ts",
    ),
    /destructures a resolver-covered field/u,
  );
  assert.throws(
    () => assertNoRawResolverReads(
      "const raw = getGoogleRuntimeConfig(); const { leadFormResponseSheetId: sheet } = raw;",
      "bound-destructuring-fixture.ts",
    ),
    /destructures a resolver-covered field/u,
  );
  assert.throws(
    () => assertNoRawResolverReads(
      "const { drive: { rootFolderId } } = getGoogleRuntimeConfig();",
      "nested-destructuring-fixture.ts",
    ),
    /destructures a resolver-covered field/u,
  );
});

test("raw-reader guard catches constant indirection, helper literals, and rebound names", () => {
  assert.throws(
    () => assertNoRawResolverReads(
      "const sheet = environment[GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV];",
      "constant-indirection-fixture.ts",
    ),
    /constant-indirection bracket access/u,
  );
  assert.throws(
    () => assertNoRawResolverReads(
      'const model = runtimeValue("OPENAI_MODEL");',
      "helper-literal-fixture.ts",
    ),
    /embeds covered environment name OPENAI_MODEL/u,
  );
  assert.throws(
    () => assertNoRawResolverReads(
      'const K = "GOOGLE_CHAT_NOTIFICATIONS_ENABLED"; const gate = env[K];',
      "rebound-name-fixture.ts",
    ),
    /embeds covered environment name GOOGLE_CHAT_NOTIFICATIONS_ENABLED/u,
  );
  // Legitimate reads stay green: generic lower-case parameter subscripts and
  // quoted names outside the covered set are not violations.
  assertNoRawResolverReads(
    'const value = environment[name] ?? process.env[name]; const other = env["FCI_ADMIN_EMAILS"];',
    "legitimate-generic-read-fixture.ts",
  );
});

test("resolver-covered environment values have no raw readers outside their owners", async () => {
  const allowed = new Set([
    "app/lib/google-oauth.ts",
    "app/lib/workspace-effective-config.ts",
    "app/lib/google-chat-notifier.ts",
    "app/lib/assistant-config-sites.ts",
    // The env-tier shim for the lead-form response sheet ID: it owns the
    // GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID environment fallback read.
    "app/lib/google-form-lead-intake-config.ts",
  ]);
  const entries = await readdir(new URL("../app", import.meta.url), {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
    const absolute = `${entry.parentPath.replaceAll("\\", "/")}/${entry.name}`;
    const relative = absolute.slice(rootPath.replaceAll("\\", "/").length);
    if (allowed.has(relative)) continue;
    const source = await readFile(absolute, "utf8");
    assertNoRawResolverReads(source, relative);
  }
});

test("a routing-only Chat save cannot adopt the effective enable gate into the app tier", async () => {
  const card = await readFile(
    new URL("../app/settings/components/ChatNotificationSettingsCard.tsx", import.meta.url),
    "utf8",
  );
  // The PATCH body carries the gate only when this Administrator toggled it —
  // the same dirtiness discipline the AI card applies to its model field. The
  // server merge already preserves an omitted gate, so a routing-only save
  // leaves the stored gate untouched and the hosted bootstrap value in force.
  assert.match(card, /\.\.\.\(featureDirty \? \{ featureEnabled \} : \{\}\)/u);
  assert.doesNotMatch(card, /body: JSON\.stringify\(\{\s*featureEnabled,/u);
  assert.match(
    card,
    /onChange=\{\(event\) => \{ setFeatureEnabled\(event\.target\.checked\); setFeatureDirty\(true\); \}\}/u,
  );
  assert.equal(card.match(/setFeatureDirty\(true\)/gu)?.length, 1);
  assert.equal(card.match(/setFeatureDirty\(false\)/gu)?.length, 3);
});

const VERIFY_ADMIN_EMAIL = "admin@example.test";
const VERIFY_TOKEN_KEY = Buffer.alloc(32, 0x41).toString("base64url");

class VerifyD1Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
    this.statement = owner.database.prepare(sql);
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    this.owner.writes.push(this.sql);
    if (this.owner.failWritePattern?.test(this.sql)) {
      throw new Error("Injected SET-40 partial adoption failure.");
    }
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class VerifyD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.writes = [];
    this.failWritePattern = null;
    this.database.exec(`
      CREATE TABLE workspace_resources (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL, external_id TEXT NOT NULL, parent_external_id TEXT,
        external_url TEXT, origin TEXT NOT NULL, metadata_json TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE (connection_key, resource_type, resource_key)
      );
      CREATE TABLE workspace_blueprints (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL UNIQUE, version INTEGER NOT NULL,
        blueprint_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY, shared_drive_id TEXT, client_directory_sheet_id TEXT,
        intake_mailbox TEXT, settings_json TEXT, updated_by TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE google_connections (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL UNIQUE,
        google_subject TEXT NOT NULL, google_email TEXT NOT NULL,
        scopes_json TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL,
        key_version TEXT NOT NULL, status TEXT NOT NULL,
        last_error_code TEXT, last_success_at INTEGER, created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER
      );
    `);
  }

  prepare(sql) {
    return new VerifyD1Statement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  close() {
    this.database.close();
  }
}

async function verifyWorkspaceEnvironment(database) {
  const encryptedRefreshToken = await sites.encryptGoogleSecret(
    "FCI_TEST_REFRESH_TOKEN",
    VERIFY_TOKEN_KEY,
    "google-connection:google-workspace:refresh",
  );
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: VERIFY_ADMIN_EMAIL,
    FCI_ADMIN_EMAILS: VERIFY_ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "sheets",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "workspaceSharedDrive_12345",
    GOOGLE_WORKSPACE_CLIENT_ID: "workspace-client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "workspace-client-secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/oauth/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: VERIFY_TOKEN_KEY,
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION: "1",
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "example.test",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@example.test",
    DB: database,
  });
  database.database.prepare(`
    INSERT INTO google_connections (
      id, connection_key, google_subject, google_email, scopes_json,
      refresh_token_ciphertext, key_version, status, last_error_code,
      last_success_at, created_by, created_at, updated_at, revoked_at
    ) VALUES (?, 'google-workspace', ?, ?, ?, ?, '1', 'connected', NULL, NULL, ?, 1, 1, NULL)
  `).run(
    randomUUID(),
    "google-subject-set40",
    "operations@example.test",
    JSON.stringify(["https://www.googleapis.com/auth/spreadsheets"]),
    encryptedRefreshToken,
    VERIFY_ADMIN_EMAIL,
  );
}

function verifyRequest(body) {
  const url = new URL("https://fci.example.test/api/v1/integrations/google/sheets/client-directory/verify");
  const request = new Request(url, {
    method: "POST",
    headers: {
      origin: url.origin,
      "content-type": "application/json",
      "oai-authenticated-user-email": VERIFY_ADMIN_EMAIL,
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("partial adoption failure leaves the outranked saved tier stale, never the ranking registry", async () => {
  const database = new VerifyD1Database();
  const originalFetch = globalThis.fetch;
  const newSheetId = "adoptedDirectorySheet_67890";
  try {
    await verifyWorkspaceEnvironment(database);
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ access_token: "workspace-access-token" });
      }
      if (url.hostname === "sheets.googleapis.com") {
        return Response.json({ sheets: [] });
      }
      throw new Error(`Unexpected provider request ${url.href}`);
    };

    // Seed the outranked saved tier with a stale value so the divergence
    // direction of a partial failure is observable.
    database.database.prepare(
      "INSERT INTO workspace_settings (id, shared_drive_id, client_directory_sheet_id, intake_mailbox, settings_json, updated_by, updated_at) VALUES ('workspace', NULL, 'staleDirectorySheet_00001', NULL, '{}', ?, 1)",
    ).run(VERIFY_ADMIN_EMAIL);

    database.failWritePattern = /^INSERT INTO workspace_settings/u;
    const failed = await clientDirectoryVerifyRoute.POST(
      verifyRequest({ spreadsheetId: newSheetId }),
    );
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), {
      error: "The Client Directory spreadsheet could not be verified. Try again.",
    });

    // The ranking registry write always precedes the outranked mirror write.
    const registryIndex = database.writes.findIndex((sql) =>
      sql.trimStart().startsWith("INSERT INTO workspace_resources"));
    const mirrorIndex = database.writes.findIndex((sql) =>
      sql.trimStart().startsWith("INSERT INTO workspace_settings"));
    assert.notEqual(registryIndex, -1);
    assert.notEqual(mirrorIndex, -1);
    assert.ok(registryIndex < mirrorIndex, "registry upsert must run before mergeSettings");

    // The ranking tier holds exactly the ID the route verified with Google;
    // only the outranked bootstrap mirror is stale.
    assert.equal(
      database.database.prepare(
        "SELECT external_id FROM workspace_resources WHERE resource_type = 'sheets.spreadsheet' AND resource_key = 'client-directory'",
      ).get()?.external_id,
      newSheetId,
    );
    assert.equal(
      database.database.prepare(
        "SELECT client_directory_sheet_id FROM workspace_settings WHERE id = 'workspace'",
      ).get()?.client_directory_sheet_id,
      "staleDirectorySheet_00001",
    );

    // Runtime resolution agrees with the verification the route performed: the
    // effective ID is the newly verified one, app-sourced — never a silently
    // divergent hidden tier.
    const setup = await sites.getEffectiveGoogleRuntimeSetup();
    assert.equal(setup.effectiveResources.clientDirectorySheet.externalId, newSheetId);
    assert.equal(setup.effectiveResources.clientDirectorySheet.source, "app");

    // A retry with the mirror write healthy converges both tiers.
    database.failWritePattern = null;
    const retried = await clientDirectoryVerifyRoute.POST(
      verifyRequest({ spreadsheetId: newSheetId }),
    );
    const retriedBody = await retried.json();
    assert.equal(retried.status, 200);
    assert.equal(retriedBody.verified, true);
    assert.equal(retriedBody.spreadsheet.id, newSheetId);
    assert.equal(
      database.database.prepare(
        "SELECT client_directory_sheet_id FROM workspace_settings WHERE id = 'workspace'",
      ).get()?.client_directory_sheet_id,
      newSheetId,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
    database.close();
  }
});
