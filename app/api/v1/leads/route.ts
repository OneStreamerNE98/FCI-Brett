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
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { queueGoogleChatNotification } from "../../../lib/google-chat-notifier-sites";

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
  return NextResponse.json({ leads: result.value }, { headers: { "Cache-Control": "no-store" } });
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
  await ensureWorkspaceSchema();
  const result = await createLead(
    parsed.body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.leadsCreate],
    }),
    {
      repository: createD1LeadRepository(env.DB as unknown as D1Database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  if (!result.ok) {
    const status = result.kind === "forbidden" ? 403 : result.kind === "invalid" ? 400 : 409;
    return NextResponse.json({ error: result.message }, { status });
  }
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
  return NextResponse.json({ lead: result.value }, { status: 201 });
}
