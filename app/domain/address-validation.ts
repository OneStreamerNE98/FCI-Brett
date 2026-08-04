export const MAX_ADDRESS_LENGTH = 280;
export const ADDRESS_REVIEW_TTL_MS = 15 * 60 * 1_000;

export const ADDRESS_ENTITY_KINDS = ["lead", "client", "project"] as const;
export type AddressEntityKind = typeof ADDRESS_ENTITY_KINDS[number];

export const ADDRESS_REVIEW_VERDICTS = [
  "validated",
  "needs-confirmation",
  "needs-correction",
  "unvalidated",
  "simulated",
] as const;
export type AddressReviewVerdict = typeof ADDRESS_REVIEW_VERDICTS[number];

export const SAVED_ADDRESS_VERDICTS = [
  "validated",
  "review-confirmed",
  "unvalidated",
  "simulated",
] as const;
export type SavedAddressVerdict = typeof SAVED_ADDRESS_VERDICTS[number];

export type PersistedAddress = Readonly<{
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  verdict: SavedAddressVerdict | null;
}>;

export type AddressReviewReference = Readonly<{
  id: string;
  choice: "standardized" | "typed";
}>;

export function normalizeAddressText(value: unknown, required = false): string | null | undefined {
  if (value === null || value === undefined || value === "") {
    return required ? undefined : null;
  }
  if (typeof value !== "string") return undefined;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return required ? undefined : null;
  if (
    normalized.length > MAX_ADDRESS_LENGTH
  ) {
    return undefined;
  }
  return normalized;
}

export function normalizeAddressEntityKind(value: unknown): AddressEntityKind | null {
  return typeof value === "string" && ADDRESS_ENTITY_KINDS.includes(value as AddressEntityKind)
    ? value as AddressEntityKind
    : null;
}

export function normalizeAddressTargetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/u.test(normalized) ? normalized : null;
}

export function normalizeAddressSessionToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  // Address Validation accepts URL/file-safe base64 session tokens up to 36
  // ASCII characters. UUID v4 values satisfy this closed shape.
  return /^[A-Za-z0-9_-]{1,36}$/u.test(normalized) ? normalized : null;
}

export function normalizeAddressReviewReference(value: unknown): AddressReviewReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "id" && key !== "choice")) return null;
  if (
    typeof record.id !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(record.id)
    || (record.choice !== "standardized" && record.choice !== "typed")
  ) {
    return null;
  }
  return { id: record.id, choice: record.choice };
}

export function coordinatesAreValid(latitude: unknown, longitude: unknown) {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180;
}

export function typedAddress(address: string | null): PersistedAddress {
  return Object.freeze({
    address,
    latitude: null,
    longitude: null,
    verdict: address === null ? null : "unvalidated",
  });
}

/**
 * Applications accept trusted metadata only as a separate server argument.
 * Omitting it preserves compatibility while recording typed text honestly as
 * unvalidated. A mismatched trusted value is an internal programming error.
 */
export function persistedAddress(
  normalizedAddress: string | null,
  trusted: PersistedAddress | undefined,
): PersistedAddress {
  if (!trusted) return typedAddress(normalizedAddress);
  if (trusted.address !== normalizedAddress) {
    throw new TypeError("Trusted address evidence does not match the normalized record address.");
  }
  if (normalizedAddress === null) {
    if (trusted.latitude !== null || trusted.longitude !== null || trusted.verdict !== null) {
      throw new TypeError("An empty address cannot carry validation metadata.");
    }
    return trusted;
  }
  if (!SAVED_ADDRESS_VERDICTS.includes(trusted.verdict as SavedAddressVerdict)) {
    throw new TypeError("Trusted address evidence has an unsupported saved verdict.");
  }
  if (trusted.verdict === "unvalidated") {
    if (trusted.latitude !== null || trusted.longitude !== null) {
      throw new TypeError("Unvalidated address text cannot carry coordinates.");
    }
  } else if (!coordinatesAreValid(trusted.latitude, trusted.longitude)) {
    throw new TypeError("Validated address evidence must carry bounded coordinates.");
  }
  return trusted;
}
