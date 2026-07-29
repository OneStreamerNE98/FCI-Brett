import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/integration-metadata",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24688 } },
});
const { createPostgresIntegrationMetadataRepository } = await vite.ssrLoadModule(
  "/app/adapters/postgres/integration-metadata-repository.ts",
);

after(async () => {
  await vite.close();
});

const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const OAUTH_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_ID = "66666666-6666-4666-8666-666666666666";
const CREDENTIAL_ID = "77777777-7777-4777-8777-777777777777";
const CREATED_AT = Date.UTC(2026, 6, 15, 12, 0, 0);
const RECORDED_AT = new Date(CREATED_AT + 25);
const STATE_HASH = `sha256:${"a".repeat(64)}`;
const NONCE_HASH = `sha256:${"b".repeat(64)}`;
const PKCE_CIPHERTEXT = Uint8Array.from(
  { length: 32 },
  (_, index) => (index * 7 + 3) % 256,
);
const KEY_VERSION = "kms-key-v1";

function auditEvent(overrides = {}) {
  return {
    id: AUDIT_ID,
    executorType: "user",
    executorUserId: USER_ID,
    executorKey: `user:${USER_ID}`,
    originatingUserId: null,
    originatingActorKey: null,
    action: "integration.metadata_registered",
    targetType: "integration_connection",
    targetId: CONNECTION_ID,
    result: "succeeded",
    reasonCode: null,
    requestId: "request-integration-1",
    correlationId: "correlation-integration-1",
    source: "cloud_run",
    metadata: { provider: "google_workspace", operation: "registration" },
    occurredAt: CREATED_AT,
    retentionPolicyKey: "security_default",
    retentionUntil: CREATED_AT + 86_400_000,
    ...overrides,
  };
}

function connectionIntent(overrides = {}) {
  return {
    id: CONNECTION_ID,
    provider: "google_workspace",
    connectionKey: "company_workspace",
    createdByUserId: USER_ID,
    createdByActorKey: `user:${USER_ID}`,
    createdAt: CREATED_AT,
    audit: auditEvent(),
    ...overrides,
  };
}

function oauthAttemptIntent(overrides = {}) {
  return {
    id: OAUTH_ATTEMPT_ID,
    connectionId: CONNECTION_ID,
    initiatedByUserId: USER_ID,
    stateHash: STATE_HASH,
    browserNonceHash: NONCE_HASH,
    pkceVerifierCiphertext: PKCE_CIPHERTEXT,
    keyVersion: KEY_VERSION,
    requestedScopes: [
      "openid",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    createdAt: CREATED_AT,
    expiresAt: CREATED_AT + 10 * 60_000,
    purgeAfter: CREATED_AT + 24 * 60 * 60_000,
    audit: auditEvent({
      action: "integration.oauth_attempt_created",
      targetType: "integration_oauth_attempt",
      targetId: OAUTH_ATTEMPT_ID,
    }),
    ...overrides,
  };
}

function consumeOauthAttemptIntent(overrides = {}) {
  return {
    connectionId: CONNECTION_ID,
    stateHash: STATE_HASH,
    browserNonceHash: NONCE_HASH,
    initiatedByUserId: USER_ID,
    consumedAt: CREATED_AT + 5 * 60_000,
    expectedVersion: "1",
    audit: auditEvent({
      action: "integration.oauth_attempt_consumed",
      targetType: "integration_oauth_attempt",
      targetId: OAUTH_ATTEMPT_ID,
    }),
    ...overrides,
  };
}

function completeOauthConnectionIntent(overrides = {}) {
  return {
    connectionId: CONNECTION_ID,
    expectedConnectionVersion: "1",
    issuer: "https://accounts.google.com",
    externalSubject: "google-subject-123",
    externalEmail: "operations@cherryhillfci.com",
    hostedDomain: "cherryhillfci.com",
    credentialId: CREDENTIAL_ID,
    refreshTokenCiphertext: Uint8Array.from({ length: 48 }, (_, index) => index + 1),
    keyVersion: "2",
    grantedScopes: [
      "openid",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    completedByUserId: USER_ID,
    completedByActorKey: `user:${USER_ID}`,
    completedAt: CREATED_AT + 6 * 60_000,
    audit: auditEvent({
      action: "integration.oauth_connection_completed",
      targetType: "integration_connection",
      targetId: CONNECTION_ID,
    }),
    ...overrides,
  };
}

function rotateCredentialIntent(overrides = {}) {
  return {
    connectionId: CONNECTION_ID,
    credentialId: CREDENTIAL_ID,
    credentialKind: "refresh_token",
    expectedVersion: "3",
    ciphertext: Uint8Array.from({ length: 48 }, (_, index) => 255 - index),
    keyVersion: "2",
    rotatedAt: CREATED_AT + 7 * 60_000,
    audit: auditEvent({
      action: "integration.credential_rotated",
      targetType: "integration_connection",
      targetId: CONNECTION_ID,
    }),
    ...overrides,
  };
}

function revokeConnectionIntent(overrides = {}) {
  return {
    connectionId: CONNECTION_ID,
    expectedConnectionVersion: "2",
    revokedByUserId: USER_ID,
    revokedByActorKey: `user:${USER_ID}`,
    revokedAt: CREATED_AT + 8 * 60_000,
    providerRevocationOutcome: "failed",
    providerRevocationErrorCode: "provider_unreachable",
    audit: auditEvent({
      action: "integration.connection_revoked",
      targetType: "integration_connection",
      targetId: CONNECTION_ID,
    }),
    ...overrides,
  };
}

function resourceIntent(overrides = {}) {
  return {
    id: RESOURCE_ID,
    connectionId: CONNECTION_ID,
    resourceType: "drive_file",
    resourceKey: "shared_drive_root",
    externalId: "google-drive-file-123",
    parentExternalId: null,
    externalUrl: "https://drive.google.com/drive/folders/google-drive-file-123",
    owner: { type: "project", projectId: PROJECT_ID },
    metadata: {
      mime_type: "application/vnd.google-apps.folder",
      shared_drive: true,
    },
    createdAt: CREATED_AT,
    audit: auditEvent({
      action: "integration.resource_registered",
      targetType: "integration_resource",
      targetId: RESOURCE_ID,
    }),
    ...overrides,
  };
}

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function auditInsertResult() {
  return result([{ id: AUDIT_ID, recorded_at: RECORDED_AT }], 1);
}

function transactionPool(responder = (sql) => {
  throw new Error(`unexpected repository query: ${sql}`);
}) {
  const queries = [];
  const releases = [];
  let connectCount = 0;
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      const copiedValues = [...values];
      queries.push({ sql: normalized, values: copiedValues });
      if (
        normalized === "BEGIN"
        || normalized === "COMMIT"
        || normalized === "ROLLBACK"
        || normalized.startsWith("SET LOCAL")
      ) {
        return result();
      }
      if (normalized.includes("set_config('search_path'")) return result([], 1);
      if (normalized.includes("current_schema()")) {
        return result([{ current_schema: "fci_test" }], 1);
      }
      return responder(normalized, copiedValues);
    },
    release(error) {
      releases.push(error);
    },
  };

  return {
    pool: {
      async connect() {
        connectCount += 1;
        return client;
      },
    },
    queries,
    releases,
    get connectCount() {
      return connectCount;
    },
  };
}

function repository(fake) {
  return createPostgresIntegrationMetadataRepository(fake.pool, {
    schema: "fci_test",
    lockTimeoutMs: 1_234,
    statementTimeoutMs: 5_678,
  });
}

function firstLine(sql) {
  return sql.split("\n", 1)[0];
}

test("connection, OAuth, and resource mutations commit with audit evidence on one transaction", async () => {
  const cases = [
    {
      label: "connection",
      mutationPrefix: "INSERT INTO integration_connections (",
      invoke: (subject) => subject.registerConnection(connectionIntent()),
      expectedAudit: ["integration.connection_registered", "integration_connection", CONNECTION_ID],
      verify(values) {
        assert.deepEqual(values.slice(0, 5), [
          CONNECTION_ID,
          "google_workspace",
          "company_workspace",
          USER_ID,
          `user:${USER_ID}`,
        ]);
        assert.equal(values[5].getTime(), CREATED_AT);
      },
    },
    {
      label: "OAuth attempt",
      mutationPrefix: "INSERT INTO integration_oauth_attempts (",
      invoke: (subject) => subject.createOauthAttempt(oauthAttemptIntent()),
      expectedAudit: ["integration.oauth_attempt_created", "integration_oauth_attempt", OAUTH_ATTEMPT_ID],
      verify(values) {
        assert.deepEqual(values.slice(0, 5), [
          OAUTH_ATTEMPT_ID,
          CONNECTION_ID,
          USER_ID,
          STATE_HASH,
          NONCE_HASH,
        ]);
        assert.equal(Buffer.isBuffer(values[5]), true);
        assert.deepEqual(new Uint8Array(values[5]), PKCE_CIPHERTEXT);
        assert.equal(values[6], KEY_VERSION);
        assert.deepEqual(JSON.parse(values[7]), oauthAttemptIntent().requestedScopes);
        assert.deepEqual(
          values.slice(8).map((value) => value.getTime()),
          [
            oauthAttemptIntent().expiresAt,
            oauthAttemptIntent().purgeAfter,
            oauthAttemptIntent().createdAt,
          ],
        );
      },
    },
    {
      label: "resource",
      mutationPrefix: "INSERT INTO integration_resources (",
      invoke: (subject) => subject.registerResource(resourceIntent()),
      expectedAudit: ["integration.resource_registered", "integration_resource", RESOURCE_ID],
      verify(values) {
        assert.deepEqual(values.slice(0, 10), [
          RESOURCE_ID,
          CONNECTION_ID,
          "drive_file",
          "shared_drive_root",
          "google-drive-file-123",
          null,
          "https://drive.google.com/drive/folders/google-drive-file-123",
          "project",
          null,
          PROJECT_ID,
        ]);
        assert.deepEqual(JSON.parse(values[10]), resourceIntent().metadata);
        assert.equal(values[11].getTime(), CREATED_AT);
      },
    },
  ];

  for (const scenario of cases) {
    const fake = transactionPool((sql) => {
      if (sql.startsWith(scenario.mutationPrefix)) {
        return result([{ version: "1" }], 1);
      }
      if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
      throw new Error(`unexpected ${scenario.label} query: ${sql}`);
    });

    assert.deepEqual(await scenario.invoke(repository(fake)), {
      outcome: "accepted",
      version: "1",
    }, scenario.label);
    assert.equal(fake.connectCount, 1, scenario.label);
    assert.deepEqual(fake.queries.map(({ sql }) => firstLine(sql)), [
      "BEGIN",
      "SET LOCAL lock_timeout = '1234ms'",
      "SET LOCAL statement_timeout = '5678ms'",
      "SELECT pg_catalog.set_config('search_path', $1, true)",
      "SELECT pg_catalog.current_schema() AS current_schema",
      scenario.mutationPrefix,
      "INSERT INTO audit_events (",
      "COMMIT",
    ], scenario.label);
    assert.deepEqual(fake.queries[3].values, ["fci_test, pg_catalog, pg_temp"]);
    scenario.verify(fake.queries[5].values);
    assert.deepEqual(fake.queries[6].values.slice(6, 11), [
      ...scenario.expectedAudit,
      "succeeded",
      null,
    ], scenario.label);
    assert.deepEqual(fake.releases, [undefined], scenario.label);
  }
});

test("repository-owned validation rejects malformed intents before connecting", async () => {
  const cases = [
    [
      "connection provider",
      (subject) => subject.registerConnection(connectionIntent({ provider: "Google Workspace" })),
      /provider must be a lowercase key/,
    ],
    [
      "OAuth state hash",
      (subject) => subject.createOauthAttempt(oauthAttemptIntent({ stateHash: "plaintext-state" })),
      /state hash must be a canonical SHA-256 digest/,
    ],
    [
      "OAuth expected version",
      (subject) => subject.consumeOauthAttempt(consumeOauthAttemptIntent({ expectedVersion: "0" })),
      /positive signed 64-bit integer/,
    ],
    [
      "OAuth completion email",
      (subject) => subject.completeOauthConnection(completeOauthConnectionIntent({
        externalEmail: "Operations@CherryHillFCI.com",
      })),
      /email must be normalized/,
    ],
    [
      "connection revocation version",
      (subject) => subject.revokeConnection(revokeConnectionIntent({
        expectedConnectionVersion: "0",
      })),
      /positive signed 64-bit integer/,
    ],
    [
      "connection provider revocation outcome",
      (subject) => subject.revokeConnection(revokeConnectionIntent({
        providerRevocationOutcome: "maybe",
      })),
      /provider revocation outcome must be supported/,
    ],
    [
      "connection provider revocation error evidence",
      (subject) => subject.revokeConnection(revokeConnectionIntent({
        providerRevocationOutcome: "succeeded",
        providerRevocationErrorCode: "unexpected_error",
      })),
      /error code must be null unless provider revocation failed/,
    ],
    [
      "resource URL",
      (subject) => subject.registerResource(resourceIntent({
        externalUrl: "http://drive.google.com/drive/folders/unsafe",
      })),
      /absolute HTTPS URL without credentials/,
    ],
  ];

  for (const [label, invoke, pattern] of cases) {
    const fake = transactionPool();
    await assert.rejects(invoke(repository(fake)), pattern, label);
    assert.equal(fake.connectCount, 0, label);
    assert.deepEqual(fake.queries, [], label);
  }
});

test("OAuth creation rejects plaintext and undersized PKCE material before connecting", async () => {
  for (const [label, ciphertext] of [
    ["plaintext", "plaintext-code-verifier"],
    ["short ciphertext", new Uint8Array(15)],
  ]) {
    const fake = transactionPool();
    await assert.rejects(
      repository(fake).createOauthAttempt(oauthAttemptIntent({
        pkceVerifierCiphertext: ciphertext,
      })),
      /PKCE ciphertext must be a bounded encrypted byte sequence/,
      label,
    );
    assert.equal(fake.connectCount, 0, label);
  }
});

test("OAuth consume uses one fenced CTE, clears stored secrets, and returns only the prior encrypted value", async () => {
  const priorCiphertext = Buffer.from(PKCE_CIPHERTEXT);
  const fake = transactionPool((sql) => {
    if (sql.startsWith("WITH candidate AS (")) {
      return result([{
        id: OAUTH_ATTEMPT_ID,
        pkce_verifier_ciphertext: priorCiphertext,
        key_version: KEY_VERSION,
        version: "2",
      }], 1);
    }
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected OAuth consumption query: ${sql}`);
  });

  assert.deepEqual(
    await repository(fake).consumeOauthAttempt(consumeOauthAttemptIntent()),
    {
      outcome: "consumed",
      value: {
        id: OAUTH_ATTEMPT_ID,
        pkceVerifierCiphertext: PKCE_CIPHERTEXT,
        keyVersion: KEY_VERSION,
        version: "2",
      },
    },
  );

  const oauthQueries = fake.queries.filter(({ sql }) =>
    /\bintegration_oauth_attempts\b/.test(sql));
  assert.equal(oauthQueries.length, 1);
  const [mutation] = oauthQueries;
  const compactSql = mutation.sql.replace(/\s+/g, " ");
  assert.match(compactSql, /^WITH candidate AS \(/);
  assert.match(compactSql, /WHERE connection_id = \$1 AND state_hash = \$2 AND browser_nonce_hash = \$3 AND initiated_by_user_id = \$4/);
  assert.match(compactSql, /AND version = \$5::bigint AND status = 'pending' AND expires_at >= \$6 FOR UPDATE/);
  assert.match(compactSql, /UPDATE integration_oauth_attempts AS attempt SET state_hash = NULL, browser_nonce_hash = NULL, pkce_verifier_ciphertext = NULL, key_version = NULL/);
  assert.match(compactSql, /status = 'consumed', consumed_at = \$6, updated_at = \$6, version = attempt\.version \+ 1/);
  assert.match(compactSql, /RETURNING attempt\.id::text AS id, candidate\.pkce_verifier_ciphertext, candidate\.key_version/);
  assert.deepEqual(mutation.values.slice(0, 5), [
    CONNECTION_ID,
    STATE_HASH,
    NONCE_HASH,
    USER_ID,
    "1",
  ]);
  assert.equal(mutation.values[5].getTime(), consumeOauthAttemptIntent().consumedAt);
  assert.equal(mutation.values.includes(KEY_VERSION), false);
  assert.equal(mutation.values.some((value) => value instanceof Uint8Array), false);
  assert.deepEqual(fake.queries.map(({ sql }) => firstLine(sql)).slice(-3), [
    "WITH candidate AS (",
    "INSERT INTO audit_events (",
    "COMMIT",
  ]);
  const auditInsert = fake.queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO audit_events ("));
  assert.deepEqual(auditInsert.values.slice(6, 11), [
    "integration.oauth_attempt_consumed",
    "integration_connection",
    CONNECTION_ID,
    "succeeded",
    null,
  ]);
});

test("a stale OAuth consume still appends audit evidence before committing", async () => {
  const staleAudit = auditEvent({
    action: "integration.oauth_attempt_rejected",
    targetType: "integration_oauth_attempt",
    targetId: OAUTH_ATTEMPT_ID,
    result: "denied",
    reasonCode: "stale_oauth_attempt",
  });
  const fake = transactionPool((sql) => {
    if (sql.startsWith("WITH candidate AS (")) return result([], 0);
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected stale OAuth query: ${sql}`);
  });

  assert.deepEqual(
    await repository(fake).consumeOauthAttempt(consumeOauthAttemptIntent({ audit: staleAudit })),
    { outcome: "stale" },
  );
  assert.deepEqual(fake.queries.map(({ sql }) => firstLine(sql)).slice(-3), [
    "WITH candidate AS (",
    "INSERT INTO audit_events (",
    "COMMIT",
  ]);
  const auditInsert = fake.queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO audit_events ("));
  assert.deepEqual(auditInsert.values.slice(6, 11), [
    "integration.oauth_attempt_consumed",
    "integration_connection",
    CONNECTION_ID,
    "denied",
    "stale_state",
  ]);
});

test("OAuth completion atomically binds identity, refresh ciphertext, scopes, and audit evidence", async () => {
  const intent = completeOauthConnectionIntent();
  const fake = transactionPool((sql) => {
    if (sql.startsWith("SELECT id::text AS id")) {
      return result([{ id: CONNECTION_ID }], 1);
    }
    if (sql.startsWith("INSERT INTO integration_credentials (")) return result([], 1);
    if (sql.startsWith("DELETE FROM integration_connection_scopes")) return result([], 2);
    if (sql.startsWith("INSERT INTO integration_connection_scopes")) return result([], 1);
    if (sql.startsWith("UPDATE integration_connections")) {
      return result([{ version: "2" }], 1);
    }
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected OAuth completion query: ${sql}`);
  });

  assert.deepEqual(await repository(fake).completeOauthConnection(intent), {
    outcome: "accepted",
    version: "2",
  });
  const credential = fake.queries.find(({ sql }) => sql.startsWith("INSERT INTO integration_credentials ("));
  assert.deepEqual(credential.values.slice(0, 2), [CREDENTIAL_ID, CONNECTION_ID]);
  assert.equal(Buffer.isBuffer(credential.values[2]), true);
  assert.deepEqual(new Uint8Array(credential.values[2]), intent.refreshTokenCiphertext);
  assert.equal(credential.values[3], "2");
  assert.equal(credential.values[4].getTime(), intent.completedAt);

  const scopeWrites = fake.queries.filter(({ sql }) => sql.startsWith("INSERT INTO integration_connection_scopes"));
  assert.deepEqual(scopeWrites.map(({ values }) => values[1]), intent.grantedScopes);
  assert.ok(scopeWrites.every(({ values }) => values[2].getTime() === intent.completedAt));

  const connectionUpdate = fake.queries.find(({ sql }) => sql.startsWith("UPDATE integration_connections"));
  assert.deepEqual(connectionUpdate.values.slice(0, 6), [
    CONNECTION_ID,
    "1",
    "https://accounts.google.com",
    "google-subject-123",
    "operations@cherryhillfci.com",
    "cherryhillfci.com",
  ]);
  assert.equal(connectionUpdate.values[6].getTime(), intent.completedAt);
  assert.deepEqual(connectionUpdate.values.slice(7), [USER_ID, `user:${USER_ID}`]);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
  assert.deepEqual(fake.releases, [undefined]);
});

test("fresh OAuth completion can reconnect a revoked row only with the newly supplied credential", async () => {
  const freshCiphertext = Uint8Array.from({ length: 48 }, (_, index) => 200 - index);
  const intent = completeOauthConnectionIntent({
    expectedConnectionVersion: "3",
    refreshTokenCiphertext: freshCiphertext,
    keyVersion: "fresh-consent-key-v3",
  });
  const fake = transactionPool((sql) => {
    if (sql.startsWith("SELECT id::text AS id")) {
      return result([{ id: CONNECTION_ID }], 1);
    }
    if (sql.startsWith("INSERT INTO integration_credentials (")) return result([], 1);
    if (sql.startsWith("DELETE FROM integration_connection_scopes")) return result([], 2);
    if (sql.startsWith("INSERT INTO integration_connection_scopes")) return result([], 1);
    if (sql.startsWith("UPDATE integration_connections")) {
      return result([{ version: "4" }], 1);
    }
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected revoked reconnect query: ${sql}`);
  });

  assert.deepEqual(await repository(fake).completeOauthConnection(intent), {
    outcome: "accepted",
    version: "4",
  });
  const lock = fake.queries.find(({ sql }) => sql.startsWith("SELECT id::text AS id"));
  assert.match(
    lock.sql,
    /status IN \('pending', 'connected', 'degraded', 'reauthorization_required', 'revoked'\)/,
  );
  const credential = fake.queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO integration_credentials ("));
  assert.deepEqual(new Uint8Array(credential.values[2]), freshCiphertext);
  assert.equal(credential.values[3], "fresh-consent-key-v3");
  assert.match(credential.sql, /ciphertext = EXCLUDED\.ciphertext/);
  assert.match(credential.sql, /status = 'active'/);
  assert.match(credential.sql, /revoked_at = NULL/);
  const connection = fake.queries.find(({ sql }) =>
    sql.startsWith("UPDATE integration_connections"));
  assert.match(connection.sql, /status = 'connected'/);
  assert.match(connection.sql, /revoked_at = NULL/);
});

test("a stale OAuth connection completion writes denial evidence without storing credentials", async () => {
  const fake = transactionPool((sql) => {
    if (sql.startsWith("SELECT id::text AS id")) return result([], 0);
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected stale completion query: ${sql}`);
  });
  assert.deepEqual(
    await repository(fake).completeOauthConnection(completeOauthConnectionIntent()),
    { outcome: "stale" },
  );
  assert.equal(fake.queries.some(({ sql }) => /integration_credentials/.test(sql)), false);
  const audit = fake.queries.find(({ sql }) => sql.startsWith("INSERT INTO audit_events ("));
  assert.deepEqual(audit.values.slice(6, 11), [
    "integration.oauth_connection_completed",
    "integration_connection",
    CONNECTION_ID,
    "denied",
    "stale_connection",
  ]);
});

test("active credential reads and exact-version rotation preserve encrypted bytes", async () => {
  const ciphertext = Buffer.from(completeOauthConnectionIntent().refreshTokenCiphertext);
  const readFake = transactionPool((sql) => {
    if (sql.startsWith("SELECT credential.id::text AS id")) {
      return result([{
        id: CREDENTIAL_ID,
        connection_id: CONNECTION_ID,
        credential_kind: "refresh_token",
        ciphertext,
        key_version: "1",
        version: "3",
      }], 1);
    }
    throw new Error(`unexpected active credential query: ${sql}`);
  });
  assert.deepEqual(
    await repository(readFake).getActiveCredential(CONNECTION_ID, "refresh_token"),
    {
      id: CREDENTIAL_ID,
      connectionId: CONNECTION_ID,
      credentialKind: "refresh_token",
      ciphertext: new Uint8Array(ciphertext),
      keyVersion: "1",
      version: "3",
    },
  );
  const activeRead = readFake.queries.find(({ sql }) =>
    sql.startsWith("SELECT credential.id::text AS id"));
  assert.match(activeRead.sql, /INNER JOIN integration_connections AS connection/);
  assert.match(
    activeRead.sql,
    /connection\.status IN \('connected', 'degraded', 'reauthorization_required'\)/,
  );

  const rotation = rotateCredentialIntent();
  const rotateFake = transactionPool((sql) => {
    if (sql.startsWith("UPDATE integration_credentials")) return result([{ version: "4" }], 1);
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected credential rotation query: ${sql}`);
  });
  assert.deepEqual(await repository(rotateFake).rotateCredential(rotation), {
    outcome: "accepted",
    version: "4",
  });
  const update = rotateFake.queries.find(({ sql }) => sql.startsWith("UPDATE integration_credentials"));
  assert.deepEqual(update.values.slice(0, 4), [CREDENTIAL_ID, CONNECTION_ID, "refresh_token", "3"]);
  assert.deepEqual(new Uint8Array(update.values[4]), rotation.ciphertext);
  assert.equal(update.values[5], "2");
  assert.equal(update.values[6].getTime(), CREATED_AT + 7 * 60_000);
});

test("revocation atomically tombstones credentials and preserves a versioned revoked connection row", async () => {
  const intent = revokeConnectionIntent();
  const fake = transactionPool((sql) => {
    if (sql.startsWith("SELECT id::text AS id")) {
      return result([{ id: CONNECTION_ID }], 1);
    }
    if (sql.startsWith("UPDATE integration_credentials")) return result([], 1);
    if (sql.startsWith("UPDATE integration_connections")) {
      return result([{ version: "3" }], 1);
    }
    if (sql.startsWith("INSERT INTO integration_events (")) return result([], 1);
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected revocation query: ${sql}`);
  });

  assert.deepEqual(await repository(fake).revokeConnection(intent), {
    outcome: "accepted",
    version: "3",
  });
  const lock = fake.queries.find(({ sql }) => sql.startsWith("SELECT id::text AS id"));
  assert.match(lock.sql, /'disabled'/);
  assert.match(lock.sql, /'revoked'/);
  const credential = fake.queries.find(({ sql }) =>
    sql.startsWith("UPDATE integration_credentials"));
  assert.match(credential.sql, /ciphertext = NULL, key_version = NULL, status = 'revoked'/);
  assert.match(credential.sql, /revoked_at = \$2/);
  assert.deepEqual(credential.values.slice(0, 1), [CONNECTION_ID]);
  assert.equal(credential.values[1].getTime(), intent.revokedAt);

  const connection = fake.queries.find(({ sql }) =>
    sql.startsWith("UPDATE integration_connections"));
  assert.match(connection.sql, /SET status = 'revoked', revoked_at = \$3/);
  assert.match(connection.sql, /WHERE id = \$1 AND version = \$2::bigint/);
  assert.doesNotMatch(connection.sql, /\bDELETE\b/);
  assert.deepEqual(connection.values.slice(0, 2), [CONNECTION_ID, "2"]);
  assert.equal(connection.values[2].getTime(), intent.revokedAt);
  assert.deepEqual(connection.values.slice(3), [USER_ID, `user:${USER_ID}`]);

  const integrationEvent = fake.queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO integration_events ("));
  assert.deepEqual(integrationEvent.values.slice(0, 3), [
    AUDIT_ID,
    CONNECTION_ID,
    `oauth.connection_revoked:${AUDIT_ID}`,
  ]);
  assert.deepEqual(integrationEvent.values.slice(3, 9), [
    "user",
    USER_ID,
    `user:${USER_ID}`,
    "succeeded",
    null,
    "correlation-integration-1",
  ]);
  assert.deepEqual(JSON.parse(integrationEvent.values[9]), {
    local_connection_revoked: true,
    stored_credentials_revoked: 1,
    provider_revocation_outcome: "failed",
    provider_revocation_error_code: "provider_unreachable",
  });
  assert.equal(integrationEvent.values[10].getTime(), intent.revokedAt);
  assert.equal(integrationEvent.values[11], "security_default");
  assert.equal(integrationEvent.values[12].getTime(), intent.audit.retentionUntil);

  const audit = fake.queries.find(({ sql }) => sql.startsWith("INSERT INTO audit_events ("));
  assert.deepEqual(audit.values.slice(6, 11), [
    "integration.connection_revoked",
    "integration_connection",
    CONNECTION_ID,
    "succeeded",
    null,
  ]);
  assert.equal(fake.queries.some(({ sql }) => /^DELETE FROM integration_(?:connections|credentials)/.test(sql)), false);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("disabled and already-revoked exact-version rows remain revocable with fresh audit evidence", async (t) => {
  for (const status of ["disabled", "revoked"]) {
    await t.test(status, async () => {
      const intent = revokeConnectionIntent({
        expectedConnectionVersion: status === "disabled" ? "2" : "3",
      });
      const fake = transactionPool((sql) => {
        if (sql.startsWith("SELECT id::text AS id")) {
          assert.match(sql, new RegExp(`'${status}'`));
          return result([{ id: CONNECTION_ID }], 1);
        }
        if (sql.startsWith("UPDATE integration_credentials")) {
          return result([], status === "disabled" ? 1 : 0);
        }
        if (sql.startsWith("UPDATE integration_connections")) {
          return result([{ version: status === "disabled" ? "3" : "4" }], 1);
        }
        if (sql.startsWith("INSERT INTO integration_events (")) return result([], 1);
        if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
        throw new Error(`unexpected ${status} revocation query: ${sql}`);
      });

      assert.deepEqual(await repository(fake).revokeConnection(intent), {
        outcome: "accepted",
        version: status === "disabled" ? "3" : "4",
      });
      assert.equal(
        fake.queries.filter(({ sql }) => sql.startsWith("INSERT INTO integration_events (")).length,
        1,
      );
      assert.equal(
        fake.queries.filter(({ sql }) => sql.startsWith("INSERT INTO audit_events (")).length,
        1,
      );
      assert.equal(fake.queries.at(-1).sql, "COMMIT");
    });
  }
});

test("simulation-skipped provider revocation records local success without claiming Google success", async () => {
  const intent = revokeConnectionIntent({
    providerRevocationOutcome: "skipped_simulation",
    providerRevocationErrorCode: null,
  });
  const fake = transactionPool((sql) => {
    if (sql.startsWith("SELECT id::text AS id")) return result([{ id: CONNECTION_ID }], 1);
    if (sql.startsWith("UPDATE integration_credentials")) return result([], 1);
    if (sql.startsWith("UPDATE integration_connections")) return result([{ version: "3" }], 1);
    if (sql.startsWith("INSERT INTO integration_events (")) return result([], 1);
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected simulation revocation query: ${sql}`);
  });

  assert.deepEqual(await repository(fake).revokeConnection(intent), {
    outcome: "accepted",
    version: "3",
  });
  const integrationEvent = fake.queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO integration_events ("));
  assert.deepEqual(integrationEvent.values.slice(6, 8), [
    "succeeded",
    null,
  ]);
  assert.equal(
    JSON.parse(integrationEvent.values[9]).provider_revocation_outcome,
    "skipped_simulation",
  );
  assert.equal(
    JSON.parse(integrationEvent.values[9]).provider_revocation_error_code,
    null,
  );
});

test("a stale connection revocation writes nothing and leaves no audit row", async () => {
  const fake = transactionPool((sql) => {
    if (sql.startsWith("SELECT id::text AS id")) return result([], 0);
    throw new Error(`unexpected stale revocation query: ${sql}`);
  });

  assert.deepEqual(
    await repository(fake).revokeConnection(revokeConnectionIntent()),
    { outcome: "stale" },
  );
  assert.equal(
    fake.queries.some(({ sql }) =>
      sql.startsWith("UPDATE integration_credentials")
      || sql.startsWith("UPDATE integration_connections")
      || sql.startsWith("INSERT INTO integration_events (")
      || sql.startsWith("INSERT INTO audit_events (")),
    false,
  );
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("revoked or disconnected connection state cannot expose an otherwise-active credential", async () => {
  const fake = transactionPool((sql) => {
    if (sql.startsWith("SELECT credential.id::text AS id")) return result([], 0);
    throw new Error(`unexpected revoked credential read query: ${sql}`);
  });

  assert.equal(
    await repository(fake).getActiveCredential(CONNECTION_ID, "refresh_token"),
    null,
  );
  const selected = fake.queries.find(({ sql }) =>
    sql.startsWith("SELECT credential.id::text AS id"));
  assert.match(selected.sql, /credential\.status = 'active'/);
  assert.match(
    selected.sql,
    /connection\.status IN \('connected', 'degraded', 'reauthorization_required'\)/,
  );
});

test("a stale exact-version credential rotation records denial without changing ciphertext", async () => {
  const fake = transactionPool((sql) => {
    if (sql.startsWith("UPDATE integration_credentials")) return result([], 0);
    if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
    throw new Error(`unexpected stale rotation query: ${sql}`);
  });
  assert.deepEqual(await repository(fake).rotateCredential(rotateCredentialIntent()), {
    outcome: "stale",
  });
  const audit = fake.queries.find(({ sql }) => sql.startsWith("INSERT INTO audit_events ("));
  assert.deepEqual(audit.values.slice(6, 11), [
    "integration.credential_rotated",
    "integration_connection",
    CONNECTION_ID,
    "denied",
    "stale_credential",
  ]);
});

test("an audit insert failure rolls back every integration mutation path", async () => {
  const auditFailure = new Error("simulated audit insert failure");
  const cases = [
    {
      label: "connection",
      mutationPrefix: "INSERT INTO integration_connections (",
      invoke: (subject) => subject.registerConnection(connectionIntent()),
    },
    {
      label: "OAuth creation",
      mutationPrefix: "INSERT INTO integration_oauth_attempts (",
      invoke: (subject) => subject.createOauthAttempt(oauthAttemptIntent()),
    },
    {
      label: "OAuth consumption",
      mutationPrefix: "WITH candidate AS (",
      invoke: (subject) => subject.consumeOauthAttempt(consumeOauthAttemptIntent()),
    },
    {
      label: "OAuth completion",
      mutationPrefix: "SELECT id::text AS id",
      invoke: (subject) => subject.completeOauthConnection(completeOauthConnectionIntent()),
    },
    {
      label: "credential rotation",
      mutationPrefix: "UPDATE integration_credentials",
      invoke: (subject) => subject.rotateCredential(rotateCredentialIntent()),
    },
    {
      label: "connection revocation",
      mutationPrefix: "SELECT id::text AS id",
      invoke: (subject) => subject.revokeConnection(revokeConnectionIntent()),
    },
    {
      label: "resource",
      mutationPrefix: "INSERT INTO integration_resources (",
      invoke: (subject) => subject.registerResource(resourceIntent()),
    },
  ];

  for (const scenario of cases) {
    const fake = transactionPool((sql) => {
      if (scenario.label === "OAuth completion") {
        if (sql.startsWith("SELECT id::text AS id")) return result([{ id: CONNECTION_ID }], 1);
        if (sql.startsWith("INSERT INTO integration_credentials (")) return result([], 1);
        if (sql.startsWith("DELETE FROM integration_connection_scopes")) return result([], 0);
        if (sql.startsWith("INSERT INTO integration_connection_scopes")) return result([], 1);
        if (sql.startsWith("UPDATE integration_connections")) return result([{ version: "2" }], 1);
      }
      if (scenario.label === "connection revocation") {
        if (sql.startsWith("SELECT id::text AS id")) return result([{ id: CONNECTION_ID }], 1);
        if (sql.startsWith("UPDATE integration_credentials")) return result([], 1);
        if (sql.startsWith("UPDATE integration_connections")) return result([{ version: "3" }], 1);
        if (sql.startsWith("INSERT INTO integration_events (")) return result([], 1);
      }
      if (sql.startsWith(scenario.mutationPrefix)) {
        if (scenario.label === "OAuth consumption") {
          return result([{
            id: OAUTH_ATTEMPT_ID,
            pkce_verifier_ciphertext: Buffer.from(PKCE_CIPHERTEXT),
            key_version: KEY_VERSION,
            version: "2",
          }], 1);
        }
        return result([{ version: "1" }], 1);
      }
      if (sql.startsWith("INSERT INTO audit_events (")) throw auditFailure;
      throw new Error(`unexpected ${scenario.label} query: ${sql}`);
    });

    await assert.rejects(
      scenario.invoke(repository(fake)),
      (error) => error === auditFailure,
      scenario.label,
    );
    assert.equal(fake.queries.some(({ sql }) => sql.startsWith(scenario.mutationPrefix)), true);
    assert.equal(fake.queries.some(({ sql }) => sql.startsWith("INSERT INTO audit_events (")), true);
    assert.equal(fake.queries.some(({ sql }) => sql === "COMMIT"), false);
    assert.equal(fake.queries.at(-1).sql, "ROLLBACK", scenario.label);
    assert.deepEqual(fake.releases, [undefined], scenario.label);
  }
});

test("resource metadata rejects secret-bearing keys recursively before connecting", async () => {
  const forbiddenMetadata = [
    { refresh_token: "plaintext-refresh-value" },
    { nested: { oauth_secret: "plaintext-client-secret" } },
    { provider: { pkce_ciphertext: "not-metadata" } },
    { provider: { pkceVerifier: "not-metadata" } },
    { provider: { browserNonce: "not-metadata" } },
    { request_body: "raw-provider-payload" },
  ];

  for (const metadata of forbiddenMetadata) {
    const fake = transactionPool();
    await assert.rejects(
      repository(fake).registerResource(resourceIntent({ metadata })),
      /contains a forbidden metadata key/,
    );
    assert.equal(fake.connectCount, 0);
  }
});

test("resource metadata snapshots data descriptors without invoking accessors or toJSON", async () => {
  let getterCalls = 0;
  const getterMetadata = {};
  Object.defineProperty(getterMetadata, "safe_field", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "secret-bearing-second-view";
    },
  });

  let toJsonCalls = 0;
  const toJsonMetadata = { safe_field: "safe" };
  Object.defineProperty(toJsonMetadata, "toJSON", {
    enumerable: false,
    value() {
      toJsonCalls += 1;
      return { refresh_token: "plaintext" };
    },
  });

  const arrayMetadata = { values: ["safe"] };
  Object.defineProperty(arrayMetadata.values, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "unsafe";
    },
  });

  for (const metadata of [getterMetadata, toJsonMetadata, arrayMetadata]) {
    const fake = transactionPool();
    await assert.rejects(
      repository(fake).registerResource(resourceIntent({ metadata })),
      /without accessors|enumerable data properties|JSON array/,
    );
    assert.equal(fake.connectCount, 0);
  }
  assert.equal(getterCalls, 0);
  assert.equal(toJsonCalls, 0);
});

test("only the complete named integration unique-constraint set maps to conflict", async () => {
  const conflictCases = [
    ["integration_connections_pkey", "connection"],
    ["integration_connections_connection_key_key", "connection"],
    ["integration_connections_external_identity_idx", "connection"],
    ["integration_oauth_attempts_pkey", "oauth"],
    ["integration_oauth_attempts_state_hash_idx", "oauth"],
    ["integration_resources_pkey", "resource"],
    ["integration_resources_connection_id_id_key", "resource"],
    ["integration_resources_connection_type_external_key", "resource"],
    ["integration_resources_connection_resource_key", "resource"],
  ];
  const operations = {
    connection: (subject) => subject.registerConnection(connectionIntent()),
    oauth: (subject) => subject.createOauthAttempt(oauthAttemptIntent()),
    resource: (subject) => subject.registerResource(resourceIntent()),
  };
  const expectedAudits = {
    connection: ["integration.connection_registered", "integration_connection", CONNECTION_ID],
    oauth: ["integration.oauth_attempt_created", "integration_oauth_attempt", OAUTH_ATTEMPT_ID],
    resource: ["integration.resource_registered", "integration_resource", RESOURCE_ID],
  };

  for (const [constraint, operation] of conflictCases) {
    const conflict = Object.assign(new Error(`duplicate ${constraint}`), {
      code: "23505",
      constraint,
    });
    const fake = transactionPool((sql) => {
      if (sql.startsWith("INSERT INTO audit_events (")) return auditInsertResult();
      throw conflict;
    });
    assert.deepEqual(await operations[operation](repository(fake)), {
      outcome: "conflict",
    }, constraint);
    assert.equal(fake.connectCount, 2, constraint);
    assert.equal(fake.queries.some(({ sql }) => sql === "ROLLBACK"), true, constraint);
    assert.equal(fake.queries.at(-1).sql, "COMMIT", constraint);
    const conflictAudit = fake.queries.find(({ sql }) =>
      sql.startsWith("INSERT INTO audit_events ("));
    assert.deepEqual(conflictAudit.values.slice(6, 11), [
      ...expectedAudits[operation],
      "denied",
      "conflict",
    ], constraint);
  }

  for (const error of [
    Object.assign(new Error("unrecognized unique constraint"), {
      code: "23505",
      constraint: "unrelated_table_key",
    }),
    Object.assign(new Error("wrong PostgreSQL error code"), {
      code: "23503",
      constraint: "integration_connections_pkey",
    }),
  ]) {
    const fake = transactionPool(() => {
      throw error;
    });
    await assert.rejects(
      repository(fake).registerConnection(connectionIntent()),
      (caught) => caught === error,
    );
    assert.equal(fake.queries.at(-1).sql, "ROLLBACK");
  }
});
