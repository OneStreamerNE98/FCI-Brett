import assert from "node:assert/strict";
import test from "node:test";

import {
  isProviderActionQueued,
  providerActionQueued,
  ProviderDegradedError,
} from "../app/platform/google-cloud/provider-action-contract.ts";

test("queued provider acknowledgments normalize only bounded safe operation IDs", () => {
  assert.deepEqual(providerActionQueued("  operation-123  "), {
    outcome: "queued",
    operationId: "operation-123",
  });
  assert.equal(isProviderActionQueued({
    outcome: "queued",
    operationId: "operation-123",
  }), true);

  for (const operationId of [
    "",
    " ",
    "operation\n123",
    `x${"\u007f"}y`,
    "x".repeat(256),
  ]) {
    assert.throws(
      () => providerActionQueued(operationId),
      /1 to 255 safe characters/,
    );
    assert.equal(isProviderActionQueued({
      outcome: "queued",
      operationId,
    }), false);
  }
  assert.equal(isProviderActionQueued({
    outcome: "queued",
    operationId: " operation-123 ",
  }), false);
});

test("provider degradation requires exact retryability and a bounded retry delay", () => {
  const retryable = new ProviderDegradedError({
    retryable: true,
    retryAfterSeconds: 37,
  });
  assert.equal(retryable.retryable, true);
  assert.equal(retryable.retryAfterSeconds, 37);

  const terminal = new ProviderDegradedError({ retryable: false });
  assert.equal(terminal.retryable, false);
  assert.equal(terminal.retryAfterSeconds, null);

  assert.throws(
    () => new ProviderDegradedError({ retryable: "yes" }),
    /must be a boolean/,
  );
  for (const retryAfterSeconds of [0, 86_401, 1.5]) {
    assert.throws(
      () => new ProviderDegradedError({
        retryable: true,
        retryAfterSeconds,
      }),
      /integer from 1 to 86400 seconds/,
    );
  }
});
