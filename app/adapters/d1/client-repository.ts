import { CLIENT_STATUSES, type ClientStatus } from "../../domain/client-creation";
import { normalizeClientNameKey } from "../../domain/client-name-key";
import type {
  ClientCreationIntent,
  ClientRepository,
  ClientRow,
  ContactRow,
} from "../../ports/client-repository";
import type { D1Database, D1PreparedStatement } from "./d1-database";
import { d1RecordVersion, nextD1RecordVersion } from "./record-version.ts";

type D1ClientRow = {
  id: string;
  client_code: string;
  name: string;
  status: string;
  industry: string | null;
  updated_at: number;
  version: unknown;
};

type D1ContactRow = {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_primary: unknown;
  updated_at: number;
  version: unknown;
};

function clientRow(row: D1ClientRow): ClientRow {
  if (!CLIENT_STATUSES.includes(row.status as ClientStatus)) {
    throw new Error("D1 client status is unsupported.");
  }
  return {
    id: row.id,
    clientCode: row.client_code,
    name: row.name,
    status: row.status as ClientStatus,
    industry: row.industry,
    updatedAt: row.updated_at,
    version: d1RecordVersion(row.version, "D1 client version"),
  };
}

function contactRow(row: D1ContactRow): ContactRow {
  if (
    typeof row.id !== "string"
    || typeof row.client_id !== "string"
    || typeof row.name !== "string"
    || row.email !== null && typeof row.email !== "string"
    || row.phone !== null && typeof row.phone !== "string"
    || typeof row.role !== "string"
    || !Number.isSafeInteger(row.updated_at)
  ) {
    throw new Error("D1 contact row is invalid.");
  }
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isPrimary: row.is_primary === true || row.is_primary === 1,
    updatedAt: row.updated_at,
    version: d1RecordVersion(row.version, "D1 contact version"),
  };
}

async function currentClientVersion(database: D1Database, clientId: string) {
  const row = await database
    .prepare("SELECT version FROM clients WHERE id = ?")
    .bind(clientId)
    .first<{ version: unknown }>();
  return row ? d1RecordVersion(row.version, "D1 client version") : null;
}

async function duplicateClientName(
  database: D1Database,
  clientId: string | null,
  name: string,
) {
  const statement = clientId
    ? database
        .prepare("SELECT id, name FROM clients WHERE id <> ?")
        .bind(clientId)
    : database.prepare("SELECT id, name FROM clients");
  const rows = await statement.all<{ id: string; name: string }>();
  const candidateKey = normalizeClientNameKey(name);
  return rows.results.some((row) => (
    typeof row.id === "string"
    && typeof row.name === "string"
    && normalizeClientNameKey(row.name) === candidateKey
  ));
}

async function currentContactVersion(database: D1Database, contactId: string) {
  const row = await database
    .prepare("SELECT version FROM contacts WHERE id = ?")
    .bind(contactId)
    .first<{ version: unknown }>();
  return row ? d1RecordVersion(row.version, "D1 contact version") : null;
}

function isDuplicateClientError(error: unknown) {
  const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /UNIQUE constraint failed: clients\.(?:name|normalized_name_key|client_code)/i.test(detail);
}

function assertD1ClientUpdateIntent(
  intent: Parameters<ClientRepository["update"]>[0],
) {
  if (
    intent.activity.recordId !== intent.clientId
    || intent.activity.actor !== intent.updatedBy
    || intent.activity.createdAt !== intent.updatedAt
    || !intent.updatedBy.trim()
    || !Number.isSafeInteger(intent.updatedAt)
  ) {
    throw new TypeError("D1 client update evidence must match the client and actor");
  }
}

function assertD1ContactUpdateIntent(
  intent: Parameters<ClientRepository["updateContact"]>[0],
) {
  if (
    intent.activity.actor !== intent.updatedBy
    || intent.activity.createdAt !== intent.updatedAt
    || !intent.updatedBy.trim()
    || !Number.isSafeInteger(intent.updatedAt)
  ) {
    throw new TypeError("D1 contact update evidence must match the actor and timestamp");
  }
}

export function createD1ClientRepository(database: D1Database): ClientRepository {
  return {
    async findById(clientId) {
      const row = await database
        .prepare("SELECT id, client_code, name, status, industry, updated_at, version FROM clients WHERE id = ?")
        .bind(clientId)
        .first<D1ClientRow>();
      return row ? clientRow(row) : null;
    },

    async findContactById(contactId) {
      const row = await database
        .prepare("SELECT id, client_id, name, email, phone, role, is_primary, updated_at, version FROM contacts WHERE id = ?")
        .bind(contactId)
        .first<D1ContactRow>();
      return row ? contactRow(row) : null;
    },

    async create(intent: ClientCreationIntent) {
      const { client, activity, primaryContact } = intent;
      if (await duplicateClientName(database, null, client.name)) {
        return { outcome: "duplicate" };
      }
      const normalizedNameKey = normalizeClientNameKey(client.name);
      const statements: D1PreparedStatement[] = [
        database.prepare("INSERT INTO clients (id, client_code, name, normalized_name_key, status, industry, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1)")
          .bind(client.id, client.clientCode, client.name, normalizedNameKey, client.status, client.industry, client.createdBy, client.createdAt, client.updatedAt, client.name),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND client_code = ? AND name = ? AND created_by = ? AND created_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, client.id, client.clientCode, client.name, client.createdBy, client.createdAt),
      ];
      if (primaryContact) {
        statements.push(
          database.prepare("INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND client_code = ? AND name = ? AND created_by = ? AND created_at = ?)")
            .bind(primaryContact.id, primaryContact.clientId, primaryContact.name, primaryContact.email, primaryContact.phone, primaryContact.role, primaryContact.createdAt, primaryContact.updatedAt, client.id, client.clientCode, client.name, client.createdBy, client.createdAt),
        );
      }

      try {
        const results = await database.batch(statements);
        return results[0]?.meta.changes === 1 ? { outcome: "created" } : { outcome: "duplicate" };
      } catch (error) {
        if (isDuplicateClientError(error)) return { outcome: "duplicate" };
        throw error;
      }
    },

    async update(intent) {
      assertD1ClientUpdateIntent(intent);
      const expectedVersion = d1RecordVersion(intent.expectedVersion, "Expected D1 client version");
      const resultingVersion = nextD1RecordVersion(expectedVersion);
      const { activity, values } = intent;
      if (await duplicateClientName(database, intent.clientId, values.name)) {
        const existingVersion = await currentClientVersion(database, intent.clientId);
        if (!existingVersion) return { outcome: "client-not-found" };
        if (existingVersion !== expectedVersion) {
          return { outcome: "conflict", currentVersion: existingVersion };
        }
        return { outcome: "duplicate" };
      }
      let results;
      try {
        results = await database.batch([
          database.prepare("UPDATE clients SET name = ?, normalized_name_key = ?, status = ?, industry = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM clients AS duplicate WHERE duplicate.id <> ? AND LOWER(duplicate.name) = LOWER(?) LIMIT 1)")
            .bind(
              values.name,
              normalizeClientNameKey(values.name),
              values.status,
              values.industry,
              intent.updatedAt,
              intent.clientId,
              expectedVersion,
              intent.clientId,
              values.name,
            ),
          database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM clients WHERE id = ? AND version = ? AND updated_at = ?)")
            .bind(
              activity.id,
              activity.recordId,
              activity.action,
              activity.actor,
              activity.detail,
              activity.createdAt,
              intent.clientId,
              resultingVersion,
              intent.updatedAt,
            ),
        ]);
      } catch (error) {
        if (isDuplicateClientError(error)) return { outcome: "duplicate" };
        throw error;
      }
      if (results[0]?.meta.changes !== 1) {
        const currentVersion = await currentClientVersion(database, intent.clientId);
        if (!currentVersion) return { outcome: "client-not-found" };
        if (currentVersion !== expectedVersion) {
          return { outcome: "conflict", currentVersion };
        }
        if (await duplicateClientName(database, intent.clientId, values.name)) {
          return { outcome: "duplicate" };
        }
        return { outcome: "conflict", currentVersion };
      }
      const updated = await database
        .prepare("SELECT id, client_code, name, status, industry, updated_at, version FROM clients WHERE id = ?")
        .bind(intent.clientId)
        .first<D1ClientRow>();
      if (!updated) throw new Error("D1 client update did not return the updated client");
      return { outcome: "updated", value: clientRow(updated) };
    },

    async updateContact(intent) {
      assertD1ContactUpdateIntent(intent);
      const expectedVersion = d1RecordVersion(intent.expectedVersion, "Expected D1 contact version");
      const resultingVersion = nextD1RecordVersion(expectedVersion);
      const { activity, values } = intent;
      const results = await database.batch([
        database.prepare("UPDATE contacts SET name = ?, email = ?, phone = ?, role = ?, updated_at = ?, version = version + 1 WHERE id = ? AND client_id = ? AND version = ?")
          .bind(
            values.name,
            values.email,
            values.phone,
            values.role,
            intent.updatedAt,
            intent.contactId,
            activity.recordId,
            expectedVersion,
          ),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM contacts WHERE id = ? AND client_id = ? AND version = ? AND updated_at = ?)")
          .bind(
            activity.id,
            activity.recordId,
            activity.action,
            activity.actor,
            activity.detail,
            activity.createdAt,
            intent.contactId,
            activity.recordId,
            resultingVersion,
            intent.updatedAt,
          ),
      ]);
      if (results[0]?.meta.changes !== 1) {
        const currentVersion = await currentContactVersion(database, intent.contactId);
        return currentVersion
          ? { outcome: "conflict", currentVersion }
          : { outcome: "contact-not-found" };
      }
      const updated = await database
        .prepare("SELECT id, client_id, name, email, phone, role, is_primary, updated_at, version FROM contacts WHERE id = ?")
        .bind(intent.contactId)
        .first<D1ContactRow>();
      if (!updated) throw new Error("D1 contact update did not return the updated contact");
      return { outcome: "updated", value: contactRow(updated) };
    },
  };
}
