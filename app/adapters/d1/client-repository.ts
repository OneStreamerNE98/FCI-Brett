import type { ClientCreationIntent, ClientRepository } from "../../ports/client-repository";
import type { D1Database, D1PreparedStatement } from "./d1-database";

function isDuplicateClientError(error: unknown) {
  const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /UNIQUE constraint failed: clients\.(?:name|client_code)/i.test(detail);
}

export function createD1ClientRepository(database: D1Database): ClientRepository {
  return {
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
  };
}
