import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { parseLaunchChecklistUpdate } from "../../../../domain/launch-checklist";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import {
  readSitesLaunchChecklist,
  saveSitesLaunchChecklist,
} from "../../../../lib/launch-checklist-sites";
import { noStoreJson as json, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

export const MAX_LAUNCH_CHECKLIST_BODY_BYTES = 4_000;

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  return json(await readSitesLaunchChecklist(
    env.DB as unknown as D1Database,
    auth.user.isAdmin,
  ));
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_LAUNCH_CHECKLIST_BODY_BYTES,
    invalidMessage: "Send one valid launch-checklist update.",
    tooLargeMessage: "Launch-checklist update is too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const update = parseLaunchChecklistUpdate(parsed.body);
  if (!update) {
    return json({ error: "Send one valid launch-checklist update." }, 400);
  }

  return json(await saveSitesLaunchChecklist(
    env.DB as unknown as D1Database,
    update,
    auth.user.email,
    Date.now(),
  ));
}
