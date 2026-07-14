import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  calculateProductionMigrationChecksum,
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();

test(
  "GitHub CI supplies PostgreSQL instead of silently skipping integration coverage",
  { skip: process.env.GITHUB_ACTIONS !== "true" },
  () => {
    assert.ok(postgresTestUrl, "TEST_POSTGRES_URL must be configured in GitHub Actions");
  },
);

async function expectPostgresError(promise, code, constraint) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    if (constraint) assert.equal(error.constraint, constraint);
    return true;
  });
}

test(
  "PostgreSQL 16 applies every production migration and enforces core invariants",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 30_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 6 });
    const schema = `fci_schema_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const migrationOptions = { schema };

    try {
      const concurrentResults = await Promise.all([
        runProductionSchemaMigrations(
          pool,
          PRODUCTION_SCHEMA_MIGRATIONS,
          migrationOptions,
        ),
        runProductionSchemaMigrations(
          pool,
          PRODUCTION_SCHEMA_MIGRATIONS,
          migrationOptions,
        ),
      ]);
      assert.deepEqual(
        concurrentResults.flatMap(({ appliedVersions }) => appliedVersions).sort(),
        [1, 2],
      );
      assert.deepEqual(concurrentResults.map(({ currentVersion }) => currentVersion), [2, 2]);

      const rerun = await runProductionSchemaMigrations(
        pool,
        PRODUCTION_SCHEMA_MIGRATIONS,
        migrationOptions,
      );
      assert.deepEqual(rerun, { appliedVersions: [], currentVersion: 2 });

      const history = await pool.query(
        `SELECT version, name, checksum
         FROM ${schema}.production_schema_migrations
         ORDER BY version`,
      );
      assert.deepEqual(
        history.rows,
        PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({
          version,
          name,
          checksum,
        })),
      );

      const tableNames = await pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schema],
      );
      assert.deepEqual(
        tableNames.rows.map(({ table_name }) => table_name),
        [
          "activity_events",
          "clients",
          "contacts",
          "idempotency_requests",
          "outbox_events",
          "production_schema_migrations",
          "projects",
        ],
      );

      const clientId = "11111111-1111-4111-8111-111111111111";
      const secondClientId = "22222222-2222-4222-8222-222222222222";
      await pool.query(
        `INSERT INTO ${schema}.clients (
           id, client_code, name, normalized_name_key, status, industry,
           created_by, updated_by, version
         ) VALUES ($1, 'CL-ABCD1234', 'Cherry Hill Test', 'cherry hill test',
           'active', 'flooring', 'actor-1', 'actor-1', $2)`,
        [clientId, "9007199254740991"],
      );
      await pool.query(
        `INSERT INTO ${schema}.clients (
           id, client_code, name, normalized_name_key, status,
           created_by, updated_by
         ) VALUES ($1, 'CL-EFGH5678', 'Second Test', 'second test',
           'prospect', 'actor-1', 'actor-1')`,
        [secondClientId],
      );

      const bigintResult = await pool.query(
        `SELECT version::text AS version FROM ${schema}.clients WHERE id = $1`,
        [clientId],
      );
      assert.equal(bigintResult.rows[0].version, "9007199254740991");

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.clients (
             id, client_code, name, normalized_name_key, status,
             created_by, updated_by
           ) VALUES ($1, 'CL-IJKL9012', 'Duplicate Name', 'cherry hill test',
             'active', 'actor-1', 'actor-1')`,
          ["33333333-3333-4333-8333-333333333333"],
        ),
        "23505",
        "clients_normalized_name_key_key",
      );
      await expectPostgresError(
        pool.query(
          `UPDATE ${schema}.clients SET status = 'unknown' WHERE id = $1`,
          [clientId],
        ),
        "23514",
        "clients_status_check",
      );

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.contacts (
             id, client_id, name, role
           ) VALUES ($1, $2, 'Missing client', 'Primary contact')`,
          [
            "44444444-4444-4444-8444-444444444444",
            "99999999-9999-4999-8999-999999999999",
          ],
        ),
        "23503",
        "contacts_client_id_fkey",
      );

      const projectId = "55555555-5555-4555-8555-555555555555";
      await pool.query(
        `INSERT INTO ${schema}.projects (
           id, project_number, client_id, name, status, estimated_value,
           created_by, updated_by
         ) VALUES ($1, 'CF-2026-ABCD1234', $2, 'Test Project', 'planning',
           9007199254740991, 'actor-1', 'actor-1')`,
        [projectId, clientId],
      );
      const estimatedValue = await pool.query(
        `SELECT estimated_value::text AS estimated_value
         FROM ${schema}.projects WHERE id = $1`,
        [projectId],
      );
      assert.equal(estimatedValue.rows[0].estimated_value, "9007199254740991");

      for (const invalidValue of ["-1", "12.5", "9007199254740992"]) {
        await expectPostgresError(
          pool.query(
            `INSERT INTO ${schema}.projects (
               id, project_number, client_id, name, status, estimated_value,
               created_by, updated_by
             ) VALUES ($1, $2, $3, 'Invalid Value', 'planning', $4,
               'actor-1', 'actor-1')`,
            [randomUUID(), `CF-2026-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`, clientId, invalidValue],
          ),
          "23514",
          "projects_estimated_value_check",
        );
      }

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.activity_events (
             id, action, actor_id, correlation_id, result, detail
           ) VALUES ($1, 'orphan event', 'actor-1', 'request-1', 'succeeded', '{}'::jsonb)`,
          [randomUUID()],
        ),
        "23514",
        "activity_events_record_check",
      );
      await pool.query(
        `INSERT INTO ${schema}.activity_events (
           id, project_id, action, actor_id, correlation_id, result, detail
         ) VALUES ($1, $2, 'Project created', 'actor-1', 'request-2',
           'succeeded', '{"source":"api"}'::jsonb)`,
        ["77777777-7777-4777-8777-777777777777", projectId],
      );
      await expectPostgresError(
        pool.query(
          `UPDATE ${schema}.activity_events SET action = 'changed' WHERE id = $1`,
          ["77777777-7777-4777-8777-777777777777"],
        ),
        "55000",
      );

      const idempotencyId = "66666666-6666-4666-8666-666666666666";
      const idempotencyValues = [
        idempotencyId,
        "actor-1",
        "clients.create",
        "retry-key",
        `sha256:${"a".repeat(64)}`,
      ];
      const firstIdempotency = await pool.query(
        `INSERT INTO ${schema}.idempotency_requests (
           id, actor_id, operation, idempotency_key, request_fingerprint, expires_at
         ) VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')
         ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
         RETURNING id`,
        idempotencyValues,
      );
      const retryIdempotency = await pool.query(
        `INSERT INTO ${schema}.idempotency_requests (
           id, actor_id, operation, idempotency_key, request_fingerprint, expires_at
         ) VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')
         ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
         RETURNING id`,
        [randomUUID(), ...idempotencyValues.slice(1)],
      );
      assert.equal(firstIdempotency.rowCount, 1);
      assert.equal(retryIdempotency.rowCount, 0);
      await pool.query(
        `INSERT INTO ${schema}.idempotency_requests (
           id, actor_id, operation, idempotency_key, request_fingerprint, expires_at
         ) VALUES ($1, 'actor-2', 'clients.create', 'retry-key', $2,
           now() + interval '1 hour')`,
        [randomUUID(), `sha256:${"a".repeat(64)}`],
      );

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.outbox_events (
             id, event_key, event_type, project_id, actor_id, correlation_id, payload
           ) VALUES ($1, 'client-created-wrong-target', 'client.created', $2,
             'actor-1', 'request-wrong-client', '{}'::jsonb)`,
          [randomUUID(), projectId],
        ),
        "23514",
        "outbox_events_type_record_check",
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.outbox_events (
             id, event_key, event_type, client_id, actor_id, correlation_id, payload
           ) VALUES ($1, 'project-created-wrong-target', 'project.created', $2,
             'actor-1', 'request-wrong-project', '{}'::jsonb)`,
          [randomUUID(), clientId],
        ),
        "23514",
        "outbox_events_type_record_check",
      );

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.outbox_events (
             id, event_key, event_type, project_id, actor_id, correlation_id, payload
           ) VALUES ($1, 'project-created-invalid', 'project.created', $2,
             'actor-1', 'request-3', '[]'::jsonb)`,
          [randomUUID(), projectId],
        ),
        "23514",
        "outbox_events_payload_check",
      );
      await pool.query(
        `INSERT INTO ${schema}.outbox_events (
           id, event_key, event_type, project_id, actor_id, correlation_id, payload
         ) VALUES ($1, 'project-created-1', 'project.created', $2,
           'actor-1', 'request-4', '{"projectId":"${projectId}"}'::jsonb)`,
        [randomUUID(), projectId],
      );

      const pendingIndex = await pool.query(
        `SELECT pg_get_expr(indexprs, indrelid) AS expressions,
                pg_get_expr(indpred, indrelid) AS predicate
         FROM pg_index
         WHERE indexrelid = '${schema}.outbox_events_pending_available_idx'::regclass`,
      );
      assert.match(pendingIndex.rows[0].predicate, /status = 'pending'/);

      const expiredLeaseIndex = await pool.query(
        `SELECT pg_get_expr(indpred, indrelid) AS predicate
         FROM pg_index
         WHERE indexrelid = '${schema}.outbox_events_expired_lease_idx'::regclass`,
      );
      assert.match(expiredLeaseIndex.rows[0].predicate, /status = 'processing'/);

      const missingForeignKeyIndexes = await pool.query(
        `SELECT c.conname
         FROM pg_constraint c
         CROSS JOIN LATERAL unnest(c.conkey) AS key(attnum)
         WHERE c.contype = 'f'
           AND c.connamespace = $1::regnamespace
           AND NOT EXISTS (
             SELECT 1
             FROM pg_index i
             WHERE i.indrelid = c.conrelid
               AND key.attnum = ANY(i.indkey)
           )`,
        [schema],
      );
      assert.deepEqual(missingForeignKeyIndexes.rows, []);

      const rollbackProbe = {
        version: 3,
        name: "rollback_probe",
        checksum: "",
        statements: [
          "CREATE TABLE rollback_probe (id integer CONSTRAINT rollback_probe_pkey PRIMARY KEY)",
          "SELECT * FROM relation_that_does_not_exist",
        ],
      };
      rollbackProbe.checksum = calculateProductionMigrationChecksum(rollbackProbe);
      await assert.rejects(
        runProductionSchemaMigrations(
          pool,
          [...PRODUCTION_SCHEMA_MIGRATIONS, rollbackProbe],
          migrationOptions,
        ),
        /migration 3 \(rollback_probe\) did not complete cleanly/,
      );
      const rollbackState = await pool.query(
        `SELECT to_regclass('${schema}.rollback_probe') AS relation,
                (SELECT count(*)::integer
                 FROM ${schema}.production_schema_migrations) AS migration_count`,
      );
      assert.equal(rollbackState.rows[0].relation, null);
      assert.equal(rollbackState.rows[0].migration_count, 2);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);

test(
  "PostgreSQL 16 migration search path prevents a reused session's temp history shadow",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 30_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 1 });
    const schema = `fci_shadow_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(
        `CREATE TEMP TABLE production_schema_migrations (
           version integer PRIMARY KEY,
           name text NOT NULL,
           checksum text NOT NULL
         )`,
      );
    } finally {
      client.release();
    }

    try {
      const result = await runProductionSchemaMigrations(
        pool,
        PRODUCTION_SCHEMA_MIGRATIONS,
        { schema },
      );
      assert.deepEqual(result, { appliedVersions: [1, 2], currentVersion: 2 });

      const targetHistory = await pool.query(
        `SELECT count(*)::integer AS count FROM ${schema}.production_schema_migrations`,
      );
      const temporaryHistory = await pool.query(
        "SELECT count(*)::integer AS count FROM pg_temp.production_schema_migrations",
      );
      assert.equal(targetHistory.rows[0].count, 2);
      assert.equal(temporaryHistory.rows[0].count, 0);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);
