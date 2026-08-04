import { CLIENT_STATUSES, type ClientStatus } from "../../domain/client-creation";
import { SAVED_ADDRESS_VERDICTS, type SavedAddressVerdict } from "../../domain/address-validation";
import { normalizeClientNameKey } from "../../domain/client-name-key";
import type {
  AcceptedClientCreation,
  ClientCreationIntent,
  ClientRepository,
  ClientRow,
  ContactRow,
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

type ClientDatabaseRow = ClientInsertRow & {
  status: unknown;
  industry: unknown;
  site_address: unknown;
  latitude: unknown;
  longitude: unknown;
  address_validation_verdict: unknown;
  updated_at: unknown;
};

type ContactDatabaseRow = Record<string, unknown> & {
  id: unknown;
  client_id: unknown;
  name: unknown;
  email: unknown;
  phone: unknown;
  role: unknown;
  is_primary: unknown;
  updated_at: unknown;
  version: unknown;
};

const CLIENT_SELECT = `SELECT id::text AS id, client_code, name, status, industry,
       site_address, latitude, longitude, address_validation_verdict,
       updated_at, version::text AS version
FROM clients`;

const CONTACT_SELECT = `SELECT id::text AS id, client_id::text AS client_id,
       name, email, phone, role, is_primary, updated_at,
       version::text AS version
FROM contacts`;

const CLIENT_IDENTIFIER_CONSTRAINTS = [
  "clients_pkey",
  "clients_client_code_key",
  "contacts_pkey",
  "activity_events_pkey",
  "outbox_events_pkey",
  "outbox_events_event_key_key",
  "idempotency_requests_pkey",
] as const;

const CLIENT_NAME_CONSTRAINTS = ["clients_normalized_name_key_key"] as const;

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
    siteAddress: intent.client.siteAddress ?? null,
    latitude: intent.client.latitude ?? null,
    longitude: intent.client.longitude ?? null,
    addressValidationVerdict: intent.client.addressValidationVerdict ?? null,
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

function clientRowFromPostgres(row: ClientDatabaseRow): ClientRow {
  const siteAddress = row.site_address ?? null;
  const latitude = row.latitude ?? null;
  const longitude = row.longitude ?? null;
  const addressVerdict = row.address_validation_verdict ?? null;
  if (
    typeof row.id !== "string"
    || !isPostgresUuid(row.id)
    || typeof row.client_code !== "string"
    || typeof row.name !== "string"
    || typeof row.status !== "string"
    || !CLIENT_STATUSES.includes(row.status as ClientStatus)
    || row.industry !== null && typeof row.industry !== "string"
    || siteAddress !== null && typeof siteAddress !== "string"
    || latitude !== null && typeof latitude !== "number"
    || longitude !== null && typeof longitude !== "number"
    || addressVerdict !== null
      && !SAVED_ADDRESS_VERDICTS.includes(addressVerdict as SavedAddressVerdict)
  ) {
    throw new Error("PostgreSQL client row is invalid");
  }
  return {
    id: row.id,
    clientCode: row.client_code,
    name: row.name,
    status: row.status as ClientStatus,
    industry: row.industry,
    siteAddress: siteAddress as string | null,
    latitude: latitude as number | null,
    longitude: longitude as number | null,
    addressValidationVerdict: addressVerdict as SavedAddressVerdict | null,
    updatedAt: parsePostgresTimestamp(row.updated_at, "PostgreSQL client updated_at"),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL client version"),
  };
}

function contactRowFromPostgres(row: ContactDatabaseRow): ContactRow {
  if (
    typeof row.id !== "string"
    || !isPostgresUuid(row.id)
    || typeof row.client_id !== "string"
    || !isPostgresUuid(row.client_id)
    || typeof row.name !== "string"
    || row.email !== null && typeof row.email !== "string"
    || row.phone !== null && typeof row.phone !== "string"
    || typeof row.role !== "string"
    || typeof row.is_primary !== "boolean"
  ) {
    throw new Error("PostgreSQL contact row is invalid");
  }
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isPrimary: row.is_primary,
    updatedAt: parsePostgresTimestamp(row.updated_at, "PostgreSQL contact updated_at"),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL contact version"),
  };
}

export function createPostgresClientRepository(
  pool: PostgresPool,
  options: PostgresClientRepositoryOptions,
): ClientRepository {
  return {
    async findById(clientId) {
      if (!isPostgresUuid(clientId)) return null;
      return withPostgresTransaction(
        pool,
        { schema: options.schema, readOnly: true },
        async (client) => {
          const result = await client.query<ClientDatabaseRow>(
            `${CLIENT_SELECT}\nWHERE id = $1`,
            [clientId],
          );
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || !result.rows[0]) {
            throw new Error("PostgreSQL client lookup returned an invalid result");
          }
          return clientRowFromPostgres(result.rows[0]);
        },
      );
    },

    async findContactById(contactId) {
      if (!isPostgresUuid(contactId)) return null;
      return withPostgresTransaction(
        pool,
        { schema: options.schema, readOnly: true },
        async (client) => {
          const result = await client.query<ContactDatabaseRow>(
            `${CONTACT_SELECT}\nWHERE id = $1`,
            [contactId],
          );
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || !result.rows[0]) {
            throw new Error("PostgreSQL contact lookup returned an invalid result");
          }
          return contactRowFromPostgres(result.rows[0]);
        },
      );
    },

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
               site_address, latitude, longitude, address_validation_verdict,
               created_by, updated_by, created_at, updated_at, version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13, 1)
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
              intent.client.siteAddress ?? null,
              intent.client.latitude ?? null,
              intent.client.longitude ?? null,
              intent.client.addressValidationVerdict ?? null,
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

    async update(intent) {
      if (!isPostgresUuid(intent.clientId)) return { outcome: "client-not-found" };
      assertUuid(intent.activity.id, "PostgreSQL client activity ID");
      if (
        intent.activity.recordId !== intent.clientId
        || intent.activity.actor !== intent.updatedBy
        || intent.activity.createdAt !== intent.updatedAt
        || !intent.updatedBy.trim()
        || !Number.isSafeInteger(intent.updatedAt)
      ) {
        throw new TypeError("PostgreSQL client update evidence must match the client and actor");
      }
      if (
        !intent.values.name.trim()
        || !CLIENT_STATUSES.includes(intent.values.status)
        || intent.values.industry !== null && !intent.values.industry.trim()
      ) {
        throw new TypeError("PostgreSQL client update values are invalid");
      }
      const expectedVersion = parsePostgresPositiveBigint(
        intent.expectedVersion,
        "Expected PostgreSQL client version",
      );

      try {
        return await withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
          const updated = await client.query<ClientDatabaseRow>(
            `UPDATE clients
             SET name = $1, normalized_name_key = $2, status = $3, industry = $4,
                 site_address = $5, latitude = $6, longitude = $7,
                 address_validation_verdict = $8,
                 updated_by = $9, updated_at = $10, version = version + 1
             WHERE id = $11 AND version = $12::bigint
             RETURNING id::text AS id, client_code, name, status, industry,
                       site_address, latitude, longitude, address_validation_verdict,
                       updated_at, version::text AS version`,
            [
              intent.values.name,
              normalizeClientNameKey(intent.values.name),
              intent.values.status,
              intent.values.industry,
              intent.values.siteAddress,
              intent.values.latitude,
              intent.values.longitude,
              intent.values.addressValidationVerdict,
              intent.updatedBy,
              new Date(intent.updatedAt),
              intent.clientId,
              expectedVersion,
            ],
          );
          if (updated.rowCount === 0) {
            const current = await client.query<{ version: unknown }>(
              "SELECT version::text AS version FROM clients WHERE id = $1",
              [intent.clientId],
            );
            if (current.rowCount === 0) return { outcome: "client-not-found" as const };
            if (current.rowCount !== 1 || !current.rows[0]) {
              throw new Error("PostgreSQL client conflict lookup returned an invalid result");
            }
            return {
              outcome: "conflict" as const,
              currentVersion: parsePostgresPositiveBigint(
                current.rows[0].version,
                "PostgreSQL current client version",
              ),
            };
          }
          if (updated.rowCount !== 1 || !updated.rows[0]) {
            throw new Error("PostgreSQL client update returned an invalid result");
          }
          const value = clientRowFromPostgres(updated.rows[0]);
          const audit = await client.query(
            `INSERT INTO activity_events (
               id, client_id, action, actor_id, correlation_id, result, detail, occurred_at
             )
             SELECT $1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7
             WHERE EXISTS (
               SELECT 1 FROM clients WHERE id = $2 AND version = $8::bigint
             )`,
            [
              intent.activity.id,
              intent.clientId,
              intent.activity.action,
              intent.activity.actor,
              `client-update:${intent.activity.id}`,
              JSON.stringify({ message: intent.activity.detail }),
              new Date(intent.activity.createdAt),
              value.version,
            ],
          );
          if (audit.rowCount !== 1) {
            throw new Error("PostgreSQL client update evidence was not inserted exactly once");
          }
          return { outcome: "updated" as const, value };
        });
      } catch (error) {
        if (postgresConstraint(error, "23505", CLIENT_NAME_CONSTRAINTS)) {
          return { outcome: "duplicate" };
        }
        throw error;
      }
    },

    async updateContact(intent) {
      if (!isPostgresUuid(intent.contactId)) return { outcome: "contact-not-found" };
      assertUuid(intent.activity.id, "PostgreSQL contact activity ID");
      if (
        !intent.values.name.trim()
        || intent.values.email !== null && !intent.values.email.trim()
        || intent.values.phone !== null && !intent.values.phone.trim()
        || !intent.values.role.trim()
        || !intent.updatedBy.trim()
        || !Number.isSafeInteger(intent.updatedAt)
        || intent.activity.actor !== intent.updatedBy
        || intent.activity.createdAt !== intent.updatedAt
      ) {
        throw new TypeError("PostgreSQL contact update values and evidence are invalid");
      }
      const expectedVersion = parsePostgresPositiveBigint(
        intent.expectedVersion,
        "Expected PostgreSQL contact version",
      );

      return withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
        const updated = await client.query<ContactDatabaseRow>(
          `UPDATE contacts
           SET name = $1, email = $2, phone = $3, role = $4,
               updated_at = $5, version = version + 1
           WHERE id = $6 AND version = $7::bigint
           RETURNING id::text AS id, client_id::text AS client_id,
                     name, email, phone, role, is_primary, updated_at,
                     version::text AS version`,
          [
            intent.values.name,
            intent.values.email,
            intent.values.phone,
            intent.values.role,
            new Date(intent.updatedAt),
            intent.contactId,
            expectedVersion,
          ],
        );
        if (updated.rowCount === 0) {
          const current = await client.query<{ version: unknown }>(
            "SELECT version::text AS version FROM contacts WHERE id = $1",
            [intent.contactId],
          );
          if (current.rowCount === 0) return { outcome: "contact-not-found" as const };
          if (current.rowCount !== 1 || !current.rows[0]) {
            throw new Error("PostgreSQL contact conflict lookup returned an invalid result");
          }
          return {
            outcome: "conflict" as const,
            currentVersion: parsePostgresPositiveBigint(
              current.rows[0].version,
              "PostgreSQL current contact version",
            ),
          };
        }
        if (updated.rowCount !== 1 || !updated.rows[0]) {
          throw new Error("PostgreSQL contact update returned an invalid result");
        }
        const value = contactRowFromPostgres(updated.rows[0]);
        if (intent.activity.recordId !== value.clientId) {
          throw new TypeError("PostgreSQL contact update evidence must reference its client");
        }
        const audit = await client.query(
          `INSERT INTO activity_events (
             id, client_id, action, actor_id, correlation_id, result, detail, occurred_at
           )
           SELECT $1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7
           WHERE EXISTS (
             SELECT 1 FROM contacts
             WHERE id = $8 AND client_id = $2 AND version = $9::bigint
           )`,
          [
            intent.activity.id,
            value.clientId,
            intent.activity.action,
            intent.activity.actor,
            `contact-update:${intent.activity.id}`,
            JSON.stringify({ message: intent.activity.detail }),
            new Date(intent.activity.createdAt),
            intent.contactId,
            value.version,
          ],
        );
        if (audit.rowCount !== 1) {
          throw new Error("PostgreSQL contact update evidence was not inserted exactly once");
        }
        return { outcome: "updated" as const, value };
      });
    },
  };
}
