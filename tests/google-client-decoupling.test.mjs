import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/google-client-decoupling",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false },
});
const [oauthModule, productionModule] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth.ts"),
  vite.ssrLoadModule("/app/application/google-workspace-oauth.ts"),
]);
const {
  createGoogleSecretStore,
  decryptGoogleSecretWithStore,
  encryptGoogleSecretWithStore,
  getGoogleRuntimeConfig,
} = oauthModule;
const {
  createProductionGoogleOauth,
  decryptProductionGoogleCredential,
} = productionModule;

after(async () => vite.close());

const KEY_V1 = Buffer.alloc(32, 0x11).toString("base64url");
const KEY_V2 = Buffer.alloc(32, 0x22).toString("base64url");
const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const CREDENTIAL_ID = "44444444-4444-4444-8444-444444444444";
const NOW = Date.UTC(2026, 6, 19, 16, 0, 0);

function audit(id) {
  return {
    id,
    executorType: "user",
    executorUserId: USER_ID,
    executorKey: `user:${USER_ID}`,
    originatingUserId: null,
    originatingActorKey: null,
    action: "integration.oauth_test",
    targetType: "integration_connection",
    targetId: CONNECTION_ID,
    result: "succeeded",
    reasonCode: null,
    requestId: "request-test",
    correlationId: "correlation-test",
    source: "test",
    metadata: {},
    occurredAt: NOW,
    retentionPolicyKey: "security_default",
    retentionUntil: null,
  };
}

function workspaceConfig() {
  return getGoogleRuntimeConfig({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "shared-drive-test",
    GOOGLE_WORKSPACE_CLIENT_ID: "connector-client.apps.googleusercontent.com",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "test-only-client-secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://ops.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: KEY_V2,
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION: "2",
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive",
  });
}

test("stored key versions decrypt after the writer rotates and never fall back implicitly", async () => {
  const writerV1 = createGoogleSecretStore({
    currentVersion: "1",
    keys: { 1: KEY_V1, 2: KEY_V2 },
  });
  const encrypted = await encryptGoogleSecretWithStore(
    "FCI TEST — DO NOT USE refresh token",
    writerV1,
    "test:refresh",
  );
  assert.equal(encrypted.keyVersion, "1");

  const writerV2 = createGoogleSecretStore({
    currentVersion: "2",
    keys: { 1: KEY_V1, 2: KEY_V2 },
  });
  assert.equal(
    await decryptGoogleSecretWithStore(encrypted.ciphertext, "1", writerV2, "test:refresh"),
    "FCI TEST — DO NOT USE refresh token",
  );
  const newCiphertext = await encryptGoogleSecretWithStore("new-token", writerV2, "test:refresh");
  assert.equal(newCiphertext.keyVersion, "2");

  const currentOnly = createGoogleSecretStore({ currentVersion: "2", keys: { 2: KEY_V2 } });
  await assert.rejects(
    decryptGoogleSecretWithStore(encrypted.ciphertext, "1", currentOnly, "test:refresh"),
    (error) => error.code === "encryption_key_version_unavailable" && error.status === 503,
  );
});

test("production OAuth consumes PKCE once, decrypts its stored v1, and writes refresh ciphertext with v2", async () => {
  let currentVersion = "1";
  const keys = new Map([["1", KEY_V1], ["2", KEY_V2]]);
  const secrets = {
    async current() {
      return { version: currentVersion, keyMaterial: keys.get(currentVersion) };
    },
    async get(version) {
      return keys.get(version) ?? null;
    },
  };
  let storedAttempt;
  let completedConnection;
  let activeCredential;
  let rotatedCredential;
  let consumed = false;
  const repository = {
    async createOauthAttempt(input) {
      storedAttempt = input;
      return { outcome: "accepted", version: "1" };
    },
    async consumeOauthAttempt(input) {
      if (consumed || input.stateHash !== storedAttempt.stateHash || input.browserNonceHash !== storedAttempt.browserNonceHash) {
        return { outcome: "stale" };
      }
      consumed = true;
      return {
        outcome: "consumed",
        value: {
          id: storedAttempt.id,
          pkceVerifierCiphertext: storedAttempt.pkceVerifierCiphertext,
          keyVersion: storedAttempt.keyVersion,
          version: "2",
        },
      };
    },
    async completeOauthConnection(input) {
      completedConnection = input;
      return { outcome: "accepted", version: "2" };
    },
    async getActiveCredential() {
      return activeCredential;
    },
    async rotateCredential(input) {
      rotatedCredential = input;
      return { outcome: "accepted", version: "4" };
    },
  };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({
        access_token: "access-token",
        refresh_token: "FCI TEST — DO NOT USE refresh-token-v2",
        scope: workspaceConfig().scopes.join(" "),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("openidconnect.googleapis.com/v1/userinfo")) {
      return new Response(JSON.stringify({
        sub: "google-subject-test",
        email: "operations@cherryhillfci.com",
        email_verified: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected provider request: ${url}`);
  };
  const uuids = [ATTEMPT_ID, CREDENTIAL_ID];
  let randomSeed = 1;
  const service = createProductionGoogleOauth(workspaceConfig(), {
    repository,
    secrets,
    fetch: fetcher,
    now: () => NOW,
    randomUUID: () => uuids.shift(),
    randomBytes(byteLength) {
      const bytes = new Uint8Array(byteLength);
      bytes.fill(randomSeed);
      randomSeed += 1;
      return bytes;
    },
  });
  const legacyRefresh = await encryptGoogleSecretWithStore(
    "FCI TEST — DO NOT USE legacy refresh token",
    secrets,
    `google-integration:${CONNECTION_ID}:refresh-token`,
  );

  const begun = await service.begin({
    connectionId: CONNECTION_ID,
    initiatedByUserId: USER_ID,
    browserNonce: "browser-nonce-test",
    audit: audit("55555555-5555-4555-8555-555555555555"),
  });
  assert.equal(begun.attemptId, ATTEMPT_ID);
  assert.equal(storedAttempt.keyVersion, "1");
  assert.match(storedAttempt.stateHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(storedAttempt.browserNonceHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(begun.authorizationUrl, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);

  currentVersion = "2";
  const finished = await service.finish({
    connectionId: CONNECTION_ID,
    expectedConnectionVersion: "1",
    expectedAttemptVersion: begun.attemptVersion,
    initiatedByUserId: USER_ID,
    completedByActorKey: `user:${USER_ID}`,
    browserNonce: "browser-nonce-test",
    state: begun.state,
    code: "authorization-code-test",
    consumeAudit: audit("66666666-6666-4666-8666-666666666666"),
    completionAudit: audit("77777777-7777-4777-8777-777777777777"),
  });
  assert.equal(finished.connectionVersion, "2");
  assert.equal(finished.account, "operations@cherryhillfci.com");
  assert.equal(completedConnection.keyVersion, "2");
  assert.equal(completedConnection.credentialId, CREDENTIAL_ID);
  assert.equal(
    await decryptProductionGoogleCredential(
      CONNECTION_ID,
      completedConnection.refreshTokenCiphertext,
      completedConnection.keyVersion,
      secrets,
    ),
    "FCI TEST — DO NOT USE refresh-token-v2",
  );
  assert.equal(calls.length, 2);

  activeCredential = {
    id: CREDENTIAL_ID,
    connectionId: CONNECTION_ID,
    credentialKind: "refresh_token",
    ciphertext: new TextEncoder().encode(legacyRefresh.ciphertext),
    keyVersion: legacyRefresh.keyVersion,
    version: "3",
  };
  const rotation = await service.rotateRefreshCredential({
    connectionId: CONNECTION_ID,
    audit: audit("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  });
  assert.deepEqual(rotation, { rotated: true, version: "4", keyVersion: "2" });
  assert.equal(rotatedCredential.expectedVersion, "3");
  assert.equal(rotatedCredential.keyVersion, "2");
  assert.equal(
    await decryptProductionGoogleCredential(
      CONNECTION_ID,
      rotatedCredential.ciphertext,
      rotatedCredential.keyVersion,
      secrets,
    ),
    "FCI TEST — DO NOT USE legacy refresh token",
  );

  await assert.rejects(
    service.finish({
      connectionId: CONNECTION_ID,
      expectedConnectionVersion: "1",
      expectedAttemptVersion: begun.attemptVersion,
      initiatedByUserId: USER_ID,
      completedByActorKey: `user:${USER_ID}`,
      browserNonce: "browser-nonce-test",
      state: begun.state,
      code: "authorization-code-test",
      consumeAudit: audit("88888888-8888-4888-8888-888888888888"),
      completionAudit: audit("99999999-9999-4999-8999-999999999999"),
    }),
    (error) => error.code === "invalid_oauth_state" && error.status === 400,
  );
  assert.equal(calls.length, 2);
});

test("Cloud Run client graph is Cloudflare-free and provider routes remain uncomposed", async () => {
  const coreFiles = [
    "app/lib/google-oauth.ts",
    "app/lib/google-drive.ts",
    "app/lib/google-gmail.ts",
    "app/lib/google-calendar-client.ts",
    "app/lib/google-sheets.ts",
    "app/application/google-workspace-oauth.ts",
  ];
  for (const path of coreFiles) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /cloudflare:workers/, path);
  }
  const [tsconfig, router, composition] = await Promise.all([
    readFile(new URL("tsconfig.cloud-run.json", root), "utf8"),
    readFile(new URL("app/platform/google-cloud/employee-request-router.ts", root), "utf8"),
    readFile(new URL("app/platform/google-cloud/production-composition.ts", root), "utf8"),
  ]);
  for (const path of coreFiles.slice(0, 6)) {
    assert.match(tsconfig, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(router, /503, \{ error: "feature_unavailable" \}/);
  assert.doesNotMatch(router, /createProductionGoogleOauth|google-workspace-oauth/);
  assert.doesNotMatch(composition, /createProductionGoogleOauth|google-workspace-oauth/);
});
