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
  createSession(intent: CreateSessionIntent): Promise<IdentityPersistenceResult>;
  revokeSession(intent: RevokeSessionIntent): Promise<IdentityPersistenceResult>;
}
