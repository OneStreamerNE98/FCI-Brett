import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_FILING_RULES } from "../../../lib/google-workspace";
import { actorFrom, ensureWorkspaceSchema } from "../_workspace-data";

type RuleBody = { name?: string; enabled?: boolean; priority?: number; matchSummary?: string; action?: "suggest" | "review" | "ignore"; targetCategory?: string; approvalRequired?: boolean };

export async function GET() {
  await ensureWorkspaceSchema();
  const result = await env.DB.prepare("SELECT * FROM filing_rules ORDER BY priority ASC, created_at ASC").all();
  const rules = result.results.length ? result.results.map((row) => ({ ...row, enabled: Boolean(row.enabled), approvalRequired: Boolean(row.approval_required) })) : DEFAULT_FILING_RULES;
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  await ensureWorkspaceSchema();
  const body = await request.json() as RuleBody;
  if (!body.name?.trim() || !body.matchSummary?.trim() || !body.action || !body.targetCategory?.trim()) return NextResponse.json({ error: "name, matching criteria, action, and destination are required" }, { status: 400 });
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO filing_rules (id, name, enabled, priority, match_summary, action, target_category, approval_required, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, body.name.trim(), body.enabled === false ? 0 : 1, body.priority ?? 99, body.matchSummary.trim(), body.action, body.targetCategory.trim(), body.approvalRequired === false ? 0 : 1, actorFrom(request.headers), now, now).run();
  return NextResponse.json({ id, createdAt: now }, { status: 201 });
}
