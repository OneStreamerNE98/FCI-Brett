import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const type = request.nextUrl.searchParams.get("type") ?? "lead";
  const result = await env.DB.prepare("SELECT * FROM records WHERE type = ? ORDER BY updated_at DESC LIMIT 100").bind(type).all();
  return NextResponse.json({ records: result.results.map((row) => ({ ...row, payload: JSON.parse(String(row.payload)) })) });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const body = await request.json() as { type?: string; projectId?: string; status?: string; payload?: unknown };
  if (!body.type || !body.payload) return NextResponse.json({ error: "type and payload are required" }, { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const actor = auth.user.email;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO records (id, type, project_id, status, payload, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, body.type, body.projectId ?? null, body.status ?? "active", JSON.stringify(body.payload), actor, now, now),
    env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, "created", actor, `${body.type} created`, now),
  ]);
  return NextResponse.json({ id, createdAt: now }, { status: 201 });
}
