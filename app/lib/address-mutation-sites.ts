import {
  ADDRESS_REVIEW_CONSUMED_RETENTION_MS,
  consumeAddressValidationReview,
  releaseAddressValidationReview,
  type AddressReviewConsumptionClaim,
} from "../adapters/d1/address-validation-reviews";
import type { D1Database } from "../adapters/d1/d1-database";
import {
  normalizeAddressReviewReference,
  normalizeAddressText,
  typedAddress,
  type AddressEntityKind,
  type PersistedAddress,
} from "../domain/address-validation";

export type AddressMutationSuccess = {
  ok: true;
  value: PersistedAddress;
  reviewClaim?: AddressReviewConsumptionClaim;
};

export type AddressMutationResolution =
  | AddressMutationSuccess
  | { ok: false; message: string };

const ADDRESS_REVIEW_RELEASE_ATTEMPTS = 3;
const MAX_RECONCILIATION_CLAIMS = 51;

type StaleAddressReviewClaimRow = Readonly<{
  id: string;
  actor_id: string;
  entity_kind: string;
  target_id: string;
  input_address: string;
  consumed_at: number;
  expires_at: number;
}>;

export type StaleAddressReviewClaim = Readonly<{
  id: string;
  actorId: string;
  entityKind: string;
  targetId: string;
  inputAddress: string;
  consumedAt: number;
  expiresAt: number;
}>;

export async function resolveAddressMutation(
  database: D1Database,
  input: Readonly<{
    actorId: string;
    entityKind: AddressEntityKind;
    targetId: string;
    rawAddress: unknown;
    rawReview: unknown;
    required?: boolean;
    now?: number;
  }>,
): Promise<AddressMutationResolution> {
  const address = normalizeAddressText(input.rawAddress, input.required === true);
  if (address === undefined) {
    return {
      ok: false,
      message: `Address must be ${input.required ? "present and " : ""}280 characters or fewer.`,
    };
  }
  if (input.rawReview === undefined) return { ok: true, value: typedAddress(address) };
  if (address === null) {
    return { ok: false, message: "An empty address cannot include an address review." };
  }
  const review = normalizeAddressReviewReference(input.rawReview);
  if (!review) {
    return { ok: false, message: "Address review reference is invalid." };
  }
  const consumed = await consumeAddressValidationReview(database, {
    actorId: input.actorId,
    entityKind: input.entityKind,
    targetId: input.targetId,
    inputAddress: address,
    review,
    now: input.now ?? Date.now(),
  });
  return consumed.ok
    ? { ok: true, value: consumed.value, reviewClaim: consumed.claim }
    : consumed;
}

/** Release only after a known result proves that no record mutation committed. */
export async function releaseFailedAddressMutation(
  database: D1Database,
  resolution: AddressMutationSuccess,
): Promise<void> {
  if (!resolution.reviewClaim) return;

  let releaseError: unknown;
  for (let attempt = 0; attempt < ADDRESS_REVIEW_RELEASE_ATTEMPTS; attempt += 1) {
    try {
      await releaseAddressValidationReview(database, resolution.reviewClaim);
      return;
    } catch (caught) {
      releaseError = caught;
    }
  }
  throw releaseError;
}

/**
 * Finds consumed receipts that outlived the normal one-hour retention window.
 * A successful receipt is cleanup-eligible by then, so any survivor is stale
 * and needs operator-visible reconciliation even though its original mutation
 * outcome can no longer be inferred safely.
 */
export async function listStaleAddressReviewClaims(
  database: D1Database,
  input: Readonly<{ now: number; limit?: number }>,
): Promise<readonly StaleAddressReviewClaim[]> {
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? MAX_RECONCILIATION_CLAIMS), 1),
    MAX_RECONCILIATION_CLAIMS,
  );
  const staleBefore = input.now - ADDRESS_REVIEW_CONSUMED_RETENTION_MS;
  const result = await database.prepare(
    `SELECT id, actor_id, entity_kind, target_id, input_address, consumed_at, expires_at
     FROM address_validation_reviews
     WHERE consumed_at IS NOT NULL AND consumed_at <= ?
     ORDER BY consumed_at DESC, id DESC
     LIMIT ?`,
  ).bind(staleBefore, limit).all<StaleAddressReviewClaimRow>();
  return result.results.map((row) => Object.freeze({
    id: row.id,
    actorId: row.actor_id,
    entityKind: row.entity_kind,
    targetId: row.target_id,
    inputAddress: row.input_address,
    consumedAt: row.consumed_at,
    expiresAt: row.expires_at,
  }));
}
