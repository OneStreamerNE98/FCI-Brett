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

export type AuthenticateEmployeeIdentity = Readonly<{
  provider: "google_oidc";
  issuer: string;
  subject: string;
  email: string;
  hostedDomain: string;
  emailVerified: true;
  displayName: string;
}>;

/**
 * One short database transaction either signs in an already-bound immutable
 * identity or consumes one exact invitation while creating its user, fixed
 * role/project scope, external identity, and first session.
 */
export type AuthenticateEmployeeSessionIntent = Readonly<{
  identity: AuthenticateEmployeeIdentity;
  /** Null for an already-bound employee; required for first admission. */
  invitationTokenHash: string | null;
  newUserId: string;
  newExternalIdentityId: string;
  session: Readonly<{
    id: string;
    tokenHash: string;
    csrfHash: string;
    issuedAt: number;
    idleExpiresAt: number;
    absoluteExpiresAt: number;
    purgeAfter: number;
  }>;
  loginAudit: SecurityAuditEvent;
  invitationAudit: SecurityAuditEvent;
}>;

export type AuthenticateEmployeeSessionDenialReason =
  | "invitation_required"
  | "invitation_invalid"
  | "invitation_expired"
  | "invitation_email_mismatch"
  | "identity_conflict"
  | "user_unavailable"
  | "role_not_approved";

export type AuthenticateEmployeeSessionResult =
  | Readonly<{
      outcome: "accepted";
      userId: string;
      email: string;
      authorizationVersion: string;
      sessionVersion: string;
      invitationRedeemed: boolean;
    }>
  | Readonly<{
      outcome: "denied";
      reason: AuthenticateEmployeeSessionDenialReason;
    }>
  | Readonly<{ outcome: "conflict" }>;

export type IdentityPersistenceResult =
  | { outcome: "accepted"; version: string }
  | { outcome: "conflict" }
  | { outcome: "stale" };

/**
 * Employee identity and session lifecycle only. Fixed-role invitation and
 * access administration uses the narrower AdminAccessPersistenceRepository.
 */
export interface IdentityPersistenceRepository {
  registerExternalIdentity(intent: RegisterExternalIdentityIntent): Promise<IdentityPersistenceResult>;
  authenticateEmployeeSession(
    intent: AuthenticateEmployeeSessionIntent,
  ): Promise<AuthenticateEmployeeSessionResult>;
  createSession(intent: CreateSessionIntent): Promise<IdentityPersistenceResult>;
  revokeSession(intent: RevokeSessionIntent): Promise<IdentityPersistenceResult>;
}
