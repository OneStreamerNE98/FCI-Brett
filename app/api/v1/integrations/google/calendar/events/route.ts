import { NextRequest, NextResponse } from "next/server";
import { GoogleIntegrationError, getGoogleRuntimeConfig } from "../../../../../../lib/google-oauth";
import { listWorkspaceCalendarEvents } from "../../../../../../lib/google-calendar-client";
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
  const config = getGoogleRuntimeConfig();
  if (!config.calendarEnabled) {
    return noStore({ error: "Enable Calendar for the Google Workspace connection before using appointments." }, { status: 409 });
  }

  try {
    return noStore(config.simulation ? await listSimulationCalendarEvents() : await listWorkspaceCalendarEvents(config, auth.user.email));
  } catch (error) {
    if (error instanceof GoogleIntegrationError) {
      return noStore({ error: error.message, code: error.code }, { status: error.status });
    }
    return noStore({ error: "The Workspace Calendar could not be read. Try again." }, { status: 503 });
  }
}
