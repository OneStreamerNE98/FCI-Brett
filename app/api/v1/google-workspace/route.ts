import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
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
    ["FCI administrator allowlist", (env as unknown as Record<string, string | undefined>).FCI_ADMIN_EMAILS],
  ];
  const missing = [
    ...requirements.filter(([, value]) => !value).map(([label]) => label),
  ];
  const credentialsPresent = google.oauthReady && Boolean((env as unknown as Record<string, string | undefined>).FCI_ADMIN_EMAILS);
  return NextResponse.json({
    configured: credentialsPresent,
    credentialsPresent,
    connected: connection.connected,
    missing,
    workspace: {
      mode: workspace.mode,
      runtimeMode: google.environment,
      simulation: google.simulation,
      storageLabel: workspace.storageLabel,
      storageName: workspace.storageName,
      storageConfigured: Boolean(workspace.rootFolderId),
      connectionKey: google.connectionKey,
      connectionStatus: connection.status,
      connectionAccount: connection.account,
      driveConnected: connection.services.drive,
      gmailConnected: connection.services.gmail,
      calendarConnected: connection.services.calendar,
      sheetsConnected: connection.services.sheets,
      requiresReauthorization: connection.requiresReauthorization,
      provisioningEnabled: google.provisioningEnabled,
      gmailEnabled: google.gmailEnabled,
      calendarEnabled: google.calendarEnabled,
      sheetsEnabled: google.sheetsEnabled,
      clientDirectorySheetConfigured: google.simulation || Boolean(google.clientDirectorySheetId),
      clientDirectorySheetIdInvalid: google.clientDirectorySheetIdInvalid,
      enabledServices: google.enabledServices,
      broadScopeAcknowledged: google.broadScopeAcknowledged,
    },
    blueprint: DRIVE_BLUEPRINT,
    requiredEnvironment: requirements.map(([label]) => label),
    nextStep: google.simulation ? "Local Workspace simulation is ready. No Google account is connected and no data is sent to Google." : connection.requiresReauthorization ? "Reconnect the approved Workspace account and approve every selected service." : connection.connected ? "Google Workspace services are connected." : credentialsPresent ? "An FCI administrator can now connect Google Workspace." : "Add the missing Workspace configuration values before authorizing Google.",
  });
}

export async function POST(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { clientCode?: string; clientName?: string; projectNumber?: string; projectName?: string };
  if (!body.clientCode || !body.clientName || !body.projectNumber || !body.projectName) return NextResponse.json({ error: "client and project details are required" }, { status: 400 });
  return NextResponse.json({ plan: buildProjectFolderPlan(body) });
}
