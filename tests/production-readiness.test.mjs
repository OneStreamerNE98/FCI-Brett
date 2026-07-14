import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabaseReadinessProbe,
  EXPECTED_PRODUCTION_SCHEMA_HISTORY,
} from "../app/platform/google-cloud/database-readiness.ts";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
} from "../app/platform/postgres/production-schema-migrations.ts";

function result(rows) {
  return { rows, rowCount: rows.length };
}

function readyDatabase(overrides = {}) {
  const queries = [];
  const releases = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values: [...values] });
      assert.match(sql.trim(), /^(?:BEGIN READ ONLY|SET LOCAL statement_timeout|SELECT\b|COMMIT|ROLLBACK)/);
      assert.doesNotMatch(sql.trim(), /^(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i);
      if (/^(?:BEGIN READ ONLY|SET LOCAL statement_timeout|COMMIT|ROLLBACK)/.test(sql.trim())) {
        return result([]);
      }
      if (sql.includes("has_schema_privilege")) {
        return result([{
          has_usage: overrides.hasUsage ?? true,
          has_create: overrides.hasCreate ?? false,
        }]);
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

test("requires runtime USAGE without CREATE and an exact complete migration history", async () => {
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
    "SELECT",
    "SELECT version, name, checksum",
    "COMMIT",
  ]);
  assert.deepEqual(queries[2].values, ["fci_app"]);
  assert.match(queries[3].sql, /FROM "fci_app"\.production_schema_migrations/);
  assert.match(queries[3].sql, /ORDER BY version/);
  assert.deepEqual(releases, [undefined]);
});

test("fails readiness when schema privilege is too weak or too broad", async () => {
  for (const permissions of [
    { hasUsage: false, hasCreate: false },
    { hasUsage: true, hasCreate: true },
  ]) {
    const { database, queries } = readyDatabase(permissions);
    const probe = createDatabaseReadinessProbe({ database, schema: "fci_app", cacheTtlMs: 0 });
    assert.equal(await probe.check(), false);
    assert.equal(
      queries.filter(({ sql }) => /production_schema_migrations/.test(sql)).length,
      0,
      "history must not be read for an invalid runtime role",
    );
  }
});

test("fails readiness for missing, changed, reordered, or future migration history", async () => {
  const expected = EXPECTED_PRODUCTION_SCHEMA_HISTORY.map((row) => ({ ...row }));
  const histories = [
    expected.slice(0, 1),
    expected.map((row, index) => index === 0 ? { ...row, checksum: `sha256:${"0".repeat(64)}` } : row),
    [...expected].reverse(),
    [...expected, { version: 3, name: "future", checksum: `sha256:${"1".repeat(64)}` }],
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
            return result([{ has_usage: true, has_create: false }]);
          }
          if (sql.includes("production_schema_migrations")) {
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
    assert.match(queries[2], /^SELECT/);
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
