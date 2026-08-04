import type { D1Database } from "./d1-database";

const RESET_FENCE = "EXISTS (SELECT 1 FROM google_connections WHERE id = ? AND connection_key = ? AND google_email = ? AND status = 'revoked')";

export type D1GoogleTenantResetInput = Readonly<{
  connection: Readonly<{
    id: string;
    key: string;
    googleEmail: string;
  }>;
  actor: string;
  auditId: string;
  now: number;
}>;

/**
 * Atomically clears the D1 development connector's discarded-tenant residue.
 * Every mutation is fenced on the exact revoked tombstone read by the route, so
 * a concurrent reconnect makes the whole batch a no-op rather than racing a
 * live credential.
 */
export async function resetD1GoogleWorkspaceTenant(
  database: D1Database,
  input: D1GoogleTenantResetInput,
) {
  const { connection } = input;
  const fenceValues = [connection.id, connection.key, connection.googleEmail] as const;
  const results = await database.batch([
    database.prepare(`DELETE FROM google_form_lead_reviews WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM google_form_lead_intake_watermarks WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM mail_items WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM gmail_file_archive_artifacts WHERE archive_id IN (SELECT id FROM gmail_file_archives WHERE connection_key = ?) AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM gmail_file_archives WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM drive_folder_mappings WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM google_drive_operations WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM google_sheet_sync_state WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM google_integration_events WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM workspace_resources WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`DELETE FROM workspace_blueprints WHERE connection_key = ? AND ${RESET_FENCE}`).bind(connection.key, ...fenceValues),
    database.prepare(`UPDATE clients SET drive_folder_id = NULL, drive_url = NULL WHERE ${RESET_FENCE}`).bind(...fenceValues),
    database.prepare(`UPDATE projects SET drive_folder_id = NULL, drive_url = NULL WHERE ${RESET_FENCE}`).bind(...fenceValues),
    database.prepare(`UPDATE workspace_settings
      SET shared_drive_id = NULL,
          client_directory_sheet_id = NULL,
          intake_mailbox = NULL,
          settings_json = CASE
            WHEN json_valid(settings_json) THEN json_remove(settings_json, '$.appointmentCalendarId', '$.fieldCalendarId')
            ELSE settings_json
          END,
          updated_by = ?,
          updated_at = ?
      WHERE ${RESET_FENCE}`).bind(input.actor, input.now, ...fenceValues),
    database.prepare(`UPDATE tasks SET source_ref = NULL WHERE source = 'email' AND ${RESET_FENCE}`).bind(...fenceValues),
    database.prepare("DELETE FROM google_connections WHERE id = ? AND connection_key = ? AND google_email = ? AND status = 'revoked'").bind(...fenceValues),
    database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, 'google_workspace.tenant_reset', ?, ?, ? WHERE changes() = 1")
      .bind(
        input.auditId,
        connection.key,
        input.actor,
        `Discarded Google Workspace tenant ${connection.googleEmail}.`,
        input.now,
      ),
  ]);
  const connectionDelete = results.at(-2)?.meta?.changes ?? 0;
  const auditInsert = results.at(-1)?.meta?.changes ?? 0;
  if (connectionDelete !== 1) return "stale" as const;
  if (auditInsert !== 1) {
    throw new TypeError("Google Workspace tenant reset did not create exactly one activity event.");
  }
  return "reset" as const;
}
