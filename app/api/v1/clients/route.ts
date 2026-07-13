import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets";

type ClientBody = { name?: string; industry?: string; status?: string; primaryContact?: { name?: string; email?: string; phone?: string; role?: string } };
const CLIENT_STATUSES = new Set(["active", "prospect", "inactive", "archived"]);

async function readClientBody(request: NextRequest) {
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    const record = body as Record<string, unknown>;
    for (const field of ["name", "industry", "status"] as const) {
      if (record[field] !== undefined && typeof record[field] !== "string") throw new Error("invalid");
    }
    if (record.primaryContact !== undefined) {
      if (!record.primaryContact || typeof record.primaryContact !== "object" || Array.isArray(record.primaryContact)) throw new Error("invalid");
      const primaryContact = record.primaryContact as Record<string, unknown>;
      for (const field of ["name", "email", "phone", "role"] as const) {
        if (primaryContact[field] !== undefined && typeof primaryContact[field] !== "string") throw new Error("invalid");
      }
    }
    return { body: record as ClientBody };
  } catch {
    return { response: NextResponse.json({ error: "Client details must be valid JSON." }, { status: 400 }) };
  }
}

function isDuplicateClientError(error: unknown) {
  const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /UNIQUE constraint failed: clients\.(?:name|client_code)/i.test(detail);
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  // Folder links are connection-scoped so simulation and the live Shared Drive
  // can never expose each other's mappings.
  const result = await env.DB.prepare("SELECT c.id, c.client_code, c.name, c.status, c.industry, c.created_by, c.created_at, c.updated_at, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url, COUNT(p.id) AS project_count, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_name, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_email FROM clients c LEFT JOIN projects p ON p.client_id = c.id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'client' AND m.entity_id = c.id AND m.folder_key = 'client-root' GROUP BY c.id ORDER BY c.name ASC").bind(config.connectionKey).all();
  return NextResponse.json({ clients: result.results });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const parsed = await readClientBody(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "client name is required" }, { status: 400 });
  if (name.length > 180) return NextResponse.json({ error: "client name is too long" }, { status: 400 });
  const status = body.status?.trim().toLowerCase() || "active";
  if (!CLIENT_STATUSES.has(status)) return NextResponse.json({ error: "client status is invalid" }, { status: 400 });
  const now = Date.now();
  const id = crypto.randomUUID();
  const actor = auth.user.email;
  const clientCode = `CL-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const statements = [
    env.DB.prepare("INSERT INTO clients (id, client_code, name, status, industry, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1)").bind(id, clientCode, name, status, body.industry?.trim() || null, actor, now, now, name),
    env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?)").bind(crypto.randomUUID(), id, "Client created", actor, `${clientCode} · ${name}`, now, id),
  ];
  if (body.primaryContact?.name?.trim()) {
    statements.push(env.DB.prepare("INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?)").bind(crypto.randomUUID(), id, body.primaryContact.name.trim(), body.primaryContact.email ?? null, body.primaryContact.phone ?? null, body.primaryContact.role ?? "Primary contact", now, now, id));
  }
  try {
    const results = await env.DB.batch(statements);
    if (results[0].meta.changes !== 1) return NextResponse.json({ error: "A client with this business name already exists." }, { status: 409 });
  } catch (error) {
    if (isDuplicateClientError(error)) return NextResponse.json({ error: "A client with this business name already exists." }, { status: 409 });
    throw error;
  }
  // The operational record is durable before any external write is attempted.
  // A Sheet failure is visible to the user but can never discard a new client.
  const sheetSync = await trySyncGoogleDirectory(getGoogleRuntimeConfig(), actor);
  return NextResponse.json({ id, clientCode, name, createdAt: now, sheetSync }, { status: 201 });
}
