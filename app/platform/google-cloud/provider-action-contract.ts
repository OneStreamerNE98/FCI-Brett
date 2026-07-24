export type ProviderActionQueued = Readonly<{
  outcome: "queued";
  operationId: string;
}>;

const SAFE_OPERATION_ID = /^[^\u0000-\u001f\u007f]{1,255}$/;

function normalizedOperationId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized === value && SAFE_OPERATION_ID.test(normalized)
    ? normalized
    : null;
}

/**
 * A queue callback may return this value only after its durable intent commits.
 * The HTTP layer then acknowledges the intent with 202 and does not ask the
 * caller to submit the same side effect again.
 */
export function providerActionQueued(operationId: string): ProviderActionQueued {
  const normalized = operationId.trim();
  if (!SAFE_OPERATION_ID.test(normalized)) {
    throw new TypeError(
      "Queued provider operation ID must be 1 to 255 safe characters",
    );
  }
  return Object.freeze({ outcome: "queued", operationId: normalized });
}

export function isProviderActionQueued(
  value: unknown,
): value is ProviderActionQueued {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.outcome === "queued"
    && normalizedOperationId(candidate.operationId) !== null;
}

export class ProviderDegradedError extends Error {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(input: Readonly<{
    retryable: boolean;
    retryAfterSeconds?: number;
  }>) {
    super("The composed provider is temporarily unavailable");
    this.name = "ProviderDegradedError";
    if (typeof input.retryable !== "boolean") {
      throw new TypeError("Provider retryability must be a boolean");
    }
    this.retryable = input.retryable;
    const retryAfterSeconds = input.retryAfterSeconds;
    if (
      retryAfterSeconds !== undefined
      && (
        !Number.isSafeInteger(retryAfterSeconds)
        || retryAfterSeconds < 1
        || retryAfterSeconds > 86_400
      )
    ) {
      throw new TypeError("Provider retry delay must be an integer from 1 to 86400 seconds");
    }
    this.retryAfterSeconds = retryAfterSeconds ?? null;
  }
}
