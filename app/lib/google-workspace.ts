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

export const DRIVE_BLUEPRINT = {
  sharedDriveName: "Groundwork Operations",
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
  gmailLabels: ["Groundwork/Intake", "Groundwork/Needs Review", "Groundwork/Filed"],
} as const;

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
