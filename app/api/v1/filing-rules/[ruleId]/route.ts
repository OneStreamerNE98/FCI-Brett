import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { validateFilingRulePatch } from "../../../../domain/filing-rule";

export async function PATCH(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { ruleId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ruleId)) return NextResponse.json({ error: "Invalid rule identifier." }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Send a valid rule update." }, { status: 400 });
  const validation = validateFilingRulePatch(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const sets: string[] = [];
  const values: unknown[] = [];
  if (validation.values.enabled !== undefined) { sets.push("enabled = ?"); values.push(validation.values.enabled ? 1 : 0); }
  if (validation.values.priority !== undefined) { sets.push("priority = ?"); values.push(validation.values.priority); }
  if (validation.values.name !== undefined) { sets.push("name = ?"); values.push(validation.values.name); }
  if (validation.values.matchSummary !== undefined) { sets.push("match_summary = ?"); values.push(validation.values.matchSummary); }
  if (validation.values.targetCategory !== undefined) { sets.push("target_category = ?"); values.push(validation.values.targetCategory); }
  if (validation.values.action !== undefined) { sets.push("action = ?"); values.push(validation.values.action); }
  if (!sets.length) return NextResponse.json({ error: "Choose at least one rule value to update." }, { status: 400 });
  const now = Date.now();
  sets.push("updated_at = ?"); values.push(now, ruleId);
  const result = await env.DB.prepare(`UPDATE filing_rules SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
  if (result.meta.changes !== 1) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  return NextResponse.json({ updated: true, updatedAt: now });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { ruleId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ruleId)) return NextResponse.json({ error: "Invalid rule identifier." }, { status: 400 });
  const result = await env.DB.prepare("DELETE FROM filing_rules WHERE id = ?").bind(ruleId).run();
  if (result.meta.changes !== 1) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
