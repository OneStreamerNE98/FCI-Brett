import {
  ADDRESS_REVIEW_TTL_MS,
  coordinatesAreValid,
  typedAddress,
  type AddressEntityKind,
  type AddressReviewReference,
  type AddressReviewVerdict,
  type PersistedAddress,
} from "../../domain/address-validation";
import type { AddressValidationResult } from "../../features/address-validation/address-validation";
import type { D1Database } from "./d1-database";

const MAX_ACTIVE_REVIEWS_PER_ACTOR = 25;
export const ADDRESS_REVIEW_CONSUMED_RETENTION_MS = 60 * 60 * 1_000;

type AddressValidationReviewRow = {
  id: string;
  actor_id: string;
  entity_kind: string;
  target_id: string;
  input_address: string;
  standardized_address: string | null;
  latitude: number | null;
  longitude: number | null;
  verdict: string;
  failure_code: string | null;
  simulated: number | boolean;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
};

export type SavedAddressReview = Readonly<{
  id: string;
  inputAddress: string;
  standardizedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  verdict: AddressReviewVerdict;
  failureCode: string | null;
  simulated: boolean;
  expiresAt: number;
}>;

export type ConsumeAddressReviewResult =
  | { ok: true; value: PersistedAddress; claim: AddressReviewConsumptionClaim }
  | { ok: false; message: string };

export type AddressReviewConsumptionClaim = Readonly<{
  id: string;
  actorId: string;
  entityKind: AddressEntityKind;
  targetId: string;
  inputAddress: string;
  consumedAt: number;
}>;

function savedReview(
  id: string,
  result: AddressValidationResult,
  expiresAt: number,
): SavedAddressReview {
  return Object.freeze({
    id,
    inputAddress: result.inputAddress,
    standardizedAddress: result.standardizedAddress,
    latitude: result.latitude,
    longitude: result.longitude,
    verdict: result.verdict,
    failureCode: result.failureCode,
    simulated: result.simulated,
    expiresAt,
  });
}

export async function insertAddressValidationReview(
  database: D1Database,
  input: Readonly<{
    id: string;
    actorId: string;
    entityKind: AddressEntityKind;
    targetId: string;
    result: AddressValidationResult;
    now: number;
  }>,
): Promise<SavedAddressReview> {
  const expiresAt = input.now + ADDRESS_REVIEW_TTL_MS;
  const cleanupBefore = input.now - ADDRESS_REVIEW_CONSUMED_RETENTION_MS;
  const statements = [
    // Neither cleanup may ever delete a provisionally claimed receipt
    // (consumed_at set, mutation still in flight): deleting one turns the
    // claimant's failure-path release into a lost receipt. Expired unclaimed
    // rows and old consumed rows keep their own legs.
    database.prepare(
      `DELETE FROM address_validation_reviews
       WHERE (expires_at <= ? AND consumed_at IS NULL)
          OR (consumed_at IS NOT NULL AND consumed_at <= ?)`,
    ).bind(input.now, cleanupBefore),
    database.prepare(
      `DELETE FROM address_validation_reviews
       WHERE actor_id = ? AND id IN (
         SELECT id FROM address_validation_reviews
         WHERE actor_id = ? AND consumed_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT -1 OFFSET ?
       )`,
    ).bind(input.actorId, input.actorId, MAX_ACTIVE_REVIEWS_PER_ACTOR - 1),
    database.prepare(
      `INSERT INTO address_validation_reviews (
         id, actor_id, entity_kind, target_id, input_address,
         standardized_address, latitude, longitude, verdict, failure_code,
         simulated, created_at, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      input.id,
      input.actorId,
      input.entityKind,
      input.targetId,
      input.result.inputAddress,
      input.result.standardizedAddress,
      input.result.latitude,
      input.result.longitude,
      input.result.verdict,
      input.result.failureCode,
      input.result.simulated ? 1 : 0,
      input.now,
      expiresAt,
    ),
  ];
  const results = await database.batch(statements);
  if (results[2]?.meta.changes !== 1) {
    throw new Error("Address validation review was not inserted exactly once.");
  }
  return savedReview(input.id, input.result, expiresAt);
}

function standardizedResolution(
  row: AddressValidationReviewRow,
  claim: AddressReviewConsumptionClaim,
): ConsumeAddressReviewResult {
  if (
    !row.standardized_address
    || !coordinatesAreValid(row.latitude, row.longitude)
  ) {
    return {
      ok: false,
      message: "This review has no usable standardized address. Keep the typed address or edit it.",
    };
  }
  if (row.verdict === "needs-correction" || row.verdict === "unvalidated") {
    return {
      ok: false,
      message: "Edit the address or explicitly keep the typed address before saving.",
    };
  }
  const verdict = row.verdict === "needs-confirmation"
    ? "review-confirmed"
    : row.verdict;
  if (verdict !== "validated" && verdict !== "review-confirmed" && verdict !== "simulated") {
    return { ok: false, message: "Address review verdict is unsupported." };
  }
  return {
    ok: true,
    value: Object.freeze({
      address: row.standardized_address,
      latitude: row.latitude,
      longitude: row.longitude,
      verdict,
    }),
    claim,
  };
}

/**
 * Atomically claims a review by actor, entity, target, and exact normalized
 * input. The consumed-at predicate makes a second mutation fail closed.
 */
export async function consumeAddressValidationReview(
  database: D1Database,
  input: Readonly<{
    actorId: string;
    entityKind: AddressEntityKind;
    targetId: string;
    inputAddress: string;
    review: AddressReviewReference;
    now: number;
  }>,
): Promise<ConsumeAddressReviewResult> {
  const claimed = await database.prepare(
    `UPDATE address_validation_reviews SET consumed_at = ?
     WHERE id = ? AND actor_id = ? AND entity_kind = ? AND target_id = ?
       AND input_address = ? AND consumed_at IS NULL AND expires_at > ?`,
  ).bind(
    input.now,
    input.review.id,
    input.actorId,
    input.entityKind,
    input.targetId,
    input.inputAddress,
    input.now,
  ).run();
  if (claimed.meta.changes !== 1) {
    return {
      ok: false,
      message: "Address review expired, changed, or was already used. Review the address again.",
    };
  }

  const row = await database.prepare(
    `SELECT id, actor_id, entity_kind, target_id, input_address,
            standardized_address, latitude, longitude, verdict, failure_code,
            simulated, created_at, expires_at, consumed_at
     FROM address_validation_reviews
     WHERE id = ? AND actor_id = ? AND consumed_at = ?`,
  ).bind(input.review.id, input.actorId, input.now).first<AddressValidationReviewRow>();
  if (!row) {
    throw new Error("Claimed address validation review could not be reloaded.");
  }
  const claim = Object.freeze({
    id: input.review.id,
    actorId: input.actorId,
    entityKind: input.entityKind,
    targetId: input.targetId,
    inputAddress: input.inputAddress,
    consumedAt: input.now,
  });
  if (input.review.choice === "typed") {
    return { ok: true, value: typedAddress(row.input_address), claim };
  }
  const resolution = standardizedResolution(row, claim);
  if (!resolution.ok) await releaseAddressValidationReview(database, claim);
  return resolution;
}

/**
 * Releases a provisional claim only after the caller proves that its record
 * mutation did not commit. Every binding, including the claim timestamp,
 * prevents one failed request from reopening another request's consumption.
 */
export async function releaseAddressValidationReview(
  database: D1Database,
  claim: AddressReviewConsumptionClaim,
): Promise<void> {
  // Zero updated rows means the receipt already vanished (retention sweep or
  // external delete). That is a tolerated no-op: release runs on failure
  // paths, and the graceful 409/400 response must still reach the user
  // instead of becoming a 500. Consume-time strictness is unchanged.
  await database.prepare(
    `UPDATE address_validation_reviews SET consumed_at = NULL
     WHERE id = ? AND actor_id = ? AND entity_kind = ? AND target_id = ?
       AND input_address = ? AND consumed_at = ?`,
  ).bind(
    claim.id,
    claim.actorId,
    claim.entityKind,
    claim.targetId,
    claim.inputAddress,
    claim.consumedAt,
  ).run();
}
