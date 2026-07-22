import { NextRequest, NextResponse } from "next/server";
import { GoogleIntegrationError, getEffectiveGoogleRuntimeSetup, writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth-sites";
import { listWorkspaceCalendarEvents } from "../../../../../../lib/google-calendar-sites";
import { calendarEventsListedIntegrationEvent } from "../../../../../../lib/google-integration-events";
import { listSimulationCalendarEvents } from "../../../../../../lib/workspace-simulation";
import { requireOfficeUser } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

export const dynamic = "force-dynamic";

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { config } = await getEffectiveGoogleRuntimeSetup();
  if (!config.calendarEnabled) {
    return noStore({ error: "Enable Calendar for the Google Workspace connection before using appointments." }, { status: 409 });
  }
  if (!config.oauthReady || !config.clientAppointmentsCalendarId) {
    return noStore({ error: "Google Calendar setup is incomplete.", code: "calendar_configuration_required", missing: config.missing }, { status: 409 });
  }

  try {
    if (config.simulation) {
      const result = await listSimulationCalendarEvents();
      const event = calendarEventsListedIntegrationEvent(
        config.clientAppointmentsCalendarId,
        result.window,
        result.events.length,
      );
      await writeGoogleIntegrationEvent(
        config,
        event.eventType,
        auth.user.email,
        event.entityType,
        event.entityId,
        event.detail,
      );
      return noStore(result);
    }
    return noStore(await listWorkspaceCalendarEvents(config, auth.user.email));
  } catch (error) {
    if (error instanceof GoogleIntegrationError) {
      return noStore({ error: error.message, code: error.code }, { status: error.status });
    }
    return noStore({ error: "The Workspace Calendar could not be read. Try again." }, { status: 503 });
  }
}
