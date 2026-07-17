import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import {
  ADMIN_ACCESS_ROLE_CATALOG,
} from "../app/platform/postgres/admin-access-persistence-schema.ts";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/admin-audit-reader",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24695 } },
});
const { createPostgresAdminAuditReader } = await vite.ssrLoadModule(
  "/app/adapters/postgres/admin-audit-reader-repository.ts",
);

after(async () => {
  await vite.close();
});

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_A = "33333333-3333-4333-8333-333333333333";
const EVENT_B = "44444444-4444-4444-8444-444444444444";
const EVENT_C = "55555555-5555-4555-8555-555555555555";
const NOW = Date.UTC(2026, 6, 16, 16, 0, 0);

function auditCursorKey(eventId) {
  return createHash("sha256").update(eventId, "utf8").digest("hex");
}

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function scope(overrides = {}) {
  return {
    kind: "company",
    sessionId: SESSION_ID,
    sessionVersion: "1",
    userId: ADMIN_ID,
    authorizationVersion: "1",
    includeFinancial: true,
    ...overrides,
  };
}

function query(overrides = {}) {
  return {
    from: null,
    before: null,
    result: null,
    category: null,
    cursor: null,
    limit: 2,
    ...overrides,
  };
}

function activityRow(overrides = {}) {
  return {
    cursor_key: auditCursorKey(EVENT_A),
    actor_label: "FCI TEST — DO NOT USE Administrator (admincrm@cherryhillfci.com)",
    action: "authorization.access_denied",
    target_label: "Security activity",
    result: "denied",
    reason_code: "idle_expired",
    administrator_reason: null,
    occurred_at: new Date(NOW - 1_000),
    ...overrides,
  };
}

function fakeDatabase(rows, { actorAuthorized = true } = {}) {
  const queries = [];
  const releases = [];
  let currentSchema = "public";
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values: [...values] });
      if (
        normalized.startsWith("BEGIN")
        || normalized === "COMMIT"
        || normalized === "ROLLBACK"
        || normalized.startsWith("SET LOCAL")
      ) return result();
      if (normalized.includes("set_config('search_path'")) {
        currentSchema = String(values[0]).split(",", 1)[0];
        return result([], 1);
      }
      if (normalized.includes("current_schema()")) {
        return result([{ current_schema: currentSchema }], 1);
      }
      if (normalized.startsWith("SELECT actor_session.id")) {
        return actorAuthorized ? result([{ id: SESSION_ID }], 1) : result([], 0);
      }
      if (normalized.startsWith("SELECT activity.cursor_key")) {
        return result(rows, rows.length);
      }
      assert.fail(`unexpected query: ${normalized}`);
    },
    release(error) {
      releases.push(error);
    },
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    releases,
  };
}

test("returns a minimized bounded page with friendly labels and an internal keyset", async () => {
  const rows = [
    activityRow(),
    activityRow({
      cursor_key: auditCursorKey(EVENT_B),
      action: "identity.user_disabled",
      target_label: "FCI TEST — DO NOT USE Office",
      result: "succeeded",
      reason_code: "administrator_request",
      administrator_reason: "Employment ended",
      occurred_at: new Date(NOW - 2_000),
    }),
    activityRow({ cursor_key: auditCursorKey(EVENT_C), occurred_at: new Date(NOW - 3_000) }),
  ];
  const fake = fakeDatabase(rows);
  const reader = createPostgresAdminAuditReader(fake.pool, { schema: "fci_app" });

  const read = await reader.listActivity(scope(), query({
    from: NOW - 86_400_000,
    before: NOW,
    result: "denied",
    category: "access",
  }), NOW);

  assert.equal(read.outcome, "accepted");
  assert.deepEqual(read.page.events, [
    {
      actorLabel: "FCI TEST — DO NOT USE Administrator (admincrm@cherryhillfci.com)",
      actionLabel: "Access denied",
      targetLabel: "Security activity",
      result: "denied",
      reason: "Session expired after inactivity",
      occurredAt: NOW - 1_000,
    },
    {
      actorLabel: "FCI TEST — DO NOT USE Administrator (admincrm@cherryhillfci.com)",
      actionLabel: "Access disabled",
      targetLabel: "FCI TEST — DO NOT USE Office",
      result: "succeeded",
      reason: "Employment ended",
      occurredAt: NOW - 2_000,
    },
  ]);
  assert.deepEqual(read.page.next, {
    occurredAt: NOW - 2_000,
    cursorKey: auditCursorKey(EVENT_B),
  });
  assert.equal(read.page.generatedAt, NOW);
  assert.doesNotMatch(JSON.stringify(read.page.events), /event_id|metadata|request|correlation|33333333/i);

  const fence = fake.queries.find(({ sql }) => sql.startsWith("SELECT actor_session.id"));
  assert.match(fence.sql, /capability_key = \$5[\s\S]*FOR SHARE OF actor_session, actor_user/);
  assert.equal(fence.values[4], "audit.read");
  const projection = fake.queries.find(({ sql }) => sql.startsWith("SELECT activity.cursor_key"));
  assert.match(projection.sql, /FROM audit_activity_projection/);
  assert.match(projection.sql, /activity\.action LIKE 'authorization\.%'/);
  assert.doesNotMatch(projection.sql, /activity\.metadata|request_id|correlation_id/);
  assert.deepEqual(projection.values, [
    new Date(NOW - 86_400_000),
    new Date(NOW),
    "denied",
    null,
    null,
    3,
  ]);
  assert.deepEqual(fake.releases, [undefined]);
});

test("denies after the exact Administrator session fence changes and never reads the view", async () => {
  const fake = fakeDatabase([], { actorAuthorized: false });
  const reader = createPostgresAdminAuditReader(fake.pool, { schema: "fci_app" });
  assert.deepEqual(
    await reader.listActivity(scope(), query(), NOW),
    { outcome: "actor_authorization_changed" },
  );
  assert.equal(
    fake.queries.some(({ sql }) => sql.includes("audit_activity_projection")),
    false,
  );
});

test("validates scope, filters, cursors, and every projected cursor key before returning", async () => {
  const noConnection = { async connect() { assert.fail("database should not be borrowed"); } };
  const reader = createPostgresAdminAuditReader(noConnection);
  const invalid = [
    [scope({ kind: "assigned_projects" }), query(), /company Administrator scope/],
    [scope(), query({ limit: 51 }), /page limit/],
    [scope(), query({ from: NOW, before: NOW }), /earlier than before/],
    [scope(), query({ result: "unknown" }), /result filter/],
    [scope(), query({ category: "unknown" }), /category filter/],
    [scope(), query({ cursor: { occurredAt: NOW, cursorKey: "not-a-hash" } }), /cursor key/],
  ];
  for (const [readerScope, readerQuery, pattern] of invalid) {
    await assert.rejects(reader.listActivity(readerScope, readerQuery, NOW), pattern);
  }

  const malformed = fakeDatabase([activityRow({ cursor_key: "not-a-hash" })]);
  await assert.rejects(
    createPostgresAdminAuditReader(malformed.pool).listActivity(scope(), query(), NOW),
    /Audit row cursor key/,
  );
});

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();

test(
  "real PostgreSQL preserves equal-time keyset order, filters, redaction, and live-session denial",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 60_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 4 });
    const schema = `fci_admin_audit_${randomUUID().replaceAll("-", "")}`;
    let schemaCreated = false;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema });

      const adminId = randomUUID();
      const sessionId = randomUUID();
      const checkedAt = Date.now();
      const createdAt = new Date(checkedAt - 86_400_000);
      await pool.query(
        `INSERT INTO ${schema}.users (
           id, email, email_key, display_name, status, authorization_version,
           sessions_valid_after, created_at, updated_at
         ) VALUES ($1, 'admincrm@cherryhillfci.com', 'admincrm@cherryhillfci.com',
           'FCI TEST — DO NOT USE Administrator', 'active', 1, $2, $2, $3)`,
        [adminId, createdAt, new Date(checkedAt)],
      );
      await pool.query(
        `INSERT INTO ${schema}.user_roles (
           user_id, role_id, assigned_by_user_id, assigned_by_actor_key, assigned_at
         ) VALUES ($1, $2, $1, 'user:audit-integration-admin', $3)`,
        [adminId, ADMIN_ACCESS_ROLE_CATALOG[0].id, createdAt],
      );
      await pool.query(
        `INSERT INTO ${schema}.sessions (
           id, user_id, token_hash, csrf_hash, authorization_version,
           issued_at, last_seen_at, idle_expires_at, absolute_expires_at, purge_after
         ) VALUES ($1, $2, $3, $4, 1, $5, $5, $6, $7, $8)`,
        [
          sessionId,
          adminId,
          `sha256:${"a".repeat(64)}`,
          `sha256:${"b".repeat(64)}`,
          new Date(checkedAt - 60_000),
          new Date(checkedAt + 30 * 60_000),
          new Date(checkedAt + 8 * 60 * 60_000),
          new Date(checkedAt + 9 * 60 * 60_000),
        ],
      );

      const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
      const occurredAt = new Date(NOW - 1_000);
      for (const [index, id] of ids.entries()) {
        await pool.query(
          `INSERT INTO ${schema}.audit_events (
             id, executor_type, executor_user_id, executor_key, action,
             target_type, target_id, result, reason_code, request_id,
             correlation_id, source, metadata, occurred_at, retention_policy_key
           ) VALUES ($1, 'user', $2, 'admincrm@cherryhillfci.com',
             $3, 'user', $2::text, $4, $5, $6, $7, 'integration_test',
             $8::jsonb, $9, 'security_audit')`,
          [
            id,
            adminId,
            index === 1 ? "identity.user_disabled" : "authorization.access_denied",
            index === 1 ? "succeeded" : "denied",
            index === 1 ? "administrator_request" : "idle_expired",
            `request-${index}-must-not-return`,
            `correlation-${index}-must-not-return`,
            JSON.stringify({ reason: index === 1 ? "FCI TEST — DO NOT USE reason" : "ignored", hidden: "must-not-return" }),
            occurredAt,
          ],
        );
      }

      const repository = createPostgresAdminAuditReader(pool, { schema });
      const readerScope = {
        kind: "company",
        sessionId,
        sessionVersion: "1",
        userId: adminId,
        authorizationVersion: "1",
        includeFinancial: true,
      };
      const first = await repository.listActivity(readerScope, query({ limit: 2 }), checkedAt);
      assert.equal(first.outcome, "accepted");
      assert.equal(first.page.events.length, 2);
      const orderedCursorKeys = ids.map(auditCursorKey).sort();
      assert.deepEqual(first.page.next, {
        occurredAt: NOW - 1_000,
        cursorKey: orderedCursorKeys[1],
      });
      const second = await repository.listActivity(
        readerScope,
        query({ limit: 2, cursor: first.page.next }),
        checkedAt,
      );
      assert.equal(second.outcome, "accepted");
      assert.equal(second.page.events.length, 1);
      assert.equal(second.page.next, null);
      const serialized = JSON.stringify([...first.page.events, ...second.page.events]);
      assert.doesNotMatch(serialized, /request-|correlation-|hidden|must-not-return|event_id|metadata/i);
      assert.match(serialized, /FCI TEST — DO NOT USE reason/);

      const people = await repository.listActivity(
        readerScope,
        query({ category: "people", result: "succeeded", limit: 10 }),
        checkedAt,
      );
      assert.equal(people.outcome, "accepted");
      assert.deepEqual(people.page.events.map(({ actionLabel }) => actionLabel), ["Access disabled"]);

      await pool.query(
        `UPDATE ${schema}.sessions
         SET token_hash = NULL, csrf_hash = NULL, revoked_at = $2,
             revoked_by_actor_key = 'user:audit-integration-admin',
             revocation_reason_code = 'integration_test', version = version + 1
         WHERE id = $1`,
        [sessionId, new Date(checkedAt)],
      );
      assert.deepEqual(
        await repository.listActivity(readerScope, query(), checkedAt),
        { outcome: "actor_authorization_changed" },
      );
    } finally {
      if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);
