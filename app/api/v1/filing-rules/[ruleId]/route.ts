import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";

type RulePatch = { enabled?: unknown; priority?: unknown; name?: unknown; matchSummary?: unknown; action?: unknown; targetCategory?: unknown };

function ruleText(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!text || text.length > maximum) throw new Error(`${name} is required and must be ${maximum} characters or fewer.`);
  return text;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { ruleId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ruleId)) return NextResponse.json({ error: "Invalid rule identifier." }, { status: 400 });
  const body = await request.json().catch(() => null) as RulePatch | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Send a valid rule update." }, { status: 400 });

  const sets: string[] = [];
  const values: unknown[] = [];
  try {
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw new Error("enabled must be true or false.");
      sets.push("enabled = ?"); values.push(body.enabled ? 1 : 0);
    }
    if (body.priority !== undefined) {
      const priority = Number(body.priority);
      if (!Number.isInteger(priority) || priority < 1 || priority > 999) throw new Error("priority must be between 1 and 999.");
      sets.push("priority = ?"); values.push(priority);
    }
    if (body.name !== undefined) { sets.push("name = ?"); values.push(ruleText(body.name, "name", 120)); }
    if (body.matchSummary !== undefined) { sets.push("match_summary = ?"); values.push(ruleText(body.matchSummary, "matching criteria", 600)); }
    if (body.targetCategory !== undefined) { sets.push("target_category = ?"); values.push(ruleText(body.targetCategory, "destination", 160)); }
    if (body.action !== undefined) {
      if (body.action !== "suggest" && body.action !== "review" && body.action !== "ignore") throw new Error("Choose suggest, review, or ignore.");
      sets.push("action = ?"); values.push(body.action);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rule update is invalid." }, { status: 400 });
  }
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
