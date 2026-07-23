import {
  normalizeStoredMailItem,
  type MailItem,
} from "../../domain/mail-item";
import type {
  MailItemRepository,
  MailItemUpsertResult,
} from "../../ports/mail-item-repository";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  isNamedPostgresConstraint,
  persistenceDate,
} from "./persistence-repository-values";
import {
  isPostgresUuid,
  parsePostgresTimestamp,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresMailItemOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

type MailItemDatabaseRow = Record<string, unknown> & {
  id: unknown;
  gmail_message_id: unknown;
  gmail_thread_id: unknown;
  client_id: unknown;
  suggested_project_id: unknown;
  approved_project_id: unknown;
  status: unknown;
  match_reason: unknown;
  email_drive_file_id: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function boundedLimit(value: number | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_LIST_LIMIT
    ? Number(value)
    : DEFAULT_LIST_LIMIT;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && Boolean(value.trim())
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function requiredText(value: unknown, label: string, maximum: number) {
  if (!boundedText(value, maximum)) {
    throw new TypeError(`${label} must be bounded nonblank text`);
  }
  return value;
}

function nullableText(value: unknown, label: string, maximum: number, multiline = false) {
  if (value === null) return null;
  const unsafeControls = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > maximum
    || unsafeControls.test(value)
  ) {
    throw new TypeError(`${label} must be bounded text or null`);
  }
  return value;
}

function nullableUuid(value: unknown, label: string) {
  if (value === null) return null;
  if (!isPostgresUuid(value)) throw new TypeError(`${label} must be a UUID or null`);
  return value.toLowerCase();
}

function mailItemFromPostgres(row: MailItemDatabaseRow) {
  const createdAt = parsePostgresTimestamp(
    row.created_at,
    "PostgreSQL mail item created_at",
  );
  const updatedAt = parsePostgresTimestamp(
    row.updated_at,
    "PostgreSQL mail item updated_at",
  );
  if (updatedAt < createdAt) {
    throw new TypeError("PostgreSQL mail item timestamps are inconsistent");
  }
  return normalizeStoredMailItem({
    id: requiredText(row.id, "PostgreSQL mail item ID", 512),
    gmail_message_id: nullableText(
      row.gmail_message_id,
      "PostgreSQL Gmail message ID",
      512,
    ),
    gmail_thread_id: nullableText(
      row.gmail_thread_id,
      "PostgreSQL Gmail thread ID",
      512,
    ),
    client_id: nullableUuid(row.client_id, "PostgreSQL mail item client ID"),
    suggested_project_id: nullableUuid(
      row.suggested_project_id,
      "PostgreSQL suggested project ID",
    ),
    approved_project_id: nullableUuid(
      row.approved_project_id,
      "PostgreSQL approved project ID",
    ),
    status: requiredText(row.status, "PostgreSQL mail item status", 80),
    match_reason: nullableText(
      row.match_reason,
      "PostgreSQL mail item match reason",
      1_000,
      true,
    ),
    email_drive_file_id: nullableText(
      row.email_drive_file_id,
      "PostgreSQL mail item Drive file ID",
      512,
    ),
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

function validateMailItem(item: MailItem) {
  requiredText(item.id, "PostgreSQL mail item ID", 512);
  nullableText(item.gmailMessageId, "PostgreSQL Gmail message ID", 512);
  nullableText(item.gmailThreadId, "PostgreSQL Gmail thread ID", 512);
  nullableUuid(item.clientId, "PostgreSQL mail item client ID");
  nullableUuid(item.suggestedProjectId, "PostgreSQL suggested project ID");
  nullableUuid(item.approvedProjectId, "PostgreSQL approved project ID");
  requiredText(item.status, "PostgreSQL mail item status", 80);
  nullableText(item.matchReason, "PostgreSQL mail item match reason", 1_000, true);
  nullableText(item.emailDriveFileId, "PostgreSQL mail item Drive file ID", 512);
  const createdAt = persistenceDate(item.createdAt, "PostgreSQL mail item created_at");
  const updatedAt = persistenceDate(item.updatedAt, "PostgreSQL mail item updated_at");
  if (updatedAt < createdAt) {
    throw new TypeError("PostgreSQL mail item timestamps are inconsistent");
  }
  return { createdAt, updatedAt };
}

const MAIL_ITEM_SELECT = `SELECT id, gmail_message_id, gmail_thread_id,
       client_id::text AS client_id,
       suggested_project_id::text AS suggested_project_id,
       approved_project_id::text AS approved_project_id, status, match_reason,
       email_drive_file_id, created_at, updated_at
FROM mail_items`;

const MAIL_ITEM_REFERENCE_CONSTRAINTS = [
  "mail_items_client_id_fkey",
  "mail_items_suggested_project_id_fkey",
  "mail_items_approved_project_id_fkey",
] as const;

type MissingReferenceOutcome = Exclude<MailItemUpsertResult["outcome"], "saved">;

const MAIL_ITEM_REFERENCE_OUTCOMES = [
  {
    property: "clientId",
    constraint: MAIL_ITEM_REFERENCE_CONSTRAINTS[0],
    outcome: "client-not-found",
  },
  {
    property: "suggestedProjectId",
    constraint: MAIL_ITEM_REFERENCE_CONSTRAINTS[1],
    outcome: "suggested-project-not-found",
  },
  {
    property: "approvedProjectId",
    constraint: MAIL_ITEM_REFERENCE_CONSTRAINTS[2],
    outcome: "approved-project-not-found",
  },
] as const satisfies readonly {
  property: "clientId" | "suggestedProjectId" | "approvedProjectId";
  constraint: typeof MAIL_ITEM_REFERENCE_CONSTRAINTS[number];
  outcome: MissingReferenceOutcome;
}[];

function missingReference(outcome: MissingReferenceOutcome): MailItemUpsertResult {
  return Object.freeze({ outcome });
}

function invalidReference(item: MailItem): MailItemUpsertResult | null {
  for (const reference of MAIL_ITEM_REFERENCE_OUTCOMES) {
    const value = item[reference.property];
    if (value !== null && !isPostgresUuid(value)) {
      return missingReference(reference.outcome);
    }
  }
  return null;
}

function referenceConstraintOutcome(error: unknown): MailItemUpsertResult | null {
  for (const reference of MAIL_ITEM_REFERENCE_OUTCOMES) {
    if (isNamedPostgresConstraint(error, "23503", [reference.constraint])) {
      return missingReference(reference.outcome);
    }
  }
  return null;
}

export function createPostgresMailItemRepository(
  pool: PostgresPool,
  options: PostgresMailItemOptions = {},
): MailItemRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  return {
    async findById(id) {
      if (!boundedText(id, 512)) return null;
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<MailItemDatabaseRow>(
            `${MAIL_ITEM_SELECT}\nWHERE id = $1`,
            [id],
          );
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || !result.rows[0]) {
            throw new Error("PostgreSQL mail item lookup returned an invalid result");
          }
          return mailItemFromPostgres(result.rows[0]);
        },
      );
    },

    async listByStatus(status, limit) {
      requiredText(status, "PostgreSQL mail item status", 80);
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<MailItemDatabaseRow>(
            `${MAIL_ITEM_SELECT}
WHERE status = $1
ORDER BY updated_at DESC, id
LIMIT $2`,
            [status, boundedLimit(limit)],
          );
          return result.rows.map(mailItemFromPostgres);
        },
      );
    },

    async upsert(item) {
      const invalidReferenceResult = invalidReference(item);
      if (invalidReferenceResult) return invalidReferenceResult;
      const timestamps = validateMailItem(item);
      try {
        await withPostgresTransaction(pool, transactionOptions, async (client) => {
          const result = await client.query(
            `INSERT INTO mail_items (
               id, gmail_message_id, gmail_thread_id, client_id,
               suggested_project_id, approved_project_id, status, match_reason,
               email_drive_file_id, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO UPDATE SET
               gmail_message_id = EXCLUDED.gmail_message_id,
               gmail_thread_id = EXCLUDED.gmail_thread_id,
               client_id = EXCLUDED.client_id,
               suggested_project_id = EXCLUDED.suggested_project_id,
               approved_project_id = EXCLUDED.approved_project_id,
               status = EXCLUDED.status,
               match_reason = EXCLUDED.match_reason,
               email_drive_file_id = EXCLUDED.email_drive_file_id,
               updated_at = EXCLUDED.updated_at`,
            [
              item.id,
              item.gmailMessageId,
              item.gmailThreadId,
              item.clientId,
              item.suggestedProjectId,
              item.approvedProjectId,
              item.status,
              item.matchReason,
              item.emailDriveFileId,
              timestamps.createdAt,
              timestamps.updatedAt,
            ],
          );
          if (result.rowCount !== 1) {
            throw new Error("PostgreSQL mail item was not upserted exactly once");
          }
        });
        return Object.freeze({ outcome: "saved" });
      } catch (error) {
        const missing = referenceConstraintOutcome(error);
        if (missing) return missing;
        throw error;
      }
    },
  };
}
