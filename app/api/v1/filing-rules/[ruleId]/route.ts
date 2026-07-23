import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1FilingRuleRepository } from "../../../../adapters/d1/filing-rule-repository";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { validateFilingRulePatch } from "../../../../domain/filing-rule";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";

const MAX_RULE_BODY_BYTES = 8_000;

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { ruleId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ruleId)) return noStore({ error: "Invalid rule identifier." }, { status: 400 });
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_RULE_BODY_BYTES,
    invalidMessage: "Send a valid rule update.",
    tooLargeMessage: "Rule update is too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const validation = validateFilingRulePatch(parsed.body);
  if (!validation.ok) return noStore({ error: validation.error }, { status: 400 });

  if (!Object.keys(validation.values).length) return noStore({ error: "Choose at least one rule value to update." }, { status: 400 });
  const now = Date.now();
  const repository = createD1FilingRuleRepository(env.DB as unknown as D1Database);
  const updated = await repository.update({ id: ruleId, values: validation.values, updatedAt: now });
  if (!updated) return noStore({ error: "Rule not found." }, { status: 404 });
  return noStore({ updated: true, updatedAt: now });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { ruleId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ruleId)) return noStore({ error: "Invalid rule identifier." }, { status: 400 });
  const repository = createD1FilingRuleRepository(env.DB as unknown as D1Database);
  if (!await repository.delete(ruleId)) return noStore({ error: "Rule not found." }, { status: 404 });
  return noStore({ deleted: true });
}
