import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1LeadRepository } from "../../../adapters/d1/lead-repository";
import { createLead, listLeads } from "../../../application/lead-operations";
import { creationAuthorizationFor } from "../../../application/creation-authorization";
import { AUTHORIZATION_CAPABILITIES } from "../../../application/authorization-capabilities";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { MAX_LEAD_BODY_BYTES } from "../../../domain/lead";
import { parseLeadCreationRequest } from "../../../domain/lead-creation-request";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { queueGoogleChatNotification } from "../../../lib/google-chat-notifier-sites";
import { getConnectionScope } from "../../../lib/google-oauth-sites";
import {
  authorizedLeadOwnerEmail,
  authorizedLeadPayload,
} from "../../../lib/authorized-lead-response";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const repository = createD1LeadRepository(env.DB as unknown as D1Database);
  const result = await listLeads(
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.recordsRead],
    }),
    repository,
  );
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 403 });
  return NextResponse.json(
    {
      leads: result.value.map((lead) =>
        authorizedLeadPayload(lead, auth.user.email)
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  const leadRequest = parseLeadCreationRequest(parsed.body);
  if (!leadRequest.ok) return NextResponse.json({ error: leadRequest.error }, { status: 400 });
  if (leadRequest.formLeadReview) {
    const admin = requireOfficeUser(request, { admin: true });
    if ("response" in admin) return admin.response;
  }
  if (
    Object.hasOwn(leadRequest.body, "ownerEmail")
    && leadRequest.body.ownerEmail !== null
    && (
      typeof leadRequest.body.ownerEmail !== "string"
      || !authorizedLeadOwnerEmail(leadRequest.body.ownerEmail, auth.user.email)
    )
  ) {
    return NextResponse.json(
      { error: "Lead owner must be a current authorized office identity." },
      { status: 400 },
    );
  }
  await ensureWorkspaceSchema();
  const result = await createLead(
    leadRequest.body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.leadsCreate],
    }),
    {
      repository: createD1LeadRepository(env.DB as unknown as D1Database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
      ...(leadRequest.formLeadReview
        ? {
            formLeadReview: {
              id: leadRequest.formLeadReview.id,
              connectionKey: getConnectionScope().connectionKey,
            },
          }
        : {}),
    },
  );
  if (!result.ok) {
    const status = result.kind === "forbidden" ? 403 : result.kind === "invalid" ? 400 : 409;
    return NextResponse.json({
      error: result.message,
      ...(result.kind === "review-not-found"
        ? { code: "form_lead_review_not_found" }
        : {}),
    }, { status });
  }
  if (result.formLeadReview?.replayed !== true) {
    queueGoogleChatNotification(
      {
        eventType: "lead.created",
        entityId: result.value.id,
        leadNumber: result.value.leadNumber,
        company: result.value.company,
        projectName: result.value.projectName,
      },
      auth.user.email,
      request.nextUrl.origin,
    );
  }
  return NextResponse.json(
    {
      lead: authorizedLeadPayload(result.value, auth.user.email),
      ...(result.formLeadReview
        ? {
            formLeadReview: {
              id: result.formLeadReview.id,
              status: result.formLeadReview.status,
            },
          }
        : {}),
    },
    { status: 201 },
  );
}
