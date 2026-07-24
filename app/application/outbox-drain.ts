import {
  OUTBOX_EVENT_TYPES,
  type ClaimedOutboxEvent,
  type OutboxEventType,
  type OutboxRepository,
} from "../ports/outbox-repository.ts";

export const OUTBOX_DRAIN_DEFAULTS = Object.freeze({
  batchSize: 25,
  maxBatches: 20,
  leaseDurationMs: 60_000,
  retryDelayMs: 30_000,
  maxAttempts: 5,
});

export type OutboxEventDispatcher = (
  event: ClaimedOutboxEvent,
) => Promise<void>;

export type OutboxDispatcherRegistry = Readonly<{
  isEmpty: boolean;
  dispatch(event: ClaimedOutboxEvent): Promise<void>;
}>;

export type OutboxDrainOptions = Readonly<{
  batchSize?: number;
  maxBatches?: number;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
}>;

export type OutboxDrainResult = Readonly<{
  active: boolean;
  recoveredForRetry: number;
  recoveredAsDeadLetter: number;
  claimed: number;
  completed: number;
  scheduledForRetry: number;
  deadLettered: number;
  staleTransitions: number;
}>;

export class OutboxDispatchFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryDelayMs: number | null;

  constructor(input: Readonly<{
    code: string;
    message: string;
    retryable: boolean;
    retryDelayMs?: number;
  }>) {
    super(input.message);
    this.name = "OutboxDispatchFailure";
    this.code = input.code;
    this.retryable = input.retryable;
    this.retryDelayMs = input.retryDelayMs ?? null;
  }
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function drainOptions(options: OutboxDrainOptions) {
  return Object.freeze({
    batchSize: boundedInteger(
      options.batchSize ?? OUTBOX_DRAIN_DEFAULTS.batchSize,
      "Outbox drain batch size",
      1,
      100,
    ),
    maxBatches: boundedInteger(
      options.maxBatches ?? OUTBOX_DRAIN_DEFAULTS.maxBatches,
      "Outbox drain maximum batches",
      1,
      100,
    ),
    leaseDurationMs: boundedInteger(
      options.leaseDurationMs ?? OUTBOX_DRAIN_DEFAULTS.leaseDurationMs,
      "Outbox drain lease duration",
      1,
      60 * 60 * 1_000,
    ),
    retryDelayMs: boundedInteger(
      options.retryDelayMs ?? OUTBOX_DRAIN_DEFAULTS.retryDelayMs,
      "Outbox drain retry delay",
      0,
      7 * 24 * 60 * 60 * 1_000,
    ),
    maxAttempts: boundedInteger(
      options.maxAttempts ?? OUTBOX_DRAIN_DEFAULTS.maxAttempts,
      "Outbox drain maximum attempts",
      1,
      100,
    ),
  });
}

function emptyResult(): OutboxDrainResult {
  return Object.freeze({
    active: false,
    recoveredForRetry: 0,
    recoveredAsDeadLetter: 0,
    claimed: 0,
    completed: 0,
    scheduledForRetry: 0,
    deadLettered: 0,
    staleTransitions: 0,
  });
}

/**
 * A non-empty registry must cover every event type the repository can claim.
 * This prevents a partially composed worker from leasing unsupported work.
 */
export function createOutboxDispatcherRegistry(
  dispatchers: Partial<Record<OutboxEventType, OutboxEventDispatcher>>,
): OutboxDispatcherRegistry {
  const configured = OUTBOX_EVENT_TYPES.filter(
    (eventType) => typeof dispatchers[eventType] === "function",
  );
  if (configured.length > 0 && configured.length !== OUTBOX_EVENT_TYPES.length) {
    throw new TypeError(
      "An active outbox dispatcher registry must cover every claimable event type",
    );
  }
  const handlers = Object.freeze({ ...dispatchers });
  return Object.freeze({
    isEmpty: configured.length === 0,
    async dispatch(event: ClaimedOutboxEvent) {
      const handler = handlers[event.eventType];
      if (!handler) {
        throw new Error("The outbox dispatcher registry is inert");
      }
      await handler(event);
    },
  });
}

/**
 * BE-14 intentionally ships without provider dispatchers. Running the bundled
 * entrypoint against this registry is a no-op and cannot claim durable work.
 */
export const NOOP_OUTBOX_DISPATCHER_REGISTRY =
  createOutboxDispatcherRegistry({});

function dispatchFailure(error: unknown, defaultRetryDelayMs: number) {
  if (error instanceof OutboxDispatchFailure) {
    return {
      errorCode: error.code,
      errorMessage: error.message,
      retryable: error.retryable,
      retryDelayMs: error.retryDelayMs ?? defaultRetryDelayMs,
    };
  }
  return {
    errorCode: "dispatcher_failed",
    errorMessage: "The outbox dispatcher failed without safe provider detail.",
    retryable: true,
    retryDelayMs: defaultRetryDelayMs,
  };
}

export async function drainOutbox(
  repository: OutboxRepository,
  registry: OutboxDispatcherRegistry,
  options: OutboxDrainOptions = {},
): Promise<OutboxDrainResult> {
  if (registry.isEmpty) return emptyResult();
  const configured = drainOptions(options);
  const recovered = await repository.recoverExpiredLeases({
    batchSize: configured.batchSize,
    retryDelayMs: configured.retryDelayMs,
    maxAttempts: configured.maxAttempts,
  });
  const result = {
    active: true,
    recoveredForRetry: recovered.filter(({ outcome }) => outcome === "retry").length,
    recoveredAsDeadLetter: recovered.filter(
      ({ outcome }) => outcome === "dead-lettered",
    ).length,
    claimed: 0,
    completed: 0,
    scheduledForRetry: 0,
    deadLettered: 0,
    staleTransitions: 0,
  };

  for (let batch = 0; batch < configured.maxBatches; batch += 1) {
    const claimed = await repository.claimAvailable({
      batchSize: configured.batchSize,
      leaseDurationMs: configured.leaseDurationMs,
    });
    result.claimed += claimed.length;
    if (claimed.length === 0) break;

    for (const event of claimed) {
      try {
        await registry.dispatch(event);
        const completed = await repository.complete({
          eventId: event.id,
          expectedVersion: event.version,
        });
        if (completed.outcome === "completed") result.completed += 1;
        else result.staleTransitions += 1;
      } catch (error) {
        const failure = dispatchFailure(error, configured.retryDelayMs);
        const transitioned = await repository.retryOrDeadLetter({
          eventId: event.id,
          expectedVersion: event.version,
          retryDelayMs: failure.retryDelayMs,
          maxAttempts: failure.retryable
            ? configured.maxAttempts
            : Math.max(1, event.attemptCount),
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        });
        if (transitioned.outcome === "retry") result.scheduledForRetry += 1;
        else if (transitioned.outcome === "dead-lettered") result.deadLettered += 1;
        else result.staleTransitions += 1;
      }
    }
  }

  return Object.freeze(result);
}
