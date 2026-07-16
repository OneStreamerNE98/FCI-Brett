import type {
  AuthorizationRecordScope,
  AuthorizationSessionSnapshot,
} from "../ports/authorization";
import {
  AUTHORIZATION_CAPABILITIES,
  type AuthorizationCapability,
} from "./authorization-capabilities";

export {
  AUTHORIZATION_CAPABILITIES,
  type AuthorizationCapability,
} from "./authorization-capabilities";

export const AUTHORIZATION_DOMAIN = "cherryhillfci.com";

export const AUTHORIZATION_ROLES = Object.freeze({
  administrator: "administrator",
  officeOperations: "office_operations",
  projectManager: "project_manager",
} as const);

export type AuthorizationRoleKey =
  (typeof AUTHORIZATION_ROLES)[keyof typeof AUTHORIZATION_ROLES];

const APPROVED_ROLE_CAPABILITIES: Readonly<
  Record<AuthorizationRoleKey, readonly AuthorizationCapability[]>
> = Object.freeze({
  [AUTHORIZATION_ROLES.administrator]: Object.freeze([
    AUTHORIZATION_CAPABILITIES.recordsRead,
    AUTHORIZATION_CAPABILITIES.financialRead,
    AUTHORIZATION_CAPABILITIES.projectsCreate,
    AUTHORIZATION_CAPABILITIES.projectsAssign,
    AUTHORIZATION_CAPABILITIES.gmailFile,
    AUTHORIZATION_CAPABILITIES.calendarCreate,
    AUTHORIZATION_CAPABILITIES.filesShare,
    AUTHORIZATION_CAPABILITIES.dataExport,
    AUTHORIZATION_CAPABILITIES.auditRead,
  ]),
  [AUTHORIZATION_ROLES.officeOperations]: Object.freeze([
    AUTHORIZATION_CAPABILITIES.recordsRead,
  ]),
  [AUTHORIZATION_ROLES.projectManager]: Object.freeze([
    AUTHORIZATION_CAPABILITIES.recordsRead,
  ]),
});

export const AUTHORIZATION_OPERATIONS = Object.freeze({
  dashboardView: "dashboard.view",
  searchQuery: "search.query",
  projectsList: "projects.list",
  projectView: "projects.view",
  clientsList: "clients.list",
  financialsView: "financials.view",
  projectCreate: "projects.create",
  projectAssign: "projects.assign",
  gmailFile: "gmail.file",
  gmailRead: "gmail.read",
  calendarCreate: "calendar.create",
  calendarRead: "calendar.read",
  filesShare: "files.share",
  filesView: "files.view",
  dataExport: "data.export",
  auditView: "audit.view",
  recordsWrite: "records.write",
  jobsRetry: "jobs.retry",
  recoveryManage: "recovery.manage",
  usersManage: "users.manage",
  connectorsManage: "connectors.manage",
  fieldAssignmentOpen: "field.assignment.open",
} as const);

export type AuthorizationOperation =
  (typeof AUTHORIZATION_OPERATIONS)[keyof typeof AUTHORIZATION_OPERATIONS];

type OperationPolicy = Readonly<{
  capability: AuthorizationCapability;
  sensitive: boolean;
  projectTarget: "none" | "optional" | "required";
}>;

const OPERATION_POLICIES: Readonly<Record<AuthorizationOperation, OperationPolicy>> =
  Object.freeze({
    [AUTHORIZATION_OPERATIONS.dashboardView]: {
      capability: AUTHORIZATION_CAPABILITIES.recordsRead,
      sensitive: false,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.searchQuery]: {
      capability: AUTHORIZATION_CAPABILITIES.recordsRead,
      sensitive: false,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.projectsList]: {
      capability: AUTHORIZATION_CAPABILITIES.recordsRead,
      sensitive: false,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.projectView]: {
      capability: AUTHORIZATION_CAPABILITIES.recordsRead,
      sensitive: false,
      projectTarget: "required",
    },
    [AUTHORIZATION_OPERATIONS.clientsList]: {
      capability: AUTHORIZATION_CAPABILITIES.recordsRead,
      sensitive: false,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.financialsView]: {
      capability: AUTHORIZATION_CAPABILITIES.financialRead,
      sensitive: true,
      projectTarget: "optional",
    },
    [AUTHORIZATION_OPERATIONS.projectCreate]: {
      capability: AUTHORIZATION_CAPABILITIES.projectsCreate,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.projectAssign]: {
      capability: AUTHORIZATION_CAPABILITIES.projectsAssign,
      sensitive: true,
      projectTarget: "required",
    },
    [AUTHORIZATION_OPERATIONS.gmailFile]: {
      capability: AUTHORIZATION_CAPABILITIES.gmailFile,
      sensitive: true,
      projectTarget: "required",
    },
    [AUTHORIZATION_OPERATIONS.gmailRead]: {
      capability: AUTHORIZATION_CAPABILITIES.gmailRead,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.calendarCreate]: {
      capability: AUTHORIZATION_CAPABILITIES.calendarCreate,
      sensitive: true,
      projectTarget: "optional",
    },
    [AUTHORIZATION_OPERATIONS.calendarRead]: {
      capability: AUTHORIZATION_CAPABILITIES.calendarRead,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.filesShare]: {
      capability: AUTHORIZATION_CAPABILITIES.filesShare,
      sensitive: true,
      projectTarget: "required",
    },
    [AUTHORIZATION_OPERATIONS.filesView]: {
      capability: AUTHORIZATION_CAPABILITIES.filesRead,
      sensitive: true,
      projectTarget: "required",
    },
    [AUTHORIZATION_OPERATIONS.dataExport]: {
      capability: AUTHORIZATION_CAPABILITIES.dataExport,
      sensitive: true,
      projectTarget: "optional",
    },
    [AUTHORIZATION_OPERATIONS.auditView]: {
      capability: AUTHORIZATION_CAPABILITIES.auditRead,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.recordsWrite]: {
      capability: AUTHORIZATION_CAPABILITIES.recordsWrite,
      sensitive: true,
      projectTarget: "required",
    },
    [AUTHORIZATION_OPERATIONS.jobsRetry]: {
      capability: AUTHORIZATION_CAPABILITIES.jobsRetry,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.recoveryManage]: {
      capability: AUTHORIZATION_CAPABILITIES.recoveryManage,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.usersManage]: {
      capability: AUTHORIZATION_CAPABILITIES.usersManage,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.connectorsManage]: {
      capability: AUTHORIZATION_CAPABILITIES.connectorsManage,
      sensitive: true,
      projectTarget: "none",
    },
    [AUTHORIZATION_OPERATIONS.fieldAssignmentOpen]: {
      capability: AUTHORIZATION_CAPABILITIES.fieldAssignmentRead,
      sensitive: true,
      projectTarget: "required",
    },
  });

export function isAuthorizationOperation(value: string): value is AuthorizationOperation {
  return Object.hasOwn(OPERATION_POLICIES, value);
}

export type EmployeeAdmissionInput = Readonly<{
  email: string;
  emailVerified: boolean;
  hostedDomain: string | null;
  explicitlyInvited: boolean;
  requestedRole: string;
}>;

export type EmployeeAdmissionDenialReason =
  | "outside_domain"
  | "email_unverified"
  | "invitation_required"
  | "employee_account_not_allowed"
  | "role_not_approved";

export type EmployeeAdmissionDecision =
  | Readonly<{
      allowed: true;
      email: string;
      role: AuthorizationRoleKey;
    }>
  | Readonly<{
      allowed: false;
      reason: EmployeeAdmissionDenialReason;
    }>;

function knownRole(value: string): value is AuthorizationRoleKey {
  return Object.values(AUTHORIZATION_ROLES).includes(value as AuthorizationRoleKey);
}

function emailDomain(email: string) {
  const separator = email.lastIndexOf("@");
  return separator > 0 ? email.slice(separator + 1) : "";
}

function immutableSet<T>(values: Iterable<T>): ReadonlySet<T> {
  const source = new Set(values);
  const view: ReadonlySet<T> = Object.freeze({
    get size() {
      return source.size;
    },
    has(value: T) {
      return source.has(value);
    },
    entries() {
      return source.entries();
    },
    keys() {
      return source.keys();
    },
    values() {
      return source.values();
    },
    forEach(
      callback: (value: T, valueAgain: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ) {
      source.forEach((value) => callback.call(thisArg, value, value, view));
    },
    [Symbol.iterator]() {
      return source[Symbol.iterator]();
    },
  });
  return view;
}

export function evaluateEmployeeAdmission(
  input: EmployeeAdmissionInput,
): EmployeeAdmissionDecision {
  const email = input.email.trim().toLowerCase();
  const hostedDomain = input.hostedDomain?.trim().toLowerCase() ?? null;
  if (hostedDomain !== AUTHORIZATION_DOMAIN || emailDomain(email) !== AUTHORIZATION_DOMAIN) {
    return { allowed: false, reason: "outside_domain" };
  }
  if (!input.emailVerified) return { allowed: false, reason: "email_unverified" };
  if (!input.explicitlyInvited) return { allowed: false, reason: "invitation_required" };
  if (["field_lead", "subcontractor"].includes(input.requestedRole)) {
    return { allowed: false, reason: "employee_account_not_allowed" };
  }
  if (!knownRole(input.requestedRole)) {
    return { allowed: false, reason: "role_not_approved" };
  }
  return { allowed: true, email, role: input.requestedRole };
}

export type EmployeeAccessContext = Readonly<{
  principalKind: "employee";
  sessionId: string;
  sessionVersion: string;
  userId: string;
  email: string;
  authorizationVersion: string;
  roles: readonly AuthorizationRoleKey[];
  capabilities: ReadonlySet<AuthorizationCapability>;
  recordScope: AuthorizationRecordScope;
}>;

export type SessionDenialReason =
  | "invalid_session"
  | "session_revoked"
  | "user_disabled"
  | "outside_domain"
  | "authorization_changed"
  | "session_invalidated"
  | "absolute_expired"
  | "idle_expired"
  | "role_not_approved";

export type SessionAccessDecision =
  | Readonly<{ allowed: true; context: EmployeeAccessContext }>
  | Readonly<{ allowed: false; reason: SessionDenialReason }>;

function safeNow(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Authorization time must be a nonnegative safe epoch-millisecond value");
  }
  return value;
}

export function resolveEmployeeAccessContext(
  snapshot: AuthorizationSessionSnapshot | null,
  nowValue: number,
): SessionAccessDecision {
  const now = safeNow(nowValue);
  if (!snapshot) return { allowed: false, reason: "invalid_session" };
  const issuedAt = safeNow(snapshot.issuedAt);
  const lastSeenAt = safeNow(snapshot.lastSeenAt);
  const sessionsValidAfter = safeNow(snapshot.sessionsValidAfter);
  const absoluteExpiresAt = safeNow(snapshot.absoluteExpiresAt);
  const idleExpiresAt = safeNow(snapshot.idleExpiresAt);
  if (snapshot.revokedAt !== null) {
    safeNow(snapshot.revokedAt);
    return { allowed: false, reason: "session_revoked" };
  }
  if (snapshot.userStatus !== "active") return { allowed: false, reason: "user_disabled" };
  if (
    issuedAt > now ||
    lastSeenAt < issuedAt ||
    lastSeenAt >= idleExpiresAt ||
    idleExpiresAt > absoluteExpiresAt
  ) {
    return { allowed: false, reason: "invalid_session" };
  }
  const email = snapshot.email.trim().toLowerCase();
  if (emailDomain(email) !== AUTHORIZATION_DOMAIN) {
    return { allowed: false, reason: "outside_domain" };
  }
  if (snapshot.userAuthorizationVersion !== snapshot.sessionAuthorizationVersion) {
    return { allowed: false, reason: "authorization_changed" };
  }
  if (issuedAt < sessionsValidAfter) {
    return { allowed: false, reason: "session_invalidated" };
  }
  if (now >= absoluteExpiresAt) {
    return { allowed: false, reason: "absolute_expired" };
  }
  if (now >= idleExpiresAt) return { allowed: false, reason: "idle_expired" };

  const persistedRoles = new Set<string>();
  for (const grant of snapshot.roleGrants) {
    if (persistedRoles.has(grant.roleKey) || !knownRole(grant.roleKey)) {
      return { allowed: false, reason: "role_not_approved" };
    }
    persistedRoles.add(grant.roleKey);
  }
  if (persistedRoles.size === 0) {
    return { allowed: false, reason: "role_not_approved" };
  }

  const policyCapabilities = new Set<AuthorizationCapability>();
  const effectiveRoles = new Set<AuthorizationRoleKey>();
  for (const grant of snapshot.roleGrants) {
    const role = grant.roleKey as AuthorizationRoleKey;
    const persistedCapabilities = new Set(grant.capabilityKeys);
    if (!persistedCapabilities.has(AUTHORIZATION_CAPABILITIES.recordsRead)) continue;
    effectiveRoles.add(role);
    for (const capability of APPROVED_ROLE_CAPABILITIES[role]) {
      if (persistedCapabilities.has(capability)) policyCapabilities.add(capability);
    }
  }
  const roles = [...effectiveRoles].sort();
  if (roles.length === 0) return { allowed: false, reason: "role_not_approved" };
  const capabilities = policyCapabilities;
  const companyWide = roles.includes(AUTHORIZATION_ROLES.administrator) ||
    roles.includes(AUTHORIZATION_ROLES.officeOperations);
  const recordScope: AuthorizationRecordScope = Object.freeze({
    kind: companyWide ? "company" : "assigned_projects",
    sessionId: snapshot.sessionId,
    sessionVersion: snapshot.sessionVersion,
    userId: snapshot.userId,
    authorizationVersion: snapshot.userAuthorizationVersion,
    includeFinancial: capabilities.has(AUTHORIZATION_CAPABILITIES.financialRead),
  });

  return {
    allowed: true,
    context: Object.freeze({
      principalKind: "employee",
      sessionId: snapshot.sessionId,
      sessionVersion: snapshot.sessionVersion,
      userId: snapshot.userId,
      email,
      authorizationVersion: snapshot.userAuthorizationVersion,
      roles: Object.freeze(roles),
      capabilities: immutableSet(capabilities),
      recordScope,
    }),
  };
}

export type FieldLinkSnapshot = Readonly<{
  /** Opaque persisted identifier for audit correlation, never the bearer link credential. */
  linkId: string;
  projectId: string;
  expiresAt: number;
  revokedAt: number | null;
}>;

export type FieldLinkAccessContext = Readonly<{
  principalKind: "field_link";
  linkId: string;
  projectId: string;
  capabilities: ReadonlySet<AuthorizationCapability>;
}>;

export type FieldLinkDenialReason = "link_revoked" | "link_expired";

export type FieldLinkDecision =
  | Readonly<{ allowed: true; context: FieldLinkAccessContext }>
  | Readonly<{ allowed: false; reason: FieldLinkDenialReason }>;

export function resolveFieldLinkAccess(
  snapshot: FieldLinkSnapshot,
  nowValue: number,
): FieldLinkDecision {
  const now = safeNow(nowValue);
  const expiresAt = safeNow(snapshot.expiresAt);
  if (snapshot.revokedAt !== null) {
    safeNow(snapshot.revokedAt);
    return { allowed: false, reason: "link_revoked" };
  }
  if (now >= expiresAt) return { allowed: false, reason: "link_expired" };
  return {
    allowed: true,
    context: Object.freeze({
      principalKind: "field_link",
      linkId: snapshot.linkId,
      projectId: snapshot.projectId,
      capabilities: immutableSet([AUTHORIZATION_CAPABILITIES.fieldAssignmentRead]),
    }),
  };
}

export type AccessContext = EmployeeAccessContext | FieldLinkAccessContext;

export type OperationDenialReason =
  | "unknown_operation"
  | "missing_capability"
  | "project_required"
  | "outside_project_scope";

export type OperationDecision =
  | Readonly<{
      allowed: true;
      sensitive: boolean;
      requiresProjectCheck: boolean;
      capability: AuthorizationCapability;
    }>
  | Readonly<{
      allowed: false;
      reason: OperationDenialReason;
      sensitive: boolean;
    }>;

export function authorizeOperation(
  context: AccessContext,
  operation: string,
  projectId: string | null = null,
): OperationDecision {
  if (!isAuthorizationOperation(operation)) {
    return { allowed: false, reason: "unknown_operation", sensitive: true };
  }
  const policy = OPERATION_POLICIES[operation];
  if (policy.projectTarget === "required" && !projectId) {
    return { allowed: false, reason: "project_required", sensitive: policy.sensitive };
  }
  if (!context.capabilities.has(policy.capability)) {
    return { allowed: false, reason: "missing_capability", sensitive: policy.sensitive };
  }
  if (
    context.principalKind === "field_link" &&
    projectId !== context.projectId
  ) {
    return { allowed: false, reason: "outside_project_scope", sensitive: policy.sensitive };
  }
  return {
    allowed: true,
    sensitive: policy.sensitive,
    requiresProjectCheck: context.principalKind === "employee" && projectId !== null,
    capability: policy.capability,
  };
}

export function approvedCapabilitiesForRole(role: AuthorizationRoleKey) {
  return APPROVED_ROLE_CAPABILITIES[role];
}
