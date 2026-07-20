import { NextRequest, NextResponse } from "next/server";
import { disconnectGoogleConnection, getGoogleConnectionStatus, getGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  return NextResponse.json({ runtimeMode: config.environment, simulation: config.simulation, connection: await getGoogleConnectionStatus(config), enabledServices: config.enabledServices });
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
  return NextResponse.json({ disconnected: true, revocationRequested: result.revocationRequested });
}
