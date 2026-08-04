import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { buildProjectFolderPlan } from "../../../lib/google-workspace";
import { getEffectiveGoogleRuntimeSetup, getGoogleConnectionStatus } from "../../../lib/google-oauth-sites";
import { readGoogleChatPublicConfig } from "../../../lib/google-chat-notifier-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { googleIntegrationErrorResponse } from "../../../lib/google-integration-error";
import { noStoreJson as noStore, noStoreResponse } from "../../../lib/no-store-json";

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
  const setup = await getEffectiveGoogleRuntimeSetup();
  const google = setup.config;
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
  return noStore({
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
      provisioningSource: google.effectiveSources.driveProvisioningEnabled,
      // Same channel and shape as provisioningSource above: the Gmail intake row is an
      // App-managed configuration row like its siblings, so it names its effective source
      // (SET-13 `app|env|none`) instead of leaving the operator to guess whether the saved
      // value or the hosted fallback is in force.
      intakeMailboxSource: google.effectiveSources.intakeMailbox,
      gmailEnabled: google.gmailEnabled,
      calendarEnabled: google.calendarEnabled,
      // `source` alone cannot say which value is in force: the resolver maps BOTH an adopted
      // `workspace_resources` row and the saved `workspace_settings` value to "app"
      // (workspace-effective-config.ts:140-149), and the registry row silently outranks the
      // saved one. Return the resolved id too, so the panel can show what runtime actually
      // uses instead of inferring it from a label that cannot distinguish the two. A calendar
      // ID is not a credential and this route's audience already sees the saved value.
      calendars: {
        clientAppointments: {
          configured: Boolean(setup.effectiveResources.clientAppointmentsCalendar.externalId),
          source: setup.effectiveResources.clientAppointmentsCalendar.source,
          externalId: setup.effectiveResources.clientAppointmentsCalendar.externalId ?? null,
        },
        fieldSchedule: {
          configured: Boolean(setup.effectiveResources.fieldScheduleCalendar.externalId),
          source: setup.effectiveResources.fieldScheduleCalendar.source,
          externalId: setup.effectiveResources.fieldScheduleCalendar.externalId ?? null,
        },
      },
      sheetsEnabled: google.sheetsEnabled,
      clientDirectorySheetConfigured: google.simulation || Boolean(google.clientDirectorySheetId),
      clientDirectorySheetIdInvalid: google.clientDirectorySheetIdInvalid,
      sheets: {
        clientDirectory: {
          configured: Boolean(setup.effectiveResources.clientDirectorySheet.externalId),
          source: setup.effectiveResources.clientDirectorySheet.source,
          externalId: setup.effectiveResources.clientDirectorySheet.externalId ?? null,
        },
        leadFormResponses: {
          configured: Boolean(setup.effectiveResources.leadFormResponseSheet.externalId),
          source: setup.effectiveResources.leadFormResponseSheet.source,
          externalId: setup.effectiveResources.leadFormResponseSheet.externalId ?? null,
        },
      },
      enabledServices: google.enabledServices,
      broadScopeAcknowledged: google.broadScopeAcknowledged,
    },
    // The persisted blueprint is the admin-edited tenant configuration document — business
    // name, naming patterns, and the whole folder/spreadsheet/template/calendar layout — and
    // every other route that returns it is admin-gated. This route is only `requireOfficeUser`
    // and is fetched by a non-admin-reachable page, so the document is admin-only here too.
    // No client consumer reads this field (the blueprint editor uses the admin-gated
    // /integrations/google/setup/blueprint route), so non-admins get no substitute for it.
    ...(auth.user.isAdmin ? { blueprint: setup.blueprint } : {}),
    requiredEnvironment: missingDetails.map((detail) => detail.label),
    nextStep: google.simulation ? "Local Workspace simulation is ready. No Google account is connected and no data is sent to Google." : connection.requiresReauthorization ? "Reconnect the approved Workspace account and approve every selected service." : connection.connected ? "Google Workspace services are connected." : credentialsPresent ? "An FCI administrator can now connect Google Workspace." : "Add the missing Workspace configuration values before authorizing Google.",
  });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_FOLDER_PLAN_BODY_BYTES,
    invalidMessage: "Client and project details must be valid JSON.",
    tooLargeMessage: "Client and project details are too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const body = {
    clientCode: folderPlanText(parsed.body.clientCode, 80),
    clientName: folderPlanText(parsed.body.clientName, 180),
    projectNumber: folderPlanText(parsed.body.projectNumber, 80),
    projectName: folderPlanText(parsed.body.projectName, 180),
  };
  const { clientCode, clientName, projectNumber, projectName } = body;
  if (!clientCode || !clientName || !projectNumber || !projectName) return noStore({ error: "client and project details are required" }, { status: 400 });
  await ensureWorkspaceSchema();
  const { blueprint } = await getEffectiveGoogleRuntimeSetup();
  try {
    return noStore({ plan: buildProjectFolderPlan({ blueprint, clientCode, clientName, projectNumber, projectName }) });
  } catch (error) {
    // A blueprint missing the client-accounts or projects root is a saved-state problem the
    // owner can fix, so it has to surface as the same typed 409 the provisioning routes give
    // rather than an unhandled 500.
    return noStoreResponse(googleIntegrationErrorResponse(error, "The project folder preview could not be built. Try again."));
  }
}
