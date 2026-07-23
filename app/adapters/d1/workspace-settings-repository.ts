import { parseWorkspaceSettingsDocument } from "../../domain/workspace-settings";
import type {
  WorkspaceSettingsRecord,
  WorkspaceSettingsRepository,
} from "../../ports/workspace-settings-repository";
import type { D1Database } from "./d1-database";

type WorkspaceSettingsRow = Readonly<{
  id?: unknown;
  shared_drive_id?: unknown;
  client_directory_sheet_id?: unknown;
  intake_mailbox?: unknown;
  settings_json: unknown;
  updated_by?: unknown;
  updated_at: number;
}>;

function nullableText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function recordFromD1(row: WorkspaceSettingsRow, requestedId: string): WorkspaceSettingsRecord {
  return Object.freeze({
    id: typeof row.id === "string" ? row.id : requestedId,
    sharedDriveId: nullableText(row.shared_drive_id),
    clientDirectorySheetId: nullableText(row.client_directory_sheet_id),
    intakeMailbox: nullableText(row.intake_mailbox),
    settings: parseWorkspaceSettingsDocument(row.settings_json),
    updatedBy: typeof row.updated_by === "string" ? row.updated_by : "",
    updatedAt: row.updated_at,
  });
}

export function createD1WorkspaceSettingsRepository(
  database: D1Database,
): WorkspaceSettingsRepository {
  return {
    async findById(id) {
      const row = await database
        .prepare(
          "SELECT id, shared_drive_id, client_directory_sheet_id, intake_mailbox, settings_json, updated_by, updated_at FROM workspace_settings WHERE id = ?",
        )
        .bind(id)
        .first<WorkspaceSettingsRow>();
      return row ? recordFromD1(row, id) : null;
    },

    async upsert(input) {
      await database
        .prepare(
          "INSERT INTO workspace_settings (id, shared_drive_id, client_directory_sheet_id, intake_mailbox, settings_json, updated_by, updated_at) VALUES (?, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
        )
        .bind(
          input.id,
          JSON.stringify(input.settings),
          input.updatedBy,
          input.updatedAt,
        )
        .run();
    },
  };
}
