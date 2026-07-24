import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { parseAssistantFeaturesUpdate } from "../../../../domain/assistant-config";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import {
  readSitesAssistantConfiguration,
  saveSitesAssistantFeatures,
} from "../../../../lib/assistant-config-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

export const MAX_ASSISTANT_CONFIG_BODY_BYTES = 8_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function noStoreResponse(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  const config = await readSitesAssistantConfiguration(
    env.DB as unknown as D1Database,
    env as unknown as Record<string, string | undefined>,
  );
  return json(config);
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_ASSISTANT_CONFIG_BODY_BYTES,
    invalidMessage: "Send one or more valid AI feature settings.",
    tooLargeMessage: "AI feature settings update is too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const update = parseAssistantFeaturesUpdate(parsed.body);
  if (!update) {
    return json({ error: "Send one or more valid AI feature settings." }, 400);
  }

  const config = await saveSitesAssistantFeatures(
    env.DB as unknown as D1Database,
    env as unknown as Record<string, string | undefined>,
    update,
    auth.user.email,
    Date.now(),
  );
  return json(config);
}
