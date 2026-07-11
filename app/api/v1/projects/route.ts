import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets";

type ProjectBody = { clientId?: string; name?: string; status?: string; site?: string; projectManager?: string; estimatedValue?: number };

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  const clientId = request.nextUrl.searchParams.get("clientId");
  // Resolve links only from the active Google profile. A client/project can have a
  // personal test folder and a separate company production folder at the same time.
  const query = "SELECT p.id, p.project_number, p.client_id, p.name, p.status, p.site, p.project_manager, p.estimated_value, p.created_by, p.created_at, p.updated_at, c.name AS client_name, c.client_code, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'project' AND m.entity_id = p.id AND m.folder_key = 'project-root'" + (clientId ? " WHERE p.client_id = ?" : "") + " ORDER BY p.updated_at DESC";
  const statement = env.DB.prepare(query);
  const result = clientId ? await statement.bind(config.connectionKey, clientId).all() : await statement.bind(config.connectionKey).all();
  return NextResponse.json({ projects: result.results });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const body = await request.json() as ProjectBody;
  if (!body.clientId || !body.name?.trim()) return NextResponse.json({ error: "clientId and project name are required" }, { status: 400 });
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(body.clientId).first();
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });
  const now = Date.now();
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM projects").first<{ count: number }>();
  const projectNumber = `CF-${new Date().getUTCFullYear()}-${String((count?.count ?? 0) + 1).padStart(3, "0")}`;
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO projects (id, project_number, client_id, name, status, site, project_manager, estimated_value, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, projectNumber, body.clientId, body.name.trim(), body.status ?? "planning", body.site ?? null, body.projectManager ?? null, body.estimatedValue ?? null, auth.user.email, now, now).run();
  // A project changes both the Project Register and its parent client's active-project count.
  const sheetSync = await trySyncGoogleDirectory(getGoogleRuntimeConfig(), auth.user.email);
  return NextResponse.json({ id, projectNumber, createdAt: now, sheetSync }, { status: 201 });
}
