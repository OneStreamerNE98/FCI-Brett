export const OPERATIONS_VIEWS = [
  "Overview",
  "Leads",
  "Clients",
  "Projects",
  "Schedule",
  "Inbox",
  "AI Assistant",
  "Reports",
  "Settings",
] as const;

export type OperationsView = (typeof OPERATIONS_VIEWS)[number];

export const OPERATIONS_PATHS: Record<OperationsView, string> = {
  Overview: "/",
  Leads: "/leads",
  Clients: "/clients",
  Projects: "/projects",
  Schedule: "/schedule",
  Inbox: "/inbox",
  "AI Assistant": "/assistant",
  Reports: "/reports",
  Settings: "/settings",
};

export const SETTINGS_SECTIONS = [
  "My account",
  "Google Workspace",
  "Calendar & appointments",
  "Inbox & file rules",
  "Client Directory",
  "Workflow & notifications",
  "Data & security",
  "Testing & launch",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const PROJECT_STATUS_FILTERS = ["Active", "Completed", "Cancelled", "Archived"] as const;
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number];

export const PROJECT_LIFECYCLE_FILTERS = ["planning", "mobilizing", "installation", "closeout", "completed", "cancelled", "archived"] as const;
export type ProjectLifecycleFilter = (typeof PROJECT_LIFECYCLE_FILTERS)[number];

export const LEAD_STAGE_FILTERS = ["new-inquiry", "site-visit", "proposal", "decision", "other"] as const;
export type LeadStageFilter = (typeof LEAD_STAGE_FILTERS)[number];

export const LEAD_STAGE_LABELS: Record<LeadStageFilter, string> = {
  "new-inquiry": "New inquiry",
  "site-visit": "Site visit",
  proposal: "Proposal",
  decision: "Decision",
  other: "Other stages",
};

export const INBOX_BUCKETS = ["inbox", "intake", "needs-review", "filed"] as const;
export type InboxBucket = (typeof INBOX_BUCKETS)[number];

export type OperationsPageSearchParams = Record<string, string | string[] | undefined>;

const settingsSectionSlugs: Record<SettingsSection, string> = {
  "My account": "account",
  "Google Workspace": "google-workspace",
  "Calendar & appointments": "calendar",
  "Inbox & file rules": "inbox-rules",
  "Client Directory": "client-directory",
  "Workflow & notifications": "workflow-notifications",
  "Data & security": "data-security",
  "Testing & launch": "testing-launch",
};

const settingsSectionBySlug = new Map(
  Object.entries(settingsSectionSlugs).map(([section, slug]) => [slug, section as SettingsSection]),
);

const viewByPath = new Map(
  Object.entries(OPERATIONS_PATHS).map(([view, path]) => [path, view as OperationsView]),
);

function normalizedPath(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function exactSingleValue(parameters: URLSearchParams, key: string) {
  const values = parameters.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function pageParameterSearch(value: string | string[] | undefined, key: string) {
  const parameters = new URLSearchParams();
  if (Array.isArray(value)) {
    for (const item of value) parameters.append(key, item);
  } else if (typeof value === "string") {
    parameters.set(key, value);
  }
  return parameters.toString();
}

function replaceBoundedParameter(
  parameters: URLSearchParams,
  key: string,
  allowedValues: readonly string[],
  defaultValue: string,
) {
  const value = exactSingleValue(parameters, key);
  parameters.delete(key);
  if (value && value !== defaultValue && allowedValues.includes(value)) parameters.set(key, value);
}

export function operationsViewForPath(pathname: string): OperationsView | null {
  return viewByPath.get(normalizedPath(pathname)) ?? null;
}

export function operationsPath(view: OperationsView) {
  return OPERATIONS_PATHS[view];
}

export function settingsSectionFromSearch(search: string): SettingsSection {
  const value = exactSingleValue(new URLSearchParams(search), "section");
  return settingsSectionBySlug.get(value ?? "") ?? "My account";
}

export function projectStatusFromSearch(search: string): ProjectStatusFilter {
  const value = exactSingleValue(new URLSearchParams(search), "status");
  const match = PROJECT_STATUS_FILTERS.find((filter) => filter.toLowerCase() === value);
  return match ?? "Active";
}

export function projectLifecycleFromSearch(search: string): ProjectLifecycleFilter | null {
  const value = exactSingleValue(new URLSearchParams(search), "status");
  return PROJECT_LIFECYCLE_FILTERS.find((filter) => filter === value) ?? null;
}

export function leadStageFromSearch(search: string): LeadStageFilter | null {
  const value = exactSingleValue(new URLSearchParams(search), "stage");
  return LEAD_STAGE_FILTERS.find((filter) => filter === value) ?? null;
}

export function inboxBucketFromSearch(search: string): InboxBucket {
  const value = exactSingleValue(new URLSearchParams(search), "bucket");
  return INBOX_BUCKETS.find((bucket) => bucket === value) ?? "inbox";
}

export function operationsHref(view: OperationsView, state: {
  settingsSection?: SettingsSection;
  projectStatus?: ProjectStatusFilter;
  projectLifecycle?: ProjectLifecycleFilter;
  leadStage?: LeadStageFilter;
  inboxBucket?: InboxBucket;
} = {}) {
  const parameters = new URLSearchParams();
  if (view === "Leads" && state.leadStage) parameters.set("stage", state.leadStage);
  if (view === "Settings") {
    const section = state.settingsSection ?? "My account";
    if (section !== "My account") parameters.set("section", settingsSectionSlugs[section]);
  }
  if (view === "Projects") {
    if (state.projectLifecycle) {
      parameters.set("status", state.projectLifecycle);
    } else {
      const status = state.projectStatus ?? "Active";
      if (status !== "Active") parameters.set("status", status.toLowerCase());
    }
  }
  if (view === "Inbox") {
    const bucket = state.inboxBucket ?? "inbox";
    if (bucket !== "inbox") parameters.set("bucket", bucket);
  }
  const search = parameters.toString();
  return `${operationsPath(view)}${search ? `?${search}` : ""}`;
}

export function operationsReturnPath(view: OperationsView, searchParams: OperationsPageSearchParams = {}) {
  if (view === "Leads") {
    return operationsHref(view, {
      leadStage: leadStageFromSearch(pageParameterSearch(searchParams.stage, "stage")) ?? undefined,
    });
  }
  if (view === "Settings") {
    return operationsHref(view, {
      settingsSection: settingsSectionFromSearch(pageParameterSearch(searchParams.section, "section")),
    });
  }
  if (view === "Projects") {
    const statusSearch = pageParameterSearch(searchParams.status, "status");
    return operationsHref(view, {
      projectStatus: projectStatusFromSearch(statusSearch),
      projectLifecycle: projectLifecycleFromSearch(statusSearch) ?? undefined,
    });
  }
  if (view === "Inbox") {
    return operationsHref(view, {
      inboxBucket: inboxBucketFromSearch(pageParameterSearch(searchParams.bucket, "bucket")),
    });
  }
  return operationsPath(view);
}

export function canonicalOperationsSearch(view: OperationsView, search: string) {
  const parameters = new URLSearchParams(search);
  if (view !== "Leads") parameters.delete("stage");
  if (view !== "Settings") parameters.delete("section");
  if (view !== "Projects") parameters.delete("status");
  if (view !== "Inbox") parameters.delete("bucket");

  if (view === "Leads") {
    replaceBoundedParameter(parameters, "stage", LEAD_STAGE_FILTERS, "");
  }
  if (view === "Settings") {
    replaceBoundedParameter(parameters, "section", [...settingsSectionBySlug.keys()], "account");
  }
  if (view === "Projects") {
    replaceBoundedParameter(parameters, "status", ["active", ...PROJECT_LIFECYCLE_FILTERS], "active");
  }
  if (view === "Inbox") {
    replaceBoundedParameter(parameters, "bucket", INBOX_BUCKETS, "inbox");
  }

  parameters.sort();
  return parameters.toString();
}
