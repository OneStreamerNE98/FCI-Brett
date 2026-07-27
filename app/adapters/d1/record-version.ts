import { nextRecordVersion, normalizeRecordVersion } from "../../domain/record-version.ts";

const MAX_D1_SAFE_VERSION = BigInt(Number.MAX_SAFE_INTEGER);

export function d1RecordVersion(value: unknown, label = "D1 record version") {
  const canonical = normalizeRecordVersion(value);
  if (!canonical || BigInt(canonical) > MAX_D1_SAFE_VERSION) {
    throw new TypeError(`${label} must be a positive safe whole number.`);
  }
  return canonical;
}

export function nextD1RecordVersion(value: string) {
  const next = nextRecordVersion(d1RecordVersion(value));
  if (BigInt(next) > MAX_D1_SAFE_VERSION) {
    throw new TypeError("D1 record version cannot be incremented safely.");
  }
  return next;
}
