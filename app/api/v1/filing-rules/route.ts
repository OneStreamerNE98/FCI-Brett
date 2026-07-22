import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_FILING_RULES } from "../../../lib/google-workspace";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { normalizeStoredFilingRule, validateFilingRuleCreate } from "../../../domain/filing-rule";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";

const MAX_RULE_BODY_BYTES = 8_000;

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const result = await env.DB.prepare("SELECT * FROM filing_rules ORDER BY priority ASC, created_at ASC").all();
  const storedRules = (result.results as Record<string, unknown>[]).map(normalizeStoredFilingRule);
  // Built-in rules must remain available after someone adds a custom policy.
  // Custom policies are appended; none can cause a Gmail write from this route.
  const builtInNames = new Set(DEFAULT_FILING_RULES.map((rule) => rule.name.toLowerCase()));
  const overrides = new Map(storedRules.filter((rule) => builtInNames.has(String(rule.name).toLowerCase())).map((rule) => [String(rule.name).toLowerCase(), rule]));
  const rules = [
    ...DEFAULT_FILING_RULES.map((rule) => ({ ...rule, ...overrides.get(rule.name.toLowerCase()) })),
    ...storedRules.filter((rule) => !builtInNames.has(String(rule.name).toLowerCase())),
  ].sort((left, right) => Number(left.priority) - Number(right.priority));
  return noStore({ rules });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_RULE_BODY_BYTES,
    invalidMessage: "Rule details must be valid JSON.",
    tooLargeMessage: "Rule details are too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const validation = validateFilingRuleCreate(parsed.body);
  if (!validation.ok) return noStore({ error: validation.error }, { status: 400 });

  await ensureWorkspaceSchema();
  const values = validation.values;
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO filing_rules (id, name, enabled, priority, match_summary, action, target_category, approval_required, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, values.name, values.enabled ? 1 : 0, values.priority, values.matchSummary, values.action, values.targetCategory, values.approvalRequired ? 1 : 0, auth.user.email, now, now).run();
  return noStore({ id, createdAt: now }, { status: 201 });
}
