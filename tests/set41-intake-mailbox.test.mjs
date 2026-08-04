import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@example.test";
const OFFICE_EMAIL = "office@example.test";
const PRIMARY_MAILBOX = "operations@example.test";
const SECONDARY_MAILBOX = "dispatch@example.test";
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/set41-intake-mailbox",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24793 } },
});

const [settingsRoute, oauthSites] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/settings/workspace/route.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
]);

class D1Statement {
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
    this.owner.writes.push({ sql: this.sql, values: [...this.values] });
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class TestDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.writes = [];
    this.database.exec(`
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY,
        shared_drive_id TEXT,
        client_directory_sheet_id TEXT,
        intake_mailbox TEXT,
        settings_json TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_resources (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        external_id TEXT NOT NULL,
        parent_external_id TEXT,
        external_url TEXT,
        origin TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE google_connections (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL UNIQUE,
        google_subject TEXT NOT NULL,
        google_email TEXT NOT NULL,
        refresh_token_ciphertext TEXT NOT NULL,
        key_version TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    this.database.prepare(`INSERT INTO workspace_settings (
      id, shared_drive_id, client_directory_sheet_id, intake_mailbox,
      settings_json, updated_by, updated_at
    ) VALUES ('workspace', NULL, NULL, 'legacy-column@example.test', ?, 'seed@example.test', 1)`)
      .run(JSON.stringify({ timezone: "America/Chicago", siblingOwner: { preserve: true } }));
    this.database.prepare(`INSERT INTO google_connections (
      id, connection_key, google_subject, google_email, refresh_token_ciphertext,
      key_version, scopes_json, status
    ) VALUES ('connection', 'google-workspace', 'subject', ?, 'ciphertext', '1', '[]', 'connected')`)
      .run(PRIMARY_MAILBOX);
  }

  prepare(sql) {
    return new D1Statement(this, sql);
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

function configure(database, overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "shared-drive-identifier",
    GOOGLE_WORKSPACE_CLIENT_ID: "client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "FCI TEST client secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 0x41).toString("base64url"),
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "example.test",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: `${PRIMARY_MAILBOX},${SECONDARY_MAILBOX}`,
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: PRIMARY_MAILBOX,
    DB: database,
    ...overrides,
  });
}

function request(method = "GET", body, options = {}) {
  const url = new URL("https://fci.example.test/api/v1/settings/workspace");
  const headers = new Headers({
    "oai-authenticated-user-email": options.email ?? ADMIN_EMAIL,
  });
  if (method !== "GET") {
    headers.set("origin", options.origin ?? url.origin);
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

after(async () => {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

test("Settings exposes authorized mailbox choices and atomically saves a selected address", async () => {
  const database = new TestDatabase();
  try {
    configure(database);
    const listed = await settingsRoute.GET(request("GET", undefined, { email: OFFICE_EMAIL }));
    const listedBody = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("cache-control"), "no-store");
    assert.deepEqual(listedBody.intakeMailboxOptions, [PRIMARY_MAILBOX, SECONDARY_MAILBOX]);
    assert.equal(JSON.stringify(listedBody).includes("FCI TEST client secret"), false);

    const saved = await settingsRoute.PATCH(request("PATCH", {
      intakeMailbox: SECONDARY_MAILBOX.toUpperCase(),
    }));
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedBody.settings.intakeMailbox, SECONDARY_MAILBOX);
    assert.equal(savedBody.settings.timezone, "America/Chicago",
      "a mailbox-only save returns the preserved merged preferences");
    assert.deepEqual(savedBody.intakeMailboxOptions, [PRIMARY_MAILBOX, SECONDARY_MAILBOX]);

    const row = database.database.prepare(
      "SELECT intake_mailbox, settings_json FROM workspace_settings WHERE id = 'workspace'",
    ).get();
    assert.equal(row.intake_mailbox, "legacy-column@example.test", "the dead scalar column stays untouched");
    assert.deepEqual(JSON.parse(row.settings_json), {
      timezone: "America/Chicago",
      siblingOwner: { preserve: true },
      intakeMailbox: SECONDARY_MAILBOX,
    });

    const effective = await oauthSites.getEffectiveGoogleRuntimeConfig();
    assert.equal(effective.intakeMailbox, SECONDARY_MAILBOX);
    assert.equal(effective.effectiveSources.intakeMailbox, "app");
    assert.equal(effective.oauthReady, false);
    assert.equal(effective.connectReady, true);
    assert.equal(effective.missingDetails.at(-1).label,
      `Google Workspace intake mailbox ${SECONDARY_MAILBOX} matching connected account ${PRIMARY_MAILBOX}`);

    const authorizeSource = await read("app/api/v1/integrations/google/authorize/route.ts");
    assert.match(authorizeSource, /if \(!config\.connectReady\)/u);
    assert.doesNotMatch(authorizeSource, /if \(!config\.oauthReady\)/u);
  } finally {
    database.close();
  }
});

test("Settings rejects non-member and disallowed-domain mailboxes without writing", async (t) => {
  for (const fixture of [
    {
      name: "not a member",
      value: "unknown@example.test",
      overrides: {},
      reason: /AUTHORIZED_ACCOUNTS/u,
    },
    {
      name: "outside allowed domain",
      value: "authorized@outside.test",
      overrides: {
        GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS:
          `${PRIMARY_MAILBOX},${SECONDARY_MAILBOX},authorized@outside.test`,
      },
      reason: /ALLOWED_DOMAINS/u,
    },
    {
      name: "invalid address",
      value: "not-an-email",
      overrides: {},
      reason: /valid Google Workspace intake mailbox/u,
    },
  ]) {
    await t.test(fixture.name, async () => {
      const database = new TestDatabase();
      try {
        configure(database, fixture.overrides);
        const writesBefore = database.writes.length;
        const response = await settingsRoute.PATCH(request("PATCH", {
          intakeMailbox: fixture.value,
        }));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, fixture.reason);
        assert.equal(database.writes.length, writesBefore);
      } finally {
        database.close();
      }
    });
  }
});

test("mailbox selection stays same-origin and Administrator-only", async () => {
  const database = new TestDatabase();
  try {
    configure(database);
    const office = await settingsRoute.PATCH(request("PATCH", {
      intakeMailbox: SECONDARY_MAILBOX,
    }, { email: OFFICE_EMAIL }));
    const crossOrigin = await settingsRoute.PATCH(request("PATCH", {
      intakeMailbox: SECONDARY_MAILBOX,
    }, { origin: "https://evil.example.test" }));
    assert.equal(office.status, 403);
    assert.equal(crossOrigin.status, 403);
    assert.equal(database.writes.length, 0);
  } finally {
    database.close();
  }
});
