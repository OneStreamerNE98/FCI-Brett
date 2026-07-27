import { CLIENT_STATUSES, type ClientStatus } from "../../domain/client-creation";
import type {
  ClientCreationIntent,
  ClientRepository,
  ClientRow,
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

async function currentClientVersion(database: D1Database, clientId: string) {
  const row = await database
    .prepare("SELECT version FROM clients WHERE id = ?")
    .bind(clientId)
    .first<{ version: unknown }>();
  return row ? d1RecordVersion(row.version, "D1 client version") : null;
}

function isDuplicateClientError(error: unknown) {
  const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /UNIQUE constraint failed: clients\.(?:name|client_code)/i.test(detail);
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

    async create(intent: ClientCreationIntent) {
      const { client, activity, primaryContact } = intent;
      const statements: D1PreparedStatement[] = [
        database.prepare("INSERT INTO clients (id, client_code, name, status, industry, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1)")
          .bind(client.id, client.clientCode, client.name, client.status, client.industry, client.createdBy, client.createdAt, client.updatedAt, client.name),
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
      const expectedVersion = d1RecordVersion(intent.expectedVersion, "Expected D1 client version");
      const resultingVersion = nextD1RecordVersion(expectedVersion);
      const { activity, values } = intent;
      const results = await database.batch([
        database.prepare("UPDATE clients SET name = ?, status = ?, industry = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
          .bind(
            values.name,
            values.status,
            values.industry,
            intent.updatedAt,
            intent.clientId,
            expectedVersion,
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
      if (results[0]?.meta.changes !== 1) {
        const currentVersion = await currentClientVersion(database, intent.clientId);
        return currentVersion
          ? { outcome: "conflict", currentVersion }
          : { outcome: "client-not-found" };
      }
      const updated = await database
        .prepare("SELECT id, client_code, name, status, industry, updated_at, version FROM clients WHERE id = ?")
        .bind(intent.clientId)
        .first<D1ClientRow>();
      if (!updated) throw new Error("D1 client update did not return the updated client");
      return { outcome: "updated", value: clientRow(updated) };
    },
  };
}
