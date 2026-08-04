import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const OLD_TENANT = "operations@grass.wedding";
const CONNECTION_KEY = "google-workspace";
const OTHER_CONNECTION_KEY = "another-profile";
const APP_ORIGIN = "https://fci.example.test";
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/ws19-tenant-cutover",
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

const [oauth, d1Oauth, tenantResetRoute] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth.ts"),
  vite.ssrLoadModule("/app/adapters/d1/google-oauth-persistence.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/tenant/reset/route.ts"),
]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

class SqliteD1Statement {
  constructor(statement, owner, sql) {
    this.statement = statement;
    this.owner = owner;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    this.owner.reads.push({ sql: this.sql, values: [...this.values] });
    return this.statement.get(...this.values) ?? null;
  }

  async run() {
    this.owner.writes.push({ sql: this.sql, values: [...this.values] });
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class TenantDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.reads = [];
    this.writes = [];
    this.beforeBatch = null;
    this.database.exec(`
      CREATE TABLE google_connections (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL UNIQUE,
        google_subject TEXT NOT NULL, google_email TEXT NOT NULL,
        scopes_json TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL,
        key_version TEXT NOT NULL, status TEXT NOT NULL,
        last_error_code TEXT, last_success_at INTEGER, created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER
      );
      CREATE TABLE google_oauth_attempts (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE google_integration_events (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE google_form_lead_reviews (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE google_form_lead_intake_watermarks (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE mail_items (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE gmail_file_archives (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE gmail_file_archive_artifacts (id TEXT PRIMARY KEY, archive_id TEXT NOT NULL);
      CREATE TABLE drive_folder_mappings (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE google_drive_operations (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE google_sheet_sync_state (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE workspace_resources (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE workspace_blueprints (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL);
      CREATE TABLE clients (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        drive_folder_id TEXT, drive_url TEXT
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        drive_folder_id TEXT, drive_url TEXT
      );
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY, shared_drive_id TEXT, client_directory_sheet_id TEXT,
        intake_mailbox TEXT, settings_json TEXT NOT NULL,
        updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE tasks (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_ref TEXT);
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY, record_id TEXT NOT NULL, action TEXT NOT NULL,
        actor TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
      );
    `);
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql), this, sql);
  }

  async batch(statements) {
    this.beforeBatch?.();
    this.beforeBatch = null;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  row(sql, ...values) {
    const row = this.database.prepare(sql).get(...values);
    return row ? { ...row } : null;
  }

  rows(sql, ...values) {
    return this.database.prepare(sql).all(...values).map((row) => ({ ...row }));
  }

  count(table, where = "", ...values) {
    return Number(this.row(`SELECT COUNT(*) AS count FROM ${table}${where}`, ...values).count);
  }

  close() {
    this.database.close();
  }
}

function configure(database, mode = "workspace") {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: mode,
    DB: database,
  });
}

function request(method, body, options = {}) {
  const url = new URL("/api/v1/integrations/google/tenant/reset", APP_ORIGIN);
  const headers = new Headers({ "oai-authenticated-user-email": options.email ?? ADMIN_EMAIL });
  if (method !== "GET") {
    headers.set("origin", options.origin ?? APP_ORIGIN);
    headers.set("content-type", "application/json");
  }
  const result = new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(result, "nextUrl", { value: url });
  return result;
}

function insertConnection(database, {
  id = "old-connection",
  connectionKey = CONNECTION_KEY,
  subject = "old-google-subject",
  email = OLD_TENANT,
  status = "revoked",
} = {}) {
  database.database.prepare(`INSERT INTO google_connections (
    id, connection_key, google_subject, google_email, scopes_json,
    refresh_token_ciphertext, key_version, status, last_error_code,
    last_success_at, created_by, created_at, updated_at, revoked_at
  ) VALUES (?, ?, ?, ?, '[]', '', '', ?, NULL, NULL, ?, 1, 1, 1)`).run(
    id,
    connectionKey,
    subject,
    email,
    status,
    ADMIN_EMAIL,
  );
}

const KEYED_RESET_TABLES = [
  "google_form_lead_reviews",
  "google_form_lead_intake_watermarks",
  "mail_items",
  "gmail_file_archives",
  "drive_folder_mappings",
  "google_drive_operations",
  "google_sheet_sync_state",
  "google_integration_events",
  "workspace_resources",
  "workspace_blueprints",
];

function seedTenantData(database, status = "revoked") {
  insertConnection(database, { status });
  insertConnection(database, {
    id: "other-connection",
    connectionKey: OTHER_CONNECTION_KEY,
    subject: "other-google-subject",
    email: "other@example.test",
    status: "revoked",
  });
  for (const table of KEYED_RESET_TABLES) {
    database.database.prepare(`INSERT INTO ${table} (id, connection_key) VALUES (?, ?), (?, ?)`).run(
      `${table}-old`,
      CONNECTION_KEY,
      `${table}-other`,
      OTHER_CONNECTION_KEY,
    );
  }
  database.database.exec(`
    INSERT INTO gmail_file_archive_artifacts (id, archive_id) VALUES
      ('artifact-old', 'gmail_file_archives-old'),
      ('artifact-other', 'gmail_file_archives-other');
    INSERT INTO google_oauth_attempts (id, connection_key) VALUES
      ('attempt-old', '${CONNECTION_KEY}'),
      ('attempt-other', '${OTHER_CONNECTION_KEY}');
    INSERT INTO clients (id, name, drive_folder_id, drive_url)
      VALUES ('client-1', 'Preserved client', 'old-client-folder', 'https://old.example/client');
    INSERT INTO projects (id, name, drive_folder_id, drive_url)
      VALUES ('project-1', 'Preserved project', 'old-project-folder', 'https://old.example/project');
    INSERT INTO workspace_settings (
      id, shared_drive_id, client_directory_sheet_id, intake_mailbox,
      settings_json, updated_by, updated_at
    ) VALUES (
      'workspace', 'old-shared-drive', 'old-directory-sheet', '${OLD_TENANT}',
      '{"appointmentCalendarId":"old-appointments","fieldCalendarId":"old-field","nonTenantPreference":"preserve-me"}',
      'previous-admin@example.test', 10
    );
    INSERT INTO tasks (id, source, source_ref) VALUES
      ('email-task', 'email', 'old-gmail-message'),
      ('manual-task', 'manual', 'manual-reference'),
      ('meeting-task', 'meeting', 'meeting-reference');
    INSERT INTO activity_events (id, record_id, action, actor, detail, created_at)
      VALUES ('existing-activity', 'project-1', 'project.existing', 'office@example.test', 'Preserve this event', 1);
  `);
}

test("connect guard uses only the WS-19 named tenant-data whitelist", async () => {
  let captured = null;
  const adapter = d1Oauth.createD1GoogleOauthPersistence({
    prepare(sql) {
      captured = { sql, values: [] };
      return {
        bind(...values) {
          captured.values = values;
          return this;
        },
        async first() {
          return { tenant_data_exists: 1 };
        },
        async run() {
          throw new Error("not used");
        },
      };
    },
    async batch() {
      throw new Error("not used");
    },
  });

  assert.equal(await adapter.hasTenantScopedData(CONNECTION_KEY), true);
  for (const table of [
    "google_form_lead_reviews",
    "google_form_lead_intake_watermarks",
    "mail_items",
    "gmail_file_archives",
    "gmail_file_archive_artifacts",
    "drive_folder_mappings",
    "google_drive_operations",
    "google_sheet_sync_state",
    "workspace_resources",
    "workspace_blueprints",
    "clients",
    "projects",
    "workspace_settings",
  ]) {
    assert.match(captured.sql, new RegExp(`\\b${table}\\b`, "u"), `${table} must be named by the guard`);
  }
  for (const excluded of ["google_oauth_attempts", "google_integration_events", "google_connections"]) {
    assert.doesNotMatch(captured.sql, new RegExp(`\\b${excluded}\\b`, "u"), `${excluded} must not arm the guard`);
  }
  assert.deepEqual(captured.values, Array(9).fill(CONNECTION_KEY));
});

test("saveConnection fails closed on a different subject when whitelisted tenant data exists", async () => {
  let saveCalls = 0;
  let secretCalls = 0;
  await assert.rejects(
    oauth.saveGoogleConnection(
      oauth.getGoogleRuntimeConfig({ GOOGLE_INTEGRATION_MODE: "workspace" }),
      { accessToken: "new-access", refreshToken: "new-refresh", scope: [] },
      { subject: "new-google-subject", email: "operations@cherryhillfci.com", emailVerified: true },
      ADMIN_EMAIL,
      {
        persistence: {
          async findConnection() {
            return {
              id: "old-connection",
              googleSubject: "old-google-subject",
              googleEmail: OLD_TENANT,
              refreshTokenCiphertext: "old-ciphertext",
              keyVersion: "old-key",
              status: "revoked",
            };
          },
          async hasTenantScopedData() {
            return true;
          },
          async saveConnection() {
            saveCalls += 1;
            return "saved";
          },
        },
        secrets: {
          async current() {
            secretCalls += 1;
            throw new Error("guard must run before encryption");
          },
          async get() {
            secretCalls += 1;
            throw new Error("guard must run before encryption");
          },
        },
        async fetch() {
          throw new Error("not used");
        },
        now: () => 1,
        randomUUID: () => "new-connection",
      },
    ),
    (error) => error.code === "google_tenant_reset_required"
      && error.status === 409
      && /Start fresh on a new tenant/u.test(error.message),
  );
  assert.equal(secretCalls, 0);
  assert.equal(saveCalls, 0);
});

test("excluded audit and OAuth rows do not arm the guard", async () => {
  const database = new TenantDatabase();
  try {
    insertConnection(database);
    database.database.exec(`
      INSERT INTO google_oauth_attempts (id, connection_key) VALUES ('attempt', '${CONNECTION_KEY}');
      INSERT INTO google_integration_events (id, connection_key) VALUES ('event', '${CONNECTION_KEY}');
    `);
    const adapter = d1Oauth.createD1GoogleOauthPersistence(database);
    assert.equal(await adapter.hasTenantScopedData(CONNECTION_KEY), false);
  } finally {
    database.close();
  }
});

test("tenant reset requires admin, same-origin, disconnected state, and exact stored-email confirmation", async () => {
  const database = new TenantDatabase();
  configure(database);
  seedTenantData(database, "connected");
  try {
    const denied = await tenantResetRoute.GET(request("GET", undefined, { email: OFFICE_EMAIL }));
    assert.equal(denied.status, 403);

    const crossOrigin = await tenantResetRoute.POST(request("POST", { confirmation: OLD_TENANT }, { origin: "https://evil.example" }));
    assert.equal(crossOrigin.status, 403);

    const preview = await tenantResetRoute.GET(request("GET"));
    assert.equal(preview.status, 200);
    assert.deepEqual(await preview.json(), {
      available: false,
      connectionStatus: "connected",
      discardedTenant: OLD_TENANT,
    });

    const connected = await tenantResetRoute.POST(request("POST", { confirmation: OLD_TENANT }));
    assert.equal(connected.status, 409);
    assert.match((await connected.json()).error, /Disconnect/u);
    assert.equal(database.count("mail_items", " WHERE connection_key = ?", CONNECTION_KEY), 1);

    database.database.prepare("UPDATE google_connections SET status = 'revoked' WHERE connection_key = ?").run(CONNECTION_KEY);
    const mismatch = await tenantResetRoute.POST(request("POST", { confirmation: "new-tenant@example.test" }));
    assert.equal(mismatch.status, 409);
    assert.match((await mismatch.json()).error, new RegExp(OLD_TENANT.replace(".", "\\."), "u"));
    assert.equal(database.count("mail_items", " WHERE connection_key = ?", CONNECTION_KEY), 1);
  } finally {
    database.close();
  }
});

test("workspace tenant reset clears every tenant surface per-table and preserves business rows plus one audit", async () => {
  const database = new TenantDatabase();
  configure(database);
  seedTenantData(database);
  try {
    const preview = await tenantResetRoute.GET(request("GET"));
    assert.deepEqual(await preview.json(), {
      available: true,
      connectionStatus: "revoked",
      discardedTenant: OLD_TENANT,
    });

    const response = await tenantResetRoute.POST(request("POST", { confirmation: OLD_TENANT }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reset: true, discardedTenant: OLD_TENANT });

    for (const table of KEYED_RESET_TABLES) {
      assert.equal(database.count(table, " WHERE connection_key = ?", CONNECTION_KEY), 0, `${table} old-tenant rows`);
      assert.equal(database.count(table, " WHERE connection_key = ?", OTHER_CONNECTION_KEY), 1, `${table} unrelated rows`);
    }
    assert.equal(database.count(
      "gmail_file_archive_artifacts",
      " WHERE archive_id = 'gmail_file_archives-old'",
    ), 0);
    assert.equal(database.count(
      "gmail_file_archive_artifacts",
      " WHERE archive_id = 'gmail_file_archives-other'",
    ), 1);

    assert.deepEqual(database.row("SELECT name, drive_folder_id, drive_url FROM clients WHERE id = 'client-1'"), {
      name: "Preserved client",
      drive_folder_id: null,
      drive_url: null,
    });
    assert.deepEqual(database.row("SELECT name, drive_folder_id, drive_url FROM projects WHERE id = 'project-1'"), {
      name: "Preserved project",
      drive_folder_id: null,
      drive_url: null,
    });
    const settings = database.row("SELECT * FROM workspace_settings WHERE id = 'workspace'");
    assert.equal(settings.shared_drive_id, null);
    assert.equal(settings.client_directory_sheet_id, null);
    assert.equal(settings.intake_mailbox, null);
    assert.deepEqual(JSON.parse(settings.settings_json), { nonTenantPreference: "preserve-me" });
    assert.equal(settings.updated_by, ADMIN_EMAIL);
    assert.ok(settings.updated_at > 10);

    assert.equal(database.row("SELECT source_ref FROM tasks WHERE id = 'email-task'").source_ref, null);
    assert.equal(database.row("SELECT source_ref FROM tasks WHERE id = 'manual-task'").source_ref, "manual-reference");
    assert.equal(database.row("SELECT source_ref FROM tasks WHERE id = 'meeting-task'").source_ref, "meeting-reference");
    assert.equal(database.count("google_connections", " WHERE connection_key = ?", CONNECTION_KEY), 0);
    assert.equal(database.count("google_connections", " WHERE connection_key = ?", OTHER_CONNECTION_KEY), 1);
    assert.equal(database.count("google_oauth_attempts", " WHERE connection_key = ?", CONNECTION_KEY), 1);

    const activities = database.rows("SELECT action, actor, detail FROM activity_events ORDER BY created_at");
    assert.equal(activities.length, 2);
    assert.equal(activities[0].action, "project.existing");
    assert.deepEqual(activities.filter((event) => event.action === "google_workspace.tenant_reset"), [{
      action: "google_workspace.tenant_reset",
      actor: ADMIN_EMAIL,
      detail: `Discarded Google Workspace tenant ${OLD_TENANT}.`,
    }]);
    assert.equal(database.writes.some(({ sql }) => /^DELETE FROM activity_events/u.test(sql)), false);

    const adapter = d1Oauth.createD1GoogleOauthPersistence(database);
    assert.equal(await adapter.findConnection(CONNECTION_KEY), null);
    assert.equal(await adapter.hasTenantScopedData(CONNECTION_KEY), false);
    const tokenKey = Buffer.alloc(32, 0x19).toString("base64url");
    await oauth.saveGoogleConnection(
      oauth.getGoogleRuntimeConfig({ GOOGLE_INTEGRATION_MODE: "workspace" }),
      { accessToken: "new-access", refreshToken: "new-refresh", scope: [] },
      { subject: "new-google-subject", email: "operations@cherryhillfci.com", emailVerified: true },
      ADMIN_EMAIL,
      {
        persistence: adapter,
        secrets: oauth.createGoogleSecretStore({ currentVersion: "1", keys: { 1: tokenKey } }),
        async fetch() {
          throw new Error("not used");
        },
        now: () => 20,
        randomUUID: () => "new-connection",
      },
    );
    assert.deepEqual(database.row(
      "SELECT google_subject, google_email, status FROM google_connections WHERE connection_key = ?",
      CONNECTION_KEY,
    ), {
      google_subject: "new-google-subject",
      google_email: "operations@cherryhillfci.com",
      status: "connected",
    });
  } finally {
    database.close();
  }
});

test("reset batch is a no-op if the revoked tombstone reconnects before mutation", async () => {
  const database = new TenantDatabase();
  configure(database);
  seedTenantData(database);
  try {
    database.beforeBatch = () => {
      database.database.prepare("UPDATE google_connections SET status = 'connected' WHERE connection_key = ?").run(CONNECTION_KEY);
    };
    const response = await tenantResetRoute.POST(request("POST", { confirmation: OLD_TENANT }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed while the reset was being confirmed/u);
    assert.equal(database.count("mail_items", " WHERE connection_key = ?", CONNECTION_KEY), 1);
    assert.equal(database.row("SELECT status FROM google_connections WHERE connection_key = ?", CONNECTION_KEY).status, "connected");
    assert.equal(database.count("activity_events", " WHERE action = 'google_workspace.tenant_reset'"), 0);
  } finally {
    database.close();
  }
});

test("tenant reset has the inverse simulation gate and leaves the simulation reset route untouched", async () => {
  const database = new TenantDatabase();
  configure(database, "simulation");
  try {
    const before = database.writes.length;
    const preview = await tenantResetRoute.GET(request("GET"));
    assert.equal(preview.status, 409);
    assert.match((await preview.json()).error, /only in Google Workspace mode/u);
    const reset = await tenantResetRoute.POST(request("POST", { confirmation: OLD_TENANT }));
    assert.equal(reset.status, 409);
    assert.equal(database.writes.length, before);

    const simulationRoute = await read("app/api/v1/integrations/google/simulation/reset/route.ts");
    assert.match(simulationRoute, /if \(!config\.simulation\).*status: 409/u);
    assert.doesNotMatch(simulationRoute, /tenant\/reset|tenant_reset|Start fresh on a new tenant/u);
  } finally {
    database.close();
  }
});

test("Settings exposes stored-email typed confirmation and the guide states filed-evidence loss", async () => {
  const [panel, guide, callback, resetRoute, resetHelper] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("docs/settings-guide.md"),
    read("app/api/v1/integrations/google/callback/route.ts"),
    read("app/api/v1/integrations/google/tenant/reset/route.ts"),
    read("app/adapters/d1/google-tenant-reset.ts"),
  ]);
  assert.match(panel, /Start fresh on a new tenant/u);
  assert.match(panel, /confirmation\.trim\(\) === discardedTenant/u);
  assert.match(panel, /\/api\/v1\/integrations\/google\/tenant\/reset/u);
  assert.match(callback, /google_tenant_reset_required[\s\S]*tenant-reset-required/u);
  assert.doesNotMatch(resetRoute, /(?:INSERT INTO|UPDATE|DELETE FROM) mail_items/iu);
  assert.match(resetRoute, /resetD1GoogleWorkspaceTenant\(env\.DB,/u);
  assert.match(resetHelper, /DELETE FROM mail_items WHERE connection_key = \?/u);
  assert.match(guide, /discards filed-email evidence/u);
  assert.match(guide, /Client and project business rows survive/u);
  assert.match(guide, /Drive folder IDs and Drive URLs are cleared/u);
});
