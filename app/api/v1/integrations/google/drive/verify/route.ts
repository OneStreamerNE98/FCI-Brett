import { NextRequest } from "next/server";
import { GoogleDriveClient } from "../../../../../../lib/google-drive";
import { googleIntegrationErrorResponse } from "../../../../../../lib/google-integration-error";
import { getEffectiveGoogleRuntimeSetup, getGoogleAccessToken, writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { noStoreJson as noStore, noStoreResponse } from "../../../../../../lib/no-store-json";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { config } = await getEffectiveGoogleRuntimeSetup();
  if (!config.connectReady || !config.drive.rootFolderId) return noStore({ error: "Adopt the Shared Drive before verifying it.", missing: config.missing }, { status: 409 });
  try {
    if (config.simulation) {
      await writeGoogleIntegrationEvent(config, "drive.simulation_verified", auth.user.email, "workspace", config.connectionKey, "mode=simulation");
      return noStore({ verified: true, simulated: true, workspace: { name: config.drive.storageName, url: null, runtimeMode: config.environment } });
    }
    const drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
    const root = await drive.verifyRootFolder();
    await writeGoogleIntegrationEvent(config, "drive.root_verified", auth.user.email, "workspace", root.id, "mode=workspace");
    return noStore({ verified: true, simulated: false, workspace: { name: root.name, url: root.url, runtimeMode: config.environment } });
  } catch (error) {
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Google Drive workspace could not be verified. Try again."));
  }
}
