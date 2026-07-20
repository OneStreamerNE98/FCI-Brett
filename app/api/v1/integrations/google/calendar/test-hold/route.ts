import { NextRequest, NextResponse } from "next/server";
import { GoogleIntegrationError, getGoogleRuntimeConfig } from "../../../../../../lib/google-oauth-sites";
import { createWorkspaceCalendarHold } from "../../../../../../lib/google-calendar-sites";
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
  const config = getGoogleRuntimeConfig();
  if (!config.calendarEnabled) {
    return noStore({ error: "Enable Calendar for the Google Workspace connection before testing appointments." }, { status: 409 });
  }
  if (!config.oauthReady) {
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

  try {
    const start = parseStart(body.start);
    return noStore({ event: config.simulation ? await createSimulationCalendarHold(start) : await createWorkspaceCalendarHold(config, auth.user.email, start), simulated: config.simulation }, { status: 201 });
  } catch (error) {
    if (error instanceof GoogleIntegrationError) {
      return noStore({ error: error.message, code: error.code }, { status: error.status });
    }
    return noStore({ error: "The Workspace Calendar hold could not be created. Check Calendar before retrying." }, { status: 503 });
  }
}
