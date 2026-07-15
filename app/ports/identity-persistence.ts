import type { SecurityAuditEvent } from "./security-audit";

export type UserStatus = "active" | "disabled";

export type IdentityUser = Readonly<{
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  authorizationVersion: string;
  sessionsValidAfter: number;
  createdAt: number;
  updatedAt: number;
  version: string;
}>;

export type RegisterExternalIdentityIntent = Readonly<{
  user: Omit<IdentityUser, "authorizationVersion" | "version">;
  identity: Readonly<{
    id: string;
    provider: string;
    issuer: string;
    subject: string;
    email: string;
    hostedDomain: string | null;
    emailVerified: boolean;
    firstSeenAt: number;
    lastAuthenticatedAt: number;
  }>;
  audit: SecurityAuditEvent;
}>;

export type CreateInvitationIntent = Readonly<{
  id: string;
  email: string;
  tokenHash: string;
  invitedByUserId: string | null;
  invitedByActorKey: string;
  expiresAt: number;
  purgeAfter: number;
  createdAt: number;
  audit: SecurityAuditEvent;
}>;

export type CreateSessionIntent = Readonly<{
  id: string;
  userId: string;
  tokenHash: string;
  csrfHash: string;
  authorizationVersion: string;
  /** Rotation remains unavailable until predecessor revocation is atomic. */
  rotatedFromSessionId: null;
  issuedAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  purgeAfter: number;
  audit: SecurityAuditEvent;
}>;

export type RevokeSessionIntent = Readonly<{
  sessionId: string;
  expectedVersion: string;
  revokedAt: number;
  revokedByActorKey: string;
  reasonCode: string;
  audit: SecurityAuditEvent;
}>;

export type IdentityDefinition = Readonly<{
  id: string;
  key: string;
  displayName: string;
  description: string | null;
  createdAt: number;
  audit: SecurityAuditEvent;
}>;

export type IdentityGrant = Readonly<{
  subjectId: string;
  valueId: string;
  assignedByUserId: string | null;
  assignedByActorKey: string;
  assignedAt: number;
  expiresAt: number | null;
  audit: SecurityAuditEvent;
}>;

export type IdentityPersistenceResult =
  | { outcome: "accepted"; version: string }
  | { outcome: "conflict" }
  | { outcome: "stale" };

/**
 * Persistence mechanics only. Capability evaluation, access-context
 * resolution, and route authorization belong to the later authorization
 * simulation slice after the owner approves the 20-user access matrix.
 */
export interface IdentityPersistenceRepository {
  registerExternalIdentity(intent: RegisterExternalIdentityIntent): Promise<IdentityPersistenceResult>;
  createInvitation(intent: CreateInvitationIntent): Promise<IdentityPersistenceResult>;
  createSession(intent: CreateSessionIntent): Promise<IdentityPersistenceResult>;
  revokeSession(intent: RevokeSessionIntent): Promise<IdentityPersistenceResult>;
  createRole(intent: IdentityDefinition): Promise<IdentityPersistenceResult>;
  createCapability(intent: IdentityDefinition): Promise<IdentityPersistenceResult>;
  grantCapabilityToRole(intent: Omit<IdentityGrant, "expiresAt">): Promise<IdentityPersistenceResult>;
  assignRoleToUser(intent: IdentityGrant): Promise<IdentityPersistenceResult>;
  assignProjectToUser(intent: IdentityGrant): Promise<IdentityPersistenceResult>;
}
