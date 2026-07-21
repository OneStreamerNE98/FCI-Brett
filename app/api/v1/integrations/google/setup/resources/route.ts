import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import { listWorkspaceResources } from "../../../../../../adapters/d1/workspace-resources";
import { getEffectiveGoogleRuntimeConfig } from "../../../../../../lib/google-oauth-sites";
import { requireOfficeUser } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

type ConnectionIdentityRow = Readonly<{
  google_email: string;
  status: string;
}>;

const RESOURCE_PRESENTATION = [
  {
    key: "primary",
    resourceType: "drive.shared-drive",
    label: "Shared Drive",
    blueprintName: "FCI Operations",
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeConfig>>) => config.drive.rootFolderId,
  },
  {
    key: "client-directory",
    resourceType: "sheets.spreadsheet",
    label: "Client directory spreadsheet",
    blueprintName: "FCI Operations Directory",
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeConfig>>) => config.clientDirectorySheetId,
  },
  {
    key: "client-appointments",
    resourceType: "calendar.calendar",
    label: "Client appointments calendar",
    blueprintName: "FCI • Client Appointments",
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeConfig>>) => config.clientAppointmentsCalendarId,
  },
  {
    key: "field-schedule",
    resourceType: "calendar.calendar",
    label: "Field schedule calendar",
    blueprintName: "FCI • Field Schedule",
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeConfig>>) => config.fieldScheduleCalendarId,
  },
] as const;

function resourceState(
  simulation: boolean,
  source: "app" | "env" | "none",
  origin?: "created" | "adopted" | "env-adopted",
) {
  if (simulation) return "Simulated" as const;
  if (origin === "created") return "Created" as const;
  if (origin === "adopted" || origin === "env-adopted") return "Adopted" as const;
  return source === "env" ? "Found" as const : "Not configured" as const;
}

function maskAccount(email: string) {
  const normalized = email.trim().toLowerCase();
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 2)}•••@${domain}`;
}

export async function GET(request: NextRequest) {
  // Like the existing connection-status GET, this read-only route relies on
  // authenticated Administrator access and does not require a mutation-only
  // Origin header that same-origin browser GET requests may omit.
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const config = await getEffectiveGoogleRuntimeConfig();
  const [savedRows, connection] = await Promise.all([
    listWorkspaceResources(env.DB, config.connectionKey),
    config.simulation
      ? Promise.resolve<ConnectionIdentityRow | null>(null)
      : env.DB.prepare(
        "SELECT google_email, status FROM google_connections WHERE connection_key = ?",
      ).bind(config.connectionKey).first<ConnectionIdentityRow>(),
  ]);
  const savedByIdentity = new Map(savedRows.map((row) => [`${row.resourceType}:${row.resourceKey}`, row]));
  const resources = RESOURCE_PRESENTATION.map((presentation) => {
    const saved = savedByIdentity.get(`${presentation.resourceType}:${presentation.key}`);
    const appManaged = Boolean(saved?.externalId.trim());
    const effectiveId = presentation.effectiveId(config);
    const source = appManaged ? "app" as const : config.simulation ? "none" as const : effectiveId ? "env" as const : "none" as const;
    return {
      key: presentation.key,
      label: presentation.label,
      blueprintName: presentation.blueprintName,
      ...(effectiveId ? { externalId: effectiveId } : {}),
      source,
      ...(appManaged && saved ? { origin: saved.origin } : {}),
      ...(appManaged && saved?.externalUrl ? { url: saved.externalUrl } : {}),
      ...(appManaged && saved ? { updatedAt: saved.updatedAt } : {}),
      state: resourceState(config.simulation, source, appManaged ? saved?.origin : undefined),
    };
  });

  const intakeMailboxMatches = config.simulation
    ? true
    : !connection || connection.status !== "connected" || !config.intakeMailbox
      ? null
      : connection.google_email.trim().toLowerCase() === config.intakeMailbox;

  return NextResponse.json({
    resources,
    connectReady: config.connectReady,
    simulation: config.simulation,
    identity: {
      connectionAccount: config.simulation ? "Local Workspace simulation" : connection ? maskAccount(connection.google_email) : null,
      intakeMailboxMatches,
      allowedDomains: config.allowedDomains,
      mode: config.environment,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
