import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets";

type ProjectBody = { clientId?: string; name?: string; status?: string; site?: string; projectManager?: string; estimatedValue?: number };
const PROJECT_STATUSES = new Set(["planning", "mobilizing", "installation", "closeout", "completed", "cancelled", "archived"]);

async function readProjectBody(request: NextRequest) {
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    const record = body as Record<string, unknown>;
    for (const field of ["clientId", "name", "status", "site", "projectManager"] as const) {
      if (record[field] !== undefined && typeof record[field] !== "string") throw new Error("invalid");
    }
    if (record.estimatedValue !== undefined && typeof record.estimatedValue !== "number") throw new Error("invalid");
    return { body: record as ProjectBody };
  } catch {
    return { response: NextResponse.json({ error: "Project details must be valid JSON." }, { status: 400 }) };
  }
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  const clientId = request.nextUrl.searchParams.get("clientId");
  // Resolve links only from the active provider. Simulation and the company
  // Shared Drive keep independent mappings for the same project.
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
  const parsed = await readProjectBody(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  if (!body.clientId || !body.name?.trim()) return NextResponse.json({ error: "clientId and project name are required" }, { status: 400 });
  const name = body.name.trim();
  if (name.length > 180) return NextResponse.json({ error: "project name is too long" }, { status: 400 });
  const status = body.status?.trim().toLowerCase() || "planning";
  if (!PROJECT_STATUSES.has(status)) return NextResponse.json({ error: "project status is invalid" }, { status: 400 });
  if (body.estimatedValue !== undefined && (!Number.isSafeInteger(body.estimatedValue) || body.estimatedValue < 0)) return NextResponse.json({ error: "estimated value must be a non-negative whole number" }, { status: 400 });
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(body.clientId).first();
  if (!client) return NextResponse.json({ error: "client not found" }, { status: 404 });
  const now = Date.now();
  const id = crypto.randomUUID();
  const projectNumber = `CF-${new Date().getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO projects (id, project_number, client_id, name, status, site, project_manager, estimated_value, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, projectNumber, body.clientId, name, status, body.site?.trim() || null, body.projectManager?.trim() || null, body.estimatedValue ?? null, auth.user.email, now, now),
    env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "Project created", auth.user.email, `${projectNumber} · ${name}`, now),
  ]);
  // A project changes both the Project Register and its parent client's active-project count.
  const sheetSync = await trySyncGoogleDirectory(getGoogleRuntimeConfig(), auth.user.email);
  return NextResponse.json({ id, projectNumber, createdAt: now, sheetSync }, { status: 201 });
}
