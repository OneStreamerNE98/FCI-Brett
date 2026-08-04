import {
  MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
  normalizeMailItemConnectionKey,
  normalizeMailItemGmailMessageId,
  normalizeMailItemLabelDefinitionVersion,
  normalizeMailItemStatus,
  normalizeStoredMailItem,
  serializeMailItemAnalysisPayload,
  type MailItem,
} from "../../domain/mail-item";
import type {
  MailItemRepository,
  MailItemUpsertResult,
} from "../../ports/mail-item-repository";
import {
  RETRYABLE_EXHAUSTED_ANALYSIS_ERROR_CODES,
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
  connection_key: unknown;
  gmail_message_id: unknown;
  gmail_thread_id: unknown;
  client_id: unknown;
  suggested_project_id: unknown;
  approved_project_id: unknown;
  status: unknown;
  match_reason: unknown;
  email_drive_file_id: unknown;
  analysis_payload: unknown;
  party: unknown;
  confidence: unknown;
  content_hash: unknown;
  label_definition_version: unknown;
  attempted_label_definition_version: unknown;
  subject: unknown;
  sender: unknown;
  received_at: unknown;
  failure_attempts: unknown;
  error_code: unknown;
  coverage_complete: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const MANUAL_ANALYSIS_RETRY_MARKER = "manual-retry-requested";
const ALTERNATE_MANUAL_ANALYSIS_RETRY_MARKER = "manual-retry-requested-alt";

function manualAnalysisRetryMarker(currentLabelDefinitionVersion: string) {
  return currentLabelDefinitionVersion === MANUAL_ANALYSIS_RETRY_MARKER
    ? ALTERNATE_MANUAL_ANALYSIS_RETRY_MARKER
    : MANUAL_ANALYSIS_RETRY_MARKER;
}

function analysisFailureSummary(
  row: { failed_count: unknown; failed_reason: unknown } | undefined,
) {
  const count = Number(row?.failed_count ?? 0);
  const reason = row?.failed_reason ?? null;
  if (
    !Number.isSafeInteger(count)
    || count < 0
    || (count > 0 && !boundedText(reason, 120))
    || (count === 0 && reason !== null)
  ) {
    throw new Error("PostgreSQL exhausted analysis failure summary was invalid");
  }
  return Object.freeze({
    count,
    reason: count === 0 ? null : reason as string,
  });
}

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

function nullablePostgresTimestamp(value: unknown, label: string) {
  return value === null ? null : parsePostgresTimestamp(value, label);
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
  const receivedAt = nullablePostgresTimestamp(
    row.received_at,
    "PostgreSQL mail item received_at",
  );
  return normalizeStoredMailItem({
    ...row,
    client_id: row.client_id,
    suggested_project_id: row.suggested_project_id,
    approved_project_id: row.approved_project_id,
    received_at: receivedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

function validateMailItem(item: MailItem) {
  if (typeof item.coverageComplete !== "boolean") {
    throw new TypeError("PostgreSQL mail item coverage_complete must be boolean");
  }
  const normalized = normalizeStoredMailItem(
    item as unknown as Record<string, unknown>,
  );
  const createdAt = persistenceDate(
    normalized.createdAt,
    "PostgreSQL mail item created_at",
  );
  const updatedAt = persistenceDate(
    normalized.updatedAt,
    "PostgreSQL mail item updated_at",
  );
  const receivedAt = normalized.receivedAt === null
    ? null
    : persistenceDate(normalized.receivedAt, "PostgreSQL mail item received_at");
  return { normalized, createdAt, updatedAt, receivedAt };
}

const MAIL_ITEM_SELECT = `SELECT id, connection_key, gmail_message_id, gmail_thread_id,
       client_id::text AS client_id,
       suggested_project_id::text AS suggested_project_id,
       approved_project_id::text AS approved_project_id, status, match_reason,
       email_drive_file_id, analysis_payload, party, confidence, content_hash,
       label_definition_version, attempted_label_definition_version,
       subject, sender, received_at, failure_attempts,
       error_code, coverage_complete, created_at, updated_at
FROM mail_items`;

const MAIL_ITEM_REFERENCE_CONSTRAINTS = [
  "mail_items_client_id_fkey",
  "mail_items_suggested_project_id_fkey",
  "mail_items_approved_project_id_fkey",
] as const;

type MissingReferenceOutcome = Exclude<
  MailItemUpsertResult["outcome"],
  "saved" | "terminal-preserved"
>;

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

function singleRow(
  result: { rowCount: number | null; rows: MailItemDatabaseRow[] },
  label: string,
) {
  if (result.rowCount === 0) return null;
  if (result.rowCount !== 1 || !result.rows[0]) {
    throw new Error(`PostgreSQL ${label} returned an invalid result`);
  }
  return mailItemFromPostgres(result.rows[0]);
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
        async (client) => singleRow(
          await client.query<MailItemDatabaseRow>(
            `${MAIL_ITEM_SELECT}\nWHERE id = $1`,
            [id],
          ),
          "mail item lookup",
        ),
      );
    },

    async findByGmailMessageId(connectionKey, gmailMessageId) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedMessageId = normalizeMailItemGmailMessageId(gmailMessageId);
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => singleRow(
          await client.query<MailItemDatabaseRow>(
            `${MAIL_ITEM_SELECT}
WHERE connection_key = $1 AND gmail_message_id = $2`,
            [normalizedConnectionKey, normalizedMessageId],
          ),
          "Gmail mail item lookup",
        ),
      );
    },

    async listByStatus(connectionKey, status, limit) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedStatus = normalizeMailItemStatus(status);
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<MailItemDatabaseRow>(
            `${MAIL_ITEM_SELECT}
WHERE connection_key = $1 AND status = $2
ORDER BY updated_at DESC, id
LIMIT $3`,
            [normalizedConnectionKey, normalizedStatus, boundedLimit(limit)],
          );
          return result.rows.map(mailItemFromPostgres);
        },
      );
    },

    async listByStatusPage(connectionKey, status, limit) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedStatus = normalizeMailItemStatus(status);
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<
            MailItemDatabaseRow & { total_count: unknown }
          >(
            `SELECT page.*, COUNT(*) OVER ()::text AS total_count
FROM (
  ${MAIL_ITEM_SELECT}
  WHERE connection_key = $1 AND status = $2
) AS page
ORDER BY page.updated_at DESC, page.id
LIMIT $3`,
            [normalizedConnectionKey, normalizedStatus, boundedLimit(limit)],
          );
          const totalCount = Number(result.rows[0]?.total_count ?? 0);
          if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
            throw new Error("PostgreSQL mail item count was invalid");
          }
          return Object.freeze({
            items: result.rows.map(mailItemFromPostgres),
            totalCount,
          });
        },
      );
    },

    async listRetryableAnalysisRows(
      connectionKey,
      currentLabelDefinitionVersion,
      limit,
    ) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedLabelDefinitionVersion =
        normalizeMailItemLabelDefinitionVersion(currentLabelDefinitionVersion);
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<MailItemDatabaseRow>(
            `${MAIL_ITEM_SELECT}
WHERE connection_key = $1
  AND (
    error_code = 'analysis_daily_limit_reached'
    OR failure_attempts < $2
    OR attempted_label_definition_version IS DISTINCT FROM $3
  )
  AND (
    status = 'failed'
    OR (
      status = 'needs-review'
      AND label_definition_version IS DISTINCT FROM $4
    )
  )
ORDER BY updated_at ASC, id ASC
LIMIT $5`,
            [
              normalizedConnectionKey,
              MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
              normalizedLabelDefinitionVersion,
              normalizedLabelDefinitionVersion,
              boundedLimit(limit),
            ],
          );
          return result.rows.map(mailItemFromPostgres);
        },
      );
    },

    async getExhaustedAnalysisFailureSummary(
      connectionKey,
      currentLabelDefinitionVersion,
    ) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedLabelDefinitionVersion =
        normalizeMailItemLabelDefinitionVersion(currentLabelDefinitionVersion);
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<{
            failed_count: unknown;
            failed_reason: unknown;
          }>(
            `SELECT COUNT(*)::text AS failed_count,
       MIN(error_code) AS failed_reason
FROM mail_items
WHERE connection_key = $1
  AND status = 'failed'
  AND failure_attempts >= $2
  AND attempted_label_definition_version = $3
  AND error_code != 'analysis_daily_limit_reached'`,
            [
              normalizedConnectionKey,
              MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
              normalizedLabelDefinitionVersion,
            ],
          );
          if (result.rowCount !== 1) {
            throw new Error(
              "PostgreSQL exhausted analysis failure summary returned an invalid result",
            );
          }
          return analysisFailureSummary(result.rows[0]);
        },
      );
    },

    async resetExhaustedAnalysisFailures(
      connectionKey,
      currentLabelDefinitionVersion,
      updatedAt,
    ) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedLabelDefinitionVersion =
        normalizeMailItemLabelDefinitionVersion(currentLabelDefinitionVersion);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `UPDATE mail_items
SET failure_attempts = 1,
    attempted_label_definition_version = $1,
    updated_at = $2
WHERE connection_key = $3
  AND status = 'failed'
  AND failure_attempts >= $4
  AND attempted_label_definition_version = $5
  AND error_code IN ($6, $7, $8, $9)`,
          [
            manualAnalysisRetryMarker(normalizedLabelDefinitionVersion),
            persistenceDate(updatedAt, "PostgreSQL mail item updated_at"),
            normalizedConnectionKey,
            MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
            normalizedLabelDefinitionVersion,
            ...RETRYABLE_EXHAUSTED_ANALYSIS_ERROR_CODES,
          ],
        );
        if (
          result.rowCount === null
          || !Number.isSafeInteger(result.rowCount)
          || result.rowCount < 0
        ) {
          throw new Error("PostgreSQL exhausted analysis reset count was invalid");
        }
        return result.rowCount;
      });
    },

    async markCoverageComplete(connectionKey) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      await withPostgresTransaction(pool, transactionOptions, async (client) => {
        await client.query(
          `UPDATE mail_items
SET coverage_complete = true
WHERE connection_key = $1 AND coverage_complete = false`,
          [normalizedConnectionKey],
        );
      });
    },

    async dismissNeedsReview(id, connectionKey, updatedAt, outcome = "dismissed") {
      if (!boundedText(id, 512)) return false;
      // Mirrors the D1 adapter exactly: the outcome is BOUND, never interpolated, and
      // re-guarded here so a future caller cannot widen it into an arbitrary status.
      if (outcome !== "accepted" && outcome !== "dismissed") return false;
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `UPDATE mail_items
SET status = $1,
    attempted_label_definition_version = NULL,
    failure_attempts = 0,
    error_code = NULL,
    updated_at = $2
WHERE id = $3
  AND connection_key = $4
  AND status = 'needs-review'`,
          [
            outcome,
            persistenceDate(updatedAt, "PostgreSQL mail item updated_at"),
            id,
            normalizedConnectionKey,
          ],
        );
        return result.rowCount === 1;
      });
    },

    async insertIfAbsent(item) {
      const invalidReferenceResult = invalidReference(item);
      if (invalidReferenceResult) return invalidReferenceResult;
      const values = validateMailItem(item);
      const normalized = values.normalized;
      try {
        const rowCount = await withPostgresTransaction(
          pool,
          transactionOptions,
          async (client) => {
            // Suggested-project evidence is non-authoritative. The scalar
            // lookup atomically turns a concurrently removed project into
            // null while retaining the durable analysis row.
            const result = await client.query(
              `INSERT INTO mail_items (
               id, connection_key, gmail_message_id, gmail_thread_id, client_id,
               suggested_project_id, approved_project_id, status, match_reason,
               email_drive_file_id, analysis_payload, party, confidence, content_hash,
               label_definition_version, attempted_label_definition_version,
               subject, sender, received_at,
               failure_attempts, error_code, coverage_complete, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5,
               (SELECT id FROM projects WHERE id = $6::uuid),
               $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
             )
             ON CONFLICT (connection_key, gmail_message_id) DO NOTHING`,
              [
                normalized.id,
                normalized.connectionKey,
                normalized.gmailMessageId,
                normalized.gmailThreadId,
                normalized.clientId,
                normalized.suggestedProjectId,
                normalized.approvedProjectId,
                normalized.status,
                normalized.matchReason,
                normalized.emailDriveFileId,
                serializeMailItemAnalysisPayload(normalized.analysisPayload),
                normalized.party,
                normalized.confidence,
                normalized.contentHash,
                normalized.labelDefinitionVersion,
                normalized.attemptedLabelDefinitionVersion,
                normalized.subject,
                normalized.sender,
                values.receivedAt,
                normalized.failureAttempts,
                normalized.errorCode,
                normalized.coverageComplete,
                values.createdAt,
                values.updatedAt,
              ],
            );
            if (result.rowCount !== 0 && result.rowCount !== 1) {
              throw new Error(
                "PostgreSQL mail item was not inserted exactly once",
              );
            }
            return result.rowCount;
          },
        );
        return Object.freeze({
          outcome: rowCount === 0 ? "existing-preserved" : "saved",
        });
      } catch (error) {
        const missing = referenceConstraintOutcome(error);
        if (missing) return missing;
        throw error;
      }
    },

    async upsert(item) {
      const invalidReferenceResult = invalidReference(item);
      if (invalidReferenceResult) return invalidReferenceResult;
      const values = validateMailItem(item);
      const normalized = values.normalized;
      try {
        const rowCount = await withPostgresTransaction(
          pool,
          transactionOptions,
          async (client) => {
            // Match insertIfAbsent: a stale classifier suggestion must not
            // prevent the analysis/watermark row from being persisted.
            const result = await client.query(
              `INSERT INTO mail_items (
               id, connection_key, gmail_message_id, gmail_thread_id, client_id,
               suggested_project_id, approved_project_id, status, match_reason,
               email_drive_file_id, analysis_payload, party, confidence, content_hash,
               label_definition_version, attempted_label_definition_version,
               subject, sender, received_at,
               failure_attempts, error_code, coverage_complete, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5,
               (SELECT id FROM projects WHERE id = $6::uuid),
               $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
             )
             ON CONFLICT (connection_key, gmail_message_id) DO UPDATE SET
               gmail_thread_id = EXCLUDED.gmail_thread_id,
               client_id = EXCLUDED.client_id,
               suggested_project_id = EXCLUDED.suggested_project_id,
               approved_project_id = EXCLUDED.approved_project_id,
               status = EXCLUDED.status,
               match_reason = EXCLUDED.match_reason,
               email_drive_file_id = EXCLUDED.email_drive_file_id,
               analysis_payload = EXCLUDED.analysis_payload,
               party = EXCLUDED.party,
               confidence = EXCLUDED.confidence,
               content_hash = EXCLUDED.content_hash,
               label_definition_version = EXCLUDED.label_definition_version,
               attempted_label_definition_version = EXCLUDED.attempted_label_definition_version,
               subject = EXCLUDED.subject,
               sender = EXCLUDED.sender,
               received_at = EXCLUDED.received_at,
               failure_attempts = EXCLUDED.failure_attempts,
               error_code = EXCLUDED.error_code,
               coverage_complete = mail_items.coverage_complete OR EXCLUDED.coverage_complete,
               updated_at = EXCLUDED.updated_at
             WHERE mail_items.status IN ('needs-review', 'failed')`,
              [
                normalized.id,
                normalized.connectionKey,
                normalized.gmailMessageId,
                normalized.gmailThreadId,
                normalized.clientId,
                normalized.suggestedProjectId,
                normalized.approvedProjectId,
                normalized.status,
                normalized.matchReason,
                normalized.emailDriveFileId,
                serializeMailItemAnalysisPayload(normalized.analysisPayload),
                normalized.party,
                normalized.confidence,
                normalized.contentHash,
                normalized.labelDefinitionVersion,
                normalized.attemptedLabelDefinitionVersion,
                normalized.subject,
                normalized.sender,
                values.receivedAt,
                normalized.failureAttempts,
                normalized.errorCode,
                normalized.coverageComplete,
                values.createdAt,
                values.updatedAt,
              ],
            );
            if (result.rowCount !== 0 && result.rowCount !== 1) {
              throw new Error("PostgreSQL mail item was not upserted exactly once");
            }
            return result.rowCount;
          },
        );
        return Object.freeze({
          outcome: rowCount === 0 ? "terminal-preserved" : "saved",
        });
      } catch (error) {
        const missing = referenceConstraintOutcome(error);
        if (missing) return missing;
        throw error;
      }
    },
  };
}
