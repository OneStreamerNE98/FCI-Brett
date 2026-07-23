import type {
  WorkspaceSettingsRecord,
  WorkspaceSettingsRepository,
} from "../../ports/workspace-settings-repository";
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

function settingsDocumentJson(value: unknown) {
  const document = parsePostgresJsonObject(value, "Workspace settings document");
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized, "utf8") > 64_000) {
    throw new TypeError("Workspace settings document must be at most 64000 UTF-8 bytes");
  }
  return serialized;
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

    async upsert(input) {
      if (!validIdentifier(input.id)) {
        throw new TypeError("Workspace settings ID must be bounded nonblank text");
      }
      assertPersistenceText(input.updatedBy, "Workspace settings updater", 320);
      const updatedAt = persistenceDate(input.updatedAt, "Workspace settings updated_at");
      const settingsJson = settingsDocumentJson(input.settings);
      await withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `INSERT INTO workspace_settings (
             id, shared_drive_id, client_directory_sheet_id, intake_mailbox,
             settings_json, updated_by, updated_at
           ) VALUES ($1, NULL, NULL, NULL, $2::jsonb, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             settings_json = EXCLUDED.settings_json,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at`,
          [input.id, settingsJson, input.updatedBy, updatedAt],
        );
        if (result.rowCount !== 1) {
          throw new Error("PostgreSQL Workspace settings were not upserted exactly once");
        }
      });
    },
  };
}
