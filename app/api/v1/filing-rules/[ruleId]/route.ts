import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
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

  const sets: string[] = [];
  const values: unknown[] = [];
  if (validation.values.enabled !== undefined) { sets.push("enabled = ?"); values.push(validation.values.enabled ? 1 : 0); }
  if (validation.values.priority !== undefined) { sets.push("priority = ?"); values.push(validation.values.priority); }
  if (validation.values.name !== undefined) { sets.push("name = ?"); values.push(validation.values.name); }
  if (validation.values.matchSummary !== undefined) { sets.push("match_summary = ?"); values.push(validation.values.matchSummary); }
  if (validation.values.targetCategory !== undefined) { sets.push("target_category = ?"); values.push(validation.values.targetCategory); }
  if (validation.values.action !== undefined) { sets.push("action = ?"); values.push(validation.values.action); }
  if (!sets.length) return noStore({ error: "Choose at least one rule value to update." }, { status: 400 });
  const now = Date.now();
  sets.push("updated_at = ?"); values.push(now, ruleId);
  const result = await env.DB.prepare(`UPDATE filing_rules SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
  if (result.meta.changes !== 1) return noStore({ error: "Rule not found." }, { status: 404 });
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
  const result = await env.DB.prepare("DELETE FROM filing_rules WHERE id = ?").bind(ruleId).run();
  if (result.meta.changes !== 1) return noStore({ error: "Rule not found." }, { status: 404 });
  return noStore({ deleted: true });
}
