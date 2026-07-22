import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import {
  defaultUserSettingsPreferences,
  normalizeUserNotificationPreferences,
  parseStoredUserNotificationPreferences,
  type UserSettingsPreferences,
} from "../../../../lib/user-settings";
import {
  defaultPageLayouts,
  mergePageLayoutsForWrite,
  normalizePageLayoutsForRead,
  normalizePageLayoutsForWrite,
  parseStoredPageLayouts,
  type PageLayouts,
} from "../../../../lib/page-layouts";

const MAX_ACCOUNT_PREFERENCES_BODY_BYTES = 8_000;

const PREFERENCE_KEYS = new Set(["displayTimezone", "replySignature", "notificationPreferences", "pageLayouts"]);

type AccountPreferences = UserSettingsPreferences & { pageLayouts: PageLayouts };

type PreferenceRow = {
  display_timezone: string;
  reply_signature: string;
  notification_preferences_json: string;
  page_layouts_json: string;
  updated_at: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function preferencesFromRow(row: PreferenceRow | null, isAdmin: boolean): AccountPreferences {
  if (!row) return { ...defaultUserSettingsPreferences(), pageLayouts: defaultPageLayouts(isAdmin) };
  return {
    displayTimezone: row.display_timezone || defaultUserSettingsPreferences().displayTimezone,
    replySignature: row.reply_signature || "",
    notificationPreferences: parseStoredUserNotificationPreferences(row.notification_preferences_json),
    pageLayouts: parseStoredPageLayouts(row.page_layouts_json, isAdmin),
  };
}

async function readPreferences(email: string, isAdmin: boolean) {
  const row = await env.DB.prepare("SELECT display_timezone, reply_signature, notification_preferences_json, page_layouts_json, updated_at FROM user_preferences WHERE user_email = ?")
    .bind(email)
    .first<PreferenceRow>();
  return { preferences: preferencesFromRow(row, isAdmin), updatedAt: row?.updated_at ?? null, storedPageLayoutsJson: row?.page_layouts_json ?? null };
}

function normalizeTimezone(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 80 || /[\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    return Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function normalizeSignature(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\r\n?/g, "\n");
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const account = await readPreferences(auth.user.email, auth.user.isAdmin);
  return NextResponse.json({ preferences: account.preferences, updatedAt: account.updatedAt, isAdmin: auth.user.isAdmin }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_ACCOUNT_PREFERENCES_BODY_BYTES,
    invalidMessage: "Send one or more valid account preference fields.",
    tooLargeMessage: "Account preference update is too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.body;
  if (!isRecord(body) || Object.keys(body).length === 0 || Object.keys(body).some((key) => !PREFERENCE_KEYS.has(key))) {
    return NextResponse.json({ error: "Send one or more valid account preference fields." }, { status: 400 });
  }

  const current = await readPreferences(auth.user.email, auth.user.isAdmin);
  const preferences = { ...current.preferences };
  let persistedPageLayouts = parseStoredPageLayouts(current.storedPageLayoutsJson, true);

  if (Object.hasOwn(body, "displayTimezone")) {
    const timezone = normalizeTimezone(body.displayTimezone);
    if (!timezone) return NextResponse.json({ error: "displayTimezone must be a valid IANA timezone of 80 characters or fewer." }, { status: 400 });
    preferences.displayTimezone = timezone;
  }
  if (Object.hasOwn(body, "replySignature")) {
    const signature = normalizeSignature(body.replySignature);
    if (signature === null) return NextResponse.json({ error: "replySignature must be text of 2,000 characters or fewer." }, { status: 400 });
    preferences.replySignature = signature;
  }
  if (Object.hasOwn(body, "notificationPreferences")) {
    const notificationPreferences = normalizeUserNotificationPreferences(body.notificationPreferences);
    if (!notificationPreferences) return NextResponse.json({ error: "notificationPreferences must contain the complete supported notification catalog with boolean values." }, { status: 400 });
    preferences.notificationPreferences = notificationPreferences;
  }
  if (Object.hasOwn(body, "pageLayouts")) {
    const pageLayouts = normalizePageLayoutsForWrite(body.pageLayouts, auth.user.isAdmin);
    if (!pageLayouts) return NextResponse.json({ error: "pageLayouts must use only supported Overview and Reports section keys." }, { status: 400 });
    persistedPageLayouts = mergePageLayoutsForWrite(current.storedPageLayoutsJson, pageLayouts, auth.user.isAdmin);
    preferences.pageLayouts = normalizePageLayoutsForRead(persistedPageLayouts, auth.user.isAdmin);
  }
  const now = Date.now();
  await env.DB.prepare("INSERT INTO user_preferences (user_email, display_timezone, reply_signature, notification_preferences_json, page_layouts_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_email) DO UPDATE SET display_timezone = excluded.display_timezone, reply_signature = excluded.reply_signature, notification_preferences_json = excluded.notification_preferences_json, page_layouts_json = excluded.page_layouts_json, updated_at = excluded.updated_at")
    .bind(auth.user.email, preferences.displayTimezone, preferences.replySignature, JSON.stringify(preferences.notificationPreferences), JSON.stringify(persistedPageLayouts), now)
    .run();
  return NextResponse.json({ preferences, updatedAt: now }, { headers: { "Cache-Control": "no-store" } });
}
