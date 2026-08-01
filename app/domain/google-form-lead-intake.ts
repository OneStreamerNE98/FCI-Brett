import {
  FIRST_RUN_IMPORT_REAL_DATA_ALLOWED,
  FIRST_RUN_IMPORT_TEST_MARKER,
  matchFirstRunClientDuplicates,
} from "./first-run-import.ts";
import type {
  FirstRunImportStoredClient,
} from "../ports/first-run-import-repository.ts";
import type {
  GoogleFormLeadProposal,
  GoogleFormLeadObservedPosition,
  GoogleFormLeadReviewDraft,
  GoogleFormLeadReviewState,
} from "../ports/google-form-lead-intake.ts";

export type GoogleFormLeadSourceRow = Readonly<{
  sourceRow: number;
  cells: readonly unknown[];
  identityCells?: readonly unknown[];
}>;

export const GOOGLE_FORM_LEAD_MAX_ROWS = 25;
export const GOOGLE_FORM_LEAD_REVIEW_LIMIT = 50;
export const GOOGLE_FORM_LEAD_HEADERS = Object.freeze([
  "Timestamp",
  "Name",
  "Address",
  "Rooms",
  "Flooring Type",
  "Preferred Contact",
] as const);

export const GOOGLE_FORM_LEAD_REVIEW_STATES = Object.freeze([
  "ready",
  "duplicate",
  "invalid",
  "blocked-real-data",
] as const);
export const GOOGLE_FORM_LEAD_REVIEW_STATUSES = Object.freeze([
  "needs-review",
  "accepted",
  "dismissed",
] as const);

const CELL_MAXIMUMS = Object.freeze([100, 160, 300, 160, 160, 254] as const);
const SUBMISSION_KEY_PATTERN = /^[a-f0-9]{64}$/u;

export class GoogleFormLeadIntakeValidationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "GoogleFormLeadIntakeValidationError";
    this.code = code;
    this.status = status;
  }
}

export class GoogleFormLeadReviewDraftValidationError
  extends GoogleFormLeadIntakeValidationError {
  readonly sourceRow: number;

  constructor(sourceRow: number) {
    super(
      "form_lead_review_draft_invalid",
      `Google Form response row ${sourceRow} could not be saved because its review draft is invalid.`,
    );
    this.name = "GoogleFormLeadReviewDraftValidationError";
    this.sourceRow = sourceRow;
  }
}

export function isGoogleFormLeadSubmissionKey(value: unknown): value is string {
  return typeof value === "string" && SUBMISSION_KEY_PATTERN.test(value);
}

/**
 * A bounded Sheet observation may either create a review or refresh the last-seen
 * row of an existing pending review, but never do both for one stable identity.
 */
export function isGoogleFormLeadPositionBatch(
  reviews: readonly GoogleFormLeadObservedPosition[],
  observedPositions: readonly GoogleFormLeadObservedPosition[],
) {
  if (
    !Array.isArray(reviews)
    || !Array.isArray(observedPositions)
    || reviews.length + observedPositions.length > GOOGLE_FORM_LEAD_MAX_ROWS
  ) return false;
  const submissionKeys = new Set<string>();
  for (const position of [...reviews, ...observedPositions]) {
    if (
      !isRecord(position)
      || !isGoogleFormLeadSubmissionKey(position.submissionKey)
      || !Number.isSafeInteger(position.sourceRow)
      || Number(position.sourceRow) < 2
      || submissionKeys.has(position.submissionKey)
    ) return false;
    submissionKeys.add(position.submissionKey);
  }
  return true;
}

function identityCell(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return Object.freeze(["empty"] as const);
  }
  if (typeof value === "string") {
    return Object.freeze([
      "string",
      value.normalize("NFKC").replace(/\r\n?/gu, "\n"),
    ] as const);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.freeze(["number", Object.is(value, -0) ? "-0" : String(value)] as const);
  }
  if (typeof value === "boolean") {
    return Object.freeze(["boolean", value] as const);
  }
  throw new GoogleFormLeadIntakeValidationError(
    "form_lead_identity_invalid",
    "A Google Form response contains an unsupported identity value.",
  );
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Stable Forms identity: effective Timestamp plus a hash of effective columns B:F. */
export async function googleFormLeadSubmissionKey(row: readonly unknown[]) {
  const cells = GOOGLE_FORM_LEAD_HEADERS.map((_, index) => identityCell(row[index]));
  const contentHash = await sha256(JSON.stringify(cells.slice(1)));
  return sha256(JSON.stringify(["google-form-lead:v1", cells[0], contentHash]));
}

function normalizedCell(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) return null;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseGoogleFormLeadProposal(value: unknown) {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    "company", "contactName", "contactEmail", "contactPhone", "projectName",
    "source", "stage", "site", "estimatedValue", "nextAction", "nextActionAt",
    "rooms", "flooringType", "preferredContact",
  ];
  if (
    Object.keys(value).length !== expectedKeys.length
    || Object.keys(value).some((key) => !expectedKeys.includes(key))
  ) return null;
  const company = normalizedCell(value.company, 180);
  const contactName = normalizedCell(value.contactName, 160);
  const contactEmail = value.contactEmail === null
    ? null
    : normalizedCell(value.contactEmail, 254);
  const contactPhone = value.contactPhone === null
    ? null
    : normalizedCell(value.contactPhone, 40);
  const project = normalizedCell(value.projectName, 180);
  const source = normalizedCell(value.source, 80);
  const stage = normalizedCell(value.stage, 80);
  const site = normalizedCell(value.site, 300);
  const nextAction = normalizedCell(value.nextAction, 500);
  const rooms = value.rooms === null ? null : normalizedCell(value.rooms, 160);
  const flooringType = value.flooringType === null
    ? null
    : normalizedCell(value.flooringType, 160);
  const preferredContact = value.preferredContact === null
    ? null
    : normalizedCell(value.preferredContact, 254);
  if (
    company === null || contactName === null
    || (value.contactEmail !== null && !contactEmail)
    || (value.contactPhone !== null && !contactPhone) || project === null || !source
    || !stage || site === null || !nextAction || (value.rooms !== null && !rooms)
    || (value.flooringType !== null && !flooringType)
    || (value.preferredContact !== null && !preferredContact)
    || (value.estimatedValue !== null
      && (!Number.isSafeInteger(value.estimatedValue) || Number(value.estimatedValue) < 0))
    || (value.nextActionAt !== null
      && (!Number.isSafeInteger(value.nextActionAt) || Number(value.nextActionAt) < 0))
  ) return null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail.toLowerCase())) {
    return null;
  }
  return Object.freeze({
    company,
    contactName,
    contactEmail: contactEmail ? contactEmail.toLowerCase() : null,
    contactPhone: contactPhone || null,
    projectName: project,
    source,
    stage,
    site,
    estimatedValue: value.estimatedValue === null ? null : Number(value.estimatedValue),
    nextAction,
    nextActionAt: value.nextActionAt === null ? null : Number(value.nextActionAt),
    rooms: rooms || null,
    flooringType: flooringType || null,
    preferredContact: preferredContact || null,
  }) satisfies GoogleFormLeadProposal;
}

export function parseGoogleFormLeadReasons(value: unknown) {
  if (!Array.isArray(value) || value.length > 12) return null;
  const reasons = value.map((reason) => normalizedCell(reason, 300));
  return reasons.some((reason) => !reason)
    ? null
    : Object.freeze(reasons as string[]);
}

function parsePreferredContact(value: string) {
  const normalized = value.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    return { email: normalized, phone: null } as const;
  }
  const digits = value.replace(/\D/gu, "");
  if (value.length <= 40 && digits.length >= 7 && digits.length <= 18) {
    return { email: null, phone: value } as const;
  }
  return { email: null, phone: null } as const;
}

function projectName(flooringType: string, rooms: string) {
  if (flooringType && rooms) return `${flooringType} flooring — ${rooms}`.slice(0, 180);
  if (flooringType) return `${flooringType} flooring inquiry`.slice(0, 180);
  if (rooms) return `Flooring inquiry — ${rooms}`.slice(0, 180);
  return "Flooring inquiry";
}

function proposalFromCells(cells: readonly string[]): GoogleFormLeadProposal {
  const [, name, address, rooms, flooringType, preferredContact] = cells;
  const contact = parsePreferredContact(preferredContact ?? "");
  return Object.freeze({
    company: name ?? "",
    contactName: name ?? "",
    contactEmail: contact.email,
    contactPhone: contact.phone,
    projectName: projectName(flooringType ?? "", rooms ?? ""),
    source: "Google Form",
    stage: "New inquiry",
    site: address ?? "",
    estimatedValue: null,
    nextAction: preferredContact
      ? `Follow up using preferred contact: ${preferredContact}`.slice(0, 500)
      : "Confirm the preferred contact method and schedule a site visit.",
    nextActionAt: null,
    rooms: rooms || null,
    flooringType: flooringType || null,
    preferredContact: preferredContact || null,
  });
}

function invalidDraft(
  submissionKey: string,
  sourceRow: number,
  submittedAt: string | null,
  proposal: GoogleFormLeadProposal,
  reasons: readonly string[],
  state: GoogleFormLeadReviewState = "invalid",
): GoogleFormLeadReviewDraft {
  return Object.freeze({
    submissionKey,
    sourceRow,
    submittedAt,
    state,
    proposal,
    reasons: Object.freeze([...reasons]),
  });
}

function redactedProposal(nextAction: string): GoogleFormLeadProposal {
  return Object.freeze({
    company: "",
    contactName: "",
    contactEmail: null,
    contactPhone: null,
    projectName: "",
    source: "Google Form",
    stage: "New inquiry",
    site: "",
    estimatedValue: null,
    nextAction,
    nextActionAt: null,
    rooms: null,
    flooringType: null,
    preferredContact: null,
  });
}

function blockedRealDataDraft(submissionKey: string, sourceRow: number) {
  return invalidDraft(
    submissionKey,
    sourceRow,
    null,
    redactedProposal("Owner launch approval is required before this response can be reviewed."),
    ["Real client responses stay blocked until WS-11 and owner launch approval."],
    "blocked-real-data",
  );
}

function sanitizedRow(value: readonly unknown[]) {
  const cells: string[] = [];
  const reasons: string[] = [];
  for (let index = 0; index < GOOGLE_FORM_LEAD_HEADERS.length; index += 1) {
    const normalized = normalizedCell(value[index], CELL_MAXIMUMS[index] ?? 0);
    if (normalized === null) {
      cells.push("");
      reasons.push(`${GOOGLE_FORM_LEAD_HEADERS[index]} contains an unsupported or oversized value.`);
    } else {
      cells.push(normalized);
    }
  }
  if (value.length > GOOGLE_FORM_LEAD_HEADERS.length) {
    reasons.push("Unexpected response columns are not supported.");
  }
  return Object.freeze({
    cells: Object.freeze(cells),
    reasons: Object.freeze(reasons),
  });
}

function hasTestMarker(value: string) {
  return value === FIRST_RUN_IMPORT_TEST_MARKER
    || value.startsWith(`${FIRST_RUN_IMPORT_TEST_MARKER} `);
}

/** Pure mapping/watermark input shared by the on-demand trigger and future WS-12. */
export async function mapGoogleFormLeadRows(input: Readonly<{
  rows: readonly GoogleFormLeadSourceRow[];
  clients: readonly FirstRunImportStoredClient[];
}>) {
  if (
    input.rows.length > GOOGLE_FORM_LEAD_MAX_ROWS
    || input.rows.some(({ sourceRow, cells, identityCells }) => (
      !Number.isSafeInteger(sourceRow)
      || sourceRow < 2
      || !Array.isArray(cells)
      || (identityCells !== undefined && !Array.isArray(identityCells))
    ))
  ) {
    throw new GoogleFormLeadIntakeValidationError(
      "form_lead_rows_invalid",
      "Google Form response rows must use a bounded Sheet range.",
    );
  }

  const drafts: GoogleFormLeadReviewDraft[] = [];
  for (const row of input.rows) {
    const sourceRow = row.sourceRow;
    const submissionKey = await googleFormLeadSubmissionKey(row.identityCells ?? row.cells);
    const sanitized = sanitizedRow(row.cells);
    const cells = sanitized.cells;

    const submittedAt = cells[0] || null;
    const proposal = proposalFromCells(cells);
    const missing = [
      !submittedAt ? "Timestamp is required." : null,
      !proposal.company ? "Name is required." : null,
      !proposal.site ? "Address is required." : null,
    ].filter((reason): reason is string => reason !== null);
    const invalidReasons = [...sanitized.reasons, ...missing];
    if (invalidReasons.length > 0) {
      const safeProposal = FIRST_RUN_IMPORT_REAL_DATA_ALLOWED || hasTestMarker(proposal.company)
        ? proposal
        : redactedProposal("Review and correct this response before creating a lead.");
      drafts.push(invalidDraft(
        submissionKey,
        sourceRow,
        submittedAt,
        safeProposal,
        invalidReasons,
      ));
      continue;
    }
    if (
      !FIRST_RUN_IMPORT_REAL_DATA_ALLOWED
      && !hasTestMarker(proposal.company)
    ) {
      drafts.push(blockedRealDataDraft(submissionKey, sourceRow));
      continue;
    }

    const duplicateIssues = await matchFirstRunClientDuplicates({
      name: proposal.company,
      email: proposal.contactEmail,
      phone: proposal.contactPhone,
      address: proposal.site,
    }, input.clients);
    drafts.push(Object.freeze({
      submissionKey,
      sourceRow,
      submittedAt,
      state: duplicateIssues.length > 0 ? "duplicate" : "ready",
      proposal,
      reasons: Object.freeze(duplicateIssues.map(({ message }) => message)),
    }));
  }
  return Object.freeze(drafts);
}

export function assertGoogleFormLeadHeaders(value: readonly (readonly unknown[])[]) {
  const row = value[0];
  const normalized = row?.map((cell) => normalizedCell(cell, 80));
  if (
    !normalized
    || normalized.length !== GOOGLE_FORM_LEAD_HEADERS.length
    || normalized.some((cell, index) => cell !== GOOGLE_FORM_LEAD_HEADERS[index])
  ) {
    throw new GoogleFormLeadIntakeValidationError(
      "form_lead_headers_invalid",
      `The response Sheet must use these columns in order: ${GOOGLE_FORM_LEAD_HEADERS.join(", ")}.`,
      409,
    );
  }
}
