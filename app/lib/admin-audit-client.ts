import {
  ADMIN_AUDIT_CATEGORIES,
  type AdminAuditActivity,
  type AdminAuditCategory,
  type AdminAuditResult,
} from "../ports/admin-audit-reader";

export const ADMIN_AUDIT_PERIODS = ["7d", "30d", "90d", "all"] as const;
export type AdminAuditPeriod = (typeof ADMIN_AUDIT_PERIODS)[number];

export const ADMIN_AUDIT_RESULTS = ["succeeded", "failed", "denied"] as const;
export type AdminAuditResultFilter = "all" | AdminAuditResult;

export type AdminAuditCategoryFilter = "all" | AdminAuditCategory;
export type { AdminAuditActivity, AdminAuditCategory, AdminAuditResult };

export type AdminAuditPage = Readonly<{
  events: readonly AdminAuditActivity[];
  nextCursor: string | null;
  generatedAt: number;
}>;

export type AdminAuditReadInput = Readonly<{
  limit: number;
  from: string | null;
  before: string;
  result: AdminAuditResultFilter;
  category: AdminAuditCategoryFilter;
  cursor: string | null;
}>;

const ADMIN_AUDIT_PATH = "/api/v1/admin/audit";
const RESULT_SET = new Set<string>(ADMIN_AUDIT_RESULTS);
const CATEGORY_SET = new Set<string>(ADMIN_AUDIT_CATEGORIES);
const EVENT_KEYS = [
  "actorLabel",
  "actionLabel",
  "targetLabel",
  "result",
  "reason",
  "occurredAt",
] as const;
const PAGE_KEYS = ["events", "nextCursor", "generatedAt"] as const;

type ErrorEnvelope = Readonly<{ error?: unknown }>;

export class AdminAuditClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "AdminAuditClientError";
  }
}

function requireAdminApi(secureSessionReady: boolean) {
  if (!secureSessionReady) {
    throw new AdminAuditClientError(0, "secure_session_not_ready");
  }
}

function invalidResponse(status = 200): never {
  throw new AdminAuditClientError(status, "invalid_server_response");
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function safeLabel(value: unknown, maximumLength: number) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeTimestamp(value: unknown) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && Number.isFinite(new Date(value).getTime());
}

function activity(value: unknown): AdminAuditActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  const event = value as Readonly<Record<string, unknown>>;
  if (
    !exactKeys(event, EVENT_KEYS)
    || !safeLabel(event.actorLabel, 320)
    || !safeLabel(event.actionLabel, 255)
    || !safeLabel(event.targetLabel, 512)
    || !RESULT_SET.has(String(event.result))
    || (event.reason !== null && !safeLabel(event.reason, 500))
    || !safeTimestamp(event.occurredAt)
  ) {
    invalidResponse();
  }
  return Object.freeze({
    actorLabel: event.actorLabel as string,
    actionLabel: event.actionLabel as string,
    targetLabel: event.targetLabel as string,
    result: event.result as AdminAuditResult,
    reason: event.reason as string | null,
    occurredAt: event.occurredAt as number,
  });
}

async function responseEnvelope(response: Response) {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AdminAuditClientError(response.status, "invalid_server_response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAuditClientError(response.status, "invalid_server_response");
  }
  if (!response.ok) {
    const error = (value as ErrorEnvelope).error;
    throw new AdminAuditClientError(
      response.status,
      typeof error === "string" && error ? error : "request_failed",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function page(envelope: Readonly<Record<string, unknown>>): AdminAuditPage {
  const value = envelope.data;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  const data = value as Readonly<Record<string, unknown>>;
  if (
    !exactKeys(data, PAGE_KEYS)
    || !Array.isArray(data.events)
    || data.events.length > 50
    || (data.nextCursor !== null
      && (typeof data.nextCursor !== "string"
        || data.nextCursor.length === 0
        || data.nextCursor.length > 2_048))
    || !safeTimestamp(data.generatedAt)
  ) {
    invalidResponse();
  }
  return Object.freeze({
    events: Object.freeze(data.events.map(activity)),
    nextCursor: data.nextCursor as string | null,
    generatedAt: data.generatedAt as number,
  });
}

function readUrl(input: AdminAuditReadInput) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new AdminAuditClientError(0, "invalid_audit_request");
  }
  if (
    (input.result !== "all" && !RESULT_SET.has(input.result))
    || (input.category !== "all" && !CATEGORY_SET.has(input.category))
  ) {
    throw new AdminAuditClientError(0, "invalid_audit_request");
  }
  const parameters = new URLSearchParams();
  parameters.set("limit", String(input.limit));
  if (input.from !== null) parameters.set("from", input.from);
  parameters.set("before", input.before);
  if (input.result !== "all") parameters.set("result", input.result);
  if (input.category !== "all") parameters.set("category", input.category);
  if (input.cursor !== null) parameters.set("cursor", input.cursor);
  return `${ADMIN_AUDIT_PATH}?${parameters.toString()}`;
}

export async function readAdminAuditActivity(
  input: AdminAuditReadInput,
  secureSessionReady: boolean,
): Promise<AdminAuditPage> {
  requireAdminApi(secureSessionReady);
  const response = await fetch(readUrl(input), {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return page(await responseEnvelope(response));
}
