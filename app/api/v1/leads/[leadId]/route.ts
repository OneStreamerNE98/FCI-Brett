import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1LeadRepository } from "../../../../adapters/d1/lead-repository";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import {
  MAX_LEAD_BODY_BYTES,
  LEAD_PATCH_KEYS,
  leadValues,
  leadResponse,
  mergeLeadPatch,
  normalizeLeadPatch,
  type ValidatedLeadValues,
} from "../../../../domain/lead";
import type { LeadActivityIntent } from "../../../../ports/lead-repository";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { noStoreJson as noStore } from "../../../../lib/no-store-json";

type RouteContext = { params: Promise<{ leadId: string }> };

const LEAD_ACTIVITY_ACTIONS = {
  company: "Lead company changed",
  contactName: "Lead contact name changed",
  contactEmail: "Lead contact email changed",
  contactPhone: "Lead contact phone changed",
  projectName: "Lead project name changed",
  source: "Lead source changed",
  stage: "Lead stage changed",
  site: "Lead site changed",
  estimatedValue: "Lead estimated value changed",
  nextAction: "Lead next action changed",
  nextActionAt: "Lead next action due date changed",
  ownerEmail: "Lead owner changed",
  status: "Lead status changed",
} as const satisfies Record<keyof ValidatedLeadValues, LeadActivityIntent["action"]>;

const MUTABLE_KEYS = new Set<keyof ValidatedLeadValues>(LEAD_PATCH_KEYS);

function leadActivityValue(key: keyof ValidatedLeadValues, value: string | number | null) {
  if (value === null) return "Not set";
  if (key === "nextActionAt") return new Date(value as number).toISOString();
  return String(value);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { leadId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(leadId)) return noStore({ error: "Invalid lead." }, { status: 400 });
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_LEAD_BODY_BYTES,
    invalidMessage: "Lead details must be valid JSON.",
    tooLargeMessage: "Lead details are too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const normalized = normalizeLeadPatch(parsed.body);
  if (!normalized.ok) return noStore({ error: normalized.message }, { status: 400 });

  await ensureWorkspaceSchema();
  const repository = createD1LeadRepository(env.DB as unknown as D1Database);
  const current = await repository.findById(leadId);
  if (!current) return noStore({ error: "Lead not found." }, { status: 404 });
  if (normalized.value.version && normalized.value.version !== current.version) {
    return noStore(
      { error: "Lead changed since it was loaded.", currentVersion: current.version },
      { status: 409 },
    );
  }
  const currentValues = leadValues(current);
  const values = mergeLeadPatch(currentValues, normalized.value);

  const now = Date.now();
  const activities: LeadActivityIntent[] = [];
  for (const key of MUTABLE_KEYS) {
    if (!Object.hasOwn(normalized.value, key)) continue;
    if (values[key] === currentValues[key]) continue;
    activities.push({
      id: crypto.randomUUID(),
      recordId: leadId,
      action: LEAD_ACTIVITY_ACTIONS[key],
      actor: auth.user.email,
      detail: `${leadActivityValue(key, currentValues[key])} → ${leadActivityValue(key, values[key])}`,
      createdAt: now,
    });
  }
  if (activities.length === 0) return noStore({ lead: leadResponse(current) });
  const result = await repository.update({
    leadId,
    expectedVersion: normalized.value.version ?? current.version,
    values,
    updatedAt: now,
    updatedBy: auth.user.email,
    activities,
  });
  if (result.outcome === "lead-not-found") {
    return noStore({ error: "Lead not found." }, { status: 404 });
  }
  if (result.outcome === "conflict") {
    return noStore(
      { error: "Lead changed since it was loaded.", currentVersion: result.currentVersion },
      { status: 409 },
    );
  }
  return noStore({ lead: leadResponse(result.value) });
}
