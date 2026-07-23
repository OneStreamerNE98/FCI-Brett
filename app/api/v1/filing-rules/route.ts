import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1FilingRuleRepository } from "../../../adapters/d1/filing-rule-repository";
import { DEFAULT_FILING_RULES } from "../../../lib/google-workspace";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { validateFilingRuleCreate } from "../../../domain/filing-rule";
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
  const repository = createD1FilingRuleRepository(env.DB as unknown as D1Database);
  const storedRules = await repository.list();
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
  const repository = createD1FilingRuleRepository(env.DB as unknown as D1Database);
  await repository.create({
    id,
    values,
    createdBy: auth.user.email,
    createdAt: now,
  });
  return noStore({ id, createdAt: now }, { status: 201 });
}
