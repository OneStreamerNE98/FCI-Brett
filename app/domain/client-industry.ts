const CLIENT_INDUSTRY_MAXIMUM_LENGTH = 120;
const CLIENT_INDUSTRY_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

/**
 * Shared create/edit contract for the optional client industry.
 *
 * `null`, empty, and whitespace-only values all mean "not set". Undefined is
 * reserved for a value whose type or content is invalid.
 */
export function normalizeClientIndustry(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  if (
    normalized.length > CLIENT_INDUSTRY_MAXIMUM_LENGTH
    || CLIENT_INDUSTRY_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}
