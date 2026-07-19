import type {
  ClaimDurableJobs,
  CompleteDurableJob,
  CompleteDurableJobResult,
  DurableJob,
  DurableJobFailure,
  DurableJobRepository,
  EnqueueDurableJob,
  EnqueueDurableJobResult,
  FailDurableJob,
  FailDurableJobResult,
  ListDeadDurableJobs,
  RecoverExpiredDurableJobLeases,
  RecoveredDurableJob,
  ReplayDeadDurableJob,
  ReplayDeadDurableJobResult,
} from "../../ports/durable-job.ts";
import {
  memoryCanonicalJsonObject,
  memoryDuration,
  memoryJsonObject,
  memoryKey,
  memoryPositiveInteger,
  memoryText,
  memoryTime,
  memoryUuid,
  memoryVersion,
  nextMemoryVersion,
} from "./contract-values.ts";

type StoredJob = {
  job: DurableJob;
  fingerprint: string;
};

export type MemoryDurableJobRepositoryOptions = Readonly<{
  now?: () => number;
}>;

function failureValue(value: DurableJobFailure): DurableJobFailure {
  const disposition = value?.disposition;
  if (
    disposition !== "retryable"
    && disposition !== "reauthorization_required"
    && disposition !== "permanent"
  ) {
    throw new TypeError("Job failure disposition is invalid");
  }
  return Object.freeze({
    code: memoryKey(value.code, "Job failure code"),
    message: memoryText(value.message, "Job failure message", 4_000),
    disposition,
  });
}

function snapshot(job: DurableJob): DurableJob {
  return Object.freeze({
    ...job,
    payload: memoryJsonObject(job.payload, "Job payload"),
    lastFailure: job.lastFailure ? failureValue(job.lastFailure) : null,
  });
}

function inputFingerprint(input: EnqueueDurableJob): string {
  return JSON.stringify({
    jobType: input.jobType,
    actorKey: input.actorKey,
    correlationId: input.correlationId,
    payload: memoryCanonicalJsonObject(input.payload, "Job payload"),
  });
}

function jobId(value: unknown) {
  return memoryUuid(value, "Job ID");
}

function jobVersion(value: unknown) {
  return memoryVersion(value, "Expected job version");
}

/** Local-only fake for exercising the durable job/failure/replay contract. */
export class MemoryDurableJobRepository implements DurableJobRepository {
  readonly #jobs = new Map<string, StoredJob>();
  readonly #jobIdsByKey = new Map<string, string>();
  readonly #now: () => number;

  constructor(options: MemoryDurableJobRepositoryOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  #currentTime() {
    return memoryTime(this.#now(), "Memory job clock");
  }

  #replace(id: string, job: DurableJob) {
    const stored = this.#jobs.get(id);
    if (!stored) throw new Error("Memory job disappeared during a state transition");
    stored.job = job;
    return snapshot(job);
  }

  async enqueue(input: EnqueueDurableJob): Promise<EnqueueDurableJobResult> {
    const id = jobId(input.id);
    const jobKey = memoryText(input.jobKey, "Job key", 512);
    const jobType = memoryKey(input.jobType, "Job type");
    const actorKey = memoryText(input.actorKey, "Job actor key", 255);
    const correlationId = memoryText(input.correlationId, "Job correlation ID", 255);
    const payload = memoryJsonObject(input.payload, "Job payload");
    const availableAt = memoryTime(input.availableAt, "Job available_at");
    const createdAt = memoryTime(input.createdAt, "Job created_at");
    if (availableAt < createdAt) {
      throw new TypeError("Job available_at cannot precede created_at");
    }
    const fingerprint = inputFingerprint({
      ...input,
      id,
      jobKey,
      jobType,
      actorKey,
      correlationId,
      payload,
      availableAt,
      createdAt,
    });
    const existingId = this.#jobIdsByKey.get(jobKey);
    const existingById = this.#jobs.get(id);
    const existing = existingId ? this.#jobs.get(existingId) : existingById;
    if (existing) {
      if (
        existing.job.id === id
        && existing.job.jobKey === jobKey
        && existing.fingerprint === fingerprint
      ) {
        return { outcome: "already-enqueued", job: snapshot(existing.job) };
      }
      return { outcome: "conflict" };
    }

    const job = Object.freeze({
      id,
      jobKey,
      jobType,
      actorKey,
      correlationId,
      payload,
      status: "pending" as const,
      availableAt,
      attemptCount: 0,
      leaseExpiresAt: null,
      lastFailure: null,
      completedAt: null,
      deadLetteredAt: null,
      createdAt,
      updatedAt: createdAt,
      version: "1",
    });
    this.#jobs.set(id, { job, fingerprint });
    this.#jobIdsByKey.set(jobKey, id);
    return { outcome: "enqueued", job: snapshot(job) };
  }

  async get(value: string): Promise<DurableJob | null> {
    const stored = this.#jobs.get(jobId(value));
    return stored ? snapshot(stored.job) : null;
  }

  async claimAvailable(input: ClaimDurableJobs): Promise<DurableJob[]> {
    const batchSize = memoryPositiveInteger(input.batchSize, "Job claim batch size", 100);
    const leaseDurationMs = memoryDuration(input.leaseDurationMs, "Job lease duration");
    if (leaseDurationMs === 0) throw new TypeError("Job lease duration must be positive");
    const now = this.#currentTime();
    const available = [...this.#jobs.values()]
      .map(({ job }) => job)
      .filter((job) => job.status === "pending" && job.availableAt <= now)
      .sort((left, right) =>
        left.availableAt - right.availableAt
        || left.createdAt - right.createdAt
        || left.id.localeCompare(right.id))
      .slice(0, batchSize);

    return available.map((job) => this.#replace(job.id, Object.freeze({
      ...job,
      status: "processing" as const,
      attemptCount: job.attemptCount + 1,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: now,
      version: nextMemoryVersion(job.version),
    })));
  }

  async complete(input: CompleteDurableJob): Promise<CompleteDurableJobResult> {
    const id = jobId(input.jobId);
    const expectedVersion = jobVersion(input.expectedVersion);
    const stored = this.#jobs.get(id);
    if (!stored || stored.job.status !== "processing" || stored.job.version !== expectedVersion) {
      return { outcome: "stale" };
    }
    const now = this.#currentTime();
    const job = this.#replace(id, Object.freeze({
      ...stored.job,
      status: "completed" as const,
      leaseExpiresAt: null,
      completedAt: now,
      deadLetteredAt: null,
      updatedAt: now,
      version: nextMemoryVersion(stored.job.version),
    }));
    return { outcome: "completed", job };
  }

  #failTransition(
    stored: StoredJob,
    failure: DurableJobFailure,
    retryDelayMs: number,
    maxAttempts: number,
    now: number,
  ): FailDurableJobResult {
    const shouldRetry =
      failure.disposition === "retryable"
      && stored.job.attemptCount < maxAttempts;
    const job = this.#replace(stored.job.id, Object.freeze({
      ...stored.job,
      status: shouldRetry ? "pending" as const : "dead" as const,
      availableAt: shouldRetry ? now + retryDelayMs : stored.job.availableAt,
      leaseExpiresAt: null,
      lastFailure: failure,
      completedAt: null,
      deadLetteredAt: shouldRetry ? null : now,
      updatedAt: now,
      version: nextMemoryVersion(stored.job.version),
    }));
    return shouldRetry
      ? { outcome: "retry", job }
      : { outcome: "dead-lettered", job };
  }

  async fail(input: FailDurableJob): Promise<FailDurableJobResult> {
    const id = jobId(input.jobId);
    const expectedVersion = jobVersion(input.expectedVersion);
    const retryDelayMs = memoryDuration(input.retryDelayMs, "Job retry delay");
    const maxAttempts = memoryPositiveInteger(input.maxAttempts, "Job maximum attempts", 100);
    const failure = failureValue(input.failure);
    const stored = this.#jobs.get(id);
    if (!stored || stored.job.status !== "processing" || stored.job.version !== expectedVersion) {
      return { outcome: "stale" };
    }
    return this.#failTransition(stored, failure, retryDelayMs, maxAttempts, this.#currentTime());
  }

  async recoverExpiredLeases(
    input: RecoverExpiredDurableJobLeases,
  ): Promise<RecoveredDurableJob[]> {
    const batchSize = memoryPositiveInteger(input.batchSize, "Lease recovery batch size", 100);
    const retryDelayMs = memoryDuration(input.retryDelayMs, "Lease recovery delay");
    const maxAttempts = memoryPositiveInteger(input.maxAttempts, "Job maximum attempts", 100);
    const now = this.#currentTime();
    const expired = [...this.#jobs.values()]
      .filter(({ job }) =>
        job.status === "processing"
        && job.leaseExpiresAt !== null
        && job.leaseExpiresAt <= now)
      .sort((left, right) =>
        (left.job.leaseExpiresAt ?? 0) - (right.job.leaseExpiresAt ?? 0)
        || left.job.id.localeCompare(right.job.id))
      .slice(0, batchSize);
    const failure = failureValue({
      code: "lease_expired",
      message: "Worker lease expired before completion.",
      disposition: "retryable",
    });

    return expired.map((stored) => {
      const result = this.#failTransition(stored, failure, retryDelayMs, maxAttempts, now);
      if (result.outcome === "stale") {
        throw new Error("Memory lease recovery became stale unexpectedly");
      }
      return { job: result.job, outcome: result.outcome === "retry" ? "retry" : "dead-lettered" };
    });
  }

  async listDead(input: ListDeadDurableJobs): Promise<DurableJob[]> {
    const limit = memoryPositiveInteger(input.limit, "Dead job list limit", 100);
    return [...this.#jobs.values()]
      .map(({ job }) => job)
      .filter((job) => job.status === "dead")
      .sort((left, right) =>
        (right.deadLetteredAt ?? 0) - (left.deadLetteredAt ?? 0)
        || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(snapshot);
  }

  async replayDead(input: ReplayDeadDurableJob): Promise<ReplayDeadDurableJobResult> {
    const id = jobId(input.jobId);
    const expectedVersion = jobVersion(input.expectedVersion);
    const retryDelayMs = memoryDuration(input.retryDelayMs, "Replay delay");
    const requestedByActorKey = memoryText(
      input.requestedByActorKey,
      "Replay actor key",
      255,
    );
    const reason = memoryText(input.reason, "Replay reason", 1_000);
    const correlationId = memoryText(input.correlationId, "Replay correlation ID", 255);
    const stored = this.#jobs.get(id);
    if (
      !stored
      || stored.job.status !== "dead"
      || stored.job.version !== expectedVersion
      || !stored.job.lastFailure
    ) {
      return { outcome: "stale" };
    }
    const now = this.#currentTime();
    const previousFailure = failureValue(stored.job.lastFailure);
    const job = this.#replace(id, Object.freeze({
      ...stored.job,
      status: "pending" as const,
      availableAt: now + retryDelayMs,
      attemptCount: 0,
      leaseExpiresAt: null,
      completedAt: null,
      deadLetteredAt: null,
      updatedAt: now,
      version: nextMemoryVersion(stored.job.version),
    }));
    return {
      outcome: "replayed",
      job,
      evidence: Object.freeze({
        jobId: id,
        requestedByActorKey,
        reason,
        correlationId,
        requestedAt: now,
        previousFailure,
      }),
    };
  }
}
