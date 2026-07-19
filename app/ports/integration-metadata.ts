import type { SecurityAuditEvent } from "./security-audit";

export type IntegrationConnectionStatus =
  | "pending"
  | "connected"
  | "degraded"
  | "reauthorization_required"
  | "revoked"
  | "disabled";

export type RegisterIntegrationConnectionIntent = Readonly<{
  id: string;
  provider: string;
  connectionKey: string;
  createdByUserId: string | null;
  createdByActorKey: string;
  createdAt: number;
  audit: SecurityAuditEvent;
}>;

export type CreateIntegrationOauthAttemptIntent = Readonly<{
  id: string;
  connectionId: string;
  initiatedByUserId: string;
  stateHash: string;
  browserNonceHash: string;
  pkceVerifierCiphertext: Uint8Array;
  keyVersion: string;
  requestedScopes: readonly string[];
  expiresAt: number;
  purgeAfter: number;
  createdAt: number;
  audit: SecurityAuditEvent;
}>;

export type ConsumeIntegrationOauthAttemptIntent = Readonly<{
  connectionId: string;
  stateHash: string;
  browserNonceHash: string;
  initiatedByUserId: string;
  consumedAt: number;
  expectedVersion: string;
  audit: SecurityAuditEvent;
}>;

export type ConsumedIntegrationOauthAttempt = Readonly<{
  id: string;
  pkceVerifierCiphertext: Uint8Array;
  keyVersion: string;
  version: string;
}>;

export type CompleteIntegrationOauthConnectionIntent = Readonly<{
  connectionId: string;
  expectedConnectionVersion: string;
  issuer: string;
  externalSubject: string;
  externalEmail: string;
  hostedDomain: string;
  credentialId: string;
  refreshTokenCiphertext: Uint8Array;
  keyVersion: string;
  grantedScopes: readonly string[];
  completedByUserId: string;
  completedByActorKey: string;
  completedAt: number;
  audit: SecurityAuditEvent;
}>;

export type ActiveIntegrationCredential = Readonly<{
  id: string;
  connectionId: string;
  credentialKind: string;
  ciphertext: Uint8Array;
  keyVersion: string;
  version: string;
}>;

export type RotateIntegrationCredentialIntent = Readonly<{
  connectionId: string;
  credentialId: string;
  credentialKind: string;
  expectedVersion: string;
  ciphertext: Uint8Array;
  keyVersion: string;
  rotatedAt: number;
  audit: SecurityAuditEvent;
}>;

export type RegisterIntegrationResourceIntent = Readonly<{
  id: string;
  connectionId: string;
  resourceType: string;
  resourceKey: string;
  externalId: string;
  parentExternalId: string | null;
  externalUrl: string | null;
  owner:
    | { type: "workspace" }
    | { type: "client"; clientId: string }
    | { type: "project"; projectId: string };
  metadata: Readonly<Record<string, unknown>>;
  createdAt: number;
  audit: SecurityAuditEvent;
}>;

export type IntegrationMetadataResult =
  | { outcome: "accepted"; version: string }
  | { outcome: "conflict" }
  | { outcome: "stale" };

/** Company data connector metadata, deliberately separate from employee OIDC. */
export interface IntegrationMetadataRepository {
  registerConnection(intent: RegisterIntegrationConnectionIntent): Promise<IntegrationMetadataResult>;
  createOauthAttempt(intent: CreateIntegrationOauthAttemptIntent): Promise<IntegrationMetadataResult>;
  consumeOauthAttempt(
    intent: ConsumeIntegrationOauthAttemptIntent,
  ): Promise<{ outcome: "consumed"; value: ConsumedIntegrationOauthAttempt } | { outcome: "stale" }>;
  /** Atomically binds verified Google identity, encrypted refresh credential, scopes, and audit. */
  completeOauthConnection(intent: CompleteIntegrationOauthConnectionIntent): Promise<IntegrationMetadataResult>;
  getActiveCredential(
    connectionId: string,
    credentialKind: string,
  ): Promise<ActiveIntegrationCredential | null>;
  rotateCredential(intent: RotateIntegrationCredentialIntent): Promise<IntegrationMetadataResult>;
  registerResource(intent: RegisterIntegrationResourceIntent): Promise<IntegrationMetadataResult>;
}
