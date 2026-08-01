import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../../../adapters/d1/d1-database";
import { createD1FirstRunImportRepository } from "../../../../../../adapters/d1/first-run-import-repository";
import { createD1GoogleFormLeadIntakeRepository } from "../../../../../../adapters/d1/google-form-lead-intake-repository";
import {
  assertGoogleFormLeadHeaders,
  googleFormLeadSubmissionKey,
  GOOGLE_FORM_LEAD_MAX_ROWS,
  GOOGLE_FORM_LEAD_REVIEW_LIMIT,
  GoogleFormLeadIntakeValidationError,
  mapGoogleFormLeadRows,
} from "../../../../../../domain/google-form-lead-intake";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../../../../lib/development-request-rate-limit";
import {
  googleFormLeadIntakeConfig,
  GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV,
} from "../../../../../../lib/google-form-lead-intake-config";
import {
  googleFormLeadSimulationHeaders,
  googleFormLeadSimulationRows,
} from "../../../../../../lib/google-form-lead-intake-simulation";
import { googleIntegrationErrorResponse } from "../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
} from "../../../../../../lib/google-oauth-sites";
import { GoogleSheetsClient } from "../../../../../../lib/google-sheets";
import { noStoreJson, noStoreResponse } from "../../../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import type { GoogleFormLeadReviewRecord } from "../../../../../../ports/google-form-lead-intake";
import type { GoogleFormLeadIntakeWatermark } from "../../../../../../ports/google-form-lead-intake";

const MAX_REVIEW_BODY_BYTES = 1_024;
const REVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
type RuntimeEnvironment = Record<string, string | undefined>;

function publicReview(review: GoogleFormLeadReviewRecord) {
  return Object.freeze({
    id: review.id,
    sourceRow: review.sourceRow,
    submittedAt: review.submittedAt,
    state: review.state,
    status: review.status,
    proposal: review.proposal,
    reasons: review.reasons,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  });
}

async function publicQueue(
  repository: ReturnType<typeof createD1GoogleFormLeadIntakeRepository>,
  connectionKey: string,
) {
  const rows = await repository.listNeedsReview(
    connectionKey,
    GOOGLE_FORM_LEAD_REVIEW_LIMIT,
  );
  return Object.freeze(rows.map(publicReview));
}

function intakeConfiguration(
  simulation: boolean,
) {
  return googleFormLeadIntakeConfig(
    env as unknown as RuntimeEnvironment,
    simulation,
  );
}

function configurationError(invalid: boolean) {
  return noStoreJson({
    error: invalid
      ? `${GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV} is invalid.`
      : `Set ${GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV} before checking responses.`,
    code: invalid ? "form_lead_sheet_invalid" : "form_lead_sheet_missing",
  }, 409);
}

async function readRows(input: Readonly<{
  simulation: boolean;
  spreadsheetId: string;
  watermark: GoogleFormLeadIntakeWatermark | null;
  config: Parameters<typeof getGoogleAccessToken>[0];
}>) {
  const firstSourceRow = (input.watermark?.lastProcessedRow ?? 1) + 1;
  const sheets = input.simulation
    ? null
    : new GoogleSheetsClient(
        await getGoogleAccessToken(input.config, "sheets"),
        input.spreadsheetId,
      );
  const readRange = async (sourceRow: number, limit: number) => {
    if (limit < 1) return Object.freeze([]);
    if (input.simulation) {
      return Object.freeze(googleFormLeadSimulationRows(sourceRow, limit)
        .slice(0, limit)
        .map((cells, index) => Object.freeze({
          sourceRow: sourceRow + index,
          cells: Object.freeze([...cells]),
          identityCells: Object.freeze([...cells]),
        })));
    }
    const rows = await sheets!.gridValues(
      `A${sourceRow}:F${sourceRow + limit - 1}`,
    );
    return Object.freeze(rows.slice(0, limit).map((row) => Object.freeze({
      sourceRow: row.sourceRow,
      cells: row.formattedValues,
      identityCells: row.effectiveValues,
    })));
  };
  const [headers, firstRows] = await Promise.all([
    input.simulation
      ? Promise.resolve(googleFormLeadSimulationHeaders())
      : sheets!.values("A1:F1").then(({ values }) => Object.freeze(values ?? [])),
    readRange(firstSourceRow, GOOGLE_FORM_LEAD_MAX_ROWS),
  ]);
  const remaining = GOOGLE_FORM_LEAD_MAX_ROWS - firstRows.length;
  const wrappedRows = firstSourceRow > 2 && remaining > 0
    ? await readRange(2, remaining)
    : Object.freeze([]);
  return Object.freeze({
    headers,
    rows: Object.freeze([...firstRows, ...wrappedRows]),
  });
}

function errorResponse(error: unknown) {
  if (error instanceof GoogleFormLeadIntakeValidationError) {
    return noStoreJson({
      error: error.message,
      code: error.code,
      ...("sourceRow" in error && Number.isSafeInteger(error.sourceRow)
        ? { sourceRow: error.sourceRow }
        : {}),
    }, error.status);
  }
  return noStoreResponse(googleIntegrationErrorResponse(
    error,
    "Google Form responses could not be checked. Try again.",
  ));
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  try {
    const setup = await getEffectiveGoogleRuntimeSetup();
    const intake = intakeConfiguration(setup.config.simulation);
    const repository = createD1GoogleFormLeadIntakeRepository(
      env.DB as unknown as D1Database,
    );
    const [queue, watermark] = await Promise.all([
      publicQueue(repository, setup.config.connectionKey),
      intake.spreadsheetId
        ? repository.getWatermark(setup.config.connectionKey, intake.spreadsheetId)
        : Promise.resolve(null),
    ]);
    return noStoreJson({
      configured: intake.configured,
      invalidConfiguration: intake.invalid,
      configurationName: GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV,
      simulation: setup.config.simulation,
      actorEmail: auth.user.email,
      rowLimit: GOOGLE_FORM_LEAD_MAX_ROWS,
      watermark: watermark
        ? {
            lastProcessedRow: watermark.lastProcessedRow,
            lastProcessedAt: watermark.lastProcessedAt,
          }
        : null,
      queue,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit(
    "google-form-lead-intake",
    auth.user.email,
  );
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);

  try {
    const setup = await getEffectiveGoogleRuntimeSetup();
    const intake = intakeConfiguration(setup.config.simulation);
    if (!intake.spreadsheetId) return configurationError(intake.invalid);
    const repository = createD1GoogleFormLeadIntakeRepository(
      env.DB as unknown as D1Database,
    );
    const watermark = await repository.getWatermark(
      setup.config.connectionKey,
      intake.spreadsheetId,
    );
    // Fence persisted positions by when this Sheet observation began. If an
    // older provider request completes last, its stale snapshot must not win.
    const processedAt = Date.now();
    const loaded = await readRows({
      simulation: setup.config.simulation,
      spreadsheetId: intake.spreadsheetId,
      watermark,
      config: setup.config,
    });
    assertGoogleFormLeadHeaders(loaded.headers);
    if (loaded.rows.length === 0) {
      return noStoreJson({
        processed: 0,
        inserted: 0,
        message: "No new form responses were found.",
        watermark: watermark
          ? {
              lastProcessedRow: watermark.lastProcessedRow,
              lastProcessedAt: watermark.lastProcessedAt,
            }
          : null,
        queue: await publicQueue(repository, setup.config.connectionKey),
      });
    }

    const keyedRows = await Promise.all(loaded.rows.map(async (row) => Object.freeze({
      ...row,
      submissionKey: await googleFormLeadSubmissionKey(row.identityCells),
    })));
    const uniqueRows = [...new Map(
      keyedRows.map((row) => [row.submissionKey, row] as const),
    ).values()];
    const processedSubmissions = await repository.findProcessedSubmissions(
      setup.config.connectionKey,
      intake.spreadsheetId,
      uniqueRows.map(({ submissionKey }) => submissionKey),
    );
    const processedByKey = new Map(
      processedSubmissions.map((submission) => [submission.submissionKey, submission] as const),
    );
    const unseenRows = uniqueRows.filter(
      ({ submissionKey }) => !processedByKey.has(submissionKey),
    );
    const observedPositions = uniqueRows.flatMap(({ submissionKey, sourceRow }) => {
      const processed = processedByKey.get(submissionKey);
      return processed?.status === "needs-review" && processed.sourceRow !== sourceRow
        ? [Object.freeze({ submissionKey, sourceRow })]
        : [];
    });
    const checkpoint = keyedRows.at(-1)!;
    const checkpointUnchanged = watermark?.lastProcessedRow === checkpoint.sourceRow
      && watermark.lastProcessedSubmissionKey === checkpoint.submissionKey;
    if (unseenRows.length === 0 && observedPositions.length === 0 && checkpointUnchanged) {
      return noStoreJson({
        processed: 0,
        inserted: 0,
        message: "No new form responses were found.",
        watermark: {
          lastProcessedRow: watermark.lastProcessedRow,
          lastProcessedAt: watermark.lastProcessedAt,
        },
        queue: await publicQueue(repository, setup.config.connectionKey),
      });
    }
    const snapshot = await createD1FirstRunImportRepository(
      env.DB as unknown as D1Database,
    ).snapshot();
    const drafts = await mapGoogleFormLeadRows({
      rows: unseenRows,
      clients: snapshot.clients,
    });
    const blockedRows = drafts
      .filter(({ state }) => state === "blocked-real-data")
      .map(({ sourceRow }) => sourceRow);
    if (blockedRows.length > 0) {
      return noStoreJson({
        error: "Real client responses are blocked until WS-11 and owner launch approval. No rows were stored and the watermark did not advance.",
        code: "form_lead_real_data_gate_closed",
        blockedRows,
      }, 409);
    }

    const saved = await repository.saveBatch({
      connectionKey: setup.config.connectionKey,
      spreadsheetId: intake.spreadsheetId,
      reviews: drafts.map((draft) => Object.freeze({
        ...draft,
        id: crypto.randomUUID(),
      })),
      observedPositions,
      lastProcessedRow: checkpoint.sourceRow,
      lastProcessedSubmissionKey: checkpoint.submissionKey,
      processedAt,
      actor: auth.user.email,
    });
    return noStoreJson({
      processed: drafts.length,
      inserted: saved.inserted,
      message: saved.inserted > 0
        ? `${saved.inserted} response${saved.inserted === 1 ? "" : "s"} added for review.`
        : "No new form responses were found.",
      watermark: {
        lastProcessedRow: saved.watermark.lastProcessedRow,
        lastProcessedAt: saved.watermark.lastProcessedAt,
      },
      queue: await publicQueue(repository, setup.config.connectionKey),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function reviewDisposition(body: Record<string, unknown>) {
  const keys = Object.keys(body);
  if (
    keys.length !== 2
    || keys.some((key) => key !== "id" && key !== "outcome")
    || typeof body.id !== "string" || !REVIEW_ID_PATTERN.test(body.id)
    || body.outcome !== "dismissed"
  ) return null;
  return Object.freeze({
    id: body.id,
    outcome: body.outcome,
  });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit(
    "google-form-lead-intake",
    auth.user.email,
  );
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_REVIEW_BODY_BYTES,
    invalidMessage: "Review disposition must be valid JSON.",
    tooLargeMessage: "Review disposition is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  const disposition = reviewDisposition(parsed.body);
  if (!disposition) {
    return noStoreJson({ error: "Review disposition is invalid." }, 400);
  }

  try {
    const setup = await getEffectiveGoogleRuntimeSetup();
    const retired = await createD1GoogleFormLeadIntakeRepository(
      env.DB as unknown as D1Database,
    ).dismissReview({
      connectionKey: setup.config.connectionKey,
      reviewId: disposition.id,
      actor: auth.user.email,
      reviewedAt: Date.now(),
    });
    if (!retired) {
      return noStoreJson({
        error: "This response was already reviewed or is no longer available.",
        code: "form_lead_review_not_retired",
      }, 409);
    }
    return noStoreJson({ outcome: disposition.outcome });
  } catch (error) {
    return errorResponse(error);
  }
}
