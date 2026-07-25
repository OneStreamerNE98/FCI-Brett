import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1UserPreferencesRepository } from "../../../../adapters/d1/user-preferences-repository";
import { assembleToday } from "../../../../application/assistant/today";
import { normalizeUserDisplayTimezone } from "../../../../domain/user-preferences";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { defaultUserSettingsPreferences } from "../../../../lib/user-settings";
import { requireOfficeUser } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);

  await ensureWorkspaceSchema();
  const database = env.DB as unknown as D1Database;
  const preferences = await createD1UserPreferencesRepository(database)
    .findByEmail(auth.user.email);
  const timeZone = normalizeUserDisplayTimezone(preferences?.displayTimezone)
    ?? defaultUserSettingsPreferences().displayTimezone;
  const today = await assembleToday(database, {
    now: Date.now(),
    timeZone,
  });

  return noStoreJson(today);
}
