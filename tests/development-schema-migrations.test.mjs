import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  join(appRoot, "platform", "postgres", "settings-persistence-schema.ts"),
  join(appRoot, "platform", "postgres", "task-schema.ts"),
  join(appRoot, "platform", "postgres", "core-record-concurrency-schema.ts"),
  join(appRoot, "platform", "postgres", "mail-item-analysis-schema.ts"),
  join(appRoot, "platform", "postgres", "google-form-lead-intake-schema.ts"),
  join(appRoot, "platform", "postgres", "address-validation-schema.ts"),
  join(appRoot, "platform", "postgres", "assistant-label-schema.ts"),
]);
const drizzleRoot = join(root, "drizzle");
const packagedDrizzleRoot = join(root, "dist", ".openai", "drizzle");
const integrityIndexMigration = "0011_lazy_big_bertha.sql";
const workspaceResourceMigrationPrefix = "0013_";
const workspaceBlueprintMigrationPrefix = "0015_";
const userSettingsMigrationPrefix = "0016_";
const pageLayoutsMigrationPrefix = "0017_";
const tasksMigrationPrefix = "0018_";
const projectSegmentMigrationPrefix = "0019_";
const coreRecordConcurrencyMigrationPrefix = "0020_";
const mailItemAnalysisMigrationPrefix = "0021_";
const clientNormalizedNameMigrationPrefix = "0022_";
const googleFormLeadIntakeMigrationPrefix = "0023_";
const addressValidationMigrationPrefix = "0024_";
const assistantLabelMigrationPrefix = "0025_";
const mailItemReviewAttributionMigrationPrefix = "0026_";
const sharedMailboxMigrationPrefix = "0027_";
const allowedDestructiveMigrations = new Map([
  [
    "0008_strong_korg.sql",
    { exactSql: "ALTER TABLE `user_preferences` DROP COLUMN `personal_calendar_display`;" },
  ],
  [
    "0027_shiny_red_ghost.sql",
    { normalizedSha256: "a80d490307f45abf8a3267ddeb9d83cc2407bbc6766837d4b505bedccd7dc08e" },
  ],
]);

const integrityIndexNames = [
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
const requiredDevelopmentIndexes = [
  ...integrityIndexNames,
  "tasks_project_status_idx",
  "tasks_status_due_date_idx",
  "mail_items_profile_message_unique",
  "mail_items_profile_status_idx",
  "clients_normalized_name_key_unique_idx",
  "google_form_lead_watermarks_scope_unique",
  "google_form_lead_reviews_submission_unique",
  "google_form_lead_reviews_queue_idx",
  "google_connections_google_subject_unique",
  "google_connections_google_email_lower_unique",
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
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function migrationSources(directory) {
  const files = await migrationFiles(directory);
  return Promise.all(files.map(async (file) => ({
    file,
    sql: await readFile(join(directory, file), "utf8"),
  })));
}

function sqlWithoutLiteralsOrComments(sql) {
  let output = "";
  for (let index = 0; index < sql.length;) {
    if (sql[index] === "'") {
      output += "''";
      index += 1;
      while (index < sql.length) {
        if (sql[index] !== "'") {
          index += 1;
          continue;
        }
        if (sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      continue;
    }
    if (sql[index] === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
      output += "\n";
      continue;
    }
    if (sql[index] === "/" && sql[index + 1] === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index = Math.min(sql.length, index + 2);
      output += " ";
      continue;
    }
    output += sql[index];
    index += 1;
  }
  return output;
}

function destructiveDdlStatements(sql) {
  return sqlWithoutLiteralsOrComments(sql)
    .split(";")
    .map((statement) => statement.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .filter((statement) => {
      if (/^(?:DROP|TRUNCATE)\b/iu.test(statement)) return true;
      if (/^CREATE\s+OR\s+REPLACE\b/iu.test(statement)) return true;
      if (!/^ALTER\b/iu.test(statement)) return false;
      return !/^ALTER\s+TABLE\s+(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_.]*)\s+ADD(?:\s+COLUMN)?\s+/iu.test(statement);
    });
}

function assertNoUnexpectedDestructiveDdl(migrations) {
  const violations = [];
  for (const { file, sql } of migrations) {
    const destructiveStatements = destructiveDdlStatements(sql);
    if (destructiveStatements.length === 0) continue;
    const allowedMigration = allowedDestructiveMigrations.get(file);
    const normalizedSql = sql.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
    if (
      allowedMigration?.exactSql === sql.trim()
      || allowedMigration?.normalizedSha256 === createHash("sha256").update(normalizedSql).digest("hex")
    ) continue;
    for (const statement of destructiveStatements) violations.push({ file, statement });
  }
  assert.deepEqual(
    violations,
    [],
    `Unexpected destructive DDL:\n${violations.map(({ file, statement }) => `${file}: ${statement}`).join("\n")}`,
  );
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

  for (const file of files) assert.match(file, /^\d{4}_.+\.sql$/u);
  assert.deepEqual(journalTags, files.map((file) => basename(file, ".sql")));
  for (const indexName of requiredDevelopmentIndexes) {
    assert.match(migrationSql, new RegExp("CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?`" + indexName + "`"));
    assert.match(schemaSource, new RegExp(`(?:uniqueIndex|index)\\("${indexName}"\\)`));
  }

  assert.ok(files.includes(integrityIndexMigration));
  assert.doesNotMatch(integrityIndexSql, /\b(?:ALTER|DROP|DELETE|TRUNCATE)\b/i);
  for (const indexName of integrityIndexNames) {
    assert.match(integrityIndexSql, new RegExp("INDEX IF NOT EXISTS `" + indexName + "`"));
  }
});

test("keeps the complete Drizzle migration chain free of new destructive DDL", async () => {
  assertNoUnexpectedDestructiveDdl(await migrationSources(drizzleRoot));
});

test("the Drizzle guard discovers and rejects a synthetic destructive migration", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fci-fix06-migrations-"));
  try {
    await writeFile(
      join(temporaryRoot, "manual_destructive.sql"),
      "-- don't hide this guard\nDROP TABLE `clients`;\nSELECT 'sentinel';",
      "utf8",
    );
    const migrations = await migrationSources(temporaryRoot);
    assert.deepEqual(migrations.map(({ file }) => file), ["manual_destructive.sql"]);
    assert.throws(
      () => assertNoUnexpectedDestructiveDdl(migrations),
      /manual_destructive\.sql: DROP TABLE `clients`/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the Drizzle guard covers destructive DDL forms without rejecting quoted names", () => {
  for (const [file, sql] of [
    ["drop_column.sql", "ALTER TABLE `clients` DROP COLUMN `status`;"],
    ["drop_index.sql", "DROP INDEX `clients_name_idx`;"],
    ["truncate.sql", "TRUNCATE TABLE `clients`;"],
    ["rename.sql", "ALTER TABLE `clients` RENAME TO `former_clients`;"],
    ["replace.sql", "CREATE OR REPLACE VIEW `client_names` AS SELECT `name` FROM `clients`;"],
  ]) {
    assert.throws(() => assertNoUnexpectedDestructiveDdl([{ file, sql }]), new RegExp(file, "u"));
  }
  assert.doesNotThrow(() => assertNoUnexpectedDestructiveDdl([{
    file: "quoted_drop_identifier.sql",
    sql: "ALTER TABLE `clients` ADD COLUMN `drop` text DEFAULT 'DROP TABLE ignored';",
  }]));
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
  assert.deepEqual(journal.entries.at(15), {
    idx: 15,
    version: "6",
    when: journal.entries.at(15).when,
    tag: "0015_stale_zarda",
    breakpoints: true,
  });
});

test("keeps SET-28 per-user notification preferences in additive migration 0016", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(userSettingsMigrationPrefix));
  assert.equal(migration, "0016_melted_goblin_queen.sql");
  assert.equal(files.filter((file) => file.startsWith(userSettingsMigrationPrefix)).length, 1);

  const [migrationSql, schemaSource, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(root, "db", "schema.ts"), "utf8"),
    readFile(join(drizzleRoot, "meta", "0015_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0016_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);

  assert.match(migrationSql, /^ALTER TABLE `user_preferences` ADD `notification_preferences_json` text DEFAULT '.+' NOT NULL;\s*$/u);
  assert.doesNotMatch(migrationSql, /\b(?:DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME)\b/iu);
  assert.match(schemaSource, /notificationPreferencesJson: text\("notification_preferences_json"\)\.notNull\(\)\.default\(/u);
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.equal(Object.keys(snapshot.tables).length, 23);
  assert.deepEqual(snapshot.tables.user_preferences.columns.notification_preferences_json, {
    name: "notification_preferences_json",
    type: "text",
    primaryKey: false,
    notNull: true,
    autoincrement: false,
    default: "'{\"lead.created\":false,\"gmail.filing_review_needed\":false,\"calendar.schedule_changed\":false,\"project.warranty_follow_up_due\":false}'",
  });
  const journalEntry = journal.entries.find(({ tag }) => tag === "0016_melted_goblin_queen");
  assert.deepEqual(journalEntry, {
    idx: 16,
    version: "6",
    when: journalEntry.when,
    tag: "0016_melted_goblin_queen",
    breakpoints: true,
  });
});

test("keeps SET-35 per-user page layouts in the current additive migration", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(pageLayoutsMigrationPrefix));
  assert.equal(migration, "0017_sleepy_natasha_romanoff.sql");
  assert.equal(files.filter((file) => file.startsWith(pageLayoutsMigrationPrefix)).length, 1);

  const [migrationSql, schemaSource, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(root, "db", "schema.ts"), "utf8"),
    readFile(join(drizzleRoot, "meta", "0016_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0017_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);

  assert.match(migrationSql, /^ALTER TABLE `user_preferences` ADD `page_layouts_json` text DEFAULT '\{\}' NOT NULL;\s*$/u);
  assert.doesNotMatch(migrationSql, /\b(?:DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME)\b/iu);
  assert.match(schemaSource, /pageLayoutsJson: text\("page_layouts_json"\)\.notNull\(\)\.default\("\{\}"\)/u);
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.deepEqual(Object.keys(snapshot.tables).sort(), Object.keys(previousSnapshot.tables).sort());
  assert.deepEqual(snapshot.tables.user_preferences.columns.page_layouts_json, {
    name: "page_layouts_json",
    type: "text",
    primaryKey: false,
    notNull: true,
    autoincrement: false,
    default: "'{}'",
  });
  const journalEntry = journal.entries.find(({ tag }) => tag === "0017_sleepy_natasha_romanoff");
  assert.deepEqual(journalEntry, {
    idx: 17,
    version: "6",
    when: journalEntry.when,
    tag: "0017_sleepy_natasha_romanoff",
    breakpoints: true,
  });
});

test("keeps AI-01 tasks in one additive migration with the closed schema and indexes", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(tasksMigrationPrefix));
  assert.equal(migration, "0018_slow_serpent_society.sql");
  assert.equal(files.filter((file) => file.startsWith(tasksMigrationPrefix)).length, 1);

  const [migrationSql, schemaSource, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(root, "db", "schema.ts"), "utf8"),
    readFile(join(drizzleRoot, "meta", "0017_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0018_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);

  assert.match(migrationSql, /^CREATE TABLE `tasks`/u);
  for (const [column, definition] of [
    ["id", "text PRIMARY KEY NOT NULL"],
    ["title", "text NOT NULL"],
    ["details", "text"],
    ["status", "text DEFAULT 'open' NOT NULL"],
    ["due_date", "text"],
    ["project_id", "text"],
    ["lead_id", "text"],
    ["assignee_email", "text"],
    ["source", "text DEFAULT 'manual' NOT NULL"],
    ["source_ref", "text"],
    ["created_by", "text NOT NULL"],
    ["created_at", "integer NOT NULL"],
    ["updated_at", "integer NOT NULL"],
    ["completed_at", "integer"],
  ]) {
    assert.match(migrationSql, new RegExp("`" + column + "` " + definition + "(?:,|\\s)"));
  }
  assert.match(
    migrationSql,
    /CREATE INDEX `tasks_status_due_date_idx` ON `tasks` \(`status`,`due_date`\)/u,
  );
  assert.match(
    migrationSql,
    /CREATE INDEX `tasks_project_status_idx` ON `tasks` \(`project_id`,`status`\)/u,
  );
  assert.doesNotMatch(
    migrationSql,
    /\b(?:ALTER|DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME)\b/iu,
  );
  assert.match(schemaSource, /export const tasks = sqliteTable\("tasks"/u);
  assert.match(schemaSource, /index\("tasks_status_due_date_idx"\)\.on\(table\.status, table\.dueDate\)/u);
  assert.match(schemaSource, /index\("tasks_project_status_idx"\)\.on\(table\.projectId, table\.status\)/u);

  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.equal(Object.keys(snapshot.tables).length, Object.keys(previousSnapshot.tables).length + 1);
  assert.ok(snapshot.tables.tasks);
  assert.deepEqual(Object.keys(snapshot.tables.tasks.columns), [
    "id",
    "title",
    "details",
    "status",
    "due_date",
    "project_id",
    "lead_id",
    "assignee_email",
    "source",
    "source_ref",
    "created_by",
    "created_at",
    "updated_at",
    "completed_at",
  ]);
  const journalEntry = journal.entries.find(({ tag }) => tag === "0018_slow_serpent_society");
  assert.deepEqual(journalEntry, {
    idx: 18,
    version: "6",
    when: journalEntry.when,
    tag: "0018_slow_serpent_society",
    breakpoints: true,
  });
});

test("keeps DES-08 a-T2 project segments in one nullable additive migration", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(projectSegmentMigrationPrefix));
  assert.equal(migration, "0019_demonic_lady_vermin.sql");
  assert.equal(files.filter((file) => file.startsWith(projectSegmentMigrationPrefix)).length, 1);

  const [migrationSql, schemaSource, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(root, "db", "schema.ts"), "utf8"),
    readFile(join(drizzleRoot, "meta", "0018_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0019_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);

  assert.match(migrationSql, /^ALTER TABLE `projects` ADD `segment` text;\s*$/u);
  assert.doesNotMatch(migrationSql, /\b(?:DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME)\b/iu);
  assert.match(schemaSource, /segment: text\("segment"\)/u);
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.deepEqual(Object.keys(snapshot.tables).sort(), Object.keys(previousSnapshot.tables).sort());
  assert.deepEqual(snapshot.tables.projects.columns.segment, {
    name: "segment",
    type: "text",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  });
  const unchangedProjectColumns = Object.fromEntries(
    Object.entries(snapshot.tables.projects.columns).filter(([column]) => column !== "segment"),
  );
  assert.deepEqual(unchangedProjectColumns, previousSnapshot.tables.projects.columns);
  const journalEntry = journal.entries.find(({ tag }) => tag === "0019_demonic_lady_vermin");
  assert.deepEqual(journalEntry, {
    idx: 19,
    version: "6",
    when: journalEntry.when,
    tag: "0019_demonic_lady_vermin",
    breakpoints: true,
  });
});

test("adds one generated D1 version column to each core record table in migration 0020", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(coreRecordConcurrencyMigrationPrefix));
  assert.equal(migration, "0020_core_record_concurrency.sql");
  assert.equal(files.filter((file) => file.startsWith(coreRecordConcurrencyMigrationPrefix)).length, 1);

  const [migrationSql, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(drizzleRoot, "meta", "0019_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0020_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);

  const versionedTables = [
    "clients",
    "contacts",
    "leads",
    "projects",
    "project_meetings",
    "tasks",
  ];
  assert.equal(
    [...migrationSql.matchAll(/ALTER TABLE `([^`]+)` ADD `version` integer DEFAULT 1 NOT NULL;/gu)]
      .map((match) => match[1]).sort().join(","),
    [...versionedTables].sort().join(","),
  );
  assert.doesNotMatch(migrationSql, /\b(?:DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME)\b/iu);
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.deepEqual(Object.keys(snapshot.tables).sort(), Object.keys(previousSnapshot.tables).sort());
  for (const table of versionedTables) {
    assert.deepEqual(snapshot.tables[table].columns.version, {
      name: "version",
      type: "integer",
      primaryKey: false,
      notNull: true,
      autoincrement: false,
      default: 1,
    });
    const unchangedColumns = Object.fromEntries(
      Object.entries(snapshot.tables[table].columns).filter(([column]) => column !== "version"),
    );
    assert.deepEqual(unchangedColumns, previousSnapshot.tables[table].columns);
  }
  const journalEntry = journal.entries.find(({ idx }) => idx === 20);
  assert.deepEqual(journalEntry, {
    idx: 20,
    version: "6",
    when: journalEntry.when,
    tag: "0020_core_record_concurrency",
    breakpoints: true,
  });
});

test("extends mail_items additively for AI-10 in generated migration 0021", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(mailItemAnalysisMigrationPrefix));
  assert.equal(migration, "0021_superb_killer_shrike.sql");
  assert.equal(files.filter((file) => file.startsWith(mailItemAnalysisMigrationPrefix)).length, 1);

  const [migrationSql, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(drizzleRoot, "meta", "0020_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0021_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);
  const addedColumns = [
    "connection_key",
    "analysis_payload",
    "party",
    "confidence",
    "content_hash",
    "label_definition_version",
    "attempted_label_definition_version",
    "subject",
    "sender",
    "received_at",
    "failure_attempts",
    "error_code",
    "coverage_complete",
  ];
  for (const column of addedColumns) {
    assert.match(
      migrationSql,
      new RegExp("ALTER TABLE `mail_items` ADD `" + column + "`", "u"),
    );
  }
  assert.match(
    migrationSql,
    /`connection_key` text DEFAULT 'google-workspace' NOT NULL/u,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX `mail_items_profile_message_unique` ON `mail_items` \(`connection_key`,`gmail_message_id`\)/u,
  );
  assert.match(
    migrationSql,
    /CREATE INDEX `mail_items_profile_status_idx` ON `mail_items` \(`connection_key`,`status`,`updated_at`\)/u,
  );
  assert.doesNotMatch(
    migrationSql,
    /\b(?:DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME|CREATE TABLE)\b/iu,
  );

  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.deepEqual(Object.keys(snapshot.tables).sort(), Object.keys(previousSnapshot.tables).sort());
  const previousMailItem = previousSnapshot.tables.mail_items;
  const mailItem = snapshot.tables.mail_items;
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(mailItem.columns).filter(([column]) => !addedColumns.includes(column)),
    ),
    previousMailItem.columns,
  );
  assert.deepEqual(mailItem.columns.connection_key, {
    name: "connection_key",
    type: "text",
    primaryKey: false,
    notNull: true,
    autoincrement: false,
    default: "'google-workspace'",
  });
  assert.deepEqual(mailItem.columns.failure_attempts.default, 0);
  assert.deepEqual(mailItem.columns.coverage_complete.default, false);
  assert.deepEqual(mailItem.indexes.mail_items_profile_message_unique, {
    name: "mail_items_profile_message_unique",
    columns: ["connection_key", "gmail_message_id"],
    isUnique: true,
  });
  const journalEntry = journal.entries.find(({ idx }) => idx === 21);
  assert.deepEqual(journalEntry, {
    idx: 21,
    version: "6",
    when: journalEntry.when,
    tag: "0021_superb_killer_shrike",
    breakpoints: true,
  });
});

test("adds the nullable atomic D1 client-name key in generated migration 0022", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(clientNormalizedNameMigrationPrefix));
  assert.equal(migration, "0022_mean_darkhawk.sql");
  assert.equal(
    files.filter((file) => file.startsWith(clientNormalizedNameMigrationPrefix)).length,
    1,
  );

  const [migrationSql, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(drizzleRoot, "meta", "0021_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0022_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);
  assert.match(
    migrationSql,
    /ALTER TABLE `clients` ADD `normalized_name_key` text;/u,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX `clients_normalized_name_key_unique_idx` ON `clients` \(`normalized_name_key`\) WHERE "clients"\."normalized_name_key" IS NOT NULL;/u,
  );
  assert.doesNotMatch(
    migrationSql,
    /\b(?:DROP|UPDATE|INSERT|DELETE|TRUNCATE|RENAME|CREATE TABLE)\b/iu,
  );
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.deepEqual(Object.keys(snapshot.tables).sort(), Object.keys(previousSnapshot.tables).sort());
  assert.deepEqual(snapshot.tables.clients.columns.normalized_name_key, {
    name: "normalized_name_key",
    type: "text",
    primaryKey: false,
    notNull: false,
    autoincrement: false,
  });
  assert.deepEqual(snapshot.tables.clients.indexes.clients_normalized_name_key_unique_idx, {
    name: "clients_normalized_name_key_unique_idx",
    columns: ["normalized_name_key"],
    isUnique: true,
    where: "\"clients\".\"normalized_name_key\" IS NOT NULL",
  });
  const journalEntry = journal.entries.find(({ idx }) => idx === 22);
  assert.deepEqual(journalEntry, {
    idx: 22,
    version: "6",
    when: journalEntry.when,
    tag: "0022_mean_darkhawk",
    breakpoints: true,
  });
});

test("adds GI-01's bounded watermark and review-first queue in generated migration 0023", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(googleFormLeadIntakeMigrationPrefix));
  assert.equal(migration, "0023_smiling_silvermane.sql");
  assert.equal(
    files.filter((file) => file.startsWith(googleFormLeadIntakeMigrationPrefix)).length,
    1,
  );
  const [migrationSql, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(drizzleRoot, "meta", "0022_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0023_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);
  assert.match(migrationSql, /CREATE TABLE `google_form_lead_intake_watermarks`/u);
  assert.match(migrationSql, /CREATE TABLE `google_form_lead_reviews`/u);
  assert.match(migrationSql, /`accepted_lead_id` text/u);
  assert.match(migrationSql, /CREATE UNIQUE INDEX `google_form_lead_watermarks_scope_unique`/u);
  assert.match(migrationSql, /`last_processed_submission_key` text NOT NULL/u);
  assert.match(migrationSql, /`submission_key` text NOT NULL/u);
  assert.match(migrationSql, /CREATE UNIQUE INDEX `google_form_lead_reviews_submission_unique`/u);
  assert.match(migrationSql, /CREATE INDEX `google_form_lead_reviews_queue_idx`/u);
  assert.doesNotMatch(
    migrationSql,
    /\b(?:DROP|UPDATE|DELETE|TRUNCATE|RENAME|ALTER TABLE)\b/iu,
  );
  assert.equal(snapshot.prevId, previousSnapshot.id);
  for (const [table, value] of Object.entries(previousSnapshot.tables)) {
    assert.deepEqual(snapshot.tables[table], value);
  }
  assert.deepEqual(
    Object.keys(snapshot.tables).filter((table) => !Object.hasOwn(previousSnapshot.tables, table)).sort(),
    ["google_form_lead_intake_watermarks", "google_form_lead_reviews"],
  );
  const journalEntry = journal.entries.find(({ idx }) => idx === 23);
  assert.ok(journalEntry);
  assert.deepEqual(journalEntry, {
    idx: 23,
    version: "6",
    when: journalEntry.when,
    tag: "0023_smiling_silvermane",
    breakpoints: true,
  });
});

test("adds GI-04 address evidence and nullable record metadata in additive migration 0024", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(addressValidationMigrationPrefix));
  assert.equal(migration, "0024_lowly_selene.sql");
  assert.equal(
    files.filter((file) => file.startsWith(addressValidationMigrationPrefix)).length,
    1,
  );
  const [migrationSql, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(drizzleRoot, "meta", "0023_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0024_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);
  assert.match(migrationSql, /CREATE TABLE `address_validation_reviews`/u);
  assert.match(migrationSql, /`consumed_at` integer/u);
  assert.match(migrationSql, /CREATE INDEX `address_validation_reviews_expiry_idx`/u);
  assert.match(migrationSql, /ALTER TABLE `clients` ADD `site_address` text/u);
  for (const table of ["clients", "leads", "projects"]) {
    for (const column of ["latitude", "longitude", "address_validation_verdict"]) {
      assert.match(migrationSql, new RegExp("ALTER TABLE `" + table + "` ADD `" + column + "`"));
    }
  }
  assert.doesNotMatch(migrationSql, /\b(?:DROP|UPDATE|DELETE|TRUNCATE|RENAME|INSERT)\b/iu);
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(!Object.hasOwn(previousSnapshot.tables, "address_validation_reviews"));
  assert.ok(Object.hasOwn(snapshot.tables, "address_validation_reviews"));
  const journalEntry = journal.entries.find(({ idx }) => idx === 24);
  assert.deepEqual(journalEntry, {
    idx: 24,
    version: "6",
    when: journalEntry.when,
    tag: "0024_lowly_selene",
    breakpoints: true,
  });
});

test("adds AI-11(c)'s seeded label catalog in additive migration 0025", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(assistantLabelMigrationPrefix));
  assert.equal(migration, "0025_blushing_ultimo.sql");
  assert.equal(files.filter((file) => file.startsWith(assistantLabelMigrationPrefix)).length, 1);
  const [migrationSql, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(drizzleRoot, "meta", "0024_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0025_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);
  assert.match(migrationSql, /CREATE TABLE `assistant_label_definitions`/u);
  assert.match(migrationSql, /CREATE INDEX `assistant_label_definitions_created_at_idx`/u);
  assert.equal((migrationSql.match(/\('(?:lead|project-update|schedule|warranty)'/gu) ?? []).length, 4);
  assert.doesNotMatch(
    sqlWithoutLiteralsOrComments(migrationSql),
    /\b(?:DROP|UPDATE|DELETE|TRUNCATE|RENAME)\b/iu,
  );
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(!Object.hasOwn(previousSnapshot.tables, "assistant_label_definitions"));
  assert.ok(Object.hasOwn(snapshot.tables, "assistant_label_definitions"));
  const journalEntry = journal.entries.find((e) => e.tag === "0025_blushing_ultimo");
  assert.deepEqual(journalEntry, {
    idx: 25,
    version: "6",
    when: journalEntry.when,
    tag: "0025_blushing_ultimo",
    breakpoints: true,
  });
});

test("adds AI-11(d)'s review attribution columns in additive migration 0026", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(mailItemReviewAttributionMigrationPrefix));
  assert.equal(migration, "0026_mail_item_review_attribution.sql");
  assert.equal(files.filter((file) => file.startsWith(mailItemReviewAttributionMigrationPrefix)).length, 1);
  const [migrationSql, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(drizzleRoot, "meta", "0025_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0026_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);
  assert.match(migrationSql, /ALTER TABLE `mail_items` ADD COLUMN `reviewed_by` text/u);
  assert.match(migrationSql, /ALTER TABLE `mail_items` ADD COLUMN `reviewed_at` integer/u);
  assert.match(migrationSql, /ALTER TABLE `mail_items` ADD COLUMN `accepted_intent` text/u);
  assert.doesNotMatch(
    sqlWithoutLiteralsOrComments(migrationSql),
    /\b(?:DROP|UPDATE|DELETE|TRUNCATE|RENAME)\b/iu,
  );
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(Object.hasOwn(previousSnapshot.tables.mail_items.columns, "coverage_complete"));
  assert.ok(!Object.hasOwn(previousSnapshot.tables.mail_items.columns, "reviewed_by"));
  assert.ok(Object.hasOwn(snapshot.tables.mail_items.columns, "reviewed_by"));
  assert.ok(Object.hasOwn(snapshot.tables.mail_items.columns, "reviewed_at"));
  assert.ok(Object.hasOwn(snapshot.tables.mail_items.columns, "accepted_intent"));
  const journalEntry = journal.entries.find((entry) => entry.tag === "0026_mail_item_review_attribution");
  assert.deepEqual(journalEntry, {
    idx: 26,
    version: "6",
    when: journalEntry.when,
    tag: "0026_mail_item_review_attribution",
    breakpoints: true,
  });
});

test("makes WS-20 mail-item mailbox ownership explicit without losing persisted columns", async () => {
  const files = await migrationFiles(drizzleRoot);
  const [migration] = files.filter((file) => file.startsWith(sharedMailboxMigrationPrefix));
  assert.equal(migration, "0027_shiny_red_ghost.sql");
  assert.equal(files.filter((file) => file.startsWith(sharedMailboxMigrationPrefix)).length, 1);
  const [migrationSql, schemaSource, previousSnapshot, snapshot, journal] = await Promise.all([
    readFile(join(drizzleRoot, migration), "utf8"),
    readFile(join(root, "db", "schema.ts"), "utf8"),
    readFile(join(drizzleRoot, "meta", "0026_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "0027_snapshot.json"), "utf8").then(JSON.parse),
    readFile(join(drizzleRoot, "meta", "_journal.json"), "utf8").then(JSON.parse),
  ]);

  assert.match(migrationSql, /CREATE TABLE `__new_mail_items`/u);
  assert.match(migrationSql, /`connection_key` text NOT NULL/u);
  assert.doesNotMatch(migrationSql, /`connection_key` text DEFAULT 'google-workspace'/u);
  for (const column of [
    "coverage_complete",
    "reviewed_by",
    "reviewed_at",
    "accepted_intent",
  ]) {
    assert.ok(migrationSql.includes(`\`${column}\``));
    assert.ok(Object.hasOwn(snapshot.tables.mail_items.columns, column));
  }
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX `google_connections_google_subject_unique` ON `google_connections` \(`google_subject`\)/u,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX `google_connections_google_email_lower_unique` ON `google_connections` \(lower\("google_email"\)\)/u,
  );
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.equal(previousSnapshot.tables.mail_items.columns.connection_key.default, "'google-workspace'");
  assert.equal(snapshot.tables.mail_items.columns.connection_key.default, undefined);
  assert.equal(
    snapshot.tables.google_connections.indexes.google_connections_google_subject_unique.isUnique,
    true,
  );
  assert.deepEqual(
    snapshot.tables.google_connections.indexes.google_connections_google_email_lower_unique,
    {
      name: "google_connections_google_email_lower_unique",
      columns: ['lower("google_email")'],
      isUnique: true,
    },
  );
  assert.match(schemaSource, /connectionKey: text\("connection_key"\)\.notNull\(\),/u);
  assert.match(schemaSource, /coverageComplete: integer\("coverage_complete"/u);
  assert.match(schemaSource, /uniqueIndex\("google_connections_google_subject_unique"\)/u);
  assert.match(
    schemaSource,
    /uniqueIndex\("google_connections_google_email_lower_unique"\)\.on\(sql`lower\(\$\{table\.googleEmail\}\)`\)/u,
  );
  const journalEntry = journal.entries.at(-1);
  assert.deepEqual(journalEntry, {
    idx: 27,
    version: "6",
    when: journalEntry.when,
    tag: "0027_shiny_red_ghost",
    breakpoints: true,
  });
});

test("applies the WS-20 D1 chain and rejects case-insensitive duplicate mailbox emails", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const { sql } of await migrationSources(drizzleRoot)) {
      database.exec(sql.replaceAll("--> statement-breakpoint", ""));
    }
    const insert = database.prepare(`INSERT INTO google_connections (
      id, connection_key, google_subject, google_email, scopes_json,
      refresh_token_ciphertext, key_version, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '[]', 'ciphertext', 'v1', 'connected', 'schema-test', 1, 1)`);
    insert.run("connection-one", "gmail_one", "subject-one", "Owner@Example.com");
    assert.throws(
      () => insert.run("connection-two", "gmail_two", "subject-two", "owner@example.COM"),
      /google_connections_google_email_lower_unique/u,
    );
  } finally {
    database.close();
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
