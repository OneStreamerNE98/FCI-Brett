export const DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS = 10;
export const DEVELOPMENT_RATE_LIMIT_WINDOW_MS = 60_000;

export const DEVELOPMENT_RATE_LIMIT_SCOPES = [
  "assistant",
  "uploads",
  "google-sheets-sync",
  "project-drive-provisioning",
] as const;

export type DevelopmentRateLimitScope = (typeof DEVELOPMENT_RATE_LIMIT_SCOPES)[number];

type FixedWindow = {
  startedAt: number;
  requestCount: number;
};

type DevelopmentRequestRateLimiterOptions = {
  now?: () => number;
};

const RATE_LIMIT_ERROR = {
  error: "Too many requests. Try again shortly.",
  code: "rate_limited",
} as const;

function normalizedOfficeUserEmail(email: string) {
  return email.trim().toLowerCase();
}

function deniedResponse(retryAfterSeconds: number) {
  return Response.json(RATE_LIMIT_ERROR, {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

/**
 * Creates a per-process fixed-window limiter for the controlled development surface.
 * A null result deliberately leaves the route's existing response completely untouched.
 */
export function createDevelopmentRequestRateLimiter(
  options: DevelopmentRequestRateLimiterOptions = {},
) {
  const now = options.now ?? Date.now;
  const windows = new Map<string, FixedWindow>();

  return {
    check(scope: DevelopmentRateLimitScope, officeUserEmail: string): Response | null {
      const checkedAt = now();
      const startedAt = Math.floor(checkedAt / DEVELOPMENT_RATE_LIMIT_WINDOW_MS)
        * DEVELOPMENT_RATE_LIMIT_WINDOW_MS;
      const key = `${scope}\u0000${normalizedOfficeUserEmail(officeUserEmail)}`;
      const current = windows.get(key);

      if (!current || current.startedAt !== startedAt) {
        windows.set(key, { startedAt, requestCount: 1 });
        return null;
      }

      if (current.requestCount < DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS) {
        current.requestCount += 1;
        return null;
      }

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((startedAt + DEVELOPMENT_RATE_LIMIT_WINDOW_MS - checkedAt) / 1_000),
      );
      return deniedResponse(retryAfterSeconds);
    },
  };
}

const developmentRequestRateLimiter = createDevelopmentRequestRateLimiter();

export function enforceDevelopmentRequestRateLimit(
  scope: DevelopmentRateLimitScope,
  officeUserEmail: string,
) {
  return developmentRequestRateLimiter.check(scope, officeUserEmail);
}
