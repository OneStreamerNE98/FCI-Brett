import { normalizeRecordVersion } from "./record-version.ts";
import type { SavedAddressVerdict } from "./address-validation.ts";

export const MAX_LEAD_BODY_BYTES = 32_000;

export const LEAD_STATUSES = ["active", "converted", "lost", "archived"] as const;

export type LeadStatus = typeof LEAD_STATUSES[number];

const LEAD_STATUS_SET = new Set<string>(LEAD_STATUSES);

export type ValidatedLeadValues = {
  company: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  projectName: string;
  source: string;
  stage: string;
  site: string;
  estimatedValue: number;
  nextAction: string;
  nextActionAt: number | null;
  ownerEmail: string;
  status: LeadStatus;
};

export type LeadValueField = keyof ValidatedLeadValues;

export type LeadValuesValidation =
  | { ok: true; value: ValidatedLeadValues }
  | { ok: false; field: LeadValueField; message: string };

export const LEAD_PATCH_KEYS = [
  "company",
  "contactName",
  "contactEmail",
  "contactPhone",
  "projectName",
  "source",
  "stage",
  "site",
  "estimatedValue",
  "nextAction",
  "nextActionAt",
  "ownerEmail",
  "status",
] as const;

export type LeadPatchKey = typeof LEAD_PATCH_KEYS[number];

export type ValidatedLeadPatch = Partial<ValidatedLeadValues> & {
  version?: string;
};

export type LeadPatchValidation =
  | { ok: true; value: ValidatedLeadPatch }
  | { ok: false; message: string };

export type LeadRow = {
  id: string;
  lead_number: string;
  company: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  project_name: string;
  source: string;
  stage: string;
  site: string;
  latitude: number | null;
  longitude: number | null;
  address_validation_verdict: SavedAddressVerdict | null;
  estimated_value: number;
  next_action: string;
  next_action_at: number | null;
  owner_email: string;
  status: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  version: string;
};

/** Preserve the development identifier format while keeping generation testable. */
export function leadNumberFor(id: string, utcYear: number) {
  return `L-${utcYear}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function cleanText(value: unknown, maximum: number, required = true) {
  if (typeof value !== "string") return required ? undefined : null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return required ? undefined : null;
  if (cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) return undefined;
  return cleaned;
}

function cleanEmail(value: unknown, required = false) {
  const email = cleanText(value, 254, required);
  if (email === undefined || email === null) return email;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return undefined;
  return normalized;
}

function cleanEstimatedValue(value: unknown) {
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) return undefined;
  return amount;
}

function cleanTimestamp(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000) return undefined;
  return Math.trunc(timestamp);
}

export function leadResponse(row: LeadRow) {
  return {
    id: row.id,
    leadNumber: row.lead_number,
    company: row.company,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    projectName: row.project_name,
    source: row.source,
    stage: row.stage,
    site: row.site,
    latitude: row.latitude,
    longitude: row.longitude,
    addressValidationVerdict: row.address_validation_verdict,
    estimatedValue: row.estimated_value,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at ? new Date(row.next_action_at).toISOString() : null,
    ownerEmail: row.owner_email,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function validateLeadValuesWithIssue(body: Record<string, unknown>): LeadValuesValidation {
  const company = cleanText(body.company, 180);
  if (!company) return { ok: false, field: "company", message: "Enter a client company name with 180 characters or fewer." };
  const contactName = cleanText(body.contactName, 160);
  if (!contactName) return { ok: false, field: "contactName", message: "Enter a primary contact name with 160 characters or fewer." };
  const contactEmail = cleanEmail(body.contactEmail);
  if (contactEmail === undefined) return { ok: false, field: "contactEmail", message: "Enter a valid contact email address or leave it blank." };
  const contactPhone = cleanText(body.contactPhone, 40, false);
  if (contactPhone === undefined) return { ok: false, field: "contactPhone", message: "Enter a contact phone number with 40 characters or fewer, or leave it blank." };
  const projectName = cleanText(body.projectName, 180);
  if (!projectName) return { ok: false, field: "projectName", message: "Enter a project or opportunity name with 180 characters or fewer." };
  const source = cleanText(body.source, 80);
  if (!source) return { ok: false, field: "source", message: "Enter a lead source with 80 characters or fewer." };
  const stage = cleanText(body.stage, 80);
  if (!stage) return { ok: false, field: "stage", message: "Enter a lead stage with 80 characters or fewer." };
  const site = cleanText(body.site, 280);
  if (!site) return { ok: false, field: "site", message: "Enter a project site address with 280 characters or fewer." };
  const estimatedValue = cleanEstimatedValue(body.estimatedValue);
  if (estimatedValue === undefined) return { ok: false, field: "estimatedValue", message: "Enter an estimated value as a whole number from 0 to 2,147,483,647." };
  const nextAction = cleanText(body.nextAction, 500);
  if (!nextAction) return { ok: false, field: "nextAction", message: "Enter the next action with 500 characters or fewer." };
  const nextActionAt = cleanTimestamp(body.nextActionAt);
  if (nextActionAt === undefined) return { ok: false, field: "nextActionAt", message: "Enter a valid next action date and time or leave it blank." };
  const ownerEmail = cleanEmail(body.ownerEmail, true);
  if (!ownerEmail) return { ok: false, field: "ownerEmail", message: "Enter a valid lead owner email address." };
  const status = cleanText(body.status ?? "active", 20);
  if (!status || !LEAD_STATUS_SET.has(status)) return { ok: false, field: "status", message: "Choose a valid lead status." };
  return { ok: true, value: {
    company,
    contactName,
    contactEmail,
    contactPhone,
    projectName,
    source,
    stage,
    site,
    estimatedValue,
    nextAction,
    nextActionAt,
    ownerEmail,
    status: status as LeadStatus,
  } };
}

export function validateLeadValues(body: Record<string, unknown>): ValidatedLeadValues | null {
  const result = validateLeadValuesWithIssue(body);
  return result.ok ? result.value : null;
}

const LEAD_PATCH_KEY_SET = new Set<string>([...LEAD_PATCH_KEYS, "version"]);

export function normalizeLeadPatch(body: Record<string, unknown>): LeadPatchValidation {
  if (
    Object.keys(body).some((key) => !LEAD_PATCH_KEY_SET.has(key))
    || !LEAD_PATCH_KEYS.some((key) => Object.hasOwn(body, key))
  ) {
    return { ok: false, message: "Only supported lead fields can be updated." };
  }

  const patch: ValidatedLeadPatch = {};
  if (Object.hasOwn(body, "version")) {
    const version = normalizeRecordVersion(body.version);
    if (!version) return { ok: false, message: "Lead version must be a positive whole number." };
    patch.version = version;
  }
  if (Object.hasOwn(body, "company")) {
    const value = cleanText(body.company, 180);
    if (!value) return { ok: false, message: "Lead company must be 180 characters or fewer." };
    patch.company = value;
  }
  if (Object.hasOwn(body, "contactName")) {
    const value = cleanText(body.contactName, 160);
    if (!value) return { ok: false, message: "Lead contact name must be 160 characters or fewer." };
    patch.contactName = value;
  }
  if (Object.hasOwn(body, "contactEmail")) {
    if (
      body.contactEmail !== null
      && body.contactEmail !== ""
      && typeof body.contactEmail !== "string"
    ) {
      return { ok: false, message: "Lead contact email is invalid." };
    }
    const value = cleanEmail(body.contactEmail);
    if (value === undefined) return { ok: false, message: "Lead contact email is invalid." };
    patch.contactEmail = value;
  }
  if (Object.hasOwn(body, "contactPhone")) {
    if (
      body.contactPhone !== null
      && body.contactPhone !== ""
      && typeof body.contactPhone !== "string"
    ) {
      return { ok: false, message: "Lead contact phone must be 40 characters or fewer." };
    }
    const value = cleanText(body.contactPhone, 40, false);
    if (value === undefined) return { ok: false, message: "Lead contact phone must be 40 characters or fewer." };
    patch.contactPhone = value;
  }
  if (Object.hasOwn(body, "projectName")) {
    const value = cleanText(body.projectName, 180);
    if (!value) return { ok: false, message: "Lead project name must be 180 characters or fewer." };
    patch.projectName = value;
  }
  if (Object.hasOwn(body, "source")) {
    const value = cleanText(body.source, 80);
    if (!value) return { ok: false, message: "Lead source must be 80 characters or fewer." };
    patch.source = value;
  }
  if (Object.hasOwn(body, "stage")) {
    const value = cleanText(body.stage, 80);
    if (!value) return { ok: false, message: "Lead stage must be 80 characters or fewer." };
    patch.stage = value;
  }
  if (Object.hasOwn(body, "site")) {
    const value = cleanText(body.site, 280);
    if (!value) return { ok: false, message: "Lead site must be 280 characters or fewer." };
    patch.site = value;
  }
  if (Object.hasOwn(body, "estimatedValue")) {
    const value = cleanEstimatedValue(body.estimatedValue);
    if (value === undefined) {
      return { ok: false, message: "Lead estimated value must be a non-negative whole number." };
    }
    patch.estimatedValue = value;
  }
  if (Object.hasOwn(body, "nextAction")) {
    const value = cleanText(body.nextAction, 500);
    if (!value) return { ok: false, message: "Lead next action must be 500 characters or fewer." };
    patch.nextAction = value;
  }
  if (Object.hasOwn(body, "nextActionAt")) {
    const value = cleanTimestamp(body.nextActionAt);
    if (value === undefined) return { ok: false, message: "Lead next action due date is invalid." };
    patch.nextActionAt = value;
  }
  if (Object.hasOwn(body, "ownerEmail")) {
    const value = cleanEmail(body.ownerEmail, true);
    if (!value) return { ok: false, message: "Lead owner email is invalid." };
    patch.ownerEmail = value;
  }
  if (Object.hasOwn(body, "status")) {
    const value = cleanText(body.status, 20);
    if (!value || !LEAD_STATUS_SET.has(value)) {
      return { ok: false, message: "Lead status is invalid." };
    }
    patch.status = value as LeadStatus;
  }
  return { ok: true, value: patch };
}

export function leadValues(row: LeadRow): ValidatedLeadValues {
  return {
    company: row.company,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    projectName: row.project_name,
    source: row.source,
    stage: row.stage,
    site: row.site,
    estimatedValue: row.estimated_value,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    ownerEmail: row.owner_email,
    status: row.status as LeadStatus,
  };
}

export function mergeLeadPatch(
  current: ValidatedLeadValues,
  patch: ValidatedLeadPatch,
): ValidatedLeadValues {
  return {
    ...current,
    ...Object.fromEntries(
      LEAD_PATCH_KEYS
        .filter((key) => Object.hasOwn(patch, key))
        .map((key) => [key, patch[key]]),
    ),
  } as ValidatedLeadValues;
}
