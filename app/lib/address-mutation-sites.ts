import {
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
  if (resolution.reviewClaim) {
    await releaseAddressValidationReview(database, resolution.reviewClaim);
  }
}
