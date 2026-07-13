import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createPilotSchemaEnsurer,
  PILOT_SCHEMA_HISTORY_SQL,
  PILOT_SCHEMA_MIGRATIONS,
  runPilotSchemaMigrations,
} from "../app/platform/pilot-schema-migrations.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const appRoot = join(root, "app");
const migrationModule = join(appRoot, "platform", "pilot-schema-migrations.ts");
const productionMigrationModule = join(
  appRoot,
  "platform",
  "postgres",
  "production-schema-migrations.ts",
);
const versionInsertPattern = /^INSERT INTO pilot_schema_migrations\b/i;

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  first() {
    return this.database.first(this);
  }
}

class FakePilotDatabase {
  constructor({ appliedVersions = [], failPattern, failuresRemaining = 0 } = {}) {
    this.appliedVersions = new Map(
      appliedVersions.map(({ version, name }) => [version, name]),
    );
    this.batches = [];
    this.failPattern = failPattern;
    this.failuresRemaining = failuresRemaining;
    this.recordedVersions = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async first(statement) {
    assert.match(statement.sql, /^SELECT version, name FROM pilot_schema_migrations WHERE version = \?/i);
    const version = Number(statement.values[0]);
    const name = this.appliedVersions.get(version);
    return name ? { version, name } : null;
  }

  async batch(statements) {
    const snapshot = statements.map((statement) => ({
      sql: statement.sql,
      values: [...statement.values],
    }));
    this.batches.push(snapshot);

    const shouldFail =
      this.failuresRemaining > 0 &&
      snapshot.some((statement) => this.failPattern?.test(statement.sql));
    if (shouldFail) {
      this.failuresRemaining -= 1;
      throw new Error("simulated D1 batch failure");
    }

    for (const statement of snapshot) {
      if (!versionInsertPattern.test(statement.sql)) continue;
      const version = Number(statement.values[0]);
      if (!this.appliedVersions.has(version)) this.recordedVersions.push(version);
      if (!this.appliedVersions.has(version)) {
        this.appliedVersions.set(version, String(statement.values[1]));
      }
    }

    return snapshot.map(() => ({ meta: { changes: 1 } }));
  }
}

const sampleMigrations = [
  {
    version: 1,
    name: "first",
    statements: ["CREATE TABLE IF NOT EXISTS first_table (id TEXT PRIMARY KEY)"],
  },
  {
    version: 2,
    name: "second",
    statements: ["CREATE TABLE IF NOT EXISTS second_table (id TEXT PRIMARY KEY)"],
  },
  {
    version: 3,
    name: "third",
    statements: ["CREATE INDEX IF NOT EXISTS third_idx ON first_table(id)"],
  },
];

function migrationBatches(database) {
  return database.batches.filter((batch) =>
    batch.some((statement) => /(?:first_table|second_table|third_idx)/.test(statement.sql)),
  );
}

test("runs pilot migrations in order and records each version last in the same batch", async () => {
  const database = new FakePilotDatabase();

  await runPilotSchemaMigrations(database, sampleMigrations, () => 1_234);

  assert.deepEqual(database.recordedVersions, [1, 2, 3]);
  assert.deepEqual(
    migrationBatches(database).map((batch) => batch[0].sql),
    sampleMigrations.map((migration) => migration.statements[0]),
  );
  for (const batch of migrationBatches(database)) {
    assert.match(batch.at(-1).sql, versionInsertPattern);
    assert.equal(batch.at(-1).values[2], 1_234);
  }
});

test("skips versions already applied to an existing pilot database", async () => {
  const database = new FakePilotDatabase({
    appliedVersions: [
      { version: 1, name: "first" },
      { version: 2, name: "second" },
    ],
  });

  await runPilotSchemaMigrations(database, sampleMigrations);

  assert.deepEqual(database.recordedVersions, [3]);
  assert.equal(migrationBatches(database).length, 1);
  assert.match(migrationBatches(database)[0][0].sql, /third_idx/);
});

test("does not record or continue past a failed migration batch", async () => {
  const database = new FakePilotDatabase({
    failPattern: /second_table/,
    failuresRemaining: 1,
  });

  await assert.rejects(
    runPilotSchemaMigrations(database, sampleMigrations),
    /migration 2 \(second\) failed and was not recorded/,
  );

  assert.deepEqual(database.recordedVersions, [1]);
  assert.equal(database.appliedVersions.has(2), false);
  assert.equal(database.batches.some((batch) => batch.some((statement) => /third_idx/.test(statement.sql))), false);
});

test("surfaces unique-index conflicts instead of marking the baseline complete", async () => {
  const database = new FakePilotDatabase({
    failPattern: /clients_code_unique_idx/,
    failuresRemaining: 1,
  });

  await assert.rejects(
    runPilotSchemaMigrations(database, PILOT_SCHEMA_MIGRATIONS.slice(0, 1)),
    /UNIQUE failures mean existing pilot values conflict with a required index/,
  );

  assert.deepEqual(database.recordedVersions, []);
  assert.equal(database.appliedVersions.has(1), false);
});

test("rejects an applied version whose immutable migration name changed", async () => {
  const database = new FakePilotDatabase({
    appliedVersions: [{ version: 1, name: "unexpected-history" }],
  });

  await assert.rejects(
    runPilotSchemaMigrations(database, sampleMigrations.slice(0, 1)),
    /history mismatch: expected first, found unexpected-history/,
  );
  assert.deepEqual(database.recordedVersions, []);
});

test("coalesces concurrent first requests and retries after a failed ensure", async () => {
  const database = new FakePilotDatabase();
  const ensure = createPilotSchemaEnsurer(database, sampleMigrations);
  const first = ensure();
  const second = ensure();

  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  await ensure();
  assert.equal(database.batches.filter((batch) => batch[0].sql === PILOT_SCHEMA_HISTORY_SQL).length, 1);

  const retryDatabase = new FakePilotDatabase({
    failPattern: /first_table/,
    failuresRemaining: 1,
  });
  const retryEnsure = createPilotSchemaEnsurer(retryDatabase, sampleMigrations.slice(0, 1));

  await assert.rejects(retryEnsure(), /failed and was not recorded/);
  await retryEnsure();
  assert.deepEqual(retryDatabase.recordedVersions, [1]);
  assert.equal(migrationBatches(retryDatabase).length, 2);
});

test("keeps the complete pilot baseline additive and enforces legacy identifiers", () => {
  const schemaSql = [
    PILOT_SCHEMA_HISTORY_SQL,
    ...PILOT_SCHEMA_MIGRATIONS.flatMap((migration) => migration.statements),
  ];
  const combined = schemaSql.join("\n");

  for (const sql of schemaSql) {
    assert.match(sql, /^CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS\b/);
  }
  assert.doesNotMatch(combined, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.match(combined, /CREATE TABLE IF NOT EXISTS webhook_receipts/);
  assert.match(combined, /CREATE UNIQUE INDEX IF NOT EXISTS clients_code_unique_idx ON clients\(client_code\)/);
  assert.match(combined, /CREATE UNIQUE INDEX IF NOT EXISTS projects_number_unique_idx ON projects\(project_number\)/);
  assert.match(combined, /CREATE TABLE IF NOT EXISTS records/);
});

function captures(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("keeps the runtime pilot bridge in parity with Drizzle schema/history artifacts", async () => {
  const schemaSource = await readFile(join(root, "db", "schema.ts"), "utf8");
  const drizzleDirectory = join(root, "drizzle");
  const drizzleEntries = await readdir(drizzleDirectory, { withFileTypes: true });
  const drizzleSources = await Promise.all(
    drizzleEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => readFile(join(drizzleDirectory, entry.name), "utf8")),
  );
  const drizzleSource = drizzleSources.join("\n");
  const runtimeSql = PILOT_SCHEMA_MIGRATIONS.flatMap((migration) => migration.statements).join("\n");

  const runtimeTables = new Set(captures(runtimeSql, /CREATE TABLE IF NOT EXISTS ([a-z0-9_]+)/gi));
  const declaredTables = new Set([
    ...captures(schemaSource, /sqliteTable\("([a-z0-9_]+)"/gi),
    ...captures(drizzleSource, /CREATE TABLE [`"]?([a-z0-9_]+)[`"]?/gi),
  ]);
  const missingTables = [...declaredTables].filter((table) => !runtimeTables.has(table)).sort();

  const runtimeIndexes = new Set(
    captures(runtimeSql, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z0-9_]+)/gi),
  );
  const declaredIndexes = new Set([
    ...captures(schemaSource, /(?:uniqueIndex|index)\("([a-z0-9_]+)"/gi),
    ...captures(drizzleSource, /CREATE (?:UNIQUE )?INDEX [`"]?([a-z0-9_]+)[`"]?/gi),
  ]);
  const missingIndexes = [...declaredIndexes].filter((index) => !runtimeIndexes.has(index)).sort();

  assert.deepEqual(missingTables, []);
  assert.deepEqual(missingIndexes, []);
});

async function runtimeSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await runtimeSourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }

  return files;
}

test("keeps pilot runtime DDL out of routes and isolated from production PostgreSQL DDL", async () => {
  const files = await runtimeSourceFiles(appRoot);
  const violations = [];

  for (const path of files) {
    if (path === migrationModule || path === productionMigrationModule) continue;
    const source = await readFile(path, "utf8");
    if (/\bCREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b/i.test(source)) {
      violations.push(relative(root, path).replaceAll("\\", "/"));
    }
  }

  assert.deepEqual(violations, []);
});
