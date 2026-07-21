import { NextRequest, NextResponse } from "next/server";

import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import { parseGoogleChatRoutingUpdate } from "../../../../../../lib/google-chat-notifier";
import {
  readGoogleChatPublicConfig,
  saveSitesGoogleChatRouting,
} from "../../../../../../lib/google-chat-notifier-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";

export const MAX_GOOGLE_CHAT_CONFIG_BODY_BYTES = 8_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = await readGoogleChatPublicConfig();
  return json({ ...config, canEdit: auth.user.isAdmin });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_GOOGLE_CHAT_CONFIG_BODY_BYTES,
    invalidMessage: "Send the exact Google Chat notification routing catalog.",
    tooLargeMessage: "Google Chat notification settings are too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const routing = parseGoogleChatRoutingUpdate(parsed.body);
  if (!routing) return json({ error: "Send the exact Google Chat notification routing catalog." }, 400);

  const config = await saveSitesGoogleChatRouting(routing, auth.user.email);
  return json({ ...config, canEdit: true });
}
