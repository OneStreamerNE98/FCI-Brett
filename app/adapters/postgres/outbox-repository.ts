import { createHash } from "node:crypto";
import type {
  ClaimedOutboxEvent,
  CompleteOutboxEventResult,
  OutboxEventType,
  OutboxRepository,
  RecoveredOutboxEvent,
  RetryOrDeadLetterOutboxEventResult,
} from "../../ports/outbox-repository";
import type { PostgresClient, PostgresPool } from "./postgres-database";
import { withPostgresTransaction } from "./postgres-database";
import {
  isPostgresUuid,
  parsePostgresJsonObject,
  parsePostgresNumericSafeInteger,
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
  postgresSchemaName,
} from "./postgres-values";

const MAX_BATCH_SIZE = 100;
const MAX_LEASE_DURATION_MS = 60 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 100;

type PostgresOutboxRepositoryOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

type ClaimedOutboxRow = Record<string, unknown> & {
  id: unknown;
  event_key: unknown;
  event_type: unknown;
  client_id: unknown;
  project_id: unknown;
  lead_id: unknown;
  actor_id: unknown;
  correlation_id: unknown;
  payload: unknown;
  available_at: unknown;
  attempt_count: unknown;
  lease_expires_at: unknown;
  created_at: unknown;
  version: unknown;
};

type TransitionRow = Record<string, unknown> & {
  id?: unknown;
  event_key?: unknown;
  event_type?: unknown;
  client_id?: unknown;
  project_id?: unknown;
  lead_id?: unknown;
  actor_id?: unknown;
  correlation_id?: unknown;
  attempt_count?: unknown;
  status: unknown;
  version: unknown;
  available_at: unknown;
  completed_at?: unknown;
  dead_lettered_at: unknown;
};

function boundedInteger(value: number, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function safeErrorEvidence(
  value: string,
  label: string,
  maximum: number,
  fallback: string,
) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be text`);
  }
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const unsafeControl =
      (codePoint >= 0x00 && codePoint <= 0x08)
      || codePoint === 0x0b
      || codePoint === 0x0c
      || (codePoint >= 0x0e && codePoint <= 0x1f)
      || codePoint === 0x7f;
    const unpairedSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    sanitized += unsafeControl || unpairedSurrogate ? "�" : character;
  }
  const safeValue = sanitized.trim() || fallback;
  return Array.from(safeValue).slice(0, maximum).join("");
}

function postgresUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !isPostgresUuid(value)) {
    throw new TypeError(`${label} must be a UUID`);
  }
  return value;
}

function positivePostgresVersion(value: unknown, label: string) {
  return parsePostgresPositiveBigint(value, label);
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is not valid PostgreSQL text`);
  }
  return value;
}

function nullableUuid(value: unknown, label: string) {
  return value === null ? null : postgresUuid(value, label);
}

function outboxEventType(value: unknown): OutboxEventType {
  if (
    value !== "client.created"
    && value !== "project.created"
    && value !== "lead.created"
    && value !== "project.meeting.created"
  ) {
    throw new Error("PostgreSQL outbox event type is not supported");
  }
  return value;
}

function validOutboxTarget(
  eventType: OutboxEventType,
  clientId: string | null,
  projectId: string | null,
  leadId: string | null,
) {
  return (eventType === "client.created" && Boolean(clientId) && !projectId && !leadId)
    || (
      (eventType === "project.created" || eventType === "project.meeting.created")
      && Boolean(projectId) && !clientId && !leadId
    )
    || (eventType === "lead.created" && Boolean(leadId) && !clientId && !projectId);
}

export function deadLetterActivityId(eventId: string) {
  postgresUuid(eventId, "PostgreSQL dead-lettered outbox event ID");
  const hex = createHash("sha256")
    .update(`fci-outbox-dead-letter:${eventId}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");
  // UUIDv8 reserves the payload layout for application-defined deterministic
  // identifiers while retaining the standard UUID variant bits.
  hex[12] = "8";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function claimedOutboxEvent(row: ClaimedOutboxRow): ClaimedOutboxEvent {
  const eventType = outboxEventType(row.event_type);
  const clientId = nullableUuid(row.client_id, "PostgreSQL outbox client ID");
  const projectId = nullableUuid(row.project_id, "PostgreSQL outbox project ID");
  const leadId = nullableUuid(row.lead_id, "PostgreSQL outbox lead ID");
  if (!validOutboxTarget(eventType, clientId, projectId, leadId)) {
    throw new Error("PostgreSQL outbox event has an invalid record target");
  }

  return {
    id: postgresUuid(row.id, "PostgreSQL outbox event ID"),
    eventKey: requiredText(row.event_key, "PostgreSQL outbox event key"),
    eventType,
    clientId,
    projectId,
    leadId,
    actorId: requiredText(row.actor_id, "PostgreSQL outbox actor ID"),
    correlationId: requiredText(row.correlation_id, "PostgreSQL outbox correlation ID"),
    payload: parsePostgresJsonObject(row.payload, "PostgreSQL outbox payload"),
    availableAt: parsePostgresTimestamp(row.available_at, "PostgreSQL outbox availability"),
    attemptCount: parsePostgresNumericSafeInteger(
      row.attempt_count,
      "PostgreSQL outbox attempt count",
    ),
    leaseExpiresAt: parsePostgresTimestamp(
      row.lease_expires_at,
      "PostgreSQL outbox lease expiry",
    ),
    createdAt: parsePostgresTimestamp(row.created_at, "PostgreSQL outbox creation time"),
    version: positivePostgresVersion(row.version, "PostgreSQL outbox version"),
  };
}

function oneTransitionRow(rows: TransitionRow[]) {
  if (rows.length > 1) throw new Error("PostgreSQL outbox transition updated more than one event");
  return rows[0];
}

function transitionVersion(row: TransitionRow) {
  return positivePostgresVersion(row.version, "PostgreSQL outbox transition version");
}

async function appendDeadLetterActivity(
  client: PostgresClient,
  row: TransitionRow,
  errorCode: string,
  errorMessage: string,
  deadLetteredAt: number,
) {
  const eventId = postgresUuid(row.id, "PostgreSQL dead-lettered outbox event ID");
  const activityId = deadLetterActivityId(eventId);
  const eventType = outboxEventType(row.event_type);
  const clientId = nullableUuid(row.client_id, "PostgreSQL dead-lettered outbox client ID");
  const projectId = nullableUuid(row.project_id, "PostgreSQL dead-lettered outbox project ID");
  const leadId = nullableUuid(row.lead_id, "PostgreSQL dead-lettered outbox lead ID");
  if (!validOutboxTarget(eventType, clientId, projectId, leadId)) {
    throw new Error("PostgreSQL dead-lettered outbox event has an invalid record target");
  }
  const eventKey = requiredText(row.event_key, "PostgreSQL dead-lettered outbox event key");
  const actorId = requiredText(row.actor_id, "PostgreSQL dead-lettered outbox actor ID");
  const correlationId = requiredText(
    row.correlation_id,
    "PostgreSQL dead-lettered outbox correlation ID",
  );
  const attemptCount = parsePostgresNumericSafeInteger(
    row.attempt_count,
    "PostgreSQL dead-lettered outbox attempt count",
  );

  const inserted = await client.query(
    `INSERT INTO activity_events (
       id, client_id, project_id, lead_id, action, actor_id, correlation_id,
       result, reason, detail, occurred_at
     ) VALUES (
       $1, $2, $3, $4, 'Outbox event dead-lettered', $5, $6,
       'failed', $7, $8::jsonb, $9
     )`,
    [
      activityId,
      clientId,
      projectId,
      leadId,
      actorId,
      correlationId,
      errorCode,
      JSON.stringify({
        outboxEventId: eventId,
        eventKey,
        eventType,
        attemptCount,
        errorCode,
        errorMessage,
      }),
      new Date(deadLetteredAt),
    ],
  );
  if (inserted.rowCount !== 1) {
    throw new Error("PostgreSQL dead-letter activity was not inserted exactly once");
  }
}

function transactionOptions(options: PostgresOutboxRepositoryOptions) {
  return {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };
}

export function createPostgresOutboxRepository(
  pool: PostgresPool,
  options: PostgresOutboxRepositoryOptions = {},
): OutboxRepository {
  const postgresOptions = transactionOptions(options);

  return {
    async claimAvailable(input) {
      const batchSize = boundedInteger(input.batchSize, "Outbox claim batch size", 1, MAX_BATCH_SIZE);
      const leaseDurationMs = boundedInteger(
        input.leaseDurationMs,
        "Outbox lease duration",
        1,
        MAX_LEASE_DURATION_MS,
      );

      return withPostgresTransaction(pool, postgresOptions, async (client) => {
        const claimed = await client.query<ClaimedOutboxRow>(
          `WITH candidates AS MATERIALIZED (
             SELECT id, available_at AS queue_available_at,
                    created_at AS queue_created_at
             FROM outbox_events
             WHERE status = 'pending' AND available_at <= pg_catalog.now()
             ORDER BY available_at, created_at, id
             LIMIT $1
             FOR UPDATE SKIP LOCKED
           ), claimed AS (
             UPDATE outbox_events AS event
             SET status = 'processing',
                 attempt_count = event.attempt_count + 1,
                 lease_expires_at = pg_catalog.now()
                   + ($2::double precision * interval '1 millisecond'),
                 completed_at = NULL,
                 dead_lettered_at = NULL,
                 updated_at = GREATEST(pg_catalog.now(), event.created_at),
                 version = event.version + 1
             FROM candidates
             WHERE event.id = candidates.id
             RETURNING event.id, event.event_key, event.event_type,
                       event.client_id, event.project_id, event.lead_id, event.actor_id,
                       event.correlation_id, event.payload, event.available_at,
                       event.attempt_count, event.lease_expires_at,
                       event.created_at, event.version::text AS version,
                       candidates.queue_available_at, candidates.queue_created_at
           )
           SELECT id, event_key, event_type, client_id, project_id, lead_id, actor_id,
                  correlation_id, payload, available_at, attempt_count,
                  lease_expires_at, created_at, version
           FROM claimed
           ORDER BY queue_available_at, queue_created_at, id`,
          [batchSize, leaseDurationMs],
        );
        return claimed.rows.map(claimedOutboxEvent);
      });
    },

    async complete(input): Promise<CompleteOutboxEventResult> {
      const eventId = postgresUuid(input.eventId, "Outbox completion event ID");
      const expectedVersion = positivePostgresVersion(
        input.expectedVersion,
        "Outbox completion expected version",
      );

      return withPostgresTransaction(pool, postgresOptions, async (client) => {
        const completed = await client.query<TransitionRow>(
          `UPDATE outbox_events
           SET status = 'completed', lease_expires_at = NULL,
               completed_at = GREATEST(pg_catalog.now(), created_at),
               dead_lettered_at = NULL,
               updated_at = GREATEST(pg_catalog.now(), created_at),
               version = version + 1
           WHERE id = $1 AND status = 'processing' AND version = $2::bigint
           RETURNING status, version::text AS version, available_at,
                     completed_at, dead_lettered_at`,
          [eventId, expectedVersion],
        );
        const row = oneTransitionRow(completed.rows);
        if (!row) return { outcome: "stale" };
        if (row.status !== "completed") {
          throw new Error("PostgreSQL outbox completion returned an invalid status");
        }
        return {
          outcome: "completed",
          version: transitionVersion(row),
          completedAt: parsePostgresTimestamp(
            row.completed_at,
            "PostgreSQL outbox completion time",
          ),
        };
      });
    },

    async retryOrDeadLetter(input): Promise<RetryOrDeadLetterOutboxEventResult> {
      const eventId = postgresUuid(input.eventId, "Outbox failure event ID");
      const expectedVersion = positivePostgresVersion(
        input.expectedVersion,
        "Outbox failure expected version",
      );
      const retryDelayMs = boundedInteger(
        input.retryDelayMs,
        "Outbox retry delay",
        0,
        MAX_RETRY_DELAY_MS,
      );
      const maxAttempts = boundedInteger(input.maxAttempts, "Outbox maximum attempts", 1, MAX_ATTEMPTS);
      const errorCode = safeErrorEvidence(
        input.errorCode,
        "Outbox error code",
        128,
        "provider_error",
      );
      const errorMessage = safeErrorEvidence(
        input.errorMessage,
        "Outbox error message",
        4000,
        "Provider operation failed without safe error detail.",
      );

      return withPostgresTransaction(pool, postgresOptions, async (client) => {
        const failed = await client.query<TransitionRow>(
          `UPDATE outbox_events AS event
           SET status = CASE
                 WHEN event.attempt_count >= $4 THEN 'dead'
                 ELSE 'pending'
               END,
               available_at = CASE
                 WHEN event.attempt_count >= $4 THEN event.available_at
                 ELSE GREATEST(
                   event.created_at,
                   pg_catalog.now() + ($3::double precision * interval '1 millisecond')
                 )
               END,
               lease_expires_at = NULL,
               last_error_code = $5,
               last_error_message = $6,
               completed_at = NULL,
               dead_lettered_at = CASE
                 WHEN event.attempt_count >= $4
                   THEN GREATEST(pg_catalog.now(), event.created_at)
                 ELSE NULL
               END,
               updated_at = GREATEST(pg_catalog.now(), event.created_at),
               version = event.version + 1
           WHERE event.id = $1 AND event.status = 'processing'
             AND event.version = $2::bigint
           RETURNING event.id, event.event_key, event.event_type,
                     event.client_id, event.project_id, event.lead_id, event.actor_id,
                     event.correlation_id, event.attempt_count, event.status,
                     event.version::text AS version, event.available_at,
                     event.dead_lettered_at`,
          [eventId, expectedVersion, retryDelayMs, maxAttempts, errorCode, errorMessage],
        );
        const row = oneTransitionRow(failed.rows);
        if (!row) return { outcome: "stale" };
        const version = transitionVersion(row);
        if (row.status === "pending") {
          return {
            outcome: "retry",
            version,
            availableAt: parsePostgresTimestamp(
              row.available_at,
              "PostgreSQL outbox retry availability",
            ),
          };
        }
        if (row.status === "dead") {
          const deadLetteredAt = parsePostgresTimestamp(
            row.dead_lettered_at,
            "PostgreSQL outbox dead-letter time",
          );
          await appendDeadLetterActivity(
            client,
            row,
            errorCode,
            errorMessage,
            deadLetteredAt,
          );
          return {
            outcome: "dead-lettered",
            version,
            deadLetteredAt,
          };
        }
        throw new Error("PostgreSQL outbox failure transition returned an invalid status");
      });
    },

    async recoverExpiredLeases(input): Promise<RecoveredOutboxEvent[]> {
      const batchSize = boundedInteger(input.batchSize, "Outbox recovery batch size", 1, MAX_BATCH_SIZE);
      const retryDelayMs = boundedInteger(
        input.retryDelayMs,
        "Outbox recovery delay",
        0,
        MAX_RETRY_DELAY_MS,
      );
      const maxAttempts = boundedInteger(input.maxAttempts, "Outbox maximum attempts", 1, MAX_ATTEMPTS);

      return withPostgresTransaction(pool, postgresOptions, async (client) => {
        const recovered = await client.query<TransitionRow>(
          `WITH candidates AS MATERIALIZED (
             SELECT id, lease_expires_at AS expired_at
             FROM outbox_events
             WHERE status = 'processing'
               AND lease_expires_at <= pg_catalog.now()
             ORDER BY lease_expires_at, id
             LIMIT $1
             FOR UPDATE SKIP LOCKED
           ), recovered AS (
             UPDATE outbox_events AS event
             SET status = CASE
                   WHEN event.attempt_count >= $3 THEN 'dead'
                   ELSE 'pending'
                 END,
                 available_at = CASE
                   WHEN event.attempt_count >= $3 THEN event.available_at
                   ELSE GREATEST(
                     event.created_at,
                     pg_catalog.now() + ($2::double precision * interval '1 millisecond')
                   )
                 END,
                 lease_expires_at = NULL,
                 last_error_code = 'lease_expired',
                 last_error_message = 'Worker lease expired before completion.',
                 completed_at = NULL,
                 dead_lettered_at = CASE
                   WHEN event.attempt_count >= $3
                     THEN GREATEST(pg_catalog.now(), event.created_at)
                   ELSE NULL
                 END,
                 updated_at = GREATEST(pg_catalog.now(), event.created_at),
                 version = event.version + 1
             FROM candidates
             WHERE event.id = candidates.id
             RETURNING event.id, event.event_key, event.event_type,
                       event.client_id, event.project_id, event.lead_id, event.actor_id,
                       event.correlation_id, event.attempt_count, event.status,
                       event.version::text AS version, event.available_at,
                       event.dead_lettered_at,
                       candidates.expired_at
           )
           SELECT id, event_key, event_type, client_id, project_id, lead_id, actor_id,
                  correlation_id, attempt_count, status, version, available_at,
                  dead_lettered_at
           FROM recovered
           ORDER BY expired_at, id`,
          [batchSize, retryDelayMs, maxAttempts],
        );
        const results: RecoveredOutboxEvent[] = [];
        for (const row of recovered.rows) {
          const id = postgresUuid(row.id, "PostgreSQL recovered outbox event ID");
          const version = transitionVersion(row);
          if (row.status === "pending") {
            results.push({
              id,
              outcome: "retry",
              version,
              availableAt: parsePostgresTimestamp(
                row.available_at,
                "PostgreSQL recovered outbox availability",
              ),
            });
          } else if (row.status === "dead") {
            const deadLetteredAt = parsePostgresTimestamp(
              row.dead_lettered_at,
              "PostgreSQL recovered outbox dead-letter time",
            );
            await appendDeadLetterActivity(
              client,
              row,
              "lease_expired",
              "Worker lease expired before completion.",
              deadLetteredAt,
            );
            results.push({
              id,
              outcome: "dead-lettered",
              version,
              deadLetteredAt,
            });
          } else {
            throw new Error("PostgreSQL outbox recovery returned an invalid status");
          }
        }
        return results;
      });
    },
  };
}
