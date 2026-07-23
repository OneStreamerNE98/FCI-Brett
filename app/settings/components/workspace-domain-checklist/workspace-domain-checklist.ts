import type { WorkspaceSetupResource } from "../WorkspaceDriveResourceActions";

export type WorkspaceChecklistMissingDetail = {
  label: string;
  envVar: string;
  secret: boolean;
};

export type WorkspaceChecklistResourceSource = Pick<WorkspaceSetupResource, "key" | "resourceType" | "source">;

export type WorkspaceChecklistLoadState = "idle" | "loading" | "ready" | "error";

export type WorkspaceDomainChecklistKey =
  | "domain"
  | "operations-account"
  | "apis"
  | "oauth"
  | "secrets"
  | "groups";

export type WorkspaceDomainChecklistStatus =
  | "Administrator setup"
  | "Simulated"
  | "Unavailable"
  | "Setup required"
  | "Partially configured"
  | "Needs review"
  | "Configuration present"
  | "Ready to connect"
  | "Reconnect required"
  | "Connected"
  | "Account matched"
  | "Account mismatch"
  | "Secrets present"
  | "Restricted"
  | "Not verified"
  | "Manual check";

export type WorkspaceDomainChecklistStatusClassName =
  | "administrator-setup"
  | "simulated"
  | "unavailable"
  | "setup-required"
  | "partially-configured"
  | "needs-review"
  | "configuration-present"
  | "ready-to-connect"
  | "reconnect-required"
  | "connected"
  | "account-matched"
  | "account-mismatch"
  | "secrets-present"
  | "restricted"
  | "not-verified"
  | "manual-check";

export type WorkspaceDomainChecklistDisplayStatus = "DONE" | "MISSING";

export type WorkspaceDomainChecklistEvidence = {
  isAdmin: boolean;
  simulation: boolean;
  readinessKnown: boolean;
  missingDetails: readonly WorkspaceChecklistMissingDetail[];
  resourcesKnown: boolean;
  connectReady: boolean;
  allowedDomainCount: number;
  intakeMailboxMatches: boolean | null;
  hasConnectionAccount: boolean;
  connectionKnown: boolean;
  connectionStatus: string | null;
  requiresReauthorization: boolean;
};

export type WorkspaceDomainChecklistResult = Readonly<{
  key: WorkspaceDomainChecklistKey;
  status: WorkspaceDomainChecklistStatus;
}>;

export const WORKSPACE_OAUTH_REDIRECT_URI = "https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback";
export const WORKSPACE_TOKEN_KEY_COMMAND = "openssl rand -base64 32";

export const WORKSPACE_RESOURCE_ENV_BY_KEY: Readonly<Record<string, string>> = {
  primary: "GOOGLE_WORKSPACE_SHARED_DRIVE_ID",
  "client-directory": "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID",
  "client-appointments": "GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID",
  "field-schedule": "GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID",
};

export const WORKSPACE_DOTENV_PLACEHOLDERS: Readonly<Record<string, string>> = {
  FCI_ADMIN_EMAILS: "<authorized-chatgpt-sign-in-email>",
  GOOGLE_INTEGRATION_MODE: "<workspace or simulation>",
  GOOGLE_WORKSPACE_ENABLED_SERVICES: "<comma-separated approved services>",
  GOOGLE_WORKSPACE_CLIENT_ID: "<OAuth web client ID>",
  GOOGLE_WORKSPACE_CLIENT_SECRET: "<secret>",
  GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "<OAuth redirect URI shown above>",
  GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: "<secret 32-byte base64 value>",
  GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION: "<key version>",
  GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "<company-workspace-domain>",
  GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "<operations-account@company.example>",
  GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "<Shared Drive ID>",
  GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED: "<true or false>",
  GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "<spreadsheet ID>",
  GOOGLE_WORKSPACE_INTAKE_MAILBOX: "<operations-account@company.example>",
  GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID: "<client-appointments-calendar ID>",
  GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID: "<field-schedule-calendar ID>",
};

const DOMAIN_ENV = "GOOGLE_WORKSPACE_ALLOWED_DOMAINS";
const ACCOUNT_ENVS = ["GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS", "GOOGLE_WORKSPACE_INTAKE_MAILBOX"] as const;
const ACCOUNT_MATCH_ENV = "GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS";
const OAUTH_ENVS = ["GOOGLE_WORKSPACE_CLIENT_ID", "GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI"] as const;
const SECRET_ENVS = ["GOOGLE_WORKSPACE_CLIENT_SECRET", "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY"] as const;
const ENVIRONMENT_KEY_PATTERN = /[A-Z][A-Z0-9_]+/g;
const DONE_CHECKLIST_STATUSES = new Set<WorkspaceDomainChecklistStatus>([
  "Simulated",
  "Configuration present",
  "Ready to connect",
  "Connected",
  "Account matched",
  "Secrets present",
  "Restricted",
]);

function environmentKeys(details: readonly WorkspaceChecklistMissingDetail[]) {
  const keys = new Set<string>();
  for (const detail of details) {
    for (const environmentKey of detail.envVar.match(ENVIRONMENT_KEY_PATTERN) ?? []) keys.add(environmentKey);
  }
  return keys;
}

function statusForConfiguredPair(missingCount: number) {
  if (missingCount >= 2) return "Setup required" as const;
  if (missingCount === 1) return "Partially configured" as const;
  return null;
}

function sharedStatus(evidence: WorkspaceDomainChecklistEvidence) {
  if (!evidence.isAdmin) return "Administrator setup" as const;
  if (evidence.simulation) return "Simulated" as const;
  return null;
}

function domainStatus(evidence: WorkspaceDomainChecklistEvidence, missing: ReadonlySet<string>): WorkspaceDomainChecklistStatus {
  if (!evidence.readinessKnown) return "Unavailable";
  if (missing.has(DOMAIN_ENV)) return "Setup required";
  if (!evidence.resourcesKnown) return "Unavailable";
  return evidence.allowedDomainCount > 0 ? "Configuration present" : "Needs review";
}

function operationsAccountStatus(evidence: WorkspaceDomainChecklistEvidence, missing: ReadonlySet<string>): WorkspaceDomainChecklistStatus {
  if (evidence.connectionKnown && evidence.requiresReauthorization) return "Reconnect required";
  if (evidence.resourcesKnown && evidence.intakeMailboxMatches === false) return "Account mismatch";
  if (evidence.connectionKnown && evidence.connectionStatus === "connected" && evidence.resourcesKnown && evidence.intakeMailboxMatches === true) return "Account matched";
  if (!evidence.readinessKnown) return "Unavailable";
  if (evidence.missingDetails.some((detail) => detail.envVar === ACCOUNT_MATCH_ENV)) return "Account mismatch";
  const pairStatus = statusForConfiguredPair(ACCOUNT_ENVS.filter((environmentKey) => missing.has(environmentKey)).length);
  if (pairStatus) return pairStatus;
  if (!evidence.resourcesKnown) return "Unavailable";
  if (evidence.hasConnectionAccount && evidence.intakeMailboxMatches !== true) return "Needs review";
  return evidence.connectReady ? "Ready to connect" : "Configuration present";
}

function oauthStatus(evidence: WorkspaceDomainChecklistEvidence, missing: ReadonlySet<string>): WorkspaceDomainChecklistStatus {
  if (evidence.connectionKnown && evidence.requiresReauthorization) return "Reconnect required";
  if (evidence.readinessKnown) {
    const pairStatus = statusForConfiguredPair(OAUTH_ENVS.filter((environmentKey) => missing.has(environmentKey)).length);
    if (pairStatus) return pairStatus;
  }
  if (evidence.connectionKnown && evidence.connectionStatus === "connected") return "Connected";
  if (!evidence.readinessKnown) return "Unavailable";
  if (!evidence.resourcesKnown) return "Unavailable";
  return evidence.connectReady ? "Ready to connect" : "Configuration present";
}

function secretsStatus(evidence: WorkspaceDomainChecklistEvidence, missing: ReadonlySet<string>): WorkspaceDomainChecklistStatus {
  if (!evidence.readinessKnown) return "Unavailable";
  const explicitlyMissingSecrets = new Set(
    evidence.missingDetails
      .filter((detail) => detail.secret)
      .flatMap((detail) => detail.envVar.match(ENVIRONMENT_KEY_PATTERN) ?? []),
  );
  const knownMissingCount = SECRET_ENVS.filter((environmentKey) => missing.has(environmentKey)).length;
  const missingCount = Math.max(knownMissingCount, explicitlyMissingSecrets.size);
  if (missingCount >= 2) return "Setup required";
  if (missingCount === 1) return "Partially configured";
  return "Secrets present";
}

export function deriveWorkspaceDomainChecklist(evidence: WorkspaceDomainChecklistEvidence): readonly WorkspaceDomainChecklistResult[] {
  const common = sharedStatus(evidence);
  if (common) {
    return Object.freeze([
      { key: "domain", status: common },
      { key: "operations-account", status: common },
      { key: "apis", status: common },
      { key: "oauth", status: common },
      { key: "secrets", status: common },
      { key: "groups", status: common },
    ]);
  }

  const missing = environmentKeys(evidence.missingDetails);
  return Object.freeze([
    { key: "domain", status: domainStatus(evidence, missing) },
    { key: "operations-account", status: operationsAccountStatus(evidence, missing) },
    { key: "apis", status: "Manual check" },
    { key: "oauth", status: oauthStatus(evidence, missing) },
    { key: "secrets", status: secretsStatus(evidence, missing) },
    { key: "groups", status: "Manual check" },
  ]);
}

export function workspaceDomainChecklistSummary(results: readonly WorkspaceDomainChecklistResult[]) {
  const statuses = new Set(results.map((result) => result.status));
  if (statuses.has("Administrator setup")) return "Administrator guidance";
  if (statuses.has("Simulated")) return "Simulated";
  if (["Setup required", "Partially configured", "Needs review", "Reconnect required", "Account mismatch"].some((status) => statuses.has(status as WorkspaceDomainChecklistStatus))) return "Setup required";
  if (statuses.has("Unavailable")) return "Unavailable";
  if (statuses.has("Connected") || statuses.has("Account matched")) return "Connected";
  if (statuses.has("Ready to connect")) return "Ready to connect";
  return "Manual checks remain";
}

export function workspaceDomainChecklistStatusClass(status: WorkspaceDomainChecklistStatus) {
  return status.toLowerCase().replaceAll(" ", "-") as WorkspaceDomainChecklistStatusClassName;
}

export function workspaceDomainChecklistDisplayStatus(
  status: WorkspaceDomainChecklistStatus,
): WorkspaceDomainChecklistDisplayStatus {
  return DONE_CHECKLIST_STATUSES.has(status) ? "DONE" : "MISSING";
}

export function workspaceSharedDriveRestrictionStatus(domainUsersOnly: boolean | null) {
  if (domainUsersOnly === true) return "Restricted" as const;
  if (domainUsersOnly === false) return "Needs review" as const;
  return "Not verified" as const;
}

function workspaceResourceEnvironmentKey(resource: WorkspaceChecklistResourceSource) {
  const expectedTypeByKey: Partial<Record<string, WorkspaceSetupResource["resourceType"]>> = {
    primary: "drive.shared-drive",
    "client-directory": "sheets.spreadsheet",
    "client-appointments": "calendar.calendar",
    "field-schedule": "calendar.calendar",
  };
  const expectedType = expectedTypeByKey[resource.key];
  if (!expectedType || (resource.resourceType && resource.resourceType !== expectedType)) return undefined;
  return WORKSPACE_RESOURCE_ENV_BY_KEY[resource.key];
}

function getAppManagedEnvironmentKeys(resources: readonly WorkspaceChecklistResourceSource[]) {
  return new Set(
    resources
      .filter((resource) => resource.source === "app")
      .map(workspaceResourceEnvironmentKey)
      .filter((value): value is string => Boolean(value)),
  );
}

export function visibleWorkspacePrerequisites(
  details: readonly WorkspaceChecklistMissingDetail[],
  resources: readonly WorkspaceChecklistResourceSource[],
) {
  const appManaged = getAppManagedEnvironmentKeys(resources);
  return details.filter((detail) => {
    const keys = detail.envVar.match(ENVIRONMENT_KEY_PATTERN) ?? [];
    return keys.length === 0 || !keys.every((environmentKey) => appManaged.has(environmentKey));
  });
}

export function missingWorkspaceDotenvTemplate(
  details: readonly WorkspaceChecklistMissingDetail[],
  resources: readonly WorkspaceChecklistResourceSource[],
  simulation: boolean,
) {
  const appManagedEnvironmentKeys = getAppManagedEnvironmentKeys(resources);
  const included = new Set<string>();
  const lines: string[] = [];
  const includeEnvironmentKey = (environmentKey: string) => {
    const placeholder = WORKSPACE_DOTENV_PLACEHOLDERS[environmentKey];
    if (!placeholder || included.has(environmentKey) || appManagedEnvironmentKeys.has(environmentKey)) return;
    included.add(environmentKey);
    lines.push(`${environmentKey}=${placeholder}`);
  };
  for (const detail of details) {
    for (const environmentKey of detail.envVar.match(ENVIRONMENT_KEY_PATTERN) ?? []) includeEnvironmentKey(environmentKey);
  }
  if (!simulation) {
    for (const resource of resources) {
      if (resource.source === "none") includeEnvironmentKey(workspaceResourceEnvironmentKey(resource) ?? "");
    }
  }
  return lines.join("\n");
}

export function workspaceCopyHelperState(
  readinessState: WorkspaceChecklistLoadState,
  resourcesState: WorkspaceChecklistLoadState,
  resourcesAvailable: boolean,
) {
  if (readinessState === "error" || resourcesState === "error") return "unavailable" as const;
  if (readinessState === "ready" && resourcesState === "ready" && resourcesAvailable) return "ready" as const;
  if (readinessState === "ready" && resourcesState === "ready") return "unavailable" as const;
  return "loading" as const;
}
