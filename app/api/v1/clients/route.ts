import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { actorFrom, ensureWorkspaceSchema } from "../_workspace-data";

type ClientBody = { name?: string; industry?: string; status?: string; primaryContact?: { name?: string; email?: string; phone?: string; role?: string } };

export async function GET() {
  await ensureWorkspaceSchema();
  const result = await env.DB.prepare("SELECT c.*, COUNT(p.id) AS project_count, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_name, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_email FROM clients c LEFT JOIN projects p ON p.client_id = c.id GROUP BY c.id ORDER BY c.name ASC").all();
  return NextResponse.json({ clients: result.results });
}

export async function POST(request: NextRequest) {
  await ensureWorkspaceSchema();
  const body = await request.json() as ClientBody;
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "client name is required" }, { status: 400 });
  const now = Date.now();
  const id = crypto.randomUUID();
  const actor = actorFrom(request.headers);
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM clients").first<{ count: number }>();
  const clientCode = `CL-${String((count?.count ?? 0) + 1).padStart(4, "0")}`;
  const statements = [
    env.DB.prepare("INSERT INTO clients (id, client_code, name, status, industry, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, clientCode, name, body.status ?? "active", body.industry ?? null, actor, now, now),
  ];
  if (body.primaryContact?.name?.trim()) {
    statements.push(env.DB.prepare("INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(crypto.randomUUID(), id, body.primaryContact.name.trim(), body.primaryContact.email ?? null, body.primaryContact.phone ?? null, body.primaryContact.role ?? "Primary contact", now, now));
  }
  await env.DB.batch(statements);
  return NextResponse.json({ id, clientCode, name, createdAt: now }, { status: 201 });
}
