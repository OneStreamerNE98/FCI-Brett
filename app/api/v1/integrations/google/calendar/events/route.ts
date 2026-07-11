import { NextRequest, NextResponse } from "next/server";
import { GoogleIntegrationError, getGoogleRuntimeConfig } from "../../../../../../lib/google-oauth";
import { listTestCalendarEvents } from "../../../../../../lib/google-calendar-client";
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
  if (config.environment !== "test") {
    return noStore({ error: "Calendar testing is available only in the isolated personal test profile." }, { status: 403 });
  }
  if (!config.calendarEnabled) {
    return noStore({ error: "Enable Calendar for the personal test profile and reconnect Google before testing Calendar." }, { status: 409 });
  }

  try {
    return noStore(await listTestCalendarEvents(config, auth.user.email));
  } catch (error) {
    if (error instanceof GoogleIntegrationError) {
      return noStore({ error: error.message, code: error.code }, { status: error.status });
    }
    return noStore({ error: "The test Calendar could not be read. Try again." }, { status: 503 });
  }
}
