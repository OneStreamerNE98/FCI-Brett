import { NextRequest, NextResponse } from "next/server";
import { buildProjectFolderPlan, DRIVE_BLUEPRINT } from "../../../lib/google-workspace";
import { getGoogleConnectionStatus, getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { requireOfficeUser } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const google = getGoogleRuntimeConfig();
  const workspace = google.drive;
  const connection = await getGoogleConnectionStatus(google);
  const requirements = [
    ...google.missing.map((label) => [label, undefined] as const),
    ["FCI administrator allowlist", process.env.FCI_ADMIN_EMAILS],
  ];
  const missing = [
    ...requirements.filter(([, value]) => !value).map(([label]) => label),
  ];
  const credentialsPresent = google.oauthReady && Boolean(process.env.FCI_ADMIN_EMAILS);
  return NextResponse.json({
    configured: credentialsPresent,
    credentialsPresent,
    connected: connection.connected,
    missing,
    workspace: {
      mode: workspace.mode,
      storageLabel: workspace.storageLabel,
      storageName: workspace.storageName,
      temporary: workspace.isTemporary,
      storageConfigured: Boolean(workspace.rootFolderId),
      environment: google.environment,
      connectionKey: google.connectionKey,
      connectionStatus: connection.status,
      connectionAccount: connection.account,
      provisioningEnabled: google.provisioningEnabled,
      gmailFilingEnabled: google.gmailFilingEnabled,
      broadScopeAcknowledged: google.broadScopeAcknowledged,
    },
    blueprint: DRIVE_BLUEPRINT,
    requiredEnvironment: requirements.map(([label]) => label),
    nextStep: connection.connected ? "Drive is connected for the active profile. Gmail, Calendar, and email filing remain disabled." : credentialsPresent ? "An FCI administrator can now connect the approved Google account for the active profile." : "Add the missing active-profile configuration values before authorizing Google Drive.",
  });
}

export async function POST(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { clientCode?: string; clientName?: string; projectNumber?: string; projectName?: string };
  if (!body.clientCode || !body.clientName || !body.projectNumber || !body.projectName) return NextResponse.json({ error: "client and project details are required" }, { status: 400 });
  return NextResponse.json({ plan: buildProjectFolderPlan(body) });
}
