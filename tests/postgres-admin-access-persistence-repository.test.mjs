import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/admin-access-persistence",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24694 } },
});
const adminAccessModule = await vite.ssrLoadModule(
  "/app/adapters/postgres/admin-access-persistence-repository.ts",
);
const {
  ADMIN_ACCESS_MUTATION_LOCK_ID,
  createPostgresAdminAccessPersistenceRepository,
} = adminAccessModule;

after(async () => {
  await vite.close();
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_SESSION_ID = "22222222-2222-4222-8222-222222222223";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const ROLE_ID = "10000000-0000-4000-8000-000000000003";
const PROJECT_A_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_B_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATED_AT = Date.UTC(2026, 6, 16, 12, 0, 0);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const TOKEN_HASH = `sha256:${"a".repeat(64)}`;

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function auditEvent(overrides = {}) {
  return {
    id: AUDIT_ID,
    executorType: "user",
    executorUserId: ACTOR_ID,
    executorKey: `user:${ACTOR_ID}`,
    originatingUserId: null,
    originatingActorKey: null,
    action: "caller.claimed_action",
    targetType: "project",
    targetId: PROJECT_A_ID,
    result: "failed",
    reasonCode: "caller_claimed_reason",
    requestId: "request-admin-access-test",
    correlationId: "correlation-admin-access-test",
    source: "unit_test",
    metadata: { fixture: "FCI TEST — DO NOT USE" },
    occurredAt: CREATED_AT,
    retentionPolicyKey: "security_default",
    retentionUntil: CREATED_AT + SEVEN_DAYS_MS,
    ...overrides,
  };
}

function invitationIntent(overrides = {}) {
  return {
    id: INVITATION_ID,
    email: "Invitee@CherryHillFCI.com",
    tokenHash: TOKEN_HASH,
    role: "project_manager",
    projectIds: [PROJECT_A_ID],
    invitedByUserId: ACTOR_ID,
    invitedByActorKey: `user:${ACTOR_ID}`,
    actorSessionId: ACTOR_SESSION_ID,
    actorSessionVersion: "3",
    actorAuthorizationVersion: "7",
    createdAt: CREATED_AT,
    expiresAt: CREATED_AT + SEVEN_DAYS_MS,
    purgeAfter: CREATED_AT + 2 * SEVEN_DAYS_MS,
    audit: auditEvent(),
    ...overrides,
  };
}

function actorIntent(overrides = {}) {
  return {
    actorUserId: ACTOR_ID,
    actorKey: `user:${ACTOR_ID}`,
    actorSessionId: ACTOR_SESSION_ID,
    actorSessionVersion: "3",
    actorAuthorizationVersion: "7",
    reasonCode: "access_review",
    changedAt: CREATED_AT,
    audit: auditEvent(),
    ...overrides,
  };
}

function readerScope(overrides = {}) {
  return {
    kind: "company",
    sessionId: ACTOR_SESSION_ID,
    sessionVersion: "3",
    userId: ACTOR_ID,
    authorizationVersion: "7",
    includeFinancial: true,
    ...overrides,
  };
}

function setUserAccessIntent(overrides = {}) {
  return {
    ...actorIntent(),
    userId: USER_ID,
    expectedVersion: "4",
    role: "project_manager",
    projectIds: [PROJECT_A_ID, PROJECT_B_ID],
    ...overrides,
  };
}

function fakeDatabase(
  workQuery = async () => assert.fail("unexpected work query"),
  { actorAuthorized = true, currentProjects = [] } = {},
) {
  const queries = [];
  const releases = [];
  let connectCount = 0;
  let configuredSchema = "public";
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values: [...values] });
      if (
        normalized.startsWith("BEGIN")
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
      if (normalized.startsWith("SELECT pg_catalog.pg_advisory_xact_lock")) {
        return result([{ locked: null }], 1);
      }
      if (normalized.startsWith("SELECT actor_session.id")) {
        return actorAuthorized ? result([{ id: ACTOR_SESSION_ID }], 1) : result([], 0);
      }
      if (normalized.startsWith("UPDATE invitations") && normalized.includes("status = 'expired'")) {
        return result([], 0);
      }
      if (normalized.startsWith("SELECT project_id::text AS project_id")) {
        return result(currentProjects.map((project_id) => ({ project_id })), currentProjects.length);
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
    !sql.startsWith("BEGIN")
    && sql !== "COMMIT"
    && sql !== "ROLLBACK"
    && !sql.startsWith("SET LOCAL")
    && !sql.includes("set_config('search_path'")
    && !sql.includes("current_schema()"));
}

function auditInsert(values) {
  assert.equal(values[0], AUDIT_ID);
  return result([], 1);
}

test("admin-access intent validation fails before borrowing a database connection", async () => {
  const cases = [
    ["outside-domain invitation", "createInvitation", invitationIntent({
      email: "invitee@example.test",
    }), /must belong to cherryhillfci\.com/],
    ["malformed company invitation", "createInvitation", invitationIntent({
      email: "a@b@cherryhillfci.com",
    }), /must belong to cherryhillfci\.com/],
    ["nonstandard invitation lifetime", "createInvitation", invitationIntent({
      expiresAt: CREATED_AT + 1,
    }), /fixed seven-day policy/],
    ["unsupported role", "createInvitation", invitationIntent({
      role: "sales_estimator",
    }), /supported fixed role/],
    ["Project Manager project required", "createInvitation", invitationIntent({
      projectIds: [],
    }), /require at least one project/],
    ["non-Project Manager assignments", "setUserAccess", setUserAccessIntent({
      role: "office_operations",
      projectIds: [PROJECT_A_ID],
    }), /Only Project Managers/],
    ["duplicate project assignment", "setUserAccess", setUserAccessIntent({
      projectIds: [PROJECT_A_ID, PROJECT_A_ID],
    }), /must be unique/],
    ["invalid expected version", "disableUser", {
      ...actorIntent(),
      userId: USER_ID,
      expectedVersion: "0",
    }, /positive signed 64-bit/],
    ["invalid actor session", "disableUser", {
      ...actorIntent({ actorSessionId: "not-a-session" }),
      userId: USER_ID,
      expectedVersion: "4",
    }, /actor session ID must be a UUID/],
  ];

  for (const [label, method, intent, pattern] of cases) {
    const fake = fakeDatabase();
    const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
      schema: "fci_test",
    });
    await assert.rejects(repository[method](intent), pattern, label);
    assert.equal(fake.connectCount, 0, label);
  }

  const unused = fakeDatabase();
  assert.throws(
    () => createPostgresAdminAccessPersistenceRepository(unused.pool, {
      schema: "Unsafe-Schema",
    }),
    /lowercase PostgreSQL identifier/,
  );
  assert.equal(unused.connectCount, 0);
});

test("access overview rechecks one Administrator session and returns only the bounded projection", async () => {
  const roleRows = [
    { role_key: "administrator", display_name: "Administrator", description: "Company-wide administration." },
    { role_key: "office_operations", display_name: "Office Operations", description: "Company-wide nonfinancial operations." },
    { role_key: "project_manager", display_name: "Project Manager", description: "Assigned-project nonfinancial operations." },
  ];
  const fake = fakeDatabase(async (sql) => {
    if (sql.startsWith("SELECT role_key, display_name, description")) {
      return result(roleRows, roleRows.length);
    }
    if (sql.startsWith("WITH bounded_people AS MATERIALIZED")) {
      return result([{
        id: ACTOR_ID,
        email: "AdminCRM@CherryHillFCI.com",
        display_name: "FCI TEST — DO NOT USE Administrator",
        status: "active",
        role_key: "administrator",
        role_status: "active",
        project_ids: [],
        last_signed_in_at: new Date(CREATED_AT - 1_000),
        version: "4",
      }], 1);
    }
    if (sql.startsWith("SELECT invitation.id::text AS id")) {
      return result([{
        id: INVITATION_ID,
        email: "Pending.PM@CherryHillFCI.com",
        role_key: "project_manager",
        role_status: "active",
        project_ids: [PROJECT_A_ID],
        created_at: new Date(CREATED_AT - 1_000),
        expires_at: new Date(CREATED_AT + SEVEN_DAYS_MS),
        version: "2",
      }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id, project_number")) {
      return result([{
        id: PROJECT_A_ID,
        project_number: "CF-2026-TEST0001",
        name: "FCI TEST — DO NOT USE Project",
        status: "planning",
      }], 1);
    }
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.getAccessOverview(readerScope(), CREATED_AT), {
    outcome: "accepted",
    overview: {
      summary: {
        activePeopleCount: 1,
        activeAdministratorCount: 1,
        pendingInvitationCount: 1,
      },
      roles: roleRows.map(({ role_key: key, display_name: displayName, description }) => ({
        key,
        displayName,
        description,
      })),
      people: [{
        id: ACTOR_ID,
        email: "admincrm@cherryhillfci.com",
        displayName: "FCI TEST — DO NOT USE Administrator",
        status: "active",
        role: "administrator",
        projectIds: [],
        lastSignedInAt: CREATED_AT - 1_000,
        version: "4",
      }],
      invitations: [{
        id: INVITATION_ID,
        email: "pending.pm@cherryhillfci.com",
        role: "project_manager",
        status: "pending",
        projectIds: [PROJECT_A_ID],
        createdAt: CREATED_AT - 1_000,
        expiresAt: CREATED_AT + SEVEN_DAYS_MS,
        version: "2",
      }],
      projects: [{
        id: PROJECT_A_ID,
        projectNumber: "CF-2026-TEST0001",
        name: "FCI TEST — DO NOT USE Project",
        status: "planning",
      }],
      generatedAt: CREATED_AT,
    },
  });

  assert.equal(fake.queries[0].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ");
  const [actor, roles, people, invitations, projects] = workQueries(fake);
  assert.match(actor.sql, /actor_capability\.capability_key = \$5/);
  assert.match(actor.sql, /idle_expires_at > pg_catalog\.statement_timestamp\(\)/);
  assert.match(actor.sql, /FOR SHARE OF actor_session, actor_user$/);
  assert.deepEqual(actor.values, [ACTOR_SESSION_ID, "3", ACTOR_ID, "7", "access_admin.read"]);
  assert.deepEqual(roles.values, [["administrator", "office_operations", "project_manager"]]);
  assert.match(people.sql, /^WITH bounded_people AS MATERIALIZED/);
  assert.match(people.sql, /LIMIT \$1\s+\),/);
  assert.match(people.sql, /project_scopes AS/);
  assert.match(people.sql, /last_sign_ins AS/);
  assert.match(people.sql, /pg_catalog\.max\(sign_in\.issued_at\) AS last_signed_in_at/);
  assert.match(people.sql, /COALESCE\(project_scopes\.project_ids, ARRAY\[\]::text\[\]\)/);
  assert.doesNotMatch(people.sql, /pg_catalog\.coalesce/i);
  assert.match(people.sql, /LEFT JOIN user_roles/);
  assert.match(invitations.sql, /status = 'pending'/);
  assert.match(invitations.sql, /expires_at > pg_catalog\.statement_timestamp\(\)/);
  assert.match(invitations.sql, /COALESCE\(/);
  assert.doesNotMatch(invitations.sql, /pg_catalog\.coalesce/i);
  assert.deepEqual(projects.values, [501]);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
  assert.doesNotMatch(JSON.stringify(await repository.getAccessOverview(readerScope(), CREATED_AT)), /token|csrf|authorizationVersion|sessionId/i);
});

test("access overview returns an actor-change result before any projection query", async () => {
  const fake = fakeDatabase(undefined, { actorAuthorized: false });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.getAccessOverview(readerScope(), CREATED_AT), {
    outcome: "actor_authorization_changed",
  });
  assert.equal(workQueries(fake).length, 1);
  assert.match(workQueries(fake)[0].sql, /FOR SHARE OF actor_session, actor_user$/);

  const invalid = fakeDatabase();
  const invalidRepository = createPostgresAdminAccessPersistenceRepository(invalid.pool, {
    schema: "fci_test",
  });
  await assert.rejects(
    invalidRepository.getAccessOverview(
      readerScope({ kind: "assigned_projects", includeFinancial: false }),
      CREATED_AT,
    ),
    /requires company Administrator scope/,
  );
  assert.equal(invalid.connectCount, 0);
});

test("access overview fails closed instead of silently truncating people", async () => {
  const roles = [
    { role_key: "administrator", display_name: "Administrator", description: "Company-wide administration." },
    { role_key: "office_operations", display_name: "Office Operations", description: "Company-wide nonfinancial operations." },
    { role_key: "project_manager", display_name: "Project Manager", description: "Assigned-project nonfinancial operations." },
  ];
  const people = Array.from({ length: 101 }, (_, index) => ({
    id: randomUUID(),
    email: `person${index}@cherryhillfci.com`,
    display_name: `FCI TEST — DO NOT USE Person ${index}`,
    status: "active",
    role_key: "office_operations",
    role_status: "active",
    project_ids: [],
    last_signed_in_at: null,
    version: "1",
  }));
  const fake = fakeDatabase(async (sql) => {
    if (sql.startsWith("SELECT role_key, display_name, description")) {
      return result(roles, roles.length);
    }
    if (sql.startsWith("WITH bounded_people AS MATERIALIZED")) {
      return result(people, people.length);
    }
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  await assert.rejects(
    repository.getAccessOverview(readerScope(), CREATED_AT),
    /people projection exceeds its bounded projection limit/,
  );
  assert.equal(fake.queries.at(-1).sql, "ROLLBACK");
  assert.equal(workQueries(fake).length, 3);
});

test("invitation creation binds the normalized exact email to a fixed role and audit", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM roles")) {
      return result([{ id: ROLE_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM projects")) {
      return result([{ id: PROJECT_A_ID }], 1);
    }
    if (sql.startsWith("INSERT INTO invitations")) return result([{ version: "1" }], 1);
    if (sql.startsWith("INSERT INTO invitation_project_assignments")) return result([], 1);
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
    lockTimeoutMs: 1_234,
    statementTimeoutMs: 5_678,
  });

  assert.deepEqual(await repository.createInvitation(invitationIntent()), {
    outcome: "accepted",
    version: "1",
    authorizationVersion: null,
  });
  const [lock, actor, expired, role, projects, invitation, assignments, audit] = workQueries(fake);
  assert.match(lock.sql, /pg_advisory_xact_lock/);
  assert.deepEqual(lock.values, [ADMIN_ACCESS_MUTATION_LOCK_ID]);
  assert.match(actor.sql, /statement_timestamp\(\)/);
  assert.match(actor.sql, /FOR UPDATE OF actor_session, actor_user$/);
  assert.deepEqual(actor.values, [
    ACTOR_SESSION_ID,
    "3",
    ACTOR_ID,
    "7",
    "invitations.create",
  ]);
  assert.match(expired.sql, /status = 'expired'/);
  assert.deepEqual(expired.values, ["invitee@cherryhillfci.com", new Date(CREATED_AT)]);
  assert.deepEqual(role.values, ["project_manager"]);
  assert.deepEqual(projects.values, [[PROJECT_A_ID]]);
  assert.match(invitation.sql, /token_hash, role_id, status/);
  assert.deepEqual(invitation.values.slice(0, 6), [
    INVITATION_ID,
    "invitee@cherryhillfci.com",
    TOKEN_HASH,
    ROLE_ID,
    ACTOR_ID,
    `user:${ACTOR_ID}`,
  ]);
  assert.deepEqual(assignments.values, [
    INVITATION_ID,
    [PROJECT_A_ID],
    new Date(CREATED_AT),
  ]);
  assert.deepEqual(audit.values.slice(6, 11), [
    "identity.invitation_created",
    "invitation",
    INVITATION_ID,
    "succeeded",
    null,
  ]);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("an Administrator command rechecks and locks the actor session after the mutation lock", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  }, { actorAuthorized: false });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.createInvitation(invitationIntent()), {
    outcome: "actor_authorization_changed",
  });
  const queries = workQueries(fake);
  assert.match(queries[0].sql, /pg_advisory_xact_lock/);
  assert.match(queries[1].sql, /actor_session\.idle_expires_at > pg_catalog\.statement_timestamp\(\)/);
  assert.match(queries[1].sql, /FOR UPDATE OF actor_session, actor_user$/);
  assert.equal(
    queries.some(({ sql }) =>
      sql.startsWith("UPDATE invitations")
      || sql.startsWith("INSERT INTO invitations")
      || sql.startsWith("INSERT INTO invitation_project_assignments")),
    false,
  );
  assert.deepEqual(queries.at(-1).values.slice(6, 11), [
    "identity.invitation_created",
    "invitation",
    INVITATION_ID,
    "denied",
    "actor_authorization_changed",
  ]);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("only named invitation conflicts map to conflict and receive a separate denial audit", async () => {
  const knownConflict = Object.assign(new Error("simulated invitation conflict"), {
    code: "23505",
    constraint: "invitations_pending_email_key_idx",
  });
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM roles")) {
      return result([{ id: ROLE_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM projects")) {
      return result([{ id: PROJECT_A_ID }], 1);
    }
    if (sql.startsWith("INSERT INTO invitations")) throw knownConflict;
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.createInvitation(invitationIntent()), {
    outcome: "conflict",
  });
  assert.equal(fake.connectCount, 2);
  assert.equal(fake.queries.filter(({ sql }) => sql.includes("pg_advisory_xact_lock")).length, 2);
  assert.equal(fake.queries.some(({ sql }) => sql === "ROLLBACK"), true);
  const audit = workQueries(fake).find(({ sql }) => sql.startsWith("INSERT INTO audit_events"));
  assert.deepEqual(audit.values.slice(6, 11), [
    "identity.invitation_created",
    "invitation",
    INVITATION_ID,
    "denied",
    "conflict",
  ]);

  const unrelated = Object.assign(new Error("unrelated unique constraint"), {
    code: "23505",
    constraint: "audit_events_pkey",
  });
  const unrelatedFake = fakeDatabase(async (sql) => {
    if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM roles")) {
      return result([{ id: ROLE_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM projects")) {
      return result([{ id: PROJECT_A_ID }], 1);
    }
    if (sql.startsWith("INSERT INTO invitations")) throw unrelated;
    assert.fail(`unexpected work query: ${sql}`);
  });
  const unrelatedRepository = createPostgresAdminAccessPersistenceRepository(
    unrelatedFake.pool,
    { schema: "fci_test" },
  );
  await assert.rejects(
    unrelatedRepository.createInvitation(invitationIntent()),
    (error) => error === unrelated,
  );
  assert.equal(unrelatedFake.connectCount, 1);
});

test("invitation revocation is optimistic, clears the bearer hash, and records stale denial", async (t) => {
  for (const [label, updateResult, expected] of [
    ["accepted", result([{ version: "5" }], 1), {
      outcome: "accepted",
      version: "5",
      authorizationVersion: null,
    }],
    ["stale", result([], 0), { outcome: "stale" }],
  ]) {
    await t.test(label, async () => {
      const fake = fakeDatabase(async (sql, values) => {
        if (sql.startsWith("UPDATE invitations")) return updateResult;
        if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
        assert.fail(`unexpected work query: ${sql}`);
      });
      const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
        schema: "fci_test",
      });
      const intent = {
        ...actorIntent(),
        invitationId: INVITATION_ID,
        expectedVersion: "4",
      };

      assert.deepEqual(await repository.revokeInvitation(intent), expected);
      const update = workQueries(fake).find(({ sql }) => sql.startsWith("UPDATE invitations"));
      assert.match(update.sql, /SET token_hash = NULL/);
      assert.match(update.sql, /version = \$2::bigint AND status = 'pending'/);
      assert.deepEqual(update.values, [INVITATION_ID, "4", ACTOR_ID, new Date(CREATED_AT)]);
      const audit = workQueries(fake).at(-1);
      assert.deepEqual(audit.values.slice(6, 11), [
        "identity.invitation_revoked",
        "invitation",
        INVITATION_ID,
        label === "accepted" ? "succeeded" : "denied",
        label === "accepted" ? "access_review" : "stale_state",
      ]);
    });
  }
});

test("role and exact Project Manager assignments change atomically and invalidate old sessions", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("SELECT employee.status")) {
      return result([{
        status: "active",
        version: "4",
        authorization_version: "7",
        role_key: "office_operations",
      }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM roles")) {
      return result([{ id: ROLE_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM projects")) {
      return result([{ id: PROJECT_A_ID }, { id: PROJECT_B_ID }], 2);
    }
    if (sql.startsWith("INSERT INTO user_roles")) return result([], 1);
    if (sql.startsWith("UPDATE project_memberships")) return result([], 1);
    if (sql.startsWith("INSERT INTO project_memberships")) return result([], 2);
    if (sql.startsWith("UPDATE users")) {
      return result([{ version: "5", authorization_version: "8" }], 1);
    }
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.setUserAccess(setUserAccessIntent()), {
    outcome: "accepted",
    version: "5",
    authorizationVersion: "8",
  });
  const queries = workQueries(fake);
  assert.match(queries[0].sql, /pg_advisory_xact_lock/);
  assert.match(queries[2].sql, /FOR UPDATE OF employee$/);
  const roleAssignment = queries.find(({ sql }) => sql.startsWith("INSERT INTO user_roles"));
  assert.match(roleAssignment.sql, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(roleAssignment.sql, /version = user_roles\.version \+ 1/);
  const revoked = queries.find(({ sql }) => sql.startsWith("UPDATE project_memberships"));
  assert.match(revoked.sql, /status = 'revoked'/);
  assert.match(revoked.sql, /NOT \(project_id = ANY\(\$2::uuid\[\]\)\)/);
  const assigned = queries.find(({ sql }) => sql.startsWith("INSERT INTO project_memberships"));
  assert.match(assigned.sql, /status = 'active'/);
  assert.match(assigned.sql, /revoked_by_user_id = NULL/);
  assert.match(assigned.sql, /version = project_memberships\.version \+ 1/);
  const user = queries.find(({ sql }) => sql.startsWith("UPDATE users"));
  assert.match(user.sql, /authorization_version = authorization_version \+ 1/);
  assert.match(user.sql, /sessions_valid_after = GREATEST/);
  assert.match(user.sql, /WHERE id = \$1 AND version = \$2::bigint AND status = 'active'/);
  const audit = queries.at(-1);
  assert.deepEqual(audit.values.slice(6, 11), [
    "authorization.user_access_changed",
    "user",
    USER_ID,
    "succeeded",
    "access_review",
  ]);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("an unchanged role and project scope is denied before sessions or access state mutate", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("SELECT employee.status")) {
      return result([{
        status: "active",
        version: "4",
        authorization_version: "7",
        role_key: "project_manager",
      }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM roles")) {
      return result([{ id: ROLE_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM projects")) {
      return result(values[0].map((id) => ({ id })), values[0].length);
    }
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  }, { currentProjects: [PROJECT_A_ID, PROJECT_B_ID] });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.setUserAccess(setUserAccessIntent()), {
    outcome: "conflict",
  });
  assert.equal(
    workQueries(fake).some(({ sql }) =>
      sql.startsWith("INSERT INTO user_roles")
      || sql.startsWith("UPDATE project_memberships")
      || sql.startsWith("INSERT INTO project_memberships")
      || sql.startsWith("UPDATE users")),
    false,
  );
  const audit = workQueries(fake).at(-1);
  assert.deepEqual(audit.values.slice(6, 11), [
    "authorization.user_access_changed",
    "user",
    USER_ID,
    "denied",
    "unchanged_access",
  ]);
});

test("access-change audit retains exact revoke and reactivation scope history", async () => {
  const scenarios = [
    {
      previous: [PROJECT_A_ID, PROJECT_B_ID],
      next: [PROJECT_B_ID],
    },
    {
      previous: [PROJECT_B_ID],
      next: [PROJECT_A_ID, PROJECT_B_ID],
    },
  ];
  const evidence = [];

  for (const scenario of scenarios) {
    let metadata = null;
    const fake = fakeDatabase(async (sql, values) => {
      if (sql.startsWith("SELECT employee.status")) {
        return result([{
          status: "active",
          version: "4",
          authorization_version: "7",
          role_key: "project_manager",
        }], 1);
      }
      if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM roles")) {
        return result([{ id: ROLE_ID }], 1);
      }
      if (sql.startsWith("SELECT id::text AS id FROM projects")) {
        return result(values[0].map((id) => ({ id })), values[0].length);
      }
      if (sql.startsWith("INSERT INTO user_roles")) return result([], 1);
      if (sql.startsWith("UPDATE project_memberships")) return result([], 1);
      if (sql.startsWith("INSERT INTO project_memberships")) return result([], scenario.next.length);
      if (sql.startsWith("UPDATE users")) {
        return result([{ version: "5", authorization_version: "8" }], 1);
      }
      if (sql.startsWith("INSERT INTO audit_events")) {
        metadata = JSON.parse(values[14]);
        return auditInsert(values);
      }
      assert.fail(`unexpected work query: ${sql}`);
    }, { currentProjects: scenario.previous });
    const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
      schema: "fci_test",
    });

    assert.equal((await repository.setUserAccess(setUserAccessIntent({
      projectIds: scenario.next,
    }))).outcome, "accepted");
    evidence.push(metadata);
  }

  assert.deepEqual(evidence, [
    {
      fixture: "FCI TEST — DO NOT USE",
      previous_role: "project_manager",
      previous_project_ids: [PROJECT_A_ID, PROJECT_B_ID],
      new_role: "project_manager",
      new_project_ids: [PROJECT_B_ID],
    },
    {
      fixture: "FCI TEST — DO NOT USE",
      previous_role: "project_manager",
      previous_project_ids: [PROJECT_B_ID],
      new_role: "project_manager",
      new_project_ids: [PROJECT_A_ID, PROJECT_B_ID],
    },
  ]);
});

test("missing assignment targets deny the aggregate change before any access state mutates", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("SELECT employee.status")) {
      return result([{
        status: "active",
        version: "4",
        authorization_version: "7",
        role_key: "office_operations",
      }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM roles")) {
      return result([{ id: ROLE_ID }], 1);
    }
    if (sql.startsWith("SELECT id::text AS id FROM projects")) {
      return result([{ id: PROJECT_A_ID }], 1);
    }
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.setUserAccess(setUserAccessIntent()), {
    outcome: "conflict",
  });
  assert.equal(
    workQueries(fake).some(({ sql }) =>
      sql.startsWith("INSERT INTO user_roles") || sql.startsWith("UPDATE users")),
    false,
  );
  const audit = workQueries(fake).at(-1);
  assert.deepEqual(audit.values.slice(6, 11), [
    "authorization.user_access_changed",
    "user",
    USER_ID,
    "denied",
    "project_not_found",
  ]);
});

test("a stale aggregate user version denies role and project changes before mutation", async () => {
  const fake = fakeDatabase(async (sql, values) => {
    if (sql.startsWith("SELECT employee.status")) {
      return result([{
        status: "active",
        version: "3",
        authorization_version: "7",
        role_key: "office_operations",
      }], 1);
    }
    if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  assert.deepEqual(await repository.setUserAccess(setUserAccessIntent()), {
    outcome: "stale",
  });
  assert.equal(
    workQueries(fake).some(({ sql }) =>
      sql.startsWith("INSERT INTO user_roles")
      || sql.startsWith("UPDATE project_memberships")
      || sql.startsWith("UPDATE users")),
    false,
  );
  const audit = workQueries(fake).at(-1);
  assert.deepEqual(audit.values.slice(6, 11), [
    "authorization.user_access_changed",
    "user",
    USER_ID,
    "denied",
    "stale_state",
  ]);
});

test("the final active Administrator cannot be demoted or disabled", async (t) => {
  for (const [label, method, intent, action] of [
    ["demotion", "setUserAccess", setUserAccessIntent({
      role: "office_operations",
      projectIds: [],
    }), "authorization.user_access_changed"],
    ["disable", "disableUser", {
      ...actorIntent(),
      userId: USER_ID,
      expectedVersion: "4",
    }, "identity.user_disabled"],
  ]) {
    await t.test(label, async () => {
      const fake = fakeDatabase(async (sql, values) => {
        if (sql.startsWith("SELECT employee.status")) {
          return result([{
            status: "active",
            version: "4",
            authorization_version: "7",
            role_key: "administrator",
          }], 1);
        }
        if (sql.startsWith("SELECT pg_catalog.count")) return result([{ count: "1" }], 1);
        if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
        assert.fail(`unexpected work query: ${sql}`);
      });
      const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
        schema: "fci_test",
      });

      assert.deepEqual(await repository[method](intent), {
        outcome: "final_active_administrator",
      });
      const queries = workQueries(fake);
      assert.match(queries[0].sql, /pg_advisory_xact_lock/);
      assert.equal(queries.some(({ sql }) => sql.startsWith("UPDATE users")), false);
      const audit = queries.at(-1);
      assert.deepEqual(audit.values.slice(6, 11), [
        action,
        "user",
        USER_ID,
        "denied",
        "final_active_administrator",
      ]);
      assert.equal(fake.queries.at(-1).sql, "COMMIT");
    });
  }
});

test("disable and sign-out-everywhere are version fenced and invalidate through the user cutoff", async (t) => {
  for (const [label, method, status, action] of [
    ["disable", "disableUser", "active", "identity.user_disabled"],
    ["sign out everywhere", "invalidateUserSessions", "disabled", "identity.sessions_invalidated"],
  ]) {
    await t.test(label, async () => {
      const fake = fakeDatabase(async (sql, values) => {
        if (sql.startsWith("SELECT employee.status")) {
          return result([{
            status,
            version: "4",
            authorization_version: "7",
            role_key: "office_operations",
          }], 1);
        }
        if (sql.startsWith("UPDATE users")) {
          return result([{ version: "5", authorization_version: "8" }], 1);
        }
        if (sql.startsWith("INSERT INTO audit_events")) return auditInsert(values);
        assert.fail(`unexpected work query: ${sql}`);
      });
      const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
        schema: "fci_test",
      });
      const intent = {
        ...actorIntent(),
        userId: USER_ID,
        expectedVersion: "4",
      };

      assert.deepEqual(await repository[method](intent), {
        outcome: "accepted",
        version: "5",
        authorizationVersion: "8",
      });
      const update = workQueries(fake).find(({ sql }) => sql.startsWith("UPDATE users"));
      assert.match(update.sql, /authorization_version = authorization_version \+ 1/);
      assert.match(update.sql, /sessions_valid_after = GREATEST/);
      if (method === "disableUser") assert.match(update.sql, /status = 'disabled'/);
      else assert.doesNotMatch(update.sql, /status = 'disabled'/);
      assert.equal(
        workQueries(fake).some(({ sql }) => sql.startsWith("UPDATE sessions")),
        false,
      );
      const audit = workQueries(fake).at(-1);
      assert.deepEqual(audit.values.slice(6, 11), [
        action,
        "user",
        USER_ID,
        "succeeded",
        "access_review",
      ]);
    });
  }
});

test("audit failure rolls back access state instead of committing an unaudited mutation", async () => {
  const auditFailure = new Error("simulated audit failure");
  const fake = fakeDatabase(async (sql) => {
    if (sql.startsWith("SELECT employee.status")) {
      return result([{
        status: "disabled",
        version: "4",
        authorization_version: "7",
        role_key: "office_operations",
      }], 1);
    }
    if (sql.startsWith("UPDATE users")) {
      return result([{ version: "5", authorization_version: "8" }], 1);
    }
    if (sql.startsWith("INSERT INTO audit_events")) throw auditFailure;
    assert.fail(`unexpected work query: ${sql}`);
  });
  const repository = createPostgresAdminAccessPersistenceRepository(fake.pool, {
    schema: "fci_test",
  });

  await assert.rejects(
    repository.invalidateUserSessions({
      ...actorIntent(),
      userId: USER_ID,
      expectedVersion: "4",
    }),
    (error) => error === auditFailure,
  );
  assert.equal(fake.queries.at(-1).sql, "ROLLBACK");
  assert.deepEqual(fake.releases, [undefined]);
});

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();

function integrationAudit(id, actorUserId, targetId, changedAt) {
  return {
    id,
    executorType: "user",
    executorUserId: actorUserId,
    executorKey: `user:${actorUserId}`,
    originatingUserId: null,
    originatingActorKey: null,
    action: "caller.concurrent_admin_change",
    targetType: "user",
    targetId,
    result: "succeeded",
    reasonCode: null,
    requestId: `request-${id}`,
    correlationId: `correlation-${id}`,
    source: "integration_test",
    metadata: { fixture: "FCI TEST — DO NOT USE" },
    occurredAt: changedAt,
    retentionPolicyKey: "security_default",
    retentionUntil: null,
  };
}

async function withMigratedAdminAccessSchema(
  work,
  migrations = PRODUCTION_SCHEMA_MIGRATIONS,
) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: postgresTestUrl, max: 4 });
  const schema = `fci_admin_access_${randomUUID().replaceAll("-", "")}`;
  let schemaCreated = false;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await runProductionSchemaMigrations(pool, migrations, { schema });
    return await work({ pool, schema });
  } finally {
    try {
      if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  }
}

test(
  "PostgreSQL migration 4 rejects populated generic access tables without partial catalog changes",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 60_000,
  },
  async () => {
    await withMigratedAdminAccessSchema(async ({ pool, schema }) => {
      const legacyRoleId = randomUUID();
      const legacyCapabilityId = randomUUID();
      const createdAt = new Date();
      await pool.query(
        `INSERT INTO ${schema}.roles (
           id, role_key, display_name, description, status,
           created_at, updated_at, version
         ) VALUES
           ($1, 'legacy_test_role', 'FCI TEST — DO NOT USE Legacy Role', NULL,
            'active', $2, $2, 1)`,
        [legacyRoleId, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.capabilities (
           id, capability_key, display_name, description, status,
           created_at, updated_at, version
         ) VALUES
           ($1, 'legacy.test', 'FCI TEST — DO NOT USE Legacy Capability', NULL,
            'active', $2, $2, 1)`,
        [legacyCapabilityId, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.role_capabilities (
           role_id, capability_id, granted_by_user_id,
           granted_by_actor_key, granted_at
         ) VALUES ($1, $2, NULL, 'system:integration_test', $3)`,
        [legacyRoleId, legacyCapabilityId, createdAt],
      );

      await assert.rejects(
        runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema }),
        (error) => {
          assert.match(
            error.message,
            /migration 4 \(admin_access_persistence\) did not complete cleanly/,
          );
          assert.equal(error.cause?.code, "55000");
          assert.match(error.cause?.message ?? "", /requires empty version-3 role and access tables/);
          return true;
        },
      );

      const history = await pool.query(
        `SELECT version, name
         FROM ${schema}.production_schema_migrations
         ORDER BY version`,
      );
      assert.deepEqual(history.rows, PRODUCTION_SCHEMA_MIGRATIONS.slice(0, 3).map(
        ({ version, name }) => ({ version, name }),
      ));
      const catalogs = await pool.query(
        `SELECT
           (SELECT pg_catalog.count(*)::int FROM ${schema}.roles) AS roles,
           (SELECT pg_catalog.count(*)::int FROM ${schema}.capabilities) AS capabilities,
           (SELECT pg_catalog.count(*)::int FROM ${schema}.role_capabilities) AS grants,
           (SELECT pg_catalog.count(*)::int FROM ${schema}.roles
              WHERE role_key IN ('administrator', 'office_operations', 'project_manager'))
             AS fixed_roles`,
      );
      assert.deepEqual(catalogs.rows, [{
        roles: 1,
        capabilities: 1,
        grants: 1,
        fixed_roles: 0,
      }]);
      const v4Structures = await pool.query(
        `SELECT
           pg_catalog.to_regclass($1)::text AS invitation_projects_table,
           pg_catalog.count(*) FILTER (
             WHERE table_name = 'invitations' AND column_name = 'role_id'
           )::int AS invitation_role_columns,
           pg_catalog.count(*) FILTER (
             WHERE table_name = 'user_roles' AND column_name = 'version'
           )::int AS user_role_version_columns
         FROM information_schema.columns
         WHERE table_schema = $2`,
        [`${schema}.invitation_project_assignments`, schema],
      );
      assert.deepEqual(v4Structures.rows, [{
        invitation_projects_table: null,
        invitation_role_columns: 0,
        user_role_version_columns: 0,
      }]);
    }, PRODUCTION_SCHEMA_MIGRATIONS.slice(0, 3));
  },
);

async function fixedRoleId(pool, schema, roleKey) {
  const found = await pool.query(
    `SELECT id::text AS id FROM ${schema}.roles WHERE role_key = $1`,
    [roleKey],
  );
  assert.equal(found.rowCount, 1);
  return found.rows[0].id;
}

async function seedTwoAdministratorRaceFixture(pool, schema) {
  const roleId = await fixedRoleId(pool, schema, "administrator");
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const firstSessionId = randomUUID();
  const secondSessionId = randomUUID();
  const changedAt = Date.now();
  const createdAt = new Date(changedAt - 60_000);
  await pool.query(
    `INSERT INTO ${schema}.users (
       id, email, email_key, display_name, status, authorization_version,
       sessions_valid_after, created_at, updated_at, version
     ) VALUES
       ($1, 'admin-one@cherryhillfci.com', 'admin-one@cherryhillfci.com',
        'FCI TEST — DO NOT USE Admin One', 'active', 1, $3, $3, $3, 1),
       ($2, 'admin-two@cherryhillfci.com', 'admin-two@cherryhillfci.com',
        'FCI TEST — DO NOT USE Admin Two', 'active', 1, $3, $3, $3, 1)`,
    [firstUserId, secondUserId, createdAt],
  );
  await pool.query(
    `INSERT INTO ${schema}.user_roles (
       user_id, role_id, assigned_by_user_id, assigned_by_actor_key,
       assigned_at, expires_at, version
     ) VALUES
       ($1, $3, $2, $4, $5, NULL, 1),
       ($2, $3, $1, $6, $5, NULL, 1)`,
    [
      firstUserId,
      secondUserId,
      roleId,
      `user:${secondUserId}`,
      createdAt,
      `user:${firstUserId}`,
    ],
  );
  await pool.query(
    `INSERT INTO ${schema}.sessions (
       id, user_id, token_hash, csrf_hash, authorization_version,
       rotated_from_session_id, issued_at, last_seen_at, idle_expires_at,
       absolute_expires_at, revoked_at, revoked_by_actor_key,
       revocation_reason_code, purge_after, version
     ) VALUES
       ($1, $2, $5, $6, 1, NULL, $7, $7, $8, $9, NULL, NULL, NULL, $10, 1),
       ($3, $4, $11, $12, 1, NULL, $7, $7, $8, $9, NULL, NULL, NULL, $10, 1)`,
    [
      firstSessionId,
      firstUserId,
      secondSessionId,
      secondUserId,
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
      createdAt,
      new Date(changedAt + 15 * 60_000),
      new Date(changedAt + 8 * 60 * 60_000),
      new Date(changedAt + 9 * 60 * 60_000),
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
    ],
  );
  return {
    firstUserId,
    secondUserId,
    firstSessionId,
    secondSessionId,
    changedAt,
  };
}

function integrationDisableIntent({
  auditId,
  actorUserId,
  actorSessionId,
  targetUserId,
  changedAt,
}) {
  return {
    userId: targetUserId,
    expectedVersion: "1",
    actorUserId,
    actorKey: `user:${actorUserId}`,
    actorSessionId,
    actorSessionVersion: "1",
    actorAuthorizationVersion: "1",
    reasonCode: "concurrent_test",
    changedAt,
    audit: integrationAudit(auditId, actorUserId, targetUserId, changedAt),
  };
}

async function readRaceEvidence(pool, schema, fixture, auditIds) {
  const users = await pool.query(
    `SELECT status, version::text AS version
     FROM ${schema}.users
     WHERE id = ANY($1::uuid[])
     ORDER BY status, id`,
    [[fixture.firstUserId, fixture.secondUserId]],
  );
  assert.deepEqual(
    users.rows.map(({ status, version }) => ({ status, version })),
    [
      { status: "active", version: "1" },
      { status: "disabled", version: "2" },
    ],
  );
  assert.equal(users.rows.filter(({ status }) => status === "active").length, 1);
  const audits = await pool.query(
    `SELECT result, reason_code
     FROM ${schema}.audit_events
     WHERE id = ANY($1::uuid[])
     ORDER BY result`,
    [auditIds],
  );
  return audits.rows;
}

test(
  "PostgreSQL serializes concurrent Administrator removals and rejects the now-disabled actor",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 60_000,
  },
  async () => {
    await withMigratedAdminAccessSchema(async ({ pool, schema }) => {
      const fixture = await seedTwoAdministratorRaceFixture(pool, schema);
      const repository = createPostgresAdminAccessPersistenceRepository(pool, { schema });
      const firstAuditId = randomUUID();
      const secondAuditId = randomUUID();
      const [first, second] = await Promise.all([
        repository.disableUser(integrationDisableIntent({
          auditId: firstAuditId,
          actorUserId: fixture.secondUserId,
          actorSessionId: fixture.secondSessionId,
          targetUserId: fixture.firstUserId,
          changedAt: fixture.changedAt,
        })),
        repository.disableUser(integrationDisableIntent({
          auditId: secondAuditId,
          actorUserId: fixture.firstUserId,
          actorSessionId: fixture.firstSessionId,
          targetUserId: fixture.secondUserId,
          changedAt: fixture.changedAt,
        })),
      ]);
      assert.deepEqual(
        [first.outcome, second.outcome].sort(),
        ["accepted", "actor_authorization_changed"].sort(),
      );
      assert.deepEqual(await readRaceEvidence(
        pool,
        schema,
        fixture,
        [firstAuditId, secondAuditId],
      ), [
        { result: "denied", reason_code: "actor_authorization_changed" },
        { result: "succeeded", reason_code: "concurrent_test" },
      ]);
    });
  },
);

test(
  "PostgreSQL serializes concurrent Administrator self-disables and protects the final active Administrator",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 60_000,
  },
  async () => {
    await withMigratedAdminAccessSchema(async ({ pool, schema }) => {
      const fixture = await seedTwoAdministratorRaceFixture(pool, schema);
      const repository = createPostgresAdminAccessPersistenceRepository(pool, { schema });
      const firstAuditId = randomUUID();
      const secondAuditId = randomUUID();
      const [first, second] = await Promise.all([
        repository.disableUser(integrationDisableIntent({
          auditId: firstAuditId,
          actorUserId: fixture.firstUserId,
          actorSessionId: fixture.firstSessionId,
          targetUserId: fixture.firstUserId,
          changedAt: fixture.changedAt,
        })),
        repository.disableUser(integrationDisableIntent({
          auditId: secondAuditId,
          actorUserId: fixture.secondUserId,
          actorSessionId: fixture.secondSessionId,
          targetUserId: fixture.secondUserId,
          changedAt: fixture.changedAt,
        })),
      ]);
      assert.deepEqual(
        [first.outcome, second.outcome].sort(),
        ["accepted", "final_active_administrator"].sort(),
      );
      assert.deepEqual(await readRaceEvidence(
        pool,
        schema,
        fixture,
        [firstAuditId, secondAuditId],
      ), [
        { result: "denied", reason_code: "final_active_administrator" },
        { result: "succeeded", reason_code: "concurrent_test" },
      ]);
    });
  },
);

test(
  "PostgreSQL access overview independently aggregates bounded people, projects, sessions, and live invitations",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 60_000,
  },
  async () => {
    await withMigratedAdminAccessSchema(async ({ pool, schema }) => {
      const administratorRoleId = await fixedRoleId(pool, schema, "administrator");
      const projectManagerRoleId = await fixedRoleId(pool, schema, "project_manager");
      const actorUserId = randomUUID();
      const targetUserId = randomUUID();
      const actorSessionId = randomUUID();
      const earlierTargetSessionId = randomUUID();
      const laterTargetSessionId = randomUUID();
      const clientId = randomUUID();
      const projectAId = randomUUID();
      const projectBId = randomUUID();
      const liveInvitationId = randomUUID();
      const expiredInvitationId = randomUUID();
      const operationAt = Date.now();
      const createdAt = new Date(operationAt - 5 * 60_000);
      const earlierSignInAt = new Date(operationAt - 2 * 60_000);
      const laterSignInAt = new Date(operationAt - 60_000);
      const idleExpiresAt = new Date(operationAt + 15 * 60_000);
      const absoluteExpiresAt = new Date(operationAt + 8 * 60 * 60_000);
      const purgeAfter = new Date(operationAt + 9 * 60 * 60_000);
      const actorKey = `user:${actorUserId}`;
      const orderedProjectIds = [projectAId, projectBId].sort();

      await pool.query(
        `INSERT INTO ${schema}.users (
           id, email, email_key, display_name, status, authorization_version,
           sessions_valid_after, created_at, updated_at, version
         ) VALUES
           ($1, 'admin-overview@cherryhillfci.com', 'admin-overview@cherryhillfci.com',
            'FCI TEST — DO NOT USE A Administrator', 'active', 1, $3, $3, $3, 1),
           ($2, 'pm-overview@cherryhillfci.com', 'pm-overview@cherryhillfci.com',
            'FCI TEST — DO NOT USE Z Project Manager', 'active', 1, $3, $3, $3, 1)`,
        [actorUserId, targetUserId, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.user_roles (
           user_id, role_id, assigned_by_user_id, assigned_by_actor_key,
           assigned_at, expires_at, version
         ) VALUES
           ($1, $3, NULL, 'system:integration_test', $5, NULL, 1),
           ($2, $4, $1, $6, $5, NULL, 1)`,
        [actorUserId, targetUserId, administratorRoleId, projectManagerRoleId, createdAt, actorKey],
      );
      await pool.query(
        `INSERT INTO ${schema}.sessions (
           id, user_id, token_hash, csrf_hash, authorization_version,
           rotated_from_session_id, issued_at, last_seen_at, idle_expires_at,
           absolute_expires_at, revoked_at, revoked_by_actor_key,
           revocation_reason_code, purge_after, version
         ) VALUES
           ($1, $4, $6, $7, 1, NULL, $12, $12, $15, $16, NULL, NULL, NULL, $17, 1),
           ($2, $5, $8, $9, 1, NULL, $13, $13, $15, $16, NULL, NULL, NULL, $17, 1),
           ($3, $5, $10, $11, 1, NULL, $14, $14, $15, $16, NULL, NULL, NULL, $17, 1)`,
        [
          actorSessionId,
          earlierTargetSessionId,
          laterTargetSessionId,
          actorUserId,
          targetUserId,
          `sha256:${"9".repeat(64)}`,
          `sha256:${"a".repeat(64)}`,
          `sha256:${"b".repeat(64)}`,
          `sha256:${"c".repeat(64)}`,
          `sha256:${"d".repeat(64)}`,
          `sha256:${"e".repeat(64)}`,
          createdAt,
          earlierSignInAt,
          laterSignInAt,
          idleExpiresAt,
          absoluteExpiresAt,
          purgeAfter,
        ],
      );
      await pool.query(
        `INSERT INTO ${schema}.clients (
           id, client_code, name, normalized_name_key, status,
           created_by, updated_by, created_at, updated_at, version
         ) VALUES
           ($1, 'CL-TESTOV01', 'FCI TEST — DO NOT USE Overview Client',
            'fci test overview client', 'active', $2, $2, $3, $3, 1)`,
        [clientId, actorKey, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.projects (
           id, project_number, client_id, name, status, created_by,
           updated_by, created_at, updated_at, version
         ) VALUES
           ($1, 'CF-2026-OVERVW01', $3, 'FCI TEST — DO NOT USE Overview A',
            'planning', $4, $4, $5, $5, 1),
           ($2, 'CF-2026-OVERVW02', $3, 'FCI TEST — DO NOT USE Overview B',
            'installation', $4, $4, $5, $5, 1)`,
        [projectAId, projectBId, clientId, actorKey, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.project_memberships (
           project_id, user_id, assigned_by_user_id, assigned_by_actor_key,
           assigned_at, expires_at, status, revoked_by_user_id,
           revoked_by_actor_key, revoked_at, revocation_reason_code, version
         ) VALUES
           ($1, $3, $4, $5, $6, NULL, 'active', NULL, NULL, NULL, NULL, 1),
           ($2, $3, $4, $5, $6, NULL, 'active', NULL, NULL, NULL, NULL, 1)`,
        [projectAId, projectBId, targetUserId, actorUserId, actorKey, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.invitations (
           id, email, email_key, token_hash, role_id, status,
           invited_by_user_id, invited_by_actor_key, expires_at, purge_after,
           created_at, updated_at, version
         ) VALUES
           ($1, 'pending-overview@cherryhillfci.com', 'pending-overview@cherryhillfci.com',
            $3, $5, 'pending', $6, $7, $8, $9, $10, $10, 1),
           ($2, 'expired-overview@cherryhillfci.com', 'expired-overview@cherryhillfci.com',
            $4, $5, 'pending', $6, $7, $11, $9, $12, $12, 1)`,
        [
          liveInvitationId,
          expiredInvitationId,
          `sha256:${"f".repeat(64)}`,
          `sha256:${"1".repeat(64)}`,
          projectManagerRoleId,
          actorUserId,
          actorKey,
          new Date(operationAt + SEVEN_DAYS_MS),
          new Date(operationAt + 2 * SEVEN_DAYS_MS),
          createdAt,
          new Date(operationAt - 60_000),
          new Date(operationAt - 8 * 24 * 60 * 60_000),
        ],
      );
      await pool.query(
        `INSERT INTO ${schema}.invitation_project_assignments (
           invitation_id, project_id, assigned_at
         ) VALUES ($1, $2, $4), ($1, $3, $4)`,
        [liveInvitationId, projectAId, projectBId, createdAt],
      );

      const repository = createPostgresAdminAccessPersistenceRepository(pool, { schema });
      const scope = {
        kind: "company",
        sessionId: actorSessionId,
        sessionVersion: "1",
        userId: actorUserId,
        authorizationVersion: "1",
        includeFinancial: true,
      };
      const result = await repository.getAccessOverview(scope, operationAt);
      assert.equal(result.outcome, "accepted");
      assert.deepEqual(result.overview.people.map(({ displayName }) => displayName), [
        "FCI TEST — DO NOT USE A Administrator",
        "FCI TEST — DO NOT USE Z Project Manager",
      ]);
      const projectManager = result.overview.people.find(({ id }) => id === targetUserId);
      assert.deepEqual(projectManager.projectIds, orderedProjectIds);
      assert.equal(projectManager.lastSignedInAt, laterSignInAt.getTime());
      assert.deepEqual(result.overview.invitations.map(({ id, projectIds }) => ({ id, projectIds })), [{
        id: liveInvitationId,
        projectIds: orderedProjectIds,
      }]);
      assert.deepEqual(result.overview.projects.map(({ projectNumber }) => projectNumber), [
        "CF-2026-OVERVW01",
        "CF-2026-OVERVW02",
      ]);
      assert.deepEqual(result.overview.roles.map(({ key }) => key), [
        "administrator",
        "office_operations",
        "project_manager",
      ]);

      await pool.query(
        `UPDATE ${schema}.sessions
         SET revoked_at = $2,
             revoked_by_actor_key = 'system:integration_test',
             revocation_reason_code = 'integration_test',
             version = version + 1
         WHERE id = $1`,
        [actorSessionId, new Date(operationAt)],
      );
      assert.deepEqual(await repository.getAccessOverview(scope, operationAt + 1), {
        outcome: "actor_authorization_changed",
      });
    });
  },
);

test(
  "PostgreSQL persists the invitation and Project Manager access lifecycle with exact audit history",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 60_000,
  },
  async () => {
    await withMigratedAdminAccessSchema(async ({ pool, schema }) => {
      const administratorRoleId = await fixedRoleId(pool, schema, "administrator");
      const projectManagerRoleId = await fixedRoleId(pool, schema, "project_manager");
      const actorUserId = randomUUID();
      const actorSessionId = randomUUID();
      const targetUserId = randomUUID();
      const clientId = randomUUID();
      const projectAId = randomUUID();
      const projectBId = randomUUID();
      const expiredInvitationId = randomUUID();
      const replacementInvitationId = randomUUID();
      const operationAt = Date.now();
      const createdAt = new Date(operationAt - 60_000);
      const actorKey = `user:${actorUserId}`;
      const orderedProjectIds = [projectAId, projectBId].sort();

      await pool.query(
        `INSERT INTO ${schema}.users (
           id, email, email_key, display_name, status, authorization_version,
           sessions_valid_after, created_at, updated_at, version
         ) VALUES
           ($1, 'admin-lifecycle@cherryhillfci.com', 'admin-lifecycle@cherryhillfci.com',
            'FCI TEST — DO NOT USE Lifecycle Administrator', 'active', 1, $3, $3, $3, 1),
           ($2, 'pm-lifecycle@cherryhillfci.com', 'pm-lifecycle@cherryhillfci.com',
            'FCI TEST — DO NOT USE Lifecycle Project Manager', 'active', 1, $3, $3, $3, 1)`,
        [actorUserId, targetUserId, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.user_roles (
           user_id, role_id, assigned_by_user_id, assigned_by_actor_key,
           assigned_at, expires_at, version
         ) VALUES
           ($1, $3, NULL, 'system:integration_test', $5, NULL, 1),
           ($2, $4, $1, $6, $5, NULL, 1)`,
        [
          actorUserId,
          targetUserId,
          administratorRoleId,
          projectManagerRoleId,
          createdAt,
          actorKey,
        ],
      );
      await pool.query(
        `INSERT INTO ${schema}.sessions (
           id, user_id, token_hash, csrf_hash, authorization_version,
           rotated_from_session_id, issued_at, last_seen_at, idle_expires_at,
           absolute_expires_at, revoked_at, revoked_by_actor_key,
           revocation_reason_code, purge_after, version
         ) VALUES
           ($1, $2, $3, $4, 1, NULL, $5, $5, $6, $7, NULL, NULL, NULL, $8, 1)`,
        [
          actorSessionId,
          actorUserId,
          `sha256:${"5".repeat(64)}`,
          `sha256:${"6".repeat(64)}`,
          createdAt,
          new Date(operationAt + 15 * 60_000),
          new Date(operationAt + 8 * 60 * 60_000),
          new Date(operationAt + 9 * 60 * 60_000),
        ],
      );
      await pool.query(
        `INSERT INTO ${schema}.clients (
           id, client_code, name, normalized_name_key, status,
           created_by, updated_by, created_at, updated_at, version
         ) VALUES
           ($1, 'CL-TEST0001', 'FCI TEST — DO NOT USE Lifecycle Client',
            'fci test lifecycle client', 'active', $2, $2, $3, $3, 1)`,
        [clientId, actorKey, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.projects (
           id, project_number, client_id, name, status, created_by,
           updated_by, created_at, updated_at, version
         ) VALUES
           ($1, 'CF-2026-TESTA001', $3, 'FCI TEST — DO NOT USE Project A',
            'planning', $4, $4, $5, $5, 1),
           ($2, 'CF-2026-TESTB001', $3, 'FCI TEST — DO NOT USE Project B',
            'planning', $4, $4, $5, $5, 1)`,
        [projectAId, projectBId, clientId, actorKey, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.project_memberships (
           project_id, user_id, assigned_by_user_id, assigned_by_actor_key,
           assigned_at, expires_at, status, revoked_by_user_id,
           revoked_by_actor_key, revoked_at, revocation_reason_code, version
         ) VALUES
           ($1, $3, $4, $5, $6, NULL, 'active', NULL, NULL, NULL, NULL, 1),
           ($2, $3, $4, $5, $6, NULL, 'active', NULL, NULL, NULL, NULL, 1)`,
        [projectAId, projectBId, targetUserId, actorUserId, actorKey, createdAt],
      );

      const invitationEmail = "replacement-invite@cherryhillfci.com";
      const expiredCreatedAt = new Date(operationAt - 8 * 24 * 60 * 60_000);
      const expiredAt = new Date(operationAt - 24 * 60 * 60_000);
      await pool.query(
        `INSERT INTO ${schema}.invitations (
           id, email, email_key, token_hash, role_id, status,
           invited_by_user_id, invited_by_actor_key, expires_at, purge_after,
           created_at, updated_at, version
         ) VALUES
           ($1, $2, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $9, 1)`,
        [
          expiredInvitationId,
          invitationEmail,
          `sha256:${"7".repeat(64)}`,
          projectManagerRoleId,
          actorUserId,
          actorKey,
          expiredAt,
          new Date(operationAt + 14 * 24 * 60 * 60_000),
          expiredCreatedAt,
        ],
      );
      await pool.query(
        `INSERT INTO ${schema}.invitation_project_assignments (
           invitation_id, project_id, assigned_at
         ) VALUES ($1, $2, $3)`,
        [expiredInvitationId, projectAId, expiredCreatedAt],
      );
      const expiredBeforeReplacement = await pool.query(
        `SELECT status, token_hash IS NOT NULL AS has_token, version::text AS version
         FROM ${schema}.invitations WHERE id = $1`,
        [expiredInvitationId],
      );
      assert.deepEqual(expiredBeforeReplacement.rows, [
        { status: "pending", has_token: true, version: "1" },
      ]);

      const repository = createPostgresAdminAccessPersistenceRepository(pool, { schema });
      const invitationCreateAuditId = randomUUID();
      const invitationRevokeAuditId = randomUUID();
      const firstAccessAuditId = randomUUID();
      const secondAccessAuditId = randomUUID();
      const replacementTokenHash = `sha256:${"8".repeat(64)}`;
      assert.deepEqual(await repository.createInvitation({
        id: replacementInvitationId,
        email: invitationEmail,
        tokenHash: replacementTokenHash,
        role: "project_manager",
        projectIds: orderedProjectIds,
        invitedByUserId: actorUserId,
        invitedByActorKey: actorKey,
        actorSessionId,
        actorSessionVersion: "1",
        actorAuthorizationVersion: "1",
        createdAt: operationAt,
        expiresAt: operationAt + SEVEN_DAYS_MS,
        purgeAfter: operationAt + 2 * SEVEN_DAYS_MS,
        audit: integrationAudit(
          invitationCreateAuditId,
          actorUserId,
          replacementInvitationId,
          operationAt,
        ),
      }), {
        outcome: "accepted",
        version: "1",
        authorizationVersion: null,
      });

      const invitationsAfterReplacement = await pool.query(
        `SELECT id::text AS id, status, token_hash, version::text AS version
         FROM ${schema}.invitations
         WHERE id = ANY($1::uuid[])`,
        [[expiredInvitationId, replacementInvitationId]],
      );
      const invitationById = new Map(invitationsAfterReplacement.rows.map((row) => [row.id, row]));
      assert.deepEqual(invitationById.get(expiredInvitationId), {
        id: expiredInvitationId,
        status: "expired",
        token_hash: null,
        version: "2",
      });
      assert.deepEqual(invitationById.get(replacementInvitationId), {
        id: replacementInvitationId,
        status: "pending",
        token_hash: replacementTokenHash,
        version: "1",
      });
      const invitationAssignments = await pool.query(
        `SELECT invitation_id::text AS invitation_id, project_id::text AS project_id
         FROM ${schema}.invitation_project_assignments
         WHERE invitation_id = ANY($1::uuid[])
         ORDER BY invitation_id, project_id`,
        [[expiredInvitationId, replacementInvitationId]],
      );
      const assignmentMap = Map.groupBy(
        invitationAssignments.rows,
        ({ invitation_id }) => invitation_id,
      );
      assert.deepEqual(
        assignmentMap.get(expiredInvitationId).map(({ project_id }) => project_id),
        [projectAId],
      );
      assert.deepEqual(
        assignmentMap.get(replacementInvitationId).map(({ project_id }) => project_id),
        orderedProjectIds,
      );

      assert.deepEqual(await repository.revokeInvitation({
        invitationId: replacementInvitationId,
        expectedVersion: "1",
        actorUserId,
        actorKey,
        actorSessionId,
        actorSessionVersion: "1",
        actorAuthorizationVersion: "1",
        reasonCode: "lifecycle_test",
        changedAt: operationAt + 1,
        audit: integrationAudit(
          invitationRevokeAuditId,
          actorUserId,
          replacementInvitationId,
          operationAt + 1,
        ),
      }), {
        outcome: "accepted",
        version: "2",
        authorizationVersion: null,
      });
      const revokedInvitation = await pool.query(
        `SELECT status, token_hash, revoked_by_user_id::text AS revoked_by_user_id,
                version::text AS version
         FROM ${schema}.invitations WHERE id = $1`,
        [replacementInvitationId],
      );
      assert.deepEqual(revokedInvitation.rows, [{
        status: "revoked",
        token_hash: null,
        revoked_by_user_id: actorUserId,
        version: "2",
      }]);

      const accessIntent = (auditId, expectedVersion, projectIds, changedAt) => ({
        userId: targetUserId,
        expectedVersion,
        role: "project_manager",
        projectIds,
        actorUserId,
        actorKey,
        actorSessionId,
        actorSessionVersion: "1",
        actorAuthorizationVersion: "1",
        reasonCode: "lifecycle_test",
        changedAt,
        audit: integrationAudit(auditId, actorUserId, targetUserId, changedAt),
      });
      assert.deepEqual(await repository.setUserAccess(accessIntent(
        firstAccessAuditId,
        "1",
        [projectBId],
        operationAt + 2,
      )), {
        outcome: "accepted",
        version: "2",
        authorizationVersion: "2",
      });
      const narrowedMemberships = await pool.query(
        `SELECT project_id::text AS project_id, status,
                revoked_by_user_id::text AS revoked_by_user_id,
                revoked_by_actor_key, revocation_reason_code,
                version::text AS version
         FROM ${schema}.project_memberships
         WHERE user_id = $1
         ORDER BY project_id`,
        [targetUserId],
      );
      const narrowedByProject = new Map(
        narrowedMemberships.rows.map((row) => [row.project_id, row]),
      );
      assert.deepEqual(narrowedByProject.get(projectAId), {
        project_id: projectAId,
        status: "revoked",
        revoked_by_user_id: actorUserId,
        revoked_by_actor_key: actorKey,
        revocation_reason_code: "lifecycle_test",
        version: "2",
      });
      assert.deepEqual(narrowedByProject.get(projectBId), {
        project_id: projectBId,
        status: "active",
        revoked_by_user_id: null,
        revoked_by_actor_key: null,
        revocation_reason_code: null,
        version: "2",
      });

      assert.deepEqual(await repository.setUserAccess(accessIntent(
        secondAccessAuditId,
        "2",
        orderedProjectIds,
        operationAt + 3,
      )), {
        outcome: "accepted",
        version: "3",
        authorizationVersion: "3",
      });
      const restoredMemberships = await pool.query(
        `SELECT project_id::text AS project_id, status,
                revoked_by_user_id::text AS revoked_by_user_id,
                revoked_by_actor_key, revoked_at, revocation_reason_code,
                version::text AS version
         FROM ${schema}.project_memberships
         WHERE user_id = $1
         ORDER BY project_id`,
        [targetUserId],
      );
      assert.deepEqual(restoredMemberships.rows.map((row) => ({
        ...row,
        revoked_at: row.revoked_at === null ? null : row.revoked_at,
      })), orderedProjectIds.map((project_id) => ({
        project_id,
        status: "active",
        revoked_by_user_id: null,
        revoked_by_actor_key: null,
        revoked_at: null,
        revocation_reason_code: null,
        version: "3",
      })));
      const finalAccess = await pool.query(
        `SELECT employee.version::text AS user_version,
                employee.authorization_version::text AS authorization_version,
                assignment.version::text AS role_version,
                assigned_role.role_key
         FROM ${schema}.users AS employee
         JOIN ${schema}.user_roles AS assignment ON assignment.user_id = employee.id
         JOIN ${schema}.roles AS assigned_role ON assigned_role.id = assignment.role_id
         WHERE employee.id = $1`,
        [targetUserId],
      );
      assert.deepEqual(finalAccess.rows, [{
        user_version: "3",
        authorization_version: "3",
        role_version: "3",
        role_key: "project_manager",
      }]);

      const auditRows = await pool.query(
        `SELECT id::text AS id, action, target_type, target_id, result, reason_code, metadata
         FROM ${schema}.audit_events
         WHERE id = ANY($1::uuid[])`,
        [[
          invitationCreateAuditId,
          invitationRevokeAuditId,
          firstAccessAuditId,
          secondAccessAuditId,
        ]],
      );
      const auditById = new Map(auditRows.rows.map((row) => [row.id, row]));
      assert.deepEqual(auditById.get(invitationCreateAuditId), {
        id: invitationCreateAuditId,
        action: "identity.invitation_created",
        target_type: "invitation",
        target_id: replacementInvitationId,
        result: "succeeded",
        reason_code: null,
        metadata: { fixture: "FCI TEST — DO NOT USE" },
      });
      assert.deepEqual(auditById.get(invitationRevokeAuditId), {
        id: invitationRevokeAuditId,
        action: "identity.invitation_revoked",
        target_type: "invitation",
        target_id: replacementInvitationId,
        result: "succeeded",
        reason_code: "lifecycle_test",
        metadata: { fixture: "FCI TEST — DO NOT USE" },
      });
      assert.deepEqual(auditById.get(firstAccessAuditId), {
        id: firstAccessAuditId,
        action: "authorization.user_access_changed",
        target_type: "user",
        target_id: targetUserId,
        result: "succeeded",
        reason_code: "lifecycle_test",
        metadata: {
          fixture: "FCI TEST — DO NOT USE",
          previous_role: "project_manager",
          previous_project_ids: orderedProjectIds,
          new_role: "project_manager",
          new_project_ids: [projectBId],
        },
      });
      assert.deepEqual(auditById.get(secondAccessAuditId), {
        id: secondAccessAuditId,
        action: "authorization.user_access_changed",
        target_type: "user",
        target_id: targetUserId,
        result: "succeeded",
        reason_code: "lifecycle_test",
        metadata: {
          fixture: "FCI TEST — DO NOT USE",
          previous_role: "project_manager",
          previous_project_ids: [projectBId],
          new_role: "project_manager",
          new_project_ids: orderedProjectIds,
        },
      });
    });
  },
);
