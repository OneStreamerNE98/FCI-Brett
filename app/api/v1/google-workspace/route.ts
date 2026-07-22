import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { buildProjectFolderPlan, DRIVE_BLUEPRINT } from "../../../lib/google-workspace";
import { getEffectiveGoogleRuntimeSetup, getGoogleConnectionStatus } from "../../../lib/google-oauth-sites";
import { readGoogleChatPublicConfig } from "../../../lib/google-chat-notifier-sites";
import { requireOfficeUser } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";

const MAX_FOLDER_PLAN_BODY_BYTES = 8_000;

function folderPlanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const google = (await getEffectiveGoogleRuntimeSetup()).config;
  const workspace = google.drive;
  const [connection, chatNotifications] = await Promise.all([
    getGoogleConnectionStatus(google),
    readGoogleChatPublicConfig(),
  ]);
  const adminAllowlist = (env as unknown as Record<string, string | undefined>).FCI_ADMIN_EMAILS;
  const missingDetails = [
    ...google.missingDetails,
    ...chatNotifications.missingDetails,
    ...(!adminAllowlist ? [{ label: "FCI administrator allowlist", envVar: "FCI_ADMIN_EMAILS", secret: false }] : []),
  ];
  const missing = missingDetails.map((detail) => detail.label);
  const adminAllowlistPresent = Boolean(adminAllowlist);
  const credentialsPresent = google.connectReady && adminAllowlistPresent;
  const configured = google.oauthReady && adminAllowlistPresent;
  return NextResponse.json({
    configured,
    credentialsPresent,
    connected: connection.connected,
    missing,
    missingDetails,
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
    requiredEnvironment: missingDetails.map((detail) => detail.label),
    nextStep: google.simulation ? "Local Workspace simulation is ready. No Google account is connected and no data is sent to Google." : connection.requiresReauthorization ? "Reconnect the approved Workspace account and approve every selected service." : connection.connected ? "Google Workspace services are connected." : credentialsPresent ? "An FCI administrator can now connect Google Workspace." : "Add the missing Workspace configuration values before authorizing Google.",
  });
}

export async function POST(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_FOLDER_PLAN_BODY_BYTES,
    invalidMessage: "Client and project details must be valid JSON.",
    tooLargeMessage: "Client and project details are too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = {
    clientCode: folderPlanText(parsed.body.clientCode, 80),
    clientName: folderPlanText(parsed.body.clientName, 180),
    projectNumber: folderPlanText(parsed.body.projectNumber, 80),
    projectName: folderPlanText(parsed.body.projectName, 180),
  };
  const { clientCode, clientName, projectNumber, projectName } = body;
  if (!clientCode || !clientName || !projectNumber || !projectName) return NextResponse.json({ error: "client and project details are required" }, { status: 400 });
  return NextResponse.json({ plan: buildProjectFolderPlan({ clientCode, clientName, projectNumber, projectName }) });
}
