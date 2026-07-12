import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";

const WORKSPACE_SETTINGS_ID = "workspace";

export type WorkspacePreferences = {
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
};

const defaults: WorkspacePreferences = {
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
};

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

function cleanCalendarMode(value: unknown): WorkspacePreferences["calendarSetupMode"] {
  return value === "use-existing" ? "use-existing" : "create-shared";
}

function cleanOptionalText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
}

function normalizeSettings(value: unknown): WorkspacePreferences {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    timezone: cleanText(input.timezone, defaults.timezone, 80),
    appointmentCalendarName: cleanText(input.appointmentCalendarName, defaults.appointmentCalendarName, 120),
    fieldCalendarName: cleanText(input.fieldCalendarName, defaults.fieldCalendarName, 120),
    calendarSetupMode: cleanCalendarMode(input.calendarSetupMode),
    appointmentCalendarId: cleanOptionalText(input.appointmentCalendarId, 320),
    fieldCalendarId: cleanOptionalText(input.fieldCalendarId, 320),
    calendarEditPolicy: "app-authoritative",
    appointmentReminderHours: cleanHours(input.appointmentReminderHours, defaults.appointmentReminderHours),
    crewReminderHours: cleanHours(input.crewReminderHours, defaults.crewReminderHours),
    inboxReviewMode: "review-first",
    officeNotificationEmail: cleanEmail(input.officeNotificationEmail),
  };
}

async function readSettings() {
  const row = await env.DB.prepare("SELECT settings_json, updated_at FROM workspace_settings WHERE id = ?").bind(WORKSPACE_SETTINGS_ID).first<{ settings_json: string; updated_at: number }>();
  if (!row) return { settings: defaults, updatedAt: null };
  try {
    return { settings: normalizeSettings(JSON.parse(row.settings_json)), updatedAt: row.updated_at };
  } catch {
    return { settings: defaults, updatedAt: row.updated_at };
  }
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  return NextResponse.json(await readSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Send a valid settings object." }, { status: 400 });
  }
  const settings = normalizeSettings(body);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO workspace_settings (id, shared_drive_id, client_directory_sheet_id, intake_mailbox, settings_json, updated_by, updated_at) VALUES (?, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(WORKSPACE_SETTINGS_ID, JSON.stringify(settings), auth.user.email, now)
    .run();
  return NextResponse.json({ settings, updatedAt: now }, { headers: { "Cache-Control": "no-store" } });
}
