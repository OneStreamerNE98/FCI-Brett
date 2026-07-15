import type {
  ConsumeIntegrationOauthAttemptIntent,
  CreateIntegrationOauthAttemptIntent,
  IntegrationMetadataRepository,
  IntegrationMetadataResult,
  RegisterIntegrationConnectionIntent,
  RegisterIntegrationResourceIntent,
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
