import {
  OUTBOX_EVENT_TYPES,
  type ClaimedOutboxEvent,
  type OutboxEventType,
  type OutboxRepository,
} from "../ports/outbox-repository.ts";

export const OUTBOX_DRAIN_DEFAULTS = Object.freeze({
  // Claim immediately before one dispatch so later events do not spend their
  // lease waiting behind a slow provider call.
  batchSize: 1,
  maxBatches: 20,
  leaseDurationMs: 60_000,
  retryDelayMs: 30_000,
  maxAttempts: 5,
});

export type OutboxEventDispatcher = (
  event: ClaimedOutboxEvent,
) => Promise<void>;

export type EventKeyIdempotentDispatcher = Readonly<{
  idempotency: "event-key";
  dispatch: OutboxEventDispatcher;
}>;

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

export const OUTBOX_DISPATCH_FAILURE_CLASSIFICATIONS = Object.freeze({
  providerTemporarilyUnavailable: Object.freeze({
    code: "provider_temporarily_unavailable",
    message: "The provider operation can be retried safely.",
    retryable: true,
  }),
  providerRequestRejected: Object.freeze({
    code: "provider_request_rejected",
    message: "The provider rejected the durable operation.",
    retryable: false,
  }),
  providerReauthorizationRequired: Object.freeze({
    code: "provider_reauthorization_required",
    message: "The provider connection requires reauthorization.",
    retryable: false,
  }),
});

export type OutboxDispatchFailureClassification =
  keyof typeof OUTBOX_DISPATCH_FAILURE_CLASSIFICATIONS;

export class OutboxDispatchFailure extends Error {
  readonly classification: OutboxDispatchFailureClassification;
  readonly retryable: boolean;
  readonly retryDelayMs: number | null;

  constructor(input: Readonly<{
    classification: OutboxDispatchFailureClassification;
    retryDelayMs?: number;
  }>) {
    if (
      !Object.hasOwn(
        OUTBOX_DISPATCH_FAILURE_CLASSIFICATIONS,
        input.classification,
      )
    ) {
      throw new TypeError("Outbox dispatcher failure classification is not recognized");
    }
    const evidence = OUTBOX_DISPATCH_FAILURE_CLASSIFICATIONS[input.classification];
    if (
      input.retryDelayMs !== undefined
      && (
        !evidence.retryable
        || !Number.isSafeInteger(input.retryDelayMs)
        || input.retryDelayMs < 0
        || input.retryDelayMs > 7 * 24 * 60 * 60 * 1_000
      )
    ) {
      throw new TypeError(
        "Retryable outbox failure delay must be an integer from 0 to 604800000",
      );
    }
    super(evidence.message);
    this.name = "OutboxDispatchFailure";
    this.classification = input.classification;
    this.retryable = evidence.retryable;
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
      1,
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
  dispatchers: Partial<Record<OutboxEventType, EventKeyIdempotentDispatcher>>,
): OutboxDispatcherRegistry {
  if (
    Reflect.ownKeys(dispatchers).some(
      (eventType) => (
        typeof eventType !== "string"
        || !OUTBOX_EVENT_TYPES.includes(eventType as OutboxEventType)
      ),
    )
  ) {
    throw new TypeError("The outbox dispatcher registry contains an unknown event type");
  }
  const configured = OUTBOX_EVENT_TYPES.filter((eventType) => {
    const dispatcher = dispatchers[eventType];
    if (dispatcher === undefined) return false;
    if (
      !dispatcher
      || dispatcher.idempotency !== "event-key"
      || typeof dispatcher.dispatch !== "function"
    ) {
      throw new TypeError(
        "Outbox dispatchers must declare event-key idempotency before activation",
      );
    }
    return true;
  });
  if (configured.length > 0 && configured.length !== OUTBOX_EVENT_TYPES.length) {
    throw new TypeError(
      "An active outbox dispatcher registry must cover every claimable event type",
    );
  }
  const handlers = Object.freeze(Object.fromEntries(
    configured.map((eventType) => [
      eventType,
      dispatchers[eventType]!.dispatch,
    ]),
  )) as Readonly<Partial<Record<OutboxEventType, OutboxEventDispatcher>>>;
  return Object.freeze({
    isEmpty: configured.length === 0,
    async dispatch(event: ClaimedOutboxEvent) {
      const handler = handlers[event.eventType];
      if (!handler) {
        throw new Error("The outbox dispatcher registry is inert");
      }
      // Provider side effects must deduplicate on this stable eventKey. The
      // repository version fence protects database transitions, but cannot
      // make an already-started external side effect exactly once.
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
  if (
    error instanceof OutboxDispatchFailure
    && Object.hasOwn(
      OUTBOX_DISPATCH_FAILURE_CLASSIFICATIONS,
      error.classification,
    )
  ) {
    const evidence = OUTBOX_DISPATCH_FAILURE_CLASSIFICATIONS[
      error.classification
    ];
    if (!evidence) {
      return {
        errorCode: "dispatcher_failed",
        errorMessage: "The outbox dispatcher failed without safe provider detail.",
        retryable: true,
        retryDelayMs: defaultRetryDelayMs,
      };
    }
    const retryDelayMs = (
      evidence.retryable
      && Number.isSafeInteger(error.retryDelayMs)
      && error.retryDelayMs !== null
      && error.retryDelayMs >= 0
      && error.retryDelayMs <= 7 * 24 * 60 * 60 * 1_000
    )
      ? error.retryDelayMs
      : defaultRetryDelayMs;
    return {
      errorCode: evidence.code,
      errorMessage: evidence.message,
      retryable: evidence.retryable,
      retryDelayMs,
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
