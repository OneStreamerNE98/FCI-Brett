import {
  leadNumberFor,
  leadResponse,
  validateLeadValues,
  type LeadRow,
} from "../domain/lead";
import type { LeadRepository } from "../ports/lead-repository";
import { AUTHORIZATION_CAPABILITIES } from "./authorization-capabilities";
import {
  canCreate,
  CREATION_CAPABILITIES,
  type CreationAuthorizationContext,
} from "./creation-authorization";

export type ListLeadsResult =
  | { ok: false; kind: "forbidden"; message: string }
  | { ok: true; value: ReturnType<typeof leadResponse>[] };

export type CreateLeadResult =
  | {
      ok: false;
      kind: "forbidden" | "invalid" | "identifier-collision" | "idempotency-conflict" | "in-progress";
      message: string;
    }
  | {
      ok: true;
      value: ReturnType<typeof leadResponse> & { version?: string };
    };

export type LeadOperationDependencies = {
  repository: Pick<LeadRepository, "list" | "create">;
  newId: () => string;
  now: () => number;
};

export async function listLeads(
  authorization: CreationAuthorizationContext,
  repository: Pick<LeadRepository, "list">,
): Promise<ListLeadsResult> {
  if (!authorization.actorId || !authorization.capabilities.has(AUTHORIZATION_CAPABILITIES.recordsRead)) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to view leads." };
  }
  return { ok: true, value: (await repository.list()).map(leadResponse) };
}

export async function createLead(
  input: unknown,
  authorization: CreationAuthorizationContext,
  dependencies: LeadOperationDependencies,
): Promise<CreateLeadResult> {
  if (!canCreate(authorization, CREATION_CAPABILITIES.createLead)) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to create leads." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: "invalid", message: "Lead details must be valid JSON." };
  }
  const values = validateLeadValues({
    ...(input as Record<string, unknown>),
    ownerEmail: (input as Record<string, unknown>).ownerEmail ?? authorization.actorId,
  });
  if (!values) {
    return {
      ok: false,
      kind: "invalid",
      message: "Enter a valid company, contact, project, source, stage, site, value, next action, owner email, and status.",
    };
  }

  const createdAt = dependencies.now();
  const id = dependencies.newId();
  const leadNumber = leadNumberFor(id, new Date(createdAt).getUTCFullYear());
  const lead: LeadRow = {
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
    created_by: authorization.actorId,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const result = await dependencies.repository.create({
    lead,
    activity: {
      id: dependencies.newId(),
      recordId: id,
      action: "Lead created",
      actor: authorization.actorId,
      detail: `${leadNumber} · ${values.company} · ${values.projectName}`,
      createdAt,
    },
  });

  if (result.outcome === "identifier-collision") {
    return { ok: false, kind: result.outcome, message: "A lead identifier collision occurred. Retry the request." };
  }
  if (result.outcome === "idempotency-conflict") {
    return { ok: false, kind: result.outcome, message: "This request key was already used for different lead details." };
  }
  if (result.outcome === "in-progress") {
    return { ok: false, kind: result.outcome, message: "This lead request is already being processed. Retry with the same request key." };
  }
  if (result.outcome === "accepted") {
    return { ok: true, value: { ...leadResponse(result.value.row), version: result.value.version } };
  }
  return { ok: true, value: leadResponse(result.value) };
}
