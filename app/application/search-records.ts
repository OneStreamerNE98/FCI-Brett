import type { D1Database } from "../adapters/d1/d1-database";

export type SearchResult = {
  kind: "client" | "project" | "contact";
  id: string;
  title: string;
  subtitle: string;
  clientId?: string;
  projectId?: string;
};

export function normalizeSearchQuery(value: string | null) {
  const query = value?.trim().replace(/\s+/g, " ") ?? "";
  if (query.length < 2) return null;
  if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new Error("Search terms must be between 2 and 100 characters.");
  }
  return query;
}

function likeQuery(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function searchRecords(database: D1Database, query: string) {
  const match = likeQuery(query);
  const [clients, projects, contacts] = await Promise.all([
    database.prepare("SELECT id, client_code, name FROM clients WHERE name LIKE ? ESCAPE '\\' OR client_code LIKE ? ESCAPE '\\' ORDER BY name ASC LIMIT 8").bind(match, match).all<{ id: string; client_code: string; name: string }>(),
    database.prepare("SELECT p.id, p.client_id, p.project_number, p.name, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.name LIKE ? ESCAPE '\\' OR p.project_number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' ORDER BY p.updated_at DESC LIMIT 8").bind(match, match, match).all<{ id: string; client_id: string; project_number: string; name: string; client_name: string }>(),
    database.prepare("SELECT ct.id, ct.client_id, ct.name, ct.email, c.name AS client_name FROM contacts ct JOIN clients c ON c.id = ct.client_id WHERE ct.name LIKE ? ESCAPE '\\' OR ct.email LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' ORDER BY ct.name ASC LIMIT 8").bind(match, match, match).all<{ id: string; client_id: string; name: string; email: string | null; client_name: string }>(),
  ]);
  const results: SearchResult[] = [
    ...projects.results.map((row) => ({
      kind: "project" as const,
      id: row.id,
      projectId: row.id,
      clientId: row.client_id,
      title: `${row.project_number} — ${row.name}`,
      subtitle: row.client_name,
    })),
    ...clients.results.map((row) => ({
      kind: "client" as const,
      id: row.id,
      clientId: row.id,
      title: row.name,
      subtitle: row.client_code,
    })),
    ...contacts.results.map((row) => ({
      kind: "contact" as const,
      id: row.id,
      clientId: row.client_id,
      title: row.name,
      subtitle: `${row.client_name}${row.email ? ` · ${row.email}` : ""}`,
    })),
  ].slice(0, 20);
  return results;
}
