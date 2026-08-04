import {
  MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
  isMailItemRelationshipId,
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
import type { D1Database } from "./d1-database";

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
  row: { failed_count: unknown; failed_reason: unknown },
) {
  const count = Number(row?.failed_count ?? 0);
  const reason = row?.failed_reason ?? null;
  if (
    !Number.isSafeInteger(count)
    || count < 0
    || (count > 0 && (
      typeof reason !== "string"
      || !reason.trim()
      || reason.length > 120
      || /[\u0000-\u001f\u007f]/.test(reason)
    ))
    || (count === 0 && reason !== null)
  ) {
    throw new Error("D1 exhausted analysis failure summary was invalid");
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

function boundedId(value: unknown) {
  return typeof value === "string"
    && Boolean(value.trim())
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
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

type MissingReferenceOutcome = Exclude<
  MailItemUpsertResult["outcome"],
  "saved" | "terminal-preserved"
>;

const REFERENCE_OUTCOMES = [
  { property: "clientId", outcome: "client-not-found", table: "clients" },
  {
    property: "suggestedProjectId",
    outcome: "suggested-project-not-found",
    table: "projects",
  },
  {
    property: "approvedProjectId",
    outcome: "approved-project-not-found",
    table: "projects",
  },
] as const satisfies readonly {
  property: "clientId" | "suggestedProjectId" | "approvedProjectId";
  outcome: MissingReferenceOutcome;
  table: "clients" | "projects";
}[];

function missingReference(outcome: MissingReferenceOutcome): MailItemUpsertResult {
  return Object.freeze({ outcome });
}

function invalidReference(
  item: Parameters<MailItemRepository["upsert"]>[0],
): MailItemUpsertResult | null {
  for (const reference of REFERENCE_OUTCOMES) {
    const value = item[reference.property];
    if (value !== null && !isMailItemRelationshipId(value)) {
      return missingReference(reference.outcome);
    }
  }
  return null;
}

type ReferenceResolution =
  | Readonly<{ kind: "item"; item: MailItem }>
  | Readonly<{ kind: "result"; result: MailItemUpsertResult }>;

async function resolveStoredReferences(
  database: D1Database,
  item: MailItem,
): Promise<ReferenceResolution> {
  let suggestedProjectId = item.suggestedProjectId;
  for (const reference of REFERENCE_OUTCOMES) {
    const value = item[reference.property];
    if (value === null || await referenceExists(database, reference.table, value)) {
      continue;
    }
    // A suggestion is classifier evidence, not an accepted relationship. If
    // its project disappears between evidence selection and persistence, keep
    // the durable analysis/watermark while dropping the stale foreign key.
    if (reference.property === "suggestedProjectId") {
      suggestedProjectId = null;
      continue;
    }
    return Object.freeze({
      kind: "result",
      result: missingReference(reference.outcome),
    });
  }
  return Object.freeze({
    kind: "item",
    item: suggestedProjectId === item.suggestedProjectId
      ? item
      : Object.freeze({ ...item, suggestedProjectId }),
  });
}

export function createD1MailItemRepository(database: D1Database): MailItemRepository {
  return {
    async findById(id) {
      if (!boundedId(id)) return null;
      const row = await database
        .prepare("SELECT * FROM mail_items WHERE id = ?")
        .bind(id)
        .first<Record<string, unknown>>();
      return row ? normalizeStoredMailItem(row) : null;
    },

    async findByGmailMessageId(connectionKey, gmailMessageId) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedMessageId = normalizeMailItemGmailMessageId(gmailMessageId);
      const row = await database
        .prepare(
          "SELECT * FROM mail_items WHERE connection_key = ? AND gmail_message_id = ?",
        )
        .bind(normalizedConnectionKey, normalizedMessageId)
        .first<Record<string, unknown>>();
      return row ? normalizeStoredMailItem(row) : null;
    },

    async listByStatus(connectionKey, status, limit) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedStatus = normalizeMailItemStatus(status);
      const result = await database
        .prepare(
          "SELECT * FROM mail_items WHERE connection_key = ? AND status = ? ORDER BY updated_at DESC, id LIMIT ?",
        )
        .bind(normalizedConnectionKey, normalizedStatus, boundedLimit(limit))
        .all<Record<string, unknown>>();
      return result.results.map(normalizeStoredMailItem);
    },

    async listByStatusPage(connectionKey, status, limit) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedStatus = normalizeMailItemStatus(status);
      const result = await database
        .prepare(
          "SELECT mail_items.*, COUNT(*) OVER () AS total_count FROM mail_items WHERE connection_key = ? AND status = ? ORDER BY updated_at DESC, id LIMIT ?",
        )
        .bind(normalizedConnectionKey, normalizedStatus, boundedLimit(limit))
        .all<Record<string, unknown> & { total_count: unknown }>();
      const totalCount = Number(result.results[0]?.total_count ?? 0);
      if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
        throw new Error("D1 mail item count was invalid");
      }
      return Object.freeze({
        items: result.results.map(normalizeStoredMailItem),
        totalCount,
      });
    },

    async listRetryableAnalysisRows(
      connectionKey,
      currentLabelDefinitionVersion,
      limit,
    ) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedLabelDefinitionVersion =
        normalizeMailItemLabelDefinitionVersion(currentLabelDefinitionVersion);
      const result = await database
        .prepare(
          "SELECT * FROM mail_items WHERE connection_key = ? AND (error_code = 'analysis_daily_limit_reached' OR failure_attempts < ? OR attempted_label_definition_version IS NOT ?) AND (status = 'failed' OR (status = 'needs-review' AND label_definition_version IS NOT ?)) ORDER BY updated_at ASC, id ASC LIMIT ?",
        )
        .bind(
          normalizedConnectionKey,
          MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
          normalizedLabelDefinitionVersion,
          normalizedLabelDefinitionVersion,
          boundedLimit(limit),
        )
        .all<Record<string, unknown>>();
      return result.results.map(normalizeStoredMailItem);
    },

    async getExhaustedAnalysisFailureSummary(
      connectionKey,
      currentLabelDefinitionVersion,
    ) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedLabelDefinitionVersion =
        normalizeMailItemLabelDefinitionVersion(currentLabelDefinitionVersion);
      const row = await database
        .prepare(
          "SELECT COUNT(*) AS failed_count, MIN(error_code) AS failed_reason FROM mail_items WHERE connection_key = ? AND status = 'failed' AND failure_attempts >= ? AND attempted_label_definition_version = ? AND error_code != 'analysis_daily_limit_reached'",
        )
        .bind(
          normalizedConnectionKey,
          MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
          normalizedLabelDefinitionVersion,
        )
        .first<{ failed_count: unknown; failed_reason: unknown }>();
      if (!row) {
        throw new Error("D1 exhausted analysis failure summary returned no row");
      }
      return analysisFailureSummary(row);
    },

    async resetExhaustedAnalysisFailures(
      connectionKey,
      currentLabelDefinitionVersion,
      updatedAt,
    ) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const normalizedLabelDefinitionVersion =
        normalizeMailItemLabelDefinitionVersion(currentLabelDefinitionVersion);
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
        throw new TypeError("Mail item updated_at is invalid");
      }
      const result = await database
        .prepare(
          "UPDATE mail_items SET failure_attempts = 1, attempted_label_definition_version = ?, updated_at = ? WHERE connection_key = ? AND status = 'failed' AND failure_attempts >= ? AND attempted_label_definition_version = ? AND error_code IN (?, ?, ?, ?)",
        )
        .bind(
          manualAnalysisRetryMarker(normalizedLabelDefinitionVersion),
          updatedAt,
          normalizedConnectionKey,
          MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
          normalizedLabelDefinitionVersion,
          ...RETRYABLE_EXHAUSTED_ANALYSIS_ERROR_CODES,
        )
        .run();
      const changes = Number(result.meta.changes ?? 0);
      if (!Number.isSafeInteger(changes) || changes < 0) {
        throw new Error("D1 exhausted analysis reset count was invalid");
      }
      return changes;
    },

    async markCoverageComplete(connectionKey) {
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      await database
        .prepare(
          "UPDATE mail_items SET coverage_complete = 1 WHERE connection_key = ? AND coverage_complete = 0",
        )
        .bind(normalizedConnectionKey)
        .run();
    },

    async dismissNeedsReview(id, connectionKey, updatedAt, outcome = "dismissed") {
      if (!boundedId(id)) return false;
      // The outcome is BOUND, never interpolated, and the caller has already validated
      // it against the two-value MailItemReviewOutcome union. Guard again here so a
      // future caller cannot widen it into an arbitrary status write.
      if (outcome !== "accepted" && outcome !== "dismissed") return false;
      const normalizedConnectionKey = normalizeMailItemConnectionKey(connectionKey);
      const result = await database
        .prepare(
          "UPDATE mail_items SET status = ?, attempted_label_definition_version = NULL, failure_attempts = 0, error_code = NULL, updated_at = ? WHERE id = ? AND connection_key = ? AND status = 'needs-review'",
        )
        .bind(outcome, updatedAt, id, normalizedConnectionKey)
        .run();
      return Number(result.meta.changes ?? 0) === 1;
    },

    async insertIfAbsent(item) {
      const invalidReferenceResult = invalidReference(item);
      if (invalidReferenceResult) return invalidReferenceResult;
      if (typeof item.coverageComplete !== "boolean") {
        throw new TypeError("Mail item coverage_complete must be boolean");
      }
      const normalized = normalizeStoredMailItem(
        item as unknown as Record<string, unknown>,
      );
      const referenceResolution = await resolveStoredReferences(database, normalized);
      if (referenceResolution.kind === "result") return referenceResolution.result;
      const relationshipSafe = referenceResolution.item;
      const result = await database
        .prepare(
          "INSERT INTO mail_items (id, connection_key, gmail_message_id, gmail_thread_id, client_id, suggested_project_id, approved_project_id, status, match_reason, email_drive_file_id, analysis_payload, party, confidence, content_hash, label_definition_version, attempted_label_definition_version, subject, sender, received_at, failure_attempts, error_code, coverage_complete, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_key, gmail_message_id) DO NOTHING",
        )
        .bind(
          relationshipSafe.id,
          relationshipSafe.connectionKey,
          relationshipSafe.gmailMessageId,
          relationshipSafe.gmailThreadId,
          relationshipSafe.clientId,
          relationshipSafe.suggestedProjectId,
          relationshipSafe.approvedProjectId,
          relationshipSafe.status,
          relationshipSafe.matchReason,
          relationshipSafe.emailDriveFileId,
          serializeMailItemAnalysisPayload(relationshipSafe.analysisPayload),
          relationshipSafe.party,
          relationshipSafe.confidence,
          relationshipSafe.contentHash,
          relationshipSafe.labelDefinitionVersion,
          relationshipSafe.attemptedLabelDefinitionVersion,
          relationshipSafe.subject,
          relationshipSafe.sender,
          relationshipSafe.receivedAt,
          relationshipSafe.failureAttempts,
          relationshipSafe.errorCode,
          relationshipSafe.coverageComplete ? 1 : 0,
          relationshipSafe.createdAt,
          relationshipSafe.updatedAt,
        )
        .run();
      if (result.meta.changes === 0) {
        return Object.freeze({ outcome: "existing-preserved" });
      }
      if (result.meta.changes !== 1) {
        throw new Error("D1 mail item was not inserted exactly once");
      }
      return Object.freeze({ outcome: "saved" });
    },

    async upsert(item) {
      const invalidReferenceResult = invalidReference(item);
      if (invalidReferenceResult) return invalidReferenceResult;
      if (typeof item.coverageComplete !== "boolean") {
        throw new TypeError("Mail item coverage_complete must be boolean");
      }
      const normalized = normalizeStoredMailItem(
        item as unknown as Record<string, unknown>,
      );
      const referenceResolution = await resolveStoredReferences(database, normalized);
      if (referenceResolution.kind === "result") return referenceResolution.result;
      const relationshipSafe = referenceResolution.item;

      const result = await database
        .prepare(
          "INSERT INTO mail_items (id, connection_key, gmail_message_id, gmail_thread_id, client_id, suggested_project_id, approved_project_id, status, match_reason, email_drive_file_id, analysis_payload, party, confidence, content_hash, label_definition_version, attempted_label_definition_version, subject, sender, received_at, failure_attempts, error_code, coverage_complete, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_key, gmail_message_id) DO UPDATE SET gmail_thread_id = excluded.gmail_thread_id, client_id = excluded.client_id, suggested_project_id = excluded.suggested_project_id, approved_project_id = excluded.approved_project_id, status = excluded.status, match_reason = excluded.match_reason, email_drive_file_id = excluded.email_drive_file_id, analysis_payload = excluded.analysis_payload, party = excluded.party, confidence = excluded.confidence, content_hash = excluded.content_hash, label_definition_version = excluded.label_definition_version, attempted_label_definition_version = excluded.attempted_label_definition_version, subject = excluded.subject, sender = excluded.sender, received_at = excluded.received_at, failure_attempts = excluded.failure_attempts, error_code = excluded.error_code, coverage_complete = mail_items.coverage_complete OR excluded.coverage_complete, updated_at = excluded.updated_at WHERE mail_items.status IN ('needs-review', 'failed')",
        )
        .bind(
          relationshipSafe.id,
          relationshipSafe.connectionKey,
          relationshipSafe.gmailMessageId,
          relationshipSafe.gmailThreadId,
          relationshipSafe.clientId,
          relationshipSafe.suggestedProjectId,
          relationshipSafe.approvedProjectId,
          relationshipSafe.status,
          relationshipSafe.matchReason,
          relationshipSafe.emailDriveFileId,
          serializeMailItemAnalysisPayload(relationshipSafe.analysisPayload),
          relationshipSafe.party,
          relationshipSafe.confidence,
          relationshipSafe.contentHash,
          relationshipSafe.labelDefinitionVersion,
          relationshipSafe.attemptedLabelDefinitionVersion,
          relationshipSafe.subject,
          relationshipSafe.sender,
          relationshipSafe.receivedAt,
          relationshipSafe.failureAttempts,
          relationshipSafe.errorCode,
          relationshipSafe.coverageComplete ? 1 : 0,
          relationshipSafe.createdAt,
          relationshipSafe.updatedAt,
        )
        .run();
      if (result.meta.changes === 0) {
        return Object.freeze({ outcome: "terminal-preserved" });
      }
      if (result.meta.changes !== 1) {
        throw new Error("D1 mail item was not upserted exactly once");
      }
      return Object.freeze({ outcome: "saved" });
    },
  };
}
