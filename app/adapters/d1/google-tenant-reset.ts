import type { D1Database } from "./d1-database";

export type D1GoogleTenantResetInput = Readonly<{
  workspaceConnectionKey: string;
  connections: readonly Readonly<{
    id: string;
    key: string;
    googleEmail: string;
  }>[];
  confirmationEmail: string;
  actor: string;
  auditId: string;
  now: number;
}>;

/**
 * Atomically clears one discarded Workspace tenant after every attached
 * mailbox has been disconnected. Mailbox rows are removed under their own
 * keys while Drive/Sheets/blueprint rows remain fenced to the single stable
 * workspace key. The exact revoked-tombstone set is part of every statement's
 * fence, so a concurrent attach or reconnect turns the entire batch into a
 * no-op instead of racing live credentials.
 */
export async function resetD1GoogleWorkspaceTenant(
  database: D1Database,
  input: D1GoogleTenantResetInput,
) {
  if (input.connections.length === 0) return "stale" as const;

  const identities = input.connections.flatMap((connection) => [
    connection.id,
    connection.key,
    connection.googleEmail,
  ]);
  const mailboxKeys = input.connections.map((connection) => connection.key);
  const mailboxPlaceholders = mailboxKeys.map(() => "?").join(", ");
  const mixedKeys = Array.from(new Set([
    input.workspaceConnectionKey,
    ...mailboxKeys,
  ]));
  const mixedPlaceholders = mixedKeys.map(() => "?").join(", ");
  const identityPredicate = input.connections
    .map(() => "(id = ? AND connection_key = ? AND google_email = ?)")
    .join(" OR ");
  const resetFence = `(SELECT COUNT(*) FROM google_connections WHERE status = 'revoked' AND (${identityPredicate})) = ? AND (SELECT COUNT(*) FROM google_connections) = ? AND NOT EXISTS (SELECT 1 FROM google_drive_operations WHERE connection_key IN (${mixedPlaceholders}) AND status IN ('in-progress', 'committing'))`;
  const fenceValues = [
    ...identities,
    input.connections.length,
    input.connections.length,
    ...mixedKeys,
  ] as const;

  const results = await database.batch([
    database.prepare(`UPDATE google_drive_operations
      SET status = 'failed',
          lease_expires_at = NULL,
          last_error_code = 'oauth_disconnect_interrupted',
          updated_at = ?
      WHERE connection_key IN (${mixedPlaceholders})
        AND operation_key = connection_key || ':oauth:disconnect'
        AND status = 'in-progress'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at <= ?
        AND (SELECT COUNT(*) FROM google_connections WHERE status = 'revoked' AND (${identityPredicate})) = ?
        AND (SELECT COUNT(*) FROM google_connections) = ?`)
      .bind(
        input.now,
        ...mixedKeys,
        input.now,
        ...identities,
        input.connections.length,
        input.connections.length,
      ),
    database.prepare(`UPDATE google_oauth_attempts SET expires_at = 0 WHERE connection_key IN (${mixedPlaceholders}) AND ${resetFence}`).bind(...mixedKeys, ...fenceValues),
    database.prepare(`DELETE FROM google_form_lead_reviews WHERE connection_key = ? AND ${resetFence}`).bind(input.workspaceConnectionKey, ...fenceValues),
    database.prepare(`DELETE FROM google_form_lead_intake_watermarks WHERE connection_key = ? AND ${resetFence}`).bind(input.workspaceConnectionKey, ...fenceValues),
    database.prepare(`DELETE FROM mail_items WHERE connection_key IN (${mailboxPlaceholders}) AND ${resetFence}`).bind(...mailboxKeys, ...fenceValues),
    database.prepare(`DELETE FROM gmail_file_archive_artifacts WHERE archive_id IN (SELECT id FROM gmail_file_archives WHERE connection_key IN (${mailboxPlaceholders})) AND ${resetFence}`).bind(...mailboxKeys, ...fenceValues),
    database.prepare(`DELETE FROM gmail_file_archives WHERE connection_key IN (${mailboxPlaceholders}) AND ${resetFence}`).bind(...mailboxKeys, ...fenceValues),
    database.prepare(`DELETE FROM drive_folder_mappings WHERE connection_key = ? AND ${resetFence}`).bind(input.workspaceConnectionKey, ...fenceValues),
    database.prepare(`DELETE FROM google_drive_operations WHERE connection_key IN (${mixedPlaceholders}) AND ${resetFence}`).bind(...mixedKeys, ...fenceValues),
    database.prepare(`DELETE FROM google_sheet_sync_state WHERE connection_key = ? AND ${resetFence}`).bind(input.workspaceConnectionKey, ...fenceValues),
    database.prepare(`DELETE FROM google_integration_events WHERE connection_key IN (${mixedPlaceholders}) AND ${resetFence}`).bind(...mixedKeys, ...fenceValues),
    database.prepare(`DELETE FROM workspace_resources WHERE connection_key = ? AND ${resetFence}`).bind(input.workspaceConnectionKey, ...fenceValues),
    database.prepare(`DELETE FROM workspace_blueprints WHERE connection_key = ? AND ${resetFence}`).bind(input.workspaceConnectionKey, ...fenceValues),
    database.prepare(`UPDATE clients SET drive_folder_id = NULL, drive_url = NULL WHERE ${resetFence}`).bind(...fenceValues),
    database.prepare(`UPDATE projects SET drive_folder_id = NULL, drive_url = NULL WHERE ${resetFence}`).bind(...fenceValues),
    database.prepare(`UPDATE workspace_settings
      SET shared_drive_id = NULL,
          client_directory_sheet_id = NULL,
          intake_mailbox = NULL,
          settings_json = CASE
            WHEN json_valid(settings_json) THEN json_remove(settings_json, '$.appointmentCalendarId', '$.fieldCalendarId', '$.intakeMailbox')
            ELSE settings_json
          END,
          updated_by = ?,
          updated_at = ?
      WHERE ${resetFence}`).bind(input.actor, input.now, ...fenceValues),
    database.prepare(`UPDATE tasks SET source_ref = NULL WHERE source = 'email' AND ${resetFence}`).bind(...fenceValues),
    database.prepare(`DELETE FROM google_connections WHERE status = 'revoked' AND (${identityPredicate}) AND ${resetFence}`).bind(...identities, ...fenceValues),
    database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, 'google_workspace.tenant_reset', ?, ?, ? WHERE changes() = ?")
      .bind(
        input.auditId,
        input.workspaceConnectionKey,
        input.actor,
        `Discarded Google Workspace tenant ${input.confirmationEmail} and ${input.connections.length} mailbox connection(s).`,
        input.now,
        input.connections.length,
      ),
  ]);
  const connectionDelete = results.at(-2)?.meta?.changes ?? 0;
  const auditInsert = results.at(-1)?.meta?.changes ?? 0;
  if (connectionDelete !== input.connections.length) return "stale" as const;
  if (auditInsert !== 1) {
    throw new TypeError("Google Workspace tenant reset did not create exactly one activity event.");
  }
  return "reset" as const;
}
