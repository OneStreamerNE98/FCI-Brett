import { normalizeClientIndustry } from "./client-industry.ts";
import { normalizeClientDisplayName } from "./client-name-key.ts";
import {
  normalizeContactEmail,
  normalizeContactName,
  normalizeContactPhone,
  normalizeContactRole,
} from "./contact-fields.ts";

export const CLIENT_STATUSES = ["active", "prospect", "inactive", "archived"] as const;

export type ClientStatus = typeof CLIENT_STATUSES[number];

export type NormalizedPrimaryContact = {
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
};

export type NormalizedClientCreation = {
  name: string;
  industry: string | null;
  status: ClientStatus;
  primaryContact: NormalizedPrimaryContact | null;
};

export type ClientCreationValidation =
  | { ok: true; value: NormalizedClientCreation }
  | { ok: false; message: string };

function invalidJsonDetails(): ClientCreationValidation {
  return { ok: false, message: "Client details must be valid JSON." };
}

export function normalizeClientCreation(input: unknown): ClientCreationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalidJsonDetails();

  const record = input as Record<string, unknown>;
  for (const field of ["name", "status"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") return invalidJsonDetails();
  }

  let primaryContact: Record<string, unknown> | undefined;
  if (record.primaryContact !== undefined) {
    if (!record.primaryContact || typeof record.primaryContact !== "object" || Array.isArray(record.primaryContact)) return invalidJsonDetails();
    primaryContact = record.primaryContact as Record<string, unknown>;
    for (const field of ["name", "role"] as const) {
      if (primaryContact[field] !== undefined && typeof primaryContact[field] !== "string") return invalidJsonDetails();
    }
    for (const field of ["email", "phone"] as const) {
      if (
        primaryContact[field] !== undefined
        && primaryContact[field] !== null
        && typeof primaryContact[field] !== "string"
      ) {
        return invalidJsonDetails();
      }
    }
  }

  const rawName = record.name as string | undefined;
  const name = normalizeClientDisplayName(rawName);
  if (!rawName?.trim()) return { ok: false, message: "client name is required" };
  if (!name) return { ok: false, message: "client name is too long" };

  const status = ((record.status as string | undefined)?.trim().toLowerCase() || "active") as ClientStatus;
  if (!CLIENT_STATUSES.includes(status)) return { ok: false, message: "client status is invalid" };
  const industry = normalizeClientIndustry(record.industry ?? null);
  if (industry === undefined) return { ok: false, message: "client industry is invalid" };

  let normalizedPrimaryContact: NormalizedPrimaryContact | null = null;
  if (primaryContact) {
    const contactName = normalizeContactName(primaryContact.name);
    const contactEmail = normalizeContactEmail(primaryContact.email ?? null);
    const contactPhone = normalizeContactPhone(primaryContact.phone ?? null);
    const contactRole = primaryContact.role === undefined
      ? "Primary contact"
      : normalizeContactRole(primaryContact.role);
    if (!contactName) {
      return { ok: false, message: "primary contact name is invalid" };
    }
    if (contactEmail === undefined) {
      return { ok: false, message: "primary contact email is invalid" };
    }
    if (contactPhone === undefined) {
      return { ok: false, message: "primary contact phone is invalid" };
    }
    if (!contactRole) {
      return { ok: false, message: "primary contact role is invalid" };
    }
    normalizedPrimaryContact = {
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      role: contactRole,
    };
  }
  return {
    ok: true,
    value: {
      name,
      industry,
      status,
      primaryContact: normalizedPrimaryContact,
    },
  };
}
