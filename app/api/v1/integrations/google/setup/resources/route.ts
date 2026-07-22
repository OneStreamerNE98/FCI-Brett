import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import { getEffectiveGoogleRuntimeSetup } from "../../../../../../lib/google-oauth-sites";
import { flattenWorkspaceRootFolders, type WorkspaceBlueprint } from "../../../../../../lib/workspace-blueprint";
import { requireOfficeUser } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

type ConnectionIdentityRow = Readonly<{
  google_email: string;
  status: string;
}>;

function resourcePresentation(blueprint: WorkspaceBlueprint) {
  const calendarName = (key: string, fallback: string) => blueprint.calendars.find((calendar) => calendar.key === key)?.name ?? fallback;
  return [
  {
    key: "primary",
    resourceType: "drive.shared-drive",
    label: "Shared Drive",
    name: blueprint.drive.sharedDriveName,
    blueprintName: blueprint.drive.sharedDriveName,
    management: "owner",
    parentKey: null,
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["config"]) => config.drive.rootFolderId,
  },
  ...blueprint.spreadsheets.map((spreadsheet) => ({
    key: spreadsheet.key,
    resourceType: "sheets.spreadsheet" as const,
    label: spreadsheet.role === "system-mirror"
      ? "Client directory spreadsheet"
      : spreadsheet.role === "import"
        ? "Import spreadsheet"
        : "Reference spreadsheet",
    name: spreadsheet.name,
    blueprintName: spreadsheet.name,
    management: spreadsheet.management,
    role: spreadsheet.role,
    parentKey: spreadsheet.targetFolderKey,
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["config"]) => (
      spreadsheet.key === "client-directory" ? config.clientDirectorySheetId : undefined
    ),
  })),
  ...blueprint.templates.map((template) => ({
    key: template.key,
    resourceType: "drive.file" as const,
    label: template.kind === "sheet" ? "Spreadsheet template" : "Document template",
    name: template.name,
    blueprintName: template.name,
    management: template.management,
    parentKey: "templates",
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["config"]) => {
      void config;
      return undefined;
    },
  })),
  {
    key: "client-appointments",
    resourceType: "calendar.calendar",
    label: "Client appointments calendar",
    name: calendarName("client-appointments", "FCI • Client Appointments"),
    blueprintName: calendarName("client-appointments", "FCI • Client Appointments"),
    management: "system",
    parentKey: null,
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["config"]) => config.clientAppointmentsCalendarId,
  },
  {
    key: "field-schedule",
    resourceType: "calendar.calendar",
    label: "Field schedule calendar",
    name: calendarName("field-schedule", "FCI • Field Schedule"),
    blueprintName: calendarName("field-schedule", "FCI • Field Schedule"),
    management: "system",
    parentKey: null,
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["config"]) => config.fieldScheduleCalendarId,
  },
  ...flattenWorkspaceRootFolders(blueprint).map((folder) => ({
    key: folder.key,
    resourceType: "drive.folder" as const,
    label: folder.parentKey ? "Workspace subfolder" : "Root folder",
    name: folder.name,
    blueprintName: folder.path,
    management: folder.management,
    parentKey: folder.parentKey,
    effectiveId: (config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>["config"]) => {
      void config;
      return undefined;
    },
  })),
  ] as const;
}

function restrictions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const flag = (key: string) => typeof record[key] === "boolean" ? record[key] as boolean : null;
  return {
    adminManagedRestrictions: flag("adminManagedRestrictions"),
    copyRequiresWriterPermission: flag("copyRequiresWriterPermission"),
    domainUsersOnly: flag("domainUsersOnly"),
    driveMembersOnly: flag("driveMembersOnly"),
    sharingFoldersRequiresOrganizerPermission: flag("sharingFoldersRequiresOrganizerPermission"),
  };
}

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

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, resources: savedRows, blueprint } = setup;
  const connection = await (
    config.simulation
      ? Promise.resolve<ConnectionIdentityRow | null>(null)
      : env.DB.prepare(
        "SELECT google_email, status FROM google_connections WHERE connection_key = ?",
      ).bind(config.connectionKey).first<ConnectionIdentityRow>()
  );
  const savedByIdentity = new Map(savedRows.map((row) => [`${row.resourceType}:${row.resourceKey}`, row]));
  const resources = resourcePresentation(blueprint).map((presentation) => {
    const saved = savedByIdentity.get(`${presentation.resourceType}:${presentation.key}`);
    const appManaged = Boolean(saved?.externalId.trim());
    const effectiveId = saved?.externalId || presentation.effectiveId(config);
    const source = appManaged ? "app" as const : config.simulation ? "none" as const : effectiveId ? "env" as const : "none" as const;
    return {
      key: presentation.key,
      resourceType: presentation.resourceType,
      label: presentation.label,
      name: presentation.name,
      blueprintName: presentation.blueprintName,
      management: presentation.management,
      ...("role" in presentation ? { role: presentation.role } : {}),
      parentKey: presentation.parentKey,
      ...(effectiveId ? { externalId: effectiveId } : {}),
      source,
      ...(appManaged && saved ? { origin: saved.origin } : {}),
      ...(appManaged && saved?.externalUrl ? { url: saved.externalUrl } : {}),
      ...(appManaged && saved ? { updatedAt: saved.updatedAt } : {}),
      ...(presentation.resourceType === "drive.shared-drive" && saved ? { restrictions: restrictions(saved.metadata.restrictions) } : {}),
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
