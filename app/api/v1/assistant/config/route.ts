import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { parseAssistantConfigurationUpdate } from "../../../../domain/assistant-config";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import {
  readSitesAssistantConfiguration,
  saveSitesAssistantConfiguration,
  AssistantModelValidationError,
} from "../../../../lib/assistant-config-sites";
import { noStoreJson as json, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

export const MAX_ASSISTANT_CONFIG_BODY_BYTES = 8_000;

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
  const update = parseAssistantConfigurationUpdate(parsed.body);
  if (!update) {
    return json({ error: "Send one or more valid AI feature settings." }, 400);
  }

  try {
    const config = await saveSitesAssistantConfiguration(
      env.DB as unknown as D1Database,
      env as unknown as Record<string, string | undefined>,
      update,
      auth.user.email,
      Date.now(),
    );
    return json(config);
  } catch (error) {
    if (error instanceof AssistantModelValidationError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }
}
