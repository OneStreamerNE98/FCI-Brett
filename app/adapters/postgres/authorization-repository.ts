import type {
  AuthorizationRecordScope,
  AuthorizationRepository,
  AuthorizationSessionSnapshot,
  AuthorizedClientSummary,
  AuthorizedDashboardSummary,
  AuthorizedProjectSummary,
} from "../../ports/authorization";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  assertPersistenceHash,
  assertPersistenceUuid,
  persistenceDate,
  persistenceVersion,
} from "./persistence-repository-values";
import {
  parsePostgresNumericSafeInteger,
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
  parsePostgresUuid,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresAuthorizationRepositoryOptions = Readonly<{
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}>;

type SessionRow = Record<string, unknown> & {
  session_id: unknown;
  session_version: unknown;
  session_authorization_version: unknown;
  issued_at: unknown;
  last_seen_at: unknown;
  idle_expires_at: unknown;
  absolute_expires_at: unknown;
  revoked_at: unknown;
  user_id: unknown;
  email: unknown;
  user_status: unknown;
  user_authorization_version: unknown;
  sessions_valid_after: unknown;
};

type RoleCapabilityRow = Record<string, unknown> & {
  role_key: unknown;
  capability_key: unknown;
};

type ProjectRow = Record<string, unknown> & {
  id: unknown;
  project_number: unknown;
  client_id: unknown;
  client_name: unknown;
  name: unknown;
  status: unknown;
  site: unknown;
  project_manager: unknown;
  estimated_value?: unknown;
  updated_at: unknown;
  version: unknown;
};

type ClientRow = Record<string, unknown> & {
  id: unknown;
  client_code: unknown;
  name: unknown;
  status: unknown;
  contact_name: unknown;
  contact_email: unknown;
  contact_phone: unknown;
};

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const MAX_READ_LIMIT = 200;
const MAX_SEARCH_LENGTH = 200;

function requiredString(value: unknown, label: string, maximumLength = 512) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim() ||
    value.length > maximumLength ||
    value.includes("\u0000")
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maximumLength = 512) {
  return value === null ? null : requiredString(value, label, maximumLength);
}

function readLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_READ_LIMIT) {
    throw new TypeError(`Authorization read limit must be an integer from 1 to ${MAX_READ_LIMIT}`);
  }
  return value;
}

function searchText(value: string) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > MAX_SEARCH_LENGTH ||
    value.includes("\u0000")
  ) {
    throw new TypeError(
      `Authorization search query must be trimmed nonempty text no longer than ${MAX_SEARCH_LENGTH} characters`,
    );
  }
  return value.normalize("NFKC").toLowerCase();
}

function scopeValues(scope: AuthorizationRecordScope, now: number) {
  assertPersistenceUuid(scope.sessionId, "Authorization scope session ID");
  const sessionVersion = persistenceVersion(
    scope.sessionVersion,
    "Authorization scope session version",
  );
  assertPersistenceUuid(scope.userId, "Authorization scope user ID");
  const authorizationVersion = persistenceVersion(
    scope.authorizationVersion,
    "Authorization scope version",
  );
  if (scope.kind !== "company" && scope.kind !== "assigned_projects") {
    throw new TypeError("Authorization record scope is invalid");
  }
  if (scope.kind === "assigned_projects" && scope.includeFinancial) {
    throw new TypeError("Assigned-project scope cannot include financial data");
  }
  return {
    userId: scope.userId,
    sessionId: scope.sessionId,
    sessionVersion,
    authorizationVersion,
    companyWide: scope.kind === "company",
    now: persistenceDate(now, "Authorization query time"),
  };
}

function authorizationCapabilityKey(value: string) {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !CAPABILITY_KEY_PATTERN.test(value)
  ) {
    throw new TypeError("Authorization capability key is invalid");
  }
  return value;
}

function sessionFromRows(
  session: SessionRow,
  roleCapabilityRows: readonly RoleCapabilityRow[],
): AuthorizationSessionSnapshot {
  const userStatus = session.user_status;
  if (userStatus !== "active" && userStatus !== "disabled") {
    throw new Error("PostgreSQL authorization user status is invalid");
  }
  const roleCapabilities = new Map<string, Set<string>>();
  for (const row of roleCapabilityRows) {
    const roleKey = requiredString(row.role_key, "PostgreSQL authorization role key", 128);
    if (!ROLE_KEY_PATTERN.test(roleKey)) {
      throw new Error("PostgreSQL authorization role key is invalid");
    }
    const capabilityKeys = roleCapabilities.get(roleKey) ?? new Set<string>();
    roleCapabilities.set(roleKey, capabilityKeys);
    if (row.capability_key !== null) {
      const capabilityKey = requiredString(
        row.capability_key,
        "PostgreSQL authorization capability key",
        160,
      );
      if (!CAPABILITY_KEY_PATTERN.test(capabilityKey)) {
        throw new Error("PostgreSQL authorization capability key is invalid");
      }
      capabilityKeys.add(capabilityKey);
    }
  }
  return Object.freeze({
    sessionId: parsePostgresUuid(session.session_id, "PostgreSQL authorization session ID"),
    sessionVersion: parsePostgresPositiveBigint(
      session.session_version,
      "PostgreSQL authorization session version",
    ),
    userId: parsePostgresUuid(session.user_id, "PostgreSQL authorization user ID"),
    email: requiredString(session.email, "PostgreSQL authorization email", 320),
    userStatus,
    userAuthorizationVersion: parsePostgresPositiveBigint(
      session.user_authorization_version,
      "PostgreSQL user authorization version",
    ),
    sessionAuthorizationVersion: parsePostgresPositiveBigint(
      session.session_authorization_version,
      "PostgreSQL session authorization version",
    ),
    sessionsValidAfter: parsePostgresTimestamp(
      session.sessions_valid_after,
      "PostgreSQL sessions_valid_after",
    ),
    issuedAt: parsePostgresTimestamp(session.issued_at, "PostgreSQL session issued_at"),
    lastSeenAt: parsePostgresTimestamp(session.last_seen_at, "PostgreSQL session last_seen_at"),
    idleExpiresAt: parsePostgresTimestamp(
      session.idle_expires_at,
      "PostgreSQL session idle_expires_at",
    ),
    absoluteExpiresAt: parsePostgresTimestamp(
      session.absolute_expires_at,
      "PostgreSQL session absolute_expires_at",
    ),
    revokedAt: session.revoked_at === null
      ? null
      : parsePostgresTimestamp(session.revoked_at, "PostgreSQL session revoked_at"),
    roleGrants: Object.freeze(
      [...roleCapabilities.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([roleKey, capabilityKeys]) => Object.freeze({
          roleKey,
          capabilityKeys: Object.freeze([...capabilityKeys].sort()),
        })),
    ),
  });
}

function projectFromRow(row: ProjectRow, includeFinancial: boolean): AuthorizedProjectSummary {
  const base = {
    id: parsePostgresUuid(row.id, "PostgreSQL authorized project ID"),
    projectNumber: requiredString(row.project_number, "PostgreSQL project number", 64),
    clientId: parsePostgresUuid(row.client_id, "PostgreSQL authorized client ID"),
    clientName: requiredString(row.client_name, "PostgreSQL authorized client name", 255),
    name: requiredString(row.name, "PostgreSQL authorized project name", 255),
    status: requiredString(row.status, "PostgreSQL authorized project status", 64),
    site: nullableString(row.site, "PostgreSQL authorized project site", 512),
    projectManagerId: requiredString(
      row.project_manager,
      "PostgreSQL authorized project manager",
      320,
    ),
    updatedAt: parsePostgresTimestamp(row.updated_at, "PostgreSQL project updated_at"),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL project version"),
  };
  if (!includeFinancial) return Object.freeze({ ...base, financialVisible: false as const });
  return Object.freeze({
    ...base,
    financialVisible: true as const,
    estimatedValue: parsePostgresNumericSafeInteger(
      row.estimated_value,
      "PostgreSQL authorized project estimated value",
      { nullable: true },
    ),
  });
}

function clientFromRow(row: ClientRow): AuthorizedClientSummary {
  const contact = row.contact_name === null
    ? null
    : Object.freeze({
        name: requiredString(row.contact_name, "PostgreSQL authorized contact name", 255),
        email: nullableString(row.contact_email, "PostgreSQL authorized contact email", 320),
        phone: nullableString(row.contact_phone, "PostgreSQL authorized contact phone", 64),
      });
  if (row.contact_name === null && (row.contact_email !== null || row.contact_phone !== null)) {
    throw new Error("PostgreSQL authorized contact projection is inconsistent");
  }
  return Object.freeze({
    id: parsePostgresUuid(row.id, "PostgreSQL authorized client ID"),
    clientCode: requiredString(row.client_code, "PostgreSQL authorized client code", 64),
    name: requiredString(row.name, "PostgreSQL authorized client name", 255),
    status: requiredString(row.status, "PostgreSQL authorized client status", 64),
    primaryContact: contact,
  });
}

const ACTIVE_COMPANY_RECORD_ROLE = `EXISTS (
      SELECT 1
      FROM user_roles AS scope_user_role
      JOIN roles AS scope_role
        ON scope_role.id = scope_user_role.role_id
       AND scope_role.status = 'active'
      JOIN role_capabilities AS scope_role_capability
        ON scope_role_capability.role_id = scope_role.id
      JOIN capabilities AS scope_capability
        ON scope_capability.id = scope_role_capability.capability_id
       AND scope_capability.status = 'active'
      WHERE scope_user_role.user_id = $1
        AND (scope_user_role.expires_at IS NULL OR scope_user_role.expires_at > $4)
        AND scope_role.role_key IN ('administrator', 'office_operations')
        AND scope_capability.capability_key = 'records.read'
    )`;

const ACTIVE_PROJECT_MANAGER_RECORD_ROLE = `EXISTS (
      SELECT 1
      FROM user_roles AS scope_user_role
      JOIN roles AS scope_role
        ON scope_role.id = scope_user_role.role_id
       AND scope_role.status = 'active'
      JOIN role_capabilities AS scope_role_capability
        ON scope_role_capability.role_id = scope_role.id
      JOIN capabilities AS scope_capability
        ON scope_capability.id = scope_role_capability.capability_id
       AND scope_capability.status = 'active'
      WHERE scope_user_role.user_id = $1
        AND (scope_user_role.expires_at IS NULL OR scope_user_role.expires_at > $4)
        AND scope_role.role_key = 'project_manager'
        AND scope_capability.capability_key = 'records.read'
    )`;

const ACTIVE_ADMIN_FINANCIAL_ROLE = `EXISTS (
      SELECT 1
      FROM user_roles AS financial_user_role
      JOIN roles AS financial_role
        ON financial_role.id = financial_user_role.role_id
       AND financial_role.status = 'active'
      JOIN role_capabilities AS financial_role_capability
        ON financial_role_capability.role_id = financial_role.id
      JOIN capabilities AS financial_capability
        ON financial_capability.id = financial_role_capability.capability_id
       AND financial_capability.status = 'active'
      WHERE financial_user_role.user_id = $1
        AND (financial_user_role.expires_at IS NULL OR financial_user_role.expires_at > $4)
        AND financial_role.role_key = 'administrator'
        AND financial_capability.capability_key = 'financials.read'
    )`;

const ACTIVE_SESSION_USER = `EXISTS (
      SELECT 1
      FROM sessions AS authorization_session
      JOIN users AS authorization_user
        ON authorization_user.id = authorization_session.user_id
      WHERE authorization_session.id = $5
        AND authorization_session.version = $6::bigint
        AND authorization_session.user_id = $1
        AND authorization_session.authorization_version = $2::bigint
        AND authorization_session.token_hash IS NOT NULL
        AND authorization_session.revoked_at IS NULL
        AND authorization_session.issued_at >= authorization_user.sessions_valid_after
        AND authorization_session.idle_expires_at > $4
        AND authorization_session.absolute_expires_at > $4
        AND authorization_user.status = 'active'
        AND authorization_user.authorization_version = $2::bigint
    )`;

function activeScopePredicate(projectAlias: string, includeFinancial: boolean) {
  return `${ACTIVE_SESSION_USER}
    AND (
      ($3::boolean AND ${ACTIVE_COMPANY_RECORD_ROLE})
      OR (
        NOT $3::boolean
        AND ${ACTIVE_PROJECT_MANAGER_RECORD_ROLE}
        AND EXISTS (
          SELECT 1
          FROM project_memberships AS membership
          WHERE membership.project_id = ${projectAlias}.id
            AND membership.user_id = $1
            AND (membership.expires_at IS NULL OR membership.expires_at > $4)
        )
      )
    )
    ${includeFinancial ? `AND ${ACTIVE_ADMIN_FINANCIAL_ROLE}` : ""}`;
}

function activeClientScopePredicate() {
  return `${ACTIVE_SESSION_USER}
    AND (
      ($3::boolean AND ${ACTIVE_COMPANY_RECORD_ROLE})
      OR (
        NOT $3::boolean
        AND ${ACTIVE_PROJECT_MANAGER_RECORD_ROLE}
        AND EXISTS (
          SELECT 1
          FROM projects AS project
          JOIN project_memberships AS membership
            ON membership.project_id = project.id
           AND membership.user_id = $1
           AND (membership.expires_at IS NULL OR membership.expires_at > $4)
          WHERE project.client_id = client.id
        )
      )
    )`;
}

function projectProjection(includeFinancial: boolean) {
  return `project.id::text AS id, project.project_number,
          project.client_id::text AS client_id, client.name AS client_name,
          project.name, project.status, project.site, project.project_manager,
          ${includeFinancial ? "project.estimated_value::text AS estimated_value," : ""}
          project.updated_at, project.version::text AS version`;
}

export function createPostgresAuthorizationRepository(
  pool: PostgresPool,
  options: PostgresAuthorizationRepositoryOptions = {},
): AuthorizationRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
    readOnly: true,
    isolationLevel: "repeatable_read" as const,
  };

  async function readProjects(
    scope: AuthorizationRecordScope,
    now: number,
    limit: number,
    query: string | null,
  ) {
    const values = scopeValues(scope, now);
    const boundedLimit = readLimit(limit);
    const normalizedQuery = query === null ? null : searchText(query);
    return withPostgresTransaction(pool, transactionOptions, async (client) => {
      const found = await client.query<ProjectRow>(
        `SELECT ${projectProjection(scope.includeFinancial)}
         FROM projects AS project
         JOIN clients AS client ON client.id = project.client_id
         WHERE ${activeScopePredicate("project", scope.includeFinancial)}
           ${normalizedQuery === null ? "" : `AND (
             pg_catalog.strpos(pg_catalog.lower(project.project_number), $7) > 0
             OR pg_catalog.strpos(pg_catalog.lower(project.name), $7) > 0
             OR pg_catalog.strpos(pg_catalog.lower(client.name), $7) > 0
           )`}
         ORDER BY project.updated_at DESC, project.id
         LIMIT $${normalizedQuery === null ? 7 : 8}`,
        normalizedQuery === null
          ? [values.userId, values.authorizationVersion, values.companyWide, values.now,
              values.sessionId, values.sessionVersion, boundedLimit]
          : [values.userId, values.authorizationVersion, values.companyWide, values.now,
              values.sessionId, values.sessionVersion, normalizedQuery, boundedLimit],
      );
      return Object.freeze(found.rows.map((row) => projectFromRow(row, scope.includeFinancial)));
    });
  }

  const repository: AuthorizationRepository = {
    async findSessionByTokenHash(tokenHash, now) {
      assertPersistenceHash(tokenHash, "Authorization session token hash");
      const checkedAt = persistenceDate(now, "Authorization session resolution time");
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const session = await client.query<SessionRow>(
          `SELECT session.id::text AS session_id,
                  session.version::text AS session_version,
                  session.authorization_version::text AS session_authorization_version,
                  session.issued_at, session.last_seen_at,
                  session.idle_expires_at, session.absolute_expires_at,
                  session.revoked_at, authorization_user.id::text AS user_id,
                  authorization_user.email,
                  authorization_user.status AS user_status,
                  authorization_user.authorization_version::text AS user_authorization_version,
                  authorization_user.sessions_valid_after
           FROM sessions AS session
           JOIN users AS authorization_user ON authorization_user.id = session.user_id
           WHERE session.token_hash = $1`,
          [tokenHash],
        );
        if (session.rowCount === 0 && session.rows.length === 0) return null;
        if (session.rowCount !== 1 || session.rows.length !== 1) {
          throw new Error("PostgreSQL authorization session was not unique");
        }
        const row = session.rows[0];
        const userId = parsePostgresUuid(row?.user_id, "PostgreSQL authorization user ID");
        const roleCapabilities = await client.query<RoleCapabilityRow>(
          `SELECT role.role_key, capability.capability_key
           FROM user_roles AS user_role
           JOIN roles AS role
             ON role.id = user_role.role_id AND role.status = 'active'
           LEFT JOIN role_capabilities AS role_capability
             ON role_capability.role_id = role.id
           LEFT JOIN capabilities AS capability
             ON capability.id = role_capability.capability_id
            AND capability.status = 'active'
           WHERE user_role.user_id = $1
             AND (user_role.expires_at IS NULL OR user_role.expires_at > $2)
           ORDER BY role.role_key, capability.capability_key NULLS FIRST`,
          [userId, checkedAt],
        );
        return sessionFromRows(row, roleCapabilities.rows);
      });
    },

    async projectExistsForScope(scope, projectId, now) {
      assertPersistenceUuid(projectId, "Authorization project ID");
      const values = scopeValues(scope, now);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const found = await client.query<{ allowed: unknown }>(
          `SELECT EXISTS (
             SELECT 1
             FROM projects AS project
             WHERE project.id = $7
               AND ${activeScopePredicate("project", scope.includeFinancial)}
           ) AS allowed`,
          [values.userId, values.authorizationVersion, values.companyWide, values.now,
            values.sessionId, values.sessionVersion, projectId],
        );
        if (found.rowCount !== 1 || found.rows.length !== 1 ||
            typeof found.rows[0]?.allowed !== "boolean") {
          throw new Error("PostgreSQL project authorization result is invalid");
        }
        return found.rows[0].allowed;
      });
    },

    async administratorCapabilityIsCurrent(scope, capabilityKey, now) {
      const values = scopeValues(scope, now);
      const capability = authorizationCapabilityKey(capabilityKey);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const found = await client.query<{ allowed: unknown }>(
          `SELECT EXISTS (
             SELECT 1
             FROM user_roles AS current_user_role
             JOIN roles AS current_role
               ON current_role.id = current_user_role.role_id
              AND current_role.status = 'active'
             JOIN role_capabilities AS current_record_role_capability
               ON current_record_role_capability.role_id = current_role.id
             JOIN capabilities AS current_record_capability
               ON current_record_capability.id = current_record_role_capability.capability_id
              AND current_record_capability.status = 'active'
              AND current_record_capability.capability_key = 'records.read'
             JOIN role_capabilities AS current_role_capability
               ON current_role_capability.role_id = current_role.id
             JOIN capabilities AS current_capability
               ON current_capability.id = current_role_capability.capability_id
              AND current_capability.status = 'active'
             WHERE ${ACTIVE_SESSION_USER}
               AND current_user_role.user_id = $1
               AND $3::boolean
               AND (current_user_role.expires_at IS NULL OR current_user_role.expires_at > $4)
               AND current_role.role_key = 'administrator'
               AND current_capability.capability_key = $7
           ) AS allowed`,
          [values.userId, values.authorizationVersion, values.companyWide, values.now,
            values.sessionId, values.sessionVersion, capability],
        );
        if (found.rowCount !== 1 || found.rows.length !== 1 ||
            typeof found.rows[0]?.allowed !== "boolean") {
          throw new Error("PostgreSQL capability authorization result is invalid");
        }
        return found.rows[0].allowed;
      });
    },

    listProjectsForScope(scope, now, limit) {
      return readProjects(scope, now, limit, null);
    },

    async listClientsForScope(scope, now, limit) {
      const values = scopeValues(scope, now);
      const boundedLimit = readLimit(limit);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const found = await client.query<ClientRow>(
          `SELECT client.id::text AS id, client.client_code,
                  client.name, client.status,
                  primary_contact.name AS contact_name,
                  primary_contact.email AS contact_email,
                  primary_contact.phone AS contact_phone
           FROM clients AS client
           LEFT JOIN LATERAL (
             SELECT contact.name, contact.email, contact.phone
             FROM contacts AS contact
             WHERE contact.client_id = client.id
             ORDER BY contact.is_primary DESC, contact.created_at, contact.id
             LIMIT 1
           ) AS primary_contact ON true
           WHERE ${activeClientScopePredicate()}
           ORDER BY client.name, client.id
           LIMIT $7`,
          [values.userId, values.authorizationVersion, values.companyWide, values.now,
            values.sessionId, values.sessionVersion, boundedLimit],
        );
        return Object.freeze(found.rows.map(clientFromRow));
      });
    },

    searchProjectsForScope(scope, query, now, limit) {
      return readProjects(scope, now, limit, query);
    },

    async getDashboardForScope(scope, now) {
      const values = scopeValues(scope, now);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const financialProjection = scope.includeFinancial
          ? ", pg_catalog.coalesce(pg_catalog.sum(project.estimated_value), 0)::text AS estimated_value_total"
          : "";
        const found = await client.query<Record<string, unknown>>(
          `SELECT pg_catalog.count(*)::text AS project_count,
                  pg_catalog.count(*) FILTER (
                    WHERE project.status NOT IN ('completed', 'cancelled', 'archived')
                  )::text AS active_project_count,
                  pg_catalog.count(*) FILTER (
                    WHERE project.status = 'completed'
                  )::text AS completed_project_count
                  ${financialProjection}
           FROM projects AS project
           WHERE ${activeScopePredicate("project", scope.includeFinancial)}`,
          [values.userId, values.authorizationVersion, values.companyWide, values.now,
            values.sessionId, values.sessionVersion],
        );
        if (found.rowCount !== 1 || found.rows.length !== 1) {
          throw new Error("PostgreSQL authorization dashboard result is invalid");
        }
        const row = found.rows[0];
        const summary: AuthorizedDashboardSummary = {
          projectCount: parsePostgresNumericSafeInteger(
            row?.project_count,
            "PostgreSQL authorized project count",
          ),
          activeProjectCount: parsePostgresNumericSafeInteger(
            row?.active_project_count,
            "PostgreSQL authorized active-project count",
          ),
          completedProjectCount: parsePostgresNumericSafeInteger(
            row?.completed_project_count,
            "PostgreSQL authorized completed-project count",
          ),
          financialVisible: scope.includeFinancial,
          ...(scope.includeFinancial
            ? {
                estimatedValueTotal: parsePostgresNumericSafeInteger(
                  row?.estimated_value_total,
                  "PostgreSQL authorized estimated-value total",
                ),
              }
            : {}),
        };
        return Object.freeze(summary);
      });
    },
  };
  return Object.freeze(repository);
}
