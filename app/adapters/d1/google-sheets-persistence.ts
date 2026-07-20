import type {
  ClientMirrorRow,
  GoogleSheetsPersistence,
  MirrorStateRow,
  ProjectMirrorRow,
} from "../../lib/google-sheets";

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<Readonly<{ results?: T[] }>>;
  run(): Promise<unknown>;
};

export type D1GoogleSheetsDatabase = Readonly<{
  prepare(sql: string): D1PreparedStatementLike;
}>;

/** D1 implementation for the controlled Sites mirror only. */
export function createD1GoogleSheetsPersistence(database: D1GoogleSheetsDatabase): GoogleSheetsPersistence {
  return Object.freeze({
    async loadClientRows(connectionKey) {
      const result = await database.prepare("SELECT c.id, c.client_code AS code, c.name, c.status, c.industry, c.updated_at AS updatedAt, m.drive_url AS driveUrl, COUNT(p.id) AS projectCount, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primaryContact, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS email, (SELECT phone FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS phone FROM clients c LEFT JOIN projects p ON p.client_id = c.id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'client' AND m.entity_id = c.id AND m.folder_key = 'client-root' GROUP BY c.id ORDER BY c.name ASC")
        .bind(connectionKey)
        .all<ClientMirrorRow>();
      return result.results ?? [];
    },

    async loadProjectRows(connectionKey) {
      const result = await database.prepare("SELECT p.id, p.project_number AS number, p.name, p.client_id AS clientId, p.status, p.site, p.project_manager AS projectManager, p.estimated_value AS estimatedValue, p.created_at AS createdAt, p.updated_at AS updatedAt, c.client_code AS clientCode, c.name AS clientName, m.drive_url AS driveUrl FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'project' AND m.entity_id = p.id AND m.folder_key = 'project-root' ORDER BY p.created_at ASC")
        .bind(connectionKey)
        .all<ProjectMirrorRow>();
      return result.results ?? [];
    },

    async updateSyncState(input) {
      await database.prepare("INSERT INTO google_sheet_sync_state (connection_key, entity_type, status, last_synced_at, last_error_code, last_error_message, last_attempt_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_key, entity_type) DO UPDATE SET status = excluded.status, last_synced_at = excluded.last_synced_at, last_error_code = excluded.last_error_code, last_error_message = excluded.last_error_message, last_attempt_at = excluded.last_attempt_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
        .bind(
          input.connectionKey,
          input.entityType,
          input.status,
          input.syncedAt,
          input.errorCode,
          input.errorMessage,
          input.attemptedAt,
          input.actor,
          input.attemptedAt,
        )
        .run();
    },

    async getSyncStates(connectionKey) {
      const result = await database.prepare("SELECT entity_type, status, last_synced_at, last_error_code, last_error_message, last_attempt_at FROM google_sheet_sync_state WHERE connection_key = ?")
        .bind(connectionKey)
        .all<MirrorStateRow>();
      return result.results ?? [];
    },
  });
}
