import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import { insertAddressValidationReview } from "../../../adapters/d1/address-validation-reviews";
import type { D1Database } from "../../../adapters/d1/d1-database";
import {
  normalizeAddressEntityKind,
  normalizeAddressSessionToken,
  normalizeAddressTargetId,
  normalizeAddressText,
} from "../../../domain/address-validation";
import { validateAddress } from "../../../features/address-validation/address-validation";
import { getSitesAddressValidationRuntime } from "../../../lib/address-validation-sites";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../lib/development-request-rate-limit";
import { noStoreJson } from "../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

const MAX_ADDRESS_VALIDATION_BODY_BYTES = 2_048;
const ADDRESS_VALIDATION_KEYS = new Set([
  "address",
  "entityKind",
  "targetId",
  "sessionToken",
]);

function abortedReviewResponse() {
  return noStoreJson({ error: "Address review was canceled." }, 499);
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const rateLimit = enforceDevelopmentRequestRateLimit(
    "address-validation",
    auth.user.email,
  );
  if (rateLimit) return rateLimit;

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_ADDRESS_VALIDATION_BODY_BYTES,
    invalidMessage: "Address review must be valid JSON.",
    tooLargeMessage: "Address review is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  if (Object.keys(parsed.body).some((key) => !ADDRESS_VALIDATION_KEYS.has(key))) {
    return noStoreJson({ error: "Only supported address review fields are allowed." }, 400);
  }

  const address = normalizeAddressText(parsed.body.address, true);
  const entityKind = normalizeAddressEntityKind(parsed.body.entityKind);
  const targetId = normalizeAddressTargetId(parsed.body.targetId);
  const sessionToken = normalizeAddressSessionToken(parsed.body.sessionToken);
  if (!address || !entityKind || !targetId || !sessionToken) {
    return noStoreJson(
      {
        error:
          "Address, entity kind, target, and a valid autocomplete session token are required.",
      },
      400,
    );
  }
  if (request.signal.aborted) return abortedReviewResponse();

  await ensureWorkspaceSchema();
  if (request.signal.aborted) return abortedReviewResponse();
  const runtime = getSitesAddressValidationRuntime();
  const providerSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(8_000),
  ]);
  const result = await validateAddress(
    { address, sessionToken },
    runtime,
    {
      fetch: globalThis.fetch,
      signal: providerSignal,
    },
  );
  if (request.signal.aborted) return abortedReviewResponse();
  const review = await insertAddressValidationReview(
    env.DB as unknown as D1Database,
    {
      id: crypto.randomUUID(),
      actorId: auth.user.email,
      entityKind,
      targetId,
      result,
      now: Date.now(),
    },
  );

  return noStoreJson({
    review,
    availability: runtime.simulation
      ? "simulation"
      : runtime.liveEnabled && runtime.serverApiKey
        ? "live"
        : "unavailable",
  });
}
