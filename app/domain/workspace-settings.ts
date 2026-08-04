export const WORKSPACE_SETTINGS_ID = "workspace";

export type WorkspacePreferences = Readonly<{
  timezone: string;
  appointmentCalendarName: string;
  fieldCalendarName: string;
  calendarSetupMode: "create-shared" | "use-existing";
  appointmentCalendarId: string;
  fieldCalendarId: string;
  calendarEditPolicy: "app-authoritative";
  appointmentReminderHours: number;
  clientReminderHours: number;
  crewReminderHours: number;
  inboxReviewMode: "review-first";
  intakeMailbox: string;
  officeNotificationEmail: string;
}>;

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = Object.freeze({
  timezone: "America/New_York",
  appointmentCalendarName: "FCI • Client Appointments",
  fieldCalendarName: "FCI • Field Schedule",
  calendarSetupMode: "create-shared",
  appointmentCalendarId: "",
  fieldCalendarId: "",
  calendarEditPolicy: "app-authoritative",
  appointmentReminderHours: 24,
  clientReminderHours: 24,
  crewReminderHours: 24,
  inboxReviewMode: "review-first",
  intakeMailbox: "",
  officeNotificationEmail: "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, fallback: string, maximum: number) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return text.slice(0, maximum) || fallback;
}

function cleanHours(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 168 ? numeric : fallback;
}

function cleanEmail(value: unknown) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanOptionalText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
}

/**
 * The one normalization boundary for both the Settings route and runtime
 * effective configuration. Unknown keys remain harmless and malformed values
 * degrade to the same safe defaults the development route has always used.
 */
export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  const input = isRecord(value) ? value : {};
  return Object.freeze({
    timezone: cleanText(input.timezone, DEFAULT_WORKSPACE_PREFERENCES.timezone, 80),
    appointmentCalendarName: cleanText(
      input.appointmentCalendarName,
      DEFAULT_WORKSPACE_PREFERENCES.appointmentCalendarName,
      120,
    ),
    fieldCalendarName: cleanText(
      input.fieldCalendarName,
      DEFAULT_WORKSPACE_PREFERENCES.fieldCalendarName,
      120,
    ),
    calendarSetupMode: input.calendarSetupMode === "use-existing"
      ? "use-existing"
      : "create-shared",
    appointmentCalendarId: cleanOptionalText(input.appointmentCalendarId, 320),
    fieldCalendarId: cleanOptionalText(input.fieldCalendarId, 320),
    calendarEditPolicy: "app-authoritative",
    appointmentReminderHours: cleanHours(
      input.appointmentReminderHours,
      DEFAULT_WORKSPACE_PREFERENCES.appointmentReminderHours,
    ),
    // SET-06 widens older rows with this field's own default. The former shared
    // appointment value seeds only appointment reminders and is never copied.
    clientReminderHours: cleanHours(
      input.clientReminderHours,
      DEFAULT_WORKSPACE_PREFERENCES.clientReminderHours,
    ),
    crewReminderHours: cleanHours(
      input.crewReminderHours,
      DEFAULT_WORKSPACE_PREFERENCES.crewReminderHours,
    ),
    inboxReviewMode: "review-first",
    intakeMailbox: cleanEmail(input.intakeMailbox),
    officeNotificationEmail: cleanEmail(input.officeNotificationEmail),
  });
}

/** Parses the shared JSON document without throwing or admitting arrays. */
export function parseWorkspaceSettingsDocument(value: unknown): Readonly<Record<string, unknown>> {
  if (isRecord(value)) return Object.freeze({ ...value });
  if (typeof value !== "string") return Object.freeze({});
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? Object.freeze({ ...parsed }) : Object.freeze({});
  } catch {
    return Object.freeze({});
  }
}

const WORKSPACE_SETTINGS_MERGE_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u;
const MAX_WORKSPACE_SETTINGS_MERGE_KEYS = 64;
export const MAX_WORKSPACE_SETTINGS_DOCUMENT_BYTES = 64_000;
const OMIT_MERGE_VALUE = Symbol("omit-workspace-settings-merge-value");

/**
 * The incoming PATCH is bounded first as a fast pre-filter. This wording names
 * the patch itself, because the domain layer can only measure the bytes it is
 * handed — never the resulting merged row on either database.
 */
export const WORKSPACE_SETTINGS_PATCH_TOO_LARGE_MESSAGE =
  `Workspace settings merge patch must be at most ${MAX_WORKSPACE_SETTINGS_DOCUMENT_BYTES} UTF-8 bytes`;

/**
 * The merged document limit is enforced atomically inside each adapter's single
 * write. When a merge would grow the stored row past the advertised bound the
 * adapter throws this exact typed error so every caller sees one oversize shape.
 */
export const WORKSPACE_SETTINGS_DOCUMENT_TOO_LARGE_MESSAGE =
  `Workspace settings document must be at most ${MAX_WORKSPACE_SETTINGS_DOCUMENT_BYTES} UTF-8 bytes after merging owned keys`;

/** The one oversize error both adapters raise when a merge exceeds the bound. */
export function workspaceSettingsDocumentTooLargeError(): TypeError {
  return new TypeError(WORKSPACE_SETTINGS_DOCUMENT_TOO_LARGE_MESSAGE);
}

function stripMergeNulls(value: unknown): unknown | typeof OMIT_MERGE_VALUE {
  if (value === null) return OMIT_MERGE_VALUE;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = stripMergeNulls(item);
      return normalized === OMIT_MERGE_VALUE ? null : normalized;
    });
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const normalized = stripMergeNulls(item);
      return normalized === OMIT_MERGE_VALUE ? [] : [[key, normalized]];
    }),
  );
}

/**
 * Produces the one database-ready document patch used by both D1 and
 * PostgreSQL. The key list includes explicit nulls so a future caller can
 * delete a top-level key, while the serialized merge-patch document omits
 * null object members consistently on both databases.
 */
export function prepareWorkspaceSettingsMerge(value: unknown) {
  if (!isRecord(value)) {
    throw new TypeError("Workspace settings merge must be an object");
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_WORKSPACE_SETTINGS_MERGE_KEYS) {
    throw new TypeError(
      `Workspace settings merge must contain at most ${MAX_WORKSPACE_SETTINGS_MERGE_KEYS} top-level keys`,
    );
  }
  if (keys.some((key) => !WORKSPACE_SETTINGS_MERGE_KEY.test(key))) {
    throw new TypeError("Workspace settings merge contains an invalid top-level key");
  }
  const normalized = stripMergeNulls(value);
  if (!isRecord(normalized)) {
    throw new TypeError("Workspace settings merge must normalize to an object");
  }
  const serialized = JSON.stringify(normalized);
  // Fast pre-filter: an individual patch this large can never merge under the
  // bound, so reject it before touching the database. The merged-document limit
  // itself is enforced atomically inside each adapter's single upsert.
  if (new TextEncoder().encode(serialized).byteLength > MAX_WORKSPACE_SETTINGS_DOCUMENT_BYTES) {
    throw new TypeError(WORKSPACE_SETTINGS_PATCH_TOO_LARGE_MESSAGE);
  }
  return Object.freeze({
    keys: Object.freeze([...keys]),
    serialized,
  });
}
