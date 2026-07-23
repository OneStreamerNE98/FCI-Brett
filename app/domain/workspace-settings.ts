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
  crewReminderHours: number;
  inboxReviewMode: "review-first";
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
  crewReminderHours: 24,
  inboxReviewMode: "review-first",
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
    crewReminderHours: cleanHours(
      input.crewReminderHours,
      DEFAULT_WORKSPACE_PREFERENCES.crewReminderHours,
    ),
    inboxReviewMode: "review-first",
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
