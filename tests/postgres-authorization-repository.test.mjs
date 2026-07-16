import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/postgres-authorization",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24691 } },
});
const { createPostgresAuthorizationRepository } = await vite.ssrLoadModule(
  "/app/adapters/postgres/authorization-repository.ts",
);

after(async () => {
  await vite.close();
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const SECOND_CLIENT_ID = "66666666-6666-4666-8666-666666666666";
const TOKEN_HASH = `sha256:${"a".repeat(64)}`;
const CSRF_HASH = `sha256:${"b".repeat(64)}`;
const NOW = Date.UTC(2026, 6, 15, 14, 30, 0);

const ASSIGNED_SCOPE = Object.freeze({
  kind: "assigned_projects",
  sessionId: SESSION_ID,
  sessionVersion: "4",
  userId: USER_ID,
  authorizationVersion: "7",
  includeFinancial: false,
});

const COMPANY_FINANCIAL_SCOPE = Object.freeze({
  kind: "company",
  sessionId: SESSION_ID,
  sessionVersion: "4",
  userId: USER_ID,
  authorizationVersion: "7",
  includeFinancial: true,
});

function result(rows = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function step(match, response = result(), inspect) {
  return { match, response, inspect };
}

function transactionSetupSteps() {
  return [
    step(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/),
    step(/^SET LOCAL lock_timeout = '5000ms'$/),
    step(/^SET LOCAL statement_timeout = '30000ms'$/),
    step(
      /SELECT pg_catalog\.set_config\('search_path', \$1, true\)/,
      result([{ set_config: "authorization_test, pg_catalog, pg_temp" }], 1),
      ({ values }) => assert.deepEqual(values, ["authorization_test, pg_catalog, pg_temp"]),
    ),
    step(
      /SELECT pg_catalog\.current_schema\(\) AS current_schema/,
      result([{ current_schema: "authorization_test" }], 1),
    ),
  ];
}

class ScriptedPostgresClient {
  constructor(steps) {
    this.steps = [...steps];
    this.queries = [];
    this.releaseCalls = [];
  }

  async query(sql, values = []) {
    const query = { sql: sql.trim(), values: [...values] };
    this.queries.push(query);
    const expected = this.steps.shift();
    assert.ok(expected, `unexpected PostgreSQL query: ${query.sql}`);
    if (typeof expected.match === "string") assert.equal(query.sql, expected.match);
    else assert.match(query.sql, expected.match);
    expected.inspect?.(query);
    return expected.response;
  }

  release(error) {
    this.releaseCalls.push(error);
  }

  assertComplete() {
    assert.deepEqual(this.steps, []);
    assert.deepEqual(this.releaseCalls, [undefined]);
  }
}

class ScriptedPostgresPool {
  constructor(client) {
    this.client = client;
    this.connectCount = 0;
  }

  async connect() {
    this.connectCount += 1;
    return this.client;
  }
}

function repositoryFor(steps) {
  const client = new ScriptedPostgresClient(steps);
  const pool = new ScriptedPostgresPool(client);
  return {
    client,
    pool,
    repository: createPostgresAuthorizationRepository(pool, {
      schema: "authorization_test",
    }),
  };
}

function assertActiveScopeSql(sql, projectAlias = "project") {
  assert.match(sql, /authorization_session\.id = \$5/);
  assert.match(sql, /authorization_session\.version = \$6::bigint/);
  assert.match(sql, /authorization_session\.user_id = \$1/);
  assert.match(sql, /authorization_session\.authorization_version = \$2::bigint/);
  assert.match(sql, /authorization_session\.token_hash IS NOT NULL/);
  assert.match(sql, /authorization_session\.revoked_at IS NULL/);
  assert.match(sql, /authorization_session\.issued_at >= authorization_user\.sessions_valid_after/);
  assert.match(sql, /authorization_session\.idle_expires_at > \$4/);
  assert.match(sql, /authorization_session\.absolute_expires_at > \$4/);
  assert.match(sql, /authorization_user\.status = 'active'/);
  assert.match(sql, /authorization_user\.authorization_version = \$2::bigint/);
  assert.match(sql, /scope_role\.role_key IN \('administrator', 'office_operations'\)/);
  assert.match(sql, /scope_role\.role_key = 'project_manager'/);
  assert.match(sql, /scope_capability\.capability_key = 'records\.read'/);
  assert.match(sql, new RegExp(`membership\\.project_id = ${projectAlias}\\.id`));
  assert.match(sql, /membership\.user_id = \$1/);
  assert.match(sql, /membership\.status = 'active'/);
  assert.doesNotMatch(sql, /membership\.expires_at/);
}

function assertFinancialAuthorizationSql(sql) {
  assert.match(sql, /financial_role\.role_key = 'administrator'/);
  assert.match(sql, /financial_capability\.capability_key = 'financials\.read'/);
  assert.doesNotMatch(sql, /financial_user_role\.expires_at/);
}

function assertScopeBefore(sql, laterPattern) {
  const activeIndex = sql.indexOf("authorization_user.status = 'active'");
  const membershipIndex = sql.indexOf("FROM project_memberships AS membership");
  const laterIndex = sql.search(laterPattern);
  assert.ok(activeIndex >= 0, "active-user recheck must be present");
  assert.ok(membershipIndex > activeIndex, "membership must be part of the SQL predicate");
  assert.ok(laterIndex > membershipIndex, "scope must be applied before ranking or aggregation");
}

function projectRow(overrides = {}) {
  return {
    id: PROJECT_ID,
    project_number: "FCI-TEST-1001",
    client_id: CLIENT_ID,
    client_name: "FCI TEST — DO NOT USE Client",
    name: "FCI TEST — DO NOT USE Project",
    status: "installation",
    site: "123 Test Street",
    project_manager: "manager@cherryhillfci.com",
    estimated_value: "125000",
    updated_at: new Date(NOW - 1_000),
    version: "3",
    ...overrides,
  };
}

test("session resolution loads the user plus only active, unexpired role capabilities", async () => {
  const sessionRow = {
    session_id: SESSION_ID,
    session_version: "4",
    session_authorization_version: "7",
    issued_at: new Date(NOW - 60_000),
    last_seen_at: new Date(NOW - 10_000),
    idle_expires_at: new Date(NOW + 30 * 60_000),
    absolute_expires_at: new Date(NOW + 8 * 60 * 60_000),
    revoked_at: null,
    user_id: USER_ID,
    email: "admincrm@cherryhillfci.com",
    user_status: "active",
    user_authorization_version: "7",
    sessions_valid_after: new Date(NOW - 120_000),
  };
  const { client, pool, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /FROM sessions AS session\s+JOIN users AS authorization_user/,
      result([sessionRow], 1),
      ({ sql, values }) => {
        assert.match(sql, /WHERE session\.token_hash = \$1/);
        assert.deepEqual(values, [TOKEN_HASH]);
        assert.equal(sql.includes("raw-session"), false);
      },
    ),
    step(
      /FROM user_roles AS user_role/,
      result([
        { role_key: "administrator", capability_key: "records.read" },
        { role_key: "administrator", capability_key: "financials.read" },
        { role_key: "administrator", capability_key: null },
      ], 3),
      ({ sql, values }) => {
        assert.match(sql, /role\.status = 'active'/);
        assert.match(sql, /capability\.status = 'active'/);
        assert.doesNotMatch(sql, /user_role\.expires_at/);
        assert.deepEqual(values, [USER_ID]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.deepEqual(await repository.findSessionByTokenHash(TOKEN_HASH, NOW), {
    sessionId: SESSION_ID,
    sessionVersion: "4",
    userId: USER_ID,
    email: "admincrm@cherryhillfci.com",
    userStatus: "active",
    userAuthorizationVersion: "7",
    sessionAuthorizationVersion: "7",
    sessionsValidAfter: NOW - 120_000,
    issuedAt: NOW - 60_000,
    lastSeenAt: NOW - 10_000,
    idleExpiresAt: NOW + 30 * 60_000,
    absoluteExpiresAt: NOW + 8 * 60 * 60_000,
    revokedAt: null,
    roleGrants: [{
      roleKey: "administrator",
      capabilityKeys: ["financials.read", "records.read"],
    }],
  });
  assert.equal(pool.connectCount, 1);
  assert.equal(client.queries.filter(({ sql }) => sql.includes("FROM sessions AS session")).length, 1);
  client.assertComplete();
});

test("CSRF resolution requires the exact active session and matching hashed secret", async () => {
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /SELECT EXISTS \(/,
      result([{ allowed: true }], 1),
      ({ sql, values }) => {
        assert.match(sql, /session\.token_hash = \$1/);
        assert.match(sql, /session\.csrf_hash = \$2/);
        assert.match(sql, /session\.revoked_at IS NULL/);
        assert.match(sql, /session\.issued_at >= authorization_user\.sessions_valid_after/);
        assert.match(sql, /session\.idle_expires_at > \$3/);
        assert.match(sql, /session\.absolute_expires_at > \$3/);
        assert.match(sql, /authorization_user\.status = 'active'/);
        assert.match(
          sql,
          /authorization_user\.authorization_version = session\.authorization_version/,
        );
        assert.deepEqual(values, [TOKEN_HASH, CSRF_HASH, new Date(NOW)]);
        assert.equal(sql.includes("raw-csrf-secret"), false);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.equal(
    await repository.sessionCsrfHashMatches(TOKEN_HASH, CSRF_HASH, NOW),
    true,
  );
  client.assertComplete();
});

test("project-scope existence check rechecks active user/version and exact membership in SQL", async () => {
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /SELECT EXISTS \(/,
      result([{ allowed: true }], 1),
      ({ sql, values }) => {
        assert.match(sql, /project\.id = \$7/);
        assertActiveScopeSql(sql);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          false,
          new Date(NOW),
          SESSION_ID,
          "4",
          PROJECT_ID,
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.equal(await repository.projectExistsForScope(ASSIGNED_SCOPE, PROJECT_ID, NOW), true);
  client.assertComplete();
});

test("exact-project query scopes the requested ID in SQL and returns a nonfinancial projection", async () => {
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /FROM projects AS project\s+JOIN clients AS client/,
      result([projectRow()], 1),
      ({ sql, values }) => {
        assert.match(sql, /WHERE project\.id = \$7/);
        assertActiveScopeSql(sql);
        assert.doesNotMatch(sql, /project\.estimated_value/);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          false,
          new Date(NOW),
          SESSION_ID,
          "4",
          PROJECT_ID,
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.deepEqual(await repository.getProjectForScope(ASSIGNED_SCOPE, PROJECT_ID, NOW), {
    id: PROJECT_ID,
    projectNumber: "FCI-TEST-1001",
    clientId: CLIENT_ID,
    clientName: "FCI TEST — DO NOT USE Client",
    name: "FCI TEST — DO NOT USE Project",
    status: "installation",
    site: "123 Test Street",
    projectManagerId: "manager@cherryhillfci.com",
    updatedAt: NOW - 1_000,
    version: "3",
    financialVisible: false,
  });
  client.assertComplete();
});

test("current capability recheck binds the live session, same role, and exact assigned project", async () => {
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /SELECT EXISTS \(/,
      result([{ allowed: true }], 1),
      ({ sql, values }) => {
        assert.match(sql, /FROM user_roles AS current_user_role/);
        assert.match(sql, /roles AS effective_role/);
        assert.match(sql, /effective_role\.role_key IN \('administrator', 'office_operations'\)/);
        assert.match(sql, /effective_role\.role_key = 'project_manager'/);
        assert.match(sql, /current_record_capability\.capability_key = 'records\.read'/);
        assert.match(sql, /current_capability\.capability_key = \$7/);
        assert.match(sql, /NOT \$3::boolean/);
        assert.match(sql, /\$8::uuid IS NULL/);
        assert.match(sql, /FROM project_memberships AS current_membership/);
        assert.match(sql, /current_membership\.user_id = \$1/);
        assert.match(sql, /current_membership\.project_id = \$8::uuid/);
        assert.match(sql, /current_membership\.status = 'active'/);
        assert.doesNotMatch(sql, /current_membership\.expires_at/);
        assert.doesNotMatch(sql, /current_user_role\.expires_at/);
        assert.match(sql, /authorization_session\.id = \$5/);
        assert.match(sql, /authorization_session\.version = \$6::bigint/);
        assert.match(sql, /authorization_session\.token_hash IS NOT NULL/);
        assert.match(sql, /authorization_session\.revoked_at IS NULL/);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          false,
          new Date(NOW),
          SESSION_ID,
          "4",
          "files.read",
          PROJECT_ID,
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.equal(
    await repository.capabilityIsCurrentForScope(
      ASSIGNED_SCOPE,
      "files.read",
      PROJECT_ID,
      NOW,
    ),
    true,
  );
  client.assertComplete();
});

test("assigned-project list scopes in SQL before ordering and limiting and never projects financials", async () => {
  const sentinelRow = projectRow({
    id: SECOND_PROJECT_ID,
    project_number: "SENTINEL-NOT-POST-FILTERED",
    client_id: SECOND_CLIENT_ID,
    client_name: "Sentinel Client",
    name: "Sentinel Project",
    estimated_value: "999999",
  });
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /FROM projects AS project\s+JOIN clients AS client/,
      result([projectRow(), sentinelRow], 2),
      ({ sql, values }) => {
        assertActiveScopeSql(sql);
        assertScopeBefore(sql, /ORDER BY/);
        assert.ok(sql.indexOf("ORDER BY") < sql.indexOf("LIMIT $7"));
        assert.doesNotMatch(sql, /project\.estimated_value/);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          false,
          new Date(NOW),
          SESSION_ID,
          "4",
          25,
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  const projects = await repository.listProjectsForScope(ASSIGNED_SCOPE, NOW, 25);
  assert.equal(projects.length, 2);
  assert.equal(projects[1].projectNumber, "SENTINEL-NOT-POST-FILTERED");
  assert.deepEqual(projects.map(({ financialVisible }) => financialVisible), [false, false]);
  assert.equal(projects.some((project) => "estimatedValue" in project), false);
  client.assertComplete();
});

test("assigned-project search performs membership and search filtering before ordering and limiting", async () => {
  const sentinelRow = projectRow({
    id: SECOND_PROJECT_ID,
    project_number: "SENTINEL-NO-JS-SEARCH-FILTER",
    name: "No matching phrase",
  });
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /pg_catalog\.strpos\(pg_catalog\.lower\(project\.project_number\), \$7\) > 0/,
      result([sentinelRow], 1),
      ({ sql, values }) => {
        assertActiveScopeSql(sql);
        assert.match(sql, /pg_catalog\.lower\(project\.name\), \$7/);
        assert.match(sql, /pg_catalog\.lower\(client\.name\), \$7/);
        assertScopeBefore(sql, /AND \(\s*pg_catalog\.strpos/);
        assert.ok(sql.search(/AND \(\s*pg_catalog\.strpos/) < sql.indexOf("ORDER BY"));
        assert.ok(sql.indexOf("ORDER BY") < sql.indexOf("LIMIT $8"));
        assert.doesNotMatch(sql, /project\.estimated_value/);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          false,
          new Date(NOW),
          SESSION_ID,
          "4",
          "cedar",
          10,
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  const projects = await repository.searchProjectsForScope(ASSIGNED_SCOPE, "Cedar", NOW, 10);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectNumber, "SENTINEL-NO-JS-SEARCH-FILTER");
  client.assertComplete();
});

test("assigned client list derives client visibility from active project membership inside SQL", async () => {
  const clientRow = {
    id: CLIENT_ID,
    client_code: "FCI-TEST-C001",
    name: "FCI TEST — DO NOT USE Client",
    status: "active",
    contact_name: "Test Contact",
    contact_email: "test@example.com",
    contact_phone: null,
  };
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /FROM clients AS client/,
      result([clientRow], 1),
      ({ sql, values }) => {
        assert.match(sql, /authorization_user\.status = 'active'/);
        assert.match(sql, /authorization_user\.authorization_version = \$2::bigint/);
        assert.match(sql, /authorization_session\.id = \$5/);
        assert.match(sql, /authorization_session\.version = \$6::bigint/);
        assert.match(sql, /authorization_session\.token_hash IS NOT NULL/);
        assert.match(sql, /authorization_session\.revoked_at IS NULL/);
        assert.match(sql, /scope_role\.role_key = 'project_manager'/);
        assert.match(sql, /scope_capability\.capability_key = 'records\.read'/);
        assert.match(sql, /JOIN project_memberships AS membership/);
        assert.match(sql, /membership\.project_id = project\.id/);
        assert.match(sql, /membership\.user_id = \$1/);
        assert.match(sql, /project\.client_id = client\.id/);
        assert.ok(
          sql.indexOf("JOIN project_memberships AS membership")
            < sql.indexOf("ORDER BY client.name"),
          "client visibility must be scoped through project membership before ordering",
        );
        assert.deepEqual(values, [
          USER_ID,
          "7",
          false,
          new Date(NOW),
          SESSION_ID,
          "4",
          30,
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.deepEqual(await repository.listClientsForScope(ASSIGNED_SCOPE, NOW, 30), [{
    id: CLIENT_ID,
    clientCode: "FCI-TEST-C001",
    name: "FCI TEST — DO NOT USE Client",
    status: "active",
    primaryContact: {
      name: "Test Contact",
      email: "test@example.com",
      phone: null,
    },
  }]);
  client.assertComplete();
});

test("dashboard aggregates only after assigned-project scoping and omits all financial projection", async () => {
  const { client, repository } = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /SELECT pg_catalog\.count\(\*\)::text AS project_count/,
      result([{
        project_count: "5",
        active_project_count: "3",
        completed_project_count: "2",
        estimated_value_total: "999999",
      }], 1),
      ({ sql, values }) => {
        assertActiveScopeSql(sql);
        assert.match(sql, /project\.status NOT IN \('completed', 'cancelled', 'archived'\)/);
        assert.match(sql, /project\.status = 'completed'/);
        assert.doesNotMatch(sql, /estimated_value/);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          false,
          new Date(NOW),
          SESSION_ID,
          "4",
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.deepEqual(await repository.getDashboardForScope(ASSIGNED_SCOPE, NOW), {
    projectCount: 5,
    activeProjectCount: 3,
    completedProjectCount: 2,
    financialVisible: false,
  });
  client.assertComplete();
});

test("company financial scope is explicit in both project and dashboard SQL projections", async () => {
  const projectRepository = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /FROM projects AS project\s+JOIN clients AS client/,
      result([projectRow()], 1),
      ({ sql, values }) => {
        assertActiveScopeSql(sql);
        assert.match(sql, /project\.estimated_value::text AS estimated_value/);
        assertFinancialAuthorizationSql(sql);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          true,
          new Date(NOW),
          SESSION_ID,
          "4",
          20,
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  const projects = await projectRepository.repository.listProjectsForScope(
    COMPANY_FINANCIAL_SCOPE,
    NOW,
    20,
  );
  assert.equal(projects[0].financialVisible, true);
  assert.equal(projects[0].estimatedValue, 125000);
  projectRepository.client.assertComplete();

  const dashboardRepository = repositoryFor([
    ...transactionSetupSteps(),
    step(
      /SELECT pg_catalog\.count\(\*\)::text AS project_count/,
      result([{
        project_count: "8",
        active_project_count: "6",
        completed_project_count: "2",
        estimated_value_total: "450000",
      }], 1),
      ({ sql, values }) => {
        assertActiveScopeSql(sql);
        assert.match(
          sql,
          /COALESCE\(pg_catalog\.sum\(project\.estimated_value\), 0::numeric\)::text AS estimated_value_total/,
        );
        assertFinancialAuthorizationSql(sql);
        assert.deepEqual(values, [
          USER_ID,
          "7",
          true,
          new Date(NOW),
          SESSION_ID,
          "4",
        ]);
      },
    ),
    step(/^COMMIT$/),
  ]);

  assert.deepEqual(
    await dashboardRepository.repository.getDashboardForScope(COMPANY_FINANCIAL_SCOPE, NOW),
    {
      projectCount: 8,
      activeProjectCount: 6,
      completedProjectCount: 2,
      financialVisible: true,
      estimatedValueTotal: 450000,
    },
  );
  dashboardRepository.client.assertComplete();
});
