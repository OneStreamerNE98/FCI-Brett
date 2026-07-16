import assert from "node:assert/strict";
import test from "node:test";
import {
  DATABASE_TABLE_PRIVILEGES,
  createDatabaseReadinessProbe,
  EXPECTED_PRODUCTION_SCHEMA_HISTORY,
  EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS,
  EXPECTED_RUNTIME_TABLE_ACCESS,
} from "../app/platform/google-cloud/database-readiness.ts";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
} from "../app/platform/postgres/production-schema-migrations.ts";

function result(rows) {
  return { rows, rowCount: rows.length };
}

function expectedRuntimePrivilegeRows() {
  const columnUpdateTables = new Set(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.map(({ table }) => table),
  );
  return EXPECTED_RUNTIME_TABLE_ACCESS.flatMap(({ table, privileges }) =>
    DATABASE_TABLE_PRIVILEGES.map((privilege) => {
      const shouldHave = privileges.includes(privilege);
      const supportsColumnGrant = ["SELECT", "INSERT", "UPDATE", "REFERENCES"].includes(privilege);
      const hasReviewedColumnOnlyGrant = privilege === "UPDATE" &&
        columnUpdateTables.has(table);
      return {
        tableName: table,
        privilege,
        shouldHave,
        relationExists: true,
        hasPrivilege: shouldHave,
        hasColumnPrivilege: supportsColumnGrant
          ? shouldHave || hasReviewedColumnOnlyGrant
          : false,
        hasGrantOption: false,
        hasColumnGrantOption: false,
      };
    }));
}

function expectedRuntimeColumnUpdateRows() {
  return EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.flatMap(({ table, columns }) =>
    columns.map((column) => ({
      tableName: table,
      columnName: column,
      shouldHave: true,
      relationExists: true,
      columnExists: true,
      hasPrivilege: true,
      hasGrantOption: false,
    })));
}

function readyDatabase(overrides = {}) {
  const queries = [];
  const releases = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values: [...values] });
      assert.match(sql.trim(), /^(?:BEGIN READ ONLY|SET LOCAL statement_timeout|SELECT\b|WITH\b|COMMIT|ROLLBACK)/);
      assert.doesNotMatch(sql.trim(), /^(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i);
      if (/^(?:BEGIN READ ONLY|SET LOCAL statement_timeout|COMMIT|ROLLBACK)/.test(sql.trim())) {
        return result([]);
      }
      if (sql.includes("has_schema_privilege")) {
        return result([{
          has_usage: overrides.hasUsage ?? true,
          has_usage_grant_option: overrides.hasUsageGrantOption ?? false,
          has_create: overrides.hasCreate ?? false,
          can_set_migration_owner: overrides.canSetMigrationOwner ?? false,
          can_set_rehearsal_importer: overrides.canSetRehearsalImporter ?? false,
          has_sequence_access: overrides.hasSequenceAccess ?? false,
          history_reader_exists: overrides.historyReaderExists ?? true,
          history_reader_security_definer: overrides.historyReaderSecurityDefiner ?? true,
          history_reader_owner: overrides.historyReaderOwner ?? true,
          history_reader_fixed_search_path: overrides.historyReaderFixedSearchPath ?? true,
          has_history_reader_execute: overrides.hasHistoryReaderExecute ?? true,
          has_history_reader_grant_option: overrides.hasHistoryReaderGrantOption ?? false,
          has_unreviewed_function_execute: overrides.hasUnreviewedFunctionExecute ?? false,
        }]);
      }
      if (sql.includes("expected_update_columns")) {
        return result(overrides.runtimeColumnUpdates ?? expectedRuntimeColumnUpdateRows());
      }
      if (sql.includes("has_table_privilege")) {
        return result(overrides.runtimePrivileges ?? expectedRuntimePrivilegeRows());
      }
      return result(overrides.history ?? EXPECTED_PRODUCTION_SCHEMA_HISTORY.map((row) => ({ ...row })));
    },
    release(error) {
      releases.push(error);
    },
  };
  const database = {
    async connect() {
      return client;
    },
  };
  return { database, queries, releases };
}

test("keeps read-only readiness metadata equal to the immutable migration registry", () => {
  assert.deepEqual(
    EXPECTED_PRODUCTION_SCHEMA_HISTORY,
    PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({
      version,
      name,
      checksum,
    })),
  );
});

test("requires exact runtime privileges and complete migration history through the narrow reader", async () => {
  const { database, queries, releases } = readyDatabase();
  const probe = createDatabaseReadinessProbe({
    database,
    schema: "fci_app",
    cacheTtlMs: 0,
  });

  assert.equal(await probe.check(), true);
  assert.deepEqual(queries.map(({ sql }) => sql.trim().split("\n")[0]), [
    "BEGIN READ ONLY",
    "SET LOCAL statement_timeout = '1500ms'",
    "WITH history_reader AS (",
    "WITH expected_update_columns(table_name, column_name, ordinal) AS (",
    "WITH expected(table_name, privilege, should_have, ordinal) AS (",
    "SELECT version, name, checksum",
    "COMMIT",
  ]);
  assert.deepEqual(queries[2].values, ["fci_app"]);
  assert.match(queries[2].sql, /pg_has_role\(SESSION_USER, role\.oid, 'SET'\)/);
  assert.match(queries[2].sql, /has_sequence_privilege\(CURRENT_USER, sequence\.oid, 'USAGE'\)/);
  assert.deepEqual(queries[3].values, [
    "fci_app",
    expectedRuntimeColumnUpdateRows().map(({ tableName }) => tableName),
    expectedRuntimeColumnUpdateRows().map(({ columnName }) => columnName),
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.map(({ table }) => table),
  ]);
  assert.match(queries[3].sql, /has_column_privilege/);
  assert.match(queries[3].sql, /unexpected AS/);
  assert.match(queries[3].sql, /UPDATE WITH GRANT OPTION/);
  assert.deepEqual(queries[4].values, [
    "fci_app",
    expectedRuntimePrivilegeRows().map(({ tableName }) => tableName),
    expectedRuntimePrivilegeRows().map(({ privilege }) => privilege),
    expectedRuntimePrivilegeRows().map(({ shouldHave }) => shouldHave),
    EXPECTED_RUNTIME_TABLE_ACCESS.map(({ table }) => table),
    DATABASE_TABLE_PRIVILEGES,
  ]);
  assert.match(queries[4].sql, /has_table_privilege/);
  assert.match(queries[5].sql, /FROM "fci_app"\.read_production_schema_history\(\)/);
  assert.doesNotMatch(queries[5].sql, /FROM "fci_app"\.production_schema_migrations/);
  assert.match(queries[5].sql, /ORDER BY version/);
  assert.deepEqual(releases, [undefined]);
});

test("fails readiness when schema privilege is too weak or too broad", async () => {
  for (const permissions of [
    { hasUsage: false, hasCreate: false },
    { hasUsage: true, hasUsageGrantOption: true, hasCreate: false },
    { hasUsage: true, hasCreate: true },
    { canSetMigrationOwner: true },
    { canSetRehearsalImporter: true },
    { hasSequenceAccess: true },
  ]) {
    const { database, queries } = readyDatabase(permissions);
    const probe = createDatabaseReadinessProbe({ database, schema: "fci_app", cacheTtlMs: 0 });
    assert.equal(await probe.check(), false);
    assert.equal(
      queries.filter(({ sql }) =>
        /expected_update_columns|has_table_privilege|read_production_schema_history\(\)/.test(sql)).length,
      0,
      "column/table grants and history must not be read for an invalid runtime role",
    );
  }
});

test("fails readiness when the schema-history reader is missing, unavailable, or delegable", async () => {
  for (const permissions of [
    { historyReaderExists: false },
    { historyReaderSecurityDefiner: false },
    { historyReaderOwner: false },
    { historyReaderFixedSearchPath: false },
    { hasHistoryReaderExecute: false },
    { hasHistoryReaderGrantOption: true },
    { hasUnreviewedFunctionExecute: true },
  ]) {
    const { database, queries } = readyDatabase(permissions);
    const probe = createDatabaseReadinessProbe({ database, schema: "fci_app", cacheTtlMs: 0 });
    assert.equal(await probe.check(), false);
    assert.equal(queries.some(({ sql }) => sql.includes("expected_update_columns")), false);
    assert.equal(queries.some(({ sql }) => sql.includes("has_table_privilege")), false);
    assert.equal(queries.some(({ sql }) => /FROM "fci_app"\.read_production_schema_history/.test(sql)), false);
  }
});

test("allows ungranted non-allowlisted columns in the exact update matrix", async () => {
  const runtimeColumnUpdates = [
    ...expectedRuntimeColumnUpdateRows(),
    {
      tableName: "users",
      columnName: "email",
      shouldHave: false,
      relationExists: true,
      columnExists: true,
      hasPrivilege: false,
      hasGrantOption: false,
    },
  ];
  const { database } = readyDatabase({ runtimeColumnUpdates });
  const probe = createDatabaseReadinessProbe({ database, schema: "fci_app", cacheTtlMs: 0 });
  assert.equal(await probe.check(), true);
});

test("fails readiness for missing, delegable, or unexpected column update access", async () => {
  const base = expectedRuntimeColumnUpdateRows();
  const cases = [
    base.slice(0, -1),
    base.map((row, index) => index === 0 ? { ...row, relationExists: false } : row),
    base.map((row, index) => index === 0 ? { ...row, columnExists: false } : row),
    base.map((row, index) => index === 0 ? { ...row, hasGrantOption: true } : row),
    ...base.map((_, deniedIndex) =>
      base.map((row, index) => index === deniedIndex ? { ...row, hasPrivilege: false } : row)),
    [...base, {
      tableName: "users",
      columnName: "email",
      shouldHave: false,
      relationExists: true,
      columnExists: true,
      hasPrivilege: true,
      hasGrantOption: false,
    }],
    [...base, {
      tableName: "sessions",
      columnName: "user_id",
      shouldHave: false,
      relationExists: true,
      columnExists: true,
      hasPrivilege: false,
      hasGrantOption: true,
    }],
  ];

  for (const runtimeColumnUpdates of cases) {
    const { database, queries } = readyDatabase({ runtimeColumnUpdates });
    const probe = createDatabaseReadinessProbe({ database, schema: "fci_app", cacheTtlMs: 0 });
    assert.equal(await probe.check(), false);
    assert.equal(queries.some(({ sql }) => sql.includes("has_table_privilege")), false);
    assert.equal(
      queries.some(({ sql }) => /FROM "fci_app"\.read_production_schema_history/.test(sql)),
      false,
    );
  }
});

test("fails readiness for missing, overbroad, delegable, or unexpected table access", async () => {
  const base = expectedRuntimePrivilegeRows();
  const deniedAuditSelect = base.findIndex(
    ({ tableName, privilege }) => tableName === "audit_events" && privilege === "SELECT",
  );
  const requiredUserSelect = base.findIndex(
    ({ tableName, privilege }) => tableName === "users" && privilege === "SELECT",
  );

  const cases = [
    base.map((row, index) => index === requiredUserSelect ? { ...row, relationExists: false } : row),
    base.map((row, index) => index === requiredUserSelect ? { ...row, hasPrivilege: false } : row),
    base.map((row, index) => index === deniedAuditSelect ? { ...row, hasPrivilege: true } : row),
    base.map((row, index) => index === deniedAuditSelect ? { ...row, hasColumnPrivilege: true } : row),
    base.map((row, index) => index === requiredUserSelect ? { ...row, hasGrantOption: true } : row),
    base.map((row, index) => index === requiredUserSelect ? { ...row, hasColumnGrantOption: true } : row),
    [...base, {
      tableName: "unreviewed_table",
      privilege: "SELECT",
      shouldHave: false,
      relationExists: true,
      hasPrivilege: false,
      hasColumnPrivilege: false,
      hasGrantOption: false,
      hasColumnGrantOption: false,
    }],
  ];

  for (const runtimePrivileges of cases) {
    const { database, queries } = readyDatabase({ runtimePrivileges });
    const probe = createDatabaseReadinessProbe({ database, schema: "fci_app", cacheTtlMs: 0 });
    assert.equal(await probe.check(), false);
    assert.equal(queries.some(({ sql }) => /FROM "fci_app"\.read_production_schema_history/.test(sql)), false);
  }
});

test("fails readiness for missing, changed, reordered, or future migration history", async () => {
  const expected = EXPECTED_PRODUCTION_SCHEMA_HISTORY.map((row) => ({ ...row }));
  const histories = [
    expected.slice(0, 1),
    expected.map((row, index) => index === 0 ? { ...row, checksum: `sha256:${"0".repeat(64)}` } : row),
    [...expected].reverse(),
    [...expected, {
      version: expected.at(-1).version + 1,
      name: "future",
      checksum: `sha256:${"1".repeat(64)}`,
    }],
  ];

  for (const history of histories) {
    const { database } = readyDatabase({ history });
    const probe = createDatabaseReadinessProbe({ database, schema: "fci_app", cacheTtlMs: 0 });
    assert.equal(await probe.check(), false);
  }
});

test("coalesces concurrent checks, caches briefly, and never exposes query failures", async () => {
  let now = 1_000;
  let permissionQueries = 0;
  let releasePermission;
  const permissionGate = new Promise((resolve) => {
    releasePermission = resolve;
  });
  const database = {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes("has_schema_privilege")) {
            permissionQueries += 1;
            await permissionGate;
            return result([{
              has_usage: true,
              has_usage_grant_option: false,
              has_create: false,
              can_set_migration_owner: false,
              can_set_rehearsal_importer: false,
              has_sequence_access: false,
              history_reader_exists: true,
              history_reader_security_definer: true,
              history_reader_owner: true,
              history_reader_fixed_search_path: true,
              has_history_reader_execute: true,
              has_history_reader_grant_option: false,
              has_unreviewed_function_execute: false,
            }]);
          }
          if (sql.includes("expected_update_columns")) {
            return result(expectedRuntimeColumnUpdateRows());
          }
          if (sql.includes("has_table_privilege")) {
            return result(expectedRuntimePrivilegeRows());
          }
          if (sql.includes("read_production_schema_history")) {
            return result(EXPECTED_PRODUCTION_SCHEMA_HISTORY.map((row) => ({ ...row })));
          }
          return result([]);
        },
        release() {},
      };
    },
  };
  const probe = createDatabaseReadinessProbe({
    database,
    schema: "fci_app",
    cacheTtlMs: 100,
    now: () => now,
  });

  const first = probe.check();
  const second = probe.check();
  assert.equal(first, second);
  releasePermission();
  assert.equal(await first, true);
  assert.equal(permissionQueries, 1);
  assert.equal(await probe.check(), true);
  assert.equal(permissionQueries, 1);

  now += 101;
  assert.equal(await probe.check(), true);
  assert.equal(permissionQueries, 2);

  const failure = createDatabaseReadinessProbe({
    database: {
      async connect() {
        return {
          query: async () => { throw new Error("postgresql://secret@example.invalid"); },
          release() {},
        };
      },
    },
    schema: "fci_app",
    cacheTtlMs: 0,
  });
  assert.equal(await failure.check(), false);
});

test("rolls back a failed readiness transaction and discards a client when rollback is uncertain", async () => {
  for (const rollbackFails of [false, true]) {
    const queries = [];
    const releases = [];
    const queryFailure = new Error("readiness query failed");
    const rollbackFailure = new Error("rollback state unknown");
    const database = {
      async connect() {
        return {
          async query(sql) {
            queries.push(sql.trim());
            if (sql.includes("has_schema_privilege")) throw queryFailure;
            if (sql.trim() === "ROLLBACK" && rollbackFails) throw rollbackFailure;
            return result([]);
          },
          release(error) {
            releases.push(error);
          },
        };
      },
    };
    const probe = createDatabaseReadinessProbe({
      database,
      schema: "fci_app",
      cacheTtlMs: 0,
      statementTimeoutMs: 800,
    });

    assert.equal(await probe.check(), false);
    assert.deepEqual(queries.slice(0, 2), [
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = '800ms'",
    ]);
    assert.match(queries[2], /^(?:SELECT|WITH)/);
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.deepEqual(releases, [rollbackFails ? rollbackFailure : undefined]);
  }
});

test("rejects an unsafe schema before issuing any query", () => {
  assert.throws(
    () => createDatabaseReadinessProbe({
      database: { connect: async () => { throw new Error("must not connect"); } },
      schema: "fci-app; DROP SCHEMA public",
    }),
    /lowercase PostgreSQL identifier/,
  );
});
