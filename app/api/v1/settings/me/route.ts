import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1UserPreferencesRepository } from "../../../../adapters/d1/user-preferences-repository";
import {
  normalizeUserDisplayTimezone,
  normalizeUserReplySignature,
  USER_PREFERENCE_KEYS,
} from "../../../../domain/user-preferences";
import type {
  UserPreferencesRecord,
  UserPreferencesRepository,
} from "../../../../ports/user-preferences-repository";
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

const PREFERENCE_KEYS = new Set<string>(USER_PREFERENCE_KEYS);

type AccountPreferences = UserSettingsPreferences & { pageLayouts: PageLayouts };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function preferencesFromRow(row: UserPreferencesRecord | null, isAdmin: boolean): AccountPreferences {
  if (!row) return { ...defaultUserSettingsPreferences(), pageLayouts: defaultPageLayouts(isAdmin) };
  return {
    displayTimezone: row.displayTimezone || defaultUserSettingsPreferences().displayTimezone,
    replySignature: row.replySignature || "",
    notificationPreferences: parseStoredUserNotificationPreferences(row.notificationPreferencesJson),
    pageLayouts: parseStoredPageLayouts(row.pageLayoutsJson, isAdmin),
  };
}

async function readPreferences(
  repository: UserPreferencesRepository,
  email: string,
  isAdmin: boolean,
) {
  const row = await repository.findByEmail(email);
  return {
    preferences: preferencesFromRow(row, isAdmin),
    updatedAt: row?.updatedAt ?? null,
    storedPageLayoutsJson: row?.pageLayoutsJson ?? null,
  };
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const repository = createD1UserPreferencesRepository(env.DB as unknown as D1Database);
  const account = await readPreferences(repository, auth.user.email, auth.user.isAdmin);
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

  const repository = createD1UserPreferencesRepository(env.DB as unknown as D1Database);
  const current = await readPreferences(repository, auth.user.email, auth.user.isAdmin);
  const preferences = { ...current.preferences };
  let persistedPageLayouts = parseStoredPageLayouts(current.storedPageLayoutsJson, true);

  if (Object.hasOwn(body, "displayTimezone")) {
    const timezone = normalizeUserDisplayTimezone(body.displayTimezone);
    if (!timezone) return NextResponse.json({ error: "displayTimezone must be a valid IANA timezone of 80 characters or fewer." }, { status: 400 });
    preferences.displayTimezone = timezone;
  }
  if (Object.hasOwn(body, "replySignature")) {
    const signature = normalizeUserReplySignature(body.replySignature);
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
  await repository.upsert({
    userEmail: auth.user.email,
    displayTimezone: preferences.displayTimezone,
    replySignature: preferences.replySignature,
    notificationPreferencesJson: JSON.stringify(preferences.notificationPreferences),
    pageLayoutsJson: JSON.stringify(persistedPageLayouts),
    updatedAt: now,
  });
  return NextResponse.json({ preferences, updatedAt: now }, { headers: { "Cache-Control": "no-store" } });
}
