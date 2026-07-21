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
  join(appRoot, "platform", "postgres", "admin-access-persistence-schema.ts"),
  join(appRoot, "platform", "postgres", "admin-audit-activity-schema.ts"),
  join(appRoot, "platform", "postgres", "lead-project-meeting-schema.ts"),
]);
const drizzleRoot = join(root, "drizzle");
const packagedDrizzleRoot = join(root, "dist", ".openai", "drizzle");
const integrityIndexMigration = "0011_lazy_big_bertha.sql";
const workspaceResourceMigrationPrefix = "0013_";
const workspaceBlueprintMigrationPrefix = "0015_";

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

test("keeps the SET-13 Workspace registry in one additive migration with its unique identity", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(workspaceResourceMigrationPrefix));
  assert.ok(migration, "migration 0013 must exist");
  assert.equal(files.filter((file) => file.startsWith(workspaceResourceMigrationPrefix)).length, 1);

  const migrationSql = await readFile(join(drizzleRoot, migration), "utf8");
  const schemaSource = await readFile(join(root, "db", "schema.ts"), "utf8");
  const effectiveConfigSource = await readFile(join(root, "app", "lib", "workspace-effective-config.ts"), "utf8");
  assert.match(migrationSql, /CREATE TABLE `workspace_resources`/);
  for (const column of [
    ["id", "text PRIMARY KEY NOT NULL"],
    ["connection_key", "text NOT NULL"],
    ["resource_type", "text NOT NULL"],
    ["resource_key", "text NOT NULL"],
    ["external_id", "text NOT NULL"],
    ["parent_external_id", "text"],
    ["external_url", "text"],
    ["origin", "text NOT NULL"],
    ["metadata_json", "text NOT NULL"],
    ["created_by", "text NOT NULL"],
    ["created_at", "integer NOT NULL"],
    ["updated_at", "integer NOT NULL"],
  ]) {
    assert.match(migrationSql, new RegExp("`" + column[0] + "` " + column[1] + "(?:,|\\s)"));
  }
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX `workspace_resources_connection_type_key_unique` ON `workspace_resources` \(`connection_key`,`resource_type`,`resource_key`\)/,
  );
  assert.doesNotMatch(migrationSql, /\b(?:ALTER|DROP|DELETE|TRUNCATE)\b/i);
  assert.match(schemaSource, /export const workspaceResources = sqliteTable\("workspace_resources"/);
  assert.match(schemaSource, /uniqueIndex\("workspace_resources_connection_type_key_unique"\)/);
  for (const resourceType of ["drive.shared-drive", "drive.folder", "drive.file", "sheets.spreadsheet", "calendar.calendar"]) {
    assert.match(effectiveConfigSource, new RegExp(`"${resourceType.replace(".", "\\.")}"`));
  }
  for (const origin of ["created", "adopted", "env-adopted"]) {
    assert.match(effectiveConfigSource, new RegExp(`"${origin}"`));
  }
});

test("keeps the SET-14 Workspace blueprint in chained migration 0015 with one current row per connection", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(workspaceBlueprintMigrationPrefix));
  assert.equal(migration, "0015_stale_zarda.sql");
  assert.equal(files.filter((file) => file.startsWith(workspaceBlueprintMigrationPrefix)).length, 1);

  const [migrationSql, schemaSource, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(root, "db", "schema.ts"), "utf8"),
    readFile(join(drizzleRoot, "meta", "0014_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0015_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);

  assert.match(migrationSql, /CREATE TABLE `workspace_blueprints`/);
  for (const column of [
    ["id", "text PRIMARY KEY NOT NULL"],
    ["connection_key", "text NOT NULL"],
    ["version", "integer NOT NULL"],
    ["blueprint_json", "text NOT NULL"],
    ["created_by", "text NOT NULL"],
    ["created_at", "integer NOT NULL"],
    ["updated_by", "text NOT NULL"],
    ["updated_at", "integer NOT NULL"],
  ]) {
    assert.match(migrationSql, new RegExp("`" + column[0] + "` " + column[1] + "(?:,|\\s)"));
  }
  assert.match(migrationSql, /CREATE UNIQUE INDEX `workspace_blueprints_connection_unique` ON `workspace_blueprints` \(`connection_key`\)/);
  assert.doesNotMatch(migrationSql, /\b(?:ALTER|DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME)\b/i);
  assert.match(schemaSource, /export const workspaceBlueprints = sqliteTable\("workspace_blueprints"/);
  assert.match(schemaSource, /uniqueIndex\("workspace_blueprints_connection_unique"\)/);

  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.equal(Object.keys(snapshot.tables).length, 23);
  assert.ok(snapshot.tables.workspace_blueprints);
  for (const column of ["installation_started_at", "installation_completed_at", "had_callback", "callback_note"]) {
    assert.ok(snapshot.tables.projects.columns[column], `0015 must preserve KPI-03 column ${column}`);
  }
  assert.deepEqual(journal.entries.at(-1), {
    idx: 15,
    version: "6",
    when: journal.entries.at(-1).when,
    tag: "0015_stale_zarda",
    breakpoints: true,
  });
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
