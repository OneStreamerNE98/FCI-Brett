import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  cacheDir: "work/vite-tests/postgres-employee-login-persistence",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24725 } },
});
const { createPostgresIdentityPersistenceRepository } = await vite.ssrLoadModule(
  "/app/adapters/postgres/identity-persistence-repository.ts",
);

after(async () => {
  await vite.close();
});

const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1_000;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const INVITATION_ID = "44444444-4444-4444-8444-444444444444";
const ROLE_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const INVITER_ID = "77777777-7777-4777-8777-777777777777";
const LOGIN_AUDIT_ID = "88888888-8888-4888-8888-888888888888";
const INVITATION_AUDIT_ID = "99999999-9999-4999-8999-999999999999";
const TOKEN_HASH = `sha256:${"a".repeat(64)}`;
const SESSION_HASH = `sha256:${"b".repeat(64)}`;
const CSRF_HASH = `sha256:${"c".repeat(64)}`;
const EMAIL = "pm@cherryhillfci.com";
const SUBJECT = "google-immutable-subject-123";

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function fakeDatabase(workQuery = async (sql) => assert.fail(`unexpected work query: ${sql}`)) {
  const queries = [];
  let configuredSchema = "public";
  let connectCount = 0;
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
    release() {},
  };
  return {
    pool: {
      async connect() {
        connectCount += 1;
        return client;
      },
    },
    queries,
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

function auditEvent(id) {
  return {
    id,
    executorType: "anonymous",
    executorUserId: null,
    executorKey: "anonymous",
    originatingUserId: null,
    originatingActorKey: null,
    action: "identity.login_failed",
    targetType: "login_attempt",
    targetId: "correlation-employee-login",
    result: "denied",
    reasonCode: "login_not_authorized",
    requestId: "request-employee-login",
    correlationId: "correlation-employee-login",
    source: "employee_oidc_callback",
    metadata: { fixture: "FCI TEST — DO NOT USE" },
    occurredAt: NOW,
    retentionPolicyKey: "security_audit",
    retentionUntil: null,
  };
}

function authenticationIntent(overrides = {}) {
  return {
    identity: {
      provider: "google_oidc",
      issuer: "https://accounts.google.com",
      subject: SUBJECT,
      email: EMAIL,
      hostedDomain: "cherryhillfci.com",
      emailVerified: true,
      displayName: "FCI Test Project Manager",
    },
    invitationTokenHash: TOKEN_HASH,
    newUserId: USER_ID,
    newExternalIdentityId: IDENTITY_ID,
    session: {
      id: SESSION_ID,
      tokenHash: SESSION_HASH,
      csrfHash: CSRF_HASH,
      issuedAt: NOW,
      idleExpiresAt: NOW + 30 * 60_000,
      absoluteExpiresAt: NOW + 8 * 60 * 60_000,
      purgeAfter: NOW + 8 * 60 * 60_000 + 7 * DAY,
    },
    loginAudit: auditEvent(LOGIN_AUDIT_ID),
    invitationAudit: auditEvent(INVITATION_AUDIT_ID),
    ...overrides,
  };
}

function invitationRow(overrides = {}) {
  return {
    invitation_id: INVITATION_ID,
    invitation_email: EMAIL,
    invitation_email_key: EMAIL,
    invitation_status: "pending",
    created_at: new Date(NOW - DAY),
    expires_at: new Date(NOW + 6 * DAY),
    invited_by_user_id: INVITER_ID,
    invited_by_actor_key: `user:${INVITER_ID}`,
    role_id: ROLE_ID,
    role_key: "project_manager",
    role_status: "active",
    ...overrides,
  };
}

function existingIdentityRow(overrides = {}) {
  return {
    identity_id: IDENTITY_ID,
    user_id: USER_ID,
    email: EMAIL,
    status: "active",
    authorization_version: "1",
    sessions_valid_after: new Date(NOW - 60_000),
    ...overrides,
  };
}

function assertLoginFailureAudit(fake, reason) {
  const queries = workQueries(fake);
  const audit = queries.find(({ sql }) => sql.startsWith("INSERT INTO audit_events"));
  assert.ok(audit, `missing ${reason} login audit`);
  assert.deepEqual(audit.values.slice(6, 11), [
    "identity.login_failed",
    "login_attempt",
    "correlation-employee-login",
    "denied",
    reason,
  ]);
  assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO sessions")), false);
}

test("first employee login consumes one exact seven-day invitation and creates scoped access plus session atomically", async () => {
  const fake = fakeDatabase(async (sql) => {
    if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
    if (sql.startsWith("SELECT invitation.id::text")) return result([invitationRow()], 1);
    if (sql.startsWith("SELECT project_id::text")) {
      return result([{ project_id: PROJECT_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM users")) return result([], 0);
    if (sql.startsWith("INSERT INTO users")) {
      return result([{ authorization_version: "1" }], 1);
    }
    if (sql.startsWith("INSERT INTO external_identities")) return result([], 1);
    if (sql.startsWith("INSERT INTO user_roles")) return result([], 1);
    if (sql.startsWith("INSERT INTO project_memberships")) return result([], 1);
    if (sql.startsWith("UPDATE invitations")) return result([{ id: INVITATION_ID }], 1);
    if (sql.startsWith("INSERT INTO sessions")) return result([{ version: "1" }], 1);
    if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.authenticateEmployeeSession(authenticationIntent()), {
    outcome: "accepted",
    userId: USER_ID,
    email: EMAIL,
    authorizationVersion: "1",
    sessionVersion: "1",
    invitationRedeemed: true,
  });
  assert.equal(fake.connectCount, 1);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");

  const queries = workQueries(fake);
  const identityLookup = queries.find(({ sql }) =>
    sql.startsWith("SELECT external_identity.id::text"));
  assert.deepEqual(identityLookup.values, [
    "google_oidc",
    "https://accounts.google.com",
    SUBJECT,
  ]);
  assert.doesNotMatch(identityLookup.sql, /email\s*=\s*\$\d/i);

  const invitationLookup = queries.find(({ sql }) =>
    sql.startsWith("SELECT invitation.id::text"));
  assert.deepEqual(invitationLookup.values, [TOKEN_HASH]);
  assert.match(invitationLookup.sql, /FOR UPDATE OF invitation$/);

  const user = queries.find(({ sql }) => sql.startsWith("INSERT INTO users"));
  assert.deepEqual(user.values, [
    USER_ID,
    EMAIL,
    "FCI Test Project Manager",
    new Date(NOW),
  ]);
  const identity = queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO external_identities"));
  assert.deepEqual(identity.values.slice(0, 7), [
    IDENTITY_ID,
    USER_ID,
    "google_oidc",
    "https://accounts.google.com",
    SUBJECT,
    EMAIL,
    "cherryhillfci.com",
  ]);
  const role = queries.find(({ sql }) => sql.startsWith("INSERT INTO user_roles"));
  assert.deepEqual(role.values.slice(0, 4), [
    USER_ID,
    ROLE_ID,
    INVITER_ID,
    `user:${INVITER_ID}`,
  ]);
  const memberships = queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO project_memberships"));
  assert.deepEqual(memberships.values.slice(0, 2), [USER_ID, [PROJECT_ID]]);

  const invitation = queries.find(({ sql }) => sql.startsWith("UPDATE invitations"));
  assert.match(invitation.sql, /token_hash = NULL/);
  assert.match(invitation.sql, /status = 'accepted'/);
  assert.match(invitation.sql, /accepted_user_id = \$2/);
  assert.match(invitation.sql, /status = 'pending' AND token_hash = \$4/);
  assert.deepEqual(invitation.values, [
    INVITATION_ID,
    USER_ID,
    new Date(NOW),
    TOKEN_HASH,
  ]);

  const session = queries.find(({ sql }) => sql.startsWith("INSERT INTO sessions"));
  assert.deepEqual(session.values.slice(0, 5), [
    SESSION_ID,
    USER_ID,
    SESSION_HASH,
    CSRF_HASH,
    "1",
  ]);
  assert.deepEqual(session.values.slice(5), [
    new Date(NOW),
    new Date(NOW + 30 * 60_000),
    new Date(NOW + 8 * 60 * 60_000),
    new Date(NOW + 8 * 60 * 60_000 + 7 * DAY),
  ]);
  const audits = queries.filter(({ sql }) => sql.startsWith("INSERT INTO audit_events"));
  assert.equal(audits.length, 2);
  assert.deepEqual(audits.map(({ values }) => values.slice(6, 11)), [
    ["identity.invitation_redeemed", "invitation", INVITATION_ID, "succeeded", null],
    ["identity.login_succeeded", "session", SESSION_ID, "succeeded", null],
  ]);
  assert.ok(audits.every(({ values }) => values[1] === "user" && values[2] === USER_ID));
});

test("repeat login resolves the immutable Google subject without accepting another invitation", async () => {
  const claimedEmail = "renamed.pm@cherryhillfci.com";
  const fake = fakeDatabase(async (sql) => {
    if (sql.startsWith("SELECT external_identity.id::text")) {
      return result([{
        identity_id: IDENTITY_ID,
        user_id: USER_ID,
        email: EMAIL,
        status: "active",
        authorization_version: "7",
        sessions_valid_after: new Date(NOW - 60_000),
      }], 1);
    }
    if (sql.startsWith("SELECT assigned_role.role_key")) {
      return result([{ role_key: "project_manager" }], 1);
    }
    if (sql.startsWith("UPDATE external_identities")) {
      return result([{ id: IDENTITY_ID }], 1);
    }
    if (sql.startsWith("INSERT INTO sessions")) return result([{ version: "2" }], 1);
    if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });
  const intent = authenticationIntent({
    invitationTokenHash: null,
    identity: { ...authenticationIntent().identity, email: claimedEmail },
  });

  assert.deepEqual(await repository.authenticateEmployeeSession(intent), {
    outcome: "accepted",
    userId: USER_ID,
    email: EMAIL,
    authorizationVersion: "7",
    sessionVersion: "2",
    invitationRedeemed: false,
  });
  const queries = workQueries(fake);
  const identityLookup = queries[0];
  assert.deepEqual(identityLookup.values, [
    "google_oidc",
    "https://accounts.google.com",
    SUBJECT,
  ]);
  const identityRefresh = queries.find(({ sql }) =>
    sql.startsWith("UPDATE external_identities"));
  assert.deepEqual(identityRefresh.values, [
    IDENTITY_ID,
    claimedEmail,
    "cherryhillfci.com",
    new Date(NOW),
  ]);
  assert.equal(queries.some(({ sql }) => sql.includes("FROM invitations")), false);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("expired or already-consumed invitations cannot create a user or a second session", async (t) => {
  await t.test("expired invitation", async () => {
    const fake = fakeDatabase(async (sql) => {
      if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
      if (sql.startsWith("SELECT invitation.id::text")) {
        return result([invitationRow({
          created_at: new Date(NOW - 8 * DAY),
          expires_at: new Date(NOW - DAY),
        })], 1);
      }
      if (sql.startsWith("UPDATE invitations")) return result([{ id: INVITATION_ID }], 1);
      if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
      assert.fail(`unexpected work query: ${sql}`);
    });
    const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
      schema: "fci_test",
    });
    assert.deepEqual(await repository.authenticateEmployeeSession(authenticationIntent()), {
      outcome: "denied",
      reason: "invitation_expired",
    });
    const queries = workQueries(fake);
    const expired = queries.find(({ sql }) => sql.startsWith("UPDATE invitations"));
    assert.match(expired.sql, /status = 'expired'/);
    assert.match(expired.sql, /expired_at = expires_at/);
    assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO users")), false);
    assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO sessions")), false);
    const audit = queries.at(-1);
    assert.deepEqual(audit.values.slice(6, 11), [
      "identity.login_failed",
      "login_attempt",
      "correlation-employee-login",
      "denied",
      "invitation_expired",
    ]);
    assert.equal(fake.queries.at(-1).sql, "COMMIT");
  });

  await t.test("already-consumed invitation token", async () => {
    const fake = fakeDatabase(async (sql) => {
      if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
      if (sql.startsWith("SELECT invitation.id::text")) return result([], 0);
      if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
      assert.fail(`unexpected work query: ${sql}`);
    });
    const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
      schema: "fci_test",
    });
    assert.deepEqual(await repository.authenticateEmployeeSession(authenticationIntent()), {
      outcome: "denied",
      reason: "invitation_invalid",
    });
    const queries = workQueries(fake);
    assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO users")), false);
    assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO sessions")), false);
    assert.deepEqual(queries.at(-1).values.slice(6, 11), [
      "identity.login_failed",
      "login_attempt",
      "correlation-employee-login",
      "denied",
      "invitation_invalid",
    ]);
    assert.equal(fake.queries.at(-1).sql, "COMMIT");
  });
});

test("employee login persistence records every remaining named admission denial", async (t) => {
  const cases = [
    {
      name: "requires an invitation for an unbound identity",
      reason: "invitation_required",
      intent: authenticationIntent({ invitationTokenHash: null }),
      query(sql) {
        if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
        if (sql.startsWith("SELECT invitation.id::text")) return result([], 0);
        if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
        assert.fail(`unexpected work query: ${sql}`);
      },
    },
    {
      name: "rejects an invitation issued for another email",
      reason: "invitation_email_mismatch",
      intent: authenticationIntent(),
      query(sql) {
        if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
        if (sql.startsWith("SELECT invitation.id::text")) {
          return result([invitationRow({
            invitation_email_key: "other@cherryhillfci.com",
          })], 1);
        }
        if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
        assert.fail(`unexpected work query: ${sql}`);
      },
    },
    {
      name: "rejects an invitation when the normalized user email already exists",
      reason: "identity_conflict",
      intent: authenticationIntent(),
      query(sql) {
        if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
        if (sql.startsWith("SELECT invitation.id::text")) return result([invitationRow()], 1);
        if (sql.startsWith("SELECT project_id::text")) {
          return result([{ project_id: PROJECT_ID }], 1);
        }
        if (sql.startsWith("SELECT id::text AS id FROM users")) {
          return result([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }], 1);
        }
        if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
        assert.fail(`unexpected work query: ${sql}`);
      },
    },
    {
      name: "rejects a disabled bound user",
      reason: "user_unavailable",
      intent: authenticationIntent({ invitationTokenHash: null }),
      query(sql) {
        if (sql.startsWith("SELECT external_identity.id::text")) {
          return result([existingIdentityRow({ status: "disabled" })], 1);
        }
        if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
        assert.fail(`unexpected work query: ${sql}`);
      },
    },
    {
      name: "rejects a bound user without exactly one approved role",
      reason: "role_not_approved",
      intent: authenticationIntent({ invitationTokenHash: null }),
      query(sql) {
        if (sql.startsWith("SELECT external_identity.id::text")) {
          return result([existingIdentityRow()], 1);
        }
        if (sql.startsWith("SELECT assigned_role.role_key")) {
          return result([{ role_key: "unsupported_role" }], 1);
        }
        if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
        assert.fail(`unexpected work query: ${sql}`);
      },
    },
    {
      name: "rejects an invitation whose intended role is inactive",
      reason: "role_not_approved",
      intent: authenticationIntent(),
      query(sql) {
        if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
        if (sql.startsWith("SELECT invitation.id::text")) {
          return result([invitationRow({ role_status: "disabled" })], 1);
        }
        if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
        assert.fail(`unexpected work query: ${sql}`);
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fake = fakeDatabase(scenario.query);
      const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
        schema: "fci_test",
      });

      assert.deepEqual(await repository.authenticateEmployeeSession(scenario.intent), {
        outcome: "denied",
        reason: scenario.reason,
      });
      assertLoginFailureAudit(fake, scenario.reason);
      assert.equal(fake.queries.at(-1).sql, "COMMIT");
    });
  }
});

test("employee login maps a named PostgreSQL unique violation to a separately audited conflict", async () => {
  const uniqueViolation = Object.assign(new Error("FCI TEST duplicate user email"), {
    code: "23505",
    constraint: "users_email_key_key",
  });
  const fake = fakeDatabase(async (sql) => {
    if (sql.startsWith("SELECT external_identity.id::text")) return result([], 0);
    if (sql.startsWith("SELECT invitation.id::text")) return result([invitationRow()], 1);
    if (sql.startsWith("SELECT project_id::text")) {
      return result([{ project_id: PROJECT_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM users")) return result([], 0);
    if (sql.startsWith("INSERT INTO users")) throw uniqueViolation;
    if (sql.startsWith("INSERT INTO audit_events")) return result([], 1);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresIdentityPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.authenticateEmployeeSession(authenticationIntent()), {
    outcome: "conflict",
  });
  assert.equal(fake.connectCount, 2);
  assert.ok(fake.queries.some(({ sql }) => sql === "ROLLBACK"));
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
  assertLoginFailureAudit(fake, "conflict");
});
