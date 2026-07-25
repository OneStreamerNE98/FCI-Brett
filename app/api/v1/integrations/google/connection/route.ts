import { NextRequest } from "next/server";
import { disconnectGoogleConnection, getGoogleConnectionStatus, getGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";
import { noStoreJson as noStore } from "../../../../../lib/no-store-json";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  return noStore({ runtimeMode: config.environment, simulation: config.simulation, connection: await getGoogleConnectionStatus(config), enabledServices: config.enabledServices });
}

export async function DELETE(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  const result = await disconnectGoogleConnection(config);
  await writeGoogleIntegrationEvent(config, "oauth.disconnected", auth.user.email, "connection", config.connectionKey, `mode=${config.environment};google_revocation=${result.revocationRequested ? "requested" : "not-confirmed"}`);
  return noStore({ disconnected: true, revocationRequested: result.revocationRequested });
}
