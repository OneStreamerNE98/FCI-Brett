export const MAX_ASSISTANT_LABELS = 20;
export const MAX_ASSISTANT_LABEL_SLUG_LENGTH = 60;
export const MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH = 300;

export const DEFAULT_ASSISTANT_LABEL_DEFINITIONS = Object.freeze([
  Object.freeze({
    slug: "lead",
    description: "A new sales opportunity or request for an estimate.",
  }),
  Object.freeze({
    slug: "project-update",
    description: "Information or a requested change concerning existing project work.",
  }),
  Object.freeze({
    slug: "schedule",
    description: "A request or change involving an appointment, installation, or project timing.",
  }),
  Object.freeze({
    slug: "warranty",
    description: "A callback, repair, service, or warranty concern.",
  }),
] as const);

export type AssistantLabelDefinition = Readonly<{
  slug: string;
  description: string;
  retired: boolean;
  createdAt: number;
  updatedAt: number;
}>;

export const ASSISTANT_LABEL_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;

const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/gu;
// Preserve line feeds just long enough to inspect the prompt-boundary shape.
// They are collapsed before the normalized description is returned, so no
// control character is persisted.
const CONTROL_CHARACTERS_EXCEPT_LINE_FEED = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu;
const PROMPT_SECTION_HEADERS = Object.freeze([
  "CANDIDATE PROJECTS:",
  "UNTRUSTED EMAIL SUMMARY:",
  "INTENT LABEL DEFINITIONS:",
  "PARTY CATALOG:",
  "UNTRUSTED ORIGINAL EMAIL BODY:",
] as const);

export class AssistantLabelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantLabelValidationError";
  }
}

export function assistantLabelCodePointLength(value: string) {
  return [...value].length;
}

export function normalizeAssistantLabelSlug(value: unknown) {
  if (
    typeof value !== "string"
    || !ASSISTANT_LABEL_IDENTIFIER_PATTERN.test(value)
    || assistantLabelCodePointLength(value) > MAX_ASSISTANT_LABEL_SLUG_LENGTH
  ) {
    throw new AssistantLabelValidationError("AI label slug is invalid.");
  }
  return value;
}

export function normalizeAssistantLabelDescription(value: unknown) {
  if (typeof value !== "string") {
    throw new AssistantLabelValidationError("AI label description is required.");
  }
  const stripped = value
    .normalize("NFKC")
    .replace(BIDI_CONTROLS, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u2028\u2029]/gu, "\n")
    .replace(CONTROL_CHARACTERS_EXCEPT_LINE_FEED, "");
  const lines = stripped.split("\n");
  if (lines.some((line) =>
    PROMPT_SECTION_HEADERS.some((header) => line.trim().toUpperCase() === header)
  )) {
    throw new AssistantLabelValidationError(
      "AI label descriptions cannot reproduce an analysis prompt section heading.",
    );
  }
  if (/(?:```|~~~)/u.test(stripped)) {
    throw new AssistantLabelValidationError(
      "AI label descriptions cannot contain code or JSON fences.",
    );
  }
  const normalized = stripped
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    throw new AssistantLabelValidationError("AI label description is required.");
  }
  if (assistantLabelCodePointLength(normalized) > MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH) {
    throw new AssistantLabelValidationError(
      `AI label descriptions cannot exceed ${MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return normalized;
}

export function normalizeAssistantLabelTimestamp(value: unknown, label: string) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 8_640_000_000_000_000
  ) {
    throw new TypeError(`${label} must be a valid millisecond timestamp`);
  }
  return value;
}

function normalizedRetired(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new TypeError("AI label retired state must be boolean");
}

function valueFrom(
  row: Readonly<Record<string, unknown>>,
  camelCase: string,
  snakeCase: string,
) {
  return Object.hasOwn(row, camelCase) ? row[camelCase] : row[snakeCase];
}

export function normalizeStoredAssistantLabelDefinition(
  row: Readonly<Record<string, unknown>>,
): AssistantLabelDefinition {
  const createdAt = normalizeAssistantLabelTimestamp(
    valueFrom(row, "createdAt", "created_at"),
    "AI label created_at",
  );
  const updatedAt = normalizeAssistantLabelTimestamp(
    valueFrom(row, "updatedAt", "updated_at"),
    "AI label updated_at",
  );
  if (updatedAt < createdAt) {
    throw new TypeError("AI label timestamps are inconsistent");
  }
  return Object.freeze({
    slug: normalizeAssistantLabelSlug(row.slug),
    description: normalizeAssistantLabelDescription(row.description),
    retired: normalizedRetired(row.retired),
    createdAt,
    updatedAt,
  });
}

export function createAssistantLabelSlug(randomUuid = crypto.randomUUID()) {
  const compact = randomUuid.replaceAll("-", "").toLowerCase();
  const slug = `label_${compact}`;
  return normalizeAssistantLabelSlug(slug);
}
