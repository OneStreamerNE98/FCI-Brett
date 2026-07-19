import type {
  CompleteIntegrationOauthConnectionIntent,
  ConsumeIntegrationOauthAttemptIntent,
  CreateIntegrationOauthAttemptIntent,
  IntegrationMetadataRepository,
  IntegrationMetadataResult,
  RegisterIntegrationConnectionIntent,
  RegisterIntegrationResourceIntent,
  RotateIntegrationCredentialIntent,
} from "../../ports/integration-metadata";
import type { SecurityAuditEvent } from "../../ports/security-audit";
import { insertPostgresSecurityAuditEvent } from "./security-audit-repository";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  assertPersistenceCiphertext,
  assertPersistenceHash,
  assertPersistenceKey,
  assertPersistenceText,
  assertPersistenceUuid,
  isNamedPostgresConstraint,
  persistenceAuditEvent,
  persistenceDate,
  persistenceJsonObject,
  persistenceVersion,
} from "./persistence-repository-values";
import { postgresSchemaName } from "./postgres-values";

export type PostgresIntegrationMetadataOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

const INTEGRATION_CONFLICT_CONSTRAINTS = [
  "integration_connections_pkey",
  "integration_connections_connection_key_key",
  "integration_connections_external_identity_idx",
  "integration_oauth_attempts_pkey",
  "integration_oauth_attempts_state_hash_idx",
  "integration_resources_pkey",
  "integration_resources_connection_id_id_key",
  "integration_resources_connection_type_external_key",
  "integration_resources_connection_resource_key",
] as const;

function exactVersion(
  result: { rowCount: number | null; rows: Array<{ version?: unknown }> },
  label: string,
) {
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new Error(`${label} was not persisted exactly once`);
  }
  return persistenceVersion(result.rows[0]?.version, `${label} version`);
}

function accepted(version: string): IntegrationMetadataResult {
  return { outcome: "accepted", version };
}

function mutationAudit(
  event: SecurityAuditEvent,
  action: string,
  targetType: string,
  targetId: string,
  denialReason: string | null = null,
) {
  return persistenceAuditEvent(event, {
    action,
    targetType,
    targetId,
    result: denialReason === null ? "succeeded" : "denied",
    reasonCode: denialReason,
  });
}

function validateConnection(intent: RegisterIntegrationConnectionIntent) {
  assertPersistenceUuid(intent.id, "Integration connection ID");
  assertPersistenceKey(intent.provider, "Integration provider");
  assertPersistenceKey(intent.connectionKey, "Integration connection key");
  if (intent.createdByUserId !== null) {
    assertPersistenceUuid(intent.createdByUserId, "Integration creator user ID");
  }
  assertPersistenceText(intent.createdByActorKey, "Integration creator actor key", 255);
  return persistenceDate(intent.createdAt, "Integration connection created_at");
}

function validateOauthAttempt(intent: CreateIntegrationOauthAttemptIntent) {
  assertPersistenceUuid(intent.id, "Integration OAuth attempt ID");
  assertPersistenceUuid(intent.connectionId, "Integration OAuth connection ID");
  assertPersistenceUuid(intent.initiatedByUserId, "Integration OAuth user ID");
  assertPersistenceHash(intent.stateHash, "Integration OAuth state hash");
  assertPersistenceHash(intent.browserNonceHash, "Integration OAuth browser nonce hash");
  assertPersistenceCiphertext(intent.pkceVerifierCiphertext, "Integration OAuth PKCE ciphertext");
  assertPersistenceText(intent.keyVersion, "Integration OAuth key version", 255);
  if (
    !Array.isArray(intent.requestedScopes) || intent.requestedScopes.length === 0 ||
    intent.requestedScopes.length > 100 ||
    new Set(intent.requestedScopes).size !== intent.requestedScopes.length
  ) {
    throw new TypeError("Integration OAuth scopes must be a nonempty unique bounded list");
  }
  for (const scope of intent.requestedScopes) {
    assertPersistenceText(scope, "Integration OAuth scope", 512);
  }
  const createdAt = persistenceDate(intent.createdAt, "Integration OAuth created_at");
  const expiresAt = persistenceDate(intent.expiresAt, "Integration OAuth expires_at");
  const purgeAfter = persistenceDate(intent.purgeAfter, "Integration OAuth purge_after");
  if (expiresAt <= createdAt || purgeAfter <= expiresAt) {
    throw new TypeError("Integration OAuth expiry and purge times must be ordered");
  }
  return { createdAt, expiresAt, purgeAfter };
}

function validateOauthCompletion(intent: CompleteIntegrationOauthConnectionIntent) {
  assertPersistenceUuid(intent.connectionId, "Integration OAuth connection ID");
  const expectedConnectionVersion = persistenceVersion(
    intent.expectedConnectionVersion,
    "Expected Integration connection version",
  );
  assertPersistenceText(intent.issuer, "Integration OAuth issuer", 2_048);
  assertPersistenceText(intent.externalSubject, "Integration OAuth subject", 1_024);
  assertPersistenceText(intent.externalEmail, "Integration OAuth email", 320);
  if (
    intent.externalEmail !== intent.externalEmail.trim().toLowerCase()
    || !/^[^\s@]+@[^\s@]+$/.test(intent.externalEmail)
  ) {
    throw new TypeError("Integration OAuth email must be normalized");
  }
  assertPersistenceText(intent.hostedDomain, "Integration OAuth hosted domain", 255);
  if (intent.hostedDomain !== intent.hostedDomain.trim().toLowerCase()) {
    throw new TypeError("Integration OAuth hosted domain must be normalized");
  }
  assertPersistenceUuid(intent.credentialId, "Integration OAuth credential ID");
  assertPersistenceCiphertext(intent.refreshTokenCiphertext, "Integration OAuth refresh ciphertext");
  assertPersistenceText(intent.keyVersion, "Integration OAuth key version", 255);
  if (
    !Array.isArray(intent.grantedScopes)
    || intent.grantedScopes.length === 0
    || intent.grantedScopes.length > 100
    || new Set(intent.grantedScopes).size !== intent.grantedScopes.length
  ) {
    throw new TypeError("Integration OAuth granted scopes must be a nonempty unique bounded list");
  }
  for (const scope of intent.grantedScopes) {
    assertPersistenceText(scope, "Integration OAuth granted scope", 512);
  }
  assertPersistenceUuid(intent.completedByUserId, "Integration OAuth completing user ID");
  assertPersistenceText(intent.completedByActorKey, "Integration OAuth completing actor key", 255);
  const completedAt = persistenceDate(intent.completedAt, "Integration OAuth completed_at");
  return { expectedConnectionVersion, completedAt };
}

function validateCredentialRotation(intent: RotateIntegrationCredentialIntent) {
  assertPersistenceUuid(intent.connectionId, "Integration credential connection ID");
  assertPersistenceUuid(intent.credentialId, "Integration credential ID");
  assertPersistenceKey(intent.credentialKind, "Integration credential kind");
  const expectedVersion = persistenceVersion(
    intent.expectedVersion,
    "Expected Integration credential version",
  );
  assertPersistenceCiphertext(intent.ciphertext, "Integration rotated credential ciphertext");
  assertPersistenceText(intent.keyVersion, "Integration rotated credential key version", 255);
  const rotatedAt = persistenceDate(intent.rotatedAt, "Integration credential rotated_at");
  return { expectedVersion, rotatedAt };
}

function validateResource(intent: RegisterIntegrationResourceIntent) {
  assertPersistenceUuid(intent.id, "Integration resource ID");
  assertPersistenceUuid(intent.connectionId, "Integration resource connection ID");
  assertPersistenceKey(intent.resourceType, "Integration resource type");
  assertPersistenceKey(intent.resourceKey, "Integration resource key");
  assertPersistenceText(intent.externalId, "Integration external resource ID", 1_024);
  if (intent.parentExternalId !== null) {
    assertPersistenceText(intent.parentExternalId, "Integration parent resource ID", 1_024);
  }
  if (intent.externalUrl !== null) {
    assertPersistenceText(intent.externalUrl, "Integration external URL", 2_048);
    let url: URL;
    try {
      url = new URL(intent.externalUrl);
    } catch {
      throw new TypeError("Integration external URL must be an absolute HTTPS URL");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new TypeError("Integration external URL must be an absolute HTTPS URL without credentials");
    }
  }
  let clientId: string | null = null;
  let projectId: string | null = null;
  if (intent.owner.type === "client") {
    assertPersistenceUuid(intent.owner.clientId, "Integration resource client ID");
    clientId = intent.owner.clientId;
  } else if (intent.owner.type === "project") {
    assertPersistenceUuid(intent.owner.projectId, "Integration resource project ID");
    projectId = intent.owner.projectId;
  } else if (intent.owner.type !== "workspace") {
    throw new TypeError("Integration resource owner type is invalid");
  }
  const metadataJson = persistenceJsonObject(intent.metadata, "Integration resource metadata");
  const createdAt = persistenceDate(intent.createdAt, "Integration resource created_at");
  return { clientId, projectId, metadataJson, createdAt };
}

export function createPostgresIntegrationMetadataRepository(
  pool: PostgresPool,
  options: PostgresIntegrationMetadataOptions = {},
): IntegrationMetadataRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  async function transaction<T>(
    work: Parameters<typeof withPostgresTransaction<T>>[2],
    conflictAudit?: SecurityAuditEvent,
  ) {
    try {
      return await withPostgresTransaction(pool, transactionOptions, work);
    } catch (error) {
      if (isNamedPostgresConstraint(error, "23505", INTEGRATION_CONFLICT_CONSTRAINTS)) {
        if (conflictAudit) {
          await withPostgresTransaction(pool, transactionOptions, (client) =>
            insertPostgresSecurityAuditEvent(client, conflictAudit));
        }
        return { outcome: "conflict" as const };
      }
      throw error;
    }
  }

  return {
    async registerConnection(intent) {
      const createdAt = validateConnection(intent);
      return transaction(async (client) => {
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO integration_connections (
             id, provider, connection_key, status,
             created_by_user_id, created_by_actor_key,
             updated_by_user_id, updated_by_actor_key,
             created_at, updated_at, version
           ) VALUES ($1, $2, $3, 'pending', $4, $5, $4, $5, $6, $6, 1)
           RETURNING '1'::text AS version`,
          [intent.id, intent.provider, intent.connectionKey,
            intent.createdByUserId, intent.createdByActorKey, createdAt],
        );
        const version = exactVersion(inserted, "PostgreSQL integration connection");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "integration.connection_registered",
          "integration_connection",
          intent.id,
        ));
        return accepted(version);
      }, mutationAudit(
        intent.audit,
        "integration.connection_registered",
        "integration_connection",
        intent.id,
        "conflict",
      )) as Promise<IntegrationMetadataResult>;
    },

    async createOauthAttempt(intent) {
      const times = validateOauthAttempt(intent);
      return transaction(async (client) => {
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO integration_oauth_attempts (
             id, connection_id, initiated_by_user_id, state_hash,
             browser_nonce_hash, pkce_verifier_ciphertext, key_version,
             requested_scopes, status, expires_at, purge_after,
             created_at, updated_at, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending', $9, $10, $11, $11, 1)
           RETURNING version::text AS version`,
          [intent.id, intent.connectionId, intent.initiatedByUserId,
            intent.stateHash, intent.browserNonceHash,
            Buffer.from(intent.pkceVerifierCiphertext), intent.keyVersion,
            JSON.stringify(intent.requestedScopes), times.expiresAt,
            times.purgeAfter, times.createdAt],
        );
        const version = exactVersion(inserted, "PostgreSQL integration OAuth attempt");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "integration.oauth_attempt_created",
          "integration_oauth_attempt",
          intent.id,
        ));
        return accepted(version);
      }, mutationAudit(
        intent.audit,
        "integration.oauth_attempt_created",
        "integration_oauth_attempt",
        intent.id,
        "conflict",
      )) as Promise<IntegrationMetadataResult>;
    },

    async consumeOauthAttempt(intent: ConsumeIntegrationOauthAttemptIntent) {
      assertPersistenceUuid(intent.connectionId, "Integration OAuth connection ID");
      assertPersistenceHash(intent.stateHash, "Integration OAuth state hash");
      assertPersistenceHash(intent.browserNonceHash, "Integration OAuth browser nonce hash");
      assertPersistenceUuid(intent.initiatedByUserId, "Integration OAuth user ID");
      const consumedAt = persistenceDate(intent.consumedAt, "Integration OAuth consumed_at");
      const expectedVersion = persistenceVersion(intent.expectedVersion, "Expected Integration OAuth version");
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const consumed = await client.query<{
          id: unknown;
          pkce_verifier_ciphertext: unknown;
          key_version: unknown;
          version: unknown;
        }>(
          `WITH candidate AS (
             SELECT id, pkce_verifier_ciphertext, key_version
             FROM integration_oauth_attempts
             WHERE connection_id = $1
               AND state_hash = $2
               AND browser_nonce_hash = $3
               AND initiated_by_user_id = $4
               AND version = $5::bigint
               AND status = 'pending'
               AND expires_at >= $6
             FOR UPDATE
           ), consumed AS (
             UPDATE integration_oauth_attempts AS attempt
             SET state_hash = NULL, browser_nonce_hash = NULL,
                 pkce_verifier_ciphertext = NULL, key_version = NULL,
                 status = 'consumed', consumed_at = $6,
                 updated_at = $6, version = attempt.version + 1
             FROM candidate
             WHERE attempt.id = candidate.id
             RETURNING attempt.id::text AS id,
                       candidate.pkce_verifier_ciphertext,
                       candidate.key_version,
                       attempt.version::text AS version
           ) SELECT id, pkce_verifier_ciphertext, key_version, version FROM consumed`,
          [intent.connectionId, intent.stateHash, intent.browserNonceHash,
            intent.initiatedByUserId, expectedVersion, consumedAt],
        );
        if (consumed.rowCount === 0 && consumed.rows.length === 0) {
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "integration.oauth_attempt_consumed",
            "integration_connection",
            intent.connectionId,
            "stale_state",
          ));
          return { outcome: "stale" as const };
        }
        if (consumed.rowCount !== 1 || consumed.rows.length !== 1) {
          throw new Error("PostgreSQL integration OAuth attempt was not consumed exactly once");
        }
        const row = consumed.rows[0];
        assertPersistenceUuid(row?.id, "Consumed Integration OAuth attempt ID");
        assertPersistenceCiphertext(
          row?.pkce_verifier_ciphertext,
          "Consumed Integration OAuth PKCE ciphertext",
        );
        assertPersistenceText(row?.key_version, "Consumed Integration OAuth key version", 255);
        const version = persistenceVersion(row?.version, "Consumed Integration OAuth version");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "integration.oauth_attempt_consumed",
          "integration_connection",
          intent.connectionId,
        ));
        return {
          outcome: "consumed" as const,
          value: {
            id: row.id,
            pkceVerifierCiphertext: new Uint8Array(row.pkce_verifier_ciphertext),
            keyVersion: row.key_version,
            version,
          },
        };
      });
    },

    async completeOauthConnection(intent) {
      const values = validateOauthCompletion(intent);
      return transaction(async (client) => {
        const locked = await client.query<{ id: unknown }>(
          `SELECT id::text AS id
           FROM integration_connections
           WHERE id = $1
             AND version = $2::bigint
             AND status IN ('pending', 'connected', 'degraded', 'reauthorization_required')
           FOR UPDATE`,
          [intent.connectionId, values.expectedConnectionVersion],
        );
        if (locked.rowCount === 0 && locked.rows.length === 0) {
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "integration.oauth_connection_completed",
            "integration_connection",
            intent.connectionId,
            "stale_connection",
          ));
          return { outcome: "stale" as const };
        }
        if (locked.rowCount !== 1 || locked.rows.length !== 1) {
          throw new Error("PostgreSQL integration connection was not locked exactly once");
        }
        assertPersistenceUuid(locked.rows[0]?.id, "Locked Integration connection ID");

        await client.query(
          `INSERT INTO integration_credentials (
             id, connection_id, credential_kind, ciphertext, key_version,
             status, rotated_at, revoked_at, created_at, updated_at, version
           ) VALUES ($1, $2, 'refresh_token', $3, $4, 'active', NULL, NULL, $5, $5, 1)
           ON CONFLICT (connection_id, credential_kind) DO UPDATE
           SET ciphertext = EXCLUDED.ciphertext,
               key_version = EXCLUDED.key_version,
               status = 'active',
               rotated_at = CASE
                 WHEN integration_credentials.key_version <> EXCLUDED.key_version THEN EXCLUDED.updated_at
                 ELSE integration_credentials.rotated_at
               END,
               revoked_at = NULL,
               updated_at = EXCLUDED.updated_at,
               version = integration_credentials.version + 1`,
          [intent.credentialId, intent.connectionId,
            Buffer.from(intent.refreshTokenCiphertext), intent.keyVersion,
            values.completedAt],
        );

        await client.query(
          "DELETE FROM integration_connection_scopes WHERE connection_id = $1",
          [intent.connectionId],
        );
        for (const scope of intent.grantedScopes) {
          await client.query(
            `INSERT INTO integration_connection_scopes (connection_id, scope, granted_at)
             VALUES ($1, $2, $3)`,
            [intent.connectionId, scope, values.completedAt],
          );
        }

        const updated = await client.query<{ version: unknown }>(
          `UPDATE integration_connections
           SET issuer = $3, external_subject = $4, external_email = $5,
               hosted_domain = $6, status = 'connected',
               last_connected_at = $7, last_success_at = $7,
               last_error_at = NULL, last_error_code = NULL,
               updated_by_user_id = $8, updated_by_actor_key = $9,
               revoked_at = NULL, updated_at = $7, version = version + 1
           WHERE id = $1 AND version = $2::bigint
           RETURNING version::text AS version`,
          [intent.connectionId, values.expectedConnectionVersion,
            intent.issuer, intent.externalSubject, intent.externalEmail,
            intent.hostedDomain, values.completedAt,
            intent.completedByUserId, intent.completedByActorKey],
        );
        const version = exactVersion(updated, "PostgreSQL completed Integration OAuth connection");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "integration.oauth_connection_completed",
          "integration_connection",
          intent.connectionId,
        ));
        return accepted(version);
      }, mutationAudit(
        intent.audit,
        "integration.oauth_connection_completed",
        "integration_connection",
        intent.connectionId,
        "conflict",
      )) as Promise<IntegrationMetadataResult>;
    },

    async getActiveCredential(connectionId, credentialKind) {
      assertPersistenceUuid(connectionId, "Integration credential connection ID");
      assertPersistenceKey(credentialKind, "Integration credential kind");
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const selected = await client.query<{
          id: unknown;
          connection_id: unknown;
          credential_kind: unknown;
          ciphertext: unknown;
          key_version: unknown;
          version: unknown;
        }>(
          `SELECT id::text AS id, connection_id::text AS connection_id,
                  credential_kind, ciphertext, key_version,
                  version::text AS version
           FROM integration_credentials
           WHERE connection_id = $1 AND credential_kind = $2 AND status = 'active'`,
          [connectionId, credentialKind],
        );
        if (selected.rowCount === 0 && selected.rows.length === 0) return null;
        if (selected.rowCount !== 1 || selected.rows.length !== 1) {
          throw new Error("PostgreSQL active Integration credential was not unique");
        }
        const row = selected.rows[0];
        assertPersistenceUuid(row?.id, "Active Integration credential ID");
        assertPersistenceUuid(row?.connection_id, "Active Integration credential connection ID");
        assertPersistenceKey(row?.credential_kind, "Active Integration credential kind");
        assertPersistenceCiphertext(row?.ciphertext, "Active Integration credential ciphertext");
        assertPersistenceText(row?.key_version, "Active Integration credential key version", 255);
        return {
          id: row.id,
          connectionId: row.connection_id,
          credentialKind: row.credential_kind,
          ciphertext: new Uint8Array(row.ciphertext),
          keyVersion: row.key_version,
          version: persistenceVersion(row?.version, "Active Integration credential version"),
        };
      });
    },

    async rotateCredential(intent) {
      const values = validateCredentialRotation(intent);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const rotated = await client.query<{ version: unknown }>(
          `UPDATE integration_credentials
           SET ciphertext = $5, key_version = $6, status = 'active',
               rotated_at = $7, revoked_at = NULL, updated_at = $7,
               version = version + 1
           WHERE id = $1 AND connection_id = $2 AND credential_kind = $3
             AND version = $4::bigint AND status = 'active'
           RETURNING version::text AS version`,
          [intent.credentialId, intent.connectionId, intent.credentialKind,
            values.expectedVersion, Buffer.from(intent.ciphertext),
            intent.keyVersion, values.rotatedAt],
        );
        if (rotated.rowCount === 0 && rotated.rows.length === 0) {
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "integration.credential_rotated",
            "integration_connection",
            intent.connectionId,
            "stale_credential",
          ));
          return { outcome: "stale" as const };
        }
        const version = exactVersion(rotated, "PostgreSQL rotated Integration credential");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "integration.credential_rotated",
          "integration_connection",
          intent.connectionId,
        ));
        return accepted(version);
      });
    },

    async registerResource(intent) {
      const values = validateResource(intent);
      return transaction(async (client) => {
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO integration_resources (
             id, connection_id, resource_type, resource_key, external_id,
             parent_external_id, external_url, owner_type, client_id,
             project_id, status, metadata, created_at, updated_at, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             'pending', $11::jsonb, $12, $12, 1)
           RETURNING '1'::text AS version`,
          [intent.id, intent.connectionId, intent.resourceType,
            intent.resourceKey, intent.externalId, intent.parentExternalId,
            intent.externalUrl, intent.owner.type, values.clientId,
            values.projectId, values.metadataJson, values.createdAt],
        );
        const version = exactVersion(inserted, "PostgreSQL integration resource");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "integration.resource_registered",
          "integration_resource",
          intent.id,
        ));
        return accepted(version);
      }, mutationAudit(
        intent.audit,
        "integration.resource_registered",
        "integration_resource",
        intent.id,
        "conflict",
      )) as Promise<IntegrationMetadataResult>;
    },
  };
}
