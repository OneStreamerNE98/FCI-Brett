import type {
  AuthenticateEmployeeSessionDenialReason,
  AuthenticateEmployeeSessionIntent,
  AuthenticateEmployeeSessionResult,
  IdentityPersistenceRepository,
  IdentityPersistenceResult,
  RegisterExternalIdentityIntent,
  RevokeSessionIntent,
} from "../../ports/identity-persistence";
import {
  AUTHORIZATION_ACCESS_DEFAULTS,
  AUTHORIZATION_DOMAIN,
  AUTHORIZATION_ROLES,
  normalizeAuthorizationCompanyEmail,
} from "../../application/authorization-policy";
import type { SecurityAuditEvent } from "../../ports/security-audit";
import { insertPostgresSecurityAuditEvent } from "./security-audit-repository";
import {
  withPostgresTransaction,
  type PostgresClient,
  type PostgresPool,
} from "./postgres-database";
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
import {
  parsePostgresTimestamp,
  parsePostgresUuid,
  postgresSchemaName,
} from "./postgres-values";

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
  "sessions_pkey",
  "sessions_token_hash_idx",
  "sessions_rotated_from_session_id_idx",
  "user_roles_pkey",
  "user_roles_one_role_per_user_idx",
  "project_memberships_pkey",
] as const;

const GOOGLE_OIDC_PROVIDER = "google_oidc";
const GOOGLE_OIDC_ISSUER = "https://accounts.google.com";
const SUPPORTED_ROLE_KEYS = new Set<string>(Object.values(AUTHORIZATION_ROLES));

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

type ExistingIdentityRow = {
  identity_id: unknown;
  user_id: unknown;
  email: unknown;
  status: unknown;
  authorization_version: unknown;
  sessions_valid_after: unknown;
};

type InvitationLoginRow = {
  invitation_id: unknown;
  invitation_email: unknown;
  invitation_email_key: unknown;
  invitation_status: unknown;
  created_at: unknown;
  expires_at: unknown;
  invited_by_user_id: unknown;
  invited_by_actor_key: unknown;
  role_id: unknown;
  role_key: unknown;
  role_status: unknown;
};

function exactOptionalRow<Row>(
  result: { rowCount: number | null; rows: Row[] },
  label: string,
) {
  if (result.rowCount === 0 && result.rows.length === 0) return null;
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new Error(`${label} was not unique`);
  }
  return result.rows[0] ?? null;
}

function authenticatedUserAudit(
  event: SecurityAuditEvent,
  userId: string,
  email: string,
  semantics: Parameters<typeof persistenceAuditEvent>[1],
) {
  return persistenceAuditEvent({
    ...event,
    executorType: "user",
    executorUserId: userId,
    executorKey: email,
  }, semantics);
}

function anonymousLoginAudit(
  event: SecurityAuditEvent,
  reason: AuthenticateEmployeeSessionDenialReason | "conflict",
) {
  return persistenceAuditEvent(event, {
    action: "identity.login_failed",
    targetType: "login_attempt",
    targetId: event.correlationId,
    result: "denied",
    reasonCode: reason,
  });
}

function assertEmployeeAuthentication(intent: AuthenticateEmployeeSessionIntent) {
  if (intent.identity.provider !== GOOGLE_OIDC_PROVIDER) {
    throw new TypeError("Employee identity provider must be google_oidc");
  }
  if (intent.identity.issuer !== GOOGLE_OIDC_ISSUER) {
    throw new TypeError("Employee identity issuer must be the canonical Google issuer");
  }
  assertPersistenceText(intent.identity.subject, "Employee identity subject", 512);
  const email = normalizeAuthorizationCompanyEmail(intent.identity.email);
  if (email === null || email !== intent.identity.email) {
    throw new TypeError(`Employee identity email must be a normalized ${AUTHORIZATION_DOMAIN} address`);
  }
  if (intent.identity.hostedDomain !== AUTHORIZATION_DOMAIN) {
    throw new TypeError(`Employee identity hosted domain must be ${AUTHORIZATION_DOMAIN}`);
  }
  if (intent.identity.emailVerified !== true) {
    throw new TypeError("Employee identity email must be verified");
  }
  assertPersistenceText(intent.identity.displayName, "Employee identity display name", 255);
  if (intent.invitationTokenHash !== null) {
    assertPersistenceHash(intent.invitationTokenHash, "Employee invitation token hash");
  }
  assertPersistenceUuid(intent.newUserId, "Employee user ID");
  assertPersistenceUuid(intent.newExternalIdentityId, "Employee external identity ID");
  assertPersistenceUuid(intent.session.id, "Employee session ID");
  assertPersistenceHash(intent.session.tokenHash, "Employee session token hash");
  assertPersistenceHash(intent.session.csrfHash, "Employee session CSRF hash");
  const issuedAt = persistenceDate(intent.session.issuedAt, "Employee session issued_at");
  const idleExpiresAt = persistenceDate(
    intent.session.idleExpiresAt,
    "Employee session idle_expires_at",
  );
  const absoluteExpiresAt = persistenceDate(
    intent.session.absoluteExpiresAt,
    "Employee session absolute_expires_at",
  );
  const purgeAfter = persistenceDate(intent.session.purgeAfter, "Employee session purge_after");
  if (
    idleExpiresAt.getTime() - issuedAt.getTime()
      !== AUTHORIZATION_ACCESS_DEFAULTS.sessionIdleLifetimeMs
    || absoluteExpiresAt.getTime() - issuedAt.getTime()
      !== AUTHORIZATION_ACCESS_DEFAULTS.sessionAbsoluteLifetimeMs
    || purgeAfter <= absoluteExpiresAt
  ) {
    throw new TypeError("Employee session must use the fixed idle and absolute lifetime policy");
  }
  return { email, issuedAt, idleExpiresAt, absoluteExpiresAt, purgeAfter };
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

  async function authenticationTransaction(
    work: (client: PostgresClient) => Promise<AuthenticateEmployeeSessionResult>,
    conflictAudit: SecurityAuditEvent,
  ): Promise<AuthenticateEmployeeSessionResult> {
    try {
      return await withPostgresTransaction(pool, transactionOptions, work);
    } catch (error) {
      if (!isNamedPostgresConstraint(error, "23505", IDENTITY_CONFLICT_CONSTRAINTS)) {
        throw error;
      }
      await withPostgresTransaction(pool, transactionOptions, (client) =>
        insertPostgresSecurityAuditEvent(client, conflictAudit));
      return { outcome: "conflict" };
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

    async authenticateEmployeeSession(intent) {
      const times = assertEmployeeAuthentication(intent);
      const conflictAudit = anonymousLoginAudit(intent.loginAudit, "conflict");

      return authenticationTransaction(async (client) => {
        const deny = async (
          reason: AuthenticateEmployeeSessionDenialReason,
        ): Promise<AuthenticateEmployeeSessionResult> => {
          await insertPostgresSecurityAuditEvent(
            client,
            anonymousLoginAudit(intent.loginAudit, reason),
          );
          return { outcome: "denied", reason };
        };

        const insertSession = async (
          userId: string,
          authorizationVersion: string,
        ) => {
          const inserted = await client.query<{ version: unknown }>(
            `INSERT INTO sessions (
               id, user_id, token_hash, csrf_hash, authorization_version,
               rotated_from_session_id, issued_at, last_seen_at, idle_expires_at,
               absolute_expires_at, purge_after, version
             ) VALUES ($1, $2, $3, $4, $5::bigint, NULL, $6, $6, $7, $8, $9, 1)
             RETURNING version::text AS version`,
            [
              intent.session.id,
              userId,
              intent.session.tokenHash,
              intent.session.csrfHash,
              authorizationVersion,
              times.issuedAt,
              times.idleExpiresAt,
              times.absoluteExpiresAt,
              times.purgeAfter,
            ],
          );
          return persistenceVersion(
            exactVersionRow(inserted, "PostgreSQL employee session"),
            "PostgreSQL employee session version",
          );
        };

        const identityResult = await client.query<ExistingIdentityRow>(
          `SELECT external_identity.id::text AS identity_id,
                  employee.id::text AS user_id,
                  employee.email,
                  employee.status,
                  employee.authorization_version::text AS authorization_version,
                  employee.sessions_valid_after
           FROM external_identities AS external_identity
           JOIN users AS employee ON employee.id = external_identity.user_id
           WHERE external_identity.provider = $1
             AND external_identity.issuer = $2
             AND external_identity.subject = $3
           FOR UPDATE OF external_identity, employee`,
          [intent.identity.provider, intent.identity.issuer, intent.identity.subject],
        );
        const existingIdentity = exactOptionalRow(
          identityResult,
          "PostgreSQL employee external identity",
        );

        if (existingIdentity) {
          if (intent.invitationTokenHash !== null) return deny("invitation_invalid");
          const userId = parsePostgresUuid(
            existingIdentity.user_id,
            "PostgreSQL employee user ID",
          );
          const identityId = parsePostgresUuid(
            existingIdentity.identity_id,
            "PostgreSQL employee external identity ID",
          );
          const storedEmail = typeof existingIdentity.email === "string"
            ? normalizeAuthorizationCompanyEmail(existingIdentity.email)
            : null;
          const authorizationVersion = persistenceVersion(
            existingIdentity.authorization_version,
            "PostgreSQL employee authorization version",
          );
          if (
            existingIdentity.status !== "active"
            || storedEmail === null
            || times.issuedAt.getTime() < parsePostgresTimestamp(
              existingIdentity.sessions_valid_after,
              "PostgreSQL employee sessions_valid_after",
            )
          ) {
            return deny("user_unavailable");
          }

          const roles = await client.query<{ role_key: unknown }>(
            `SELECT assigned_role.role_key
             FROM user_roles AS assignment
             JOIN roles AS assigned_role
               ON assigned_role.id = assignment.role_id
              AND assigned_role.status = 'active'
             WHERE assignment.user_id = $1
             ORDER BY assigned_role.role_key`,
            [userId],
          );
          if (
            roles.rowCount !== 1
            || roles.rows.length !== 1
            || !SUPPORTED_ROLE_KEYS.has(String(roles.rows[0]?.role_key))
          ) {
            return deny("role_not_approved");
          }

          const updatedIdentity = await client.query(
            `UPDATE external_identities
             SET email = $2,
                 hosted_domain = $3,
                 email_verified = TRUE,
                 last_authenticated_at = $4,
                 updated_at = $4,
                 version = version + 1
             WHERE id = $1
             RETURNING id`,
            [
              identityId,
              intent.identity.email,
              intent.identity.hostedDomain,
              times.issuedAt,
            ],
          );
          if (updatedIdentity.rowCount !== 1 || updatedIdentity.rows.length !== 1) {
            throw new Error("PostgreSQL employee external identity was not refreshed exactly once");
          }
          const sessionVersion = await insertSession(userId, authorizationVersion);
          await insertPostgresSecurityAuditEvent(client, authenticatedUserAudit(
            intent.loginAudit,
            userId,
            storedEmail,
            {
              action: "identity.login_succeeded",
              targetType: "session",
              targetId: intent.session.id,
              result: "succeeded",
              reasonCode: null,
            },
          ));
          return {
            outcome: "accepted",
            userId,
            email: storedEmail,
            authorizationVersion,
            sessionVersion,
            invitationRedeemed: false,
          };
        }

        if (intent.invitationTokenHash === null) return deny("invitation_required");

        const invitationResult = await client.query<InvitationLoginRow>(
          `SELECT invitation.id::text AS invitation_id,
                  invitation.email AS invitation_email,
                  invitation.email_key AS invitation_email_key,
                  invitation.status AS invitation_status,
                  invitation.created_at,
                  invitation.expires_at,
                  invitation.invited_by_user_id::text AS invited_by_user_id,
                  invitation.invited_by_actor_key,
                  intended_role.id::text AS role_id,
                  intended_role.role_key,
                  intended_role.status AS role_status
           FROM invitations AS invitation
           JOIN roles AS intended_role ON intended_role.id = invitation.role_id
           WHERE invitation.token_hash = $1
           FOR UPDATE OF invitation`,
          [intent.invitationTokenHash],
        );
        const invitation = exactOptionalRow(
          invitationResult,
          "PostgreSQL employee invitation credential",
        );
        if (!invitation) return deny("invitation_invalid");

        const invitationId = parsePostgresUuid(
          invitation.invitation_id,
          "PostgreSQL employee invitation ID",
        );
        const invitationExpiresAt = parsePostgresTimestamp(
          invitation.expires_at,
          "PostgreSQL employee invitation expiry",
        );
        const invitationCreatedAt = parsePostgresTimestamp(
          invitation.created_at,
          "PostgreSQL employee invitation creation time",
        );
        if (
          invitationExpiresAt - invitationCreatedAt
          !== AUTHORIZATION_ACCESS_DEFAULTS.invitationLifetimeMs
        ) {
          return deny("invitation_invalid");
        }
        if (
          invitation.invitation_status !== "pending"
          || invitationExpiresAt <= times.issuedAt.getTime()
        ) {
          if (invitation.invitation_status === "pending") {
            const expired = await client.query(
              `UPDATE invitations
               SET token_hash = NULL,
                   status = 'expired',
                   expired_at = expires_at,
                   updated_at = GREATEST(updated_at, $2),
                   version = version + 1
               WHERE id = $1 AND status = 'pending'
               RETURNING id`,
              [invitationId, times.issuedAt],
            );
            if (expired.rowCount !== 1 || expired.rows.length !== 1) {
              throw new Error("PostgreSQL employee invitation was not expired exactly once");
            }
          }
          return deny("invitation_expired");
        }
        if (
          invitation.invitation_email_key !== times.email
          || invitation.invitation_email !== times.email
        ) {
          return deny("invitation_email_mismatch");
        }
        if (
          invitation.role_status !== "active"
          || !SUPPORTED_ROLE_KEYS.has(String(invitation.role_key))
        ) {
          return deny("role_not_approved");
        }
        const roleKey = String(invitation.role_key);
        const roleId = parsePostgresUuid(invitation.role_id, "PostgreSQL employee role ID");
        const inviterUserId = invitation.invited_by_user_id === null
          ? null
          : parsePostgresUuid(
              invitation.invited_by_user_id,
              "PostgreSQL employee invitation inviter ID",
            );
        if (
          typeof invitation.invited_by_actor_key !== "string"
          || invitation.invited_by_actor_key.trim() === ""
        ) {
          throw new Error("PostgreSQL employee invitation actor key is invalid");
        }

        const projectResult = await client.query<{ project_id: unknown }>(
          `SELECT project_id::text AS project_id
           FROM invitation_project_assignments
           WHERE invitation_id = $1
           ORDER BY project_id`,
          [invitationId],
        );
        if (projectResult.rowCount !== projectResult.rows.length) {
          throw new Error("PostgreSQL employee invitation projects returned an invalid row count");
        }
        const projectIds = projectResult.rows.map((row) =>
          parsePostgresUuid(row.project_id, "PostgreSQL employee invitation project ID"));
        if (
          (roleKey === AUTHORIZATION_ROLES.projectManager && projectIds.length === 0)
          || (roleKey !== AUTHORIZATION_ROLES.projectManager && projectIds.length !== 0)
        ) {
          return deny("role_not_approved");
        }

        const existingEmail = await client.query<{ id: unknown }>(
          "SELECT id::text AS id FROM users WHERE email_key = $1 FOR UPDATE",
          [times.email],
        );
        if (existingEmail.rowCount !== 0 || existingEmail.rows.length !== 0) {
          if (existingEmail.rowCount !== 1 || existingEmail.rows.length !== 1) {
            throw new Error("PostgreSQL employee email was not unique");
          }
          return deny("identity_conflict");
        }

        const user = await client.query<{ authorization_version: unknown }>(
          `INSERT INTO users (
             id, email, email_key, display_name, status, authorization_version,
             sessions_valid_after, created_at, updated_at, version
           ) VALUES ($1, $2, $2, $3, 'active', 1, $4, $4, $4, 1)
           RETURNING authorization_version::text AS authorization_version`,
          [
            intent.newUserId,
            times.email,
            intent.identity.displayName,
            times.issuedAt,
          ],
        );
        const authorizationVersion = persistenceVersion(
          exactVersionRow(
            { rows: user.rows.map((row) => ({ version: row.authorization_version })), rowCount: user.rowCount },
            "PostgreSQL employee user",
          ),
          "PostgreSQL employee authorization version",
        );
        const externalIdentity = await client.query(
          `INSERT INTO external_identities (
             id, user_id, provider, issuer, subject, email, hosted_domain,
             email_verified, first_seen_at, last_authenticated_at, updated_at, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $8, $8, 1)`,
          [
            intent.newExternalIdentityId,
            intent.newUserId,
            intent.identity.provider,
            intent.identity.issuer,
            intent.identity.subject,
            intent.identity.email,
            intent.identity.hostedDomain,
            times.issuedAt,
          ],
        );
        if (externalIdentity.rowCount !== 1) {
          throw new Error("PostgreSQL employee external identity was not inserted exactly once");
        }
        const roleAssignment = await client.query(
          `INSERT INTO user_roles (
             user_id, role_id, assigned_by_user_id, assigned_by_actor_key,
             assigned_at, expires_at, version
           ) VALUES ($1, $2, $3, $4, $5, NULL, 1)`,
          [
            intent.newUserId,
            roleId,
            inviterUserId,
            invitation.invited_by_actor_key,
            times.issuedAt,
          ],
        );
        if (roleAssignment.rowCount !== 1) {
          throw new Error("PostgreSQL employee role was not assigned exactly once");
        }
        if (projectIds.length > 0) {
          const memberships = await client.query(
            `INSERT INTO project_memberships (
               project_id, user_id, assigned_by_user_id, assigned_by_actor_key,
               assigned_at, expires_at, status, version
             )
             SELECT project_id, $1, $3, $4, $5, NULL, 'active', 1
             FROM pg_catalog.unnest($2::uuid[]) AS desired(project_id)`,
            [
              intent.newUserId,
              projectIds,
              inviterUserId,
              invitation.invited_by_actor_key,
              times.issuedAt,
            ],
          );
          if (memberships.rowCount !== projectIds.length) {
            throw new Error("PostgreSQL employee project memberships were not inserted exactly once each");
          }
        }

        const acceptedInvitation = await client.query(
          `UPDATE invitations
           SET token_hash = NULL,
               status = 'accepted',
               accepted_user_id = $2,
               accepted_at = $3,
               updated_at = GREATEST(updated_at, $3),
               version = version + 1
           WHERE id = $1 AND status = 'pending' AND token_hash = $4
           RETURNING id`,
          [
            invitationId,
            intent.newUserId,
            times.issuedAt,
            intent.invitationTokenHash,
          ],
        );
        if (acceptedInvitation.rowCount !== 1 || acceptedInvitation.rows.length !== 1) {
          throw new Error("PostgreSQL employee invitation was not consumed exactly once");
        }
        const sessionVersion = await insertSession(intent.newUserId, authorizationVersion);
        await insertPostgresSecurityAuditEvent(client, authenticatedUserAudit(
          intent.invitationAudit,
          intent.newUserId,
          times.email,
          {
            action: "identity.invitation_redeemed",
            targetType: "invitation",
            targetId: invitationId,
            result: "succeeded",
            reasonCode: null,
          },
        ));
        await insertPostgresSecurityAuditEvent(client, authenticatedUserAudit(
          intent.loginAudit,
          intent.newUserId,
          times.email,
          {
            action: "identity.login_succeeded",
            targetType: "session",
            targetId: intent.session.id,
            result: "succeeded",
            reasonCode: null,
          },
        ));
        return {
          outcome: "accepted",
          userId: intent.newUserId,
          email: times.email,
          authorizationVersion,
          sessionVersion,
          invitationRedeemed: true,
        };
      }, conflictAudit);
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
  };
}
