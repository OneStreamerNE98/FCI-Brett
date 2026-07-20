export const OUTBOX_EVENT_TYPES = [
  "client.created",
  "project.created",
  "lead.created",
  "project.meeting.created",
] as const;

export type OutboxEventType = typeof OUTBOX_EVENT_TYPES[number];

export type OutboxPayload = Readonly<Record<string, unknown>>;

export type ClaimedOutboxEvent = {
  id: string;
  eventKey: string;
  eventType: OutboxEventType;
  clientId: string | null;
  projectId: string | null;
  leadId: string | null;
  actorId: string;
  correlationId: string;
  payload: OutboxPayload;
  availableAt: number;
  attemptCount: number;
  leaseExpiresAt: number;
  createdAt: number;
  version: string;
};

export type ClaimAvailableOutboxEvents = {
  batchSize: number;
  leaseDurationMs: number;
};

export type CompleteOutboxEvent = {
  eventId: string;
  expectedVersion: string;
};

export type CompleteOutboxEventResult =
  | { outcome: "completed"; version: string; completedAt: number }
  | { outcome: "stale" };

export type RetryOrDeadLetterOutboxEvent = {
  eventId: string;
  expectedVersion: string;
  retryDelayMs: number;
  maxAttempts: number;
  errorCode: string;
  errorMessage: string;
};

export type RetryOrDeadLetterOutboxEventResult =
  | { outcome: "retry"; version: string; availableAt: number }
  | { outcome: "dead-lettered"; version: string; deadLetteredAt: number }
  | { outcome: "stale" };

export type RecoverExpiredOutboxLeases = {
  batchSize: number;
  retryDelayMs: number;
  maxAttempts: number;
};

export type RecoveredOutboxEvent =
  | { id: string; outcome: "retry"; version: string; availableAt: number }
  | { id: string; outcome: "dead-lettered"; version: string; deadLetteredAt: number };

/**
 * Durable delivery-state operations only. Provider/network work deliberately
 * lives outside this boundary and after the short claim transaction commits.
 */
export interface OutboxRepository {
  claimAvailable(input: ClaimAvailableOutboxEvents): Promise<ClaimedOutboxEvent[]>;
  complete(input: CompleteOutboxEvent): Promise<CompleteOutboxEventResult>;
  retryOrDeadLetter(
    input: RetryOrDeadLetterOutboxEvent,
  ): Promise<RetryOrDeadLetterOutboxEventResult>;
  recoverExpiredLeases(input: RecoverExpiredOutboxLeases): Promise<RecoveredOutboxEvent[]>;
}
