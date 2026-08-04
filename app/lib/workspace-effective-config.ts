import { maskGoogleAccountAddress } from "./google-account-mask.ts";
import type { GoogleRuntimeConfig } from "./google-oauth";

export const WORKSPACE_RESOURCE_TYPES = [
  "drive.shared-drive",
  "drive.folder",
  "drive.file",
  "sheets.spreadsheet",
  "calendar.calendar",
] as const;

export type WorkspaceResourceType = (typeof WORKSPACE_RESOURCE_TYPES)[number];

export const WORKSPACE_RESOURCE_ORIGINS = ["created", "adopted", "env-adopted"] as const;

export type WorkspaceResourceOrigin = (typeof WORKSPACE_RESOURCE_ORIGINS)[number];

export type WorkspaceResource = Readonly<{
  id: string;
  connectionKey: string;
  resourceType: WorkspaceResourceType;
  resourceKey: string;
  externalId: string;
  parentExternalId: string | null;
  externalUrl: string | null;
  origin: WorkspaceResourceOrigin;
  metadata: Readonly<Record<string, unknown>>;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}>;

export const EFFECTIVE_WORKSPACE_RESOURCE_SPECS = Object.freeze({
  sharedDrive: Object.freeze({
    resourceType: "drive.shared-drive" as const,
    resourceKey: "primary",
    envVar: "GOOGLE_WORKSPACE_SHARED_DRIVE_ID",
  }),
  clientDirectorySheet: Object.freeze({
    resourceType: "sheets.spreadsheet" as const,
    resourceKey: "client-directory",
    envVar: "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID",
  }),
  clientAppointmentsCalendar: Object.freeze({
    resourceType: "calendar.calendar" as const,
    resourceKey: "client-appointments",
    envVar: "GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID",
  }),
  fieldScheduleCalendar: Object.freeze({
    resourceType: "calendar.calendar" as const,
    resourceKey: "field-schedule",
    envVar: "GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID",
  }),
  leadFormResponseSheet: Object.freeze({
    resourceType: "sheets.spreadsheet" as const,
    resourceKey: "lead-form-responses",
    envVar: "GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID",
  }),
});

export type EffectiveWorkspaceResourceKey = keyof typeof EFFECTIVE_WORKSPACE_RESOURCE_SPECS;
export type EffectiveWorkspaceResourceSource = "app" | "env" | "none";

export type EffectiveWorkspaceResource = Readonly<{
  resourceType: WorkspaceResourceType;
  resourceKey: string;
  externalId?: string;
  source: EffectiveWorkspaceResourceSource;
  registry?: WorkspaceResource;
}>;

export type EffectiveWorkspaceResources = Readonly<
  Record<EffectiveWorkspaceResourceKey, EffectiveWorkspaceResource>
>;

export type SavedWorkspaceValueSource = "saved" | "env" | "absent";

export type SavedWorkspaceValueResolution = Readonly<{
  value: string | undefined;
  source: SavedWorkspaceValueSource;
}>;

export type SavedWorkspaceRuntimeValues = Readonly<{
  clientDirectorySheetId?: string | null;
  clientAppointmentsCalendarId?: string | null;
  fieldScheduleCalendarId?: string | null;
  intakeMailbox?: string | null;
  driveProvisioningEnabled?: boolean | null;
}>;

export type EffectiveGoogleRuntimeConfig = GoogleRuntimeConfig & Readonly<{
  connectReady: boolean;
  effectiveSources: Readonly<{
    driveProvisioningEnabled: EffectiveConfigurationSource;
    intakeMailbox: EffectiveConfigurationSource;
  }>;
}>;

export type EffectiveConfigurationSource = "app" | "env" | "none";

export type EffectiveConfigurationValue<T> = Readonly<{
  value: T;
  source: EffectiveConfigurationSource;
}>;

const RESOURCE_ENV_VARS = new Set(
  Object.values(EFFECTIVE_WORKSPACE_RESOURCE_SPECS).map((spec) => spec.envVar),
);
const INTAKE_MAILBOX_ENV_VAR = "GOOGLE_WORKSPACE_INTAKE_MAILBOX";

function normalizedId(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

/** Shared app-saved > environment > none resolver for UI-manageable text. */
export function resolveEffectiveTextConfiguration(
  savedValue: unknown,
  environmentValue: string | undefined,
): EffectiveConfigurationValue<string | undefined> {
  const saved = typeof savedValue === "string" ? normalizedId(savedValue) : undefined;
  if (saved) return Object.freeze({ value: saved, source: "app" });
  const environment = normalizedId(environmentValue);
  if (environment) return Object.freeze({ value: environment, source: "env" });
  return Object.freeze({ value: undefined, source: "none" });
}

/** Boolean sibling of the shared resolver; only literal hosted values count. */
export function resolveEffectiveBooleanConfiguration(
  savedValue: unknown,
  environmentValue: string | undefined,
): EffectiveConfigurationValue<boolean> {
  if (typeof savedValue === "boolean") {
    return Object.freeze({ value: savedValue, source: "app" });
  }
  if (environmentValue === "true" || environmentValue === "false") {
    return Object.freeze({
      value: environmentValue === "true",
      source: "env",
    });
  }
  return Object.freeze({ value: false, source: "none" });
}

/**
 * Resolves persisted runtime configuration before its first-boot environment
 * fallback. SET-05 may surface this source label later; BE-07 consumes it only
 * on the server.
 */
export function resolveSavedWorkspaceValue(
  savedValue: string | null | undefined,
  environmentValue: string | undefined,
): SavedWorkspaceValueResolution {
  const saved = normalizedId(savedValue ?? undefined);
  if (saved) return Object.freeze({ value: saved, source: "saved" });
  const environment = normalizedId(environmentValue);
  if (environment) return Object.freeze({ value: environment, source: "env" });
  return Object.freeze({ value: undefined, source: "absent" });
}

function resolveResource(
  spec: (typeof EFFECTIVE_WORKSPACE_RESOURCE_SPECS)[EffectiveWorkspaceResourceKey],
  environmentValue: string | undefined,
  savedRows: readonly WorkspaceResource[],
  savedValue: string | null | undefined,
  simulation: boolean,
): EffectiveWorkspaceResource {
  const registry = savedRows.find((row) => (
    row.resourceType === spec.resourceType && row.resourceKey === spec.resourceKey
  ));
  const appValue = normalizedId(registry?.externalId);
  if (appValue && registry) {
    return Object.freeze({
      resourceType: spec.resourceType,
      resourceKey: spec.resourceKey,
      externalId: appValue,
      source: "app",
      registry,
    });
  }

  const resolved = resolveSavedWorkspaceValue(
    simulation ? undefined : savedValue,
    simulation ? undefined : environmentValue,
  );
  const effectiveValue = resolved.value ?? (simulation ? normalizedId(environmentValue) : undefined);
  // Base simulation config supplies deterministic fixture IDs. Preserve those
  // IDs for parity, but do not misrepresent them as hosted environment values.
  return Object.freeze({
    resourceType: spec.resourceType,
    resourceKey: spec.resourceKey,
    ...(effectiveValue ? { externalId: effectiveValue } : {}),
    source:
      resolved.source === "saved"
        ? "app" as const
        : resolved.source === "env"
          ? "env" as const
          : "none" as const,
  });
}

/** Pure app-saved > environment > none resolution for the five runtime resource IDs. */
export function resolveEffectiveWorkspaceResources(
  config: GoogleRuntimeConfig,
  savedRows: readonly WorkspaceResource[],
  savedValues: SavedWorkspaceRuntimeValues = {},
): EffectiveWorkspaceResources {
  return Object.freeze({
    sharedDrive: resolveResource(
      EFFECTIVE_WORKSPACE_RESOURCE_SPECS.sharedDrive,
      config.drive.rootFolderId,
      savedRows,
      undefined,
      config.simulation,
    ),
    clientDirectorySheet: resolveResource(
      EFFECTIVE_WORKSPACE_RESOURCE_SPECS.clientDirectorySheet,
      config.clientDirectorySheetId,
      savedRows,
      savedValues.clientDirectorySheetId,
      config.simulation,
    ),
    clientAppointmentsCalendar: resolveResource(
      EFFECTIVE_WORKSPACE_RESOURCE_SPECS.clientAppointmentsCalendar,
      config.clientAppointmentsCalendarId,
      savedRows,
      savedValues.clientAppointmentsCalendarId,
      config.simulation,
    ),
    fieldScheduleCalendar: resolveResource(
      EFFECTIVE_WORKSPACE_RESOURCE_SPECS.fieldScheduleCalendar,
      config.fieldScheduleCalendarId,
      savedRows,
      savedValues.fieldScheduleCalendarId,
      config.simulation,
    ),
    leadFormResponseSheet: resolveResource(
      EFFECTIVE_WORKSPACE_RESOURCE_SPECS.leadFormResponseSheet,
      config.leadFormResponseSheetId,
      savedRows,
      undefined,
      config.simulation,
    ),
  });
}

/**
 * Applies resolved IDs without mutating or rebuilding base missing-detail entries.
 * Only an app-managed value removes its corresponding resource prerequisite.
 */
export function applyEffectiveWorkspaceConfig(
  config: GoogleRuntimeConfig,
  resources: EffectiveWorkspaceResources,
  savedValues: SavedWorkspaceRuntimeValues = {},
  connectedGoogleEmail?: string | null,
): EffectiveGoogleRuntimeConfig {
  const appSatisfiedEnvVars = new Set(
    Object.entries(resources)
      .filter(([, resource]) => resource.source === "app")
      .map(([key]) => EFFECTIVE_WORKSPACE_RESOURCE_SPECS[key as EffectiveWorkspaceResourceKey].envVar),
  );
  const intakeMailbox = resolveEffectiveTextConfiguration(
    savedValues.intakeMailbox,
    config.intakeMailbox,
  );
  const normalizedConnectedGoogleEmail = normalizedId(
    connectedGoogleEmail?.trim().toLowerCase(),
  );
  const intakeMailboxDomain = intakeMailbox.value?.split("@")[1] ?? "";
  const mailboxDetail = config.simulation || !config.gmailEnabled
    ? null
    : !intakeMailbox.value
      ? {
          label: "Google Workspace intake mailbox",
          envVar: INTAKE_MAILBOX_ENV_VAR,
          secret: false,
        }
      : !config.expectedGoogleEmails.includes(intakeMailbox.value)
        || !config.allowedDomains.includes(intakeMailboxDomain)
        ? {
            label: "Google Workspace intake mailbox included in the authorized accounts and allowed domains",
            envVar: INTAKE_MAILBOX_ENV_VAR,
            secret: false,
          }
        : normalizedConnectedGoogleEmail
          && normalizedConnectedGoogleEmail !== intakeMailbox.value
          ? {
              // `missing`/`missingDetails` reach every office user through
              // GET /api/v1/google-workspace, which masks the same address one field away in
              // `connection.account`. So the connected address is masked here too. The saved
              // intake mailbox stays readable: the office UI already shows that selector and
              // its option list, so masking it here would hide nothing.
              label: `Google Workspace intake mailbox ${intakeMailbox.value} matching connected account ${maskGoogleAccountAddress(normalizedConnectedGoogleEmail) ?? "the connected account"}`,
              envVar: INTAKE_MAILBOX_ENV_VAR,
              secret: false,
            }
          : null;
  const missingDetails = Object.freeze([
    ...config.missingDetails.filter((detail) => (
      detail.envVar !== INTAKE_MAILBOX_ENV_VAR
      && !appSatisfiedEnvVars.has(detail.envVar)
    )),
    ...(mailboxDetail ? [Object.freeze(mailboxDetail)] : []),
  ]);
  const missing = Object.freeze(missingDetails.map((detail) => detail.label));
  const nonResourceMissing = config.missingDetails.filter(
    (detail) => (
      !RESOURCE_ENV_VARS.has(detail.envVar)
      && detail.envVar !== INTAKE_MAILBOX_ENV_VAR
    ),
  );
  const driveProvisioning = resolveEffectiveBooleanConfiguration(
    savedValues.driveProvisioningEnabled,
    config.driveProvisioningEnvironmentValue,
  );

  return Object.freeze({
    ...config,
    drive: Object.freeze({
      ...config.drive,
      rootFolderId: resources.sharedDrive.externalId,
    }),
    clientDirectorySheetId: resources.clientDirectorySheet.externalId,
    clientDirectorySheetIdInvalid:
      resources.clientDirectorySheet.source === "app" ? false : config.clientDirectorySheetIdInvalid,
    clientAppointmentsCalendarId: resources.clientAppointmentsCalendar.externalId,
    fieldScheduleCalendarId: resources.fieldScheduleCalendar.externalId,
    leadFormResponseSheetId: resources.leadFormResponseSheet.externalId,
    leadFormResponseSheetIdInvalid:
      resources.leadFormResponseSheet.source === "app"
        ? false
        : config.leadFormResponseSheetIdInvalid,
    intakeMailbox: config.simulation ? config.intakeMailbox : intakeMailbox.value,
    missingDetails,
    missing,
    oauthReady: config.simulation || missingDetails.length === 0,
    connectReady: config.simulation || nonResourceMissing.length === 0,
    provisioningEnabled: config.simulation || driveProvisioning.value,
    effectiveSources: Object.freeze({
      driveProvisioningEnabled: config.simulation ? "none" : driveProvisioning.source,
      intakeMailbox: config.simulation ? "none" : intakeMailbox.source,
    }),
  });
}
