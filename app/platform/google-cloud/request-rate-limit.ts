import type {
  AuthorizedEmployeeDispatch,
} from "../../application/authorization-service";
import type { SecurityAuditRepository } from "../../ports/security-audit";
import type {
  ProductionRequestRateLimitConfig,
} from "./production-config";

type TokenBucket = {
  tokens: number;
  refilledAt: number;
};

export type EmployeeRequestRateLimitDependencies = Readonly<{
  config: ProductionRequestRateLimitConfig;
  audit: SecurityAuditRepository;
  newId: () => string;
}>;

export class RequestRateLimitExceeded extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("request_rate_limit_exceeded");
    this.name = "RequestRateLimitExceeded";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function assertConfig(config: ProductionRequestRateLimitConfig) {
  if (
    !Number.isSafeInteger(config.capacity)
    || config.capacity < 1
    || config.capacity > 1_000
    || !Number.isSafeInteger(config.refillTokens)
    || config.refillTokens < 1
    || config.refillTokens > config.capacity
    || !Number.isSafeInteger(config.refillIntervalMs)
    || config.refillIntervalMs < 1_000
    || config.refillIntervalMs > 3_600_000
  ) {
    throw new TypeError("Employee request rate-limit configuration is invalid");
  }
}

/**
 * Creates one per-process token bucket keyed by the durable employee user ID.
 * State mutates synchronously before any audit await, so concurrent requests
 * cannot overdraw one instance's bucket. Cross-instance aggregation is an
 * explicit deployment-budget limitation, not a global quota claim.
 */
export function createEmployeeRequestRateLimit(
  dependencies: EmployeeRequestRateLimitDependencies,
) {
  assertConfig(dependencies.config);
  const { capacity, refillTokens, refillIntervalMs } = dependencies.config;
  const refillPerMillisecond = refillTokens / refillIntervalMs;
  const buckets = new Map<string, TokenBucket>();

  return async function beforeEmployeeDispatch(
    request: AuthorizedEmployeeDispatch,
  ): Promise<void> {
    if (!Number.isSafeInteger(request.occurredAt) || request.occurredAt < 0) {
      throw new TypeError("Rate-limit time must be a nonnegative epoch-millisecond value");
    }

    const previous = buckets.get(request.context.userId) ?? {
      tokens: capacity,
      refilledAt: request.occurredAt,
    };
    const effectiveAt = Math.max(previous.refilledAt, request.occurredAt);
    const tokens = Math.min(
      capacity,
      previous.tokens + ((effectiveAt - previous.refilledAt) * refillPerMillisecond),
    );

    if (tokens >= 1) {
      buckets.set(request.context.userId, {
        tokens: tokens - 1,
        refilledAt: effectiveAt,
      });
      return;
    }

    buckets.set(request.context.userId, { tokens, refilledAt: effectiveAt });
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(((1 - tokens) / refillPerMillisecond) / 1_000),
    );
    await dependencies.audit.append({
      id: dependencies.newId(),
      executorType: "user",
      executorUserId: request.context.userId,
      executorKey: request.context.email,
      originatingUserId: null,
      originatingActorKey: null,
      action: "security.request_rate_limited",
      targetType: "operation",
      targetId: request.operation,
      result: "denied",
      reasonCode: "rate_limit_exceeded",
      requestId: request.requestId,
      correlationId: request.correlationId,
      source: "request_rate_limit",
      metadata: {
        capacity,
        refill_tokens: refillTokens,
        refill_interval_ms: refillIntervalMs,
        project_scoped: request.projectId !== null,
        retry_after_seconds: retryAfterSeconds,
      },
      occurredAt: request.occurredAt,
      retentionPolicyKey: "security_audit",
      retentionUntil: null,
    });
    throw new RequestRateLimitExceeded(retryAfterSeconds);
  };
}
