import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1LeadRepository } from "../../../../adapters/d1/lead-repository";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { MAX_LEAD_BODY_BYTES, leadResponse, validateLeadValues } from "../../../../domain/lead";
import type { LeadActivityIntent } from "../../../../ports/lead-repository";
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
  const repository = createD1LeadRepository(env.DB as unknown as D1Database);
  const current = await repository.findById(leadId);
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
  const activities: LeadActivityIntent[] = [];
  if (values.stage !== current.stage) {
    activities.push({
      id: crypto.randomUUID(),
      recordId: leadId,
      action: "Lead stage changed",
      actor: auth.user.email,
      detail: `${current.stage} → ${values.stage}`,
      createdAt: now,
    });
  }
  if (values.nextAction !== current.next_action || values.nextActionAt !== current.next_action_at) {
    const due = values.nextActionAt ? ` · due ${new Date(values.nextActionAt).toISOString()}` : "";
    activities.push({
      id: crypto.randomUUID(),
      recordId: leadId,
      action: "Lead next action changed",
      actor: auth.user.email,
      detail: `${values.nextAction}${due}`,
      createdAt: now,
    });
  }
  const result = await repository.update({
    leadId,
    values,
    updatedAt: now,
    updatedBy: auth.user.email,
    activities,
  });
  if (result.outcome === "lead-not-found") {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }
  return NextResponse.json({ lead: leadResponse(result.value) });
}
