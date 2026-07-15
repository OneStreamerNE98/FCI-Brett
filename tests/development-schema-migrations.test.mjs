import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureWorkspaceSchema } from "../app/api/v1/_workspace-data.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const appRoot = join(root, "app");
const productionMigrationModules = new Set([
  join(appRoot, "platform", "postgres", "production-schema-migrations.ts"),
  join(appRoot, "platform", "postgres", "production-persistence-schema.ts"),
]);
const drizzleRoot = join(root, "drizzle");
const packagedDrizzleRoot = join(root, "dist", ".openai", "drizzle");
const integrityIndexMigration = "0011_lazy_big_bertha.sql";

const requiredDevelopmentIndexes = [
  "clients_code_unique_idx",
  "clients_name_idx",
  "contacts_client_idx",
  "filing_rules_priority_idx",
  "google_integration_events_created_idx",
  "mail_items_status_idx",
  "projects_number_unique_idx",
  "projects_client_idx",
  "records_type_idx",
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }

  return files;
}

async function migrationFiles(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

test("keeps the normal request schema helper free of D1 and schema DDL", async () => {
  const source = await readFile(join(appRoot, "api", "v1", "_workspace-data.ts"), "utf8");

  assert.doesNotMatch(source, /cloudflare:workers|development-schema-migrations|env\.DB|\.prepare\(|\.batch\(/);
  assert.doesNotMatch(source, /\bCREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b/i);
  await Promise.all([ensureWorkspaceSchema(), ensureWorkspaceSchema(), ensureWorkspaceSchema()]);
});

test("keeps local schema setup explicit and restricted to the local D1 database", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const localConfig = JSON.parse(await readFile(join(root, "wrangler.local.jsonc"), "utf8"));
  const [database] = localConfig.d1_databases;

  assert.match(packageJson.scripts["db:migrate:local"], /d1 migrations apply DB --local/);
  assert.doesNotMatch(packageJson.scripts["db:migrate:local"], /--remote/);
  assert.equal(database.binding, "DB");
  assert.equal(database.database_id, "00000000-0000-4000-8000-000000000000");
  assert.equal(database.migrations_dir, "drizzle");
});

test("keeps all application runtime modules free of schema DDL", async () => {
  const files = await sourceFiles(appRoot);
  const violations = [];

  for (const path of files) {
    if (productionMigrationModules.has(path)) continue;
    const source = await readFile(path, "utf8");
    if (/\bCREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b/i.test(source)) {
      violations.push(relative(root, path).replaceAll("\\", "/"));
    }
  }

  assert.deepEqual(violations, []);
});

test("keeps development data integrity and lookup indexes in the versioned Drizzle sequence", async () => {
  const files = await migrationFiles(drizzleRoot);
  const sources = await Promise.all(files.map((file) => readFile(join(drizzleRoot, file), "utf8")));
  const migrationSql = sources.join("\n");
  const integrityIndexSql = await readFile(join(drizzleRoot, integrityIndexMigration), "utf8");
  const schemaSource = await readFile(join(root, "db", "schema.ts"), "utf8");
  const journal = JSON.parse(await readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8"));
  const journalTags = journal.entries.map((entry) => entry.tag);

  assert.deepEqual(journalTags, files.map((file) => basename(file, ".sql")));
  for (const indexName of requiredDevelopmentIndexes) {
    assert.match(migrationSql, new RegExp("CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?`" + indexName + "`"));
    assert.match(schemaSource, new RegExp(`(?:uniqueIndex|index)\\("${indexName}"\\)`));
  }

  assert.ok(files.includes(integrityIndexMigration));
  assert.doesNotMatch(integrityIndexSql, /\b(?:ALTER|DROP|DELETE|TRUNCATE)\b/i);
  for (const indexName of requiredDevelopmentIndexes) {
    assert.match(integrityIndexSql, new RegExp("INDEX IF NOT EXISTS `" + indexName + "`"));
  }
});

test("packages the complete Drizzle migration sequence for Sites deployment", async () => {
  const sourceFiles = await migrationFiles(drizzleRoot);
  const packagedFiles = await migrationFiles(packagedDrizzleRoot);
  const sourceJournal = await readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8");
  const packagedJournal = await readFile(join(packagedDrizzleRoot, "meta", "_journal.json"), "utf8");
  const sourceHosting = await readFile(join(root, ".openai", "hosting.json"), "utf8");
  const packagedHosting = await readFile(join(root, "dist", ".openai", "hosting.json"), "utf8");

  assert.deepEqual(packagedFiles, sourceFiles);
  assert.equal(packagedJournal, sourceJournal);
  assert.equal(packagedHosting, sourceHosting);
});
