/** The owner's cap counts USABLE labels: retired rows are tombstones that keep
 * historical queue rows readable and can never be removed, so counting them
 * would let a catalog dead-end permanently at "20/20" with no escape. Active
 * (non-retired) rows are capped here; total stored rows are separately bounded
 * by MAX_ASSISTANT_LABEL_ROWS so tombstone growth stays finite. */
export const MAX_ASSISTANT_LABELS = 20;
export const MAX_ASSISTANT_LABEL_ROWS = 100;
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

/** The migration-seeded slugs (drizzle/0025 and PostgreSQL migration v15 insert
 * exactly these). They carry AI-11(a)'s typed accepts, so they are PROTECTED:
 * neither deletable nor retirable through any adapter or route. Descriptions
 * stay editable — spec decision 4 keeps every description updatable. Derived
 * from the seed list rather than matched by name prefix so a future seed change
 * cannot silently drop a slug out of protection. */
export const SYSTEM_ASSISTANT_LABEL_SLUGS: ReadonlySet<string> = Object.freeze(
  new Set(DEFAULT_ASSISTANT_LABEL_DEFINITIONS.map(({ slug }) => slug)),
) as ReadonlySet<string>;

export function isSystemAssistantLabelSlug(slug: unknown) {
  return typeof slug === "string" && SYSTEM_ASSISTANT_LABEL_SLUGS.has(slug);
}

export type AssistantLabelDefinition = Readonly<{
  slug: string;
  description: string;
  retired: boolean;
  createdAt: number;
  updatedAt: number;
}>;

export const ASSISTANT_LABEL_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;

const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/gu;
// Line feeds survive the control-character strip so that CR, LS, and PS all
// fold into one separator that the whitespace collapse then turns into a
// single space. No control character reaches the persisted description.
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
  // Collapse BEFORE inspecting the prompt boundary. Checking the uncollapsed
  // string let "CANDIDATE\nPROJECTS:" pass as two harmless lines and then
  // normalize INTO the exact forbidden header, so the stored value was the
  // attack and only a second, accidental pass would reject it. Collapsing
  // first makes one pass authoritative and the function idempotent.
  const normalized = stripped
    .replace(/\s+/gu, " ")
    .trim();
  // Containment, not line equality: after the collapse every line has been
  // joined, so a header split across lines or padded with runs of whitespace
  // reduces to the same substring. This is strictly stronger than the previous
  // per-line equality test \u2014 anything it caught is still caught.
  const upperCased = normalized.toUpperCase();
  if (PROMPT_SECTION_HEADERS.some((header) => upperCased.includes(header))) {
    throw new AssistantLabelValidationError(
      "AI label descriptions cannot reproduce an analysis prompt section heading.",
    );
  }
  if (/(?:```|~~~)/u.test(normalized)) {
    throw new AssistantLabelValidationError(
      "AI label descriptions cannot contain code or JSON fences.",
    );
  }
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
