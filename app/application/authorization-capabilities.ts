export const AUTHORIZATION_CAPABILITIES = Object.freeze({
  recordsRead: "records.read",
  clientsCreate: "clients.create",
  financialRead: "financials.read",
  projectsCreate: "projects.create",
  projectsAssign: "projects.assign",
  gmailFile: "gmail.file",
  calendarCreate: "calendar.create",
  filesShare: "files.share",
  dataExport: "data.export",
  auditRead: "audit.read",
  fieldAssignmentRead: "field.assignment.read",

  // Cataloged but deliberately unmapped until the owner approves them.
  gmailRead: "gmail.read",
  calendarRead: "calendar.read",
  filesRead: "files.read",
  recordsWrite: "records.write",
  jobsRetry: "jobs.retry",
  recoveryManage: "recovery.manage",
  usersManage: "users.manage",
  connectorsManage: "connectors.manage",
} as const);

export type AuthorizationCapability =
  (typeof AUTHORIZATION_CAPABILITIES)[keyof typeof AUTHORIZATION_CAPABILITIES];
