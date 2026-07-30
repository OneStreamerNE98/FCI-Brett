const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

function contactText(
  value: unknown,
  maximum: number,
  nullable: boolean,
): string | null | undefined {
  if (nullable && (value === null || value === "")) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || normalized.length > maximum
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function normalizeContactName(value: unknown) {
  const normalized = contactText(value, 180, false);
  return typeof normalized === "string" ? normalized : undefined;
}

export function normalizeContactEmail(value: unknown) {
  return contactText(value, 254, true);
}

export function normalizeContactPhone(value: unknown) {
  return contactText(value, 80, true);
}

export function normalizeContactRole(value: unknown) {
  const normalized = contactText(value, 120, false);
  return typeof normalized === "string" ? normalized : undefined;
}
