const MAX_SIGNED_64_BIT = BigInt("9223372036854775807");
const POSITIVE_VERSION_PATTERN = /^[1-9][0-9]{0,18}$/;

/**
 * Core-record versions cross both SQLite and PostgreSQL boundaries. Keep them
 * as canonical decimal strings so PostgreSQL bigint values never pass through
 * an unsafe JavaScript number.
 */
export function normalizeRecordVersion(value: unknown): string | null {
  const canonical = typeof value === "string"
    ? value
    : typeof value === "bigint"
      ? value.toString()
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : "";
  if (!POSITIVE_VERSION_PATTERN.test(canonical)) return null;
  return BigInt(canonical) <= MAX_SIGNED_64_BIT ? canonical : null;
}

export function nextRecordVersion(value: string): string {
  const current = normalizeRecordVersion(value);
  if (!current || BigInt(current) === MAX_SIGNED_64_BIT) {
    throw new TypeError("Record version cannot be incremented.");
  }
  return (BigInt(current) + BigInt(1)).toString();
}

export type VersionConflict = Readonly<{
  outcome: "conflict";
  currentVersion: string;
}>;
