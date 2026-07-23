import {
  isMailItemRelationshipId,
  normalizeStoredMailItem,
} from "../../domain/mail-item";
import type {
  MailItemRepository,
  MailItemUpsertResult,
} from "../../ports/mail-item-repository";
import type { D1Database } from "./d1-database";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function boundedLimit(value: number | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_LIST_LIMIT
    ? Number(value)
    : DEFAULT_LIST_LIMIT;
}

async function referenceExists(
  database: D1Database,
  table: "clients" | "projects",
  id: string,
) {
  const row = await database
    .prepare(`SELECT id FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  return row?.id === id;
}

async function missingReference(
  database: D1Database,
  table: "clients" | "projects",
  id: unknown,
  outcome: Exclude<MailItemUpsertResult["outcome"], "saved">,
): Promise<MailItemUpsertResult | null> {
  if (!isMailItemRelationshipId(id)) return Object.freeze({ outcome });
  return (await referenceExists(database, table, id))
    ? null
    : Object.freeze({ outcome });
}

export function createD1MailItemRepository(database: D1Database): MailItemRepository {
  return {
    async findById(id) {
      const row = await database
        .prepare("SELECT * FROM mail_items WHERE id = ?")
        .bind(id)
        .first<Record<string, unknown>>();
      return row ? normalizeStoredMailItem(row) : null;
    },

    async listByStatus(status, limit) {
      const result = await database
        .prepare(
          "SELECT * FROM mail_items WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
        )
        .bind(status, boundedLimit(limit))
        .all<Record<string, unknown>>();
      return result.results.map(normalizeStoredMailItem);
    },

    async upsert(item) {
      if (item.clientId !== null) {
        const missing = await missingReference(
          database,
          "clients",
          item.clientId,
          "client-not-found",
        );
        if (missing) return missing;
      }
      if (item.suggestedProjectId !== null) {
        const missing = await missingReference(
          database,
          "projects",
          item.suggestedProjectId,
          "suggested-project-not-found",
        );
        if (missing) return missing;
      }
      if (item.approvedProjectId !== null) {
        const missing = await missingReference(
          database,
          "projects",
          item.approvedProjectId,
          "approved-project-not-found",
        );
        if (missing) return missing;
      }
      await database
        .prepare(
          "INSERT INTO mail_items (id, gmail_message_id, gmail_thread_id, client_id, suggested_project_id, approved_project_id, status, match_reason, email_drive_file_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET gmail_message_id = excluded.gmail_message_id, gmail_thread_id = excluded.gmail_thread_id, client_id = excluded.client_id, suggested_project_id = excluded.suggested_project_id, approved_project_id = excluded.approved_project_id, status = excluded.status, match_reason = excluded.match_reason, email_drive_file_id = excluded.email_drive_file_id, updated_at = excluded.updated_at",
        )
        .bind(
          item.id,
          item.gmailMessageId,
          item.gmailThreadId,
          item.clientId,
          item.suggestedProjectId,
          item.approvedProjectId,
          item.status,
          item.matchReason,
          item.emailDriveFileId,
          item.createdAt,
          item.updatedAt,
        )
        .run();
      return Object.freeze({ outcome: "saved" });
    },
  };
}
