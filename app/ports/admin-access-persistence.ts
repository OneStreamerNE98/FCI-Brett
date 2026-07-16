import type { SecurityAuditEvent } from "./security-audit";
import type { AuthorizationRecordScope } from "./authorization";

export const ADMIN_ACCESS_ROLE_KEYS = [
  "administrator",
  "office_operations",
  "project_manager",
] as const;

export type AdminAccessRoleKey = (typeof ADMIN_ACCESS_ROLE_KEYS)[number];

export type AdminAccessPersonSummary = Readonly<{
  id: string;
  email: string;
  displayName: string;
  status: "active" | "disabled";
  role: AdminAccessRoleKey;
  projectIds: readonly string[];
  lastSignedInAt: number | null;
  version: string;
}>;

export type AdminAccessInvitationSummary = Readonly<{
  id: string;
  email: string;
  role: AdminAccessRoleKey;
  status: "pending";
  projectIds: readonly string[];
  createdAt: number;
  expiresAt: number;
  version: string;
}>;

export type AdminAccessProjectSummary = Readonly<{
  id: string;
  projectNumber: string;
  name: string;
  status: string;
}>;

export type AdminAccessRoleSummary = Readonly<{
  key: AdminAccessRoleKey;
  displayName: string;
  description: string;
}>;

export type AdminAccessOverview = Readonly<{
  summary: Readonly<{
    activePeopleCount: number;
    activeAdministratorCount: number;
    pendingInvitationCount: number;
  }>;
  roles: readonly AdminAccessRoleSummary[];
  people: readonly AdminAccessPersonSummary[];
  invitations: readonly AdminAccessInvitationSummary[];
  projects: readonly AdminAccessProjectSummary[];
  generatedAt: number;
}>;

export type AdminAccessOverviewResult =
  | Readonly<{ outcome: "accepted"; overview: AdminAccessOverview }>
  | Readonly<{ outcome: "actor_authorization_changed" }>;

type AdminAccessActor = Readonly<{
  actorUserId: string;
  actorKey: string;
  actorSessionId: string;
  actorSessionVersion: string;
  actorAuthorizationVersion: string;
  reasonCode: string;
  changedAt: number;
  audit: SecurityAuditEvent;
}>;

export type CreateAdminInvitationIntent = Readonly<{
  id: string;
  email: string;
  tokenHash: string;
  role: AdminAccessRoleKey;
  /** Exact intended projects; required only for Project Manager invitations. */
  projectIds: readonly string[];
  invitedByUserId: string;
  invitedByActorKey: string;
  actorSessionId: string;
  actorSessionVersion: string;
  actorAuthorizationVersion: string;
  expiresAt: number;
  purgeAfter: number;
  createdAt: number;
  audit: SecurityAuditEvent;
}>;

export type RevokeAdminInvitationIntent = AdminAccessActor & Readonly<{
  invitationId: string;
  expectedVersion: string;
}>;

export type SetUserAccessIntent = AdminAccessActor & Readonly<{
  userId: string;
  expectedVersion: string;
  role: AdminAccessRoleKey;
  /** Exact desired set. This must be empty unless role is project_manager. */
  projectIds: readonly string[];
}>;

export type DisableUserAccessIntent = AdminAccessActor & Readonly<{
  userId: string;
  expectedVersion: string;
}>;

export type InvalidateUserSessionsIntent = AdminAccessActor & Readonly<{
  userId: string;
  expectedVersion: string;
}>;

export type AdminAccessPersistenceResult =
  | Readonly<{
      outcome: "accepted";
      version: string;
      authorizationVersion: string | null;
    }>
  | Readonly<{ outcome: "conflict" }>
  | Readonly<{ outcome: "stale" }>
  | Readonly<{ outcome: "actor_authorization_changed" }>
  | Readonly<{ outcome: "final_active_administrator" }>;

/**
 * Fixed first-release administration commands. Role definitions and
 * capabilities are migration-owned and deliberately absent from this port.
 */
export interface AdminAccessPersistenceRepository {
  /**
   * Returns the bounded People & Access projection only while the exact
   * Administrator session and authorization version remain current. A null
   * result means the post-authorization database fence no longer holds.
   */
  getAccessOverview(
    scope: AuthorizationRecordScope,
    now: number,
  ): Promise<AdminAccessOverviewResult>;
  createInvitation(intent: CreateAdminInvitationIntent): Promise<AdminAccessPersistenceResult>;
  revokeInvitation(intent: RevokeAdminInvitationIntent): Promise<AdminAccessPersistenceResult>;
  setUserAccess(intent: SetUserAccessIntent): Promise<AdminAccessPersistenceResult>;
  disableUser(intent: DisableUserAccessIntent): Promise<AdminAccessPersistenceResult>;
  invalidateUserSessions(intent: InvalidateUserSessionsIntent): Promise<AdminAccessPersistenceResult>;
}
