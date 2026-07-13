import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24680 } },
});
const outboxModule = await vite.ssrLoadModule(
  "/app/adapters/postgres/outbox-repository.ts",
);
const { createPostgresOutboxRepository, deadLetterActivityId } = outboxModule;

after(async () => {
  await vite.close();
});

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

test("dead-letter activity IDs are deterministic UUIDs distinct from their outbox IDs", () => {
  const activityId = deadLetterActivityId(EVENT_ID);
  assert.match(activityId, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(activityId, deadLetterActivityId(EVENT_ID));
  assert.notEqual(activityId, EVENT_ID);
});

function fakePool(workQuery) {
  const queries = [];
  const releases = [];
  let connectCalls = 0;
  let configuredSchema = "public";
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      assert.doesNotMatch(
        sql,
        /pg_catalog\.greatest/i,
        "PostgreSQL GREATEST is special syntax and cannot be schema-qualified",
      );
      if (sql.includes("set_config('search_path'")) {
        configuredSchema = values[0].split(",", 1)[0];
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("current_schema()")) {
        return { rows: [{ current_schema: configuredSchema }], rowCount: 1 };
      }
      if (
        sql === "BEGIN"
        || sql === "COMMIT"
        || sql === "ROLLBACK"
        || sql.startsWith("SET LOCAL")
      ) {
        return { rows: [], rowCount: null };
      }
      return workQuery(sql, values);
    },
    release(error) {
      releases.push(error);
    },
  };
  return {
    pool: {
      async connect() {
        connectCalls += 1;
        return client;
      },
    },
    queries,
    releases,
    get connectCalls() {
      return connectCalls;
    },
  };
}

function workQueries(fake) {
  return fake.queries.filter(({ sql }) =>
    sql !== "BEGIN"
    && sql !== "COMMIT"
    && sql !== "ROLLBACK"
    && !sql.startsWith("SET LOCAL")
    && !sql.includes("set_config('search_path'")
    && !sql.includes("current_schema()"),
  );
}

test("claim uses the pending index order, SKIP LOCKED, a short transaction, and safe value parsing", async () => {
  const fake = fakePool(async () => ({
    rowCount: 1,
    rows: [{
      id: EVENT_ID,
      event_key: `project.created:${PROJECT_ID}`,
      event_type: "project.created",
      client_id: null,
      project_id: PROJECT_ID,
      actor_id: "actor-1",
      correlation_id: "request-1",
      payload: { projectId: PROJECT_ID },
      available_at: "2026-07-13T12:00:00.000Z",
      attempt_count: "1.000",
      lease_expires_at: new Date("2026-07-13T12:01:00.000Z"),
      created_at: new Date("2026-07-13T11:59:00.000Z"),
      version: "9007199254740992",
    }],
  }));
  const repository = createPostgresOutboxRepository(fake.pool, { schema: "fci_test" });

  const claimed = await repository.claimAvailable({ batchSize: 2, leaseDurationMs: 60_000 });

  assert.deepEqual(claimed, [{
    id: EVENT_ID,
    eventKey: `project.created:${PROJECT_ID}`,
    eventType: "project.created",
    clientId: null,
    projectId: PROJECT_ID,
    actorId: "actor-1",
    correlationId: "request-1",
    payload: { projectId: PROJECT_ID },
    availableAt: Date.parse("2026-07-13T12:00:00.000Z"),
    attemptCount: 1,
    leaseExpiresAt: Date.parse("2026-07-13T12:01:00.000Z"),
    createdAt: Date.parse("2026-07-13T11:59:00.000Z"),
    version: "9007199254740992",
  }]);
  const [{ sql, values }] = workQueries(fake);
  assert.match(sql, /WHERE status = 'pending' AND available_at <= pg_catalog\.now\(\)/);
  assert.match(sql, /ORDER BY available_at, created_at, id[\s\S]*LIMIT \$1[\s\S]*FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /attempt_count = event\.attempt_count \+ 1/);
  assert.match(sql, /version = event\.version \+ 1/);
  assert.deepEqual(values, [2, 60_000]);
  assert.equal(fake.queries[0].sql, "BEGIN");
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
  assert.deepEqual(fake.releases, [undefined]);
  const searchPath = fake.queries.find(({ sql: value }) => value.includes("set_config('search_path'"));
  assert.deepEqual(searchPath.values, ["fci_test, pg_catalog, pg_temp"]);
});

test("completion is fenced by processing status and the claimed bigint version", async () => {
  const completedAt = new Date("2026-07-13T12:02:00.000Z");
  const fake = fakePool(async () => ({
    rowCount: 1,
    rows: [{
      status: "completed",
      version: "9007199254740993",
      available_at: new Date("2026-07-13T12:00:00.000Z"),
      completed_at: completedAt,
      dead_lettered_at: null,
    }],
  }));
  const repository = createPostgresOutboxRepository(fake.pool);

  assert.deepEqual(
    await repository.complete({ eventId: EVENT_ID, expectedVersion: "9007199254740992" }),
    {
      outcome: "completed",
      version: "9007199254740993",
      completedAt: completedAt.getTime(),
    },
  );
  const [{ sql, values }] = workQueries(fake);
  assert.match(sql, /WHERE id = \$1 AND status = 'processing' AND version = \$2::bigint/);
  assert.match(sql, /lease_expires_at = NULL/);
  assert.match(sql, /version = version \+ 1/);
  assert.deepEqual(values, [EVENT_ID, "9007199254740992"]);

  const staleFake = fakePool(async () => ({ rows: [], rowCount: 0 }));
  const staleRepository = createPostgresOutboxRepository(staleFake.pool);
  assert.deepEqual(
    await staleRepository.complete({ eventId: EVENT_ID, expectedVersion: "2" }),
    { outcome: "stale" },
  );
});

test("failure atomically chooses retry or dead-letter and retains its fencing condition", async () => {
  const retryAt = new Date("2026-07-13T12:05:00.000Z");
  const retryFake = fakePool(async () => ({
    rowCount: 1,
    rows: [{
      status: "pending",
      version: "3",
      available_at: retryAt,
      dead_lettered_at: null,
    }],
  }));
  const retryRepository = createPostgresOutboxRepository(retryFake.pool);
  const input = {
    eventId: EVENT_ID,
    expectedVersion: "2",
    retryDelayMs: 30_000,
    maxAttempts: 3,
    errorCode: "provider_unavailable",
    errorMessage: "The provider is temporarily unavailable.",
  };

  assert.deepEqual(await retryRepository.retryOrDeadLetter(input), {
    outcome: "retry",
    version: "3",
    availableAt: retryAt.getTime(),
  });
  const [{ sql, values }] = workQueries(retryFake);
  assert.match(sql, /WHEN event\.attempt_count >= \$4 THEN 'dead'/);
  assert.match(sql, /event\.status = 'processing'[\s\S]*event\.version = \$2::bigint/);
  assert.match(sql, /lease_expires_at = NULL/);
  assert.match(sql, /dead_lettered_at = CASE/);
  assert.match(sql, /version = event\.version \+ 1/);
  assert.deepEqual(values, [
    EVENT_ID,
    "2",
    30_000,
    3,
    "provider_unavailable",
    "The provider is temporarily unavailable.",
  ]);

  const deadAt = new Date("2026-07-13T12:06:00.000Z");
  const deadFake = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO activity_events")) return { rowCount: 1, rows: [] };
    return {
      rowCount: 1,
      rows: [{
        id: EVENT_ID,
        event_key: `client.created:${CLIENT_ID}`,
        event_type: "client.created",
        client_id: CLIENT_ID,
        project_id: null,
        actor_id: "actor-1",
        correlation_id: "request-1",
        attempt_count: 3,
        status: "dead",
        version: "4",
        available_at: retryAt,
        dead_lettered_at: deadAt,
      }],
    };
  });
  const deadRepository = createPostgresOutboxRepository(deadFake.pool);
  assert.deepEqual(await deadRepository.retryOrDeadLetter(input), {
    outcome: "dead-lettered",
    version: "4",
    deadLetteredAt: deadAt.getTime(),
  });
  const deadQueries = workQueries(deadFake);
  assert.equal(deadQueries.length, 2);
  assert.match(deadQueries[1].sql, /INSERT INTO activity_events/);
  assert.match(deadQueries[1].sql, /'Outbox event dead-lettered'/);
  assert.match(deadQueries[1].sql, /'failed'/);
  assert.deepEqual(deadQueries[1].values.slice(0, 6), [
    deadLetterActivityId(EVENT_ID),
    CLIENT_ID,
    null,
    "actor-1",
    "request-1",
    "provider_unavailable",
  ]);
  assert.deepEqual(JSON.parse(deadQueries[1].values[6]), {
    outboxEventId: EVENT_ID,
    eventKey: `client.created:${CLIENT_ID}`,
    eventType: "client.created",
    attemptCount: 3,
    errorCode: "provider_unavailable",
    errorMessage: "The provider is temporarily unavailable.",
  });
  assert.equal(deadQueries[1].values[7].getTime(), deadAt.getTime());
  assert.equal(deadFake.queries.at(-1).sql, "COMMIT");
});

test("provider error evidence replaces NUL and unpaired surrogates without splitting emoji", async () => {
  const deadAt = new Date("2026-07-13T12:06:00.000Z");
  const fake = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO activity_events")) return { rowCount: 1, rows: [] };
    return {
      rowCount: 1,
      rows: [{
        id: EVENT_ID,
        event_key: `client.created:${CLIENT_ID}`,
        event_type: "client.created",
        client_id: CLIENT_ID,
        project_id: null,
        actor_id: "actor-1",
        correlation_id: "request-1",
        attempt_count: 1,
        status: "dead",
        version: "3",
        available_at: deadAt,
        dead_lettered_at: deadAt,
      }],
    };
  });
  const unsafeMessage = `\ud800${"x".repeat(3998)}😀`;

  await createPostgresOutboxRepository(fake.pool).retryOrDeadLetter({
    eventId: EVENT_ID,
    expectedVersion: "2",
    retryDelayMs: 0,
    maxAttempts: 1,
    errorCode: "provider\u0000error",
    errorMessage: unsafeMessage,
  });

  const [transition, activity] = workQueries(fake);
  assert.equal(transition.values[4], "provider�error");
  assert.equal(Array.from(transition.values[5]).length, 4000);
  assert.equal(Array.from(transition.values[5]).at(0), "�");
  assert.equal(Array.from(transition.values[5]).at(-1), "😀");
  assert.doesNotMatch(transition.values[5], /\u0000|[\ud800-\udfff]/u);
  const detail = JSON.parse(activity.values[6]);
  assert.equal(detail.errorCode, transition.values[4]);
  assert.equal(detail.errorMessage, transition.values[5]);
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("expired-lease recovery is ordered, nonblocking, bounded, and increments each fence", async () => {
  const availableAt = new Date("2026-07-13T12:07:00.000Z");
  const deadAt = new Date("2026-07-13T12:08:00.000Z");
  const secondEventId = "44444444-4444-4444-8444-444444444444";
  const fake = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO activity_events")) return { rowCount: 1, rows: [] };
    return {
      rowCount: 2,
      rows: [
        {
          id: EVENT_ID,
          status: "pending",
          version: "6",
          available_at: availableAt,
          dead_lettered_at: null,
        },
        {
          id: secondEventId,
          event_key: `project.created:${PROJECT_ID}`,
          event_type: "project.created",
          client_id: null,
          project_id: PROJECT_ID,
          actor_id: "actor-2",
          correlation_id: "request-2",
          attempt_count: 3,
          status: "dead",
          version: "9007199254740992",
          available_at: availableAt,
          dead_lettered_at: deadAt,
        },
      ],
    };
  });
  const repository = createPostgresOutboxRepository(fake.pool);

  assert.deepEqual(
    await repository.recoverExpiredLeases({ batchSize: 10, retryDelayMs: 1_000, maxAttempts: 3 }),
    [
      { id: EVENT_ID, outcome: "retry", version: "6", availableAt: availableAt.getTime() },
      {
        id: secondEventId,
        outcome: "dead-lettered",
        version: "9007199254740992",
        deadLetteredAt: deadAt.getTime(),
      },
    ],
  );
  const recoveryQueries = workQueries(fake);
  const [{ sql, values }] = recoveryQueries;
  assert.match(sql, /WHERE status = 'processing'[\s\S]*lease_expires_at <= pg_catalog\.now\(\)/);
  assert.match(sql, /ORDER BY lease_expires_at, id[\s\S]*LIMIT \$1[\s\S]*FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /last_error_code = 'lease_expired'/);
  assert.match(sql, /WHEN event\.attempt_count >= \$3 THEN 'dead'/);
  assert.match(sql, /version = event\.version \+ 1/);
  assert.deepEqual(values, [10, 1_000, 3]);
  assert.equal(recoveryQueries.length, 2);
  assert.match(recoveryQueries[1].sql, /INSERT INTO activity_events/);
  assert.deepEqual(recoveryQueries[1].values.slice(0, 6), [
    deadLetterActivityId(secondEventId),
    null,
    PROJECT_ID,
    "actor-2",
    "request-2",
    "lease_expired",
  ]);
  assert.deepEqual(JSON.parse(recoveryQueries[1].values[6]), {
    outboxEventId: secondEventId,
    eventKey: `project.created:${PROJECT_ID}`,
    eventType: "project.created",
    attemptCount: 3,
    errorCode: "lease_expired",
    errorMessage: "Worker lease expired before completion.",
  });
  assert.equal(fake.queries.at(-1).sql, "COMMIT");
});

test("a dead-letter activity failure rolls back the terminal queue transition", async () => {
  const deadAt = new Date("2026-07-13T12:09:00.000Z");
  const fake = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO activity_events")) {
      throw new Error("activity insert failed");
    }
    return {
      rowCount: 1,
      rows: [{
        id: EVENT_ID,
        event_key: `client.created:${CLIENT_ID}`,
        event_type: "client.created",
        client_id: CLIENT_ID,
        project_id: null,
        actor_id: "actor-1",
        correlation_id: "request-1",
        attempt_count: 3,
        status: "dead",
        version: "4",
        available_at: deadAt,
        dead_lettered_at: deadAt,
      }],
    };
  });
  const repository = createPostgresOutboxRepository(fake.pool);

  await assert.rejects(
    repository.retryOrDeadLetter({
      eventId: EVENT_ID,
      expectedVersion: "3",
      retryDelayMs: 1_000,
      maxAttempts: 3,
      errorCode: "provider_failed",
      errorMessage: "Provider failed.",
    }),
    /activity insert failed/,
  );
  assert.equal(fake.queries.at(-1).sql, "ROLLBACK");
  assert.deepEqual(fake.releases, [undefined]);
});

test("invalid queue inputs and malformed PostgreSQL rows fail before unsafe work escapes", async () => {
  const unused = fakePool(async () => assert.fail("work query must not run"));
  const invalidSchema = () => createPostgresOutboxRepository(unused.pool, { schema: "unsafe-schema" });
  assert.throws(invalidSchema, /lowercase PostgreSQL identifier/);

  const repository = createPostgresOutboxRepository(unused.pool);
  await assert.rejects(
    repository.claimAvailable({ batchSize: 0, leaseDurationMs: 1_000 }),
    /batch size must be an integer from 1 to 100/,
  );
  await assert.rejects(
    repository.complete({ eventId: EVENT_ID, expectedVersion: "9007199254740992.0" }),
    /signed 64-bit integer/,
  );
  assert.equal(unused.connectCalls, 0);

  const malformed = fakePool(async () => ({
    rowCount: 1,
    rows: [{
      id: EVENT_ID,
      event_key: `client.created:${CLIENT_ID}`,
      event_type: "client.created",
      client_id: CLIENT_ID,
      project_id: null,
      actor_id: "actor-1",
      correlation_id: "request-1",
      payload: [],
      available_at: new Date(),
      attempt_count: 1,
      lease_expires_at: new Date(),
      created_at: new Date(),
      version: "2",
    }],
  }));
  const malformedRepository = createPostgresOutboxRepository(malformed.pool);
  await assert.rejects(
    malformedRepository.claimAvailable({ batchSize: 1, leaseDurationMs: 1_000 }),
    /payload must be a JSON object/,
  );
  assert.equal(malformed.queries.at(-1).sql, "ROLLBACK");
  assert.deepEqual(malformed.releases, [undefined]);
});
