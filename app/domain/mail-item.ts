export const MAIL_ITEM_STATUSES = Object.freeze([
  "needs-review",
  "accepted",
  "dismissed",
  "skipped-noise",
  "failed",
] as const);

export type MailItemStatus = typeof MAIL_ITEM_STATUSES[number];

export const MAIL_ITEM_PARTIES = Object.freeze([
  "client",
  "prospect",
  "vendor",
  "employee",
  "unknown",
] as const);

export type MailItemParty = typeof MAIL_ITEM_PARTIES[number];

export const MAIL_ITEM_CONFIDENCES = Object.freeze([
  "high",
  "medium",
  "low",
] as const);

export type MailItemConfidence = typeof MAIL_ITEM_CONFIDENCES[number];

export const MAX_MAIL_ITEM_FAILURE_ATTEMPTS = 3;
export const MAX_MAIL_ITEM_ANALYSIS_PAYLOAD_BYTES = 32_000;

const MAIL_ITEM_STATUS_SET = new Set<string>(MAIL_ITEM_STATUSES);
const MAIL_ITEM_PARTY_SET = new Set<string>(MAIL_ITEM_PARTIES);
const MAIL_ITEM_CONFIDENCE_SET = new Set<string>(MAIL_ITEM_CONFIDENCES);
const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONNECTION_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/;
const GMAIL_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UNSAFE_SINGLE_LINE_CONTROLS = /[\u0000-\u001f\u007f]/;
const UNSAFE_MULTILINE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 500;
const MAX_JSON_KEY_LENGTH = 160;
const MAX_JSON_STRING_LENGTH = 8_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

export type MailItemAnalysisPayload = Readonly<Record<string, unknown>>;

export type MailItem = Readonly<{
  id: string;
  connectionKey: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  clientId: string | null;
  suggestedProjectId: string | null;
  approvedProjectId: string | null;
  status: MailItemStatus;
  matchReason: string | null;
  emailDriveFileId: string | null;
  analysisPayload: MailItemAnalysisPayload | null;
  party: MailItemParty | null;
  confidence: MailItemConfidence | null;
  contentHash: string | null;
  labelDefinitionVersion: string | null;
  attemptedLabelDefinitionVersion: string | null;
  subject: string | null;
  sender: string | null;
  receivedAt: number | null;
  failureAttempts: number;
  errorCode: string | null;
  coverageComplete: boolean;
  createdAt: number;
  updatedAt: number;
}>;

/** Keeps D1 relationship IDs admissible by the PostgreSQL UUID columns. */
export function isMailItemRelationshipId(value: unknown): value is string {
  return typeof value === "string" && POSTGRES_UUID_PATTERN.test(value);
}

function valueFrom(
  row: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
) {
  return Object.hasOwn(row, camelCase) ? row[camelCase] : row[snakeCase];
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
  multiline = false,
) {
  const unsafeControls = multiline
    ? UNSAFE_MULTILINE_CONTROLS
    : UNSAFE_SINGLE_LINE_CONTROLS;
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > maximum
    || unsafeControls.test(value)
  ) {
    throw new TypeError(`${label} must be bounded nonblank text`);
  }
  return value;
}

function nullableText(
  value: unknown,
  label: string,
  maximum: number,
  multiline = false,
) {
  if (value === null || value === undefined) return null;
  return boundedText(value, label, maximum, multiline);
}

function nullableCatalogValue<const Value extends string>(
  value: unknown,
  label: string,
  catalog: ReadonlySet<string>,
) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !catalog.has(value)) {
    throw new TypeError(`${label} is outside the supported catalog`);
  }
  return value as Value;
}

function relationshipId(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  if (!isMailItemRelationshipId(value)) {
    throw new TypeError(`${label} must be a UUID or null`);
  }
  return value.toLowerCase();
}

function requiredTimestamp(value: unknown, label: string) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_DATE_MS
  ) {
    throw new TypeError(`${label} must be a valid millisecond timestamp`);
  }
  return value;
}

function nullableTimestamp(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  return requiredTimestamp(value, label);
}

function failureAttempts(value: unknown) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_MAIL_ITEM_FAILURE_ATTEMPTS
  ) {
    throw new TypeError(
      `Mail item failure attempts must be between 0 and ${MAX_MAIL_ITEM_FAILURE_ATTEMPTS}`,
    );
  }
  return value;
}

function storedBoolean(value: unknown, label: string) {
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new TypeError(`${label} must be boolean`);
}

function cloneJsonValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  count: { nodes: number },
): unknown {
  count.nodes += 1;
  if (count.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new TypeError("Mail item analysis payload is too complex");
  }
  if (
    value === null
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (
      value.length > MAX_JSON_STRING_LENGTH
      || UNSAFE_MULTILINE_CONTROLS.test(value)
    ) {
      throw new TypeError("Mail item analysis payload contains unsafe text");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Mail item analysis payload must contain JSON values");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Mail item analysis payload must not be circular");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((entry) => cloneJsonValue(entry, depth + 1, ancestors, count)),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Mail item analysis payload must contain plain objects");
    }
    const entries = Object.entries(value).map(([key, entry]) => {
      if (
        !key
        || key.length > MAX_JSON_KEY_LENGTH
        || UNSAFE_SINGLE_LINE_CONTROLS.test(key)
      ) {
        throw new TypeError("Mail item analysis payload contains an invalid key");
      }
      return [key, cloneJsonValue(entry, depth + 1, ancestors, count)] as const;
    });
    return Object.freeze(Object.fromEntries(entries));
  } finally {
    ancestors.delete(value);
  }
}

function analysisPayload(value: unknown): MailItemAnalysisPayload | null {
  if (value === null || value === undefined) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new TypeError("Mail item analysis payload must be valid JSON");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Mail item analysis payload must be a JSON object");
  }
  const cloned = cloneJsonValue(parsed, 0, new Set<object>(), { nodes: 0 });
  const serialized = JSON.stringify(cloned);
  if (
    new TextEncoder().encode(serialized).byteLength
    > MAX_MAIL_ITEM_ANALYSIS_PAYLOAD_BYTES
  ) {
    throw new TypeError("Mail item analysis payload is too large");
  }
  return cloned as MailItemAnalysisPayload;
}

export function normalizeMailItemConnectionKey(value: unknown) {
  if (typeof value !== "string" || !CONNECTION_KEY_PATTERN.test(value)) {
    throw new TypeError("Mail item connection key is invalid");
  }
  return value;
}

export function normalizeMailItemGmailMessageId(value: unknown) {
  if (typeof value !== "string" || !GMAIL_MESSAGE_ID_PATTERN.test(value)) {
    throw new TypeError("Mail item Gmail message ID is invalid");
  }
  return value;
}

export function normalizeMailItemStatus(value: unknown): MailItemStatus {
  if (typeof value !== "string" || !MAIL_ITEM_STATUS_SET.has(value)) {
    throw new TypeError("Mail item status is invalid");
  }
  return value as MailItemStatus;
}

export function normalizeMailItemLabelDefinitionVersion(value: unknown) {
  return boundedText(
    value,
    "Mail item label-definition version",
    128,
  );
}

export function serializeMailItemAnalysisPayload(
  value: MailItemAnalysisPayload | null,
) {
  return value === null ? null : JSON.stringify(value);
}

/** Converts either D1 snake-case rows or port-shaped rows to one frozen domain shape. */
export function normalizeStoredMailItem(row: Record<string, unknown>): MailItem {
  const status = normalizeMailItemStatus(row.status);
  const attempts = failureAttempts(
    valueFrom(row, "failureAttempts", "failure_attempts"),
  );
  const attemptedLabelDefinitionVersion = nullableText(
    valueFrom(
      row,
      "attemptedLabelDefinitionVersion",
      "attempted_label_definition_version",
    ),
    "Mail item attempted label-definition version",
    128,
  );
  if (
    (attempts === 0 && attemptedLabelDefinitionVersion !== null)
    || (attempts > 0 && attemptedLabelDefinitionVersion === null)
  ) {
    throw new TypeError(
      "Mail item failure attempts and attempted label-definition version must be recorded together",
    );
  }
  if (
    (status === "accepted"
      || status === "dismissed"
      || status === "skipped-noise")
    && attempts !== 0
  ) {
    throw new TypeError("Terminal mail items cannot retain analysis retry state");
  }
  const errorCode = nullableText(
    valueFrom(row, "errorCode", "error_code"),
    "Mail item error code",
    120,
  );
  if (status === "failed") {
    if (attempts < 1 || errorCode === null) {
      throw new TypeError(
        "Failed mail items require a bounded attempt count and error code",
      );
    }
  } else if (errorCode !== null) {
    throw new TypeError("Only failed mail items may retain an error code");
  }

  const createdAt = requiredTimestamp(
    valueFrom(row, "createdAt", "created_at"),
    "Mail item created_at",
  );
  const updatedAt = requiredTimestamp(
    valueFrom(row, "updatedAt", "updated_at"),
    "Mail item updated_at",
  );
  if (updatedAt < createdAt) {
    throw new TypeError("Mail item timestamps are inconsistent");
  }

  return Object.freeze({
    id: boundedText(row.id, "Mail item ID", 512),
    connectionKey: normalizeMailItemConnectionKey(
      valueFrom(row, "connectionKey", "connection_key"),
    ),
    gmailMessageId: normalizeMailItemGmailMessageId(
      valueFrom(row, "gmailMessageId", "gmail_message_id"),
    ),
    gmailThreadId: nullableText(
      valueFrom(row, "gmailThreadId", "gmail_thread_id"),
      "Mail item Gmail thread ID",
      512,
    ),
    clientId: relationshipId(
      valueFrom(row, "clientId", "client_id"),
      "Mail item client ID",
    ),
    suggestedProjectId: relationshipId(
      valueFrom(row, "suggestedProjectId", "suggested_project_id"),
      "Mail item suggested project ID",
    ),
    approvedProjectId: relationshipId(
      valueFrom(row, "approvedProjectId", "approved_project_id"),
      "Mail item approved project ID",
    ),
    status,
    matchReason: nullableText(
      valueFrom(row, "matchReason", "match_reason"),
      "Mail item match reason",
      1_000,
      true,
    ),
    emailDriveFileId: nullableText(
      valueFrom(row, "emailDriveFileId", "email_drive_file_id"),
      "Mail item Drive file ID",
      512,
    ),
    analysisPayload: analysisPayload(
      valueFrom(row, "analysisPayload", "analysis_payload"),
    ),
    party: nullableCatalogValue<MailItemParty>(
      row.party,
      "Mail item party",
      MAIL_ITEM_PARTY_SET,
    ),
    confidence: nullableCatalogValue<MailItemConfidence>(
      row.confidence,
      "Mail item confidence",
      MAIL_ITEM_CONFIDENCE_SET,
    ),
    contentHash: (() => {
      const value = valueFrom(row, "contentHash", "content_hash");
      if (value === null || value === undefined) return null;
      if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw new TypeError("Mail item content hash must be a lowercase SHA-256");
      }
      return value;
    })(),
    labelDefinitionVersion: nullableText(
      valueFrom(row, "labelDefinitionVersion", "label_definition_version"),
      "Mail item label-definition version",
      128,
    ),
    attemptedLabelDefinitionVersion,
    subject: nullableText(row.subject, "Mail item subject", 500),
    sender: nullableText(row.sender, "Mail item sender", 500),
    receivedAt: nullableTimestamp(
      valueFrom(row, "receivedAt", "received_at"),
      "Mail item received_at",
    ),
    failureAttempts: attempts,
    errorCode,
    coverageComplete: storedBoolean(
      valueFrom(row, "coverageComplete", "coverage_complete"),
      "Mail item coverage_complete",
    ),
    createdAt,
    updatedAt,
  });
}
