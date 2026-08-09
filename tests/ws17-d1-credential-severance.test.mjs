import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { NextRequest } from "next/server.js";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const cloudflareEnv = {
  DB: new Proxy({}, {
    get() {
      throw new Error("denied disconnect must not access D1");
    },
  }),
  FCI_OFFICE_EMAILS: "admincrm@cherryhillfci.com,office@cherryhillfci.com",
  FCI_OFFICE_DOMAINS: "",
  FCI_ADMIN_EMAILS: "admincrm@cherryhillfci.com",
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = cloudflareEnv;
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/ws17-d1-credential-severance",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("fixtures/cloudflare-workers.mjs", import.meta.url),
      ),
    },
  },
  server: { middlewareMode: true, hmr: false },
});
const [d1Module, oauthModule, connectionRoute] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/d1/google-oauth-persistence.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/connection/route.ts"),
]);
const { createD1GoogleOauthPersistence } = d1Module;
const {
  createGoogleSecretStore,
  disconnectGoogleConnection,
  encryptGoogleSecretWithStore,
  getGoogleAccessToken,
  getGoogleRuntimeConfig,
  resolveGoogleMailboxConnectionConfig,
  saveGoogleConnection,
} = oauthModule;

const NOW = Date.UTC(2026, 6, 29, 15, 0, 0);
const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const CONNECTION_KEY = "google-workspace";
const TOKEN_KEY = Buffer.alloc(32, 0x57).toString("base64url");

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function statement(sql, calls) {
  const call = { sql, values: [] };
  calls.push(call);
  return {
    bind(...values) {
      call.values = values;
      return this;
    },
    async first() {
      return null;
    },
    async run() {
      return { meta: { changes: 1 } };
    },
  };
}

class ExecutingD1Statement {
  constructor(database, sql) {
    this.statement = database.prepare(sql);
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
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class ExecutingOauthDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.batchQueue = Promise.resolve();
    this.preparedSql = [];
    this.database.exec(`
      CREATE TABLE google_connections (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL UNIQUE,
        google_subject TEXT NOT NULL,
        google_email TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        refresh_token_ciphertext TEXT NOT NULL,
        key_version TEXT NOT NULL,
        status TEXT NOT NULL,
        last_error_code TEXT,
        last_success_at INTEGER,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE google_drive_operations (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        operation_key TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        lease_expires_at INTEGER,
        last_error_code TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE google_integration_events (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE google_oauth_attempts (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        pkce_verifier_ciphertext TEXT NOT NULL,
        browser_nonce_hash TEXT NOT NULL,
        initiated_by TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
    `);
  }

  prepare(sql) {
    this.preparedSql.push(sql);
    return new ExecutingD1Statement(this.database, sql);
  }

  async batch(statements) {
    const previous = this.batchQueue;
    let release;
    this.batchQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const prepared of statements) results.push(await prepared.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}

function workspaceConfig() {
  return getGoogleRuntimeConfig({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_CLIENT_ID: "FCI_TEST_CLIENT",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "FCI_TEST_SECRET",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail,calendar,sheets",
  });
}

function simulationConfig() {
  return getGoogleRuntimeConfig({
    NODE_ENV: "development",
    GOOGLE_INTEGRATION_MODE: "simulation",
  });
}

function insertExecutingConnection(database, {
  id = "connection-1",
  connectionKey = CONNECTION_KEY,
  subject = "google-subject",
  email = "operations@cherryhillfci.com",
  ciphertext,
  keyVersion = "1",
} = {}) {
  database.database.prepare(`INSERT INTO google_connections (
    id, connection_key, google_subject, google_email, scopes_json,
    refresh_token_ciphertext, key_version, status, last_error_code,
    last_success_at, created_by, created_at, updated_at, revoked_at
  ) VALUES (?, ?, ?, ?, '[]', ?, ?, 'connected', NULL, NULL, ?, ?, ?, NULL)`)
    .run(
      id,
      connectionKey,
      subject,
      email,
      ciphertext,
      keyVersion,
      ADMIN_EMAIL,
      NOW,
      NOW,
    );
}

function persistence(overrides = {}) {
  return {
    async createOauthAttempt() {},
    async findOauthAttemptByStateHash() {
      return null;
    },
    async consumeOauthAttempt() {
      return false;
    },
    async findConnection() {
      return null;
    },
    async findConnectionByGoogleSubject() {
      return null;
    },
    async findConnectionByGoogleEmail() {
      return null;
    },
    async listConnectionKeys() {
      return [];
    },
    async listConnectionMetadata() {
      return [];
    },
    async hasTenantScopedData() {
      return false;
    },
    async revokeConnection() {
      return "stale";
    },
    async finishRevocationOperation() {
      return true;
    },
    async writeRevocationOutcomeEvent() {
      return true;
    },
    async saveConnection() {
      return "saved";
    },
    async markConnectionAccountRejected() {},
    async markConnectionRefreshSucceeded() {},
    async markConnectionRefreshFailed() {},
    async writeIntegrationEvent() {},
    async writeOauthAttemptEvent() {
      return true;
    },
    ...overrides,
  };
}

test("D1 revocation tombstones or re-tombstones an existing credential and writes one batched event", async () => {
  const calls = [];
  let batchStatements = null;
  const adapter = createD1GoogleOauthPersistence({
    prepare(sql) {
      return statement(sql, calls);
    },
    async batch(statements) {
      batchStatements = statements;
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ];
    },
  });

  const revoked = await adapter.revokeConnection({
    connectionId: "connection-1",
    connectionKey: CONNECTION_KEY,
    workspaceConnectionKey: CONNECTION_KEY,
    refreshTokenCiphertext: "ciphertext-generation-1",
    operationId: "operation-1",
    operationKey: `${CONNECTION_KEY}:oauth:disconnect`,
    leaseExpiresAt: NOW + 300_000,
    revokedAt: NOW,
    event: {
      id: "event-1",
      eventType: "oauth.disconnected",
      actor: ADMIN_EMAIL,
      entityType: "connection",
      entityId: CONNECTION_KEY,
      detail: "mode=workspace;google_revocation=pending;local_connection=revoked",
    },
  });

  assert.equal(revoked, "revoked");
  assert.equal(batchStatements.length, 4);
  assert.match(calls[0].sql, /^UPDATE google_drive_operations/u);
  assert.match(calls[0].sql, /connection_key IN \(\?, \?\).+operation_key = connection_key \|\| ':oauth:disconnect'/u);
  assert.match(calls[1].sql, /^INSERT INTO google_drive_operations/u);
  assert.match(calls[1].sql, /ON CONFLICT\(operation_key\) DO UPDATE SET id = excluded\.id/u);
  assert.match(calls[1].sql, /NOT EXISTS \(SELECT 1 FROM google_drive_operations WHERE connection_key IN \(\?, \?\) AND status IN \('in-progress', 'committing'\)\)/u);
  assert.match(calls[2].sql, /^UPDATE google_connections SET refresh_token_ciphertext = '', key_version = '', status = 'revoked'/u);
  assert.match(calls[2].sql, /EXISTS \(SELECT 1 FROM google_drive_operations WHERE id = \? AND operation_key = \? AND status = 'in-progress' AND lease_expires_at = \?\)$/u);
  assert.doesNotMatch(calls[2].sql, /\bDELETE\b/u);
  assert.deepEqual(calls[2].values, [
    NOW,
    NOW,
    "connection-1",
    CONNECTION_KEY,
    "ciphertext-generation-1",
    "operation-1",
    `${CONNECTION_KEY}:oauth:disconnect`,
    NOW + 300_000,
  ]);
  assert.match(calls[3].sql, /^INSERT INTO google_integration_events/u);
  assert.match(calls[3].sql, /WHERE EXISTS \(SELECT 1 FROM google_connections WHERE id = \? AND connection_key = \? AND status = 'revoked' AND revoked_at = \?\) AND EXISTS \(SELECT 1 FROM google_drive_operations/u);
  assert.deepEqual(calls[3].values, [
    "event-1",
    CONNECTION_KEY,
    "oauth.disconnected",
    ADMIN_EMAIL,
    "connection",
    CONNECTION_KEY,
    "mode=workspace;google_revocation=pending;local_connection=revoked",
    NOW,
    "connection-1",
    CONNECTION_KEY,
    NOW,
    "operation-1",
    `${CONNECTION_KEY}:oauth:disconnect`,
    NOW + 300_000,
  ]);

  const unauditedAdapter = createD1GoogleOauthPersistence({
    prepare(sql) {
      return statement(sql, []);
    },
    async batch() {
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 0 } },
      ];
    },
  });
  await assert.rejects(
    unauditedAdapter.revokeConnection({
      connectionId: "connection-1",
      connectionKey: CONNECTION_KEY,
      workspaceConnectionKey: CONNECTION_KEY,
      refreshTokenCiphertext: "ciphertext-generation-1",
      operationId: "operation-missing-event",
      operationKey: `${CONNECTION_KEY}:oauth:disconnect`,
      leaseExpiresAt: NOW + 300_000,
      revokedAt: NOW,
      event: {
        id: "event-missing",
        eventType: "oauth.disconnected",
        actor: ADMIN_EMAIL,
        entityType: "connection",
        entityId: CONNECTION_KEY,
        detail: "mode=workspace;google_revocation=failed;local_connection=revoked",
      },
    }),
    /did not create its integration event/u,
  );

  const missingCalls = [];
  const missingAdapter = createD1GoogleOauthPersistence({
    prepare(sql) {
      return statement(sql, missingCalls);
    },
    async batch() {
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
      ];
    },
  });
  assert.equal(
    await missingAdapter.revokeConnection({
      connectionId: "connection-1",
      connectionKey: CONNECTION_KEY,
      workspaceConnectionKey: CONNECTION_KEY,
      refreshTokenCiphertext: "ciphertext-generation-1",
      operationId: "operation-missing-connection",
      operationKey: `${CONNECTION_KEY}:oauth:disconnect`,
      leaseExpiresAt: NOW + 300_000,
      revokedAt: NOW,
      event: {
        id: "event-missing-connection",
        eventType: "oauth.disconnected",
        actor: ADMIN_EMAIL,
        entityType: "connection",
        entityId: CONNECTION_KEY,
        detail: "mode=workspace;google_revocation=not_attempted;local_connection=not-found",
      },
    }),
    "stale",
  );
  assert.match(missingCalls[3].sql, /WHERE EXISTS \(SELECT 1 FROM google_connections/u);
});

test("aggregate connection readers execute key-only or non-secret metadata projections", async () => {
  const database = new ExecutingOauthDatabase();
  const adapter = createD1GoogleOauthPersistence(database);
  insertExecutingConnection(database, { ciphertext: "primary-secret" });
  insertExecutingConnection(database, {
    id: "connection-sales",
    connectionKey: "gmail_sales",
    subject: "sales-google-subject",
    email: "sales@cherryhillfci.com",
    ciphertext: "sales-secret",
  });

  assert.deepEqual(await adapter.listConnectionKeys(), [
    "gmail_sales",
    CONNECTION_KEY,
  ]);
  assert.deepEqual(await adapter.listConnectionMetadata(), [
    {
      id: "connection-1",
      connectionKey: CONNECTION_KEY,
      googleSubject: "google-subject",
      googleEmail: "operations@cherryhillfci.com",
      scopesJson: "[]",
      status: "connected",
    },
    {
      id: "connection-sales",
      connectionKey: "gmail_sales",
      googleSubject: "sales-google-subject",
      googleEmail: "sales@cherryhillfci.com",
      scopesJson: "[]",
      status: "connected",
    },
  ]);
  const [keySql, metadataSql] = database.preparedSql.slice(-2);
  assert.equal(keySql, "SELECT connection_key FROM google_connections ORDER BY connection_key");
  assert.match(metadataSql, /^SELECT id, connection_key, google_subject, google_email, scopes_json, status FROM google_connections/u);
  for (const sql of [keySql, metadataSql]) {
    assert.doesNotMatch(sql, /refresh_token_ciphertext|key_version/u);
  }

  const [sitesSource, gmailHelperSource] = await Promise.all([
    readFile(new URL("../app/lib/google-oauth-sites.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/integrations/google/gmail/_route-helpers.ts", import.meta.url), "utf8"),
  ]);
  assert.match(sitesSource, /googleOauthPersistence\(\)\.listConnectionKeys\(\)/u);
  assert.match(sitesSource, /googleOauthPersistence\(\)\.listConnectionMetadata\(\)/u);
  assert.doesNotMatch(
    sitesSource.slice(
      sitesSource.indexOf("export async function listGoogleMailboxConnections"),
      sitesSource.indexOf("function currentKeyOnlySecrets"),
    ),
    /refreshTokenCiphertext|getGoogleConnectionStatus\(mailboxConfig\)/u,
  );
  assert.match(
    gmailHelperSource,
    /getEffectiveGoogleRuntimeSetup\(undefined, \{ includeCredentialGeneration: false \}\)/u,
  );
  database.database.close();
});

test("simulation revocation records an honest local event without secrets or Google", async () => {
  let standaloneEvent = null;
  let secretReads = 0;
  let providerCalls = 0;
  const result = await disconnectGoogleConnection(simulationConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return null;
      },
      async writeIntegrationEvent(input) {
        standaloneEvent = input;
      },
    }),
    secrets: {
      async current() {
        secretReads += 1;
        throw new Error("simulation must not read secrets");
      },
      async get() {
        secretReads += 1;
        throw new Error("simulation must not read secrets");
      },
    },
    async fetch() {
      providerCalls += 1;
      throw new Error("simulation must not contact Google");
    },
    now: () => NOW,
    randomUUID: () => "event-simulation",
  });

  assert.deepEqual(result, {
    connectionRevoked: false,
    providerRevocation: "skipped_simulation",
    revocationRequested: false,
  });
  assert.equal(secretReads, 0);
  assert.equal(providerCalls, 0);
  assert.equal(standaloneEvent.eventType, "oauth.disconnected");
  assert.equal(standaloneEvent.actor, ADMIN_EMAIL);
  assert.match(standaloneEvent.detail, /google_revocation=skipped_simulation/u);
  assert.match(standaloneEvent.detail, /local_connection=not-found/u);
  assert.deepEqual(standaloneEvent, {
    id: "event-simulation",
    connectionKey: "workspace-simulation",
    eventType: "oauth.disconnected",
    actor: ADMIN_EMAIL,
    entityType: "connection",
    entityId: "workspace-simulation",
    detail: "mode=simulation;google_revocation=skipped_simulation;local_connection=not-found",
    createdAt: NOW,
  });
});

test("live revocation records the provider outcome and always severs local use", async () => {
  const secrets = createGoogleSecretStore({
    currentVersion: "1",
    keys: { 1: TOKEN_KEY },
  });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST REFRESH TOKEN",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  let revokeInput = null;
  let providerEvent = null;
  const fetchCalls = [];
  const order = [];
  const eventIds = ["event-live-local", "event-live-provider"];
  const result = await disconnectGoogleConnection(workspaceConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return {
          id: "connection-1",
          googleEmail: "operations@cherryhillfci.com",
          refreshTokenCiphertext: encrypted.ciphertext,
          keyVersion: encrypted.keyVersion,
          scopesJson: "[]",
          status: "connected",
        };
      },
      async revokeConnection(input) {
        order.push("local-severance");
        revokeInput = input;
        return "revoked";
      },
      async writeRevocationOutcomeEvent(input) {
        order.push("provider-outcome");
        providerEvent = input.event;
        return true;
      },
    }),
    secrets,
    async fetch(input, init) {
      order.push("provider-attempt");
      fetchCalls.push({ input: String(input), init });
      return new Response(null, { status: 503 });
    },
    now: () => NOW,
    randomUUID: () => eventIds.shift(),
  });

  // Consciously re-pointed from a single attempt (review finding): revoking a
  // token is idempotent, and by the time this call runs the ciphertext is
  // already emptied, so the plaintext exists only for the rest of this request.
  // A 503 that is not retried permanently loses the ability to revoke a live
  // token carrying Drive + gmail.modify + Calendar + Sheets scope. The one
  // bounded retry is taken; a second 503 still records "failed".
  assert.equal(fetchCalls.length, 2);
  for (const call of fetchCalls) {
    assert.equal(call.input, "https://oauth2.googleapis.com/revoke");
    assert.equal(call.init.method, "POST");
  }
  assert.deepEqual(result, {
    connectionRevoked: true,
    providerRevocation: "failed",
    revocationRequested: false,
  });
  assert.deepEqual(order, [
    "local-severance",
    "provider-attempt",
    "provider-attempt",
    "provider-outcome",
  ], "local severance still commits before any provider attempt");
  assert.match(revokeInput.event.detail, /google_revocation=pending/u);
  assert.match(revokeInput.event.detail, /local_connection=revoked/u);
  assert.equal(providerEvent.eventType, "oauth.provider_revocation_recorded");
  assert.match(providerEvent.detail, /google_revocation=failed/u);
  assert.match(providerEvent.detail, /local_connection=revoked/u);
});

test("stalled Google revocation keeps reset and reconnect blocked until its operation terminalizes", async () => {
  const secrets = createGoogleSecretStore({
    currentVersion: "1",
    keys: { 1: TOKEN_KEY },
  });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST REFRESH TOKEN",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  let releaseProvider;
  const providerResponse = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  let markLocallySevered;
  const locallySevered = new Promise((resolve) => {
    markLocallySevered = resolve;
  });
  const eventIds = ["event-stalled-local", "event-stalled-provider"];
  let revocationOperationActive = false;
  let providerOutcomeEvents = 0;
  const operation = disconnectGoogleConnection(workspaceConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return {
          id: "connection-stalled",
          googleEmail: "operations@cherryhillfci.com",
          refreshTokenCiphertext: encrypted.ciphertext,
          keyVersion: encrypted.keyVersion,
          status: "connected",
        };
      },
      async revokeConnection() {
        revocationOperationActive = true;
        markLocallySevered();
        return "revoked";
      },
      async writeRevocationOutcomeEvent() {
        if (!revocationOperationActive) return false;
        providerOutcomeEvents += 1;
        return true;
      },
      async finishRevocationOperation() {
        assert.equal(revocationOperationActive, true);
        revocationOperationActive = false;
        return true;
      },
    }),
    secrets,
    async fetch() {
      return providerResponse;
    },
    now: () => NOW,
    randomUUID: () => eventIds.shift(),
  });

  const severedBeforeProviderFinished = await Promise.race([
    locallySevered.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 500)),
  ]);
  assert.equal(revocationOperationActive, true,
    "the DB-visible operation blocks reconnect and tenant reset while Google is still revoking");
  releaseProvider(new Response(null, { status: 200 }));
  const result = await operation;

  assert.equal(severedBeforeProviderFinished, true);
  assert.equal(result.connectionRevoked, true);
  assert.equal(result.providerRevocation, "succeeded");
  assert.equal(providerOutcomeEvents, 1);
  assert.equal(revocationOperationActive, false,
    "reconnect and tenant reset become available only after provider revocation returns");
});

test("an active Workspace action blocks disconnect before any provider revocation", async () => {
  const database = new ExecutingOauthDatabase();
  const adapter = createD1GoogleOauthPersistence(database);
  const secrets = createGoogleSecretStore({ currentVersion: "1", keys: { 1: TOKEN_KEY } });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST ACTIVE ACTION TOKEN",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  insertExecutingConnection(database, { ciphertext: encrypted.ciphertext });
  database.database.prepare(`INSERT INTO google_drive_operations (
    id, connection_key, operation_key, project_id, status, lease_expires_at,
    last_error_code, created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'in-progress', ?, NULL, ?, ?, ?)`)
    .run(
      "active-action",
      CONNECTION_KEY,
      `${CONNECTION_KEY}:setup:gmail-send-test`,
      "gmail-send-test",
      NOW + 300_000,
      ADMIN_EMAIL,
      NOW,
      NOW,
    );
  let providerCalls = 0;

  await assert.rejects(
    disconnectGoogleConnection(workspaceConfig(), ADMIN_EMAIL, {
      persistence: adapter,
      secrets,
      async fetch() {
        providerCalls += 1;
        return new Response(null, { status: 200 });
      },
      now: () => NOW,
      randomUUID: () => "blocked-disconnect-event",
    }),
    (error) => error.code === "google_operation_in_progress" && error.status === 409,
  );

  assert.equal(providerCalls, 0);
  assert.deepEqual({ ...database.database.prepare(
    "SELECT status, refresh_token_ciphertext FROM google_connections WHERE id = 'connection-1'",
  ).get() }, {
    status: "connected",
    refresh_token_ciphertext: encrypted.ciphertext,
  });
  assert.equal(database.database.prepare(
    "SELECT COUNT(*) AS count FROM google_integration_events",
  ).get().count, 0);
  database.database.close();
});

test("provider revocation serializes reconnect through completion and supports a later disconnect", async () => {
  const database = new ExecutingOauthDatabase();
  const adapter = createD1GoogleOauthPersistence(database);
  const secrets = createGoogleSecretStore({ currentVersion: "1", keys: { 1: TOKEN_KEY } });
  const generationA = await encryptGoogleSecretWithStore(
    "FCI TEST SERIALIZATION GENERATION A",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  const generationB = await encryptGoogleSecretWithStore(
    "FCI TEST SERIALIZATION GENERATION B",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  insertExecutingConnection(database, { ciphertext: generationA.ciphertext });
  let releaseProvider;
  let markProviderStarted;
  const providerStarted = new Promise((resolve) => { markProviderStarted = resolve; });
  const providerResponse = new Promise((resolve) => { releaseProvider = resolve; });
  const eventIds = [
    "disconnect-a-local",
    "disconnect-a-provider",
    "disconnect-b-local",
    "disconnect-b-provider",
  ];
  let providerCalls = 0;
  const dependencies = {
    persistence: adapter,
    secrets,
    async fetch() {
      providerCalls += 1;
      if (providerCalls === 1) {
        markProviderStarted();
        return providerResponse;
      }
      return new Response(null, { status: 200 });
    },
    now: () => NOW,
    randomUUID: () => eventIds.shift(),
  };

  const firstDisconnect = disconnectGoogleConnection(
    workspaceConfig(),
    ADMIN_EMAIL,
    dependencies,
  );
  await providerStarted;
  assert.equal(database.database.prepare(
    "SELECT status FROM google_drive_operations WHERE operation_key = ?",
  ).get(`${CONNECTION_KEY}:oauth:disconnect`).status, "in-progress");
  assert.equal(await adapter.saveConnection({
    id: "connection-1",
    connectionKey: CONNECTION_KEY,
    workspaceConnectionKey: CONNECTION_KEY,
    googleSubject: "google-subject",
    googleEmail: "operations@cherryhillfci.com",
    scopesJson: "[]",
    refreshTokenCiphertext: generationB.ciphertext,
    keyVersion: generationB.keyVersion,
    credentialSource: "fresh",
    actor: ADMIN_EMAIL,
    now: NOW,
    event: {
      id: "blocked-connected-event",
      eventType: "oauth.connected",
      actor: ADMIN_EMAIL,
      entityType: "connection",
      entityId: CONNECTION_KEY,
      detail: "mode=workspace",
      createdAt: NOW,
    },
  }), "stale");
  assert.equal(database.database.prepare(
    "SELECT NOT EXISTS (SELECT 1 FROM google_drive_operations WHERE connection_key = ? AND status IN ('in-progress', 'committing')) AS reset_allowed",
  ).get(CONNECTION_KEY).reset_allowed, 0);

  releaseProvider(new Response(null, { status: 200 }));
  assert.equal((await firstDisconnect).providerRevocation, "succeeded");
  assert.equal(database.database.prepare(
    "SELECT status FROM google_drive_operations WHERE operation_key = ?",
  ).get(`${CONNECTION_KEY}:oauth:disconnect`).status, "completed");

  assert.equal(await adapter.saveConnection({
    id: "connection-1",
    connectionKey: CONNECTION_KEY,
    workspaceConnectionKey: CONNECTION_KEY,
    googleSubject: "google-subject",
    googleEmail: "operations@cherryhillfci.com",
    scopesJson: "[]",
    refreshTokenCiphertext: generationB.ciphertext,
    keyVersion: generationB.keyVersion,
    credentialSource: "fresh",
    actor: ADMIN_EMAIL,
    now: NOW,
    event: {
      id: "connected-generation-b",
      eventType: "oauth.connected",
      actor: ADMIN_EMAIL,
      entityType: "connection",
      entityId: CONNECTION_KEY,
      detail: "mode=workspace",
      createdAt: NOW,
    },
  }), "saved");
  const secondDisconnect = await disconnectGoogleConnection(
    workspaceConfig(),
    ADMIN_EMAIL,
    dependencies,
  );
  assert.equal(secondDisconnect.providerRevocation, "succeeded");
  assert.equal(providerCalls, 2);
  assert.deepEqual({ ...database.database.prepare(
    "SELECT id, status FROM google_drive_operations WHERE operation_key = ?",
  ).get(`${CONNECTION_KEY}:oauth:disconnect`) }, {
    id: "oauth-disconnect:disconnect-b-local",
    status: "completed",
  }, "terminal operation reuse transfers exact ownership to the second disconnect");
  database.database.close();
});

test("an expired interrupted OAuth disconnect is recoverable without reopening a live lease", async () => {
  const database = new ExecutingOauthDatabase();
  const adapter = createD1GoogleOauthPersistence(database);
  insertExecutingConnection(database, { ciphertext: "ciphertext-generation-a" });

  assert.equal(await adapter.revokeConnection({
    connectionId: "connection-1",
    connectionKey: CONNECTION_KEY,
    workspaceConnectionKey: CONNECTION_KEY,
    refreshTokenCiphertext: "ciphertext-generation-a",
    operationId: "interrupted-disconnect",
    operationKey: `${CONNECTION_KEY}:oauth:disconnect`,
    leaseExpiresAt: NOW + 300_000,
    revokedAt: NOW,
    event: {
      id: "interrupted-disconnect-event",
      eventType: "oauth.disconnected",
      actor: ADMIN_EMAIL,
      entityType: "connection",
      entityId: CONNECTION_KEY,
      detail: "mode=workspace;google_revocation=pending;local_connection=revoked",
    },
  }), "revoked");
  assert.deepEqual({ ...database.database.prepare(
    "SELECT status, lease_expires_at FROM google_drive_operations WHERE id = ?",
  ).get("interrupted-disconnect") }, {
    status: "in-progress",
    lease_expires_at: NOW + 300_000,
  }, "the fixture intentionally simulates a crash before terminalization");

  const reconnect = (now, eventId) => adapter.saveConnection({
    id: "connection-2",
    connectionKey: CONNECTION_KEY,
    workspaceConnectionKey: CONNECTION_KEY,
    googleSubject: "google-subject",
    googleEmail: "operations@cherryhillfci.com",
    scopesJson: "[]",
    refreshTokenCiphertext: "ciphertext-generation-b",
    keyVersion: "2",
    credentialSource: "fresh",
    actor: ADMIN_EMAIL,
    now,
    event: {
      id: eventId,
      eventType: "oauth.connected",
      actor: ADMIN_EMAIL,
      entityType: "connection",
      entityId: CONNECTION_KEY,
      detail: "mode=workspace",
      createdAt: now,
    },
  });

  assert.equal(await reconnect(NOW + 299_999, "premature-reconnect-event"), "stale");
  assert.equal(database.database.prepare(
    "SELECT status FROM google_drive_operations WHERE id = ?",
  ).get("interrupted-disconnect").status, "in-progress");
  assert.equal(database.database.prepare(
    "SELECT COUNT(*) AS count FROM google_integration_events WHERE id = ?",
  ).get("premature-reconnect-event").count, 0);

  assert.equal(await reconnect(NOW + 300_001, "recovered-reconnect-event"), "saved");
  assert.deepEqual({ ...database.database.prepare(
    "SELECT status, lease_expires_at, last_error_code FROM google_drive_operations WHERE id = ?",
  ).get("interrupted-disconnect") }, {
    status: "failed",
    lease_expires_at: null,
    last_error_code: "oauth_disconnect_interrupted",
  });
  assert.deepEqual({ ...database.database.prepare(
    "SELECT refresh_token_ciphertext, key_version, status, revoked_at FROM google_connections WHERE connection_key = ?",
  ).get(CONNECTION_KEY) }, {
    refresh_token_ciphertext: "ciphertext-generation-b",
    key_version: "2",
    status: "connected",
    revoked_at: null,
  });
  assert.equal(database.database.prepare(
    "SELECT COUNT(*) AS count FROM google_integration_events WHERE id = ?",
  ).get("recovered-reconnect-event").count, 1);
  database.database.close();
});

test("same-millisecond disconnects produce one tombstone event and one provider revoke", async () => {
  const database = new ExecutingOauthDatabase();
  const adapter = createD1GoogleOauthPersistence(database);
  const secrets = createGoogleSecretStore({ currentVersion: "1", keys: { 1: TOKEN_KEY } });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST CONCURRENT DISCONNECT TOKEN",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  insertExecutingConnection(database, { ciphertext: encrypted.ciphertext });
  let reads = 0;
  let releaseReads;
  const bothRead = new Promise((resolve) => { releaseReads = resolve; });
  const coordinatedPersistence = {
    ...adapter,
    async findConnection(connectionKey) {
      const row = await adapter.findConnection(connectionKey);
      reads += 1;
      if (reads === 2) releaseReads();
      await bothRead;
      return row;
    },
  };
  let releaseProvider;
  let markProviderStarted;
  const providerStarted = new Promise((resolve) => { markProviderStarted = resolve; });
  const providerResponse = new Promise((resolve) => { releaseProvider = resolve; });
  let providerCalls = 0;
  const makeDependencies = (ids) => ({
    persistence: coordinatedPersistence,
    secrets,
    async fetch() {
      providerCalls += 1;
      markProviderStarted();
      return providerResponse;
    },
    now: () => NOW,
    randomUUID: () => ids.shift(),
  });
  const settle = (operation) => operation.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
  const first = settle(disconnectGoogleConnection(
    workspaceConfig(),
    ADMIN_EMAIL,
    makeDependencies(["concurrent-a-local", "concurrent-a-provider"]),
  ));
  const second = settle(disconnectGoogleConnection(
    workspaceConfig(),
    ADMIN_EMAIL,
    makeDependencies(["concurrent-b-local", "concurrent-b-provider"]),
  ));
  await providerStarted;
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseProvider(new Response(null, { status: 200 }));
  const outcomes = await Promise.all([first, second]);

  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = outcomes.find(({ status }) => status === "rejected");
  assert.equal(rejected.reason.code, "google_operation_in_progress");
  assert.equal(rejected.reason.status, 409);
  assert.equal(providerCalls, 1);
  assert.equal(database.database.prepare(
    "SELECT COUNT(*) AS count FROM google_integration_events WHERE event_type = 'oauth.disconnected'",
  ).get().count, 1);
  assert.equal(database.database.prepare(
    "SELECT COUNT(*) AS count FROM google_integration_events WHERE event_type = 'oauth.provider_revocation_recorded'",
  ).get().count, 1);
  database.database.close();
});

test("a reset between disconnect read and tombstone write cannot recreate either disconnect event", async () => {
  const secrets = createGoogleSecretStore({ currentVersion: "1", keys: { 1: TOKEN_KEY } });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST RESET RACE TOKEN",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  let integrationEvents = 0;
  let providerCalls = 0;
  const result = await disconnectGoogleConnection(workspaceConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return {
          id: "connection-reset-race",
          googleEmail: "operations@cherryhillfci.com",
          refreshTokenCiphertext: encrypted.ciphertext,
          keyVersion: encrypted.keyVersion,
          status: "connected",
        };
      },
      async revokeConnection() {
        // WS-19 deleted the exact row before the guarded tombstone batch ran.
        return "stale";
      },
      async writeIntegrationEvent() {
        integrationEvents += 1;
      },
      async writeRevocationOutcomeEvent() {
        integrationEvents += 1;
        return true;
      },
    }),
    secrets,
    async fetch() {
      providerCalls += 1;
      return new Response(null, { status: 200 });
    },
    now: () => NOW,
    randomUUID: () => "event-reset-race",
  });

  assert.equal(result.connectionRevoked, false);
  assert.equal(result.providerRevocation, "not_attempted");
  assert.equal(providerCalls, 0,
    "a stale local generation must never revoke a newer Google grant");
  assert.equal(integrationEvents, 0);
});

test("live revocation distinguishes provider success from no usable token", async () => {
  const secrets = createGoogleSecretStore({
    currentVersion: "1",
    keys: { 1: TOKEN_KEY },
  });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST REFRESH TOKEN",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  let successfulEvent = null;
  let successfulProviderEvent = null;
  const successfulEventIds = ["event-success-local", "event-success-provider"];
  const succeeded = await disconnectGoogleConnection(workspaceConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return {
          id: "connection-1",
          googleEmail: "operations@cherryhillfci.com",
          refreshTokenCiphertext: encrypted.ciphertext,
          keyVersion: encrypted.keyVersion,
          status: "connected",
        };
      },
      async revokeConnection(input) {
        successfulEvent = input.event;
        return "revoked";
      },
      async writeRevocationOutcomeEvent(input) {
        successfulProviderEvent = input.event;
        return true;
      },
    }),
    secrets,
    async fetch() {
      return new Response(null, { status: 200 });
    },
    now: () => NOW,
    randomUUID: () => successfulEventIds.shift(),
  });
  assert.equal(succeeded.providerRevocation, "succeeded");
  assert.equal(succeeded.revocationRequested, true);
  assert.match(successfulEvent.detail, /google_revocation=pending/u);
  assert.match(successfulProviderEvent.detail, /google_revocation=succeeded/u);

  let providerCalls = 0;
  let noTokenEvent = null;
  const notAttempted = await disconnectGoogleConnection(workspaceConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return null;
      },
      async writeIntegrationEvent(input) {
        noTokenEvent = input;
      },
    }),
    secrets,
    async fetch() {
      providerCalls += 1;
      throw new Error("no token means no provider call");
    },
    now: () => NOW,
    randomUUID: () => "event-not-attempted",
  });
  assert.equal(providerCalls, 0);
  assert.equal(notAttempted.providerRevocation, "not_attempted");
  assert.equal(notAttempted.revocationRequested, false);
  assert.equal(noTokenEvent, null,
    "a missing live row must not recreate a post-reset disconnect event");
});

test("live revocation attempts Google for a retained reauthorization credential", async () => {
  const secrets = createGoogleSecretStore({
    currentVersion: "1",
    keys: { 1: TOKEN_KEY },
  });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST REAUTHORIZATION TOKEN",
    secrets,
    `google-connection:${CONNECTION_KEY}:refresh`,
  );
  let providerCalls = 0;
  let event = null;
  let providerEvent = null;
  const eventIds = ["event-reauthorization-local", "event-reauthorization-provider"];
  const result = await disconnectGoogleConnection(workspaceConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return {
          id: "connection-reauthorization",
          googleEmail: "operations@cherryhillfci.com",
          refreshTokenCiphertext: encrypted.ciphertext,
          keyVersion: encrypted.keyVersion,
          status: "reauthorization-required",
        };
      },
      async revokeConnection(input) {
        event = input.event;
        return "revoked";
      },
      async writeRevocationOutcomeEvent(input) {
        providerEvent = input.event;
        return true;
      },
    }),
    secrets,
    async fetch() {
      providerCalls += 1;
      return new Response(null, { status: 200 });
    },
    now: () => NOW,
    randomUUID: () => eventIds.shift(),
  });

  assert.equal(providerCalls, 1);
  assert.equal(result.providerRevocation, "succeeded");
  assert.match(event.detail, /google_revocation=pending/u);
  assert.match(providerEvent.detail, /google_revocation=succeeded/u);
});

test("revoked tombstones cannot be resurrected without a new refresh token", async () => {
  const secrets = createGoogleSecretStore({
    currentVersion: "1",
    keys: { 1: TOKEN_KEY },
  });
  const saved = [];
  const dependencies = {
    persistence: persistence({
      async findConnection() {
        return {
          id: "connection-1",
          googleEmail: "operations@cherryhillfci.com",
          refreshTokenCiphertext: "FCI_TEST_OLD_TOMBSTONE",
          keyVersion: "old",
          scopesJson: "[]",
          status: "revoked",
        };
      },
      async saveConnection(input) {
        saved.push(input);
        return "saved";
      },
    }),
    secrets,
    async fetch() {
      throw new Error("not used");
    },
    now: () => NOW,
    randomUUID: () => "connection-new",
  };
  const profile = {
    subject: "google-subject",
    email: "operations@cherryhillfci.com",
    emailVerified: true,
  };

  await assert.rejects(
    saveGoogleConnection(
      workspaceConfig(),
      { accessToken: "access", scope: [] },
      profile,
      ADMIN_EMAIL,
      dependencies,
    ),
    (error) => error.code === "refresh_token_missing" && error.status === 409,
  );
  assert.equal(saved.length, 0);

  await saveGoogleConnection(
    workspaceConfig(),
    { accessToken: "access", refreshToken: "FCI TEST NEW REFRESH TOKEN", scope: [] },
    profile,
    ADMIN_EMAIL,
    dependencies,
  );
  assert.equal(saved.length, 1);
  assert.notEqual(saved[0].refreshTokenCiphertext, "FCI_TEST_OLD_TOMBSTONE");
  assert.equal(saved[0].id, "connection-1");
});

test("non-revoked reconnects retain the existing refresh token when Google omits one", async () => {
  const saved = [];
  await saveGoogleConnection(
    workspaceConfig(),
    { accessToken: "access", scope: [] },
    {
      subject: "google-subject",
      email: "operations@cherryhillfci.com",
      emailVerified: true,
    },
    ADMIN_EMAIL,
    {
      persistence: persistence({
        async findConnection() {
          return {
            id: "connection-1",
            googleSubject: "google-subject",
            googleEmail: "operations@cherryhillfci.com",
            refreshTokenCiphertext: "FCI_TEST_EXISTING_CIPHERTEXT",
            keyVersion: "1",
            status: "reauthorization-required",
          };
        },
        async saveConnection(input) {
          saved.push(input);
          return "saved";
        },
      }),
      secrets: createGoogleSecretStore({
        currentVersion: "1",
        keys: { 1: TOKEN_KEY },
      }),
      async fetch() {
        throw new Error("not used");
      },
      now: () => NOW,
      randomUUID: () => "connection-new",
    },
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].refreshTokenCiphertext, "FCI_TEST_EXISTING_CIPHERTEXT");
  assert.equal(saved[0].keyVersion, "1");
});

test("D1 reconnect stores only the fresh credential and clears the revoked marker", async () => {
  const calls = [];
  const adapter = createD1GoogleOauthPersistence({
    prepare(sql) {
      return statement(sql, calls);
    },
    async batch() {
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ];
    },
  });

  assert.equal(await adapter.saveConnection({
    id: "connection-1",
    connectionKey: CONNECTION_KEY,
    workspaceConnectionKey: CONNECTION_KEY,
    googleSubject: "new-google-subject",
    googleEmail: "operations@cherryhillfci.com",
    scopesJson: "[]",
    refreshTokenCiphertext: "FCI_TEST_NEW_CIPHERTEXT",
    keyVersion: "2",
    credentialSource: "fresh",
    actor: ADMIN_EMAIL,
    now: NOW,
    event: {
      id: "event-fresh-connection",
      eventType: "oauth.connected",
      actor: ADMIN_EMAIL,
      entityType: "connection",
      entityId: CONNECTION_KEY,
      detail: "mode=workspace",
      createdAt: NOW,
    },
  }), "saved");

  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /ON CONFLICT\(connection_key\) DO UPDATE/u);
  assert.match(calls[0].sql, /refresh_token_ciphertext = excluded\.refresh_token_ciphertext/u);
  assert.match(calls[0].sql, /key_version = excluded\.key_version/u);
  assert.match(calls[0].sql, /status = 'connected'/u);
  assert.match(calls[0].sql, /revoked_at = NULL/u);
  assert.equal(calls[0].values[5], "FCI_TEST_NEW_CIPHERTEXT");
  assert.equal(calls[0].values[6], "2");
  assert.match(calls[1].sql, /^UPDATE google_drive_operations/u);
  assert.match(calls[1].sql, /operation_key = connection_key \|\| ':oauth:disconnect'.+status = 'in-progress'.+lease_expires_at <= \?/u);
  assert.match(calls[2].sql, /^INSERT INTO google_integration_events/u);
  assert.match(calls[2].sql, /WHERE changes\(\) = 1 AND EXISTS.+refresh_token_ciphertext = \?.+revoked_at IS NULL/u);
});

test("delayed access-token outcomes cannot mutate a same-row reconnect generation", async (t) => {
  for (const fixture of [
    { name: "success", response: () => Response.json({ access_token: "stale-access-token" }) },
    { name: "invalid grant", response: () => Response.json({ error: "invalid_grant" }, { status: 400 }) },
  ]) {
    await t.test(fixture.name, async () => {
      const database = new ExecutingOauthDatabase();
      const adapter = createD1GoogleOauthPersistence(database);
      const secrets = createGoogleSecretStore({ currentVersion: "1", keys: { 1: TOKEN_KEY } });
      const encrypted = await encryptGoogleSecretWithStore(
        "FCI TEST GENERATION A",
        secrets,
        `google-connection:${CONNECTION_KEY}:refresh`,
      );
      database.database.prepare(`INSERT INTO google_connections (
        id, connection_key, google_subject, google_email, scopes_json,
        refresh_token_ciphertext, key_version, status, last_error_code,
        last_success_at, created_by, created_at, updated_at, revoked_at
      ) VALUES (?, ?, ?, ?, '[]', ?, ?, 'connected', NULL, NULL, ?, ?, ?, NULL)`)
        .run(
          "connection-1",
          CONNECTION_KEY,
          "google-subject",
          "operations@cherryhillfci.com",
          encrypted.ciphertext,
          encrypted.keyVersion,
          ADMIN_EMAIL,
          NOW,
          NOW,
        );
      let releaseProvider;
      let markProviderStarted;
      const providerStarted = new Promise((resolve) => { markProviderStarted = resolve; });
      const providerResponse = new Promise((resolve) => { releaseProvider = resolve; });
      const operation = getGoogleAccessToken(workspaceConfig(), undefined, {
        persistence: adapter,
        secrets,
        async fetch() {
          markProviderStarted();
          return providerResponse;
        },
        now: () => NOW + 1,
        randomUUID: () => "unused",
      });
      await providerStarted;
      database.database.prepare(`UPDATE google_connections
        SET refresh_token_ciphertext = 'ciphertext-generation-b',
            key_version = '2', status = 'connected', last_error_code = NULL,
            last_success_at = NULL, updated_at = ?, revoked_at = NULL
        WHERE id = ?`).run(NOW + 2, "connection-1");
      releaseProvider(fixture.response());

      if (fixture.name === "success") {
        assert.equal(await operation, "stale-access-token");
      } else {
        await assert.rejects(
          operation,
          (error) => error.code === "refresh_token_rejected" && error.status === 409,
        );
      }
      const current = database.database.prepare(
        "SELECT refresh_token_ciphertext, status, last_error_code, last_success_at FROM google_connections WHERE id = ?",
      ).get("connection-1");
      assert.deepEqual({ ...current }, {
        refresh_token_ciphertext: "ciphertext-generation-b",
        status: "connected",
        last_error_code: null,
        last_success_at: null,
      });
      database.database.close();
    });
  }
});

test("interleaved first-time callbacks cannot atomically save connections from different Workspace domains", async () => {
  const database = new ExecutingOauthDatabase();
  const adapter = createD1GoogleOauthPersistence(database);
  const config = workspaceConfig();
  const firstProfile = {
    subject: "first-google-subject",
    email: "operations@cherryhillfci.com",
    emailVerified: true,
  };
  const secondProfile = {
    subject: "second-google-subject",
    email: "operations@other.example",
    emailVerified: true,
  };

  // Both callbacks finish their read-side tenant check before either writer runs.
  const [firstConfig, secondConfig] = await Promise.all([
    resolveGoogleMailboxConnectionConfig(config, firstProfile, { persistence: adapter }),
    resolveGoogleMailboxConnectionConfig(config, secondProfile, { persistence: adapter }),
  ]);
  const ids = [
    "first-connection",
    "first-connected-event",
    "second-connection",
    "second-connected-event",
  ];
  const dependencies = {
    persistence: adapter,
    secrets: createGoogleSecretStore({ currentVersion: "1", keys: { 1: TOKEN_KEY } }),
    async fetch() { throw new Error("not used"); },
    now: () => NOW,
    randomUUID: () => ids.shift(),
  };

  await saveGoogleConnection(
    firstConfig,
    { accessToken: "first-access", refreshToken: "FCI TEST FIRST REFRESH", scope: [] },
    firstProfile,
    ADMIN_EMAIL,
    dependencies,
  );
  await assert.rejects(
    saveGoogleConnection(
      secondConfig,
      { accessToken: "second-access", refreshToken: "FCI TEST SECOND REFRESH", scope: [] },
      secondProfile,
      ADMIN_EMAIL,
      dependencies,
    ),
    (error) => error.code === "google_tenant_reset_required" && error.status === 409,
  );

  const rows = database.database.prepare(
    "SELECT connection_key, google_email FROM google_connections ORDER BY connection_key",
  ).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [{
    connection_key: firstConfig.authConnectionKey,
    google_email: firstProfile.email,
  }]);
});

test("a reused D1 credential is atomically fenced against disconnect races and maps stale to 409", async () => {
  const calls = [];
  const adapter = createD1GoogleOauthPersistence({
    prepare(sql) {
      const prepared = statement(sql, calls);
      prepared.run = async () => ({ meta: { changes: 0 } });
      return prepared;
    },
    async batch() {
      return [
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
      ];
    },
  });

  assert.equal(await adapter.saveConnection({
    id: "connection-1",
    connectionKey: CONNECTION_KEY,
    workspaceConnectionKey: CONNECTION_KEY,
    googleSubject: "google-subject",
    googleEmail: "operations@cherryhillfci.com",
    scopesJson: "[]",
    refreshTokenCiphertext: "FCI_TEST_REUSED_CIPHERTEXT",
    keyVersion: "1",
    credentialSource: "reused",
    actor: ADMIN_EMAIL,
    now: NOW,
    event: {
      id: "event-reused-connection",
      eventType: "oauth.connected",
      actor: ADMIN_EMAIL,
      entityType: "connection",
      entityId: CONNECTION_KEY,
      detail: "mode=workspace",
      createdAt: NOW,
    },
  }), "stale");
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /^UPDATE google_connections SET/u);
  assert.match(calls[0].sql, /status <> 'revoked'/u);
  assert.match(calls[0].sql, /refresh_token_ciphertext = \?/u);
  assert.match(calls[0].sql, /key_version = \?.+NOT EXISTS.+tenant_connection/u);
  assert.deepEqual(calls[0].values.slice(-6), [
    CONNECTION_KEY,
    "FCI_TEST_REUSED_CIPHERTEXT",
    "1",
    "cherryhillfci.com",
    CONNECTION_KEY,
    CONNECTION_KEY,
  ]);
  assert.match(calls[1].sql, /^UPDATE google_drive_operations/u);

  await assert.rejects(
    saveGoogleConnection(
      workspaceConfig(),
      { accessToken: "access", scope: [] },
      {
        subject: "google-subject",
        email: "operations@cherryhillfci.com",
        emailVerified: true,
      },
      ADMIN_EMAIL,
      {
        persistence: persistence({
          async findConnection() {
            return {
              id: "connection-1",
              googleSubject: "google-subject",
              googleEmail: "operations@cherryhillfci.com",
              refreshTokenCiphertext: "FCI_TEST_REUSED_CIPHERTEXT",
              keyVersion: "1",
              status: "connected",
            };
          },
          async saveConnection(input) {
            assert.equal(input.credentialSource, "reused");
            return "stale";
          },
        }),
        secrets: createGoogleSecretStore({
          currentVersion: "1",
          keys: { 1: TOKEN_KEY },
        }),
        async fetch() {
          throw new Error("not used");
        },
        now: () => NOW,
        randomUUID: () => "connection-new",
      },
    ),
    (error) => error.code === "stale_google_connection" && error.status === 409,
  );
});

test("the explicit disconnect route is admin, same-origin, bounded, and does not double-write its event", async () => {
  const source = await readFile(
    new URL("app/api/v1/integrations/google/connection/route.ts", root),
    "utf8",
  );
  const handler = source.slice(source.indexOf("export async function DELETE"));

  assert.match(handler, /requireSameOrigin\(request\)/u);
  assert.match(handler, /requireOfficeUser\(request, \{ admin: true \}\)/u);
  assert.match(handler, /if \(originError\) return noStoreResponse\(originError\)/u);
  assert.match(handler, /if \("response" in auth\) return noStoreResponse\(auth\.response\)/u);
  assert.match(handler, /parseBoundedJsonObject\(request,/u);
  assert.match(handler, /fields\.length !== 1/u);
  assert.match(handler, /fields\[0\] !== "mailbox"/u);
  assert.match(handler, /getGoogleMailboxRuntimeConfig\(mailbox\)/u);
  assert.match(handler, /disconnectGoogleConnection\(config, auth\.user\.email\)/u);
  assert.doesNotMatch(handler, /writeGoogleIntegrationEvent/u);
  assert.match(handler, /return noStore\(/u);
});

test("the explicit disconnect rejects cross-origin and non-admin callers before persistence or provider effects", async (t) => {
  await t.test("cross-origin", async () => {
    const response = await connectionRoute.DELETE(
      new NextRequest("https://fci.example.test/api/v1/integrations/google/connection", {
        method: "DELETE",
        headers: {
          origin: "https://attacker.example.test",
          "oai-authenticated-user-email": ADMIN_EMAIL,
        },
      }),
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "Cross-origin requests are not allowed.",
    });
  });

  await t.test("non-admin", async () => {
    const response = await connectionRoute.DELETE(
      new NextRequest("https://fci.example.test/api/v1/integrations/google/connection", {
        method: "DELETE",
        headers: {
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "office@cherryhillfci.com",
        },
      }),
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "An FCI administrator must complete this action.",
    });
  });
});
