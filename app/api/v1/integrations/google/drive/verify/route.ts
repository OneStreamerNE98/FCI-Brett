import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../../../adapters/d1/d1-database";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../adapters/d1/workspace-setup-leases";
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
  const database = env.DB as unknown as D1Database;
  let lease: WorkspaceSetupLease | null = null;
  if (!config.connectReady || !config.drive.rootFolderId) return noStore({ error: "Adopt the Shared Drive before verifying it.", missing: config.missing }, { status: 409 });
  try {
    if (config.simulation) {
      await writeGoogleIntegrationEvent(config, "drive.simulation_verified", auth.user.email, "workspace", config.connectionKey, "mode=simulation");
      return noStore({ verified: true, simulated: true, workspace: { name: config.drive.storageName, url: null, runtimeMode: config.environment } });
    }
    const drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
    const root = await drive.verifyRootFolder();
    lease = await acquireWorkspaceSetupLease(database, {
      id: crypto.randomUUID(),
      connectionKey: config.workspaceConnectionKey,
      action: "drive-verify",
      scopeKey: "drive-verify",
      actor: auth.user.email,
      now: Date.now(),
      connectionFence: googleConnectionLeaseFence(config),
    });
    if (!lease) {
      return noStore({
        error: "The Google connection changed or the Drive workspace is already being verified. Try again.",
        code: "drive_verify_in_progress",
      }, { status: 409 });
    }
    await writeGoogleIntegrationEvent(config, "drive.root_verified", auth.user.email, "workspace", root.id, "mode=workspace");
    await completeWorkspaceSetupLease(database, lease, Date.now());
    lease = null;
    return noStore({ verified: true, simulated: false, workspace: { name: root.name, url: root.url, runtimeMode: config.environment } });
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(database, lease, "drive_verify_failed", Date.now());
    }
    return noStoreResponse(googleIntegrationErrorResponse(error, "The Google Drive workspace could not be verified. Try again."));
  }
}
