import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  type WorkspaceSetupLease,
} from "../../../../../../adapters/d1/workspace-setup-leases";
import { GoogleIntegrationError, getEffectiveGoogleRuntimeSetup, writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth-sites";
import { calendarTestHoldEventId, createWorkspaceCalendarHold } from "../../../../../../lib/google-calendar-sites";
import { calendarHoldCreatedIntegrationEvent } from "../../../../../../lib/google-integration-events";
import { createSimulationCalendarHold } from "../../../../../../lib/workspace-simulation";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

const MINIMUM_LEAD_MS = 5 * 60 * 1000;
const MAXIMUM_LEAD_MS = 14 * 24 * 60 * 60 * 1000;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function nextRoundedHour(now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next.getTime() < now.getTime() + MINIMUM_LEAD_MS) next.setHours(next.getHours() + 1);
  return next;
}

function parseStart(value: unknown, now = new Date()) {
  if (value === undefined) return nextRoundedHour(now);
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) {
    throw new GoogleIntegrationError("invalid_test_hold_start", "Use an ISO timestamp with a timezone for the test hold start.", 400);
  }
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) {
    throw new GoogleIntegrationError("invalid_test_hold_start", "Use a valid ISO timestamp for the test hold start.", 400);
  }
  if (start.getTime() < now.getTime() + MINIMUM_LEAD_MS || start.getTime() > now.getTime() + MAXIMUM_LEAD_MS) {
    throw new GoogleIntegrationError("test_hold_out_of_range", "Choose a test hold start from at least 5 minutes to no more than 14 days from now.", 400);
  }
  return start;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { config } = await getEffectiveGoogleRuntimeSetup();
  if (!config.calendarEnabled) {
    return noStore({ error: "Enable Calendar for the Google Workspace connection before testing appointments." }, { status: 409 });
  }
  if (!config.oauthReady || !config.clientAppointmentsCalendarId) {
    return noStore({ error: "Google Calendar setup is incomplete.", code: "calendar_configuration_required", missing: config.missing }, { status: 409 });
  }

  let body: Record<string, unknown> = {};
  try {
    const rawBody = await request.text();
    if (rawBody.trim()) {
      const parsed = JSON.parse(rawBody) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return noStore({ error: "The test hold request must be a JSON object." }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return noStore({ error: "The test hold request must be valid JSON." }, { status: 400 });
  }
  if (Object.keys(body).some((key) => key !== "start")) {
    return noStore({ error: "Only an optional start timestamp may be supplied for a test hold." }, { status: 400 });
  }

  let lease: WorkspaceSetupLease | null = null;
  try {
    const start = parseStart(body.start);
    const now = Date.now();
    lease = await acquireWorkspaceSetupLease(env.DB, {
      id: crypto.randomUUID(),
      connectionKey: config.connectionKey,
      action: `calendar-test-hold:${await calendarTestHoldEventId(start)}`,
      scopeKey: "calendar-test-hold",
      actor: auth.user.email,
      now,
    });
    if (!lease) {
      return noStore({
        error: "A Calendar test hold request is already in progress. Try again shortly.",
        code: "calendar_test_hold_in_progress",
      }, { status: 409 });
    }

    if (config.simulation) {
      const result = await createSimulationCalendarHold(start);
      if (result.created) {
        const integrationEvent = calendarHoldCreatedIntegrationEvent(result.event);
        await writeGoogleIntegrationEvent(
          config,
          integrationEvent.eventType,
          auth.user.email,
          integrationEvent.entityType,
          integrationEvent.entityId,
          integrationEvent.detail,
        );
      }
      await completeWorkspaceSetupLease(env.DB, lease, Date.now());
      return noStore({ event: result.event, simulated: true }, { status: 201 });
    }
    const event = await createWorkspaceCalendarHold(config, auth.user.email, start);
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return noStore({ event, simulated: false }, { status: 201 });
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(
        env.DB,
        lease,
        error instanceof GoogleIntegrationError ? error.code : "calendar_test_hold_failed",
        Date.now(),
      );
    }
    if (error instanceof GoogleIntegrationError) {
      return noStore({ error: error.message, code: error.code }, { status: error.status });
    }
    return noStore({ error: "The Workspace Calendar hold could not be created. Check Calendar before retrying." }, { status: 503 });
  }
}
