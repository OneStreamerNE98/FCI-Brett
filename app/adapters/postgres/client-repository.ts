import { normalizeClientNameKey } from "../../domain/client-name-key";
import type {
  AcceptedClientCreation,
  ClientCreationIntent,
  ClientRepository,
} from "../../ports/client-repository";
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
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
} from "./postgres-values";

type ClientInsertRow = Record<string, unknown> & {
  id: unknown;
  client_code: unknown;
  name: unknown;
  created_at: unknown;
  version: unknown;
};

const CLIENT_IDENTIFIER_CONSTRAINTS = [
  "clients_pkey",
  "clients_client_code_key",
  "contacts_pkey",
  "activity_events_pkey",
  "outbox_events_pkey",
  "outbox_events_event_key_key",
  "idempotency_requests_pkey",
] as const;

export type PostgresClientRepositoryOptions = {
  schema?: string;
  request: PostgresCreationRequestMetadata;
};

function clientCreationFingerprintInput(intent: ClientCreationIntent) {
  return {
    version: 1,
    name: intent.client.name,
    normalizedNameKey: normalizeClientNameKey(intent.client.name),
    status: intent.client.status,
    industry: intent.client.industry?.trim() || null,
    primaryContact: intent.primaryContact
      ? {
          name: intent.primaryContact.name,
          email: intent.primaryContact.email?.trim() || null,
          phone: intent.primaryContact.phone?.trim() || null,
          role: intent.primaryContact.role.trim() || "Primary contact",
          isPrimary: true,
        }
      : null,
  };
}

export function calculatePostgresClientCreationFingerprint(intent: ClientCreationIntent) {
  return calculatePostgresRequestFingerprint(clientCreationFingerprintInput(intent));
}

function postgresConstraint(error: unknown, code: string, constraints: readonly string[]) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === code && typeof record.constraint === "string" && constraints.includes(record.constraint);
}

function assertUuid(value: string, label: string) {
  if (!isPostgresUuid(value)) throw new TypeError(`${label} must be a UUID`);
}

function assertClientIntent(intent: ClientCreationIntent) {
  assertUuid(intent.client.id, "PostgreSQL client ID");
  assertUuid(intent.activity.id, "PostgreSQL client activity ID");
  if (intent.primaryContact) assertUuid(intent.primaryContact.id, "PostgreSQL contact ID");
  if (
    intent.activity.recordId !== intent.client.id ||
    (intent.primaryContact !== null && intent.primaryContact.clientId !== intent.client.id)
  ) {
    throw new TypeError("PostgreSQL client creation evidence must reference the new client");
  }
  if (intent.activity.actor !== intent.client.createdBy || !intent.client.createdBy.trim()) {
    throw new TypeError("PostgreSQL client creation actor must match its activity evidence");
  }
  if (!Number.isSafeInteger(intent.client.createdAt) || !Number.isSafeInteger(intent.client.updatedAt)) {
    throw new TypeError("PostgreSQL client timestamps must be safe epoch milliseconds");
  }
  if (
    !Number.isSafeInteger(intent.activity.createdAt) ||
    (intent.primaryContact !== null && (
      !Number.isSafeInteger(intent.primaryContact.createdAt) ||
      !Number.isSafeInteger(intent.primaryContact.updatedAt)
    ))
  ) {
    throw new TypeError("PostgreSQL client evidence timestamps must be safe epoch milliseconds");
  }
}

function acceptedClient(value: unknown): AcceptedClientCreation {
  const record = parsePostgresJsonObject(value, "PostgreSQL stored client response");
  if (
    typeof record.id !== "string" || !isPostgresUuid(record.id) ||
    typeof record.clientCode !== "string" || !/^CL-[A-Z0-9]{8}$/.test(record.clientCode) ||
    typeof record.name !== "string" || !record.name.trim() ||
    typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt)
  ) {
    throw new Error("PostgreSQL stored client response is invalid");
  }
  return {
    id: record.id,
    clientCode: record.clientCode,
    name: record.name,
    createdAt: record.createdAt,
    version: parsePostgresPositiveBigint(record.version, "PostgreSQL stored client version"),
  };
}

function clientFromRow(row: ClientInsertRow): AcceptedClientCreation {
  if (
    typeof row.id !== "string" || !isPostgresUuid(row.id) ||
    typeof row.client_code !== "string" ||
    typeof row.name !== "string"
  ) {
    throw new Error("PostgreSQL client insert returned an invalid row");
  }
  return {
    id: row.id,
    clientCode: row.client_code,
    name: row.name,
    createdAt: parsePostgresTimestamp(row.created_at, "PostgreSQL client created_at"),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL client version"),
  };
}

export function createPostgresClientRepository(
  pool: PostgresPool,
  options: PostgresClientRepositoryOptions,
): ClientRepository {
  return {
    async create(intent) {
      assertClientIntent(intent);
      const request = bindPostgresCreationRequest(
        options.request,
        clientCreationFingerprintInput(intent),
      );
      try {
        return await withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
          const claim = await claimPostgresCreation(
            client,
            POSTGRES_CREATION_OPERATIONS.client,
            intent.client.createdBy,
            intent.client.createdAt,
            request,
            acceptedClient,
          );
          if (claim.outcome === "idempotency-conflict" || claim.outcome === "in-progress") return claim;
          if (claim.outcome === "failed-replay") {
            if (claim.responseStatus === 409 && claim.responseBody.outcome === "duplicate") {
              return { outcome: "duplicate" as const };
            }
            throw new Error("Stored PostgreSQL client failure response is invalid");
          }
          if (claim.outcome === "replayed") {
            return { outcome: "accepted" as const, value: claim.value, replayed: true };
          }

          const inserted = await client.query<ClientInsertRow>(
            `INSERT INTO clients (
               id, client_code, name, normalized_name_key, status, industry,
               created_by, updated_by, created_at, updated_at, version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, 1)
             ON CONFLICT ON CONSTRAINT clients_normalized_name_key_key DO NOTHING
             RETURNING id::text AS id, client_code, name, created_at,
                       version::text AS version`,
            [
              intent.client.id,
              intent.client.clientCode,
              intent.client.name,
              normalizeClientNameKey(intent.client.name),
              intent.client.status,
              intent.client.industry?.trim() || null,
              intent.client.createdBy,
              new Date(intent.client.createdAt),
              new Date(intent.client.updatedAt),
            ],
          );
          const row = inserted.rows[0];
          if (!row || inserted.rowCount !== 1) {
            if (inserted.rowCount === 0 && inserted.rows.length === 0) {
              await failPostgresCreation(
                client,
                POSTGRES_CREATION_OPERATIONS.client,
                intent.client.createdBy,
                intent.client.updatedAt,
                request,
                409,
                { outcome: "duplicate" },
              );
              return { outcome: "duplicate" as const };
            }
            throw new Error("PostgreSQL client was not inserted exactly once");
          }
          const value = clientFromRow(row);

          if (intent.primaryContact) {
            await client.query(
              `INSERT INTO contacts (
                 id, client_id, name, email, phone, role, is_primary,
                 created_at, updated_at, version
               ) VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, 1)`,
              [
                intent.primaryContact.id,
                intent.primaryContact.clientId,
                intent.primaryContact.name,
                intent.primaryContact.email?.trim() || null,
                intent.primaryContact.phone?.trim() || null,
                intent.primaryContact.role.trim() || "Primary contact",
                new Date(intent.primaryContact.createdAt),
                new Date(intent.primaryContact.updatedAt),
              ],
            );
          }

          await client.query(
            `INSERT INTO activity_events (
               id, client_id, action, actor_id, correlation_id, result, detail, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7)`,
            [
              intent.activity.id,
              intent.client.id,
              intent.activity.action,
              intent.activity.actor,
              request.correlationId,
              JSON.stringify({ message: intent.activity.detail }),
              new Date(intent.activity.createdAt),
            ],
          );
          await client.query(
            `INSERT INTO outbox_events (
               id, event_key, event_type, client_id, actor_id, correlation_id,
               payload, status, available_at, created_at, updated_at, version
             ) VALUES ($1, $2, 'client.created', $3, $4, $5, $6::jsonb,
               'pending', $7, $7, $7, 1)`,
            [
              request.outboxEventId,
              `client.created:${intent.client.id}`,
              intent.client.id,
              intent.client.createdBy,
              request.correlationId,
              JSON.stringify({ cause: "client-created", recordId: intent.client.id }),
              new Date(intent.client.createdAt),
            ],
          );
          await completePostgresCreation(
            client,
            POSTGRES_CREATION_OPERATIONS.client,
            intent.client.createdBy,
            intent.client.updatedAt,
            request,
            value,
          );
          return { outcome: "accepted" as const, value, replayed: false };
        });
      } catch (error) {
        if (postgresConstraint(error, "23505", CLIENT_IDENTIFIER_CONSTRAINTS)) {
          return { outcome: "identifier-collision" };
        }
        throw error;
      }
    },
  };
}
