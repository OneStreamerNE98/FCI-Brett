import assert from "node:assert/strict";
import test from "node:test";

import {
  createOutboxDispatcherRegistry,
  drainOutbox,
  NOOP_OUTBOX_DISPATCHER_REGISTRY,
  OutboxDispatchFailure,
} from "../app/application/outbox-drain.ts";
import {
  OUTBOX_EVENT_TYPES,
} from "../app/ports/outbox-repository.ts";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_VERSION = "9007199254740993";

function claimedEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    eventKey: "client.created:test",
    eventType: "client.created",
    clientId: "22222222-2222-4222-8222-222222222222",
    projectId: null,
    leadId: null,
    actorId: "admincrm@cherryhillfci.com",
    correlationId: "correlation-test",
    payload: { recordId: "22222222-2222-4222-8222-222222222222" },
    availableAt: 1_721_310_000_000,
    attemptCount: 2,
    leaseExpiresAt: 1_721_310_060_000,
    createdAt: 1_721_300_000_000,
    version: EVENT_VERSION,
    ...overrides,
  };
}

function completeRegistry(dispatch) {
  return createOutboxDispatcherRegistry(
    Object.fromEntries(OUTBOX_EVENT_TYPES.map((eventType) => [eventType, dispatch])),
  );
}

function fakeRepository(options = {}) {
  const calls = {
    recover: [],
    claim: [],
    dispatch: [],
    complete: [],
    fail: [],
  };
  const events = options.events ?? [claimedEvent()];
  let claimIndex = 0;
  return {
    calls,
    repository: {
      async recoverExpiredLeases(input) {
        calls.recover.push(input);
        return options.recovered ?? [];
      },
      async claimAvailable(input) {
        calls.claim.push(input);
        const batch = options.claimBatches
          ? (options.claimBatches[claimIndex] ?? [])
          : (claimIndex === 0 ? events : []);
        claimIndex += 1;
        return batch;
      },
      async complete(input) {
        calls.complete.push(input);
        return options.completeResult ?? {
          outcome: "completed",
          version: "9007199254740994",
          completedAt: 1_721_310_001_000,
        };
      },
      async retryOrDeadLetter(input) {
        calls.fail.push(input);
        if (options.failureResult) return options.failureResult;
        const event = events.find(({ id }) => id === input.eventId);
        if (event && event.attemptCount >= input.maxAttempts) {
          return {
            outcome: "dead-lettered",
            version: "9007199254740994",
            deadLetteredAt: 1_721_310_001_000,
          };
        }
        return {
          outcome: "retry",
          version: "9007199254740994",
          availableAt: 1_721_310_030_000,
        };
      },
    },
  };
}

test("an empty dispatcher registry is inert and never touches the outbox repository", async () => {
  const calls = [];
  const fail = async (name) => {
    calls.push(name);
    throw new Error(`unexpected ${name}`);
  };
  const result = await drainOutbox({
    recoverExpiredLeases: () => fail("recover"),
    claimAvailable: () => fail("claim"),
    complete: () => fail("complete"),
    retryOrDeadLetter: () => fail("failure"),
  }, NOOP_OUTBOX_DISPATCHER_REGISTRY);

  assert.deepEqual(result, {
    active: false,
    recoveredForRetry: 0,
    recoveredAsDeadLetter: 0,
    claimed: 0,
    completed: 0,
    scheduledForRetry: 0,
    deadLettered: 0,
    staleTransitions: 0,
  });
  assert.deepEqual(calls, []);
});

test("an active registry must cover every claimable event type", () => {
  assert.throws(
    () => createOutboxDispatcherRegistry({
      "client.created": async () => {},
    }),
    /must cover every claimable event type/,
  );
  assert.equal(
    completeRegistry(async () => {}).isEmpty,
    false,
  );
});

test("the drain recovers leases, claims a bounded batch, dispatches, and completes with the claim fence", async () => {
  const fake = fakeRepository({
    recovered: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        outcome: "retry",
        version: "4",
        availableAt: 1_721_310_030_000,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        outcome: "dead-lettered",
        version: "8",
        deadLetteredAt: 1_721_310_000_000,
      },
    ],
  });
  const dispatched = [];
  const result = await drainOutbox(
    fake.repository,
    completeRegistry(async (event) => {
      dispatched.push(event);
    }),
    {
      batchSize: 7,
      leaseDurationMs: 45_000,
      retryDelayMs: 12_000,
      maxAttempts: 6,
    },
  );

  assert.deepEqual(fake.calls.recover, [{
    batchSize: 7,
    retryDelayMs: 12_000,
    maxAttempts: 6,
  }]);
  assert.deepEqual(fake.calls.claim, [
    { batchSize: 7, leaseDurationMs: 45_000 },
    { batchSize: 7, leaseDurationMs: 45_000 },
  ]);
  assert.deepEqual(dispatched, [claimedEvent()]);
  assert.deepEqual(fake.calls.complete, [{
    eventId: EVENT_ID,
    expectedVersion: EVENT_VERSION,
  }]);
  assert.deepEqual(fake.calls.fail, []);
  assert.deepEqual(result, {
    active: true,
    recoveredForRetry: 1,
    recoveredAsDeadLetter: 1,
    claimed: 1,
    completed: 1,
    scheduledForRetry: 0,
    deadLettered: 0,
    staleTransitions: 0,
  });
});

test("the drain iterates until empty but stops at the configured batch ceiling", async () => {
  const second = claimedEvent({
    id: "77777777-7777-4777-8777-777777777777",
    eventKey: "lead.created:test",
    eventType: "lead.created",
    clientId: null,
    leadId: "88888888-8888-4888-8888-888888888888",
    version: "20",
  });
  const unclaimed = claimedEvent({
    id: "99999999-9999-4999-8999-999999999999",
    eventKey: "project.meeting.created:test",
    eventType: "project.meeting.created",
    clientId: null,
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: "30",
  });
  const fake = fakeRepository({
    claimBatches: [[claimedEvent()], [second], [unclaimed], []],
  });
  const dispatched = [];
  const result = await drainOutbox(
    fake.repository,
    completeRegistry(async (event) => {
      dispatched.push(event.id);
    }),
    { batchSize: 1, maxBatches: 2 },
  );

  assert.deepEqual(dispatched, [EVENT_ID, second.id]);
  assert.equal(fake.calls.claim.length, 2);
  assert.equal(result.claimed, 2);
  assert.equal(result.completed, 2);
  assert.equal(dispatched.includes(unclaimed.id), false);
});

test("retryable dispatcher failures schedule a bounded retry with safe evidence", async () => {
  const fake = fakeRepository();
  const result = await drainOutbox(
    fake.repository,
    completeRegistry(async () => {
      throw new OutboxDispatchFailure({
        code: "google_temporarily_unavailable",
        message: "The provider can be retried safely.",
        retryable: true,
        retryDelayMs: 17_000,
      });
    }),
    { maxAttempts: 5, retryDelayMs: 30_000 },
  );

  assert.deepEqual(fake.calls.complete, []);
  assert.deepEqual(fake.calls.fail, [{
    eventId: EVENT_ID,
    expectedVersion: EVENT_VERSION,
    retryDelayMs: 17_000,
    maxAttempts: 5,
    errorCode: "google_temporarily_unavailable",
    errorMessage: "The provider can be retried safely.",
  }]);
  assert.equal(result.scheduledForRetry, 1);
  assert.equal(result.deadLettered, 0);
});

test("non-retryable dispatcher failures dead-letter at the claimed attempt", async () => {
  const fake = fakeRepository();
  const result = await drainOutbox(
    fake.repository,
    completeRegistry(async () => {
      throw new OutboxDispatchFailure({
        code: "provider_request_invalid",
        message: "The provider rejected the durable payload.",
        retryable: false,
      });
    }),
    { maxAttempts: 9, retryDelayMs: 42_000 },
  );

  assert.deepEqual(fake.calls.fail, [{
    eventId: EVENT_ID,
    expectedVersion: EVENT_VERSION,
    retryDelayMs: 42_000,
    maxAttempts: 2,
    errorCode: "provider_request_invalid",
    errorMessage: "The provider rejected the durable payload.",
  }]);
  assert.equal(result.scheduledForRetry, 0);
  assert.equal(result.deadLettered, 1);
});

test("unknown dispatcher errors persist generic evidence instead of exception detail", async () => {
  const fake = fakeRepository();
  await drainOutbox(
    fake.repository,
    completeRegistry(async () => {
      throw new Error("test-only provider access token secret");
    }),
    { retryDelayMs: 8_000 },
  );

  assert.deepEqual(fake.calls.fail[0], {
    eventId: EVENT_ID,
    expectedVersion: EVENT_VERSION,
    retryDelayMs: 8_000,
    maxAttempts: 5,
    errorCode: "dispatcher_failed",
    errorMessage: "The outbox dispatcher failed without safe provider detail.",
  });
  assert.doesNotMatch(JSON.stringify(fake.calls), /access token secret/);
});

test("stale completion and retry transitions are fenced and never counted as delivery", async () => {
  const first = claimedEvent();
  const second = claimedEvent({
    id: "55555555-5555-4555-8555-555555555555",
    eventKey: "project.created:test",
    eventType: "project.created",
    clientId: null,
    projectId: "66666666-6666-4666-8666-666666666666",
    version: "12",
  });
  const fake = fakeRepository({
    events: [first, second],
    completeResult: { outcome: "stale" },
    failureResult: { outcome: "stale" },
  });
  const result = await drainOutbox(
    fake.repository,
    completeRegistry(async (event) => {
      if (event.id === second.id) {
        throw new OutboxDispatchFailure({
          code: "retryable_test",
          message: "Retry later.",
          retryable: true,
        });
      }
    }),
  );

  assert.deepEqual(fake.calls.complete, [{
    eventId: EVENT_ID,
    expectedVersion: EVENT_VERSION,
  }]);
  assert.deepEqual(fake.calls.fail[0], {
    eventId: second.id,
    expectedVersion: "12",
    retryDelayMs: 30_000,
    maxAttempts: 5,
    errorCode: "retryable_test",
    errorMessage: "Retry later.",
  });
  assert.deepEqual(result, {
    active: true,
    recoveredForRetry: 0,
    recoveredAsDeadLetter: 0,
    claimed: 2,
    completed: 0,
    scheduledForRetry: 0,
    deadLettered: 0,
    staleTransitions: 2,
  });
});
