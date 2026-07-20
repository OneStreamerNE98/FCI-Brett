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
  estimated_value: number;
  next_action: string;
  next_action_at: number | null;
  owner_email: string;
  status: string;
  created_by: string;
  created_at: number;
  updated_at: number;
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
    estimatedValue: row.estimated_value,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at ? new Date(row.next_action_at).toISOString() : null,
    ownerEmail: row.owner_email,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function validateLeadValues(body: Record<string, unknown>): ValidatedLeadValues | null {
  const company = cleanText(body.company, 180);
  const contactName = cleanText(body.contactName, 160);
  const contactEmail = cleanEmail(body.contactEmail);
  const contactPhone = cleanText(body.contactPhone, 40, false);
  const projectName = cleanText(body.projectName, 180);
  const source = cleanText(body.source, 80);
  const stage = cleanText(body.stage, 80);
  const site = cleanText(body.site, 300);
  const estimatedValue = cleanEstimatedValue(body.estimatedValue);
  const nextAction = cleanText(body.nextAction, 500);
  const nextActionAt = cleanTimestamp(body.nextActionAt);
  const ownerEmail = cleanEmail(body.ownerEmail, true);
  const status = cleanText(body.status ?? "active", 20);
  if (!company || !contactName || contactEmail === undefined || contactPhone === undefined || !projectName || !source || !stage || !site || estimatedValue === undefined || !nextAction || nextActionAt === undefined || !ownerEmail || !status || !LEAD_STATUS_SET.has(status)) {
    return null;
  }
  return {
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
  };
}
