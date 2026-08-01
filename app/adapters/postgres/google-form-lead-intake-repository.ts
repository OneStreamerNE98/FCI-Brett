import {
  GOOGLE_FORM_LEAD_REVIEW_STATES,
  GOOGLE_FORM_LEAD_REVIEW_STATUSES,
  GoogleFormLeadReviewDraftValidationError,
  isGoogleFormLeadPositionBatch,
  isGoogleFormLeadSubmissionKey,
  parseGoogleFormLeadProposal,
  parseGoogleFormLeadReasons,
} from "../../domain/google-form-lead-intake";
import type {
  GoogleFormLeadIntakeRepository,
  GoogleFormLeadIntakeWatermark,
  GoogleFormLeadProcessedSubmission,
  GoogleFormLeadReviewRecord,
  GoogleFormLeadReviewState,
  GoogleFormLeadReviewStatus,
  DismissGoogleFormLeadReviewInput,
  SaveGoogleFormLeadBatchInput,
} from "../../ports/google-form-lead-intake";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  isPostgresUuid,
  parsePostgresTimestamp,
  postgresSchemaName,
} from "./postgres-values";

type Options = Readonly<{
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}>;

type WatermarkRow = Record<string, unknown> & {
  connection_key: unknown;
  spreadsheet_id: unknown;
  last_processed_row: unknown;
  last_processed_submission_key: unknown;
  last_processed_at: unknown;
  updated_by: unknown;
};

type ReviewRow = Record<string, unknown> & {
  id: unknown;
  connection_key: unknown;
  spreadsheet_id: unknown;
  source_row: unknown;
  submission_key: unknown;
  submitted_at: unknown;
  state: unknown;
  status: unknown;
  proposal_json: unknown;
  reasons_json: unknown;
  created_at: unknown;
  updated_at: unknown;
  reviewed_by: unknown;
  reviewed_at: unknown;
  accepted_lead_id: unknown;
};

type ProcessedSubmissionRow = Record<string, unknown> & {
  submission_key: unknown;
  source_row: unknown;
  status: unknown;
};

const CONNECTION_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;

function requiredText(value: unknown, maximum: number, label: string) {
  if (
    typeof value !== "string" || !value.trim() || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new Error(`${label} is invalid`);
  return value;
}

function integer(value: unknown, minimum: number, label: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${label} is invalid`);
  return parsed;
}

function assertScope(connectionKey: string, spreadsheetId: string) {
  if (!CONNECTION_KEY_PATTERN.test(connectionKey) || !PROVIDER_ID_PATTERN.test(spreadsheetId)) {
    throw new TypeError("PostgreSQL Google Form intake scope is invalid");
  }
}

function assertActor(value: string) {
  requiredText(value, 320, "PostgreSQL Google Form intake actor");
}

function watermarkFromRow(row: WatermarkRow): GoogleFormLeadIntakeWatermark {
  const connectionKey = requiredText(row.connection_key, 128, "PostgreSQL Google Form connection key");
  const spreadsheetId = requiredText(row.spreadsheet_id, 256, "PostgreSQL Google Form Sheet ID");
  const lastProcessedSubmissionKey = row.last_processed_submission_key;
  assertScope(connectionKey, spreadsheetId);
  if (!isGoogleFormLeadSubmissionKey(lastProcessedSubmissionKey)) {
    throw new Error("PostgreSQL Google Form watermark submission key is invalid");
  }
  return Object.freeze({
    connectionKey,
    spreadsheetId,
    lastProcessedRow: integer(row.last_processed_row, 2, "PostgreSQL Google Form watermark row"),
    lastProcessedSubmissionKey,
    lastProcessedAt: parsePostgresTimestamp(row.last_processed_at, "PostgreSQL Google Form watermark time"),
    updatedBy: requiredText(row.updated_by, 320, "PostgreSQL Google Form watermark actor"),
  });
}

function reviewFromRow(row: ReviewRow): GoogleFormLeadReviewRecord {
  if (!isPostgresUuid(row.id)) throw new Error("PostgreSQL Google Form review ID is invalid");
  const connectionKey = requiredText(row.connection_key, 128, "PostgreSQL Google Form connection key");
  const spreadsheetId = requiredText(row.spreadsheet_id, 256, "PostgreSQL Google Form Sheet ID");
  assertScope(connectionKey, spreadsheetId);
  const state = requiredText(row.state, 32, "PostgreSQL Google Form review state");
  const status = requiredText(row.status, 32, "PostgreSQL Google Form review status");
  const proposal = parseGoogleFormLeadProposal(row.proposal_json);
  const reasons = parseGoogleFormLeadReasons(row.reasons_json);
  const submittedAt = row.submitted_at === null
    ? null
    : requiredText(row.submitted_at, 100, "PostgreSQL Google Form submitted time");
  const reviewedBy = row.reviewed_by === null
    ? null
    : requiredText(row.reviewed_by, 320, "PostgreSQL Google Form reviewer");
  const reviewedAt = row.reviewed_at === null
    ? null
    : parsePostgresTimestamp(row.reviewed_at, "PostgreSQL Google Form reviewed time");
  const acceptedLeadId = row.accepted_lead_id === null ? null : row.accepted_lead_id;
  const submissionKey = row.submission_key;
  if (
    !isGoogleFormLeadSubmissionKey(submissionKey)
    || !(GOOGLE_FORM_LEAD_REVIEW_STATES as readonly string[]).includes(state)
    || !(GOOGLE_FORM_LEAD_REVIEW_STATUSES as readonly string[]).includes(status)
    || !proposal || !reasons
    || (acceptedLeadId !== null && !isPostgresUuid(acceptedLeadId))
    || (status === "needs-review"
      && (reviewedBy !== null || reviewedAt !== null || acceptedLeadId !== null))
    || (status === "accepted" && (!reviewedBy || reviewedAt === null || !acceptedLeadId))
    || (status === "dismissed" && (!reviewedBy || reviewedAt === null || acceptedLeadId !== null))
  ) throw new Error("PostgreSQL Google Form review row is invalid");
  return Object.freeze({
    id: row.id,
    connectionKey,
    spreadsheetId,
    submissionKey,
    sourceRow: integer(row.source_row, 2, "PostgreSQL Google Form source row"),
    submittedAt,
    state: state as GoogleFormLeadReviewState,
    status: status as GoogleFormLeadReviewStatus,
    proposal,
    reasons,
    createdAt: parsePostgresTimestamp(row.created_at, "PostgreSQL Google Form review created_at"),
    updatedAt: parsePostgresTimestamp(row.updated_at, "PostgreSQL Google Form review updated_at"),
    reviewedBy,
    reviewedAt,
    acceptedLeadId: acceptedLeadId as string | null,
  });
}

function processedSubmissionFromRow(
  row: ProcessedSubmissionRow,
): GoogleFormLeadProcessedSubmission {
  const submissionKey = row.submission_key;
  const status = requiredText(row.status, 32, "PostgreSQL Google Form review status");
  if (
    !isGoogleFormLeadSubmissionKey(submissionKey)
    || !(GOOGLE_FORM_LEAD_REVIEW_STATUSES as readonly string[]).includes(status)
  ) throw new Error("PostgreSQL Google Form processed submission is invalid");
  return Object.freeze({
    submissionKey,
    sourceRow: integer(row.source_row, 2, "PostgreSQL Google Form source row"),
    status: status as GoogleFormLeadReviewStatus,
  });
}

function assertSaveBatch(input: SaveGoogleFormLeadBatchInput) {
  assertScope(input.connectionKey, input.spreadsheetId);
  assertActor(input.actor);
  if (
    input.reviews.length > 25
    || !Number.isSafeInteger(input.lastProcessedRow) || input.lastProcessedRow < 2
    || !isGoogleFormLeadSubmissionKey(input.lastProcessedSubmissionKey)
    || !Number.isSafeInteger(input.processedAt) || input.processedAt < 0
  ) throw new TypeError("PostgreSQL Google Form intake batch is invalid");
  for (const review of input.reviews) {
    if (
      !isPostgresUuid(review.id)
      || !isGoogleFormLeadSubmissionKey(review.submissionKey)
      || !Number.isSafeInteger(review.sourceRow) || review.sourceRow < 2
      || !(GOOGLE_FORM_LEAD_REVIEW_STATES as readonly string[]).includes(review.state)
      || !parseGoogleFormLeadProposal(review.proposal)
      || !parseGoogleFormLeadReasons(review.reasons)
    ) throw new GoogleFormLeadReviewDraftValidationError(review.sourceRow);
  }
  if (!isGoogleFormLeadPositionBatch(input.reviews, input.observedPositions)) {
    throw new TypeError("PostgreSQL Google Form intake positions are invalid");
  }
}

function assertDismiss(input: DismissGoogleFormLeadReviewInput) {
  if (!CONNECTION_KEY_PATTERN.test(input.connectionKey) || !isPostgresUuid(input.reviewId)) {
    throw new TypeError("PostgreSQL Google Form review identity is invalid");
  }
  assertActor(input.actor);
  if (!Number.isSafeInteger(input.reviewedAt) || input.reviewedAt < 0) {
    throw new TypeError("PostgreSQL Google Form review timestamp is invalid");
  }
}

const REVIEW_SELECT = `SELECT id::text AS id, connection_key, spreadsheet_id, submission_key,
       source_row, submitted_at, state, status, proposal_json, reasons_json,
       created_at, updated_at, reviewed_by, reviewed_at, accepted_lead_id
FROM google_form_lead_reviews`;

export function createPostgresGoogleFormLeadIntakeRepository(
  pool: PostgresPool,
  options: Options = {},
): GoogleFormLeadIntakeRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };
  return {
    async getWatermark(connectionKey, spreadsheetId) {
      assertScope(connectionKey, spreadsheetId);
      return withPostgresTransaction(pool, { ...transactionOptions, readOnly: true }, async (client) => {
        const result = await client.query<WatermarkRow>(
          `SELECT connection_key, spreadsheet_id, last_processed_row,
                  last_processed_submission_key,
                  last_processed_at, updated_by
           FROM google_form_lead_intake_watermarks
           WHERE connection_key = $1 AND spreadsheet_id = $2`,
          [connectionKey, spreadsheetId],
        );
        if (result.rowCount === 0) return null;
        if (result.rowCount !== 1 || !result.rows[0]) {
          throw new Error("PostgreSQL Google Form watermark lookup was ambiguous");
        }
        return watermarkFromRow(result.rows[0]);
      });
    },

    async findProcessedSubmissions(connectionKey, spreadsheetId, submissionKeys) {
      assertScope(connectionKey, spreadsheetId);
      if (
        submissionKeys.length > 25
        || new Set(submissionKeys).size !== submissionKeys.length
        || submissionKeys.some((key) => !isGoogleFormLeadSubmissionKey(key))
      ) throw new TypeError("PostgreSQL Google Form submission-key query is invalid");
      if (submissionKeys.length === 0) return Object.freeze([]);
      return withPostgresTransaction(pool, { ...transactionOptions, readOnly: true }, async (client) => {
        const result = await client.query<ProcessedSubmissionRow>(
          `SELECT submission_key, source_row, status
           FROM google_form_lead_reviews
           WHERE connection_key = $1 AND spreadsheet_id = $2
             AND submission_key = ANY($3::text[])`,
          [connectionKey, spreadsheetId, [...submissionKeys]],
        );
        return Object.freeze(result.rows.map(processedSubmissionFromRow));
      });
    },

    async listNeedsReview(connectionKey, limit) {
      if (
        !CONNECTION_KEY_PATTERN.test(connectionKey)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
      ) throw new TypeError("PostgreSQL Google Form review query is invalid");
      return withPostgresTransaction(pool, { ...transactionOptions, readOnly: true }, async (client) => {
        const result = await client.query<ReviewRow>(
          `${REVIEW_SELECT}
           WHERE connection_key = $1 AND status = 'needs-review'
           ORDER BY source_row ASC, id ASC
           LIMIT $2`,
          [connectionKey, limit],
        );
        return Object.freeze(result.rows.map(reviewFromRow));
      });
    },

    async saveBatch(input) {
      assertSaveBatch(input);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        let inserted = 0;
        let repositioned = 0;
        for (const position of input.observedPositions) {
          const observedAt = new Date(input.processedAt);
          const result = await client.query(
            `UPDATE google_form_lead_reviews
             SET source_row = $1, updated_at = $2
             WHERE connection_key = $3 AND spreadsheet_id = $4 AND submission_key = $5
               AND status = 'needs-review' AND source_row <> $1 AND updated_at <= $2`,
            [
              position.sourceRow,
              observedAt,
              input.connectionKey,
              input.spreadsheetId,
              position.submissionKey,
            ],
          );
          if (result.rowCount === 1) repositioned += 1;
          else if (result.rowCount !== 0) {
            throw new Error("PostgreSQL Google Form position refresh was ambiguous");
          }
        }
        for (const review of input.reviews) {
          const result = await client.query(
            `INSERT INTO google_form_lead_reviews (
               id, connection_key, spreadsheet_id, submission_key, source_row, submitted_at,
               state, status, proposal_json, reasons_json, created_at, updated_at,
               reviewed_by, reviewed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'needs-review', $8::jsonb,
                       $9::jsonb, $10, $10, NULL, NULL)
             ON CONFLICT (connection_key, spreadsheet_id, submission_key) DO NOTHING`,
            [
              review.id,
              input.connectionKey,
              input.spreadsheetId,
              review.submissionKey,
              review.sourceRow,
              review.submittedAt,
              review.state,
              JSON.stringify(review.proposal),
              JSON.stringify(review.reasons),
              new Date(input.processedAt),
            ],
          );
          if (result.rowCount === 1) inserted += 1;
          else if (result.rowCount !== 0) throw new Error("PostgreSQL Google Form review insert was invalid");
        }
        await client.query(
          `INSERT INTO google_form_lead_intake_watermarks (
             connection_key, spreadsheet_id, last_processed_row, last_processed_submission_key,
             last_processed_at, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (connection_key, spreadsheet_id) DO UPDATE SET
             last_processed_row = EXCLUDED.last_processed_row,
             last_processed_submission_key = EXCLUDED.last_processed_submission_key,
             last_processed_at = EXCLUDED.last_processed_at,
             updated_by = EXCLUDED.updated_by
           WHERE EXCLUDED.last_processed_at >= google_form_lead_intake_watermarks.last_processed_at`,
          [
            input.connectionKey,
            input.spreadsheetId,
            input.lastProcessedRow,
            input.lastProcessedSubmissionKey,
            new Date(input.processedAt),
            input.actor,
          ],
        );
        const watermarkResult = await client.query<WatermarkRow>(
          `SELECT connection_key, spreadsheet_id, last_processed_row,
                  last_processed_submission_key,
                  last_processed_at, updated_by
           FROM google_form_lead_intake_watermarks
           WHERE connection_key = $1 AND spreadsheet_id = $2`,
          [input.connectionKey, input.spreadsheetId],
        );
        if (watermarkResult.rowCount !== 1 || !watermarkResult.rows[0]) {
          throw new Error("PostgreSQL Google Form watermark was not saved");
        }
        return Object.freeze({
          inserted,
          repositioned,
          watermark: watermarkFromRow(watermarkResult.rows[0]),
        });
      });
    },

    async dismissReview(input) {
      assertDismiss(input);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `UPDATE google_form_lead_reviews
           SET status = 'dismissed', reviewed_by = $1, reviewed_at = $2,
               updated_at = $2, accepted_lead_id = NULL
           WHERE id = $3 AND connection_key = $4 AND status = 'needs-review'`,
          [input.actor, new Date(input.reviewedAt), input.reviewId, input.connectionKey],
        );
        if (result.rowCount === 0) return false;
        if (result.rowCount !== 1) throw new Error("PostgreSQL Google Form review retirement was ambiguous");
        return true;
      });
    },
  };
}
