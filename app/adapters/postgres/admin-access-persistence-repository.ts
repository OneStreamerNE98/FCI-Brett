import {
  AUTHORIZATION_ACCESS_DEFAULTS,
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_DOMAIN,
  normalizeAuthorizationCompanyEmail,
} from "../../application/authorization-policy";
import {
  ADMIN_ACCESS_ROLE_KEYS,
  type AdminAccessPersistenceRepository,
  type AdminAccessPersistenceResult,
  type AdminAccessRoleKey,
  type CreateAdminInvitationIntent,
  type DisableUserAccessIntent,
  type InvalidateUserSessionsIntent,
  type RevokeAdminInvitationIntent,
  type SetUserAccessIntent,
} from "../../ports/admin-access-persistence";
import type { SecurityAuditEvent } from "../../ports/security-audit";
import { withPostgresTransaction, type PostgresClient, type PostgresPool } from "./postgres-database";
import {
  assertPersistenceHash,
  assertPersistenceKey,
  assertPersistenceText,
  assertPersistenceUuid,
  isNamedPostgresConstraint,
  persistenceAuditEvent,
  persistenceDate,
  persistenceVersion,
} from "./persistence-repository-values";
import { insertPostgresSecurityAuditEvent } from "./security-audit-repository";
import { parsePostgresUuid, postgresSchemaName } from "./postgres-values";

export type PostgresAdminAccessPersistenceOptions = Readonly<{
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}>;

/** Distinct from the session-scoped production migration lock. */
export const ADMIN_ACCESS_MUTATION_LOCK_ID = "7314269172071302";

const MAX_PROJECT_ASSIGNMENTS = 50;
const INVITATION_CONFLICT_CONSTRAINTS = [
  "invitations_pkey",
  "invitations_pending_email_key_idx",
  "invitations_token_hash_idx",
] as const;

type UserAccessRow = Record<string, unknown> & {
  status: unknown;
  version: unknown;
  authorization_version: unknown;
  role_key: unknown;
};

function accepted(
  version: unknown,
  label: string,
  authorizationVersion: unknown = null,
): AdminAccessPersistenceResult {
  return {
    outcome: "accepted",
    version: persistenceVersion(version, label),
    authorizationVersion: authorizationVersion === null
      ? null
      : persistenceVersion(authorizationVersion, `${label} authorization version`),
  };
}

function mutationAudit(
  event: SecurityAuditEvent,
  action: string,
  targetType: string,
  targetId: string,
  result: "succeeded" | "denied" = "succeeded",
  reasonCode: string | null = null,
) {
  return persistenceAuditEvent(event, {
    action,
    targetType,
    targetId,
    result,
    reasonCode,
  });
}

function roleKey(value: unknown): AdminAccessRoleKey {
  if (!ADMIN_ACCESS_ROLE_KEYS.includes(value as AdminAccessRoleKey)) {
    throw new TypeError("Administration role must be a supported fixed role");
  }
  return value as AdminAccessRoleKey;
}

function exactRow<Row extends Record<string, unknown>>(
  result: { rowCount: number | null; rows: Row[] },
  label: string,
) {
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new Error(`${label} did not return exactly one row`);
  }
  return result.rows[0];
}

function normalizedInvitationEmail(value: string) {
  assertPersistenceText(value, "Invitation email", 320);
  const normalized = normalizeAuthorizationCompanyEmail(value);
  if (normalized === null) {
    throw new TypeError(`Invitation email must belong to ${AUTHORIZATION_DOMAIN}`);
  }
  return normalized;
}

function actorValues(intent: {
  actorUserId: string;
  actorKey: string;
  actorSessionId: string;
  actorSessionVersion: string;
  actorAuthorizationVersion: string;
  reasonCode: string;
  changedAt: number;
}) {
  assertPersistenceUuid(intent.actorUserId, "Administration actor user ID");
  assertPersistenceText(intent.actorKey, "Administration actor key", 255);
  actorSessionValues(intent);
  assertPersistenceKey(intent.reasonCode, "Administration reason code");
  return persistenceDate(intent.changedAt, "Administration change time");
}

function actorSessionValues(intent: {
  actorUserId: string;
  actorSessionId: string;
  actorSessionVersion: string;
  actorAuthorizationVersion: string;
}) {
  assertPersistenceUuid(intent.actorUserId, "Administration actor user ID");
  assertPersistenceUuid(intent.actorSessionId, "Administration actor session ID");
  return {
    sessionVersion: persistenceVersion(
      intent.actorSessionVersion,
      "Administration actor session version",
    ),
    authorizationVersion: persistenceVersion(
      intent.actorAuthorizationVersion,
      "Administration actor authorization version",
    ),
  };
}

function desiredProjects(role: AdminAccessRoleKey, projectIds: readonly string[]) {
  if (!Array.isArray(projectIds) || projectIds.length > MAX_PROJECT_ASSIGNMENTS) {
    throw new TypeError(
      `Administration project assignments must be an array with at most ${MAX_PROJECT_ASSIGNMENTS} entries`,
    );
  }
  if (role !== "project_manager" && projectIds.length !== 0) {
    throw new TypeError("Only Project Managers can receive project assignments");
  }
  const unique = new Set<string>();
  for (const projectId of projectIds) {
    assertPersistenceUuid(projectId, "Administration project ID");
    if (unique.has(projectId)) {
      throw new TypeError("Administration project assignments must be unique");
    }
    unique.add(projectId);
  }
  return Object.freeze([...unique].sort());
}

async function lockAdministration(client: PostgresClient) {
  const locked = await client.query(
    "SELECT pg_catalog.pg_advisory_xact_lock($1::bigint) AS locked",
    [ADMIN_ACCESS_MUTATION_LOCK_ID],
  );
  if (locked.rowCount !== 1 || locked.rows.length !== 1) {
    throw new Error("PostgreSQL administration mutation lock was not acquired exactly once");
  }
}

async function activeAdministratorActor(
  client: PostgresClient,
  intent: {
    actorUserId: string;
    actorSessionId: string;
    actorSessionVersion: string;
    actorAuthorizationVersion: string;
    audit: SecurityAuditEvent;
  },
  capability: string,
  action: string,
  targetType: string,
  targetId: string,
) {
  const { sessionVersion, authorizationVersion } = actorSessionValues(intent);
  const current = await client.query(
    `SELECT actor_session.id
     FROM sessions AS actor_session
     JOIN users AS actor_user ON actor_user.id = actor_session.user_id
     JOIN user_roles AS actor_assignment ON actor_assignment.user_id = actor_user.id
     JOIN roles AS actor_role
       ON actor_role.id = actor_assignment.role_id
      AND actor_role.status = 'active'
      AND actor_role.role_key = 'administrator'
     JOIN role_capabilities AS actor_role_capability
       ON actor_role_capability.role_id = actor_role.id
     JOIN capabilities AS actor_capability
       ON actor_capability.id = actor_role_capability.capability_id
      AND actor_capability.status = 'active'
      AND actor_capability.capability_key = $5
     WHERE actor_session.id = $1
       AND actor_session.version = $2::bigint
       AND actor_session.user_id = $3
       AND actor_session.authorization_version = $4::bigint
       AND actor_session.token_hash IS NOT NULL
       AND actor_session.csrf_hash IS NOT NULL
       AND actor_session.revoked_at IS NULL
       AND actor_session.issued_at >= actor_user.sessions_valid_after
       AND actor_session.idle_expires_at > pg_catalog.statement_timestamp()
       AND actor_session.absolute_expires_at > pg_catalog.statement_timestamp()
       AND actor_user.status = 'active'
       AND actor_user.authorization_version = $4::bigint
     FOR UPDATE OF actor_session, actor_user`,
    [
      intent.actorSessionId,
      sessionVersion,
      intent.actorUserId,
      authorizationVersion,
      capability,
    ],
  );
  if (current.rowCount === 1 && current.rows.length === 1) return true;
  if (current.rowCount !== 0 || current.rows.length !== 0) {
    throw new Error("PostgreSQL administration actor fence returned an invalid row count");
  }
  await appendDenied(
    client,
    intent.audit,
    action,
    targetType,
    targetId,
    "actor_authorization_changed",
  );
  return false;
}

async function activeRoleId(client: PostgresClient, role: AdminAccessRoleKey) {
  const found = await client.query<{ id: unknown }>(
    `SELECT id::text AS id
     FROM roles
     WHERE role_key = $1 AND status = 'active'`,
    [role],
  );
  const row = exactRow(found, "PostgreSQL fixed administration role");
  return parsePostgresUuid(row.id, "PostgreSQL fixed administration role ID");
}

function checkedUserRow(
  result: { rowCount: number | null; rows: UserAccessRow[] },
  expectedVersion: string,
) {
  if (result.rowCount === 0 && result.rows.length === 0) return null;
  const row = exactRow(result, "PostgreSQL administration user");
  if (persistenceVersion(row.version, "PostgreSQL administration user version") !== expectedVersion) {
    return null;
  }
  if (row.status !== "active" && row.status !== "disabled") {
    throw new Error("PostgreSQL administration user status is invalid");
  }
  if (row.role_key !== null && !ADMIN_ACCESS_ROLE_KEYS.includes(row.role_key as AdminAccessRoleKey)) {
    throw new Error("PostgreSQL administration user has an unsupported role");
  }
  persistenceVersion(
    row.authorization_version,
    "PostgreSQL administration authorization version",
  );
  return row;
}

async function selectUserForUpdate(client: PostgresClient, userId: string) {
  return client.query<UserAccessRow>(
    `SELECT employee.status,
            employee.version::text AS version,
            employee.authorization_version::text AS authorization_version,
            assigned_role.role_key
     FROM users AS employee
     LEFT JOIN user_roles AS assignment ON assignment.user_id = employee.id
     LEFT JOIN roles AS assigned_role ON assigned_role.id = assignment.role_id
     WHERE employee.id = $1
     FOR UPDATE OF employee`,
    [userId],
  );
}

async function isFinalActiveAdministrator(client: PostgresClient) {
  const found = await client.query<{ count: unknown }>(
    `SELECT pg_catalog.count(*)::text AS count
     FROM users AS employee
     JOIN user_roles AS assignment ON assignment.user_id = employee.id
     JOIN roles AS assigned_role ON assigned_role.id = assignment.role_id
     WHERE employee.status = 'active'
       AND assigned_role.status = 'active'
       AND assigned_role.role_key = 'administrator'`,
  );
  const row = exactRow(found, "PostgreSQL active Administrator count");
  const count = typeof row.count === "string" ? Number(row.count) : row.count;
  if (!Number.isSafeInteger(count) || Number(count) < 0) {
    throw new Error("PostgreSQL active Administrator count is invalid");
  }
  return Number(count) <= 1;
}

async function appendDenied(
  client: PostgresClient,
  event: SecurityAuditEvent,
  action: string,
  targetType: string,
  targetId: string,
  reasonCode: string,
) {
  await insertPostgresSecurityAuditEvent(
    client,
    mutationAudit(event, action, targetType, targetId, "denied", reasonCode),
  );
}

export function createPostgresAdminAccessPersistenceRepository(
  pool: PostgresPool,
  options: PostgresAdminAccessPersistenceOptions = {},
): AdminAccessPersistenceRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  async function transaction(
    work: (client: PostgresClient) => Promise<AdminAccessPersistenceResult>,
    conflictAudit?: SecurityAuditEvent,
  ) {
    try {
      return await withPostgresTransaction(pool, transactionOptions, work);
    } catch (error) {
      if (!isNamedPostgresConstraint(error, "23505", INVITATION_CONFLICT_CONSTRAINTS)) {
        throw error;
      }
      if (conflictAudit) {
        await withPostgresTransaction(pool, transactionOptions, async (client) => {
          await lockAdministration(client);
          await insertPostgresSecurityAuditEvent(client, conflictAudit);
        });
      }
      return { outcome: "conflict" as const };
    }
  }

  return Object.freeze({
    async createInvitation(intent: CreateAdminInvitationIntent) {
      assertPersistenceUuid(intent.id, "Invitation ID");
      const email = normalizedInvitationEmail(intent.email);
      assertPersistenceHash(intent.tokenHash, "Invitation token hash");
      const role = roleKey(intent.role);
      const projectIds = desiredProjects(role, intent.projectIds);
      if (role === "project_manager" && projectIds.length === 0) {
        throw new TypeError("Project Manager invitations require at least one project");
      }
      assertPersistenceUuid(intent.invitedByUserId, "Invitation inviter user ID");
      assertPersistenceText(intent.invitedByActorKey, "Invitation actor key", 255);
      actorSessionValues({
        actorUserId: intent.invitedByUserId,
        actorSessionId: intent.actorSessionId,
        actorSessionVersion: intent.actorSessionVersion,
        actorAuthorizationVersion: intent.actorAuthorizationVersion,
      });
      const createdAt = persistenceDate(intent.createdAt, "Invitation creation time");
      const expiresAt = persistenceDate(intent.expiresAt, "Invitation expiry time");
      const purgeAfter = persistenceDate(intent.purgeAfter, "Invitation purge time");
      if (expiresAt.getTime() - createdAt.getTime() !== AUTHORIZATION_ACCESS_DEFAULTS.invitationLifetimeMs) {
        throw new TypeError("Invitation lifetime must use the fixed seven-day policy");
      }
      if (purgeAfter <= expiresAt) {
        throw new TypeError("Invitation purge time must follow its expiry time");
      }
      const succeeded = mutationAudit(
        intent.audit,
        "identity.invitation_created",
        "invitation",
        intent.id,
      );
      const conflict = mutationAudit(
        intent.audit,
        "identity.invitation_created",
        "invitation",
        intent.id,
        "denied",
        "conflict",
      );
      return transaction(async (client) => {
        await lockAdministration(client);
        if (!await activeAdministratorActor(
          client,
          {
            actorUserId: intent.invitedByUserId,
            actorSessionId: intent.actorSessionId,
            actorSessionVersion: intent.actorSessionVersion,
            actorAuthorizationVersion: intent.actorAuthorizationVersion,
            audit: intent.audit,
          },
          AUTHORIZATION_CAPABILITIES.invitationsCreate,
          "identity.invitation_created",
          "invitation",
          intent.id,
        )) {
          return { outcome: "actor_authorization_changed" as const };
        }
        await client.query(
          `UPDATE invitations
           SET token_hash = NULL,
               status = 'expired',
               expired_at = expires_at,
               updated_at = pg_catalog.greatest(updated_at, $2),
               version = version + 1
           WHERE email_key = $1
             AND status = 'pending'
             AND expires_at <= $2`,
          [email, createdAt],
        );
        const roleId = await activeRoleId(client, role);
        if (projectIds.length > 0) {
          const found = await client.query<{ id: unknown }>(
            "SELECT id::text AS id FROM projects WHERE id = ANY($1::uuid[]) ORDER BY id",
            [projectIds],
          );
          const foundIds = new Set(found.rows.map((row) =>
            parsePostgresUuid(row.id, "PostgreSQL invitation project ID")));
          if (foundIds.size !== projectIds.length || projectIds.some((id) => !foundIds.has(id))) {
            await appendDenied(
              client,
              intent.audit,
              "identity.invitation_created",
              "invitation",
              intent.id,
              "project_not_found",
            );
            return { outcome: "conflict" as const };
          }
        }
        const inserted = await client.query<{ version: unknown }>(
          `INSERT INTO invitations (
             id, email, email_key, token_hash, role_id, status,
             invited_by_user_id, invited_by_actor_key, expires_at,
             purge_after, created_at, updated_at, version
           ) VALUES ($1, $2, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $9, 1)
           RETURNING version::text AS version`,
          [
            intent.id,
            email,
            intent.tokenHash,
            roleId,
            intent.invitedByUserId,
            intent.invitedByActorKey,
            expiresAt,
            purgeAfter,
            createdAt,
          ],
        );
        const row = exactRow(inserted, "PostgreSQL administration invitation");
        if (projectIds.length > 0) {
          const assigned = await client.query(
            `INSERT INTO invitation_project_assignments (
               invitation_id, project_id, assigned_at
             )
             SELECT $1, desired.project_id, $3
             FROM pg_catalog.unnest($2::uuid[]) AS desired(project_id)`,
            [intent.id, projectIds, createdAt],
          );
          if (assigned.rowCount !== projectIds.length) {
            throw new Error("PostgreSQL invitation projects were not persisted exactly once each");
          }
        }
        await insertPostgresSecurityAuditEvent(client, succeeded);
        return accepted(row.version, "PostgreSQL administration invitation version");
      }, conflict);
    },

    async revokeInvitation(intent: RevokeAdminInvitationIntent) {
      assertPersistenceUuid(intent.invitationId, "Invitation ID");
      const expectedVersion = persistenceVersion(intent.expectedVersion, "Expected invitation version");
      const revokedAt = actorValues(intent);
      return transaction(async (client) => {
        await lockAdministration(client);
        if (!await activeAdministratorActor(
          client,
          intent,
          AUTHORIZATION_CAPABILITIES.invitationsRevoke,
          "identity.invitation_revoked",
          "invitation",
          intent.invitationId,
        )) {
          return { outcome: "actor_authorization_changed" as const };
        }
        const updated = await client.query<{ version: unknown }>(
          `UPDATE invitations
           SET token_hash = NULL,
               status = 'revoked',
               revoked_by_user_id = $3,
               revoked_at = $4,
               updated_at = pg_catalog.greatest(updated_at, $4),
               version = version + 1
           WHERE id = $1 AND version = $2::bigint AND status = 'pending'
           RETURNING version::text AS version`,
          [intent.invitationId, expectedVersion, intent.actorUserId, revokedAt],
        );
        if (updated.rowCount === 0 && updated.rows.length === 0) {
          await appendDenied(
            client,
            intent.audit,
            "identity.invitation_revoked",
            "invitation",
            intent.invitationId,
            "stale_state",
          );
          return { outcome: "stale" as const };
        }
        const row = exactRow(updated, "PostgreSQL invitation revocation");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "identity.invitation_revoked",
          "invitation",
          intent.invitationId,
          "succeeded",
          intent.reasonCode,
        ));
        return accepted(row.version, "PostgreSQL invitation version");
      });
    },

    async setUserAccess(intent: SetUserAccessIntent) {
      assertPersistenceUuid(intent.userId, "Administration user ID");
      const expectedVersion = persistenceVersion(intent.expectedVersion, "Expected administration user version");
      const role = roleKey(intent.role);
      const projectIds = desiredProjects(role, intent.projectIds);
      const changedAt = actorValues(intent);
      return transaction(async (client) => {
        await lockAdministration(client);
        if (!await activeAdministratorActor(
          client,
          intent,
          AUTHORIZATION_CAPABILITIES.rolesAssign,
          "authorization.user_access_changed",
          "user",
          intent.userId,
        )) {
          return { outcome: "actor_authorization_changed" as const };
        }
        const user = checkedUserRow(await selectUserForUpdate(client, intent.userId), expectedVersion);
        if (!user || user.status !== "active") {
          await appendDenied(
            client,
            intent.audit,
            "authorization.user_access_changed",
            "user",
            intent.userId,
            "stale_state",
          );
          return { outcome: "stale" as const };
        }
        if (
          user.role_key === "administrator"
          && role !== "administrator"
          && await isFinalActiveAdministrator(client)
        ) {
          await appendDenied(
            client,
            intent.audit,
            "authorization.user_access_changed",
            "user",
            intent.userId,
            "final_active_administrator",
          );
          return { outcome: "final_active_administrator" as const };
        }

        const targetRoleId = await activeRoleId(client, role);
        if (projectIds.length > 0) {
          const found = await client.query<{ id: unknown }>(
            "SELECT id::text AS id FROM projects WHERE id = ANY($1::uuid[]) ORDER BY id",
            [projectIds],
          );
          const foundIds = new Set(found.rows.map((row) =>
            parsePostgresUuid(row.id, "PostgreSQL administration project ID")));
          if (foundIds.size !== projectIds.length || projectIds.some((id) => !foundIds.has(id))) {
            await appendDenied(
              client,
              intent.audit,
              "authorization.user_access_changed",
              "user",
              intent.userId,
              "project_not_found",
            );
            return { outcome: "conflict" as const };
          }
        }

        const currentProjects = await client.query<{ project_id: unknown }>(
          `SELECT project_id::text AS project_id
           FROM project_memberships
           WHERE user_id = $1 AND status = 'active'
           ORDER BY project_id`,
          [intent.userId],
        );
        const previousProjectIds = Object.freeze(currentProjects.rows.map((row) =>
          parsePostgresUuid(row.project_id, "PostgreSQL current project membership ID")));
        if (new Set(previousProjectIds).size !== previousProjectIds.length) {
          throw new Error("PostgreSQL current project memberships contain duplicates");
        }
        const accessHistoryAudit: SecurityAuditEvent = Object.freeze({
          ...intent.audit,
          metadata: Object.freeze({
            ...intent.audit.metadata,
            previous_role: user.role_key as AdminAccessRoleKey | null,
            previous_project_ids: previousProjectIds,
            new_role: role,
            new_project_ids: projectIds,
          }),
        });

        const roleAssignment = await client.query(
          `INSERT INTO user_roles (
             user_id, role_id, assigned_by_user_id, assigned_by_actor_key,
             assigned_at, expires_at, version
           ) VALUES ($1, $2, $3, $4, $5, NULL, 1)
           ON CONFLICT (user_id) DO UPDATE
           SET role_id = EXCLUDED.role_id,
               assigned_by_user_id = EXCLUDED.assigned_by_user_id,
               assigned_by_actor_key = EXCLUDED.assigned_by_actor_key,
               assigned_at = EXCLUDED.assigned_at,
               version = user_roles.version + 1`,
          [intent.userId, targetRoleId, intent.actorUserId, intent.actorKey, changedAt],
        );
        if (roleAssignment.rowCount !== 1) {
          throw new Error("PostgreSQL user role assignment was not persisted exactly once");
        }

        await client.query(
          `UPDATE project_memberships
           SET status = 'revoked',
               revoked_by_user_id = $3,
               revoked_by_actor_key = $4,
               revoked_at = $5,
               revocation_reason_code = $6,
               version = version + 1
           WHERE user_id = $1
             AND status = 'active'
             AND NOT (project_id = ANY($2::uuid[]))`,
          [
            intent.userId,
            projectIds,
            intent.actorUserId,
            intent.actorKey,
            changedAt,
            intent.reasonCode,
          ],
        );

        if (projectIds.length > 0) {
          const projectAssignments = await client.query(
            `INSERT INTO project_memberships (
               project_id, user_id, assigned_by_user_id, assigned_by_actor_key,
               assigned_at, expires_at, status, revoked_by_user_id,
               revoked_by_actor_key, revoked_at, revocation_reason_code, version
             )
             SELECT desired.project_id, $1, $3, $4, $5, NULL, 'active',
                    NULL, NULL, NULL, NULL, 1
             FROM pg_catalog.unnest($2::uuid[]) AS desired(project_id)
             ON CONFLICT (project_id, user_id) DO UPDATE
             SET assigned_by_user_id = EXCLUDED.assigned_by_user_id,
                 assigned_by_actor_key = EXCLUDED.assigned_by_actor_key,
                 assigned_at = EXCLUDED.assigned_at,
                 status = 'active',
                 revoked_by_user_id = NULL,
                 revoked_by_actor_key = NULL,
                 revoked_at = NULL,
                 revocation_reason_code = NULL,
                 version = project_memberships.version + 1`,
            [intent.userId, projectIds, intent.actorUserId, intent.actorKey, changedAt],
          );
          if (projectAssignments.rowCount !== projectIds.length) {
            throw new Error("PostgreSQL project assignments were not persisted exactly once each");
          }
        }

        const updated = await client.query<{ version: unknown; authorization_version: unknown }>(
          `UPDATE users
           SET authorization_version = authorization_version + 1,
               sessions_valid_after = pg_catalog.greatest(sessions_valid_after, $3),
               updated_at = pg_catalog.greatest(updated_at, $3),
               version = version + 1
           WHERE id = $1 AND version = $2::bigint AND status = 'active'
           RETURNING version::text AS version,
                     authorization_version::text AS authorization_version`,
          [intent.userId, expectedVersion, changedAt],
        );
        const updatedUser = exactRow(updated, "PostgreSQL user access update");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          accessHistoryAudit,
          "authorization.user_access_changed",
          "user",
          intent.userId,
          "succeeded",
          intent.reasonCode,
        ));
        return accepted(
          updatedUser.version,
          "PostgreSQL administration user version",
          updatedUser.authorization_version,
        );
      });
    },

    async disableUser(intent: DisableUserAccessIntent) {
      assertPersistenceUuid(intent.userId, "Administration user ID");
      const expectedVersion = persistenceVersion(intent.expectedVersion, "Expected administration user version");
      const disabledAt = actorValues(intent);
      return transaction(async (client) => {
        await lockAdministration(client);
        if (!await activeAdministratorActor(
          client,
          intent,
          AUTHORIZATION_CAPABILITIES.usersDisable,
          "identity.user_disabled",
          "user",
          intent.userId,
        )) {
          return { outcome: "actor_authorization_changed" as const };
        }
        const user = checkedUserRow(await selectUserForUpdate(client, intent.userId), expectedVersion);
        if (!user || user.status !== "active") {
          await appendDenied(
            client,
            intent.audit,
            "identity.user_disabled",
            "user",
            intent.userId,
            "stale_state",
          );
          return { outcome: "stale" as const };
        }
        if (user.role_key === "administrator" && await isFinalActiveAdministrator(client)) {
          await appendDenied(
            client,
            intent.audit,
            "identity.user_disabled",
            "user",
            intent.userId,
            "final_active_administrator",
          );
          return { outcome: "final_active_administrator" as const };
        }
        const updated = await client.query<{ version: unknown; authorization_version: unknown }>(
          `UPDATE users
           SET status = 'disabled',
               disabled_at = $3,
               authorization_version = authorization_version + 1,
               sessions_valid_after = pg_catalog.greatest(sessions_valid_after, $3),
               updated_at = pg_catalog.greatest(updated_at, $3),
               version = version + 1
           WHERE id = $1 AND version = $2::bigint AND status = 'active'
           RETURNING version::text AS version,
                     authorization_version::text AS authorization_version`,
          [intent.userId, expectedVersion, disabledAt],
        );
        const updatedUser = exactRow(updated, "PostgreSQL user disable");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "identity.user_disabled",
          "user",
          intent.userId,
          "succeeded",
          intent.reasonCode,
        ));
        return accepted(
          updatedUser.version,
          "PostgreSQL administration user version",
          updatedUser.authorization_version,
        );
      });
    },

    async invalidateUserSessions(intent: InvalidateUserSessionsIntent) {
      assertPersistenceUuid(intent.userId, "Administration user ID");
      const expectedVersion = persistenceVersion(intent.expectedVersion, "Expected administration user version");
      const invalidatedAt = actorValues(intent);
      return transaction(async (client) => {
        await lockAdministration(client);
        if (!await activeAdministratorActor(
          client,
          intent,
          AUTHORIZATION_CAPABILITIES.sessionsRevoke,
          "identity.sessions_invalidated",
          "user",
          intent.userId,
        )) {
          return { outcome: "actor_authorization_changed" as const };
        }
        const user = checkedUserRow(await selectUserForUpdate(client, intent.userId), expectedVersion);
        if (!user) {
          await appendDenied(
            client,
            intent.audit,
            "identity.sessions_invalidated",
            "user",
            intent.userId,
            "stale_state",
          );
          return { outcome: "stale" as const };
        }
        const updated = await client.query<{ version: unknown; authorization_version: unknown }>(
          `UPDATE users
           SET authorization_version = authorization_version + 1,
               sessions_valid_after = pg_catalog.greatest(sessions_valid_after, $3),
               updated_at = pg_catalog.greatest(updated_at, $3),
               version = version + 1
           WHERE id = $1 AND version = $2::bigint
           RETURNING version::text AS version,
                     authorization_version::text AS authorization_version`,
          [intent.userId, expectedVersion, invalidatedAt],
        );
        const updatedUser = exactRow(updated, "PostgreSQL session invalidation");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "identity.sessions_invalidated",
          "user",
          intent.userId,
          "succeeded",
          intent.reasonCode,
        ));
        return accepted(
          updatedUser.version,
          "PostgreSQL administration user version",
          updatedUser.authorization_version,
        );
      });
    },
  });
}
