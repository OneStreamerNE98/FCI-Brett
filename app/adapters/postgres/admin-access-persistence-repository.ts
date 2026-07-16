import {
  AUTHORIZATION_ACCESS_DEFAULTS,
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_DOMAIN,
  normalizeAuthorizationCompanyEmail,
} from "../../application/authorization-policy";
import {
  ADMIN_ACCESS_ROLE_KEYS,
  type AdminAccessInvitationSummary,
  type AdminAccessOverview,
  type AdminAccessPersistenceRepository,
  type AdminAccessPersistenceResult,
  type AdminAccessPersonSummary,
  type AdminAccessProjectSummary,
  type AdminAccessRoleKey,
  type AdminAccessRoleSummary,
  type CreateAdminInvitationIntent,
  type DisableUserAccessIntent,
  type InvalidateUserSessionsIntent,
  type RevokeAdminInvitationIntent,
  type SetUserAccessIntent,
} from "../../ports/admin-access-persistence";
import type { AuthorizationRecordScope } from "../../ports/authorization";
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
import {
  parsePostgresTimestamp,
  parsePostgresUuid,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresAdminAccessPersistenceOptions = Readonly<{
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}>;

/** Distinct from the session-scoped production migration lock. */
export const ADMIN_ACCESS_MUTATION_LOCK_ID = "7314269172071302";

const MAX_PROJECT_ASSIGNMENTS = 50;
const MAX_ACCESS_USERS = 100;
const MAX_ACCESS_INVITATIONS = 100;
const MAX_ACCESS_PROJECTS = 500;
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

type AccessOverviewUserRow = Record<string, unknown> & {
  id: unknown;
  email: unknown;
  display_name: unknown;
  status: unknown;
  role_key: unknown;
  role_status: unknown;
  project_ids: unknown;
  last_signed_in_at: unknown;
  version: unknown;
};

type AccessOverviewRoleRow = Record<string, unknown> & {
  role_key: unknown;
  display_name: unknown;
  description: unknown;
};

type AccessOverviewInvitationRow = Record<string, unknown> & {
  id: unknown;
  email: unknown;
  role_key: unknown;
  role_status: unknown;
  project_ids: unknown;
  created_at: unknown;
  expires_at: unknown;
  version: unknown;
};

type AccessOverviewProjectRow = Record<string, unknown> & {
  id: unknown;
  project_number: unknown;
  name: unknown;
  status: unknown;
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

function accessText(value: unknown, label: string, maximum = 512) {
  assertPersistenceText(value, label, maximum);
  return value;
}

function accessProjectIds(value: unknown, label: string, maximum = MAX_PROJECT_ASSIGNMENTS) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded PostgreSQL UUID array`);
  }
  const ids = value.map((id, index) => parsePostgresUuid(id, `${label} ${index + 1}`));
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} must contain unique project IDs`);
  }
  return Object.freeze(ids);
}

function accessReadScope(scope: AuthorizationRecordScope, now: number) {
  if (!scope || scope.kind !== "company" || scope.includeFinancial !== true) {
    throw new TypeError("Administration access overview requires company Administrator scope");
  }
  assertPersistenceUuid(scope.sessionId, "Administration reader session ID");
  assertPersistenceUuid(scope.userId, "Administration reader user ID");
  return Object.freeze({
    sessionId: scope.sessionId,
    sessionVersion: persistenceVersion(
      scope.sessionVersion,
      "Administration reader session version",
    ),
    userId: scope.userId,
    authorizationVersion: persistenceVersion(
      scope.authorizationVersion,
      "Administration reader authorization version",
    ),
    checkedAt: persistenceDate(now, "Administration overview time"),
  });
}

function boundedRows<Row extends Record<string, unknown>>(
  result: { rowCount: number | null; rows: Row[] },
  maximum: number,
  label: string,
) {
  if (result.rowCount !== result.rows.length) {
    throw new Error(`${label} returned an invalid row count`);
  }
  if (result.rows.length > maximum) {
    throw new Error(`${label} exceeds its bounded projection limit`);
  }
  return result.rows;
}

function accessOverviewPerson(row: AccessOverviewUserRow): AdminAccessPersonSummary {
  const email = normalizedInvitationEmail(accessText(row.email, "Access user email", 320));
  if (row.status !== "active" && row.status !== "disabled") {
    throw new TypeError("Access user status is invalid");
  }
  if (row.role_status !== "active") {
    throw new TypeError("Access user role status is invalid");
  }
  const role = roleKey(row.role_key);
  const projectIds = accessProjectIds(row.project_ids, "Access user project IDs");
  if (role !== "project_manager" && projectIds.length !== 0) {
    throw new TypeError("Only an access Project Manager can have active project assignments");
  }
  return Object.freeze({
    id: parsePostgresUuid(row.id, "Access user ID"),
    email,
    displayName: accessText(row.display_name, "Access user display name"),
    status: row.status,
    role,
    projectIds,
    lastSignedInAt: row.last_signed_in_at === null
      ? null
      : parsePostgresTimestamp(row.last_signed_in_at, "Access user last sign-in"),
    version: persistenceVersion(row.version, "Access user version"),
  });
}

function accessOverviewInvitation(
  row: AccessOverviewInvitationRow,
): AdminAccessInvitationSummary {
  if (row.role_status !== "active") {
    throw new TypeError("Access invitation role status is invalid");
  }
  const role = roleKey(row.role_key);
  const projectIds = accessProjectIds(row.project_ids, "Access invitation project IDs");
  if (
    (role === "project_manager" && projectIds.length === 0)
    || (role !== "project_manager" && projectIds.length !== 0)
  ) {
    throw new TypeError("Access invitation project assignments do not match its fixed role");
  }
  return Object.freeze({
    id: parsePostgresUuid(row.id, "Access invitation ID"),
    email: normalizedInvitationEmail(accessText(row.email, "Access invitation email", 320)),
    role,
    status: "pending",
    projectIds,
    createdAt: parsePostgresTimestamp(row.created_at, "Access invitation created time"),
    expiresAt: parsePostgresTimestamp(row.expires_at, "Access invitation expiry time"),
    version: persistenceVersion(row.version, "Access invitation version"),
  });
}

function accessOverviewProject(row: AccessOverviewProjectRow): AdminAccessProjectSummary {
  return Object.freeze({
    id: parsePostgresUuid(row.id, "Access project ID"),
    projectNumber: accessText(row.project_number, "Access project number", 64),
    name: accessText(row.name, "Access project name"),
    status: accessText(row.status, "Access project status", 64),
  });
}

function accessOverviewRole(row: AccessOverviewRoleRow): AdminAccessRoleSummary {
  return Object.freeze({
    key: roleKey(row.role_key),
    displayName: accessText(row.display_name, "Access role display name", 128),
    description: accessText(row.description, "Access role description", 512),
  });
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

async function activeAdministratorReader(
  client: PostgresClient,
  reader: ReturnType<typeof accessReadScope>,
) {
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
     FOR SHARE OF actor_session, actor_user`,
    [
      reader.sessionId,
      reader.sessionVersion,
      reader.userId,
      reader.authorizationVersion,
      AUTHORIZATION_CAPABILITIES.accessAdminRead,
    ],
  );
  if (current.rowCount === 1 && current.rows.length === 1) return true;
  if (current.rowCount !== 0 || current.rows.length !== 0) {
    throw new Error("PostgreSQL administration reader fence returned an invalid row count");
  }
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
    async getAccessOverview(scope: AuthorizationRecordScope, now: number) {
      const reader = accessReadScope(scope, now);
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, isolationLevel: "repeatable_read" },
        async (client) => {
          if (!await activeAdministratorReader(client, reader)) {
            return { outcome: "actor_authorization_changed" as const };
          }

          const roleResult = await client.query<AccessOverviewRoleRow>(
            `SELECT role_key, display_name, description
             FROM roles
             WHERE status = 'active'
               AND role_key = ANY($1::text[])
             ORDER BY pg_catalog.array_position($1::text[], role_key)`,
            [ADMIN_ACCESS_ROLE_KEYS],
          );
          const roleRows = boundedRows(
            roleResult,
            ADMIN_ACCESS_ROLE_KEYS.length,
            "PostgreSQL administration role projection",
          );
          if (roleRows.length !== ADMIN_ACCESS_ROLE_KEYS.length) {
            throw new Error("PostgreSQL administration role projection is incomplete");
          }
          const roles = Object.freeze(roleRows.map(accessOverviewRole));

          const peopleResult = await client.query<AccessOverviewUserRow>(
            `WITH bounded_people AS MATERIALIZED (
               SELECT employee.id,
                      employee.email,
                      employee.email_key,
                      employee.display_name,
                      employee.status,
                      assigned_role.role_key,
                      assigned_role.status AS role_status,
                      employee.version
               FROM users AS employee
               LEFT JOIN user_roles AS assignment ON assignment.user_id = employee.id
               LEFT JOIN roles AS assigned_role ON assigned_role.id = assignment.role_id
               ORDER BY CASE WHEN employee.status = 'active' THEN 0 ELSE 1 END,
                        pg_catalog.lower(employee.display_name), employee.email_key, employee.id
               LIMIT $1
             ),
             project_scopes AS (
               SELECT membership.user_id,
                      pg_catalog.array_agg(
                        membership.project_id::text
                        ORDER BY membership.project_id::text
                      ) AS project_ids
               FROM project_memberships AS membership
               JOIN bounded_people AS employee ON employee.id = membership.user_id
               WHERE membership.status = 'active'
               GROUP BY membership.user_id
             ),
             last_sign_ins AS (
               SELECT sign_in.user_id,
                      pg_catalog.max(sign_in.issued_at) AS last_signed_in_at
               FROM sessions AS sign_in
               JOIN bounded_people AS employee ON employee.id = sign_in.user_id
               GROUP BY sign_in.user_id
             )
             SELECT employee.id::text AS id,
                    employee.email,
                    employee.display_name,
                    employee.status,
                    employee.role_key,
                    employee.role_status,
                    pg_catalog.coalesce(project_scopes.project_ids, ARRAY[]::text[]) AS project_ids,
                    last_sign_ins.last_signed_in_at,
                    employee.version::text AS version
             FROM bounded_people AS employee
             LEFT JOIN project_scopes ON project_scopes.user_id = employee.id
             LEFT JOIN last_sign_ins ON last_sign_ins.user_id = employee.id
             ORDER BY CASE WHEN employee.status = 'active' THEN 0 ELSE 1 END,
                      pg_catalog.lower(employee.display_name), employee.email_key, employee.id`,
            [MAX_ACCESS_USERS + 1],
          );
          const people = Object.freeze(boundedRows(
            peopleResult,
            MAX_ACCESS_USERS,
            "PostgreSQL administration people projection",
          ).map(accessOverviewPerson));

          const invitationResult = await client.query<AccessOverviewInvitationRow>(
            `SELECT invitation.id::text AS id,
                    invitation.email,
                    intended_role.role_key,
                    intended_role.status AS role_status,
                    pg_catalog.coalesce(
                      pg_catalog.array_agg(
                        assignment.project_id::text
                        ORDER BY assignment.project_id::text
                      ) FILTER (WHERE assignment.project_id IS NOT NULL),
                      ARRAY[]::text[]
                    ) AS project_ids,
                    invitation.created_at,
                    invitation.expires_at,
                    invitation.version::text AS version
             FROM invitations AS invitation
             JOIN roles AS intended_role ON intended_role.id = invitation.role_id
             LEFT JOIN invitation_project_assignments AS assignment
               ON assignment.invitation_id = invitation.id
             WHERE invitation.status = 'pending'
               AND invitation.expires_at > pg_catalog.statement_timestamp()
             GROUP BY invitation.id, invitation.email, invitation.email_key,
                      intended_role.role_key, intended_role.status, invitation.created_at,
                      invitation.expires_at, invitation.version
             ORDER BY invitation.expires_at, invitation.email_key, invitation.id
             LIMIT $1`,
            [MAX_ACCESS_INVITATIONS + 1],
          );
          const invitations = Object.freeze(boundedRows(
            invitationResult,
            MAX_ACCESS_INVITATIONS,
            "PostgreSQL administration invitation projection",
          ).map(accessOverviewInvitation));

          const projectResult = await client.query<AccessOverviewProjectRow>(
            `SELECT id::text AS id, project_number, name, status
             FROM projects
             ORDER BY project_number, id
             LIMIT $1`,
            [MAX_ACCESS_PROJECTS + 1],
          );
          const projects = Object.freeze(boundedRows(
            projectResult,
            MAX_ACCESS_PROJECTS,
            "PostgreSQL administration project projection",
          ).map(accessOverviewProject));

          const overview: AdminAccessOverview = Object.freeze({
            summary: Object.freeze({
              activePeopleCount: people.filter(({ status }) => status === "active").length,
              activeAdministratorCount: people.filter(
                ({ status, role }) => status === "active" && role === "administrator",
              ).length,
              pendingInvitationCount: invitations.length,
            }),
            roles,
            people,
            invitations,
            projects,
            generatedAt: reader.checkedAt.getTime(),
          });
          return { outcome: "accepted" as const, overview };
        },
      );
    },

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
               updated_at = GREATEST(updated_at, $2),
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
               updated_at = GREATEST(updated_at, $4),
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
        if (
          user.role_key === role
          && previousProjectIds.length === projectIds.length
          && previousProjectIds.every((projectId, index) => projectId === projectIds[index])
        ) {
          await appendDenied(
            client,
            intent.audit,
            "authorization.user_access_changed",
            "user",
            intent.userId,
            "unchanged_access",
          );
          return { outcome: "conflict" as const };
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
               sessions_valid_after = GREATEST(sessions_valid_after, $3),
               updated_at = GREATEST(updated_at, $3),
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
               sessions_valid_after = GREATEST(sessions_valid_after, $3),
               updated_at = GREATEST(updated_at, $3),
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
               sessions_valid_after = GREATEST(sessions_valid_after, $3),
               updated_at = GREATEST(updated_at, $3),
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
