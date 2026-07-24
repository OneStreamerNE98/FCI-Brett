import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth-sites";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { dashboardData } from "../../../application/dashboard-data";

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Live, persisted dashboard totals. This endpoint never substitutes demo values. */
export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;

  await ensureWorkspaceSchema();
  const google = getGoogleRuntimeConfig();

  const dashboard = await dashboardData(env.DB, google.connectionKey);

  return noStore({
    generatedAt: Date.now(),
    ...dashboard,
    readiness: {
      scheduleDataAvailable: false,
      scheduleReason: "Worker, crew, shift, and assignment source records have not been implemented yet.",
      reportsUseLiveProjectLeadTotals: true,
    },
  });
}
