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
  mergeLeadPatch,
  normalizeLeadPatch,
  type LeadPatchKey,
  type ValidatedLeadValues,
} from "../../../../domain/lead";
import type { LeadActivityIntent } from "../../../../ports/lead-repository";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { noStoreJson as noStore } from "../../../../lib/no-store-json";
import {
  authorizedLeadOwnerEmail,
  authorizedLeadResponse,
} from "../../../../lib/authorized-lead-response";
import { resolveAddressMutation } from "../../../../lib/address-mutation-sites";
import { persistedAddress } from "../../../../domain/address-validation";

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

type LeadConflictValues = Partial<{
  [Key in LeadPatchKey]: Key extends "ownerEmail"
    ? string | null
    : ValidatedLeadValues[Key];
}>;

function leadActivityValue(key: keyof ValidatedLeadValues, value: string | number | null) {
  if (value === null) return "Not set";
  if (key === "nextActionAt") return new Date(value as number).toISOString();
  return String(value);
}

function leadConflictValues(
  row: Parameters<typeof leadValues>[0],
  patch: ReturnType<typeof normalizeLeadPatch> & { ok: true },
  actorEmail: string,
): LeadConflictValues {
  const values = leadValues(row);
  return Object.fromEntries(
    LEAD_PATCH_KEYS.flatMap((key) => {
      if (!Object.hasOwn(patch.value, key)) return [];
      const value = key === "ownerEmail"
        ? authorizedLeadOwnerEmail(values.ownerEmail, actorEmail)
        : values[key];
      return [[key, value]];
    }),
  ) as LeadConflictValues;
}

function leadConflictResponse(
  row: Parameters<typeof leadValues>[0],
  patch: ReturnType<typeof normalizeLeadPatch> & { ok: true },
  actorEmail: string,
) {
  return noStore(
    {
      error: "Lead changed since it was loaded.",
      currentVersion: row.version,
      currentValues: leadConflictValues(row, patch, actorEmail),
    },
    { status: 409 },
  );
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
  const { addressReview, ...leadBody } = parsed.body;
  const normalized = normalizeLeadPatch(leadBody);
  if (!normalized.ok) return noStore({ error: normalized.message }, { status: 400 });
  // `isAdmin` is the only development-transport authorization primitive that
  // actually enforces an edit boundary today. Keep this check before every
  // record read/conflict path so a forbidden financial edit cannot disclose
  // lead existence, version, or saved values through a 409.
  if (Object.hasOwn(normalized.value, "estimatedValue") && !auth.user.isAdmin) {
    return noStore(
      { error: "An FCI administrator must update lead estimated value." },
      { status: 403 },
    );
  }
  if (
    Object.hasOwn(normalized.value, "ownerEmail")
    && !authorizedLeadOwnerEmail(normalized.value.ownerEmail ?? "", auth.user.email)
  ) {
    return noStore(
      { error: "Lead owner must be a current authorized office identity." },
      { status: 400 },
    );
  }

  await ensureWorkspaceSchema();
  const database = env.DB as unknown as D1Database;
  let trustedAddress;
  if (Object.hasOwn(normalized.value, "site")) {
    const resolved = await resolveAddressMutation(database, {
      actorId: auth.user.email,
      entityKind: "lead",
      targetId: leadId,
      rawAddress: normalized.value.site,
      rawReview: addressReview,
      required: true,
    });
    if (!resolved.ok) return noStore({ error: resolved.message }, { status: 400 });
    normalized.value.site = resolved.value.address!;
    trustedAddress = resolved.value;
  } else if (addressReview !== undefined) {
    return noStore({ error: "Address review requires a lead site update." }, { status: 400 });
  }
  const repository = createD1LeadRepository(database);
  const current = await repository.findById(leadId);
  if (!current) return noStore({ error: "Lead not found." }, { status: 404 });
  if (normalized.value.version && normalized.value.version !== current.version) {
    return leadConflictResponse(current, normalized, auth.user.email);
  }
  const currentValues = leadValues(current);
  const values = mergeLeadPatch(currentValues, normalized.value);
  const address = Object.hasOwn(normalized.value, "site")
    ? persistedAddress(values.site, trustedAddress)
    : {
        address: current.site,
        latitude: current.latitude,
        longitude: current.longitude,
        verdict: current.address_validation_verdict,
      };

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
  const addressEvidenceChanged = Object.hasOwn(normalized.value, "site")
    && (
      current.latitude !== address.latitude
      || current.longitude !== address.longitude
      || current.address_validation_verdict !== address.verdict
    );
  if (addressEvidenceChanged && current.site === values.site) {
    activities.push({
      id: crypto.randomUUID(),
      recordId: leadId,
      action: "Lead site changed",
      actor: auth.user.email,
      detail: `Address review: ${current.address_validation_verdict ?? "Not set"} → ${address.verdict ?? "Not set"}`,
      createdAt: now,
    });
  }
  if (activities.length === 0) {
    return noStore({ lead: authorizedLeadResponse(current, auth.user.email) });
  }
  const result = await repository.update({
    leadId,
    expectedVersion: normalized.value.version ?? current.version,
    values,
    address,
    updatedAt: now,
    updatedBy: auth.user.email,
    activities,
  });
  if (result.outcome === "lead-not-found") {
    return noStore({ error: "Lead not found." }, { status: 404 });
  }
  if (result.outcome === "conflict") {
    const latest = await repository.findById(leadId);
    if (!latest) return noStore({ error: "Lead not found." }, { status: 404 });
    return leadConflictResponse(latest, normalized, auth.user.email);
  }
  return noStore({ lead: authorizedLeadResponse(result.value, auth.user.email) });
}
