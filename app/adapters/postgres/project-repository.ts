import type {
  AcceptedProjectCreation,
  ProjectCreationIntent,
  ProjectRepository,
} from "../../ports/project-repository";
import {
  bindPostgresCreationRequest,
  calculatePostgresRequestFingerprint,
  claimPostgresCreation,
  completePostgresCreation,
  failPostgresCreation,
  POSTGRES_CREATION_OPERATIONS,
  type PostgresCreationRequestMetadata,
} from "./creation-idempotency";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  isPostgresUuid,
  parsePostgresJsonObject,
  parsePostgresNumericSafeInteger,
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
  parsePostgresUuid,
} from "./postgres-values";

type ProjectInsertRow = Record<string, unknown> & {
  id: unknown;
  project_number: unknown;
  project_manager: unknown;
  estimated_value: unknown;
  created_at: unknown;
  version: unknown;
};

const PROJECT_IDENTIFIER_CONSTRAINTS = [
  "projects_pkey",
  "projects_project_number_key",
  "activity_events_pkey",
  "outbox_events_pkey",
  "outbox_events_event_key_key",
  "idempotency_requests_pkey",
] as const;

export type PostgresProjectRepositoryOptions = {
  schema?: string;
  request?: PostgresCreationRequestMetadata;
};

function projectCreationFingerprintInput(intent: ProjectCreationIntent) {
  return {
    version: 1,
    clientId: isPostgresUuid(intent.project.clientId)
      ? parsePostgresUuid(intent.project.clientId)
      : intent.project.clientId,
    name: intent.project.name,
    status: intent.project.status,
    site: intent.project.site?.trim() || null,
    projectManagerId: intent.project.projectManagerId,
    estimatedValue: intent.project.estimatedValue,
  };
}

export function calculatePostgresProjectCreationFingerprint(intent: ProjectCreationIntent) {
  return calculatePostgresRequestFingerprint(projectCreationFingerprintInput(intent));
}

function assertUuid(value: string, label: string) {
  if (!isPostgresUuid(value)) throw new TypeError(`${label} must be a UUID`);
}

function postgresConstraint(error: unknown, code: string, constraints: readonly string[]) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === code && typeof record.constraint === "string" && constraints.includes(record.constraint);
}

function assertProjectIntent(intent: ProjectCreationIntent) {
  assertUuid(intent.project.id, "PostgreSQL project ID");
  assertUuid(intent.activity.id, "PostgreSQL project activity ID");
  if (intent.activity.recordId !== intent.project.id) {
    throw new TypeError("PostgreSQL project creation evidence must reference the new project");
  }
  if (intent.activity.actor !== intent.project.createdBy || !intent.project.createdBy.trim()) {
    throw new TypeError("PostgreSQL project creation actor must match its activity evidence");
  }
  if (!Number.isSafeInteger(intent.project.createdAt) || !Number.isSafeInteger(intent.project.updatedAt)) {
    throw new TypeError("PostgreSQL project timestamps must be safe epoch milliseconds");
  }
  if (!Number.isSafeInteger(intent.activity.createdAt)) {
    throw new TypeError("PostgreSQL project activity timestamp must be a safe epoch millisecond");
  }
  if (
    intent.project.estimatedValue !== null &&
    (!Number.isSafeInteger(intent.project.estimatedValue) || intent.project.estimatedValue < 0)
  ) {
    throw new TypeError("PostgreSQL project estimated value must be a non-negative safe whole number");
  }
}

function acceptedProject(value: unknown): AcceptedProjectCreation {
  const record = parsePostgresJsonObject(value, "PostgreSQL stored project response");
  if (
    typeof record.id !== "string" || !isPostgresUuid(record.id) ||
    typeof record.projectNumber !== "string" || !/^CF-[0-9]{4}-[A-Z0-9]{8}$/.test(record.projectNumber) ||
    typeof record.projectManagerId !== "string" || !record.projectManagerId.trim() ||
    typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt)
  ) {
    throw new Error("PostgreSQL stored project response is invalid");
  }
  return {
    id: record.id,
    projectNumber: record.projectNumber,
    projectManagerId: record.projectManagerId,
    createdAt: record.createdAt,
    estimatedValue: parsePostgresNumericSafeInteger(
      record.estimatedValue,
      "PostgreSQL stored project estimated value",
      { nullable: true },
    ),
    version: parsePostgresPositiveBigint(record.version, "PostgreSQL stored project version"),
  };
}

function projectFromRow(row: ProjectInsertRow): AcceptedProjectCreation {
  if (
    typeof row.id !== "string" || !isPostgresUuid(row.id) ||
    typeof row.project_number !== "string" ||
    typeof row.project_manager !== "string"
  ) {
    throw new Error("PostgreSQL project insert returned an invalid row");
  }
  return {
    id: row.id,
    projectNumber: row.project_number,
    projectManagerId: row.project_manager,
    createdAt: parsePostgresTimestamp(row.created_at, "PostgreSQL project created_at"),
    estimatedValue: parsePostgresNumericSafeInteger(
      row.estimated_value,
      "PostgreSQL project estimated value",
      { nullable: true },
    ),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL project version"),
  };
}

export function createPostgresProjectRepository(
  pool: PostgresPool,
  options: PostgresProjectRepositoryOptions = {},
): ProjectRepository {
  return {
    async create(intent) {
      assertProjectIntent(intent);
      if (!options.request) {
        throw new TypeError("PostgreSQL project creation requires an idempotency request context");
      }
      const request = bindPostgresCreationRequest(
        options.request,
        projectCreationFingerprintInput(intent),
      );

      return withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
        const claim = await claimPostgresCreation(
          client,
          POSTGRES_CREATION_OPERATIONS.project,
          intent.project.createdBy,
          intent.project.createdAt,
          request,
          acceptedProject,
        );
        if (claim.outcome === "idempotency-conflict" || claim.outcome === "in-progress") return claim;
        if (claim.outcome === "failed-replay") {
          if (claim.responseStatus === 404 && claim.responseBody.outcome === "client-not-found") {
            return { outcome: "client-not-found" as const };
          }
          throw new Error("Stored PostgreSQL project failure response is invalid");
        }
        if (claim.outcome === "replayed") {
          return { outcome: "accepted" as const, value: claim.value, replayed: true };
        }

        if (!isPostgresUuid(intent.project.clientId)) {
          await failPostgresCreation(
            client,
            POSTGRES_CREATION_OPERATIONS.project,
            intent.project.createdBy,
            intent.project.updatedAt,
            request,
            404,
            { outcome: "client-not-found" },
          );
          return { outcome: "client-not-found" as const };
        }
        const clientId = parsePostgresUuid(intent.project.clientId);

        const parentClient = await client.query<{ id: unknown }>(
          `SELECT id::text AS id
           FROM clients
           WHERE id = $1
           FOR KEY SHARE`,
          [clientId],
        );
        if (parentClient.rowCount !== 1 || parentClient.rows[0]?.id !== clientId) {
          if (parentClient.rowCount === 0 && parentClient.rows.length === 0) {
            await failPostgresCreation(
              client,
              POSTGRES_CREATION_OPERATIONS.project,
              intent.project.createdBy,
              intent.project.updatedAt,
              request,
              404,
              { outcome: "client-not-found" },
            );
            return { outcome: "client-not-found" as const };
          }
          throw new Error("PostgreSQL project parent lookup returned an invalid result");
        }

        const inserted = await client.query<ProjectInsertRow>(
          `INSERT INTO projects (
             id, project_number, client_id, name, status, site, project_manager,
             estimated_value, created_by, updated_by, created_at, updated_at, version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, 1)
           RETURNING id::text AS id, project_number, project_manager,
                     estimated_value::text AS estimated_value, created_at,
                     version::text AS version`,
          [
            intent.project.id,
            intent.project.projectNumber,
            clientId,
            intent.project.name,
            intent.project.status,
            intent.project.site?.trim() || null,
            intent.project.projectManagerId,
            intent.project.estimatedValue,
            intent.project.createdBy,
            new Date(intent.project.createdAt),
            new Date(intent.project.updatedAt),
          ],
        );
        const row = inserted.rows[0];
        if (!row || inserted.rowCount !== 1) {
          throw new Error("PostgreSQL project was not inserted exactly once");
        }
        const value = projectFromRow(row);

        await client.query(
          `INSERT INTO activity_events (
             id, project_id, action, actor_id, correlation_id, result, detail, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7)`,
          [
            intent.activity.id,
            intent.project.id,
            intent.activity.action,
            intent.activity.actor,
            request.correlationId,
            JSON.stringify({ message: intent.activity.detail }),
            new Date(intent.activity.createdAt),
          ],
        );
        await client.query(
          `INSERT INTO outbox_events (
             id, event_key, event_type, project_id, actor_id, correlation_id,
             payload, status, available_at, created_at, updated_at, version
           ) VALUES ($1, $2, 'project.created', $3, $4, $5, $6::jsonb,
             'pending', $7, $7, $7, 1)`,
          [
            request.outboxEventId,
            `project.created:${intent.project.id}`,
            intent.project.id,
            intent.project.createdBy,
            request.correlationId,
            JSON.stringify({ cause: "project-created", recordId: intent.project.id }),
            new Date(intent.project.createdAt),
          ],
        );
        await completePostgresCreation(
          client,
          POSTGRES_CREATION_OPERATIONS.project,
          intent.project.createdBy,
          intent.project.updatedAt,
          request,
          value,
        );
        return { outcome: "accepted" as const, value, replayed: false };
      }).catch((error) => {
        if (postgresConstraint(error, "23505", PROJECT_IDENTIFIER_CONSTRAINTS)) {
          return { outcome: "identifier-collision" as const };
        }
        throw error;
      });
    },

    async assignManager(intent) {
      if (!isPostgresUuid(intent.projectId)) return { outcome: "project-not-found" };
      assertUuid(intent.activity.id, "PostgreSQL project activity ID");
      if (intent.activity.recordId !== intent.projectId || intent.activity.actor.trim() === "") {
        throw new TypeError("PostgreSQL project-manager evidence must reference the updated project and actor");
      }

      return withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
        const updated = await client.query<Record<string, unknown> & { version: unknown }>(
          `UPDATE projects
           SET project_manager = $1, updated_by = $2, updated_at = $3,
               version = version + 1
           WHERE id = $4
           RETURNING version::text AS version`,
          [intent.projectManagerId, intent.activity.actor, new Date(intent.updatedAt), intent.projectId],
        );
        if (updated.rowCount !== 1) return { outcome: "project-not-found" as const };
        parsePostgresPositiveBigint(updated.rows[0]?.version, "PostgreSQL project-manager version");
        await client.query(
          `INSERT INTO activity_events (
             id, project_id, action, actor_id, correlation_id, result, detail, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7)`,
          [
            intent.activity.id,
            intent.projectId,
            intent.activity.action,
            intent.activity.actor,
            `project-manager:${intent.activity.id}`,
            JSON.stringify({ message: intent.activity.detail }),
            new Date(intent.activity.createdAt),
          ],
        );
        return { outcome: "updated" as const };
      });
    },
  };
}
