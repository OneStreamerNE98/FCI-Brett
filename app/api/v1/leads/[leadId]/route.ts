import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { MAX_LEAD_BODY_BYTES, type LeadRow, leadResponse, validateLeadValues } from "../../../../domain/lead";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";

type RouteContext = { params: Promise<{ leadId: string }> };

const MUTABLE_KEYS = new Set(["company", "contactName", "contactEmail", "contactPhone", "projectName", "source", "stage", "site", "estimatedValue", "nextAction", "nextActionAt", "ownerEmail", "status"]);

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { leadId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(leadId)) return NextResponse.json({ error: "Invalid lead." }, { status: 400 });
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_LEAD_BODY_BYTES,
    invalidMessage: "Lead details must be valid JSON.",
    tooLargeMessage: "Lead details are too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const suppliedKeys = Object.keys(parsed.body);
  if (suppliedKeys.length === 0 || suppliedKeys.some((key) => !MUTABLE_KEYS.has(key))) {
    return NextResponse.json({ error: "Only supported lead fields can be updated." }, { status: 400 });
  }

  await ensureWorkspaceSchema();
  const current = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(leadId).first<LeadRow>();
  if (!current) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const currentValues: Record<string, unknown> = {
    company: current.company,
    contactName: current.contact_name,
    contactEmail: current.contact_email,
    contactPhone: current.contact_phone,
    projectName: current.project_name,
    source: current.source,
    stage: current.stage,
    site: current.site,
    estimatedValue: current.estimated_value,
    nextAction: current.next_action,
    nextActionAt: current.next_action_at,
    ownerEmail: current.owner_email,
    status: current.status,
  };
  const values = validateLeadValues({ ...currentValues, ...parsed.body });
  if (!values) return NextResponse.json({ error: "One or more lead fields are invalid." }, { status: 400 });

  const now = Date.now();
  const statements = [
    env.DB.prepare("UPDATE leads SET company = ?, contact_name = ?, contact_email = ?, contact_phone = ?, project_name = ?, source = ?, stage = ?, site = ?, estimated_value = ?, next_action = ?, next_action_at = ?, owner_email = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(values.company, values.contactName, values.contactEmail, values.contactPhone, values.projectName, values.source, values.stage, values.site, values.estimatedValue, values.nextAction, values.nextActionAt, values.ownerEmail, values.status, now, leadId),
  ];
  if (values.stage !== current.stage) {
    statements.push(env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), leadId, "Lead stage changed", auth.user.email, `${current.stage} → ${values.stage}`, now));
  }
  if (values.nextAction !== current.next_action || values.nextActionAt !== current.next_action_at) {
    const due = values.nextActionAt ? ` · due ${new Date(values.nextActionAt).toISOString()}` : "";
    statements.push(env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), leadId, "Lead next action changed", auth.user.email, `${values.nextAction}${due}`, now));
  }
  await env.DB.batch(statements);
  const updated = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(leadId).first<LeadRow>();
  return NextResponse.json({ lead: leadResponse(updated!) });
}
