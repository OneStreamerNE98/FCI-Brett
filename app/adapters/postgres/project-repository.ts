import {
  FLOORING_CATEGORIES,
  PROJECT_STATUSES,
  type FlooringCategory,
  type ProjectStatus,
} from "../../domain/project-creation";
import {
  PROJECT_SEGMENTS,
  normalizeProjectSegment,
  resolveProjectSegment,
} from "../../domain/project-segment";
import { SAVED_ADDRESS_VERDICTS, type SavedAddressVerdict } from "../../domain/address-validation";
import type {
  AcceptedProjectCreation,
  ProjectCreationIntent,
  ProjectFollowUpResultIntent,
  ProjectInstallationDatesIntent,
  ProjectOperationsRepository,
  ProjectRepository,
  ProjectRow,
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
import {
  withPostgresTransaction,
  type PostgresClient,
  type PostgresPool,
} from "./postgres-database";
import {
  isPostgresUuid,
  parsePostgresJsonObject,
  parsePostgresNumericSafeInteger,
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
  parsePostgresUuid,
} from "./postgres-values";

const CALLBACK_NOTE_MAX_LENGTH = 1_000;

type ProjectInsertRow = Record<string, unknown> & {
  id: unknown;
  project_number: unknown;
  project_manager: unknown;
  estimated_value: unknown;
  created_at: unknown;
  version: unknown;
};

type ProjectDatabaseRow = ProjectInsertRow & {
  client_id: unknown;
  name: unknown;
  status: unknown;
  site: unknown;
  latitude: unknown;
  longitude: unknown;
  address_validation_verdict: unknown;
  flooring_category: unknown;
  square_feet: unknown;
  contract_value: unknown;
  segment: unknown;
  updated_at: unknown;
};

const PROJECT_SELECT = `SELECT id::text AS id, project_number,
       client_id::text AS client_id, name, status, site,
       latitude, longitude, address_validation_verdict, project_manager,
       estimated_value::text AS estimated_value, flooring_category,
       square_feet::text AS square_feet, contract_value::text AS contract_value,
       segment, updated_at, version::text AS version
FROM projects`;

const PROJECT_IDENTIFIER_CONSTRAINTS = [
  "projects_pkey",
  "projects_project_number_key",
  "activity_events_pkey",
  "outbox_events_pkey",
  "outbox_events_event_key_key",
  "idempotency_requests_pkey",
] as const;
const PROJECT_CLIENT_REFERENCE_CONSTRAINTS = ["projects_client_id_fkey"] as const;

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
    latitude: intent.project.latitude ?? null,
    longitude: intent.project.longitude ?? null,
    addressValidationVerdict: intent.project.addressValidationVerdict ?? null,
    projectManagerId: intent.project.projectManagerId,
    estimatedValue: intent.project.estimatedValue,
    flooringCategory: intent.project.flooringCategory,
    squareFeet: intent.project.squareFeet,
    contractValue: intent.project.contractValue,
    segment: intent.project.segment,
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
  if (
    intent.project.flooringCategory !== null &&
    !FLOORING_CATEGORIES.includes(
      intent.project.flooringCategory as (typeof FLOORING_CATEGORIES)[number],
    )
  ) {
    throw new TypeError("PostgreSQL project flooring category must be supported");
  }
  if (
    intent.project.squareFeet !== null &&
    (!Number.isSafeInteger(intent.project.squareFeet) || intent.project.squareFeet <= 0)
  ) {
    throw new TypeError("PostgreSQL project square feet must be a positive safe whole number");
  }
  if (
    intent.project.contractValue !== null &&
    (!Number.isSafeInteger(intent.project.contractValue) || intent.project.contractValue < 0)
  ) {
    throw new TypeError("PostgreSQL project contract value must be a non-negative safe whole number");
  }
}

function assertSafeEpochMilliseconds(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
    throw new TypeError(`${label} must be a valid safe epoch millisecond`);
  }
}

function assertProjectOperationActivity(
  intent: ProjectInstallationDatesIntent | ProjectFollowUpResultIntent,
  label: string,
) {
  assertUuid(intent.activity.id, `PostgreSQL ${label} activity ID`);
  if (intent.activity.recordId !== intent.projectId || intent.activity.actor.trim() === "") {
    throw new TypeError(
      `PostgreSQL ${label} evidence must reference the updated project and actor`,
    );
  }
  assertSafeEpochMilliseconds(intent.updatedAt, `PostgreSQL ${label} updated timestamp`);
  assertSafeEpochMilliseconds(
    intent.activity.createdAt,
    `PostgreSQL ${label} activity timestamp`,
  );
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

function nullableText(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function projectRowFromPostgres(row: ProjectDatabaseRow): ProjectRow {
  if (
    !isPostgresUuid(row.id)
    || typeof row.project_number !== "string"
    || !isPostgresUuid(row.client_id)
    || typeof row.name !== "string"
    || typeof row.status !== "string"
    || !PROJECT_STATUSES.includes(row.status as ProjectStatus)
  ) {
    throw new Error("PostgreSQL project row is invalid");
  }
  const flooringCategory = nullableText(
    row.flooring_category,
    "PostgreSQL project flooring category",
  );
  if (
    flooringCategory !== null
    && !FLOORING_CATEGORIES.includes(flooringCategory as FlooringCategory)
  ) {
    throw new Error("PostgreSQL project flooring category is unsupported");
  }
  const segmentText = nullableText(row.segment, "PostgreSQL project segment");
  const segment = normalizeProjectSegment(segmentText);
  if (segmentText !== null && segment === null) {
    throw new Error("PostgreSQL project segment is unsupported");
  }
  const addressVerdict = row.address_validation_verdict === undefined
    ? null
    : nullableText(
        row.address_validation_verdict,
        "PostgreSQL project address verdict",
      );
  if (
    addressVerdict !== null
    && !SAVED_ADDRESS_VERDICTS.includes(addressVerdict as SavedAddressVerdict)
  ) {
    throw new Error("PostgreSQL project address verdict is unsupported");
  }
  return {
    id: row.id,
    projectNumber: row.project_number,
    clientId: row.client_id,
    name: row.name,
    status: row.status as ProjectStatus,
    site: nullableText(row.site, "PostgreSQL project site"),
    latitude: row.latitude === undefined ? null : row.latitude as number | null,
    longitude: row.longitude === undefined ? null : row.longitude as number | null,
    addressValidationVerdict: addressVerdict as SavedAddressVerdict | null,
    projectManagerId: nullableText(row.project_manager, "PostgreSQL project manager"),
    estimatedValue: parsePostgresNumericSafeInteger(
      row.estimated_value,
      "PostgreSQL project estimated value",
      { nullable: true },
    ),
    flooringCategory: flooringCategory as FlooringCategory | null,
    squareFeet: parsePostgresNumericSafeInteger(
      row.square_feet,
      "PostgreSQL project square feet",
      { nullable: true },
    ),
    contractValue: parsePostgresNumericSafeInteger(
      row.contract_value,
      "PostgreSQL project contract value",
      { nullable: true },
    ),
    segment,
    updatedAt: parsePostgresTimestamp(row.updated_at, "PostgreSQL project updated_at"),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL project version"),
  };
}

async function currentProjectVersion(client: PostgresClient, projectId: string) {
  const current = await client.query<{ version: unknown }>(
    "SELECT version::text AS version FROM projects WHERE id = $1",
    [projectId],
  );
  if (current.rowCount === 0) return null;
  if (current.rowCount !== 1 || !current.rows[0]) {
    throw new Error("PostgreSQL project version lookup returned an invalid result");
  }
  return parsePostgresPositiveBigint(
    current.rows[0].version,
    "PostgreSQL current project version",
  );
}

async function projectUpdateFailure(client: PostgresClient, projectId: string) {
  const currentVersion = await currentProjectVersion(client, projectId);
  return currentVersion
    ? { outcome: "conflict" as const, currentVersion }
    : { outcome: "project-not-found" as const };
}

async function projectOperationExpectedVersion(
  client: PostgresClient,
  projectId: string,
  supplied: string | undefined,
) {
  if (supplied !== undefined) {
    return parsePostgresPositiveBigint(supplied, "Expected PostgreSQL project version");
  }
  return currentProjectVersion(client, projectId);
}

async function insertProjectUpdateActivity(
  client: PostgresClient,
  activity: {
    id: string;
    recordId: string;
    action: string;
    actor: string;
    detail: string;
    createdAt: number;
  },
  prefix: string,
  resultingVersion: string,
) {
  const audit = await client.query(
    `INSERT INTO activity_events (
       id, project_id, action, actor_id, correlation_id, result, detail, occurred_at
     )
     SELECT $1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7
     WHERE EXISTS (
       SELECT 1 FROM projects WHERE id = $2 AND version = $8::bigint
     )`,
    [
      activity.id,
      activity.recordId,
      activity.action,
      activity.actor,
      `${prefix}:${activity.id}`,
      JSON.stringify({ message: activity.detail }),
      new Date(activity.createdAt),
      resultingVersion,
    ],
  );
  if (audit.rowCount !== 1) {
    throw new Error("PostgreSQL project update evidence was not inserted exactly once");
  }
}

export function createPostgresProjectRepository(
  pool: PostgresPool,
  options: PostgresProjectRepositoryOptions = {},
): ProjectRepository & ProjectOperationsRepository {
  return {
    async findById(projectId) {
      if (!isPostgresUuid(projectId)) return null;
      return withPostgresTransaction(
        pool,
        { schema: options.schema, readOnly: true },
        async (client) => {
          const result = await client.query<ProjectDatabaseRow>(
            `${PROJECT_SELECT}\nWHERE id = $1`,
            [projectId],
          );
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || !result.rows[0]) {
            throw new Error("PostgreSQL project lookup returned an invalid result");
          }
          return projectRowFromPostgres(result.rows[0]);
        },
      );
    },

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

        const parentClient = await client.query<{ id: unknown; industry: unknown }>(
          `SELECT id::text AS id, industry
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
        // The D1 INSERT CASE treats only byte-exact catalog values as explicit.
        // Keep direct-adapter inputs aligned even though normal HTTP creation
        // already canonicalizes valid user input before reaching this port.
        const explicitSegment = PROJECT_SEGMENTS.find(
          (candidate) => candidate === intent.project.segment,
        ) ?? null;
        const segment = resolveProjectSegment(
          explicitSegment,
          parentClient.rows[0].industry,
        );

        const inserted = await client.query<ProjectInsertRow>(
          `INSERT INTO projects (
             id, project_number, client_id, name, status, site,
             latitude, longitude, address_validation_verdict, project_manager,
             estimated_value, flooring_category, square_feet, contract_value, segment,
             created_by, updated_by, created_at, updated_at, version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $16, $17, $18, 1)
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
            intent.project.latitude ?? null,
            intent.project.longitude ?? null,
            intent.project.addressValidationVerdict ?? null,
            intent.project.projectManagerId,
            intent.project.estimatedValue,
            intent.project.flooringCategory,
            intent.project.squareFeet,
            intent.project.contractValue,
            segment,
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

    async update(intent) {
      if (!isPostgresUuid(intent.projectId)) return { outcome: "project-not-found" };
      if (!isPostgresUuid(intent.values.clientId)) return { outcome: "client-not-found" };
      assertUuid(intent.activity.id, "PostgreSQL project activity ID");
      if (
        intent.activity.recordId !== intent.projectId
        || intent.activity.actor !== intent.updatedBy
        || intent.activity.createdAt !== intent.updatedAt
        || !intent.updatedBy.trim()
        || !Number.isSafeInteger(intent.updatedAt)
      ) {
        throw new TypeError("PostgreSQL project update evidence must match the project and actor");
      }
      const expectedVersion = parsePostgresPositiveBigint(
        intent.expectedVersion,
        "Expected PostgreSQL project version",
      );
      try {
        return await withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
          const values = intent.values;
          const updated = await client.query<ProjectDatabaseRow>(
            `UPDATE projects
             SET client_id = $1, name = $2, status = $3, site = $4,
                 latitude = $5, longitude = $6, address_validation_verdict = $7,
                 estimated_value = $8, flooring_category = $9, square_feet = $10,
                 contract_value = $11, segment = $12, updated_by = $13,
                 updated_at = $14, version = version + 1
             WHERE id = $15 AND version = $16::bigint
             RETURNING id::text AS id, project_number,
                       client_id::text AS client_id, name, status, site,
                       latitude, longitude, address_validation_verdict,
                       project_manager, estimated_value::text AS estimated_value,
                       flooring_category, square_feet::text AS square_feet,
                       contract_value::text AS contract_value, segment,
                       updated_at, version::text AS version`,
            [
              values.clientId,
              values.name,
              values.status,
              values.site,
              values.latitude,
              values.longitude,
              values.addressValidationVerdict,
              values.estimatedValue,
              values.flooringCategory,
              values.squareFeet,
              values.contractValue,
              values.segment,
              intent.updatedBy,
              new Date(intent.updatedAt),
              intent.projectId,
              expectedVersion,
            ],
          );
          if (updated.rowCount === 0) return projectUpdateFailure(client, intent.projectId);
          if (updated.rowCount !== 1 || !updated.rows[0]) {
            throw new Error("PostgreSQL project update returned an invalid result");
          }
          const value = projectRowFromPostgres(updated.rows[0]);
          await insertProjectUpdateActivity(
            client,
            intent.activity,
            "project-update",
            value.version,
          );
          return { outcome: "updated" as const, value };
        });
      } catch (error) {
        if (postgresConstraint(error, "23503", PROJECT_CLIENT_REFERENCE_CONSTRAINTS)) {
          return { outcome: "client-not-found" as const };
        }
        throw error;
      }
    },

    async assignManager(intent) {
      if (!isPostgresUuid(intent.projectId)) return { outcome: "project-not-found" };
      assertUuid(intent.activity.id, "PostgreSQL project activity ID");
      if (intent.activity.recordId !== intent.projectId || intent.activity.actor.trim() === "") {
        throw new TypeError("PostgreSQL project-manager evidence must reference the updated project and actor");
      }

      return withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
        const expectedVersion = await projectOperationExpectedVersion(
          client,
          intent.projectId,
          intent.expectedVersion,
        );
        if (!expectedVersion) return { outcome: "project-not-found" as const };
        const updated = await client.query<Record<string, unknown> & { version: unknown }>(
          `UPDATE projects
           SET project_manager = $1, updated_by = $2, updated_at = $3,
               version = version + 1
           WHERE id = $4 AND version = $5::bigint
           RETURNING version::text AS version`,
          [
            intent.projectManagerId,
            intent.activity.actor,
            new Date(intent.updatedAt),
            intent.projectId,
            expectedVersion,
          ],
        );
        if (updated.rowCount === 0) return projectUpdateFailure(client, intent.projectId);
        if (updated.rowCount !== 1 || !updated.rows[0]) {
          throw new Error("PostgreSQL project-manager update returned an invalid result");
        }
        const resultingVersion = parsePostgresPositiveBigint(
          updated.rows[0].version,
          "PostgreSQL project-manager version",
        );
        await insertProjectUpdateActivity(
          client,
          intent.activity,
          "project-manager",
          resultingVersion,
        );
        return { outcome: "updated" as const };
      });
    },

    async recordInstallationDates(intent) {
      if (!isPostgresUuid(intent.projectId)) return { outcome: "project-not-found" };
      assertProjectOperationActivity(intent, "installation-date");
      assertSafeEpochMilliseconds(
        intent.installationStartedAt,
        "PostgreSQL installation start",
      );
      assertSafeEpochMilliseconds(
        intent.installationCompletedAt,
        "PostgreSQL installation completion",
      );
      if (intent.installationCompletedAt < intent.installationStartedAt) {
        throw new TypeError(
          "PostgreSQL installation completion must be on or after installation start",
        );
      }

      return withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
        const expectedVersion = await projectOperationExpectedVersion(
          client,
          intent.projectId,
          intent.expectedVersion,
        );
        if (!expectedVersion) return { outcome: "project-not-found" as const };
        const updated = await client.query<Record<string, unknown> & { version: unknown }>(
          `UPDATE projects
           SET installation_started_at = $1, installation_completed_at = $2,
               updated_by = $3, updated_at = $4, version = version + 1
           WHERE id = $5 AND version = $6::bigint
           RETURNING version::text AS version`,
          [
            new Date(intent.installationStartedAt),
            new Date(intent.installationCompletedAt),
            intent.activity.actor,
            new Date(intent.updatedAt),
            intent.projectId,
            expectedVersion,
          ],
        );
        if (updated.rowCount === 0) return projectUpdateFailure(client, intent.projectId);
        if (updated.rowCount !== 1 || !updated.rows[0]) {
          throw new Error("PostgreSQL installation-date update returned an invalid result");
        }
        const resultingVersion = parsePostgresPositiveBigint(
          updated.rows[0].version,
          "PostgreSQL installation-date project version",
        );
        await insertProjectUpdateActivity(
          client,
          intent.activity,
          "project-installation",
          resultingVersion,
        );
        return { outcome: "updated" as const };
      });
    },

    async recordFollowUpResult(intent) {
      if (!isPostgresUuid(intent.projectId)) return { outcome: "project-not-found" };
      assertProjectOperationActivity(intent, "follow-up");
      if (
        intent.callbackNote !== null &&
        (
          intent.callbackNote.length > CALLBACK_NOTE_MAX_LENGTH ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(intent.callbackNote) ||
          intent.callbackNote.trim() === ""
        )
      ) {
        throw new TypeError("PostgreSQL callback note must be bounded valid text or null");
      }

      return withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
        const expectedVersion = await projectOperationExpectedVersion(
          client,
          intent.projectId,
          intent.expectedVersion,
        );
        if (!expectedVersion) return { outcome: "project-not-found" as const };
        const updated = await client.query<Record<string, unknown> & { version: unknown }>(
          `UPDATE projects
           SET had_callback = $1, callback_note = $2, updated_by = $3,
               updated_at = $4, version = version + 1
           WHERE id = $5 AND version = $6::bigint
           RETURNING version::text AS version`,
          [
            intent.hadCallback,
            intent.callbackNote,
            intent.activity.actor,
            new Date(intent.updatedAt),
            intent.projectId,
            expectedVersion,
          ],
        );
        if (updated.rowCount === 0) return projectUpdateFailure(client, intent.projectId);
        if (updated.rowCount !== 1 || !updated.rows[0]) {
          throw new Error("PostgreSQL follow-up update returned an invalid result");
        }
        const resultingVersion = parsePostgresPositiveBigint(
          updated.rows[0].version,
          "PostgreSQL follow-up project version",
        );
        await insertProjectUpdateActivity(
          client,
          intent.activity,
          "project-follow-up",
          resultingVersion,
        );
        return { outcome: "updated" as const };
      });
    },
  };
}
