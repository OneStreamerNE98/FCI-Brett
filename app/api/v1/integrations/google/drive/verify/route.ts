import { NextRequest, NextResponse } from "next/server";
import { GoogleDriveClient } from "../../../../../../lib/google-drive";
import { mapGoogleIntegrationError } from "../../../../../../lib/google-integration-error";
import { getGoogleAccessToken, getGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function errorResponse(error: unknown) {
  const mapped = mapGoogleIntegrationError(error, "The Google Drive workspace could not be verified. Try again.");
  return noStore(mapped.body, { status: mapped.status });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  if (!config.oauthReady) return noStore({ error: "Google Drive setup is incomplete.", missing: config.missing }, { status: 409 });
  try {
    if (config.simulation) {
      await writeGoogleIntegrationEvent(config, "drive.simulation_verified", auth.user.email, "workspace", config.connectionKey, "mode=simulation");
      return noStore({ verified: true, simulated: true, workspace: { name: config.drive.storageName, url: null, runtimeMode: config.environment } });
    }
    const drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
    const root = await drive.verifyRootFolder();
    await writeGoogleIntegrationEvent(config, "drive.root_verified", auth.user.email, "workspace", root.id, "mode=workspace");
    return noStore({ verified: true, workspace: { name: root.name, url: root.url, runtimeMode: config.environment } });
  } catch (error) {
    return errorResponse(error);
  }
}
