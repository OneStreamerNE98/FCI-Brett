import { consumeAddressValidationReview } from "../adapters/d1/address-validation-reviews";
import type { D1Database } from "../adapters/d1/d1-database";
import {
  normalizeAddressReviewReference,
  normalizeAddressText,
  typedAddress,
  type AddressEntityKind,
  type PersistedAddress,
} from "../domain/address-validation";

export type AddressMutationResolution =
  | { ok: true; value: PersistedAddress }
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
  return consumeAddressValidationReview(database, {
    actorId: input.actorId,
    entityKind: input.entityKind,
    targetId: input.targetId,
    inputAddress: address,
    review,
    now: input.now ?? Date.now(),
  });
}
