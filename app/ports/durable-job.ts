export const DURABLE_JOB_STATUSES = ["pending", "processing", "completed", "dead"] as const;

export type DurableJobStatus = typeof DURABLE_JOB_STATUSES[number];

export const DURABLE_JOB_FAILURE_DISPOSITIONS = [
  "retryable",
  "reauthorization_required",
  "permanent",
] as const;

export type DurableJobFailureDisposition =
  typeof DURABLE_JOB_FAILURE_DISPOSITIONS[number];

export type DurableJobFailure = Readonly<{
  code: string;
  message: string;
  disposition: DurableJobFailureDisposition;
}>;

export type DurableJobPayload = Readonly<Record<string, unknown>>;

/**
 * Provider-neutral application-owned work state. A PostgreSQL adapter is
 * expected to use `outbox_events`; Cloud Tasks is delivery only and is not the
 * durable failure or replay record.
 */
export type DurableJob = Readonly<{
  id: string;
  jobKey: string;
  jobType: string;
  actorKey: string;
  correlationId: string;
  payload: DurableJobPayload;
  status: DurableJobStatus;
  availableAt: number;
  attemptCount: number;
  leaseExpiresAt: number | null;
  lastFailure: DurableJobFailure | null;
  completedAt: number | null;
  deadLetteredAt: number | null;
  createdAt: number;
  updatedAt: number;
  version: string;
}>;

export type EnqueueDurableJob = Readonly<{
  id: string;
  jobKey: string;
  jobType: string;
  actorKey: string;
  correlationId: string;
  payload: DurableJobPayload;
  availableAt: number;
  createdAt: number;
}>;

export type EnqueueDurableJobResult =
  | Readonly<{ outcome: "enqueued"; job: DurableJob }>
  | Readonly<{ outcome: "already-enqueued"; job: DurableJob }>
  | Readonly<{ outcome: "conflict" }>;

export type ClaimDurableJobs = Readonly<{
  batchSize: number;
  leaseDurationMs: number;
}>;

export type CompleteDurableJob = Readonly<{
  jobId: string;
  expectedVersion: string;
}>;

export type CompleteDurableJobResult =
  | Readonly<{ outcome: "completed"; job: DurableJob }>
  | Readonly<{ outcome: "stale" }>;

export type FailDurableJob = Readonly<{
  jobId: string;
  expectedVersion: string;
  retryDelayMs: number;
  maxAttempts: number;
  failure: DurableJobFailure;
}>;

export type FailDurableJobResult =
  | Readonly<{ outcome: "retry"; job: DurableJob }>
  | Readonly<{ outcome: "dead-lettered"; job: DurableJob }>
  | Readonly<{ outcome: "stale" }>;

export type RecoverExpiredDurableJobLeases = Readonly<{
  batchSize: number;
  retryDelayMs: number;
  maxAttempts: number;
}>;

export type RecoveredDurableJob = Readonly<{
  job: DurableJob;
  outcome: "retry" | "dead-lettered";
}>;

export type ReplayDeadDurableJob = Readonly<{
  jobId: string;
  expectedVersion: string;
  retryDelayMs: number;
  requestedByActorKey: string;
  reason: string;
  correlationId: string;
}>;

export type DurableJobReplayEvidence = Readonly<{
  jobId: string;
  requestedByActorKey: string;
  reason: string;
  correlationId: string;
  requestedAt: number;
  previousFailure: DurableJobFailure;
}>;

export type ReplayDeadDurableJobResult =
  | Readonly<{
      outcome: "replayed";
      job: DurableJob;
      evidence: DurableJobReplayEvidence;
    }>
  | Readonly<{ outcome: "stale" }>;

export type ListDeadDurableJobs = Readonly<{
  limit: number;
}>;

/**
 * State transitions are short, version-fenced persistence operations. Provider
 * calls run only after `claimAvailable` commits. Replay authorization and its
 * append-only audit event belong in the production adapter/application layer.
 */
export interface DurableJobRepository {
  enqueue(input: EnqueueDurableJob): Promise<EnqueueDurableJobResult>;
  get(jobId: string): Promise<DurableJob | null>;
  claimAvailable(input: ClaimDurableJobs): Promise<DurableJob[]>;
  complete(input: CompleteDurableJob): Promise<CompleteDurableJobResult>;
  fail(input: FailDurableJob): Promise<FailDurableJobResult>;
  recoverExpiredLeases(
    input: RecoverExpiredDurableJobLeases,
  ): Promise<RecoveredDurableJob[]>;
  listDead(input: ListDeadDurableJobs): Promise<DurableJob[]>;
  replayDead(input: ReplayDeadDurableJob): Promise<ReplayDeadDurableJobResult>;
}
