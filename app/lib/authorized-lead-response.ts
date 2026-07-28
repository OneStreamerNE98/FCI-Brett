import { leadResponse, type LeadRow } from "../domain/lead";
import { officeIdentityForEmail } from "./workspace-auth";

function authorizedOfficeEmail(candidate: string, actorEmail: string) {
  const normalized = candidate.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === actorEmail.trim().toLowerCase()) return normalized;
  return officeIdentityForEmail(normalized)?.email ?? null;
}

type LeadPayload = ReturnType<typeof leadResponse>;

/**
 * Lead contact emails belong to clients and remain visible to authorized office
 * users. Owner/creator emails are internal identities, so Sites API responses
 * apply the same actor-or-current-office disclosure rule as projects.
 */
export function authorizedLeadPayload(payload: LeadPayload, actorEmail: string) {
  return {
    ...payload,
    ownerEmail: authorizedOfficeEmail(payload.ownerEmail, actorEmail),
    createdBy: authorizedOfficeEmail(payload.createdBy, actorEmail),
  };
}

export function authorizedLeadResponse(row: LeadRow, actorEmail: string) {
  return authorizedLeadPayload(leadResponse(row), actorEmail);
}

export function authorizedLeadOwnerEmail(candidate: string, actorEmail: string) {
  return authorizedOfficeEmail(candidate, actorEmail);
}
