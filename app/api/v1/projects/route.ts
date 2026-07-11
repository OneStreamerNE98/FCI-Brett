import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { actorFrom, ensureWorkspaceSchema } from "../_workspace-data";

type ProjectBody = { clientId?: string; name?: string; status?: string; site?: string; projectManager?: string; estimatedValue?: number };

export async function GET(request: NextRequest) {
  await ensureWorkspaceSchema();
  const clientId = request.nextUrl.searchParams.get("clientId");
  const query = "SELECT p.*, c.name AS client_name, c.client_code FROM projects p JOIN clients c ON c.id = p.client_id" + (clientId ? " WHERE p.client_id = ?" : "") + " ORDER BY p.updated_at DESC";
  const result = clientId ? await env.DB.prepare(query).bind(clientId).all() : await env.DB.prepare(query).all();
  return NextResponse.json({ projects: result.results });
}

export async function POST(request: NextRequest) {
  await ensureWorkspaceSchema();
  const body = await request.json() as ProjectBody;
  if (!body.clientId || !body.name?.trim()) return NextResponse.json({ error: "clientId and project name are required" }, { status: 400 });
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(body.clientId).first();
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });
  const now = Date.now();
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM projects").first<{ count: number }>();
  const projectNumber = `CF-${new Date().getUTCFullYear()}-${String((count?.count ?? 0) + 1).padStart(3, "0")}`;
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO projects (id, project_number, client_id, name, status, site, project_manager, estimated_value, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, projectNumber, body.clientId, body.name.trim(), body.status ?? "planning", body.site ?? null, body.projectManager ?? null, body.estimatedValue ?? null, actorFrom(request.headers), now, now).run();
  return NextResponse.json({ id, projectNumber, createdAt: now }, { status: 201 });
}
