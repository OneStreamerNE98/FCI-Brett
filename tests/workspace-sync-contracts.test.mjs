import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MemoryDurableJobRepository } from "../app/adapters/memory/durable-job.ts";
import { MemoryIntegrationSyncStateRepository } from "../app/adapters/memory/integration-sync-state.ts";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_JOB_ID = "22222222-2222-4222-8222-222222222222";
const GMAIL_RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const CALENDAR_RESOURCE_ID = "55555555-5555-4555-8555-555555555555";
const CALENDAR_CHANNEL_RESOURCE_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_CALENDAR_CHANNEL_RESOURCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GMAIL_CURSOR_ID = "77777777-7777-4777-8777-777777777777";
const CALENDAR_CURSOR_ID = "88888888-8888-4888-8888-888888888888";
const CALENDAR_CHANNEL_CURSOR_ID = "99999999-9999-4999-8999-999999999999";
const SECOND_CALENDAR_CHANNEL_CURSOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function source(path) {
  return readFileSync(`${repositoryRoot}${path}`, "utf8");
}

function jobInput(id = JOB_ID, overrides = {}) {
  return {
    id,
    jobKey: `workspace-sync:${id}`,
    jobType: "workspace.sync",
    actorKey: "system:workspace-sync",
    correlationId: `correlation:${id}`,
    payload: { resourceId: GMAIL_RESOURCE_ID, operation: "incremental_sync" },
    availableAt: 1_000,
    createdAt: 900,
    ...overrides,
  };
}

function ciphertext(seed) {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed + index * 7) % 256);
}

test("durable enqueue is idempotent by job key and protects bounded provider-neutral payloads", async () => {
  const repository = new MemoryDurableJobRepository({ now: () => 1_000 });
  const payload = { operation: "incremental_sync", resourceId: GMAIL_RESOURCE_ID };
  const first = await repository.enqueue(jobInput(JOB_ID, { payload }));
  assert.equal(first.outcome, "enqueued");
  assert.equal(first.job.status, "pending");
  assert.equal(first.job.version, "1");

  payload.operation = "mutated_after_enqueue";
  const replay = await repository.enqueue(jobInput(JOB_ID, {
    payload: { resourceId: GMAIL_RESOURCE_ID, operation: "incremental_sync" },
  }));
  assert.equal(replay.outcome, "already-enqueued");
  assert.equal(replay.job.payload.operation, "incremental_sync");

  const collision = await repository.enqueue(jobInput(JOB_ID, {
    payload: { resourceId: CALENDAR_RESOURCE_ID, operation: "incremental_sync" },
  }));
  assert.deepEqual(collision, { outcome: "conflict" });

  replay.job.payload.operation = "mutated_return_value";
  assert.equal((await repository.get(JOB_ID)).payload.operation, "incremental_sync");
  await assert.rejects(
    repository.enqueue(jobInput(SECOND_JOB_ID, { payload: { accessToken: "unsafe" } })),
    /forbidden field/,
  );
  await assert.rejects(
    repository.enqueue(jobInput(SECOND_JOB_ID, {
      availableAt: 899,
      createdAt: 900,
    })),
    /available_at cannot precede created_at/,
  );
});

test("durable job claims and completion are ordered, leased, and version fenced", async () => {
  let now = 1_000;
  const repository = new MemoryDurableJobRepository({ now: () => now });
  await repository.enqueue(jobInput(SECOND_JOB_ID, {
    availableAt: 950,
    createdAt: 800,
  }));
  await repository.enqueue(jobInput(JOB_ID, {
    availableAt: 900,
    createdAt: 850,
  }));

  const [claimed] = await repository.claimAvailable({ batchSize: 1, leaseDurationMs: 500 });
  assert.equal(claimed.id, JOB_ID);
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.attemptCount, 1);
  assert.equal(claimed.leaseExpiresAt, 1_500);
  assert.equal(claimed.version, "2");
  assert.deepEqual(
    await repository.complete({ jobId: JOB_ID, expectedVersion: "1" }),
    { outcome: "stale" },
  );

  now = 1_100;
  const completed = await repository.complete({ jobId: JOB_ID, expectedVersion: "2" });
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.job.completedAt, 1_100);
  assert.equal(completed.job.version, "3");
});

test("transient jobs retry with backoff while exhausted and reauthorization failures dead-letter", async () => {
  let now = 1_000;
  const repository = new MemoryDurableJobRepository({ now: () => now });
  await repository.enqueue(jobInput());
  let [claimed] = await repository.claimAvailable({ batchSize: 1, leaseDurationMs: 500 });
  let failed = await repository.fail({
    jobId: JOB_ID,
    expectedVersion: claimed.version,
    retryDelayMs: 200,
    maxAttempts: 2,
    failure: {
      code: "provider_unavailable",
      message: "Provider is temporarily unavailable.",
      disposition: "retryable",
    },
  });
  assert.equal(failed.outcome, "retry");
  assert.equal(failed.job.availableAt, 1_200);
  assert.equal(failed.job.version, "3");

  now = 1_200;
  [claimed] = await repository.claimAvailable({ batchSize: 1, leaseDurationMs: 500 });
  assert.equal(claimed.attemptCount, 2);
  failed = await repository.fail({
    jobId: JOB_ID,
    expectedVersion: claimed.version,
    retryDelayMs: 200,
    maxAttempts: 2,
    failure: {
      code: "provider_unavailable",
      message: "Provider is still unavailable.",
      disposition: "retryable",
    },
  });
  assert.equal(failed.outcome, "dead-lettered");
  assert.equal(failed.job.deadLetteredAt, 1_200);

  await repository.enqueue(jobInput(SECOND_JOB_ID, { availableAt: now, createdAt: now }));
  [claimed] = await repository.claimAvailable({ batchSize: 1, leaseDurationMs: 500 });
  failed = await repository.fail({
    jobId: SECOND_JOB_ID,
    expectedVersion: claimed.version,
    retryDelayMs: 200,
    maxAttempts: 10,
    failure: {
      code: "invalid_grant",
      message: "The Workspace connection requires reauthorization.",
      disposition: "reauthorization_required",
    },
  });
  assert.equal(failed.outcome, "dead-lettered");
  assert.equal(failed.job.attemptCount, 1);
  assert.deepEqual((await repository.listDead({ limit: 10 })).map((job) => job.id), [
    JOB_ID,
    SECOND_JOB_ID,
  ]);
});

test("dead-job replay requires a current fence and returns operator evidence", async () => {
  let now = 1_000;
  const repository = new MemoryDurableJobRepository({ now: () => now });
  await repository.enqueue(jobInput());
  const [claimed] = await repository.claimAvailable({ batchSize: 1, leaseDurationMs: 100 });
  const dead = await repository.fail({
    jobId: JOB_ID,
    expectedVersion: claimed.version,
    retryDelayMs: 0,
    maxAttempts: 1,
    failure: {
      code: "provider_rejected",
      message: "Provider rejected the request.",
      disposition: "permanent",
    },
  });
  now = 2_000;
  assert.deepEqual(
    await repository.replayDead({
      jobId: JOB_ID,
      expectedVersion: "2",
      retryDelayMs: 100,
      requestedByActorKey: "user:admincrm",
      reason: "Verified provider configuration and approved one replay.",
      correlationId: "correlation:replay-1",
    }),
    { outcome: "stale" },
  );
  const replayed = await repository.replayDead({
    jobId: JOB_ID,
    expectedVersion: dead.job.version,
    retryDelayMs: 100,
    requestedByActorKey: "user:admincrm",
    reason: "Verified provider configuration and approved one replay.",
    correlationId: "correlation:replay-1",
  });
  assert.equal(replayed.outcome, "replayed");
  assert.equal(replayed.job.status, "pending");
  assert.equal(replayed.job.attemptCount, 0);
  assert.equal(replayed.job.availableAt, 2_100);
  assert.deepEqual(replayed.evidence, {
    jobId: JOB_ID,
    requestedByActorKey: "user:admincrm",
    reason: "Verified provider configuration and approved one replay.",
    correlationId: "correlation:replay-1",
    requestedAt: 2_000,
    previousFailure: {
      code: "provider_rejected",
      message: "Provider rejected the request.",
      disposition: "permanent",
    },
  });
});

test("expired leases recover in a bounded pass without completing provider work", async () => {
  let now = 1_000;
  const repository = new MemoryDurableJobRepository({ now: () => now });
  await repository.enqueue(jobInput());
  await repository.enqueue(jobInput(SECOND_JOB_ID));
  await repository.claimAvailable({ batchSize: 2, leaseDurationMs: 100 });
  now = 1_100;
  const recovered = await repository.recoverExpiredLeases({
    batchSize: 2,
    retryDelayMs: 50,
    maxAttempts: 1,
  });
  assert.equal(recovered.length, 2);
  assert.ok(recovered.every(({ outcome, job }) =>
    outcome === "dead-lettered"
    && job.lastFailure.code === "lease_expired"
    && job.status === "dead"));
});

test("Gmail history cursor state is encrypted, key-versioned, and defensively copied", async () => {
  const repository = new MemoryIntegrationSyncStateRepository({ now: () => 1_000 });
  const encrypted = ciphertext(1);
  const saved = await repository.saveActive({
    id: GMAIL_CURSOR_ID,
    resourceId: GMAIL_RESOURCE_ID,
    cursorKind: "gmail_history",
    cursorCiphertext: encrypted,
    keyVersion: "workspace-key-v1",
    expiresAt: null,
    expectedVersion: null,
  });
  assert.equal(saved.outcome, "saved");
  assert.equal(saved.cursor.status, "active");
  assert.equal(saved.cursor.lastSuccessAt, 1_000);
  assert.equal(saved.cursor.version, "1");

  encrypted[0] = 255;
  saved.cursor.cursorCiphertext[1] = 255;
  const loaded = await repository.get(GMAIL_RESOURCE_ID, "gmail_history");
  assert.equal(loaded.cursorCiphertext[0], 1);
  assert.equal(loaded.cursorCiphertext[1], 8);
  assert.deepEqual(await repository.saveActive({
    id: GMAIL_CURSOR_ID,
    resourceId: GMAIL_RESOURCE_ID,
    cursorKind: "gmail_history",
    cursorCiphertext: ciphertext(2),
    keyVersion: "workspace-key-v1",
    expiresAt: null,
    expectedVersion: null,
  }), { outcome: "conflict" });
});

test("transient sync failure retains the cursor and a successful advance clears the error", async () => {
  let now = 1_000;
  const repository = new MemoryIntegrationSyncStateRepository({ now: () => now });
  const saved = await repository.saveActive({
    id: GMAIL_CURSOR_ID,
    resourceId: GMAIL_RESOURCE_ID,
    cursorKind: "gmail_history",
    cursorCiphertext: ciphertext(1),
    keyVersion: "workspace-key-v1",
    expiresAt: null,
    expectedVersion: null,
  });
  now = 1_100;
  const failure = await repository.recordFailure({
    resourceId: GMAIL_RESOURCE_ID,
    cursorKind: "gmail_history",
    expectedVersion: saved.cursor.version,
    errorCode: "provider_unavailable",
    disposition: "retain_cursor",
  });
  assert.equal(failure.outcome, "recorded");
  assert.equal(failure.cursor.status, "active");
  assert.ok(failure.cursor.cursorCiphertext);
  assert.equal(failure.cursor.lastErrorAt, 1_100);

  now = 1_200;
  const advanced = await repository.saveActive({
    id: GMAIL_CURSOR_ID,
    resourceId: GMAIL_RESOURCE_ID,
    cursorKind: "gmail_history",
    cursorCiphertext: ciphertext(2),
    keyVersion: "workspace-key-v2",
    expiresAt: null,
    expectedVersion: failure.cursor.version,
  });
  assert.equal(advanced.outcome, "saved");
  assert.equal(advanced.cursor.lastSuccessAt, 1_200);
  assert.equal(advanced.cursor.lastErrorAt, null);
  assert.equal(advanced.cursor.lastErrorCode, null);
  assert.equal(advanced.cursor.keyVersion, "workspace-key-v2");
  assert.deepEqual(await repository.recordFailure({
    resourceId: GMAIL_RESOURCE_ID,
    cursorKind: "gmail_history",
    expectedVersion: failure.cursor.version,
    errorCode: "stale_failure",
    disposition: "retain_cursor",
  }), { outcome: "stale" });
});

test("invalid cursors clear encrypted material, support a fenced resync, and disable permanently", async () => {
  let now = 1_000;
  const repository = new MemoryIntegrationSyncStateRepository({ now: () => now });
  const saved = await repository.saveActive({
    id: CALENDAR_CURSOR_ID,
    resourceId: CALENDAR_RESOURCE_ID,
    cursorKind: "calendar_sync_token",
    cursorCiphertext: ciphertext(3),
    keyVersion: "workspace-key-v1",
    expiresAt: null,
    expectedVersion: null,
  });
  await repository.saveActive({
    id: CALENDAR_CHANNEL_CURSOR_ID,
    resourceId: CALENDAR_CHANNEL_RESOURCE_ID,
    cursorKind: "calendar_channel_token",
    cursorCiphertext: ciphertext(8),
    keyVersion: "workspace-key-v1",
    expiresAt: 5_000,
    expectedVersion: null,
  });
  now = 1_100;
  const invalid = await repository.recordFailure({
    resourceId: CALENDAR_RESOURCE_ID,
    cursorKind: "calendar_sync_token",
    expectedVersion: saved.cursor.version,
    errorCode: "sync_token_invalid",
    disposition: "resync_required",
  });
  assert.equal(invalid.outcome, "recorded");
  assert.equal(invalid.cursor.status, "resync_required");
  assert.equal(invalid.cursor.cursorCiphertext, null);
  assert.equal(invalid.cursor.keyVersion, null);
  assert.equal(invalid.cursor.expiresAt, null);
  const liveChannel = await repository.get(
    CALENDAR_CHANNEL_RESOURCE_ID,
    "calendar_channel_token",
  );
  assert.equal(liveChannel.status, "active");
  assert.ok(liveChannel.cursorCiphertext);
  assert.equal(liveChannel.expiresAt, 5_000);

  now = 1_200;
  const resynced = await repository.saveActive({
    id: CALENDAR_CURSOR_ID,
    resourceId: CALENDAR_RESOURCE_ID,
    cursorKind: "calendar_sync_token",
    cursorCiphertext: ciphertext(4),
    keyVersion: "workspace-key-v2",
    expiresAt: null,
    expectedVersion: invalid.cursor.version,
  });
  assert.equal(resynced.outcome, "saved");
  assert.equal(resynced.cursor.status, "active");
  const disabled = await repository.disable({
    resourceId: CALENDAR_RESOURCE_ID,
    cursorKind: "calendar_sync_token",
    expectedVersion: resynced.cursor.version,
  });
  assert.equal(disabled.outcome, "disabled");
  assert.equal(disabled.cursor.cursorCiphertext, null);
  assert.deepEqual(await repository.saveActive({
    id: CALENDAR_CURSOR_ID,
    resourceId: CALENDAR_RESOURCE_ID,
    cursorKind: "calendar_sync_token",
    cursorCiphertext: ciphertext(5),
    keyVersion: "workspace-key-v2",
    expiresAt: null,
    expectedVersion: disabled.cursor.version,
  }), { outcome: "stale" });
  await assert.rejects(repository.recordFailure({
    resourceId: CALENDAR_CHANNEL_RESOURCE_ID,
    cursorKind: "calendar_channel_token",
    expectedVersion: liveChannel.version,
    errorCode: "channel_invalid",
    disposition: "resync_required",
  }), /must be disabled, not marked for resync/);
});

test("expiry monitoring returns only active watch/channel state in deterministic order", async () => {
  let now = 1_000;
  const repository = new MemoryIntegrationSyncStateRepository({ now: () => now });
  await assert.rejects(repository.saveActive({
    id: CALENDAR_CHANNEL_CURSOR_ID,
    resourceId: CALENDAR_CHANNEL_RESOURCE_ID,
    cursorKind: "calendar_channel_token",
    cursorCiphertext: ciphertext(2),
    keyVersion: "workspace-key-v1",
    expiresAt: null,
    expectedVersion: null,
  }), /notification channel requires an expiry/);
  await repository.saveActive({
    id: GMAIL_CURSOR_ID,
    resourceId: GMAIL_RESOURCE_ID,
    cursorKind: "gmail_history",
    cursorCiphertext: ciphertext(1),
    keyVersion: "workspace-key-v1",
    expiresAt: null,
    expectedVersion: null,
  });
  await repository.saveActive({
    id: CALENDAR_CHANNEL_CURSOR_ID,
    resourceId: CALENDAR_CHANNEL_RESOURCE_ID,
    cursorKind: "calendar_channel_token",
    cursorCiphertext: ciphertext(2),
    keyVersion: "workspace-key-v1",
    expiresAt: 3_000,
    expectedVersion: null,
  });
  await repository.saveActive({
    id: SECOND_CALENDAR_CHANNEL_CURSOR_ID,
    resourceId: SECOND_CALENDAR_CHANNEL_RESOURCE_ID,
    cursorKind: "calendar_channel_token",
    cursorCiphertext: ciphertext(3),
    keyVersion: "workspace-key-v1",
    expiresAt: 2_000,
    expectedVersion: null,
  });

  const expiring = await repository.listExpiring({ expiresOnOrBefore: 3_500, limit: 2 });
  assert.deepEqual(expiring.map(({ id }) => id), [
    SECOND_CALENDAR_CHANNEL_CURSOR_ID,
    CALENDAR_CHANNEL_CURSOR_ID,
  ]);
});

test("watch/queue and rotation documentation stays linked, gated, and explicit", () => {
  const design = source("docs/google-workspace-watch-and-queue-design.md");
  const readme = source("README.md");
  const foundation = source("docs/task-checklists/07-production-foundation-and-migration.md");
  const operations = source("docs/task-checklists/08-operations-recovery-and-security.md");
  const rollout = source("docs/google-workspace-rollout-guide.md");

  assert.match(design, /No live integration is implemented or authorized here/);
  assert.match(design, /Begin with serialized scheduled polling[\s\S]*Do not use `users\.watch` or Pub\/Sub/);
  assert.match(design, /Calendar transport[\s\S]*HTTPS notification channels[\s\S]*does not use Pub\/Sub/);
  assert.match(design, /`integration_cursors`/);
  assert.match(design, /`outbox_events`/);
  assert.match(design, /Each future Calendar notification channel is a \*\*separate\*\* `integration_resources` row/);
  assert.match(design, /`calendar_channel_token`/);
  assert.match(design, /Otter intake[\s\S]*explicitly deferred/i);
  assert.match(readme, /docs\/google-workspace-watch-and-queue-design\.md/);
  assert.match(foundation, /\.\.\/google-workspace-watch-and-queue-design\.md/);

  assert.match(rollout, /Token-encryption key rotation \(current disconnect\/reconnect procedure\)/);
  assert.match(rollout, /Sites\/D1 connector[\s\S]*only the one currently[\s\S]*configured key/);
  assert.match(rollout, /BE-08[\s\S]*source-only production boundary[\s\S]*exact stored `key_version`[\s\S]*exact-version fence/);
  assert.match(rollout, /deliberately uncomposed and unapplied[\s\S]*Until Gate C[\s\S]*disconnect\/reconnect runbook/);
  assert.doesNotMatch(rollout, /Multi-key[\s\S]{0,120}is not implemented/);
  assert.match(rollout, /32 random bytes[\s\S]*encode them as base64url/);
  assert.match(rollout, /OAuth client-secret rotation \(same client ID, no reconnect\)/);
  assert.match(rollout, /`invalid_grant` or revoked refresh-token recovery/);
  assert.match(rollout, /workspace\.connectionStatus[\s\S]*reauthorization-required/);
  assert.match(rollout, /Disconnect Workspace[\s\S]*remains available[\s\S]*administrator[\s\S]*connection-health card[\s\S]*requires reauthorization/);
  assert.match(operations, /#token-encryption-key-rotation-current-disconnectreconnect-procedure/);
  assert.match(operations, /#oauth-client-secret-rotation-same-client-id-no-reconnect/);
  assert.match(operations, /#invalid_grant-or-revoked-refresh-token-recovery/);
});
