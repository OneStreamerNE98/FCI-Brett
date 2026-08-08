import {
  MAX_ASSISTANT_LABEL_ROWS,
  MAX_ASSISTANT_LABELS,
  normalizeAssistantLabelSlug,
} from "../../domain/assistant-label-definition";
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
  MailItemReviewActivityLabelCount,
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

function reviewActivityLabelCount(
  row: Readonly<Record<string, unknown>>,
): MailItemReviewActivityLabelCount {
  const slug = normalizeAssistantLabelSlug(row.slug);
  const acceptedCount = Number(row.accepted_count);
  const dismissedCount = Number(row.dismissed_count);
  if (
    !Number.isSafeInteger(acceptedCount)
    || acceptedCount < 0
    || !Number.isSafeInteger(dismissedCount)
    || dismissedCount < 0
  ) {
    throw new Error("PostgreSQL mail item review activity count was invalid");
  }
  return Object.freeze({ slug, acceptedCount, dismissedCount });
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
  const reviewedAt = nullablePostgresTimestamp(
    row.reviewed_at,
    "PostgreSQL mail item reviewed_at",
  );
  return normalizeStoredMailItem({
    ...row,
    client_id: row.client_id,
    suggested_project_id: row.suggested_project_id,
    approved_project_id: row.approved_project_id,
    received_at: receivedAt,
    reviewed_at: reviewedAt,
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
       error_code, coverage_complete, reviewed_by, reviewed_at, accepted_intent,
       created_at, updated_at
FROM mail_items`;

if (!MAIL_ITEM_SELECT.includes("reviewed_by") || !MAIL_ITEM_SELECT.includes("reviewed_at") || !MAIL_ITEM_SELECT.includes("accepted_intent")) {
  throw new Error("MAIL_ITEM_SELECT must include reviewed_by, reviewed_at, and accepted_intent");
}

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

function normalizedIntentSlugs(intentSlugs: readonly string[]) {
  if (!Array.isArray(intentSlugs) || intentSlugs.length > MAX_ASSISTANT_LABELS) {
    throw new TypeError("Mail item analysis intent catalog is invalid");
  }
  const normalized = intentSlugs.map(normalizeAssistantLabelSlug);
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Mail item analysis intents must be unique");
  }
  return normalized;
}

function normalizedActivityLabelSlugs(labelSlugs: readonly string[]) {
  if (!Array.isArray(labelSlugs) || labelSlugs.length > MAX_ASSISTANT_LABEL_ROWS) {
    throw new TypeError("Mail item review activity label catalog is invalid");
  }
  const normalized = labelSlugs.map(normalizeAssistantLabelSlug);
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Mail item review activity labels must be unique");
  }
  return normalized;
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

    async listReviewActivity(connectionKey, limit) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
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
  WHERE connection_key = $1 AND status IN ('accepted', 'dismissed')
) AS page
ORDER BY page.updated_at DESC, page.id
LIMIT $2`,
            [normalizedConnectionKey, boundedLimit(limit)],
          );
          const totalCount = Number(result.rows[0]?.total_count ?? 0);
          if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
            throw new Error("PostgreSQL mail item review activity count was invalid");
          }
          return Object.freeze({
            items: result.rows.map(mailItemFromPostgres),
            totalCount,
          });
        },
      );
    },

    async listReviewActivityLabelCounts(connectionKey, labelSlugs) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedSlugs = normalizedActivityLabelSlugs(labelSlugs);
      if (normalizedSlugs.length === 0) return [];
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<Record<string, unknown>>(
            `WITH attributed_outcomes AS (
  SELECT id, accepted_intent AS slug, 1::bigint AS accepted_count, 0::bigint AS dismissed_count
  FROM mail_items
  WHERE connection_key = $1
    AND status = 'accepted'
    AND reviewed_by IS NOT NULL
    AND reviewed_at IS NOT NULL
    AND accepted_intent = ANY($2::text[])
  UNION ALL
  SELECT DISTINCT item.id, proposed.intent AS slug, 0::bigint AS accepted_count, 1::bigint AS dismissed_count
  FROM mail_items AS item
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(item.analysis_payload -> 'intents') = 'array'
        THEN item.analysis_payload -> 'intents'
      ELSE '[]'::jsonb
    END
  ) AS proposed(intent)
  WHERE item.connection_key = $1
    AND item.status = 'dismissed'
    AND item.reviewed_by IS NOT NULL
    AND item.reviewed_at IS NOT NULL
    AND proposed.intent = ANY($2::text[])
)
SELECT slug,
       SUM(accepted_count)::text AS accepted_count,
       SUM(dismissed_count)::text AS dismissed_count
FROM attributed_outcomes
GROUP BY slug
ORDER BY slug`,
            [normalizedConnectionKey, normalizedSlugs],
          );
          return result.rows.map(reviewActivityLabelCount);
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
    error_code IN ('analysis_daily_limit_reached', 'analysis_label_catalog_changed')
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
  AND error_code NOT IN ('analysis_daily_limit_reached', 'analysis_label_catalog_changed')`,
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

    async dismissNeedsReview(id, connectionKey, updatedAt, reviewedBy, outcome = "dismissed", acceptedIntent = undefined) {
      if (!boundedText(id, 512)) return false;
      // Mirrors the D1 adapter exactly: the outcome is BOUND, never interpolated, and
      // re-guarded here so a future caller cannot widen it into an arbitrary status.
      if (outcome !== "accepted" && outcome !== "dismissed") return false;
      const normalizedAcceptedIntent = acceptedIntent === undefined
        ? null
        : normalizeAssistantLabelSlug(acceptedIntent);
      if (
        (outcome === "accepted" && normalizedAcceptedIntent === null)
        || (outcome === "dismissed" && normalizedAcceptedIntent !== null)
      ) return false;
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `UPDATE mail_items
SET status = $1,
    reviewed_by = $2,
    reviewed_at = $3,
    accepted_intent = $4,
    attempted_label_definition_version = NULL,
    failure_attempts = 0,
    error_code = NULL,
    updated_at = $5
WHERE id = $6
  AND connection_key = $7
  AND status = 'needs-review'
  AND (
    $1 = 'dismissed'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(analysis_payload -> 'intents') = 'array'
            THEN analysis_payload -> 'intents'
          ELSE '[]'::jsonb
        END
      ) AS proposed(intent)
      WHERE proposed.intent = $4
    )
  )`,
          [
            outcome,
            reviewedBy,
            persistenceDate(updatedAt, "PostgreSQL mail item reviewed_at"),
            normalizedAcceptedIntent,
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

    async saveAnalysisIfLabelsActive(item, intentSlugs, mode) {
      const invalidReferenceResult = invalidReference(item);
      if (invalidReferenceResult) return invalidReferenceResult;
      if (mode !== "upsert" && mode !== "insert-if-absent") {
        throw new TypeError("Mail item analysis write mode is invalid");
      }
      const slugs = normalizedIntentSlugs(intentSlugs);
      const values = validateMailItem(item);
      const normalized = values.normalized;
      try {
        return await withPostgresTransaction(
          pool,
          transactionOptions,
          async (client): Promise<MailItemUpsertResult> => {
            if (slugs.length > 0) {
              // FOR SHARE blocks both retirement and deletion until the
              // mail_items write commits. The inverse ordering is handled by
              // the count mismatch, so every interleaving either saves then
              // retires or rejects the stale classifier snapshot.
              const activeLabels = await client.query<{ slug: string }>(
                `SELECT slug
                   FROM assistant_label_definitions
                  WHERE retired = false AND slug = ANY($1::text[])
                  FOR SHARE`,
                [slugs],
              );
              if (activeLabels.rowCount !== slugs.length) {
                return Object.freeze({ outcome: "label-catalog-changed" });
              }
            }

            const conflictClause = mode === "insert-if-absent"
              ? "DO NOTHING"
              : `DO UPDATE SET
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
                 WHERE mail_items.status IN ('needs-review', 'failed')`;
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
               ON CONFLICT (connection_key, gmail_message_id) ${conflictClause}`,
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
              throw new Error("PostgreSQL guarded mail item analysis was not written exactly once");
            }
            return Object.freeze({
              outcome: result.rowCount === 1
                ? "saved"
                : mode === "insert-if-absent"
                  ? "existing-preserved"
                  : "terminal-preserved",
            });
          },
        );
      } catch (error) {
        const missing = referenceConstraintOutcome(error);
        if (missing) return missing;
        throw error;
      }
    },
  };
}
