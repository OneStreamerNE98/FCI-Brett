import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_FILING_RULES } from "../../../lib/google-workspace";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";

type RuleBody = { name?: string; enabled?: boolean; priority?: number; matchSummary?: string; action?: "suggest" | "review" | "ignore"; targetCategory?: string; approvalRequired?: boolean };

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const result = await env.DB.prepare("SELECT * FROM filing_rules ORDER BY priority ASC, created_at ASC").all();
  const storedRules = result.results.map((row) => ({ ...row, enabled: Boolean(row.enabled), approvalRequired: Boolean(row.approval_required) }));
  // Built-in rules must remain available after someone adds a custom policy.
  // Custom policies are appended; none can cause a Gmail write from this route.
  const builtInNames = new Set(DEFAULT_FILING_RULES.map((rule) => rule.name.toLowerCase()));
  const overrides = new Map(storedRules.filter((rule) => builtInNames.has(String(rule.name).toLowerCase())).map((rule) => [String(rule.name).toLowerCase(), rule]));
  const rules = [
    ...DEFAULT_FILING_RULES.map((rule) => ({ ...rule, ...overrides.get(rule.name.toLowerCase()) })),
    ...storedRules.filter((rule) => !builtInNames.has(String(rule.name).toLowerCase())),
  ].sort((left, right) => Number(left.priority) - Number(right.priority));
  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const body = await request.json() as RuleBody;
  if (!body.name?.trim() || !body.matchSummary?.trim() || !body.action || !body.targetCategory?.trim()) return NextResponse.json({ error: "name, matching criteria, action, and destination are required" }, { status: 400 });
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO filing_rules (id, name, enabled, priority, match_summary, action, target_category, approval_required, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, body.name.trim(), body.enabled === false ? 0 : 1, body.priority ?? 99, body.matchSummary.trim(), body.action, body.targetCategory.trim(), body.approvalRequired === false ? 0 : 1, auth.user.email, now, now).run();
  return NextResponse.json({ id, createdAt: now }, { status: 201 });
}
