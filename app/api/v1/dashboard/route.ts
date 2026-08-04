import { env } from "cloudflare:workers";
import { getConnectionScope } from "../../../lib/google-oauth-sites";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1UserPreferencesRepository } from "../../../adapters/d1/user-preferences-repository";
import { normalizeUserDisplayTimezone } from "../../../domain/user-preferences";
import { requireOfficeUser } from "../../../lib/workspace-auth";
import { defaultUserSettingsPreferences } from "../../../lib/user-settings";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { dashboardData } from "../../../application/dashboard-data";
import { noStoreJson as noStore } from "../../../lib/no-store-json";

/** Live, persisted dashboard totals. This endpoint never substitutes demo values. */
export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;

  await ensureWorkspaceSchema();
  const generatedAt = Date.now();
  const preferences = await createD1UserPreferencesRepository(env.DB as unknown as D1Database)
    .findByEmail(auth.user.email);
  const timeZone = normalizeUserDisplayTimezone(preferences?.displayTimezone)
    ?? defaultUserSettingsPreferences().displayTimezone;

  const google = getConnectionScope();
  const dashboard = await dashboardData(env.DB, { now: generatedAt, timeZone, simulation: google.simulation });

  return noStore({
    generatedAt,
    ...dashboard,
    readiness: {
      scheduleDataAvailable: false,
      scheduleReason: "Worker, crew, shift, and assignment source records have not been implemented yet.",
      reportsUseLiveProjectLeadTotals: true,
    },
  });
}
