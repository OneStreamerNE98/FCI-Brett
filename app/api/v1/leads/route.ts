import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { MAX_LEAD_BODY_BYTES, type LeadRow, leadResponse, validateLeadValues } from "../../../domain/lead";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const result = await env.DB.prepare("SELECT * FROM leads ORDER BY updated_at DESC, created_at DESC LIMIT 500").all<LeadRow>();
  return NextResponse.json({ leads: result.results.map(leadResponse) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_LEAD_BODY_BYTES,
    invalidMessage: "Lead details must be valid JSON.",
    tooLargeMessage: "Lead details are too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = { ...parsed.body, ownerEmail: parsed.body.ownerEmail ?? auth.user.email };
  const values = validateLeadValues(body);
  if (!values) return NextResponse.json({ error: "Enter a valid company, contact, project, source, stage, site, value, next action, owner email, and status." }, { status: 400 });

  await ensureWorkspaceSchema();
  const id = crypto.randomUUID();
  const leadNumber = `L-${new Date().getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO leads (id, lead_number, company, contact_name, contact_email, contact_phone, project_name, source, stage, site, estimated_value, next_action, next_action_at, owner_email, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, leadNumber, values.company, values.contactName, values.contactEmail, values.contactPhone, values.projectName, values.source, values.stage, values.site, values.estimatedValue, values.nextAction, values.nextActionAt, values.ownerEmail, values.status, auth.user.email, now, now),
    env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, "Lead created", auth.user.email, `${leadNumber} · ${values.company} · ${values.projectName}`, now),
  ]);
  const created = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first<LeadRow>();
  return NextResponse.json({ lead: leadResponse(created!) }, { status: 201 });
}
