import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets";

type ClientBody = { name?: string; industry?: string; status?: string; primaryContact?: { name?: string; email?: string; phone?: string; role?: string } };

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  // Folder links are profile-scoped. Never expose the legacy top-level link here,
  // because it may point at a personal test Drive after production is enabled.
  const result = await env.DB.prepare("SELECT c.id, c.client_code, c.name, c.status, c.industry, c.created_by, c.created_at, c.updated_at, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url, COUNT(p.id) AS project_count, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_name, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_email FROM clients c LEFT JOIN projects p ON p.client_id = c.id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'client' AND m.entity_id = c.id AND m.folder_key = 'client-root' GROUP BY c.id ORDER BY c.name ASC").bind(config.connectionKey).all();
  return NextResponse.json({ clients: result.results });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const body = await request.json() as ClientBody;
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "client name is required" }, { status: 400 });
  const now = Date.now();
  const id = crypto.randomUUID();
  const actor = auth.user.email;
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM clients").first<{ count: number }>();
  const clientCode = `CL-${String((count?.count ?? 0) + 1).padStart(4, "0")}`;
  const statements = [
    env.DB.prepare("INSERT INTO clients (id, client_code, name, status, industry, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, clientCode, name, body.status ?? "active", body.industry ?? null, actor, now, now),
  ];
  if (body.primaryContact?.name?.trim()) {
    statements.push(env.DB.prepare("INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(crypto.randomUUID(), id, body.primaryContact.name.trim(), body.primaryContact.email ?? null, body.primaryContact.phone ?? null, body.primaryContact.role ?? "Primary contact", now, now));
  }
  await env.DB.batch(statements);
  // The operational record is durable before any external write is attempted.
  // A Sheet failure is visible to the user but can never discard a new client.
  const sheetSync = await trySyncGoogleDirectory(getGoogleRuntimeConfig(), actor);
  return NextResponse.json({ id, clientCode, name, createdAt: now, sheetSync }, { status: 201 });
}
