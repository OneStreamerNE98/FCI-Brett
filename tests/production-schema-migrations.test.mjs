import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ACCESS_CAPABILITY_CATALOG,
  ADMIN_ACCESS_ROLE_CAPABILITY_KEYS,
  ADMIN_ACCESS_ROLE_CATALOG,
} from "../app/platform/postgres/admin-access-persistence-schema.ts";
import {
  calculateProductionMigrationChecksum,
  PRODUCTION_MIGRATION_LOCK_ID,
  PRODUCTION_SCHEMA_HISTORY_SQL,
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
  validateProductionMigrationRegistry,
} from "../app/platform/postgres/production-schema-migrations.ts";
import { FLOORING_CATEGORIES } from "../app/domain/project-creation.ts";
import { PROJECT_SEGMENTS } from "../app/domain/project-segment.ts";
import {
  FLOORING_KPI_SCHEMA_STATEMENTS,
  PRODUCTION_FLOORING_CATEGORIES,
} from "../app/platform/postgres/flooring-kpi-schema.ts";
import {
  PRODUCTION_PROJECT_SEGMENTS,
  PROJECT_SEGMENT_SCHEMA_STATEMENTS,
} from "../app/platform/postgres/project-segment-schema.ts";
import { SETTINGS_PERSISTENCE_STATEMENTS } from "../app/platform/postgres/settings-persistence-schema.ts";
import { TASK_SCHEMA_STATEMENTS } from "../app/platform/postgres/task-schema.ts";
import { CORE_RECORD_CONCURRENCY_STATEMENTS } from "../app/platform/postgres/core-record-concurrency-schema.ts";
import { MAIL_ITEM_ANALYSIS_SCHEMA_STATEMENTS } from "../app/platform/postgres/mail-item-analysis-schema.ts";
import { GOOGLE_FORM_LEAD_INTAKE_SCHEMA_STATEMENTS } from "../app/platform/postgres/google-form-lead-intake-schema.ts";
import { ADDRESS_VALIDATION_SCHEMA_STATEMENTS } from "../app/platform/postgres/address-validation-schema.ts";

const MIGRATION_VERSIONS = PRODUCTION_SCHEMA_MIGRATIONS.map(({ version }) => version);
const CURRENT_MIGRATION_VERSION = MIGRATION_VERSIONS.at(-1);

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
  assert.deepEqual(
    PRODUCTION_SCHEMA_MIGRATIONS.slice(0, 10).map(({ checksum }) => checksum),
    [
      "sha256:b3aab0addffeb3e8b4efc58373f359f56489778be9d0ec16dc098ab183beb9f6",
      "sha256:18e19555f53bc5f7f793e0fc5a2960ead8124cc67debff1db24785732bea5aea",
      "sha256:12d02573feec218e2ed411ec55ab5d9a08e5b5f20fdbbb58103305a7ef3dcb7f",
      "sha256:a779369e499410a161fa31a02e0ea56972648b81e7836b75c37f7fdacaad6cd3",
      "sha256:aa5e56dc3d1c22d3a6bc5be32f48cfde9ea133cdd853ce6fa024073ebeee05d9",
      "sha256:ff32915b98da08104a94eb4946aca84d0e1c1b144cc8b90d5bc2c7b435e34f99",
      "sha256:cb468b7237bc478ebe7f35f93ccc97611c94b66fc870e61258b6762297e7d63a",
      "sha256:e7df1a997fabf3aab599dbeefc7629e8d987a9152b0620a1372ebc0a57074951",
      "sha256:c3f3dc194ce5a92aabc172db7bc136d886a6f2900136cdf53fb30720f5d711d1",
      "sha256:9fe7e63bb2f266636164f20436753189938cd9c47a21b2a5e565e8faa79b87b9",
    ],
  );

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

test("freezes the approved three-role capability catalog without seeding employees", () => {
  assert.deepEqual(
    ADMIN_ACCESS_ROLE_CATALOG.map(({ key }) => key),
    ["administrator", "office_operations", "project_manager"],
  );
  assert.deepEqual(
    [...ADMIN_ACCESS_ROLE_CAPABILITY_KEYS.administrator],
    ADMIN_ACCESS_CAPABILITY_CATALOG.map(({ key }) => key),
  );
  assert.deepEqual([...ADMIN_ACCESS_ROLE_CAPABILITY_KEYS.office_operations], [
    "records.read", "leads.create", "leads.update", "clients.create",
    "clients.update", "contacts.create", "contacts.update",
    "projects.status.update", "tasks.update", "meetings.update", "notes.update",
    "files.read", "files.upload",
  ]);
  assert.deepEqual([...ADMIN_ACCESS_ROLE_CAPABILITY_KEYS.project_manager], [
    "records.read", "projects.status.update", "tasks.update", "meetings.update",
    "notes.update", "files.read", "files.upload",
  ]);

  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 4);
  assert.ok(migration);
  assert.equal(migration.version, 4);
  assert.equal(migration.name, "admin_access_persistence");
  assert.match(migration.statements[0], /^DO \$admin_access_preflight\$/);
  assert.match(
    migration.statements[0],
    /roles[\s\S]*capabilities[\s\S]*role_capabilities[\s\S]*invitations[\s\S]*user_roles[\s\S]*project_memberships/,
  );
  assert.match(migration.statements[0], /ERRCODE = '55000'/);
  assert.match(migration.statements[0], /requires empty version-3 role and access tables/);
  const sql = migration.statements.join("\n");
  assert.match(sql, /INSERT INTO roles/);
  assert.match(sql, /INSERT INTO capabilities/);
  assert.match(sql, /INSERT INTO role_capabilities/);
  assert.doesNotMatch(sql, /INSERT INTO (?:users|external_identities|invitations|sessions)/);
});

test("adds only the minimized security-barrier Activity projection in migration five", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 5);
  assert.ok(migration);
  assert.equal(migration.name, "admin_audit_activity");
  const sql = migration.statements.join("\n");
  assert.match(sql, /CREATE INDEX audit_events_occurred_cursor_key_idx/);
  assert.match(sql, /CREATE INDEX audit_events_result_occurred_cursor_key_idx/);
  assert.match(sql, /CREATE VIEW audit_activity_projection[\s\S]*security_barrier = true/);
  assert.match(sql, /event\.metadata -> 'reason'/);
  assert.doesNotMatch(sql, /CREATE TABLE|INSERT INTO audit_events|DROP\s/);
});

test("adds leads and project meetings only in immutable migration six", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 6);
  assert.ok(migration);
  assert.equal(migration.name, "lead_project_meetings");
  const sql = migration.statements.join("\n");
  assert.match(sql, /CREATE TABLE leads/);
  assert.match(sql, /leads_lead_number_check CHECK \(lead_number ~ '\^L-/);
  assert.match(sql, /leads_estimated_value_check CHECK/);
  assert.match(sql, /CREATE TABLE project_meetings/);
  assert.match(sql, /project_meetings_evidence_check CHECK/);
  assert.match(sql, /activity_events_lead_id_fkey/);
  assert.match(sql, /outbox_events_lead_id_fkey/);
  assert.match(sql, /'leads\.create'/);
  assert.match(sql, /'project_meetings\.create'/);
  assert.match(sql, /'lead\.created'/);
  assert.match(sql, /'project\.meeting\.created'/);
});

test("registers settings, preference, filing-rule, and mail-item persistence as migration seven", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 7);
  assert.ok(migration);
  assert.equal(migration.name, "settings_persistence");
  assert.equal(migration.statements, SETTINGS_PERSISTENCE_STATEMENTS);
  const sql = migration.statements.join("\n");

  for (const table of [
    "workspace_settings",
    "user_preferences",
    "filing_rules",
    "mail_items",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /workspace_settings_json_check CHECK/);
  assert.match(sql, /user_preferences_notification_preferences_json_check CHECK/);
  assert.match(sql, /user_preferences_page_layouts_json_check CHECK/);
  assert.match(sql, /filing_rules_action_check CHECK/);
  assert.match(sql, /mail_items_client_id_fkey/);
  assert.match(sql, /mail_items_suggested_project_id_fkey/);
  assert.match(sql, /mail_items_approved_project_id_fkey/);
  assert.match(sql, /CREATE INDEX mail_items_client_id_idx/);
  assert.match(sql, /CREATE INDEX mail_items_suggested_project_id_idx/);
  assert.match(sql, /CREATE INDEX mail_items_approved_project_id_idx/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|IF NOT EXISTS)\b/i);
});

test("registers the AI-01 PostgreSQL task schema as contiguous migration eight", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 8);
  assert.ok(migration);
  assert.equal(migration.name, "tasks");
  assert.equal(migration.statements, TASK_SCHEMA_STATEMENTS);
  const sql = TASK_SCHEMA_STATEMENTS.join("\n");

  assert.match(sql, /CREATE TABLE tasks/);
  assert.match(sql, /title text NOT NULL/);
  assert.match(sql, /details text/);
  assert.match(sql, /status text NOT NULL DEFAULT 'open'/);
  assert.match(sql, /due_date date/);
  assert.match(sql, /project_id uuid/);
  assert.match(sql, /lead_id uuid/);
  assert.match(sql, /assignee_email text/);
  assert.match(sql, /source text NOT NULL DEFAULT 'manual'/);
  assert.match(sql, /source_ref text/);
  assert.match(sql, /created_by text NOT NULL/);
  assert.match(sql, /updated_by text NOT NULL/);
  assert.match(sql, /completed_at timestamptz/);
  assert.match(sql, /tasks_title_check CHECK/);
  assert.match(sql, /pg_catalog\.char_length\(title\) <= 200/);
  assert.match(sql, /tasks_details_check CHECK/);
  assert.match(sql, /pg_catalog\.char_length\(details\) <= 4000/);
  assert.match(sql, /tasks_status_check CHECK \(status IN \('open', 'done'\)\)/);
  assert.match(sql, /tasks_source_check CHECK \(source IN \('manual', 'meeting', 'email', 'ai'\)\)/);
  assert.match(sql, /tasks_project_id_fkey/);
  assert.match(sql, /tasks_lead_id_fkey/);
  assert.match(sql, /CREATE INDEX tasks_status_due_date_idx ON tasks \(status, due_date\)/);
  assert.match(sql, /CREATE INDEX tasks_project_status_idx ON tasks \(project_id, status\)/);
  assert.match(sql, /CREATE INDEX tasks_lead_id_idx ON tasks \(lead_id\)/);
  assert.match(sql, /project_meetings_type_check CHECK \(meeting_type IN \([^)]*'phone-call'/);
  assert.match(sql, /activity_events_task_id_fkey/);
  assert.match(
    sql,
    /activity_events_record_check CHECK \(pg_catalog\.num_nonnulls\(client_id, project_id, lead_id, task_id\) = 1\)/,
  );
  assert.match(sql, /CREATE INDEX activity_events_task_id_idx/);
  assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE|CREATE INDEX CONCURRENTLY|IF NOT EXISTS)\b/i);
});

test("registers flooring KPI parity as contiguous migration nine with domain checks", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 9);
  assert.ok(migration);
  assert.equal(migration.name, "flooring_kpi_fields");
  assert.equal(migration.statements, FLOORING_KPI_SCHEMA_STATEMENTS);
  assert.deepEqual([...PRODUCTION_FLOORING_CATEGORIES], [...FLOORING_CATEGORIES]);
  const sql = migration.statements.join("\n");

  for (const [column, type] of [
    ["flooring_category", "text"],
    ["square_feet", "numeric"],
    ["contract_value", "numeric"],
    ["installation_started_at", "timestamptz"],
    ["installation_completed_at", "timestamptz"],
    ["callback_note", "text"],
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE projects ADD COLUMN ${column} ${type}`));
  }
  assert.match(
    sql,
    /ALTER TABLE projects ADD COLUMN had_callback boolean NOT NULL DEFAULT false/,
  );
  assert.match(
    sql,
    /projects_flooring_category_check CHECK[\s\S]*flooring_category IN \('hardwood', 'carpet', 'luxury-vinyl', 'tile-stone', 'laminate', 'specialty', 'mixed'\)/,
  );
  assert.match(
    sql,
    /projects_square_feet_check CHECK[\s\S]*square_feet > 0[\s\S]*square_feet = pg_catalog\.trunc\(square_feet\)[\s\S]*square_feet <= 9007199254740991/,
  );
  assert.match(
    sql,
    /projects_contract_value_check CHECK[\s\S]*contract_value >= 0[\s\S]*contract_value = pg_catalog\.trunc\(contract_value\)[\s\S]*contract_value <= 9007199254740991/,
  );
  assert.match(
    sql,
    /projects_installation_dates_check CHECK[\s\S]*installation_completed_at >= installation_started_at/,
  );
  assert.match(
    sql,
    /projects_callback_note_check CHECK[\s\S]*pg_catalog\.char_length\(callback_note\) <= 1000/,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:DROP|TRUNCATE|CREATE INDEX CONCURRENTLY|IF NOT EXISTS)\b/i,
  );
});

test("registers project segment parity as contiguous migration ten with the exact D1 catalog", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 10);
  assert.ok(migration);
  assert.equal(migration.name, "project_segment");
  assert.equal(migration.statements, PROJECT_SEGMENT_SCHEMA_STATEMENTS);
  assert.deepEqual([...PRODUCTION_PROJECT_SEGMENTS], [...PROJECT_SEGMENTS]);
  assert.deepEqual(PRODUCTION_SCHEMA_MIGRATIONS.slice(0, 10).map(({ version }) => version), [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);

  const sql = migration.statements.join("\n");
  assert.match(sql, /ALTER TABLE projects ADD COLUMN segment text/);
  assert.match(
    sql,
    /projects_segment_check CHECK \(\s*segment IS NULL\s*OR segment IN \('commercial', 'residential'\)\s*\)/,
  );
  assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE|CREATE INDEX CONCURRENTLY|IF NOT EXISTS)\b/i);
});

test("registers the non-structural core-record concurrency law as contiguous migration eleven", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 11);
  assert.ok(migration);
  assert.equal(migration.name, "core_record_concurrency");
  assert.equal(migration.statements, CORE_RECORD_CONCURRENCY_STATEMENTS);
  assert.equal(
    migration.checksum,
    "sha256:03c2f1db12a9d09566877b99d11f7b53c756e1847e3cca93a29eb97db064bd10",
  );
  assert.deepEqual(PRODUCTION_SCHEMA_MIGRATIONS.map(({ version }) => version), [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
  ]);
  assert.deepEqual(
    migration.statements.map((statement) => {
      const match = statement.match(/^COMMENT ON COLUMN ([a-z_]+)\.version IS /u);
      return match?.[1];
    }),
    ["clients", "contacts", "leads", "projects", "project_meetings", "tasks"],
  );
  assert.equal(
    migration.statements.every((statement) =>
      statement.endsWith(
        "'Optimistic concurrency token: update only the expected version and increment once.'",
      )),
    true,
  );
  assert.doesNotMatch(
    migration.statements.map((statement) => statement.split(" IS ")[0]).join("\n"),
    /\b(?:ALTER|CREATE|DROP|TRUNCATE|UPDATE|INSERT|DELETE)\b/iu,
  );
});

test("registers AI-10 mail-item analysis as immutable contiguous migration twelve", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 12);
  assert.ok(migration);
  assert.equal(migration.name, "mail_item_analysis");
  assert.equal(migration.statements, MAIL_ITEM_ANALYSIS_SCHEMA_STATEMENTS);
  assert.equal(
    migration.checksum,
    "sha256:46904428caf2572fd63079820a5ebf9b5b04e5390bcc7c69a69a8249431430bc",
  );
  const sql = migration.statements.join("\n");
  assert.match(
    sql,
    /ADD COLUMN connection_key text NOT NULL DEFAULT 'google-workspace'/u,
  );
  for (const column of [
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
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}\\b`, "u"));
  }
  assert.match(
    sql,
    /status IN \('needs-review', 'accepted', 'dismissed', 'skipped-noise', 'failed'\)/u,
  );
  assert.match(sql, /failure_attempts BETWEEN 0 AND 3/u);
  assert.match(
    sql,
    /party IS NULL OR party IN \('client', 'prospect', 'vendor', 'employee', 'unknown'\)/u,
  );
  assert.match(
    sql,
    /confidence IS NULL OR confidence IN \('high', 'medium', 'low'\)/u,
  );
  assert.match(
    sql,
    /failure_attempts = 0 AND attempted_label_definition_version IS NULL/u,
  );
  assert.match(
    sql,
    /failure_attempts >= 1 AND attempted_label_definition_version IS NOT NULL/u,
  );
  assert.match(
    sql,
    /status = 'failed' AND failure_attempts >= 1 AND error_code IS NOT NULL/u,
  );
  assert.match(
    sql,
    /status = 'needs-review'[\s\S]*failure_attempts >= 1 AND error_code IS NOT NULL/u,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX mail_items_profile_message_unique ON mail_items \(connection_key, gmail_message_id\)/u,
  );
  assert.match(
    sql,
    /CREATE INDEX mail_items_profile_status_updated_at_idx ON mail_items \(connection_key, status, updated_at DESC, id\)/u,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE TABLE|DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|INSERT)\b/iu,
  );
  // The only permitted writes are the legacy status backfills: the pre-v12
  // status column accepted any bounded nonblank text, so the closed vocabulary
  // must map existing rows before its constraint validates them. Both must
  // run before the constraint, and nothing else in v12 may write data.
  assert.deepEqual(
    migration.statements.filter((statement) => /\bUPDATE\b/iu.test(statement)),
    [
      "UPDATE mail_items SET status = 'accepted' WHERE status = 'approved'",
      `UPDATE mail_items SET status = 'dismissed' WHERE status NOT IN (
    'needs-review', 'accepted', 'dismissed', 'skipped-noise', 'failed'
  )`,
    ],
  );
  assert.ok(
    migration.statements.findIndex((statement) =>
      statement.includes("WHERE status = 'approved'")
    ) < migration.statements.findIndex((statement) =>
      statement.includes("mail_items_analysis_status_check")
    ),
    "legacy status backfills must precede the closed-vocabulary constraint",
  );
});

test("registers GI-01's bounded watermark and review queue as immutable migration thirteen", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 13);
  assert.ok(migration);
  assert.equal(migration.name, "google_form_lead_intake");
  assert.equal(migration.statements, GOOGLE_FORM_LEAD_INTAKE_SCHEMA_STATEMENTS);
  assert.equal(
    migration.checksum,
    "sha256:887ceed9e0a760a0da7c791419c2458e9d1bf4fbb759e22130d045b507f40a29",
  );
  const sql = migration.statements.join("\n");
  assert.match(sql, /CREATE TABLE google_form_lead_intake_watermarks/u);
  assert.match(sql, /PRIMARY KEY \(\s*connection_key,\s*spreadsheet_id\s*\)/u);
  assert.equal(
    (sql.match(/spreadsheet_id ~ '\^\[A-Za-z0-9_-\]\+\$'[\s\S]*?char_length\(spreadsheet_id\) <= 256/gu) ?? []).length,
    2,
    "both Sheet identifiers use a PostgreSQL-safe character check plus the full 256-character limit",
  );
  assert.doesNotMatch(
    sql,
    /\{1,256\}/u,
    "PostgreSQL ARE bounds stop at 255, so the 256-character API limit must use char_length",
  );
  assert.match(sql, /last_processed_row >= 2/u);
  assert.match(sql, /last_processed_submission_key ~ '\^\[a-f0-9\]\{64\}\$'/u);
  assert.match(sql, /CREATE TABLE google_form_lead_reviews/u);
  assert.match(sql, /UNIQUE \(\s*connection_key,\s*spreadsheet_id,\s*submission_key\s*\)/u);
  assert.match(sql, /accepted_lead_id uuid REFERENCES leads \(id\)/u);
  assert.match(sql, /status = 'accepted'[\s\S]*accepted_lead_id IS NOT NULL/u);
  assert.match(sql, /CREATE INDEX google_form_lead_reviews_queue_idx/u);
  assert.match(sql, /CREATE INDEX google_form_lead_reviews_accepted_lead_idx/u);
  assert.doesNotMatch(
    sql,
    /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|CREATE INDEX CONCURRENTLY|IF NOT EXISTS)\b/iu,
  );
});

test("registers GI-04 address evidence as additive immutable migration fourteen", () => {
  const migration = PRODUCTION_SCHEMA_MIGRATIONS.find(({ version }) => version === 14);
  assert.ok(migration);
  assert.equal(migration.name, "address_validation");
  assert.equal(migration.statements, ADDRESS_VALIDATION_SCHEMA_STATEMENTS);
  assert.equal(
    migration.checksum,
    "sha256:6cd292fa975603e1077caffca7e98b03cf386ea87445bbd6b99a666fd78b38ee",
  );
  const sql = migration.statements.join("\n");
  assert.match(sql, /CREATE TABLE address_validation_reviews/u);
  assert.match(sql, /consumed_at timestamptz/u);
  assert.match(sql, /entity_kind IN \('lead', 'client', 'project'\)/u);
  assert.match(sql, /verdict IN \('validated', 'needs-confirmation', 'needs-correction', 'unvalidated', 'simulated'\)/u);
  assert.match(sql, /simulated = \(verdict = 'simulated'\)/u);
  assert.match(sql, /ALTER TABLE clients[\s\S]*ADD COLUMN site_address text/u);
  assert.match(sql, /ALTER TABLE leads[\s\S]*ADD COLUMN latitude double precision/u);
  assert.match(sql, /ALTER TABLE projects[\s\S]*ADD COLUMN address_validation_verdict text/u);
  assert.doesNotMatch(
    sql,
    /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|CREATE INDEX CONCURRENTLY|IF NOT EXISTS)\b/iu,
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

  assert.deepEqual(result, {
    appliedVersions: MIGRATION_VERSIONS,
    currentVersion: CURRENT_MIGRATION_VERSION,
  });
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

  assert.equal(client.queries.filter(({ sql }) => sql === "BEGIN").length, MIGRATION_VERSIONS.length);
  assert.equal(client.queries.filter(({ sql }) => sql === "COMMIT").length, MIGRATION_VERSIONS.length);
  assert.equal(client.queries.filter(({ sql }) => /^SET LOCAL lock_timeout/.test(sql)).length, MIGRATION_VERSIONS.length);
  assert.equal(client.queries.filter(({ sql }) => /^SET LOCAL statement_timeout/.test(sql)).length, MIGRATION_VERSIONS.length);

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

  assert.deepEqual(result.appliedVersions, MIGRATION_VERSIONS.slice(1));
  assert.equal(
    client.queries.filter(({ sql }) => sql === "BEGIN").length,
    MIGRATION_VERSIONS.length - 1,
  );
});

test("re-reads applied history after the lock and makes a completed rerun a no-op", async () => {
  const history = PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({
    version,
    name,
    checksum,
  }));
  const client = new FakePostgresClient({ history });

  const result = await runProductionSchemaMigrations(new FakePostgresPool(client));

  assert.deepEqual(result, {
    appliedVersions: [],
    currentVersion: CURRENT_MIGRATION_VERSION,
  });
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
      {
        version: CURRENT_MIGRATION_VERSION + 1,
        name: "future",
        checksum: "sha256:" + "1".repeat(64),
      },
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

test("defines the bounded production persistence schema with named constraints and indexes", () => {
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
      "users",
      "external_identities",
      "invitations",
      "sessions",
      "roles",
      "capabilities",
      "role_capabilities",
      "user_roles",
      "project_memberships",
      "audit_events",
      "integration_connections",
      "integration_credentials",
      "integration_connection_scopes",
      "integration_oauth_attempts",
      "integration_resources",
      "integration_cursors",
      "integration_events",
      "files",
      "file_versions",
      "storage_objects",
      "file_links",
      "invitation_project_assignments",
      "leads",
      "project_meetings",
      "workspace_settings",
      "user_preferences",
      "filing_rules",
      "mail_items",
      "tasks",
      "google_form_lead_intake_watermarks",
      "google_form_lead_reviews",
      "address_validation_reviews",
    ],
  );
  assert.doesNotMatch(versionedSql, /\bIF NOT EXISTS\b/i);
  assert.equal((allSql.match(/\bIF NOT EXISTS\b/gi) ?? []).length, 1);
  assert.doesNotMatch(
    versionedSql,
    /\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|TYPE|VIEW|FUNCTION|INDEX|TRIGGER)|TRUNCATE)\b|CREATE INDEX CONCURRENTLY/i,
  );
  assert.equal((versionedSql.match(/DROP CONSTRAINT/g) ?? []).length, 7);

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
  assert.match(versionedSql, /leads_lead_number_check/);
  assert.match(versionedSql, /project_meetings_evidence_check/);
  assert.match(versionedSql, /project_meetings_project_id_meeting_at_idx/);
  assert.match(versionedSql, /external_identities_issuer_subject_key UNIQUE \(issuer, subject\)/);
  assert.match(versionedSql, /invitations_token_hash_check/);
  assert.match(versionedSql, /invitations_role_id_fkey FOREIGN KEY \(role_id\)/);
  assert.match(versionedSql, /CREATE INDEX invitations_role_id_idx ON invitations \(role_id\)/);
  assert.match(versionedSql, /CREATE TABLE invitation_project_assignments/);
  assert.match(versionedSql, /invitation_project_assignments_pkey PRIMARY KEY \(invitation_id, project_id\)/);
  assert.match(versionedSql, /invitation_project_assignments_project_id_idx/);
  assert.match(versionedSql, /sessions_csrf_hash_check/);
  assert.match(versionedSql, /user_roles_one_role_per_user_idx ON user_roles \(user_id\)/);
  assert.match(versionedSql, /user_roles_version_check CHECK \(version >= 1\)/);
  assert.match(versionedSql, /user_roles_permanent_check CHECK \(expires_at IS NULL\)/);
  assert.match(versionedSql, /project_memberships_status_check CHECK \(status IN \('active', 'revoked'\)\)/);
  assert.match(versionedSql, /project_memberships_revocation_evidence_check CHECK/);
  assert.match(versionedSql, /project_memberships_permanent_check CHECK \(expires_at IS NULL\)/);
  assert.match(versionedSql, /project_memberships_version_check CHECK \(version >= 1\)/);
  assert.match(versionedSql, /project_memberships_revoked_by_user_id_idx/);
  assert.match(versionedSql, /audit_events_append_only_trigger/);
  assert.match(versionedSql, /integration_credentials_status_evidence_check/);
  assert.match(versionedSql, /integration_oauth_attempts_state_evidence_check/);
  assert.match(versionedSql, /integration_events_append_only_trigger/);
  assert.match(versionedSql, /files_current_version_fkey[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  assert.match(versionedSql, /file_links_target_check CHECK/);
  assert.doesNotMatch(versionedSql, /\b(?:access_token|refresh_token|session_token|invitation_token|oauth_state|browser_nonce)\b/i);
  assert.doesNotMatch(versionedSql, /notification_channels|file_scans|retention_holds/);

  for (const foreignKey of [
    ["contacts_client_id_fkey", "contacts_client_id_idx"],
    ["projects_client_id_fkey", "projects_client_id_idx"],
    ["activity_events_client_id_fkey", "activity_events_client_id_idx"],
    ["activity_events_project_id_fkey", "activity_events_project_id_idx"],
    ["outbox_events_client_id_fkey", "outbox_events_client_id_idx"],
    ["outbox_events_project_id_fkey", "outbox_events_project_id_idx"],
    ["activity_events_lead_id_fkey", "activity_events_lead_id_idx"],
    ["outbox_events_lead_id_fkey", "outbox_events_lead_id_idx"],
    ["project_meetings_project_id_fkey", "project_meetings_project_id_meeting_at_idx"],
    ["mail_items_client_id_fkey", "mail_items_client_id_idx"],
    ["mail_items_suggested_project_id_fkey", "mail_items_suggested_project_id_idx"],
    ["mail_items_approved_project_id_fkey", "mail_items_approved_project_id_idx"],
    ["tasks_project_id_fkey", "tasks_project_status_idx"],
    ["tasks_lead_id_fkey", "tasks_lead_id_idx"],
    ["activity_events_task_id_fkey", "activity_events_task_id_idx"],
    [
      "invitation_project_assignments_project_id_fkey",
      "invitation_project_assignments_project_id_idx",
    ],
  ]) {
    assert.match(versionedSql, new RegExp(`CONSTRAINT ${foreignKey[0]} FOREIGN KEY`));
    assert.match(versionedSql, new RegExp(`CREATE (?:UNIQUE )?INDEX ${foreignKey[1]} `));
  }

  for (const line of allSql.split("\n").filter((value) => /\b(?:PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/.test(value))) {
    if (/^CREATE UNIQUE INDEX/.test(line.trim())) continue;
    assert.match(line, /CONSTRAINT [a-z][a-z0-9_]+/);
  }
});
