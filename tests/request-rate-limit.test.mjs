import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createEmployeeRequestRateLimit,
  RequestRateLimitExceeded,
} from "../app/platform/google-cloud/request-rate-limit.ts";

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function dispatch(userId, occurredAt, overrides = {}) {
  return {
    context: {
      userId,
      email: userId === USER_A
        ? "admincrm@cherryhillfci.com"
        : "office@cherryhillfci.com",
    },
    operation: "dashboard.view",
    projectId: null,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    occurredAt,
    ...overrides,
  };
}

test("production limiter enforces a per-user token bucket with exact refill timing", async () => {
  const audits = [];
  const limit = createEmployeeRequestRateLimit({
    config: { capacity: 2, refillTokens: 1, refillIntervalMs: 1_000 },
    audit: {
      async append(event) {
        audits.push(event);
        return { id: event.id };
      },
    },
    newId: randomUUID,
  });

  await limit(dispatch(USER_A, NOW));
  await limit(dispatch(USER_A, NOW));
  await assert.rejects(
    limit(dispatch(USER_A, NOW)),
    (error) => error instanceof RequestRateLimitExceeded
      && error.retryAfterSeconds === 1,
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0].executorUserId, USER_A);
  assert.equal(audits[0].action, "security.request_rate_limited");
  assert.equal(audits[0].reasonCode, "rate_limit_exceeded");
  assert.equal(audits[0].metadata.retry_after_seconds, 1);

  await limit(dispatch(USER_B, NOW));
  await limit(dispatch(USER_A, NOW + 1_000));
  assert.equal(audits.length, 1);
});

test("production limiter reports fractional refill as integer Retry-After seconds", async () => {
  const audits = [];
  const limit = createEmployeeRequestRateLimit({
    config: { capacity: 1, refillTokens: 1, refillIntervalMs: 10_000 },
    audit: {
      async append(event) {
        audits.push(event);
        return { id: event.id };
      },
    },
    newId: randomUUID,
  });

  await limit(dispatch(USER_A, NOW));
  await assert.rejects(
    limit(dispatch(USER_A, NOW + 2_001)),
    (error) => error instanceof RequestRateLimitExceeded
      && error.retryAfterSeconds === 8,
  );
  assert.equal(audits[0].metadata.retry_after_seconds, 8);
});

test("production limiter refuses invalid injected config and propagates audit failure", async () => {
  assert.throws(
    () => createEmployeeRequestRateLimit({
      config: { capacity: 1, refillTokens: 2, refillIntervalMs: 1_000 },
      audit: { append: async () => ({ id: randomUUID() }) },
      newId: randomUUID,
    }),
    /configuration is invalid/,
  );

  const auditError = new Error("FCI TEST — DO NOT USE audit unavailable");
  const limit = createEmployeeRequestRateLimit({
    config: { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000 },
    audit: {
      async append() {
        throw auditError;
      },
    },
    newId: randomUUID,
  });
  await limit(dispatch(USER_A, NOW));
  await assert.rejects(limit(dispatch(USER_A, NOW)), auditError);
});

test("documents the closed production policy and the exact development cost routes", async () => {
  const document = await readFile(
    new URL("../docs/request-rate-limiting.md", import.meta.url),
    "utf8",
  );

  for (const contract of [
    "FCI_REQUEST_RATE_LIMIT_CAPACITY",
    "FCI_REQUEST_RATE_LIMIT_REFILL_TOKENS",
    "FCI_REQUEST_RATE_LIMIT_REFILL_INTERVAL_MS",
    "there is no\ndisable switch",
    "process-local",
    "POST /api/v1/assistant",
    "POST /api/v1/uploads",
    "POST /api/v1/integrations/google/sheets/sync",
    "POST /api/v1/projects/:projectId/drive",
    "does not deploy either surface",
  ]) {
    assert.match(document, new RegExp(contract.replaceAll("/", "\\/")));
  }
});
