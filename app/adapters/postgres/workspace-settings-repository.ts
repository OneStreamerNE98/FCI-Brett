import type {
  WorkspaceSettingsRecord,
  WorkspaceSettingsRepository,
} from "../../ports/workspace-settings-repository";
import {
  MAX_WORKSPACE_SETTINGS_DOCUMENT_BYTES,
  prepareWorkspaceSettingsMerge,
  workspaceSettingsDocumentTooLargeError,
} from "../../domain/workspace-settings";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  assertPersistenceText,
  persistenceDate,
} from "./persistence-repository-values";
import {
  parsePostgresJsonObject,
  parsePostgresTimestamp,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresWorkspaceSettingsOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

type WorkspaceSettingsDatabaseRow = Record<string, unknown> & {
  id: unknown;
  shared_drive_id: unknown;
  client_directory_sheet_id: unknown;
  intake_mailbox: unknown;
  settings_json: unknown;
  updated_by: unknown;
  updated_at: unknown;
};

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && Boolean(value.trim())
    && value.length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function nullableText(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${label} must be text or null`);
  return value;
}

function workspaceSettingsRecord(row: WorkspaceSettingsDatabaseRow): WorkspaceSettingsRecord {
  if (!validIdentifier(row.id)) {
    throw new TypeError("PostgreSQL Workspace settings ID is invalid");
  }
  assertPersistenceText(row.updated_by, "PostgreSQL Workspace settings updater", 320);
  return Object.freeze({
    id: row.id,
    sharedDriveId: nullableText(
      row.shared_drive_id,
      "PostgreSQL Workspace Shared Drive ID",
    ),
    clientDirectorySheetId: nullableText(
      row.client_directory_sheet_id,
      "PostgreSQL Workspace directory Sheet ID",
    ),
    intakeMailbox: nullableText(
      row.intake_mailbox,
      "PostgreSQL Workspace intake mailbox",
    ),
    settings: Object.freeze({
      ...parsePostgresJsonObject(
        row.settings_json,
        "PostgreSQL Workspace settings document",
      ),
    }),
    updatedBy: row.updated_by,
    updatedAt: parsePostgresTimestamp(
      row.updated_at,
      "PostgreSQL Workspace settings updated_at",
    ),
  });
}

export function createPostgresWorkspaceSettingsRepository(
  pool: PostgresPool,
  options: PostgresWorkspaceSettingsOptions = {},
): WorkspaceSettingsRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  return {
    async findById(id) {
      if (!validIdentifier(id)) return null;
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<WorkspaceSettingsDatabaseRow>(
            `SELECT id, shared_drive_id, client_directory_sheet_id,
                    intake_mailbox, settings_json, updated_by, updated_at
             FROM workspace_settings
             WHERE id = $1`,
            [id],
          );
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || !result.rows[0]) {
            throw new Error("PostgreSQL Workspace settings lookup returned an invalid result");
          }
          return workspaceSettingsRecord(result.rows[0]);
        },
      );
    },

    async mergeSettings(input) {
      if (!validIdentifier(input.id)) {
        throw new TypeError("Workspace settings ID must be bounded nonblank text");
      }
      assertPersistenceText(input.updatedBy, "Workspace settings updater", 320);
      const updatedAt = persistenceDate(input.updatedAt, "Workspace settings updated_at");
      const merge = prepareWorkspaceSettingsMerge(input.settings);
      const writesClientDirectorySheetId = Object.hasOwn(
        input,
        "clientDirectorySheetId",
      );
      if (
        writesClientDirectorySheetId
        && input.clientDirectorySheetId !== null
        && typeof input.clientDirectorySheetId !== "string"
      ) {
        throw new TypeError("Workspace Client Directory Sheet ID must be text or null");
      }
      const documentParameter = writesClientDirectorySheetId ? 3 : 2;
      const actorParameter = writesClientDirectorySheetId ? 4 : 3;
      const timestampParameter = writesClientDirectorySheetId ? 5 : 4;
      const keysParameter = writesClientDirectorySheetId ? 6 : 5;
      const clientDirectoryInsert = writesClientDirectorySheetId ? "$2" : "NULL";
      const clientDirectoryUpdate = writesClientDirectorySheetId
        ? "client_directory_sheet_id = EXCLUDED.client_directory_sheet_id,"
        : "";
      await withPostgresTransaction(pool, transactionOptions, async (client) => {
        // The conflict update only applies when the RESULTING merged document
        // fits the byte bound, enforced atomically inside the bounded
        // transaction so no read-modify-write race can slip past it. When the
        // guard fails the upsert touches no row (rowCount 0) and the stored row
        // is left byte-identical, which we surface as the same typed oversize
        // error the domain layer and D1 adapter raise. A fresh insert needs no
        // guard: its document equals the already patch-bounded payload.
        const result = await client.query(
          `INSERT INTO workspace_settings (
             id, shared_drive_id, client_directory_sheet_id, intake_mailbox,
             settings_json, updated_by, updated_at
           ) VALUES ($1, NULL, ${clientDirectoryInsert}, NULL, $${documentParameter}::jsonb, $${actorParameter}, $${timestampParameter})
           ON CONFLICT (id) DO UPDATE SET
             ${clientDirectoryUpdate}
             settings_json = (
               workspace_settings.settings_json - $${keysParameter}::text[]
             ) || EXCLUDED.settings_json,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at
           WHERE octet_length((
             (workspace_settings.settings_json - $${keysParameter}::text[]) || EXCLUDED.settings_json
           )::text) <= ${MAX_WORKSPACE_SETTINGS_DOCUMENT_BYTES}`,
          [
            input.id,
            ...(writesClientDirectorySheetId
              ? [input.clientDirectorySheetId ?? null]
              : []),
            merge.serialized,
            input.updatedBy,
            updatedAt,
            merge.keys,
          ],
        );
        if (result.rowCount === 0) {
          throw workspaceSettingsDocumentTooLargeError();
        }
        if (result.rowCount !== 1) {
          throw new Error("PostgreSQL Workspace settings were not merged exactly once");
        }
      });
    },
  };
}
