import { NextRequest, NextResponse } from "next/server";
import { GoogleDriveClient } from "../../../../../../lib/google-drive";
import { getGoogleAccessToken, getGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  if (!config.oauthReady) return NextResponse.json({ error: "Google Drive setup is incomplete.", missing: config.missing }, { status: 409 });
  const drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
  const root = await drive.verifyRootFolder();
  await writeGoogleIntegrationEvent(config, "drive.root_verified", auth.user.email, "workspace", root.id, `environment=${config.environment}`);
  return NextResponse.json({ verified: true, workspace: { name: root.name, url: root.url, environment: config.environment } });
}
