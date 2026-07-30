import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  getGoogleRuntimeConfig,
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
    async revokeConnection() {
      return false;
    },
    async saveConnection() {
      return "saved";
    },
    async markConnectionAccountRejected() {},
    async markConnectionRefreshSucceeded() {},
    async markConnectionRefreshFailed() {},
    async writeIntegrationEvent() {},
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
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    },
  });

  const revoked = await adapter.revokeConnection({
    connectionKey: CONNECTION_KEY,
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

  assert.equal(revoked, true);
  assert.equal(batchStatements.length, 2);
  assert.match(calls[0].sql, /^UPDATE google_connections SET refresh_token_ciphertext = '', key_version = '', status = 'revoked'/u);
  assert.match(calls[0].sql, /WHERE connection_key = \?$/u);
  assert.doesNotMatch(calls[0].sql, /\bDELETE\b/u);
  assert.deepEqual(calls[0].values, [NOW, NOW, CONNECTION_KEY]);
  assert.match(calls[1].sql, /^INSERT INTO google_integration_events/u);
  assert.match(calls[1].sql, /WHERE EXISTS \(SELECT 1 FROM google_connections WHERE connection_key = \?\)$/u);
  assert.deepEqual(calls[1].values, [
    "event-1",
    CONNECTION_KEY,
    "oauth.disconnected",
    ADMIN_EMAIL,
    "connection",
    CONNECTION_KEY,
    "mode=workspace;google_revocation=pending;local_connection=revoked",
    NOW,
    CONNECTION_KEY,
  ]);

  const unauditedAdapter = createD1GoogleOauthPersistence({
    prepare(sql) {
      return statement(sql, []);
    },
    async batch() {
      return [{ meta: { changes: 1 } }, { meta: { changes: 0 } }];
    },
  });
  await assert.rejects(
    unauditedAdapter.revokeConnection({
      connectionKey: CONNECTION_KEY,
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
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    },
  });
  assert.equal(
    await missingAdapter.revokeConnection({
      connectionKey: CONNECTION_KEY,
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
    false,
  );
  assert.match(missingCalls[1].sql, /WHERE EXISTS \(SELECT 1 FROM google_connections/u);
});

test("simulation revocation records an honest local event without secrets or Google", async () => {
  let revokeInput = null;
  let standaloneEvent = null;
  let secretReads = 0;
  let providerCalls = 0;
  const result = await disconnectGoogleConnection(simulationConfig(), ADMIN_EMAIL, {
    persistence: persistence({
      async findConnection() {
        return null;
      },
      async revokeConnection(input) {
        revokeInput = input;
        return false;
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
  assert.equal(revokeInput.event.eventType, "oauth.disconnected");
  assert.equal(revokeInput.event.actor, ADMIN_EMAIL);
  assert.match(revokeInput.event.detail, /google_revocation=skipped_simulation/u);
  assert.match(revokeInput.event.detail, /local_connection=not-found/u);
  assert.deepEqual(standaloneEvent, {
    ...revokeInput.event,
    connectionKey: "workspace-simulation",
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
        return true;
      },
      async writeIntegrationEvent(input) {
        order.push("provider-outcome");
        providerEvent = input;
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

test("local severance completes before a stalled Google revocation can finish", async () => {
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
        markLocallySevered();
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
  releaseProvider(new Response(null, { status: 200 }));
  const result = await operation;

  assert.equal(severedBeforeProviderFinished, true);
  assert.equal(result.connectionRevoked, true);
  assert.equal(result.providerRevocation, "succeeded");
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
        return true;
      },
      async writeIntegrationEvent(input) {
        successfulProviderEvent = input;
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
      async revokeConnection(input) {
        noTokenEvent = input.event;
        return false;
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
  assert.match(noTokenEvent.detail, /google_revocation=not_attempted/u);
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
        return true;
      },
      async writeIntegrationEvent(input) {
        providerEvent = input;
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
      throw new Error("save does not batch");
    },
  });

  assert.equal(await adapter.saveConnection({
    id: "connection-1",
    connectionKey: CONNECTION_KEY,
    googleSubject: "new-google-subject",
    googleEmail: "operations@cherryhillfci.com",
    scopesJson: "[]",
    refreshTokenCiphertext: "FCI_TEST_NEW_CIPHERTEXT",
    keyVersion: "2",
    credentialSource: "fresh",
    actor: ADMIN_EMAIL,
    now: NOW,
  }), "saved");

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT\(connection_key\) DO UPDATE/u);
  assert.match(calls[0].sql, /refresh_token_ciphertext = excluded\.refresh_token_ciphertext/u);
  assert.match(calls[0].sql, /key_version = excluded\.key_version/u);
  assert.match(calls[0].sql, /status = 'connected'/u);
  assert.match(calls[0].sql, /revoked_at = NULL/u);
  assert.equal(calls[0].values[5], "FCI_TEST_NEW_CIPHERTEXT");
  assert.equal(calls[0].values[6], "2");
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
      throw new Error("reused saves do not batch");
    },
  });

  assert.equal(await adapter.saveConnection({
    id: "connection-1",
    connectionKey: CONNECTION_KEY,
    googleSubject: "google-subject",
    googleEmail: "operations@cherryhillfci.com",
    scopesJson: "[]",
    refreshTokenCiphertext: "FCI_TEST_REUSED_CIPHERTEXT",
    keyVersion: "1",
    credentialSource: "reused",
    actor: ADMIN_EMAIL,
    now: NOW,
  }), "stale");
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^UPDATE google_connections SET/u);
  assert.match(calls[0].sql, /status <> 'revoked'/u);
  assert.match(calls[0].sql, /refresh_token_ciphertext = \?/u);
  assert.match(calls[0].sql, /key_version = \?$/u);
  assert.deepEqual(calls[0].values.slice(-3), [
    CONNECTION_KEY,
    "FCI_TEST_REUSED_CIPHERTEXT",
    "1",
  ]);

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
  assert.match(handler, /Object\.keys\(parsed\.body\)\.length > 0/u);
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
