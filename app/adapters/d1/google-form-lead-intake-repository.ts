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
  DismissGoogleFormLeadReviewInput,
  SaveGoogleFormLeadBatchInput,
} from "../../ports/google-form-lead-intake";
import type { D1Database } from "./d1-database";

type WatermarkRow = Readonly<{
  connection_key: unknown;
  spreadsheet_id: unknown;
  last_processed_row: unknown;
  last_processed_at: unknown;
  updated_by: unknown;
}>;

type ReviewRow = Readonly<{
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
}>;

const CONNECTION_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string"
    && Boolean(value.trim())
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null;
}

function safeInteger(value: unknown, minimum = 0) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function assertScope(connectionKey: string, spreadsheetId: string) {
  if (!CONNECTION_KEY_PATTERN.test(connectionKey)) {
    throw new TypeError("Google Form intake connection key is invalid");
  }
  if (!PROVIDER_ID_PATTERN.test(spreadsheetId)) {
    throw new TypeError("Google Form response Sheet ID is invalid");
  }
}

function assertActor(value: string) {
  if (!boundedText(value, 320)) throw new TypeError("Google Form intake actor is invalid");
}

function watermarkFromRow(row: WatermarkRow): GoogleFormLeadIntakeWatermark {
  const connectionKey = boundedText(row.connection_key, 128);
  const spreadsheetId = boundedText(row.spreadsheet_id, 256);
  const lastProcessedRow = safeInteger(row.last_processed_row, 2);
  const lastProcessedAt = safeInteger(row.last_processed_at);
  const updatedBy = boundedText(row.updated_by, 320);
  if (
    !connectionKey || !CONNECTION_KEY_PATTERN.test(connectionKey)
    || !spreadsheetId || !PROVIDER_ID_PATTERN.test(spreadsheetId)
    || lastProcessedRow === null || lastProcessedAt === null || !updatedBy
  ) throw new Error("D1 Google Form intake watermark is invalid");
  return Object.freeze({
    connectionKey,
    spreadsheetId,
    lastProcessedRow,
    lastProcessedAt,
    updatedBy,
  });
}

function reviewFromRow(row: ReviewRow): GoogleFormLeadReviewRecord {
  const id = boundedText(row.id, 256);
  const connectionKey = boundedText(row.connection_key, 128);
  const spreadsheetId = boundedText(row.spreadsheet_id, 256);
  const sourceRow = safeInteger(row.source_row, 2);
  const submittedAt = row.submitted_at === null ? null : boundedText(row.submitted_at, 100);
  const state = boundedText(row.state, 32);
  const status = boundedText(row.status, 32);
  const proposal = parseGoogleFormLeadProposal(parseJson(row.proposal_json));
  const reasons = parseGoogleFormLeadReasons(parseJson(row.reasons_json));
  const createdAt = safeInteger(row.created_at);
  const updatedAt = safeInteger(row.updated_at);
  const reviewedBy = row.reviewed_by === null ? null : boundedText(row.reviewed_by, 320);
  const reviewedAt = row.reviewed_at === null ? null : safeInteger(row.reviewed_at);
  const acceptedLeadId = row.accepted_lead_id === null
    ? null
    : boundedText(row.accepted_lead_id, 256);
  if (
    !id || !connectionKey || !CONNECTION_KEY_PATTERN.test(connectionKey)
    || !spreadsheetId || !PROVIDER_ID_PATTERN.test(spreadsheetId)
    || sourceRow === null || (row.submitted_at !== null && !submittedAt)
    || !state || !(GOOGLE_FORM_LEAD_REVIEW_STATES as readonly string[]).includes(state)
    || !status || !(GOOGLE_FORM_LEAD_REVIEW_STATUSES as readonly string[]).includes(status)
    || !proposal || !reasons || createdAt === null || updatedAt === null
    || updatedAt < createdAt
    || (status === "needs-review"
      && (reviewedBy !== null || reviewedAt !== null || acceptedLeadId !== null))
    || (status === "accepted" && (!reviewedBy || reviewedAt === null || !acceptedLeadId))
    || (status === "dismissed" && (!reviewedBy || reviewedAt === null || acceptedLeadId !== null))
  ) throw new Error("D1 Google Form lead review row is invalid");
  return Object.freeze({
    id,
    connectionKey,
    spreadsheetId,
    sourceRow,
    submittedAt,
    state: state as GoogleFormLeadReviewState,
    status: status as GoogleFormLeadReviewStatus,
    proposal,
    reasons,
    createdAt,
    updatedAt,
    reviewedBy,
    reviewedAt,
    acceptedLeadId,
  });
}

function assertSaveBatch(input: SaveGoogleFormLeadBatchInput) {
  assertScope(input.connectionKey, input.spreadsheetId);
  assertActor(input.actor);
  if (
    input.reviews.length < 1
    || input.reviews.length > 25
    || !Number.isSafeInteger(input.lastProcessedRow)
    || input.lastProcessedRow < 2
    || !Number.isSafeInteger(input.processedAt)
    || input.processedAt < 0
  ) throw new TypeError("Google Form intake batch is invalid");
  for (const review of input.reviews) {
    if (
      !OPAQUE_ID_PATTERN.test(review.id)
      || !Number.isSafeInteger(review.sourceRow)
      || review.sourceRow < 2
      || review.sourceRow > input.lastProcessedRow
      || !(GOOGLE_FORM_LEAD_REVIEW_STATES as readonly string[]).includes(review.state)
      || !parseGoogleFormLeadProposal(review.proposal)
      || !parseGoogleFormLeadReasons(review.reasons)
    ) throw new TypeError("Google Form lead review draft is invalid");
  }
}

function assertDismiss(input: DismissGoogleFormLeadReviewInput) {
  if (!CONNECTION_KEY_PATTERN.test(input.connectionKey) || !OPAQUE_ID_PATTERN.test(input.reviewId)) {
    throw new TypeError("Google Form review identity is invalid");
  }
  assertActor(input.actor);
  if (!Number.isSafeInteger(input.reviewedAt) || input.reviewedAt < 0) {
    throw new TypeError("Google Form review timestamp is invalid");
  }
}

const REVIEW_SELECT = `SELECT id, connection_key, spreadsheet_id, source_row,
       submitted_at, state, status, proposal_json, reasons_json,
       created_at, updated_at, reviewed_by, reviewed_at, accepted_lead_id
FROM google_form_lead_reviews`;

export function createD1GoogleFormLeadIntakeRepository(
  database: D1Database,
): GoogleFormLeadIntakeRepository {
  const readWatermark = async (connectionKey: string, spreadsheetId: string) => {
    assertScope(connectionKey, spreadsheetId);
    const row = await database.prepare(
      `SELECT connection_key, spreadsheet_id, last_processed_row,
              last_processed_at, updated_by
       FROM google_form_lead_intake_watermarks
       WHERE connection_key = ? AND spreadsheet_id = ?`,
    ).bind(connectionKey, spreadsheetId).first<WatermarkRow>();
    return row ? watermarkFromRow(row) : null;
  };
  return {
    getWatermark: readWatermark,

    async listNeedsReview(connectionKey, limit) {
      if (
        !CONNECTION_KEY_PATTERN.test(connectionKey)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
      ) throw new TypeError("Google Form review query is invalid");
      const result = await database.prepare(
        `${REVIEW_SELECT}
         WHERE connection_key = ? AND status = 'needs-review'
         ORDER BY source_row ASC, id ASC
         LIMIT ?`,
      ).bind(connectionKey, limit).all<ReviewRow>();
      return Object.freeze(result.results.map(reviewFromRow));
    },

    async saveBatch(input) {
      assertSaveBatch(input);
      const statements = input.reviews.map((review) => database.prepare(
        `INSERT INTO google_form_lead_reviews (
           id, connection_key, spreadsheet_id, source_row, submitted_at,
           state, status, proposal_json, reasons_json, created_at, updated_at,
           reviewed_by, reviewed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'needs-review', ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(connection_key, spreadsheet_id, source_row) DO NOTHING`,
      ).bind(
        review.id,
        input.connectionKey,
        input.spreadsheetId,
        review.sourceRow,
        review.submittedAt,
        review.state,
        JSON.stringify(review.proposal),
        JSON.stringify(review.reasons),
        input.processedAt,
        input.processedAt,
      ));
      statements.push(database.prepare(
        `INSERT INTO google_form_lead_intake_watermarks (
           connection_key, spreadsheet_id, last_processed_row,
           last_processed_at, updated_by
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(connection_key, spreadsheet_id) DO UPDATE SET
           last_processed_row = excluded.last_processed_row,
           last_processed_at = excluded.last_processed_at,
           updated_by = excluded.updated_by
         WHERE excluded.last_processed_row > google_form_lead_intake_watermarks.last_processed_row`,
      ).bind(
        input.connectionKey,
        input.spreadsheetId,
        input.lastProcessedRow,
        input.processedAt,
        input.actor,
      ));
      const results = await database.batch(statements);
      const inserted = results.slice(0, input.reviews.length)
        .reduce((total, result) => total + (result.meta.changes === 1 ? 1 : 0), 0);
      const watermark = await readWatermark(input.connectionKey, input.spreadsheetId);
      if (!watermark) throw new Error("D1 Google Form intake watermark was not saved");
      return Object.freeze({ inserted, watermark });
    },

    async dismissReview(input) {
      assertDismiss(input);
      const result = await database.prepare(
        `UPDATE google_form_lead_reviews
         SET status = 'dismissed', reviewed_by = ?, reviewed_at = ?, updated_at = ?,
             accepted_lead_id = NULL
         WHERE id = ? AND connection_key = ? AND status = 'needs-review'`,
      ).bind(
        input.actor,
        input.reviewedAt,
        input.reviewedAt,
        input.reviewId,
        input.connectionKey,
      ).run();
      return result.meta.changes === 1;
    },
  };
}
