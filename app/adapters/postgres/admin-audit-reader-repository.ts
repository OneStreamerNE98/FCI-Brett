import { AUTHORIZATION_CAPABILITIES } from "../../application/authorization-capabilities";
import type {
  AdminAuditActivity,
  AdminAuditCategory,
  AdminAuditQuery,
  AdminAuditReader,
  AdminAuditResult,
} from "../../ports/admin-audit-reader";
import type { AuthorizationRecordScope } from "../../ports/authorization";
import {
  assertPersistenceDottedKey,
  assertPersistenceKey,
  assertPersistenceText,
  assertPersistenceUuid,
  persistenceDate,
  persistenceVersion,
} from "./persistence-repository-values";
import {
  withPostgresTransaction,
  type PostgresClient,
  type PostgresPool,
} from "./postgres-database";
import {
  parsePostgresTimestamp,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresAdminAuditReaderOptions = Readonly<{
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}>;

const MAX_AUDIT_PAGE_SIZE = 50;
const AUDIT_CURSOR_KEY = /^[0-9a-f]{64}$/;
const AUDIT_RESULTS = new Set<AdminAuditResult>(["succeeded", "failed", "denied"]);

type AuditActivityRow = Record<string, unknown> & {
  cursor_key: unknown;
  actor_label: unknown;
  action: unknown;
  target_label: unknown;
  result: unknown;
  reason_code: unknown;
  administrator_reason: unknown;
  occurred_at: unknown;
};

const CATEGORY_PREDICATES: Readonly<Record<AdminAuditCategory, string>> = Object.freeze({
  access: "activity.action LIKE 'authorization.%'",
  people: "activity.action LIKE 'identity.%'",
  workspace: `(
    activity.action LIKE 'integration.%'
    OR activity.action LIKE 'oauth.%'
    OR activity.action LIKE 'drive.%'
    OR activity.action LIKE 'gmail.%'
    OR activity.action LIKE 'calendar.%'
  )`,
  files: "activity.action LIKE 'file.%'",
  records: `(
    activity.action LIKE 'client.%'
    OR activity.action LIKE 'clients.%'
    OR activity.action LIKE 'project.%'
    OR activity.action LIKE 'projects.%'
  )`,
  other: `NOT (
    activity.action LIKE 'authorization.%'
    OR activity.action LIKE 'identity.%'
    OR activity.action LIKE 'integration.%'
    OR activity.action LIKE 'oauth.%'
    OR activity.action LIKE 'drive.%'
    OR activity.action LIKE 'gmail.%'
    OR activity.action LIKE 'calendar.%'
    OR activity.action LIKE 'file.%'
    OR activity.action LIKE 'client.%'
    OR activity.action LIKE 'clients.%'
    OR activity.action LIKE 'project.%'
    OR activity.action LIKE 'projects.%'
  )`,
});

const ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "authorization.access_allowed": "Access approved",
  "authorization.access_denied": "Access denied",
  "authorization.transport_denied": "Request blocked",
  "authorization.user_access_changed": "Access changed",
  "identity.invitation_created": "Invitation created",
  "identity.invitation_revoked": "Invitation revoked",
  "identity.session_created": "Session started",
  "identity.session_revoked": "Session ended",
  "identity.sessions_invalidated": "Sessions ended",
  "identity.user_disabled": "Access disabled",
  "identity.user_registered": "Person registered",
  "file.upload_reserved": "File upload reserved",
  "file.upload_finalized": "File upload recorded",
  "file.upload_failed": "File upload failed",
  "integration.metadata_registered": "Workspace connection updated",
  "integration.oauth_attempt_created": "Workspace connection started",
  "integration.oauth_attempt_consumed": "Workspace connection completed",
  "integration.oauth_attempt_rejected": "Workspace connection rejected",
  "integration.resource_registered": "Workspace resource registered",
  "outbox.event_dead_lettered": "Background work stopped",
});

const REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  absolute_expired: "Session reached its time limit",
  actor_authorization_changed: "Administrator access changed",
  administrator_request: "Administrator request",
  authorization_changed: "Access changed",
  csrf_invalid: "Request verification was invalid",
  csrf_mismatch: "Request verification did not match",
  csrf_missing: "Request verification was missing",
  email_unverified: "Email address was not verified",
  employee_account_not_allowed: "Employee account type was not allowed",
  idle_expired: "Session expired after inactivity",
  invalid_session: "Session was not valid",
  invitation_required: "An explicit invitation was required",
  link_expired: "Temporary access link expired",
  link_revoked: "Temporary access link was revoked",
  logout: "Signed out",
  missing_capability: "Required access was missing",
  origin_mismatch: "Request origin did not match",
  outside_domain: "Account was outside the company domain",
  outside_project_scope: "Project was outside assigned access",
  project_required: "An exact project was required",
  role_not_approved: "Role was not approved",
  session_invalidated: "Session was invalidated",
  session_revoked: "Session was revoked",
  unchanged_access: "No access change was selected",
  unknown_operation: "Operation was not recognized",
  user_disabled: "Person's access was disabled",
});

function auditCursorKey(value: unknown, label: string) {
  if (typeof value !== "string" || !AUDIT_CURSOR_KEY.test(value)) {
    throw new TypeError(`${label} must be a canonical SHA-256 value`);
  }
  return value;
}

function readScope(scope: AuthorizationRecordScope, now: number) {
  if (!scope || scope.kind !== "company" || scope.includeFinancial !== true) {
    throw new TypeError("Administrator audit activity requires company Administrator scope");
  }
  assertPersistenceUuid(scope.sessionId, "Audit reader session ID");
  assertPersistenceUuid(scope.userId, "Audit reader user ID");
  return Object.freeze({
    sessionId: scope.sessionId,
    sessionVersion: persistenceVersion(scope.sessionVersion, "Audit reader session version"),
    userId: scope.userId,
    authorizationVersion: persistenceVersion(
      scope.authorizationVersion,
      "Audit reader authorization version",
    ),
    checkedAt: persistenceDate(now, "Audit reader time"),
  });
}

function readQuery(query: AdminAuditQuery) {
  if (!query || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_AUDIT_PAGE_SIZE) {
    throw new TypeError(`Audit page limit must be an integer from 1 to ${MAX_AUDIT_PAGE_SIZE}`);
  }
  const from = query.from === null ? null : persistenceDate(query.from, "Audit from time");
  const before = query.before === null ? null : persistenceDate(query.before, "Audit before time");
  if (from && before && from.getTime() >= before.getTime()) {
    throw new TypeError("Audit from time must be earlier than before time");
  }
  if (query.result !== null && !AUDIT_RESULTS.has(query.result)) {
    throw new TypeError("Audit result filter is invalid");
  }
  const category = query.category;
  if (category !== null && !Object.hasOwn(CATEGORY_PREDICATES, category)) {
    throw new TypeError("Audit category filter is invalid");
  }
  let cursor: { occurredAt: Date; cursorKey: string } | null = null;
  if (query.cursor !== null) {
    cursor = {
      occurredAt: persistenceDate(query.cursor.occurredAt, "Audit cursor time"),
      cursorKey: auditCursorKey(query.cursor.cursorKey, "Audit cursor key"),
    };
  }
  return Object.freeze({ from, before, result: query.result, category, cursor, limit: query.limit });
}

async function activeAdministratorReader(
  client: PostgresClient,
  reader: ReturnType<typeof readScope>,
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
      AUTHORIZATION_CAPABILITIES.auditRead,
    ],
  );
  if (current.rowCount === 1 && current.rows.length === 1) return true;
  if (current.rowCount !== 0 || current.rows.length !== 0) {
    throw new Error("PostgreSQL audit reader fence returned an invalid row count");
  }
  return false;
}

function actionLabel(action: string) {
  const exact = ACTION_LABELS[action];
  if (exact) return exact;
  if (action.startsWith("authorization.")) return "Access activity";
  if (action.startsWith("identity.")) return "People activity";
  if (["integration.", "oauth.", "drive.", "gmail.", "calendar."].some(
    (prefix) => action.startsWith(prefix),
  )) return "Workspace activity";
  if (action.startsWith("file.")) return "File activity";
  if (["client.", "clients.", "project.", "projects."].some(
    (prefix) => action.startsWith(prefix),
  )) return "Record activity";
  return "Security activity";
}

function friendlyReason(reasonCode: unknown, administratorReason: unknown) {
  if (administratorReason !== null) {
    assertPersistenceText(administratorReason, "Audit Administrator reason", 500);
    return administratorReason.trim();
  }
  if (reasonCode === null) return null;
  assertPersistenceKey(reasonCode, "Audit reason code");
  return REASON_LABELS[reasonCode] ?? "Additional security context recorded";
}

function activityRow(row: AuditActivityRow): AdminAuditActivity {
  auditCursorKey(row.cursor_key, "Audit row cursor key");
  assertPersistenceText(row.actor_label, "Audit actor label", 320);
  assertPersistenceDottedKey(row.action, "Audit action");
  assertPersistenceText(row.target_label, "Audit target label", 512);
  if (!AUDIT_RESULTS.has(row.result as AdminAuditResult)) {
    throw new TypeError("Audit result is invalid");
  }
  return Object.freeze({
    actorLabel: row.actor_label.trim(),
    actionLabel: actionLabel(row.action),
    targetLabel: row.target_label.trim(),
    result: row.result as AdminAuditResult,
    reason: friendlyReason(row.reason_code, row.administrator_reason),
    occurredAt: parsePostgresTimestamp(row.occurred_at, "Audit occurrence time"),
  });
}

export function createPostgresAdminAuditReader(
  pool: PostgresPool,
  options: PostgresAdminAuditReaderOptions = {},
): AdminAuditReader {
  const schema = postgresSchemaName(options.schema);
  const transactionOptions = {
    schema,
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
    isolationLevel: "repeatable_read" as const,
  };

  return Object.freeze({
    async listActivity(scope: AuthorizationRecordScope, input: AdminAuditQuery, now: number) {
      const reader = readScope(scope, now);
      const query = readQuery(input);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        if (!await activeAdministratorReader(client, reader)) {
          return { outcome: "actor_authorization_changed" as const };
        }

        const categoryPredicate = query.category === null
          ? "TRUE"
          : CATEGORY_PREDICATES[query.category];
        const result = await client.query<AuditActivityRow>(
          `SELECT activity.cursor_key,
                  activity.actor_label,
                  activity.action,
                  activity.target_label,
                  activity.result,
                  activity.reason_code,
                  activity.administrator_reason,
                  activity.occurred_at
           FROM audit_activity_projection AS activity
           WHERE ($1::timestamptz IS NULL OR activity.occurred_at >= $1)
             AND ($2::timestamptz IS NULL OR activity.occurred_at < $2)
             AND ($3::text IS NULL OR activity.result = $3)
             AND (
               $4::timestamptz IS NULL
               OR activity.occurred_at < $4
               OR (activity.occurred_at = $4 AND activity.cursor_key > $5)
             )
             AND ${categoryPredicate}
           ORDER BY activity.occurred_at DESC, activity.cursor_key
           LIMIT $6`,
          [
            query.from,
            query.before,
            query.result,
            query.cursor?.occurredAt ?? null,
            query.cursor?.cursorKey ?? null,
            query.limit + 1,
          ],
        );
        if (result.rowCount !== result.rows.length || result.rows.length > query.limit + 1) {
          throw new Error("PostgreSQL audit projection exceeded its bounded page contract");
        }
        const pageRows = result.rows.slice(0, query.limit);
        const events = Object.freeze(pageRows.map(activityRow));
        const last = result.rows.length > query.limit ? pageRows.at(-1) : undefined;
        const next = last
          ? Object.freeze({
              occurredAt: parsePostgresTimestamp(last.occurred_at, "Audit next cursor time"),
              cursorKey: auditCursorKey(last.cursor_key, "Audit next cursor key"),
            })
          : null;
        return {
          outcome: "accepted" as const,
          page: Object.freeze({
            events,
            next,
            generatedAt: reader.checkedAt.getTime(),
          }),
        };
      });
    },
  });
}
