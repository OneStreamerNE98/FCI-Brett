import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../../../adapters/d1/d1-database";
import { createD1FirstRunImportRepository } from "../../../../../../adapters/d1/first-run-import-repository";
import { createD1GoogleFormLeadIntakeRepository } from "../../../../../../adapters/d1/google-form-lead-intake-repository";
import {
  assertGoogleFormLeadHeaders,
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
  firstSourceRow: number;
  config: Parameters<typeof getGoogleAccessToken>[0];
}>) {
  if (input.simulation) {
    return Object.freeze({
      headers: googleFormLeadSimulationHeaders(),
      rows: googleFormLeadSimulationRows(
        input.firstSourceRow,
        GOOGLE_FORM_LEAD_MAX_ROWS,
      ),
    });
  }
  const token = await getGoogleAccessToken(input.config, "sheets");
  const sheets = new GoogleSheetsClient(token, input.spreadsheetId);
  const lastSourceRow = input.firstSourceRow + GOOGLE_FORM_LEAD_MAX_ROWS - 1;
  const [headers, rows] = await Promise.all([
    sheets.values("A1:F1"),
    sheets.values(`A${input.firstSourceRow}:F${lastSourceRow}`),
  ]);
  return Object.freeze({
    headers: Object.freeze(headers.values ?? []),
    rows: Object.freeze((rows.values ?? []).slice(0, GOOGLE_FORM_LEAD_MAX_ROWS)),
  });
}

function errorResponse(error: unknown) {
  if (error instanceof GoogleFormLeadIntakeValidationError) {
    return noStoreJson({ error: error.message, code: error.code }, error.status);
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
    const firstSourceRow = (watermark?.lastProcessedRow ?? 1) + 1;
    const loaded = await readRows({
      simulation: setup.config.simulation,
      spreadsheetId: intake.spreadsheetId,
      firstSourceRow,
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

    const snapshot = await createD1FirstRunImportRepository(
      env.DB as unknown as D1Database,
    ).snapshot();
    const drafts = await mapGoogleFormLeadRows({
      rows: loaded.rows,
      firstSourceRow,
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

    const processedAt = Date.now();
    const saved = await repository.saveBatch({
      connectionKey: setup.config.connectionKey,
      spreadsheetId: intake.spreadsheetId,
      reviews: drafts.map((draft) => Object.freeze({
        ...draft,
        id: crypto.randomUUID(),
      })),
      lastProcessedRow: firstSourceRow + loaded.rows.length - 1,
      processedAt,
      actor: auth.user.email,
    });
    return noStoreJson({
      processed: loaded.rows.length,
      inserted: saved.inserted,
      message: saved.inserted > 0
        ? `${saved.inserted} response${saved.inserted === 1 ? "" : "s"} added for review.`
        : "These response rows were already queued; nothing was duplicated.",
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
    keys.some((key) => key !== "id" && key !== "outcome" && key !== "leadId")
    || typeof body.id !== "string" || !REVIEW_ID_PATTERN.test(body.id)
    || (body.outcome !== "accepted" && body.outcome !== "dismissed")
  ) return null;
  if (body.outcome === "accepted") {
    if (
      keys.length !== 3
      || typeof body.leadId !== "string"
      || !REVIEW_ID_PATTERN.test(body.leadId)
    ) return null;
    return Object.freeze({
      id: body.id,
      outcome: body.outcome,
      acceptedLeadId: body.leadId,
    });
  }
  if (keys.length !== 2 || Object.hasOwn(body, "leadId")) return null;
  return Object.freeze({
    id: body.id,
    outcome: body.outcome,
    acceptedLeadId: null,
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
    ).retireReview({
      connectionKey: setup.config.connectionKey,
      reviewId: disposition.id,
      outcome: disposition.outcome,
      acceptedLeadId: disposition.acceptedLeadId,
      actor: auth.user.email,
      reviewedAt: Date.now(),
    });
    if (!retired) {
      return noStoreJson({
        error: disposition.outcome === "accepted"
          ? "The lead exists, but this review could not be retired. It remains visible so the result can be reconciled safely."
          : "This response was already reviewed or is no longer available.",
        code: "form_lead_review_not_retired",
      }, 409);
    }
    return noStoreJson({ outcome: disposition.outcome });
  } catch (error) {
    return errorResponse(error);
  }
}
