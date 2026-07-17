import type { AuthorizationRecordScope } from "./authorization";

export const ADMIN_AUDIT_CATEGORIES = Object.freeze([
  "access",
  "people",
  "workspace",
  "files",
  "records",
  "other",
] as const);

export type AdminAuditCategory = (typeof ADMIN_AUDIT_CATEGORIES)[number];
export type AdminAuditResult = "succeeded" | "failed" | "denied";

/** The HTTP cursor carries only this one-way key; the raw audit event ID never leaves PostgreSQL. */
export type AdminAuditKeyset = Readonly<{
  occurredAt: number;
  cursorKey: string;
}>;

export type AdminAuditQuery = Readonly<{
  from: number | null;
  before: number | null;
  result: AdminAuditResult | null;
  category: AdminAuditCategory | null;
  cursor: AdminAuditKeyset | null;
  limit: number;
}>;

export type AdminAuditActivity = Readonly<{
  actorLabel: string;
  actionLabel: string;
  targetLabel: string;
  result: AdminAuditResult;
  reason: string | null;
  occurredAt: number;
}>;

export type AdminAuditPage = Readonly<{
  events: readonly AdminAuditActivity[];
  next: AdminAuditKeyset | null;
  generatedAt: number;
}>;

export type AdminAuditReadResult =
  | Readonly<{ outcome: "accepted"; page: AdminAuditPage }>
  | Readonly<{ outcome: "actor_authorization_changed" }>;

export interface AdminAuditReader {
  listActivity(
    scope: AuthorizationRecordScope,
    query: AdminAuditQuery,
    now: number,
  ): Promise<AdminAuditReadResult>;
}
