import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/identity-persistence",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24686 } },
});
const identityModule = await vite.ssrLoadModule(
  "/app/adapters/postgres/identity-persistence-repository.ts",
);
const { createPostgresIdentityPersistenceRepository } = identityModule;

after(async () => {
  await vite.close();
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const ROTATED_SESSION_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNER_ID = "99999999-9999-4999-8999-999999999999";
const AUDIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATED_AT = Date.UTC(2026, 6, 15, 12, 0, 0);
const AUTHORIZATION_VERSION = "9007199254740992";
const STORED_VERSION = "9007199254740993";
const TOKEN_HASH = `sha256:${"a".repeat(64)}`;
const CSRF_HASH = `sha256:${"b".repeat(64)}`;

function auditEvent(action = "identity.persistence_changed", overrides = {}) {
  return {
    id: AUDIT_ID,
    executorType: "system",
    executorUserId: null,
    executorKey: "system:identity-test",
    originatingUserId: null,
    originatingActorKey: null,
    action,
    targetType: "user",
    targetId: USER_ID,
    result: "succeeded",
    reasonCode: null,
    requestId: "request-identity-test",
    correlationId: "correlation-identity-test",
    source: "unit_test",
    metadata: { fixture: "FCI TEST — DO NOT USE" },
    occurredAt: CREATED_AT,
    retentionPolicyKey: "security_default",
    retentionUntil: CREATED_AT + 86_400_000,
    ...overrides,
  };
}

function registrationIntent(overrides = {}) {
  return {
    user: {
      id: USER_ID,
      email: "employee@example.test",
      displayName: "FCI Test Employee",
      status: "active",
      sessionsValidAfter: CREATED_AT,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT + 1,
    },
    identity: {
      id: IDENTITY_ID,
      provider: "google_oidc",
      issuer: "https://accounts.example.test",
      subject: "google-subject-1",
      email: "employee@example.test",
      hostedDomain: "example.test",
      emailVerified: true,
      firstSeenAt: CREATED_AT,
      lastAuthenticatedAt: CREATED_AT + 1,
    },
    audit: auditEvent("identity.user_registered"),
    ...overrides,
  };
}

function sessionIntent(overrides = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    tokenHash: TOKEN_HASH,
    csrfHash: CSRF_HASH,
    authorizationVersion: AUTHORIZATION_VERSION,
    rotatedFromSessionId: null,
    issuedAt: CREATED_AT,
    idleExpiresAt: CREATED_AT + 1_800_000,
    absoluteExpiresAt: CREATED_AT + 3_600_000,
    purgeAfter: CREATED_AT + 7_200_000,
    audit: auditEvent("identity.session_created", {
      targetType: "session",
      targetId: SESSION_ID,
    }),
    ...overrides,
  };
}

function revokeSessionIntent(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    expectedVersion: AUTHORIZATION_VERSION,
    revokedAt: CREATED_AT + 1_000,
    revokedByActorKey: `user:${ASSIGNER_ID}`,
    reasonCode: "user_disabled",
    audit: auditEvent("identity.session_revocation_denied", {
      targetType: "session",
      targetId: SESSION_ID,
      result: "denied",
      reasonCode: "stale_session",
    }),
    ...overrides,
  };
}

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function fakeDatabase(workQuery = async () => assert.fail("unexpected work query")) {
  const queries = [];
  const releases = [];
  let connectCount = 0;
  let configuredSchema = "public";
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values: [...values] });
      if (
        normalized === "BEGIN"
        || normalized === "COMMIT"
        || normalized === "ROLLBACK"
        || normalized.startsWith("SET LOCAL")
      ) {
        return result();
      }
      if (normalized.includes("set_config('search_path'")) {
        configuredSchema = String(values[0]).split(",", 1)[0];
        return result([], 1);
      }
      if (normalized.includes("current_schema()")) {
        return result([{ current_schema: configuredSchema }], 1);
      }
      return workQuery(normalized, values);
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

function workQueries(fake) {
  return fake.queries.filter(({ sql }) =>
    sql !== "BEGIN"
    && sql !== "COMMIT"
    && sql !== "ROLLBACK"
    && !sql.startsWith("SET LOCAL")
    && !sql.includes("set_config('search_path'")
    && !sql.includes("current_schema()"));
}

function auditInsert(values, options = {}) {
  if (options.error) throw options.error;
  assert.equal(values[0], AUDIT_ID);
  return result([], 1);
}

test("identity intent validation fails before a PostgreSQL connection is borrowed", async () => {
  const cases = [
    ["registration UUID", "registerExternalIdentity", registrationIntent({
      user: { ...registrationIntent().user, id: "invalid" },
    }), /Identity user ID must be a UUID/],
    ["session version", "createSession", sessionIntent({ authorizationVersion: "1.0" }), /signed 64-bit integer/],
    ["session rotation", "createSession", sessionIntent({
      rotatedFromSessionId: ROTATED_SESSION_ID,
    }), /rotation is unavailable/],
    ["revocation version", "revokeSession", revokeSessionIntent({ expectedVersion: "0" }), /positive signed 64-bit/],
  ];

  for (const [label, method, intent, pattern] of cases) {
    const fake = fakeDatabase();
    const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
      schema: "fci_test",
    });
    await assert.rejects(repository[method](intent), pattern, label);
    assert.equal(fake.connectCount, 0, label);
  }

  const unused = fakeDatabase();
  assert.throws(
    () => createPostgresIdentityPersistenceRepository(unused.pool, {
      schema: "unsafe-schema",
    }),
    /lowercase PostgreSQL identifier/,
  );
  assert.equal(unused.connectCount, 0);
});

test("registration commits user, external identity, and audit atomically with an exact bigint version", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("INSERT INTO users")) {
      return result([{ version: AUTHORIZATION_VERSION }], 1);
    }
    if (sql.startsWith("INSERT INTO external_identities")) return result([], 1);
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
    schema: "fci_test",
    lockTimeoutMs: 1_234,
    statementTimeoutMs: 5_678,
  });
  const intent = registrationIntent({
    audit: auditEvent("caller.claimed_success", {
      targetType: "project",
      targetId: SESSION_ID,
      result: "failed",
      reasonCode: "caller_selected",
    }),
  });

  assert.deepEqual(await repository.registerExternalIdentity(intent), {
    outcome: "accepted",
    version: AUTHORIZATION_VERSION,
  });
  assert.equal(fake.connectCount, 1);
  assert.deepEqual(fake.queries.map(({ sql }) => sql.split("\n", 1)[0]), [
    "BEGIN",
    "SET LOCAL lock_timeout = '1234ms'",
    "SET LOCAL statement_timeout = '5678ms'",
    "SELECT pg_catalog.set_config('search_path', $1, true)",
    "SELECT pg_catalog.current_schema() AS current_schema",
    "INSERT INTO users (",
    "INSERT INTO external_identities (",
    "INSERT INTO audit_events (",
    "COMMIT",
  ]);
  const [user, identity, audit] = workQueries(fake);
  assert.match(user.sql, /authorization_version,[\s\S]*VALUES[\s\S]*'active', 1/);
  assert.deepEqual(user.values.slice(0, 3), [
    USER_ID,
    "employee@example.test",
    "FCI Test Employee",
  ]);
  assert.deepEqual(identity.values.slice(0, 8), [
    IDENTITY_ID,
    USER_ID,
    "google_oidc",
    "https://accounts.example.test",
    "google-subject-1",
    "employee@example.test",
    "example.test",
    true,
  ]);
  assert.equal(audit.values[6], "identity.user_registered");
  assert.deepEqual(audit.values.slice(7, 11), ["user", USER_ID, "succeeded", null]);
  assert.deepEqual(fake.releases, [undefined]);
});

test("audit insertion failure rolls back registration instead of leaving partial identity rows", async () => {
  const auditFailure = new Error("simulated audit write failure");
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("INSERT INTO users")) return result([{ version: "1" }], 1);
    if (sql.startsWith("INSERT INTO external_identities")) return result([], 1);
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values, { error: auditFailure });
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresIdentityPersistenceRepository(fake.pool, { schema: "fci_test" });

  await assert.rejects(
    repository.registerExternalIdentity(registrationIntent()),
    (error) => error === auditFailure,
  );
  assert.deepEqual(workQueries(fake).map(({ sql }) => sql.split(" ", 3).slice(0, 3).join(" ")), [
    "INSERT INTO users",
    "INSERT INTO external_identities",
    "INSERT INTO audit_events",
  ]);
  assert.equal(fake.queries.at(-1).sql, "ROLLBACK");
  assert.deepEqual(fake.releases, [undefined]);
});

test("session creation is fenced by active user status and the exact authorization bigint version", async (t) => {
  await t.test("matching active user", async () => {
    const fake = fakeDatabase(async (sql, values) => {
      if (sql.startsWith("SELECT authorization_version")) {
        return result([{
          authorization_version: AUTHORIZATION_VERSION,
          sessions_valid_after: new Date(CREATED_AT),
          status: "active",
        }], 1);
      }
      if (sql.startsWith("INSERT INTO sessions")) {
        return result([{ version: STORED_VERSION }], 1);
      }
      if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
      assert.fail(`unexpected work query: ${sql}`);
    });
    const repository = createPostgresIdentityPersistenceRepository(fake.pool, { schema: "fci_test" });

    assert.deepEqual(await repository.createSession(sessionIntent()), {
      outcome: "accepted",
      version: STORED_VERSION,
    });
    const [user, session, audit] = workQueries(fake);
    assert.match(user.sql, /sessions_valid_after, status[\s\S]*FROM users WHERE id = \$1 FOR SHARE$/);
    assert.deepEqual(user.values, [USER_ID]);
    assert.match(session.sql, /authorization_version,[\s\S]*\$5::bigint/);
    assert.equal(session.values[4], AUTHORIZATION_VERSION);
    assert.equal(audit.values[6], "identity.session_created");
    assert.equal(fake.queries.at(-1).sql, "COMMIT");
  });

  for (const [label, userRow] of [
    ["missing user", null],
    ["disabled user", { authorization_version: AUTHORIZATION_VERSION, status: "disabled" }],
    ["changed authorization version", { authorization_version: STORED_VERSION, status: "active" }],
    ["invalidated issuance cutoff", {
      authorization_version: AUTHORIZATION_VERSION,
      sessions_valid_after: new Date(CREATED_AT + 1),
      status: "active",
    }],
  ]) {
    await t.test(label, async () => {
      const fake = fakeDatabase(async (sql, values) => {
        if (sql.startsWith("SELECT authorization_version")) {
          return userRow === null ? result([], 0) : result([userRow], 1);
        }
        if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
        assert.fail(`unexpected work query: ${sql}`);
      });
      const repository = createPostgresIdentityPersistenceRepository(fake.pool, { schema: "fci_test" });

      assert.deepEqual(await repository.createSession(sessionIntent()), { outcome: "stale" });
      assert.equal(workQueries(fake).some(({ sql }) => sql.startsWith("INSERT INTO sessions")), false);
      const audit = workQueries(fake).at(-1);
      assert.equal(audit.sql.startsWith("INSERT INTO audit_events"), true);
      assert.deepEqual(audit.values.slice(6, 11), [
        "identity.session_created",
        "session",
        SESSION_ID,
        "denied",
        "stale_state",
      ]);
      assert.equal(fake.queries.at(-1).sql, "COMMIT");
    });
  }
});

test("stale session revocation keeps the version/status fence and commits denial audit only", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("UPDATE sessions")) return result([], 0);
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresIdentityPersistenceRepository(fake.pool, { schema: "fci_test" });

  assert.deepEqual(await repository.revokeSession(revokeSessionIntent()), { outcome: "stale" });
  const [update, audit] = workQueries(fake);
  assert.match(update.sql, /WHERE id = \$1 AND version = \$5::bigint AND revoked_at IS NULL/);
  assert.deepEqual(update.values, [
    SESSION_ID,
    new Date(CREATED_AT + 1_000),
    `user:${ASSIGNER_ID}`,
    "user_disabled",
    AUTHORIZATION_VERSION,
  ]);
  assert.deepEqual(audit.values.slice(6, 11), [
    "identity.session_revoked",
    "session",
    SESSION_ID,
    "denied",
    "stale_state",
  ]);
  assert.equal(workQueries(fake).filter(({ sql }) => sql.startsWith("UPDATE sessions")).length, 1);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("only expected named unique conflicts map to conflict and unrelated failures still throw", async () => {
  const knownConflict = Object.assign(new Error("simulated known conflict"), {
    code: "23505",
    constraint: "users_email_key_key",
  });
  const knownFake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("INSERT INTO users")) throw knownConflict;
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const knownRepository = createPostgresIdentityPersistenceRepository(knownFake.pool, {
    schema: "fci_test",
  });
  assert.deepEqual(
    await knownRepository.registerExternalIdentity(registrationIntent()),
    { outcome: "conflict" },
  );
  assert.equal(knownFake.connectCount, 2);
  assert.equal(knownFake.queries.some(({ sql }) => sql === "ROLLBACK"), true);
  assert.equal(knownFake.queries.at(-1).sql, "COMMIT");
  const conflictAudit = workQueries(knownFake).find(({ sql }) =>
    sql.startsWith("INSERT INTO audit_events"));
  assert.deepEqual(conflictAudit.values.slice(6, 11), [
    "identity.user_registered",
    "user",
    USER_ID,
    "denied",
    "conflict",
  ]);

  for (const failure of [
    Object.assign(new Error("unrelated unique"), {
      code: "23505",
      constraint: "audit_events_pkey",
    }),
    Object.assign(new Error("foreign key"), {
      code: "23503",
      constraint: "external_identities_user_id_fkey",
    }),
  ]) {
    const fake = fakeDatabase(async (sql) => {
      if (sql.startsWith("INSERT INTO users")) throw failure;
      assert.fail(`unexpected work query: ${sql}`);
    });
    const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
      schema: "fci_test",
    });
    await assert.rejects(
      repository.registerExternalIdentity(registrationIntent()),
      (error) => error === failure,
    );
    assert.equal(fake.queries.at(-1).sql, "ROLLBACK");
  }
});
