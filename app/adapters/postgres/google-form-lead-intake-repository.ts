import {
  GOOGLE_FORM_LEAD_REVIEW_STATES,
  GOOGLE_FORM_LEAD_REVIEW_STATUSES,
  parseGoogleFormLeadProposal,
  parseGoogleFormLeadReasons,
} from "../../domain/google-form-lead-intake";
import type {
  GoogleFormLeadIntakeRepository,
  GoogleFormLeadIntakeWatermark,
  GoogleFormLeadReviewRecord,
  GoogleFormLeadReviewState,
  GoogleFormLeadReviewStatus,
  RetireGoogleFormLeadReviewInput,
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
  last_processed_at: unknown;
  updated_by: unknown;
};

type ReviewRow = Record<string, unknown> & {
  id: unknown;
  connection_key: unknown;
  spreadsheet_id: unknown;
  source_row: unknown;
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
  assertScope(connectionKey, spreadsheetId);
  return Object.freeze({
    connectionKey,
    spreadsheetId,
    lastProcessedRow: integer(row.last_processed_row, 2, "PostgreSQL Google Form watermark row"),
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
  if (
    !(GOOGLE_FORM_LEAD_REVIEW_STATES as readonly string[]).includes(state)
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

function assertSaveBatch(input: SaveGoogleFormLeadBatchInput) {
  assertScope(input.connectionKey, input.spreadsheetId);
  assertActor(input.actor);
  if (
    input.reviews.length < 1 || input.reviews.length > 25
    || !Number.isSafeInteger(input.lastProcessedRow) || input.lastProcessedRow < 2
    || !Number.isSafeInteger(input.processedAt) || input.processedAt < 0
  ) throw new TypeError("PostgreSQL Google Form intake batch is invalid");
  for (const review of input.reviews) {
    if (
      !isPostgresUuid(review.id)
      || !Number.isSafeInteger(review.sourceRow) || review.sourceRow < 2
      || review.sourceRow > input.lastProcessedRow
      || !(GOOGLE_FORM_LEAD_REVIEW_STATES as readonly string[]).includes(review.state)
      || !parseGoogleFormLeadProposal(review.proposal)
      || !parseGoogleFormLeadReasons(review.reasons)
    ) throw new TypeError("PostgreSQL Google Form lead review draft is invalid");
  }
}

function assertRetire(input: RetireGoogleFormLeadReviewInput) {
  if (!CONNECTION_KEY_PATTERN.test(input.connectionKey) || !isPostgresUuid(input.reviewId)) {
    throw new TypeError("PostgreSQL Google Form review identity is invalid");
  }
  assertActor(input.actor);
  if (!Number.isSafeInteger(input.reviewedAt) || input.reviewedAt < 0) {
    throw new TypeError("PostgreSQL Google Form review timestamp is invalid");
  }
  if (
    (input.outcome === "accepted" && !input.acceptedLeadId)
    || (input.outcome === "dismissed" && input.acceptedLeadId !== null)
    || (input.acceptedLeadId !== null && !isPostgresUuid(input.acceptedLeadId))
  ) throw new TypeError("PostgreSQL Google Form review lead disposition is invalid");
}

const REVIEW_SELECT = `SELECT id::text AS id, connection_key, spreadsheet_id,
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
        for (const review of input.reviews) {
          const result = await client.query(
            `INSERT INTO google_form_lead_reviews (
               id, connection_key, spreadsheet_id, source_row, submitted_at,
               state, status, proposal_json, reasons_json, created_at, updated_at,
               reviewed_by, reviewed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'needs-review', $7::jsonb,
                       $8::jsonb, $9, $9, NULL, NULL)
             ON CONFLICT (connection_key, spreadsheet_id, source_row) DO NOTHING`,
            [
              review.id,
              input.connectionKey,
              input.spreadsheetId,
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
             connection_key, spreadsheet_id, last_processed_row,
             last_processed_at, updated_by
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (connection_key, spreadsheet_id) DO UPDATE SET
             last_processed_row = EXCLUDED.last_processed_row,
             last_processed_at = EXCLUDED.last_processed_at,
             updated_by = EXCLUDED.updated_by
           WHERE EXCLUDED.last_processed_row > google_form_lead_intake_watermarks.last_processed_row`,
          [
            input.connectionKey,
            input.spreadsheetId,
            input.lastProcessedRow,
            new Date(input.processedAt),
            input.actor,
          ],
        );
        const watermarkResult = await client.query<WatermarkRow>(
          `SELECT connection_key, spreadsheet_id, last_processed_row,
                  last_processed_at, updated_by
           FROM google_form_lead_intake_watermarks
           WHERE connection_key = $1 AND spreadsheet_id = $2`,
          [input.connectionKey, input.spreadsheetId],
        );
        if (watermarkResult.rowCount !== 1 || !watermarkResult.rows[0]) {
          throw new Error("PostgreSQL Google Form watermark was not saved");
        }
        return Object.freeze({ inserted, watermark: watermarkFromRow(watermarkResult.rows[0]) });
      });
    },

    async retireReview(input) {
      assertRetire(input);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = input.outcome === "accepted"
          ? await client.query(
            `UPDATE google_form_lead_reviews AS review
             SET status = 'accepted', reviewed_by = $1, reviewed_at = $2,
                 updated_at = $2, accepted_lead_id = $3
             WHERE review.id = $4 AND review.connection_key = $5
               AND review.status = 'needs-review'
               AND EXISTS (
                 SELECT 1 FROM leads
                 WHERE leads.id = $3 AND leads.created_by = $1
               )`,
            [
              input.actor,
              new Date(input.reviewedAt),
              input.acceptedLeadId,
              input.reviewId,
              input.connectionKey,
            ],
          )
          : await client.query(
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
