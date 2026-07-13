/**
 * Runtime schema bootstrap for the controlled, single-user D1 pilot.
 *
 * This registry deliberately keeps the pilot's existing SQLite shape and is
 * not the future PostgreSQL production migration system. Every statement is
 * additive and idempotent so an existing pilot database can adopt version
 * markers without destructive SQL. It does not repair or checksum table shape.
 */

import type { PilotD1Database } from "../adapters/d1/pilot-database";

export interface PilotSchemaMigration {
  version: number;
  name: string;
  statements: readonly string[];
}

export const PILOT_SCHEMA_HISTORY_SQL =
  "CREATE TABLE IF NOT EXISTS pilot_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)";

export const PILOT_SCHEMA_MIGRATIONS: readonly PilotSchemaMigration[] = [
  {
    version: 1,
    name: "workspace-core-baseline",
    statements: [
      "CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, client_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', industry TEXT, drive_folder_id TEXT, drive_url TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS clients_code_unique_idx ON clients(client_code)",
      "CREATE UNIQUE INDEX IF NOT EXISTS clients_name_idx ON clients(name)",
      "CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT, is_primary INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS contacts_client_idx ON contacts(client_id)",
      "CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, lead_number TEXT NOT NULL UNIQUE, company TEXT NOT NULL, contact_name TEXT NOT NULL, contact_email TEXT, contact_phone TEXT, project_name TEXT NOT NULL, source TEXT NOT NULL, stage TEXT NOT NULL, site TEXT NOT NULL, estimated_value INTEGER NOT NULL, next_action TEXT NOT NULL, next_action_at INTEGER, owner_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS leads_number_unique ON leads(lead_number)",
      "CREATE INDEX IF NOT EXISTS leads_status_updated_idx ON leads(status, updated_at DESC)",
      "CREATE INDEX IF NOT EXISTS leads_stage_updated_idx ON leads(stage, updated_at DESC)",
      "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, project_number TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planning', site TEXT, project_manager TEXT, estimated_value INTEGER, drive_folder_id TEXT, drive_url TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS projects_number_unique_idx ON projects(project_number)",
      "CREATE INDEX IF NOT EXISTS projects_client_idx ON projects(client_id, updated_at)",
      "CREATE TABLE IF NOT EXISTS project_meetings (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, meeting_at INTEGER NOT NULL, meeting_type TEXT NOT NULL, source_provider TEXT NOT NULL, source_url TEXT, attendees_json TEXT NOT NULL DEFAULT '[]', notes TEXT, transcript TEXT, summary TEXT, decisions TEXT, action_items_json TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS project_meetings_project_date_idx ON project_meetings(project_id, meeting_at DESC)",
      "CREATE TABLE IF NOT EXISTS filing_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL, match_summary TEXT NOT NULL, action TEXT NOT NULL, target_category TEXT NOT NULL, approval_required INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS filing_rules_priority_idx ON filing_rules(priority)",
      "CREATE TABLE IF NOT EXISTS workspace_settings (id TEXT PRIMARY KEY, shared_drive_id TEXT, client_directory_sheet_id TEXT, intake_mailbox TEXT, settings_json TEXT NOT NULL DEFAULT '{}', updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS user_preferences (user_email TEXT PRIMARY KEY, display_timezone TEXT NOT NULL DEFAULT 'America/New_York', reply_signature TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS mail_items (id TEXT PRIMARY KEY, gmail_message_id TEXT, gmail_thread_id TEXT, client_id TEXT, suggested_project_id TEXT, approved_project_id TEXT, status TEXT NOT NULL, match_reason TEXT, email_drive_file_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS mail_items_status_idx ON mail_items(status, updated_at)",
      "CREATE TABLE IF NOT EXISTS activity_events (id TEXT PRIMARY KEY, record_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS webhook_receipts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, received_at INTEGER NOT NULL)",
    ],
  },
  {
    version: 2,
    name: "google-workspace-pilot-baseline",
    statements: [
      "CREATE TABLE IF NOT EXISTS gmail_file_archives (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, gmail_message_id TEXT NOT NULL, gmail_thread_id TEXT, project_id TEXT NOT NULL, project_drive_folder_id TEXT NOT NULL, email_archive_folder_id TEXT NOT NULL, attachment_folder_id TEXT NOT NULL, status TEXT NOT NULL, approval_actor TEXT NOT NULL, approved_at INTEGER NOT NULL, email_drive_file_id TEXT, email_drive_url TEXT, attachment_count INTEGER NOT NULL DEFAULT 0, last_error_code TEXT, filed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(connection_key, gmail_message_id))",
      "CREATE UNIQUE INDEX IF NOT EXISTS gmail_file_archives_profile_message_unique ON gmail_file_archives(connection_key, gmail_message_id)",
      "CREATE INDEX IF NOT EXISTS gmail_file_archives_project_status_idx ON gmail_file_archives(connection_key, project_id, status, updated_at)",
      "CREATE TABLE IF NOT EXISTS gmail_file_archive_artifacts (id TEXT PRIMARY KEY, archive_id TEXT NOT NULL, artifact_key TEXT NOT NULL, kind TEXT NOT NULL, gmail_attachment_id TEXT, original_filename TEXT, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT, drive_file_id TEXT NOT NULL, drive_url TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(archive_id, artifact_key))",
      "CREATE UNIQUE INDEX IF NOT EXISTS gmail_file_archive_artifacts_archive_key_unique ON gmail_file_archive_artifacts(archive_id, artifact_key)",
      "CREATE INDEX IF NOT EXISTS gmail_file_archive_artifacts_archive_idx ON gmail_file_archive_artifacts(archive_id, kind)",
      "CREATE TABLE IF NOT EXISTS google_oauth_attempts (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, state_hash TEXT NOT NULL UNIQUE, pkce_verifier_ciphertext TEXT NOT NULL, browser_nonce_hash TEXT NOT NULL, initiated_by TEXT NOT NULL, scopes_json TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS google_oauth_attempts_state_hash_unique ON google_oauth_attempts(state_hash)",
      "CREATE INDEX IF NOT EXISTS google_oauth_attempts_expiry_idx ON google_oauth_attempts(expires_at, consumed_at)",
      "CREATE TABLE IF NOT EXISTS google_connections (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL UNIQUE, google_subject TEXT NOT NULL, google_email TEXT NOT NULL, scopes_json TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL, key_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', last_error_code TEXT, last_success_at INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER)",
      "CREATE UNIQUE INDEX IF NOT EXISTS google_connections_connection_key_unique ON google_connections(connection_key)",
      "CREATE TABLE IF NOT EXISTS drive_folder_mappings (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, folder_key TEXT NOT NULL, drive_file_id TEXT NOT NULL UNIQUE, parent_drive_file_id TEXT, drive_url TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(connection_key, entity_type, entity_id, folder_key))",
      "CREATE UNIQUE INDEX IF NOT EXISTS drive_folder_mappings_drive_file_id_unique ON drive_folder_mappings(drive_file_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS drive_folder_mappings_profile_entity_folder_unique ON drive_folder_mappings(connection_key, entity_type, entity_id, folder_key)",
      "CREATE TABLE IF NOT EXISTS google_drive_operations (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, operation_key TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, status TEXT NOT NULL, lease_expires_at INTEGER, last_error_code TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS google_drive_operations_operation_key_unique ON google_drive_operations(operation_key)",
      "CREATE TABLE IF NOT EXISTS google_sheet_sync_state (connection_key TEXT NOT NULL, entity_type TEXT NOT NULL, status TEXT NOT NULL, last_synced_at INTEGER, last_error_code TEXT, last_error_message TEXT, last_attempt_at INTEGER, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (connection_key, entity_type))",
      "CREATE UNIQUE INDEX IF NOT EXISTS google_sheet_sync_state_profile_entity_unique ON google_sheet_sync_state(connection_key, entity_type)",
      "CREATE TABLE IF NOT EXISTS google_integration_events (id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, event_type TEXT NOT NULL, actor TEXT NOT NULL, entity_type TEXT, entity_id TEXT, detail TEXT, created_at INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS google_integration_events_created_idx ON google_integration_events(created_at)",
      "CREATE TABLE IF NOT EXISTS workspace_simulation_state (id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    ],
  },
  {
    version: 3,
    name: "generic-records-baseline",
    statements: [
      "CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT NOT NULL, project_id TEXT, status TEXT NOT NULL DEFAULT 'active', payload TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS records_type_idx ON records(type, updated_at)",
    ],
  },
];

interface AppliedMigrationRow {
  version: number | string;
  name: string;
}

function validateRegistry(migrations: readonly PilotSchemaMigration[]) {
  let previousVersion = 0;

  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previousVersion) {
      throw new Error("Pilot schema migration versions must be positive, unique, and ordered");
    }
    if (!migration.name.trim() || migration.statements.length === 0) {
      throw new Error(`Pilot schema migration ${migration.version} must have a name and at least one statement`);
    }
    previousVersion = migration.version;
  }
}

export async function runPilotSchemaMigrations(
  database: PilotD1Database,
  migrations: readonly PilotSchemaMigration[] = PILOT_SCHEMA_MIGRATIONS,
  now: () => number = Date.now,
) {
  validateRegistry(migrations);

  await database.batch([database.prepare(PILOT_SCHEMA_HISTORY_SQL)]);

  for (const migration of migrations) {
    const applied = await database
      .prepare("SELECT version, name FROM pilot_schema_migrations WHERE version = ?")
      .bind(migration.version)
      .first<AppliedMigrationRow>();
    if (applied && Number(applied.version) === migration.version) {
      if (applied.name !== migration.name) {
        throw new Error(
          `Pilot schema migration ${migration.version} history mismatch: expected ${migration.name}, found ${applied.name}`,
        );
      }
      continue;
    }

    const statements = migration.statements.map((sql) => database.prepare(sql));
    statements.push(
      database
        .prepare(
          "INSERT INTO pilot_schema_migrations (version, name, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING",
        )
        .bind(migration.version, migration.name, now()),
    );

    try {
      // D1 batches are transactional. Keeping the marker last means a failed
      // schema statement cannot leave this version recorded as applied.
      await database.batch(statements);
    } catch (error) {
      throw new Error(
        `Pilot schema migration ${migration.version} (${migration.name}) failed and was not recorded. Inspect the underlying D1 error and resolve the pilot schema/data conflict before retrying; UNIQUE failures mean existing pilot values conflict with a required index.`,
        { cause: error },
      );
    }

    const recorded = await database
      .prepare("SELECT version, name FROM pilot_schema_migrations WHERE version = ?")
      .bind(migration.version)
      .first<AppliedMigrationRow>();
    if (!recorded || recorded.name !== migration.name) {
      throw new Error(
        `Pilot schema migration ${migration.version} marker could not be verified after its D1 batch`,
      );
    }
  }
}

/**
 * Coalesces concurrent first requests in one runtime isolate. A failed attempt
 * is deliberately forgotten so a later request can retry the idempotent work.
 */
export function createPilotSchemaEnsurer(
  database: PilotD1Database,
  migrations: readonly PilotSchemaMigration[] = PILOT_SCHEMA_MIGRATIONS,
) {
  let complete = false;
  let inFlight: Promise<void> | undefined;

  return function ensurePilotSchema() {
    if (complete) return Promise.resolve();
    if (inFlight) return inFlight;

    const current = runPilotSchemaMigrations(database, migrations)
      .then(() => {
        complete = true;
      })
      .finally(() => {
        if (inFlight === current) inFlight = undefined;
      });

    inFlight = current;
    return current;
  };
}
