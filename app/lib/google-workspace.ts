export type FilingRuleDraft = {
  id?: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchSummary: string;
  action: "suggest" | "review" | "ignore";
  targetCategory: string;
  approvalRequired: boolean;
};

/** The small, explicit set of inbox matchers supported by the first prototype. */
export type FilingRuleMatcher = "exact-project-number" | "known-contact-one-project" | "multiple-project-client";

export type InboxRuleMessage = {
  from: string | null;
  subject?: string | null;
  snippet?: string | null;
};

export type InboxRuleProject = {
  id: string;
  clientId: string;
  number: string;
  client: string;
  status?: string | null;
};

export type InboxRuleClient = {
  id: string;
  name: string;
  contact?: string | null;
  email?: string | null;
};

export type InboxRuleDecision = {
  kind: "project" | "needs-review" | "intake" | "ignored";
  ruleName?: string;
  project?: Pick<InboxRuleProject, "id" | "number" | "client" | "status">;
  reason: string;
  /** Rules only guide the filing review; none can label, move, or archive Gmail. */
  requiresManualReview: true;
};

export const DEFAULT_FILING_RULES: FilingRuleDraft[] = [
  {
    name: "Exact project number",
    enabled: true,
    priority: 1,
    matchSummary: "Project number in the subject or message body",
    action: "suggest",
    targetCategory: "05_Correspondence / Email Archive",
    approvalRequired: true,
  },
  {
    name: "Known contact with one active project",
    enabled: true,
    priority: 2,
    matchSummary: "Sender matches a client contact and only one eligible active project exists",
    action: "suggest",
    targetCategory: "05_Correspondence / Email Archive",
    approvalRequired: true,
  },
  {
    name: "Multiple-project client review",
    enabled: true,
    priority: 3,
    matchSummary: "Sender matches a client that has more than one possible project",
    action: "review",
    targetCategory: "99_Unsorted Intake",
    approvalRequired: true,
  },
];

const DEFAULT_RULE_MATCHERS: Record<string, FilingRuleMatcher> = {
  "exact project number": "exact-project-number",
  "known contact with one active project": "known-contact-one-project",
  "multiple-project client review": "multiple-project-client",
};

/**
 * Returns a deterministic matcher only for the three built-in rules. Free-text
 * custom rules remain review policies until a supported matcher is added.
 */
export function getFilingRuleMatcher(rule: FilingRuleDraft): FilingRuleMatcher | null {
  return DEFAULT_RULE_MATCHERS[rule.name.trim().toLowerCase()] ?? null;
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function senderEmail(from: string | null) {
  return from?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase() ?? "";
}

function senderMatchesClient(from: string | null, client: InboxRuleClient) {
  const normalizedFrom = normalized(from);
  const email = senderEmail(from);
  const clientEmail = normalized(client.email);
  if (email && clientEmail && email === clientEmail) return true;
  const contact = normalized(client.contact);
  return contact.length >= 3 && normalizedFrom.includes(contact);
}

function isEligibleProject(project: InboxRuleProject) {
  const status = normalized(project.status);
  return status !== "closeout" && status !== "archived" && status !== "cancelled";
}

function decisionForMatch(input: {
  rule: FilingRuleDraft;
  project?: InboxRuleProject;
  reason: string;
}): InboxRuleDecision {
  const project = input.project ? { id: input.project.id, number: input.project.number, client: input.project.client, status: input.project.status } : undefined;
  if (input.rule.action === "ignore") return { kind: "ignored", ruleName: input.rule.name, project, reason: input.reason, requiresManualReview: true };
  if (input.rule.action === "review" || !project) return { kind: "needs-review", ruleName: input.rule.name, project, reason: input.reason, requiresManualReview: true };
  return { kind: "project", ruleName: input.rule.name, project, reason: input.reason, requiresManualReview: true };
}

/**
 * Applies enabled built-in rules in priority order. This only produces an inbox
 * hint; filing still needs an exact project selection and explicit approval.
 */
export function evaluateInboxFilingRules(input: {
  message: InboxRuleMessage;
  projects: InboxRuleProject[];
  clients: InboxRuleClient[];
  rules: FilingRuleDraft[];
}): InboxRuleDecision {
  const searchable = [input.message.from, input.message.subject, input.message.snippet].filter(Boolean).join(" ").toLowerCase();
  const matchedClientIds = input.clients.filter((client) => senderMatchesClient(input.message.from, client)).map((client) => client.id);
  const eligibleProjects = (clientId: string) => input.projects.filter((project) => project.clientId === clientId && isEligibleProject(project));
  const rules = input.rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled)
    .sort((left, right) => left.rule.priority - right.rule.priority || left.index - right.index);

  for (const { rule } of rules) {
    const matcher = getFilingRuleMatcher(rule);
    if (matcher === "exact-project-number") {
      const project = [...input.projects].sort((left, right) => left.number.localeCompare(right.number)).find((item) => searchable.includes(item.number.toLowerCase()));
      if (project) return decisionForMatch({ rule, project, reason: `Exact project number ${project.number} appears in the loaded message.` });
    }
    if (matcher === "known-contact-one-project") {
      const candidates = [...new Map(matchedClientIds.flatMap((clientId) => eligibleProjects(clientId)).map((project) => [project.id, project])).values()];
      if (candidates.length === 1) return decisionForMatch({ rule, project: candidates[0], reason: `The sender matches a known contact with one eligible project: ${candidates[0].number}.` });
    }
    if (matcher === "multiple-project-client") {
      const clientId = matchedClientIds.find((id) => eligibleProjects(id).length > 1);
      if (clientId) return decisionForMatch({ rule, reason: "The sender matches a client with multiple eligible independent projects." });
    }
  }

  return { kind: "intake", reason: "No enabled built-in filing rule matched this message.", requiresManualReview: true };
}

export const DRIVE_BLUEPRINT = {
  sharedDriveName: "FCI Operations",
  temporaryWorkspaceName: "FCI Operations — Temporary",
  roots: [
    "00_Company Admin / Client Directory (Google Sheet)",
    "01_Client Accounts / {CLIENT_CODE} — {CLIENT_NAME} / 00_Client Profile & Master Documents",
    "02_Projects / {YEAR} / {PROJECT_NUMBER} — {PROJECT_NAME}",
    "99_Archive",
    "99_Unsorted Intake",
  ],
  projectFolders: [
    "00_Admin",
    "01_Lead & Proposal",
    "02_Contract & Submittals",
    "03_Schedule & Field",
    "04_Photos & QA",
    "05_Correspondence / Email Archive",
    "05_Correspondence / Email Attachments",
    "06_Closeout",
  ],
  gmailLabels: ["FCI/Intake", "FCI/Needs Review", "FCI/Filed"],
} as const;

export type DriveWorkspaceMode = "shared-drive" | "my-drive";

export function resolveDriveWorkspace(input: {
  mode?: string;
  rootFolderId?: string;
  sharedDriveId?: string;
}) {
  const requestedMode = input.mode?.trim().toLowerCase();
  const modeIsValid = !requestedMode || requestedMode === "shared-drive" || requestedMode === "my-drive";
  const mode: DriveWorkspaceMode = requestedMode === "my-drive" ? "my-drive" : "shared-drive";
  const rootFolderId = mode === "my-drive" ? input.rootFolderId?.trim() : input.sharedDriveId?.trim();
  const isTemporary = mode === "my-drive";

  return {
    mode,
    modeIsValid,
    rootFolderId,
    isTemporary,
    storageLabel: isTemporary ? "Temporary My Drive workspace" : "Company Shared Drive",
    storageName: isTemporary ? DRIVE_BLUEPRINT.temporaryWorkspaceName : DRIVE_BLUEPRINT.sharedDriveName,
    storageRequirementLabel: isTemporary ? "temporary Google Drive root folder ID" : "Shared Drive ID",
  };
}

export function buildProjectFolderPlan(input: {
  clientCode: string;
  clientName: string;
  projectNumber: string;
  projectName: string;
  year?: string;
}) {
  const year = input.year ?? new Date().getUTCFullYear().toString();
  const clientFolder = `01_Client Accounts/${input.clientCode} — ${input.clientName}`;
  const projectFolder = `02_Projects/${year}/${input.projectNumber} — ${input.projectName}`;
  return {
    clientFolder,
    clientFolders: ["00_Client Profile & Master Documents", "Projects (shortcuts only)"],
    projectFolder,
    projectFolders: DRIVE_BLUEPRINT.projectFolders,
    gmailLabels: DRIVE_BLUEPRINT.gmailLabels,
  };
}

export function chooseEmailDestination(input: {
  projectNumber?: string | null;
  explicitProjectId?: string | null;
  eligibleProjectIds: string[];
}) {
  if (input.projectNumber || input.explicitProjectId) return "suggest-project" as const;
  if (input.eligibleProjectIds.length === 1) return "suggest-project" as const;
  if (input.eligibleProjectIds.length > 1) return "needs-project-selection" as const;
  return "needs-review" as const;
}
