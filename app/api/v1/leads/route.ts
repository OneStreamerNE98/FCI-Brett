import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

const MAX_BODY_BYTES = 32_000;
const LEAD_STATUSES = new Set(["active", "converted", "lost", "archived"]);

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

export async function readBoundedJson(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { response: NextResponse.json({ error: "Lead details are too large." }, { status: 413 }) };
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return { response: NextResponse.json({ error: "Lead details are too large." }, { status: 413 }) };
  try {
    const body = JSON.parse(rawBody) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return { body: body as Record<string, unknown> };
  } catch {
    return { response: NextResponse.json({ error: "Lead details must be valid JSON." }, { status: 400 }) };
  }
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

export function validateLeadValues(body: Record<string, unknown>) {
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
  if (!company || !contactName || contactEmail === undefined || contactPhone === undefined || !projectName || !source || !stage || !site || estimatedValue === undefined || !nextAction || nextActionAt === undefined || !ownerEmail || !status || !LEAD_STATUSES.has(status)) {
    return null;
  }
  return { company, contactName, contactEmail, contactPhone, projectName, source, stage, site, estimatedValue, nextAction, nextActionAt, ownerEmail, status };
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const result = await env.DB.prepare("SELECT * FROM leads ORDER BY updated_at DESC, created_at DESC LIMIT 500").all<LeadRow>();
  return NextResponse.json({ leads: result.results.map(leadResponse) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const parsed = await readBoundedJson(request);
  if ("response" in parsed) return parsed.response;
  const body = { ...parsed.body, ownerEmail: parsed.body.ownerEmail ?? auth.user.email };
  const values = validateLeadValues(body);
  if (!values) return NextResponse.json({ error: "Enter a valid company, contact, project, source, stage, site, value, next action, owner email, and status." }, { status: 400 });

  await ensureWorkspaceSchema();
  const id = crypto.randomUUID();
  const leadNumber = `L-${new Date().getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO leads (id, lead_number, company, contact_name, contact_email, contact_phone, project_name, source, stage, site, estimated_value, next_action, next_action_at, owner_email, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, leadNumber, values.company, values.contactName, values.contactEmail, values.contactPhone, values.projectName, values.source, values.stage, values.site, values.estimatedValue, values.nextAction, values.nextActionAt, values.ownerEmail, values.status, auth.user.email, now, now),
    env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, "Lead created", auth.user.email, `${leadNumber} · ${values.company} · ${values.projectName}`, now),
  ]);
  const created = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first<LeadRow>();
  return NextResponse.json({ lead: leadResponse(created!) }, { status: 201 });
}
