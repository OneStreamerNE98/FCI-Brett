export const SECURITY_AUDIT_EXECUTOR_TYPES = [
  "user",
  "service",
  "system",
  "anonymous",
  "external",
] as const;

export type SecurityAuditExecutorType =
  (typeof SECURITY_AUDIT_EXECUTOR_TYPES)[number];

export const SECURITY_AUDIT_RESULTS = [
  "succeeded",
  "failed",
  "denied",
] as const;

export type SecurityAuditResult = (typeof SECURITY_AUDIT_RESULTS)[number];

export type SecurityAuditMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly SecurityAuditMetadataValue[]
  | { readonly [key: string]: SecurityAuditMetadataValue };

export type SecurityAuditMetadata = Readonly<
  Record<string, SecurityAuditMetadataValue>
>;

/**
 * Content-minimized, append-only security evidence. The executor identifies
 * who performed the action. The optional originator remains separate so a
 * service or system worker cannot be mistaken for the employee whose earlier
 * request caused the work.
 */
export type SecurityAuditEvent = Readonly<{
  id: string;
  executorType: SecurityAuditExecutorType;
  executorUserId: string | null;
  executorKey: string;
  originatingUserId: string | null;
  originatingActorKey: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: SecurityAuditResult;
  reasonCode: string | null;
  requestId: string | null;
  correlationId: string;
  source: string;
  metadata: SecurityAuditMetadata;
  occurredAt: number;
  retentionPolicyKey: string;
  retentionUntil: number | null;
}>;

export type RecordedSecurityAuditEvent = Readonly<{
  id: string;
}>;

export interface SecurityAuditRepository {
  append(event: SecurityAuditEvent): Promise<RecordedSecurityAuditEvent>;
}
