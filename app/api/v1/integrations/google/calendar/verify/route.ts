import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import { upsertWorkspaceResource } from "../../../../../../adapters/d1/workspace-resources";
import type { D1Database } from "../../../../../../adapters/d1/d1-database";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../adapters/d1/workspace-setup-leases";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import { GoogleCalendarClient } from "../../../../../../lib/google-calendar-client";
import { googleIntegrationErrorResponse } from "../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
} from "../../../../../../lib/google-oauth-sites";
import { noStoreJson as noStore, noStoreResponse } from "../../../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

const MAXIMUM_BODY_BYTES = 2_048;
const CALENDAR_KEYS = ["client-appointments", "field-schedule"] as const;
type CalendarKey = (typeof CALENDAR_KEYS)[number];

function calendarKey(value: unknown): CalendarKey | null {
  return typeof value === "string" && CALENDAR_KEYS.includes(value as CalendarKey)
    ? value as CalendarKey
    : null;
}

function calendarId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_024 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAXIMUM_BODY_BYTES,
    invalidMessage: "Send a valid calendar verification request.",
    tooLargeMessage: "The calendar verification request is too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const resourceKey = calendarKey(parsed.body.calendarKey);
  const externalId = calendarId(parsed.body.calendarId);
  if (!resourceKey || !externalId || Object.keys(parsed.body).some((key) => key !== "calendarKey" && key !== "calendarId")) {
    return noStore({ error: "Choose a supported calendar and provide its Calendar ID." }, { status: 400 });
  }

  const { config } = await getEffectiveGoogleRuntimeSetup();
  if (!config.calendarEnabled || !config.connectReady) {
    return noStore({ error: "Complete the Google Workspace connection before verifying calendars.", code: "calendar_configuration_required" }, { status: 409 });
  }
  if (config.simulation) {
    return noStore({ verified: true, simulated: true, calendar: { key: resourceKey, id: externalId, name: "Simulated Workspace calendar", timeZone: null, url: null } });
  }

  const database = env.DB as unknown as D1Database;
  let lease: WorkspaceSetupLease | null = null;
  try {
    const calendar = new GoogleCalendarClient(
      await getGoogleAccessToken(config, "calendar"),
      config,
    );
    const metadata = await calendar.getCalendarMetadata(externalId);
    if (!metadata) return noStore({ error: "The specified Workspace calendar could not be found.", code: "calendar_not_found" }, { status: 404 });
    const now = Date.now();
    lease = await acquireWorkspaceSetupLease(database, {
      id: crypto.randomUUID(),
      connectionKey: config.workspaceConnectionKey,
      action: `calendar-verify-${resourceKey}`,
      scopeKey: `calendar-verify:${resourceKey}`,
      actor: auth.user.email,
      now,
      connectionFence: googleConnectionLeaseFence(config),
    });
    if (!lease) {
      return noStore({
        error: "The Google connection changed or this calendar is already being verified. Try again.",
        code: "calendar_verify_in_progress",
      }, { status: 409 });
    }
    await upsertWorkspaceResource(env.DB, {
      id: crypto.randomUUID(),
      connectionKey: config.connectionKey,
      resourceType: "calendar.calendar",
      resourceKey,
      externalId: metadata.id,
      externalUrl: metadata.url,
      origin: "adopted",
      metadata: { name: metadata.name, timeZone: metadata.timeZone },
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
    });
    await completeWorkspaceSetupLease(database, lease, Date.now());
    lease = null;
    return noStore({ verified: true, simulated: false, calendar: { key: resourceKey, ...metadata } });
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(database, lease, "calendar_verify_failed", Date.now());
    }
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Workspace calendar could not be verified. Try again."));
  }
}
