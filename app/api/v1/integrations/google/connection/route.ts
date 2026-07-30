import { NextRequest } from "next/server";
import { disconnectGoogleConnection, getGoogleConnectionStatus, getGoogleRuntimeConfig } from "../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";
import { noStoreJson as noStore, noStoreResponse } from "../../../../../lib/no-store-json";
import { parseBoundedJsonObject } from "../../../../../lib/api-json-body";

const DISCONNECT_BODY_LIMIT = 256;

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  return noStore({ runtimeMode: config.environment, simulation: config.simulation, connection: await getGoogleConnectionStatus(config), enabledServices: config.enabledServices });
}

export async function DELETE(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const parsed = request.body
    ? await parseBoundedJsonObject(request, {
        maximumBytes: DISCONNECT_BODY_LIMIT,
        invalidMessage: "Provide an empty JSON object to disconnect Google Workspace.",
        tooLargeMessage: "The disconnect request is too large.",
      })
    : { ok: true as const, body: {} };
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  if (Object.keys(parsed.body).length > 0) {
    return noStore({ error: "The disconnect request does not accept any fields." }, { status: 400 });
  }
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  const result = await disconnectGoogleConnection(config, auth.user.email);
  return noStore({
    disconnected: true,
    revocationRequested: result.revocationRequested,
    providerRevocation: result.providerRevocation,
  });
}
