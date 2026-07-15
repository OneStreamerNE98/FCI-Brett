import type {
  IdentityDefinition,
  IdentityGrant,
  IdentityPersistenceRepository,
  IdentityPersistenceResult,
  RegisterExternalIdentityIntent,
  RevokeSessionIntent,
} from "../../ports/identity-persistence";
import type { SecurityAuditEvent } from "../../ports/security-audit";
import { insertPostgresSecurityAuditEvent } from "./security-audit-repository";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  assertPersistenceDottedKey,
  assertPersistenceHash,
  assertPersistenceKey,
  assertPersistenceText,
  assertPersistenceUuid,
  isNamedPostgresConstraint,
  persistenceAuditEvent,
  persistenceDate,
  persistenceVersion,
} from "./persistence-repository-values";
import { parsePostgresTimestamp, postgresSchemaName } from "./postgres-values";

export type PostgresIdentityPersistenceOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

const IDENTITY_CONFLICT_CONSTRAINTS = [
  "users_pkey",
  "users_email_key_key",
  "external_identities_pkey",
  "external_identities_issuer_subject_key",
  "external_identities_user_provider_key",
  "invitations_pkey",
  "invitations_pending_email_key_idx",
  "invitations_token_hash_idx",
  "sessions_pkey",
  "sessions_token_hash_idx",
  "sessions_rotated_from_session_id_idx",
  "roles_pkey",
  "roles_role_key_key",
  "capabilities_pkey",
  "capabilities_capability_key_key",
  "role_capabilities_pkey",
  "user_roles_pkey",
  "project_memberships_pkey",
] as const;

function accepted(version: unknown, label: string): IdentityPersistenceResult {
  return { outcome: "accepted", version: persistenceVersion(version, label) };
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

function exactVersionRow(
  result: { rowCount: number | null; rows: Array<{ version?: unknown }> },
  label: string,
) {
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new Error(`${label} was not persisted exactly once`);
  }
  return result.rows[0]?.version;
}

function assertCommonTimes(createdAt: number, updatedAt: number = createdAt) {
  const created = persistenceDate(createdAt, "Identity persistence created_at");
  const updated = persistenceDate(updatedAt, "Identity persistence updated_at");
  if (updated < created) throw new TypeError("Identity persistence updated_at cannot predate created_at");
  return { created, updated };
}

function assertRegistration(intent: RegisterExternalIdentityIntent) {
  assertPersistenceUuid(intent.user.id, "Identity user ID");
  assertPersistenceText(intent.user.email, "Identity user email", 320);
  assertPersistenceText(intent.user.displayName, "Identity display name", 255);
  if (intent.user.status !== "active") {
    throw new TypeError("New identity users must start active");
  }
  const times = assertCommonTimes(intent.user.createdAt, intent.user.updatedAt);
  const sessionsValidAfter = persistenceDate(
    intent.user.sessionsValidAfter,
    "Identity sessions_valid_after",
  );
  if (sessionsValidAfter < times.created) {
    throw new TypeError("Identity sessions_valid_after cannot predate creation");
  }
  assertPersistenceUuid(intent.identity.id, "External identity ID");
  assertPersistenceKey(intent.identity.provider, "External identity provider");
  assertPersistenceText(intent.identity.issuer, "External identity issuer", 512);
  assertPersistenceText(intent.identity.subject, "External identity subject", 512);
  assertPersistenceText(intent.identity.email, "External identity email", 320);
  if (intent.identity.hostedDomain !== null) {
    assertPersistenceText(intent.identity.hostedDomain, "External identity hosted domain", 255);
    if (intent.identity.hostedDomain !== intent.identity.hostedDomain.trim().toLowerCase()) {
      throw new TypeError("External identity hosted domain must be normalized lowercase text");
    }
  }
  const firstSeenAt = persistenceDate(intent.identity.firstSeenAt, "External identity first_seen_at");
  const lastAuthenticatedAt = persistenceDate(
    intent.identity.lastAuthenticatedAt,
    "External identity last_authenticated_at",
  );
  if (lastAuthenticatedAt < firstSeenAt) {
    throw new TypeError("External identity authentication cannot predate first_seen_at");
  }
  return { ...times, sessionsValidAfter, firstSeenAt, lastAuthenticatedAt };
}

function assertDefinition(intent: IdentityDefinition, dotted: boolean) {
  assertPersistenceUuid(intent.id, "Identity definition ID");
  if (dotted) assertPersistenceDottedKey(intent.key, "Capability key");
  else assertPersistenceKey(intent.key, "Role key");
  assertPersistenceText(intent.displayName, "Identity definition display name", 255);
  if (intent.description !== null) {
    assertPersistenceText(intent.description, "Identity definition description", 2_000);
  }
  return persistenceDate(intent.createdAt, "Identity definition created_at");
}

function assertGrant(intent: IdentityGrant | Omit<IdentityGrant, "expiresAt">) {
  assertPersistenceUuid(intent.subjectId, "Identity grant subject ID");
  assertPersistenceUuid(intent.valueId, "Identity grant value ID");
  if (intent.assignedByUserId !== null) {
    assertPersistenceUuid(intent.assignedByUserId, "Identity grant assigner user ID");
  }
  assertPersistenceText(intent.assignedByActorKey, "Identity grant actor key", 255);
  const assignedAt = persistenceDate(intent.assignedAt, "Identity grant assigned_at");
  const expiresAt = "expiresAt" in intent && intent.expiresAt !== null
    ? persistenceDate(intent.expiresAt, "Identity grant expires_at")
    : null;
  if (expiresAt !== null && expiresAt <= assignedAt) {
    throw new TypeError("Identity grant expiry must follow assignment");
  }
  return { assignedAt, expiresAt };
}

export function createPostgresIdentityPersistenceRepository(
  pool: PostgresPool,
  options: PostgresIdentityPersistenceOptions = {},
): IdentityPersistenceRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  async function transaction(
    work: Parameters<typeof withPostgresTransaction<IdentityPersistenceResult>>[2],
    conflictAudit?: SecurityAuditEvent,
  ) {
    try {
      return await withPostgresTransaction(pool, transactionOptions, work);
    } catch (error) {
      if (isNamedPostgresConstraint(error, "23505", IDENTITY_CONFLICT_CONSTRAINTS)) {
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
    async registerExternalIdentity(intent) {
      const times = assertRegistration(intent);
      return transaction(async (client) => {
        const user = await client.query<{ version: unknown }>(
          `INSERT INTO users (
             id, email, email_key, display_name, status, authorization_version,
             sessions_valid_after, created_at, updated_at, version
           ) VALUES ($1, $2, pg_catalog.lower(pg_catalog.btrim($2)), $3, 'active', 1, $4, $5, $6, 1)
           RETURNING version::text AS version`,
          [
            intent.user.id,
            intent.user.email,
            intent.user.displayName,
            times.sessionsValidAfter,
            times.created,
            times.updated,
          ],
        );
        const version = exactVersionRow(user, "PostgreSQL identity user");
        const identity = await client.query(
          `INSERT INTO external_identities (
             id, user_id, provider, issuer, subject, email, hosted_domain,
             email_verified, first_seen_at, last_authenticated_at, updated_at, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 1)`,
          [
            intent.identity.id,
            intent.user.id,
            intent.identity.provider,
            intent.identity.issuer,
            intent.identity.subject,
            intent.identity.email,
            intent.identity.hostedDomain,
            intent.identity.emailVerified,
            times.firstSeenAt,
            times.lastAuthenticatedAt,
          ],
        );
        if (identity.rowCount !== 1) throw new Error("PostgreSQL external identity was not inserted exactly once");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "identity.user_registered",
          "user",
          intent.user.id,
        ));
        return accepted(version, "PostgreSQL identity user version");
      }, mutationAudit(
        intent.audit,
        "identity.user_registered",
        "user",
        intent.user.id,
        "conflict",
      ));
    },

    async createInvitation(intent) {
      assertPersistenceUuid(intent.id, "Invitation ID");
      assertPersistenceText(intent.email, "Invitation email", 320);
      assertPersistenceHash(intent.tokenHash, "Invitation token hash");
      if (intent.invitedByUserId !== null) {
        assertPersistenceUuid(intent.invitedByUserId, "Invitation inviter user ID");
      }
      assertPersistenceText(intent.invitedByActorKey, "Invitation actor key", 255);
      const createdAt = persistenceDate(intent.createdAt, "Invitation created_at");
      const expiresAt = persistenceDate(intent.expiresAt, "Invitation expires_at");
      const purgeAfter = persistenceDate(intent.purgeAfter, "Invitation purge_after");
      if (expiresAt <= createdAt || purgeAfter <= expiresAt) {
        throw new TypeError("Invitation expiry and purge times must be ordered");
      }
      return transaction(async (client) => {
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO invitations (
             id, email, email_key, token_hash, status, invited_by_user_id,
             invited_by_actor_key, expires_at, purge_after, created_at, updated_at, version
           ) VALUES ($1, $2, pg_catalog.lower(pg_catalog.btrim($2)), $3, 'pending', $4, $5, $6, $7, $8, $8, 1)
           RETURNING '1'::text AS version`,
          [intent.id, intent.email, intent.tokenHash, intent.invitedByUserId,
            intent.invitedByActorKey, expiresAt, purgeAfter, createdAt],
        );
        const version = exactVersionRow(inserted, "PostgreSQL invitation");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "identity.invitation_created",
          "invitation",
          intent.id,
        ));
        return accepted(version, "PostgreSQL invitation version");
      }, mutationAudit(
        intent.audit,
        "identity.invitation_created",
        "invitation",
        intent.id,
        "conflict",
      ));
    },

    async createSession(intent) {
      assertPersistenceUuid(intent.id, "Session ID");
      assertPersistenceUuid(intent.userId, "Session user ID");
      assertPersistenceHash(intent.tokenHash, "Session token hash");
      assertPersistenceHash(intent.csrfHash, "Session CSRF hash");
      const authorizationVersion = persistenceVersion(
        intent.authorizationVersion,
        "Session authorization version",
      );
      if (intent.rotatedFromSessionId !== null) {
        throw new TypeError(
          "Session rotation is unavailable until predecessor revocation is atomic",
        );
      }
      const issuedAt = persistenceDate(intent.issuedAt, "Session issued_at");
      const idleExpiresAt = persistenceDate(intent.idleExpiresAt, "Session idle_expires_at");
      const absoluteExpiresAt = persistenceDate(intent.absoluteExpiresAt, "Session absolute_expires_at");
      const purgeAfter = persistenceDate(intent.purgeAfter, "Session purge_after");
      if (!(idleExpiresAt > issuedAt && absoluteExpiresAt >= idleExpiresAt && purgeAfter > absoluteExpiresAt)) {
        throw new TypeError("Session expiry and purge times must be ordered");
      }
      return transaction(async (client) => {
        const user = await client.query<{
          authorization_version: unknown;
          sessions_valid_after: unknown;
          status: unknown;
        }>(
          `SELECT authorization_version::text AS authorization_version,
                  sessions_valid_after, status
           FROM users WHERE id = $1 FOR SHARE`,
          [intent.userId],
        );
        const userRow = user.rowCount === 1 && user.rows.length === 1
          ? user.rows[0]
          : null;
        const userMatches = userRow?.status === "active" &&
          persistenceVersion(
            userRow.authorization_version,
            "PostgreSQL user authorization version",
          ) === authorizationVersion &&
          issuedAt.getTime() >= parsePostgresTimestamp(
            userRow.sessions_valid_after,
            "PostgreSQL sessions_valid_after",
          );
        if (!userMatches) {
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "identity.session_created",
            "session",
            intent.id,
            "stale_state",
          ));
          return { outcome: "stale" as const };
        }
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO sessions (
             id, user_id, token_hash, csrf_hash, authorization_version,
             rotated_from_session_id, issued_at, last_seen_at, idle_expires_at,
             absolute_expires_at, purge_after, version
           ) VALUES ($1, $2, $3, $4, $5::bigint, $6, $7, $7, $8, $9, $10, 1)
           RETURNING version::text AS version`,
          [intent.id, intent.userId, intent.tokenHash, intent.csrfHash,
            authorizationVersion, intent.rotatedFromSessionId, issuedAt,
            idleExpiresAt, absoluteExpiresAt, purgeAfter],
        );
        const version = exactVersionRow(inserted, "PostgreSQL session");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "identity.session_created",
          "session",
          intent.id,
        ));
        return accepted(version, "PostgreSQL session version");
      }, mutationAudit(
        intent.audit,
        "identity.session_created",
        "session",
        intent.id,
        "conflict",
      ));
    },

    async revokeSession(intent: RevokeSessionIntent) {
      assertPersistenceUuid(intent.sessionId, "Session ID");
      const expectedVersion = persistenceVersion(intent.expectedVersion, "Expected session version");
      const revokedAt = persistenceDate(intent.revokedAt, "Session revoked_at");
      assertPersistenceText(intent.revokedByActorKey, "Session revocation actor key", 255);
      assertPersistenceKey(intent.reasonCode, "Session revocation reason code");
      return transaction(async (client) => {
        const updated = await client.query<{ version: unknown }>(
          `UPDATE sessions
           SET token_hash = NULL, csrf_hash = NULL, revoked_at = $2,
               revoked_by_actor_key = $3, revocation_reason_code = $4,
               version = version + 1
           WHERE id = $1 AND version = $5::bigint AND revoked_at IS NULL
           RETURNING version::text AS version`,
          [intent.sessionId, revokedAt, intent.revokedByActorKey, intent.reasonCode, expectedVersion],
        );
        if (updated.rowCount === 0 && updated.rows.length === 0) {
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "identity.session_revoked",
            "session",
            intent.sessionId,
            "stale_state",
          ));
          return { outcome: "stale" as const };
        }
        const version = exactVersionRow(updated, "PostgreSQL session revocation");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "identity.session_revoked",
          "session",
          intent.sessionId,
        ));
        return accepted(version, "PostgreSQL session version");
      });
    },

    async createRole(intent) {
      const createdAt = assertDefinition(intent, false);
      return transaction(async (client) => {
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO roles (
             id, role_key, display_name, description, status,
             created_at, updated_at, version
           ) VALUES ($1, $2, $3, $4, 'active', $5, $5, 1)
           RETURNING '1'::text AS version`,
          [intent.id, intent.key, intent.displayName, intent.description, createdAt],
        );
        const version = exactVersionRow(inserted, "PostgreSQL role");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "authorization.role_created",
          "role",
          intent.id,
        ));
        return accepted(version, "PostgreSQL role version");
      }, mutationAudit(
        intent.audit,
        "authorization.role_created",
        "role",
        intent.id,
        "conflict",
      ));
    },

    async createCapability(intent) {
      const createdAt = assertDefinition(intent, true);
      return transaction(async (client) => {
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO capabilities (
             id, capability_key, display_name, description, status,
             created_at, updated_at, version
           ) VALUES ($1, $2, $3, $4, 'active', $5, $5, 1)
           RETURNING '1'::text AS version`,
          [intent.id, intent.key, intent.displayName, intent.description, createdAt],
        );
        const version = exactVersionRow(inserted, "PostgreSQL capability");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "authorization.capability_created",
          "capability",
          intent.id,
        ));
        return accepted(version, "PostgreSQL capability version");
      }, mutationAudit(
        intent.audit,
        "authorization.capability_created",
        "capability",
        intent.id,
        "conflict",
      ));
    },

    async grantCapabilityToRole(intent) {
      const { assignedAt } = assertGrant(intent);
      return transaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO role_capabilities (
             role_id, capability_id, granted_by_user_id,
             granted_by_actor_key, granted_at
           ) VALUES ($1, $2, $3, $4, $5)`,
          [intent.subjectId, intent.valueId, intent.assignedByUserId,
            intent.assignedByActorKey, assignedAt],
        );
        if (inserted.rowCount !== 1) throw new Error("PostgreSQL capability grant was not inserted exactly once");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "authorization.role_capability_granted",
          "role",
          intent.subjectId,
        ));
        return accepted("1", "PostgreSQL capability grant version");
      }, mutationAudit(
        intent.audit,
        "authorization.role_capability_granted",
        "role",
        intent.subjectId,
        "conflict",
      ));
    },

    async assignRoleToUser(intent) {
      const { assignedAt, expiresAt } = assertGrant(intent);
      return transaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO user_roles (
             user_id, role_id, assigned_by_user_id,
             assigned_by_actor_key, assigned_at, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [intent.subjectId, intent.valueId, intent.assignedByUserId,
            intent.assignedByActorKey, assignedAt, expiresAt],
        );
        if (inserted.rowCount !== 1) throw new Error("PostgreSQL role assignment was not inserted exactly once");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "authorization.user_role_assigned",
          "user",
          intent.subjectId,
        ));
        return accepted("1", "PostgreSQL role assignment version");
      }, mutationAudit(
        intent.audit,
        "authorization.user_role_assigned",
        "user",
        intent.subjectId,
        "conflict",
      ));
    },

    async assignProjectToUser(intent) {
      const { assignedAt, expiresAt } = assertGrant(intent);
      return transaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO project_memberships (
             project_id, user_id, assigned_by_user_id,
             assigned_by_actor_key, assigned_at, expires_at
           ) VALUES ($2, $1, $3, $4, $5, $6)`,
          [intent.subjectId, intent.valueId, intent.assignedByUserId,
            intent.assignedByActorKey, assignedAt, expiresAt],
        );
        if (inserted.rowCount !== 1) throw new Error("PostgreSQL project assignment was not inserted exactly once");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "authorization.project_membership_assigned",
          "project",
          intent.valueId,
        ));
        return accepted("1", "PostgreSQL project assignment version");
      }, mutationAudit(
        intent.audit,
        "authorization.project_membership_assigned",
        "project",
        intent.valueId,
        "conflict",
      ));
    },
  };
}
