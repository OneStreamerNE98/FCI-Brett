export type AuthorizationUserStatus = "active" | "disabled";

export type AuthorizationRoleGrantSnapshot = Readonly<{
  roleKey: string;
  capabilityKeys: readonly string[];
}>;

export type AuthorizationSessionSnapshot = Readonly<{
  sessionId: string;
  sessionVersion: string;
  userId: string;
  email: string;
  userStatus: AuthorizationUserStatus;
  userAuthorizationVersion: string;
  sessionAuthorizationVersion: string;
  sessionsValidAfter: number;
  issuedAt: number;
  lastSeenAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  revokedAt: number | null;
  roleGrants: readonly AuthorizationRoleGrantSnapshot[];
}>;

export type AuthorizationRecordScope = Readonly<{
  kind: "company" | "assigned_projects";
  sessionId: string;
  sessionVersion: string;
  userId: string;
  authorizationVersion: string;
  includeFinancial: boolean;
}>;

type AuthorizedProjectBase = Readonly<{
  id: string;
  projectNumber: string;
  clientId: string;
  clientName: string;
  name: string;
  status: string;
  site: string | null;
  projectManagerId: string;
  updatedAt: number;
  version: string;
}>;

export type AuthorizedProjectSummary =
  | (AuthorizedProjectBase & Readonly<{
      financialVisible: true;
      estimatedValue: number | null;
    }>)
  | (AuthorizedProjectBase & Readonly<{
      financialVisible: false;
    }>);

export type AuthorizedClientSummary = Readonly<{
  id: string;
  clientCode: string;
  name: string;
  status: string;
  primaryContact: Readonly<{
    name: string;
    email: string | null;
    phone: string | null;
  }> | null;
}>;

export type AuthorizedDashboardSummary = Readonly<{
  projectCount: number;
  activeProjectCount: number;
  completedProjectCount: number;
  financialVisible: boolean;
  estimatedValueTotal?: number;
}>;

/**
 * Read-only authorization and scoped-record boundary. Callers supply only a
 * canonical SHA-256 digest, never a raw session credential. Every record query
 * rechecks the active user and authorization version inside SQL and applies
 * project membership before aggregation, ranking, limiting, or serialization.
 */
export interface AuthorizationRepository {
  findSessionByTokenHash(
    tokenHash: string,
    now: number,
  ): Promise<AuthorizationSessionSnapshot | null>;
  projectExistsForScope(
    scope: AuthorizationRecordScope,
    projectId: string,
    now: number,
  ): Promise<boolean>;
  administratorCapabilityIsCurrent(
    scope: AuthorizationRecordScope,
    capabilityKey: string,
    now: number,
  ): Promise<boolean>;
  listProjectsForScope(
    scope: AuthorizationRecordScope,
    now: number,
    limit: number,
  ): Promise<readonly AuthorizedProjectSummary[]>;
  listClientsForScope(
    scope: AuthorizationRecordScope,
    now: number,
    limit: number,
  ): Promise<readonly AuthorizedClientSummary[]>;
  searchProjectsForScope(
    scope: AuthorizationRecordScope,
    query: string,
    now: number,
    limit: number,
  ): Promise<readonly AuthorizedProjectSummary[]>;
  getDashboardForScope(
    scope: AuthorizationRecordScope,
    now: number,
  ): Promise<AuthorizedDashboardSummary>;
}
