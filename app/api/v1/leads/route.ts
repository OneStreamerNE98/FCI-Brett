import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1LeadRepository } from "../../../adapters/d1/lead-repository";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";
import {
  leadNumberFor,
  MAX_LEAD_BODY_BYTES,
  leadResponse,
  validateLeadValues,
} from "../../../domain/lead";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const repository = createD1LeadRepository(env.DB as unknown as D1Database);
  const leads = await repository.list();
  return NextResponse.json({ leads: leads.map(leadResponse) }, { headers: { "Cache-Control": "no-store" } });
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
  const leadNumber = leadNumberFor(id, new Date().getUTCFullYear());
  const now = Date.now();
  const repository = createD1LeadRepository(env.DB as unknown as D1Database);
  const result = await repository.create({
    lead: {
      id,
      lead_number: leadNumber,
      company: values.company,
      contact_name: values.contactName,
      contact_email: values.contactEmail,
      contact_phone: values.contactPhone,
      project_name: values.projectName,
      source: values.source,
      stage: values.stage,
      site: values.site,
      estimated_value: values.estimatedValue,
      next_action: values.nextAction,
      next_action_at: values.nextActionAt,
      owner_email: values.ownerEmail,
      status: values.status,
      created_by: auth.user.email,
      created_at: now,
      updated_at: now,
    },
    activity: {
      id: crypto.randomUUID(),
      recordId: id,
      action: "Lead created",
      actor: auth.user.email,
      detail: `${leadNumber} · ${values.company} · ${values.projectName}`,
      createdAt: now,
    },
  });
  if (result.outcome !== "created") {
    throw new Error(`D1 lead creation returned unexpected outcome ${result.outcome}`);
  }
  return NextResponse.json({ lead: leadResponse(result.value) }, { status: 201 });
}
