import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateProductionMigrationChecksum,
  PRODUCTION_MIGRATION_LOCK_ID,
  PRODUCTION_SCHEMA_HISTORY_SQL,
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
  validateProductionMigrationRegistry,
} from "../app/platform/postgres/production-schema-migrations.ts";

class FakePostgresClient {
  constructor({
    history = [],
    failPattern,
    failAfterEffectPattern,
    lockAvailable = true,
    schemaExists = true,
    schemaOwner = "fci_migration",
  } = {}) {
    this.history = history.map((row) => ({ ...row }));
    this.failPattern = failPattern;
    this.failAfterEffectPattern = failAfterEffectPattern;
    this.lockAvailable = lockAvailable;
    this.schemaExists = schemaExists;
    this.schemaOwner = schemaOwner;
    this.queries = [];
    this.pendingMarker = null;
    this.inTransaction = false;
    this.released = false;
    this.releaseError = undefined;
    this.searchPath = '"$user", public';
    this.currentRole = "migration_login";
  }

  async query(sql, values = []) {
    const normalized = sql.trim();
    this.queries.push({ sql: normalized, values: [...values] });

    if (this.failPattern?.test(normalized)) throw new Error("simulated PostgreSQL failure");
    if (/^SET ROLE /i.test(normalized)) {
      this.currentRole = normalized.slice('SET ROLE "'.length, -1);
      return { rows: [], rowCount: null };
    }
    if (normalized === "SELECT CURRENT_USER AS current_user") {
      return { rows: [{ current_user: this.currentRole }], rowCount: 1 };
    }
    if (normalized === "RESET ROLE") {
      this.currentRole = "migration_login";
      return { rows: [], rowCount: null };
    }
    if (/^SELECT namespace\.oid::text AS schema_oid/i.test(normalized)) {
      return {
        rows: this.schemaExists
          ? [{ schema_oid: "16384", schema_owner: this.schemaOwner }]
          : [],
        rowCount: this.schemaExists ? 1 : 0,
      };
    }
    if (/^SELECT pg_catalog\.pg_try_advisory_lock/i.test(normalized)) {
      return { rows: [{ acquired: this.lockAvailable }], rowCount: 1 };
    }
    if (/^SELECT pg_catalog\.current_setting/i.test(normalized)) {
      return { rows: [{ search_path: this.searchPath }], rowCount: 1 };
    }
    if (/^SELECT pg_catalog\.set_config/i.test(normalized)) {
      this.searchPath = values[0];
      return { rows: [{ set_config: this.searchPath }], rowCount: 1 };
    }
    if (/^SELECT version, name, checksum FROM production_schema_migrations/i.test(normalized)) {
      return { rows: this.history.map((row) => ({ ...row })), rowCount: this.history.length };
    }
    if (normalized === "BEGIN") {
      this.inTransaction = true;
      if (this.failAfterEffectPattern?.test(normalized)) {
        throw new Error("simulated lost PostgreSQL response after effect");
      }
      return { rows: [], rowCount: null };
    }
    if (/^INSERT INTO production_schema_migrations/i.test(normalized)) {
      assert.equal(this.inTransaction, true);
      this.pendingMarker = {
        version: values[0],
        name: values[1],
        checksum: values[2],
      };
      return { rows: [], rowCount: 1 };
    }
    if (normalized === "COMMIT") {
      assert.equal(this.inTransaction, true);
      if (this.pendingMarker) this.history.push(this.pendingMarker);
      this.pendingMarker = null;
      this.inTransaction = false;
      return { rows: [], rowCount: null };
    }
    if (normalized === "ROLLBACK") {
      this.pendingMarker = null;
      this.inTransaction = false;
      return { rows: [], rowCount: null };
    }

    return {
      rows: /^SELECT pg_catalog\.pg_advisory_unlock/i.test(normalized) ? [{ pg_advisory_unlock: true }] : [],
      rowCount: null,
    };
  }

  release(error) {
    this.released = true;
    this.releaseError = error;
  }
}

class FakePostgresPool {
  constructor(client) {
    this.client = client;
    this.connectCount = 0;
  }

  async connect() {
    this.connectCount += 1;
    return this.client;
  }
}

function queryIndex(client, pattern) {
  return client.queries.findIndex(({ sql }) => pattern.test(sql));
}

test("keeps production migration declarations immutable and line-ending independent", () => {
  validateProductionMigrationRegistry(PRODUCTION_SCHEMA_MIGRATIONS);

  for (const migration of PRODUCTION_SCHEMA_MIGRATIONS) {
    assert.equal(calculateProductionMigrationChecksum(migration), migration.checksum);

    const crlfMigration = {
      ...migration,
      statements: migration.statements.map((statement) => statement.replaceAll("\n", "\r\n")),
    };
    assert.equal(calculateProductionMigrationChecksum(crlfMigration), migration.checksum);
  }

  const changed = PRODUCTION_SCHEMA_MIGRATIONS.map((migration, index) =>
    index === 0
      ? { ...migration, statements: [...migration.statements, "SELECT 1"] }
      : migration,
  );
  assert.throws(
    () => validateProductionMigrationRegistry(changed),
    /checksum declaration does not match its immutable contents/,
  );
});

test("rejects gaps, duplicate names, transaction control, and concurrent indexes", () => {
  const first = PRODUCTION_SCHEMA_MIGRATIONS[0];

  const gap = { ...first, version: 2 };
  assert.throws(
    () => validateProductionMigrationRegistry([{ ...gap, checksum: calculateProductionMigrationChecksum(gap) }]),
    /positive, contiguous, and ordered/,
  );

  const duplicateName = {
    ...PRODUCTION_SCHEMA_MIGRATIONS[1],
    name: first.name,
  };
  duplicateName.checksum = calculateProductionMigrationChecksum(duplicateName);
  assert.throws(
    () => validateProductionMigrationRegistry([first, duplicateName]),
    /name core_records is duplicated/,
  );

  for (const statement of [
    "BEGIN",
    "-- leading review note\nCOMMIT",
    "START TRANSACTION",
    "SELECT 1; COMMIT",
    "SELECT '\\'; COMMIT; --'",
    "CREATE INDEX CONCURRENTLY unsafe_idx ON clients (name)",
    "CREATE UNIQUE INDEX CONCURRENTLY unsafe_unique_idx ON clients (name)",
  ]) {
    const unsafe = { version: 1, name: "unsafe", checksum: "", statements: [statement] };
    unsafe.checksum = calculateProductionMigrationChecksum(unsafe);
    assert.throws(
      () => validateProductionMigrationRegistry([unsafe]),
      /(?:cannot (?:manage its own transaction|create concurrent indexes)|exactly one top-level SQL statement)/,
    );
  }

  const quotedControl = {
    version: 1,
    name: "quoted_control",
    checksum: "",
    statements: ["SELECT 'COMMIT; ROLLBACK'"],
  };
  quotedControl.checksum = calculateProductionMigrationChecksum(quotedControl);
  assert.doesNotThrow(() => validateProductionMigrationRegistry([quotedControl]));
});

test("uses one dedicated connection, locks before history, and commits each version atomically", async () => {
  const client = new FakePostgresClient();
  const pool = new FakePostgresPool(client);

  const result = await runProductionSchemaMigrations(pool);

  assert.deepEqual(result, { appliedVersions: [1, 2], currentVersion: 2 });
  assert.equal(pool.connectCount, 1);
  assert.equal(client.released, true);
  assert.deepEqual(client.history, PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({
    version,
    name,
    checksum,
  })));

  const bootstrapIndex = queryIndex(client, /^CREATE TABLE IF NOT EXISTS production_schema_migrations/);
  const lockIndex = queryIndex(client, /^SELECT pg_catalog\.pg_try_advisory_lock/);
  const schemaIndex = queryIndex(client, /^SELECT namespace\.oid::text AS schema_oid/);
  const searchPathIndex = queryIndex(client, /^SELECT pg_catalog\.set_config/);
  const historyIndex = queryIndex(client, /^SELECT version, name, checksum/);
  const unlockIndex = queryIndex(client, /^SELECT pg_catalog\.pg_advisory_unlock/);
  assert.ok(
    lockIndex < schemaIndex &&
    schemaIndex < searchPathIndex &&
    searchPathIndex < bootstrapIndex &&
    bootstrapIndex < historyIndex,
  );
  assert.ok(unlockIndex > historyIndex);
  assert.deepEqual(client.queries[lockIndex].values, [PRODUCTION_MIGRATION_LOCK_ID]);
  assert.deepEqual(client.queries[searchPathIndex].values, ["public, pg_catalog, pg_temp"]);
  assert.deepEqual(client.queries[unlockIndex].values, [PRODUCTION_MIGRATION_LOCK_ID]);
  assert.deepEqual(
    client.queries.filter(({ sql }) => /^SELECT pg_catalog\.set_config/.test(sql)).at(-1).values,
    ['"$user", public'],
  );
  assert.equal(client.searchPath, '"$user", public');

  assert.equal(client.queries.filter(({ sql }) => sql === "BEGIN").length, 2);
  assert.equal(client.queries.filter(({ sql }) => sql === "COMMIT").length, 2);
  assert.equal(client.queries.filter(({ sql }) => /^SET LOCAL lock_timeout/.test(sql)).length, 2);
  assert.equal(client.queries.filter(({ sql }) => /^SET LOCAL statement_timeout/.test(sql)).length, 2);

  for (const migration of PRODUCTION_SCHEMA_MIGRATIONS) {
    const marker = client.queries.findIndex(
      ({ sql, values }) => /^INSERT INTO production_schema_migrations/.test(sql) && values[0] === migration.version,
    );
    const lastStatement = client.queries.findIndex(
      ({ sql }) => sql === migration.statements.at(-1),
    );
    assert.ok(lastStatement < marker);
    assert.equal(client.queries[marker + 1].sql, "COMMIT");
  }
});

test("validates and selects an explicit production schema without ambient search_path", async () => {
  const invalidPool = new FakePostgresPool(new FakePostgresClient());
  await assert.rejects(
    runProductionSchemaMigrations(invalidPool, PRODUCTION_SCHEMA_MIGRATIONS, {
      schema: "Unsafe-Schema",
    }),
    /lowercase PostgreSQL identifier/,
  );
  assert.equal(invalidPool.connectCount, 0);

  const missingClient = new FakePostgresClient({ schemaExists: false });
  await assert.rejects(
    runProductionSchemaMigrations(
      new FakePostgresPool(missingClient),
      PRODUCTION_SCHEMA_MIGRATIONS,
      { schema: "fci_missing" },
    ),
    /schema fci_missing does not exist/,
  );
  assert.equal(missingClient.queries.some(({ sql }) => /^SELECT pg_catalog\.pg_advisory_unlock/.test(sql)), true);
  assert.equal(missingClient.released, true);

  const client = new FakePostgresClient();
  await runProductionSchemaMigrations(
    new FakePostgresPool(client),
    PRODUCTION_SCHEMA_MIGRATIONS,
    {
      schema: "fci_app",
      transactionLockTimeoutMs: 3_456,
      statementTimeoutMs: 45_678,
    },
  );
  const searchPath = client.queries.find(({ sql }) => /^SELECT pg_catalog\.set_config/.test(sql));
  assert.deepEqual(searchPath.values, ["fci_app, pg_catalog, pg_temp"]);
  assert.equal(
    client.queries.some(({ sql }) => sql === "SET LOCAL lock_timeout = '3456ms'"),
    true,
  );
  assert.equal(
    client.queries.some(({ sql }) => sql === "SET LOCAL statement_timeout = '45678ms'"),
    true,
  );
});

test("rejects invalid per-transaction migration timeouts before connecting", async () => {
  for (const options of [
    { transactionLockTimeoutMs: 99 },
    { statementTimeoutMs: 999 },
    { statementTimeoutMs: 300_001 },
  ]) {
    const pool = new FakePostgresPool(new FakePostgresClient());
    await assert.rejects(
      runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, options),
      /Production migration .* timeout must be an integer/,
    );
    assert.equal(pool.connectCount, 0);
  }
});

test("sets and verifies an explicit migration owner role before DDL, then resets it", async () => {
  const invalidPool = new FakePostgresPool(new FakePostgresClient());
  await assert.rejects(
    runProductionSchemaMigrations(invalidPool, PRODUCTION_SCHEMA_MIGRATIONS, {
      role: 'unsafe"role',
    }),
    /migration role must be a lowercase PostgreSQL identifier/,
  );
  assert.equal(invalidPool.connectCount, 0);

  const client = new FakePostgresClient();
  await runProductionSchemaMigrations(
    new FakePostgresPool(client),
    PRODUCTION_SCHEMA_MIGRATIONS,
    { role: "fci_migration" },
  );

  const setRoleIndex = queryIndex(client, /^SET ROLE "fci_migration"$/);
  const verifyRoleIndex = queryIndex(client, /^SELECT CURRENT_USER AS current_user$/);
  const lockIndex = queryIndex(client, /^SELECT pg_catalog\.pg_try_advisory_lock/);
  const resetRoleIndex = queryIndex(client, /^RESET ROLE$/);
  assert.ok(setRoleIndex >= 0 && setRoleIndex < verifyRoleIndex);
  assert.ok(verifyRoleIndex < lockIndex);
  assert.ok(resetRoleIndex > queryIndex(client, /^SELECT pg_catalog\.pg_advisory_unlock/));
  assert.equal(client.currentRole, "migration_login");
  assert.equal(client.released, true);
});

test("refuses DDL when the target schema is not owned by the activated migration role", async () => {
  const client = new FakePostgresClient({ schemaOwner: "unexpected_owner" });
  await assert.rejects(
    runProductionSchemaMigrations(
      new FakePostgresPool(client),
      PRODUCTION_SCHEMA_MIGRATIONS,
      { role: "fci_migration" },
    ),
    /must be owned by the activated role fci_migration/,
  );

  assert.equal(client.queries.some(({ sql }) => /^CREATE TABLE/.test(sql)), false);
  assert.equal(client.queries.some(({ sql }) => sql === "RESET ROLE"), true);
  assert.equal(client.released, true);
});

test("bounds advisory-lock acquisition and discards an unconfirmed session", async () => {
  const client = new FakePostgresClient({ lockAvailable: false });

  await assert.rejects(
    runProductionSchemaMigrations(
      new FakePostgresPool(client),
      PRODUCTION_SCHEMA_MIGRATIONS,
      { lockTimeoutMs: 0 },
    ),
    /lock was not acquired within 0 ms/,
  );

  assert.equal(client.released, true);
  assert.ok(client.releaseError instanceof Error);
  assert.equal(
    client.queries.some(({ sql }) => /^CREATE TABLE IF NOT EXISTS/.test(sql)),
    false,
  );
});

test("applies only the missing suffix of a known history prefix", async () => {
  const first = PRODUCTION_SCHEMA_MIGRATIONS[0];
  const client = new FakePostgresClient({
    history: [{ version: first.version, name: first.name, checksum: first.checksum }],
  });

  const result = await runProductionSchemaMigrations(new FakePostgresPool(client));

  assert.deepEqual(result.appliedVersions, [2]);
  assert.equal(client.queries.filter(({ sql }) => sql === "BEGIN").length, 1);
});

test("re-reads applied history after the lock and makes a completed rerun a no-op", async () => {
  const history = PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({
    version,
    name,
    checksum,
  }));
  const client = new FakePostgresClient({ history });

  const result = await runProductionSchemaMigrations(new FakePostgresPool(client));

  assert.deepEqual(result, { appliedVersions: [], currentVersion: 2 });
  assert.equal(client.queries.some(({ sql }) => sql === "BEGIN"), false);
  assert.equal(client.released, true);
});

test("fails closed on changed, unknown, or non-prefix migration history", async () => {
  const first = PRODUCTION_SCHEMA_MIGRATIONS[0];
  const histories = [
    [{ version: 1, name: first.name, checksum: "sha256:" + "0".repeat(64) }],
    [{ version: 2, name: PRODUCTION_SCHEMA_MIGRATIONS[1].name, checksum: PRODUCTION_SCHEMA_MIGRATIONS[1].checksum }],
    [
      ...PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({ version, name, checksum })),
      { version: 3, name: "future", checksum: "sha256:" + "1".repeat(64) },
    ],
  ];

  for (const history of histories) {
    const client = new FakePostgresClient({ history });
    await assert.rejects(
      runProductionSchemaMigrations(new FakePostgresPool(client)),
      /(?:history mismatch|known contiguous prefix|newer than this migration registry)/,
    );
    assert.equal(client.queries.some(({ sql }) => /^SELECT pg_catalog\.pg_advisory_unlock/.test(sql)), true);
    assert.equal(client.released, true);
  }
});

test("rolls back a failed version and always unlocks and releases the connection", async () => {
  const client = new FakePostgresClient({ failPattern: /^CREATE TABLE projects/ });

  await assert.rejects(
    runProductionSchemaMigrations(new FakePostgresPool(client)),
    /migration 1 \(core_records\) did not complete cleanly/,
  );

  assert.equal(client.queries.some(({ sql }) => sql === "ROLLBACK"), true);
  assert.equal(client.queries.some(({ sql }) => /^INSERT INTO production_schema_migrations/.test(sql)), false);
  assert.equal(client.queries.some(({ sql }) => /^SELECT pg_catalog\.pg_advisory_unlock/.test(sql)), true);
  assert.equal(client.released, true);
});

test("attempts rollback when BEGIN succeeds but its response is lost", async () => {
  const client = new FakePostgresClient({ failAfterEffectPattern: /^BEGIN$/ });

  await assert.rejects(
    runProductionSchemaMigrations(new FakePostgresPool(client)),
    /migration 1 \(core_records\) did not complete cleanly/,
  );

  assert.equal(client.queries.some(({ sql }) => sql === "ROLLBACK"), true);
  assert.equal(client.inTransaction, false);
  assert.equal(client.released, true);
});

test("discards the dedicated connection when rollback fails without masking the migration error", async () => {
  const client = new FakePostgresClient({
    failPattern: /^(?:CREATE TABLE projects|ROLLBACK$)/,
  });

  await assert.rejects(
    runProductionSchemaMigrations(new FakePostgresPool(client)),
    /migration 1 \(core_records\) did not complete cleanly/,
  );

  assert.equal(client.queries.some(({ sql }) => sql === "ROLLBACK"), true);
  assert.ok(client.releaseError instanceof Error);
});

test("preserves a primary migration failure when advisory unlock also fails", async () => {
  const client = new FakePostgresClient({
    failPattern: /^(?:CREATE TABLE projects|SELECT pg_catalog\.pg_advisory_unlock)/,
  });

  await assert.rejects(
    runProductionSchemaMigrations(new FakePostgresPool(client)),
    /migration 1 \(core_records\) did not complete cleanly/,
  );
  assert.equal(client.released, true);
  assert.ok(client.releaseError instanceof Error);
});

test("defines only the bounded core schema with named constraints and worker indexes", () => {
  const versionedSql = PRODUCTION_SCHEMA_MIGRATIONS.flatMap(({ statements }) => statements).join("\n");
  const allSql = `${PRODUCTION_SCHEMA_HISTORY_SQL}\n${versionedSql}`;

  assert.deepEqual(
    [...allSql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? ([a-z0-9_]+)/g)].map((match) => match[1]),
    [
      "production_schema_migrations",
      "clients",
      "contacts",
      "projects",
      "activity_events",
      "idempotency_requests",
      "outbox_events",
    ],
  );
  assert.doesNotMatch(versionedSql, /\bIF NOT EXISTS\b/i);
  assert.equal((allSql.match(/\bIF NOT EXISTS\b/gi) ?? []).length, 1);
  assert.doesNotMatch(versionedSql, /\b(?:DROP|TRUNCATE)\b|CREATE INDEX CONCURRENTLY/i);

  assert.match(versionedSql, /normalized_name_key text NOT NULL/);
  assert.match(versionedSql, /UNIQUE \(normalized_name_key\)/);
  assert.match(versionedSql, /estimated_value = pg_catalog\.trunc\(estimated_value\)/);
  assert.match(versionedSql, /estimated_value <= 9007199254740991/);
  assert.match(versionedSql, /projects_status_check CHECK/);
  assert.match(versionedSql, /idempotency_requests_actor_operation_key_key UNIQUE \(actor_id, operation, idempotency_key\)/);
  assert.match(versionedSql, /outbox_events_pending_available_idx[\s\S]*WHERE status = 'pending'/);
  assert.match(versionedSql, /outbox_events_expired_lease_idx[\s\S]*WHERE status = 'processing'/);
  assert.match(versionedSql, /outbox_events_type_record_check CHECK/);
  assert.match(versionedSql, /outbox_events_dead_lettered_at_check/);
  assert.match(versionedSql, /activity_events_correlation_id_check/);
  assert.match(versionedSql, /activity_events_result_check/);
  assert.match(versionedSql, /activity_events_append_only_trigger/);

  for (const foreignKey of [
    ["contacts_client_id_fkey", "contacts_client_id_idx"],
    ["projects_client_id_fkey", "projects_client_id_idx"],
    ["activity_events_client_id_fkey", "activity_events_client_id_idx"],
    ["activity_events_project_id_fkey", "activity_events_project_id_idx"],
    ["outbox_events_client_id_fkey", "outbox_events_client_id_idx"],
    ["outbox_events_project_id_fkey", "outbox_events_project_id_idx"],
  ]) {
    assert.match(versionedSql, new RegExp(`CONSTRAINT ${foreignKey[0]} FOREIGN KEY`));
    assert.match(versionedSql, new RegExp(`CREATE (?:UNIQUE )?INDEX ${foreignKey[1]} `));
  }

  for (const line of allSql.split("\n").filter((value) => /\b(?:PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/.test(value))) {
    if (/^CREATE UNIQUE INDEX/.test(line.trim())) continue;
    assert.match(line, /CONSTRAINT [a-z][a-z0-9_]+/);
  }
});
