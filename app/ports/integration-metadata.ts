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
  registerResource(intent: RegisterIntegrationResourceIntent): Promise<IntegrationMetadataResult>;
}
