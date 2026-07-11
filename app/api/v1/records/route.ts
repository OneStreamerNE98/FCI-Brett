import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";

async function ensureSchema() {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT NOT NULL, project_id TEXT, status TEXT NOT NULL DEFAULT 'active', payload TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS records_type_idx ON records(type, updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS activity_events (id TEXT PRIMARY KEY, record_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)"),
  ]);
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureSchema();
  const type = request.nextUrl.searchParams.get("type") ?? "lead";
  const result = await env.DB.prepare("SELECT * FROM records WHERE type = ? ORDER BY updated_at DESC LIMIT 100").bind(type).all();
  return NextResponse.json({ records: result.results.map((row) => ({ ...row, payload: JSON.parse(String(row.payload)) })) });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureSchema();
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
