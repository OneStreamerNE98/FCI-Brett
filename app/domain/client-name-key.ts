/**
 * Produces the production uniqueness key for a client business name.
 *
 * Keep this application-side algorithm aligned with
 * `docs/production-postgresql-foundation.md`. PostgreSQL `lower()` does not
 * perform Unicode normalization, so the database constraint alone is not a
 * substitute for this function.
 */
export function normalizeClientNameKey(name: string) {
  if (typeof name !== "string") throw new TypeError("Client name must be a string");
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

const CLIENT_NAME_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export function normalizeClientDisplayName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || normalized.length > 180
    || CLIENT_NAME_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}
