import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/security-audit",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24685 } },
});
const auditModule = await vite.ssrLoadModule(
  "/app/adapters/postgres/security-audit-repository.ts",
);
const {
  createPostgresSecurityAuditRepository,
  insertPostgresSecurityAuditEvent,
  MAX_SECURITY_AUDIT_METADATA_DEPTH,
  MAX_SECURITY_AUDIT_METADATA_NODES,
} = auditModule;

after(async () => {
  await vite.close();
});

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const EXECUTOR_ID = "22222222-2222-4222-8222-222222222222";
const ORIGINATOR_ID = "33333333-3333-4333-8333-333333333333";
const OCCURRED_AT = Date.UTC(2026, 6, 15, 12, 0, 0);

function auditEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    executorType: "service",
    executorUserId: null,
    executorKey: "service:outbox-worker",
    originatingUserId: ORIGINATOR_ID,
    originatingActorKey: `user:${ORIGINATOR_ID}`,
    action: "outbox.event_dead_lettered",
    targetType: "project",
    targetId: "44444444-4444-4444-8444-444444444444",
    result: "failed",
    reasonCode: "lease_expired",
    requestId: null,
    correlationId: "request-123",
    source: "cloud_run",
    metadata: {
      eventType: "project.created",
      attempts: 3,
      provider: { name: "google", retryable: false },
      labels: ["delivery", "terminal"],
    },
    occurredAt: OCCURRED_AT,
    retentionPolicyKey: "security_default",
    retentionUntil: OCCURRED_AT + 86_400_000,
    ...overrides,
  };
}

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function transactionPool(insertResult = result([], 1)) {
  const queries = [];
  const releases = [];
  let connectCount = 0;
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, values: [...values] });
      if (
        normalized === "BEGIN"
        || normalized === "COMMIT"
        || normalized === "ROLLBACK"
        || normalized.startsWith("SET LOCAL")
      ) {
        return result();
      }
      if (normalized.includes("set_config('search_path'")) return result([], 1);
      if (normalized.includes("current_schema()")) {
        return result([{ current_schema: "fci_test" }], 1);
      }
      if (normalized.startsWith("INSERT INTO audit_events")) return insertResult;
      assert.fail(`unexpected query: ${normalized}`);
    },
    release(error) {
      releases.push(error);
    },
  };
  return {
    pool: {
      async connect() {
        connectCount += 1;
        return client;
      },
    },
    client,
    queries,
    releases,
    get connectCount() {
      return connectCount;
    },
  };
}

function insertQueries(fake) {
  return fake.queries.filter(({ sql }) => sql.startsWith("INSERT INTO audit_events"));
}

test("standalone append validates first and commits one content-minimized audit row", async () => {
  const fake = transactionPool();
  const repository = createPostgresSecurityAuditRepository(fake.pool, {
    schema: "fci_test",
    lockTimeoutMs: 1_234,
    statementTimeoutMs: 5_678,
  });

  assert.deepEqual(await repository.append(auditEvent()), {
    id: EVENT_ID,
  });
  assert.equal(fake.connectCount, 1);
  assert.deepEqual(fake.queries.map(({ sql }) => sql.split("\n", 1)[0]), [
    "BEGIN",
    "SET LOCAL lock_timeout = '1234ms'",
    "SET LOCAL statement_timeout = '5678ms'",
    "SELECT pg_catalog.set_config('search_path', $1, true)",
    "SELECT pg_catalog.current_schema() AS current_schema",
    "INSERT INTO audit_events (",
    "COMMIT",
  ]);
  assert.deepEqual(fake.queries[3].values, ["fci_test, pg_catalog, pg_temp"]);
  assert.deepEqual(fake.releases, [undefined]);

  const [insert] = insertQueries(fake);
  assert.doesNotMatch(insert.sql, /\bRETURNING\b/i);
  assert.equal(insert.values.length, 18);
  assert.deepEqual(insert.values.slice(0, 14), [
    EVENT_ID,
    "service",
    null,
    "service:outbox-worker",
    ORIGINATOR_ID,
    `user:${ORIGINATOR_ID}`,
    "outbox.event_dead_lettered",
    "project",
    "44444444-4444-4444-8444-444444444444",
    "failed",
    "lease_expired",
    null,
    "request-123",
    "cloud_run",
  ]);
  assert.deepEqual(JSON.parse(insert.values[14]), auditEvent().metadata);
  assert.equal(insert.values[15].getTime(), OCCURRED_AT);
  assert.equal(insert.values[16], "security_default");
  assert.equal(insert.values[17].getTime(), OCCURRED_AT + 86_400_000);
});

test("same-client helper inserts without owning transaction control", async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql: sql.trim(), values });
      return result([], 1);
    },
  };
  const event = auditEvent({
    id: EVENT_ID.toUpperCase(),
    executorType: "user",
    executorUserId: EXECUTOR_ID.toUpperCase(),
    executorKey: `user:${EXECUTOR_ID}`,
    originatingUserId: null,
    originatingActorKey: null,
    targetType: null,
    targetId: null,
    result: "succeeded",
    reasonCode: null,
    requestId: "request-standalone",
    retentionUntil: null,
  });

  assert.deepEqual(await insertPostgresSecurityAuditEvent(client, event), {
    id: EVENT_ID,
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^INSERT INTO audit_events/);
  assert.doesNotMatch(queries[0].sql, /\b(?:BEGIN|COMMIT|ROLLBACK)\b/);
  assert.equal(queries[0].values[0], EVENT_ID);
  assert.equal(queries[0].values[2], EXECUTOR_ID);
});

test("invalid identity, action, result, timestamp, and paired fields fail before connecting", async () => {
  const cases = [
    ["invalid UUID", { id: "not-a-uuid" }, /event ID must be a canonical UUID/],
    ["missing user executor", { executorType: "user", executorUserId: null }, /executor user ID/],
    ["service with user", { executorType: "service", executorUserId: EXECUTOR_ID }, /executor user ID/],
    ["invalid action", { action: "LOGIN" }, /dotted lowercase action key/],
    ["invalid result", { result: "unknown" }, /supported result/],
    ["unsafe timestamp", { occurredAt: Number.MAX_SAFE_INTEGER }, /epoch-millisecond/],
    ["old retention", { retentionUntil: OCCURRED_AT - 1 }, /at or after/],
    ["half target", { targetType: "project", targetId: null }, /both a type and ID/],
    ["half originator", { originatingUserId: ORIGINATOR_ID, originatingActorKey: null }, /originating actor key/],
  ];

  for (const [label, overrides, pattern] of cases) {
    const fake = transactionPool();
    const repository = createPostgresSecurityAuditRepository(fake.pool, { schema: "fci_test" });
    await assert.rejects(repository.append(auditEvent(overrides)), pattern, label);
    assert.equal(fake.connectCount, 0, label);
  }

  const unused = transactionPool();
  assert.throws(
    () => createPostgresSecurityAuditRepository(unused.pool, { schema: "unsafe-schema" }),
    /lowercase PostgreSQL identifier/,
  );
  assert.equal(unused.connectCount, 0);
});

test("metadata recursively rejects secret-bearing keys and non-JSON structures before connecting", async () => {
  const forbidden = [
    { refreshToken: "redacted" },
    { pkceVerifier: "redacted" },
    { browserNonce: "redacted" },
    { nested: { password_hash: "redacted" } },
    { nested: [{ credentialCiphertext: "redacted" }] },
    { requestBody: { harmless: true } },
    { SECRET: "redacted" },
  ];
  for (const metadata of forbidden) {
    const fake = transactionPool();
    const repository = createPostgresSecurityAuditRepository(fake.pool, { schema: "fci_test" });
    await assert.rejects(
      repository.append(auditEvent({ metadata })),
      /cannot name secret-bearing content/,
    );
    assert.equal(fake.connectCount, 0);
  }

  const cyclic = {};
  cyclic.self = cyclic;
  let getterCalls = 0;
  const getter = {};
  Object.defineProperty(getter, "value", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return "unsafe";
    },
  });
  const accessorArray = ["safe"];
  Object.defineProperty(accessorArray, "0", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return "unsafe";
    },
  });
  const sparse = new Array(2);
  sparse[1] = "value";
  for (const metadata of [
    cyclic,
    { date: new Date() },
    getter,
    { accessorArray },
    { sparse },
    { invalid: undefined },
  ]) {
    const fake = transactionPool();
    const repository = createPostgresSecurityAuditRepository(fake.pool, { schema: "fci_test" });
    await assert.rejects(repository.append(auditEvent({ metadata })), /Security audit metadata/);
    assert.equal(fake.connectCount, 0);
  }
  assert.equal(getterCalls, 0);
});

test("metadata depth, node count, and encoded size are bounded", async () => {
  let deep = { value: true };
  for (let index = 0; index <= MAX_SECURITY_AUDIT_METADATA_DEPTH; index += 1) {
    deep = { nested: deep };
  }
  const tooMany = Object.fromEntries(
    Array.from(
      { length: MAX_SECURITY_AUDIT_METADATA_NODES },
      (_, index) => [`field_${index}`, index],
    ),
  );
  const tooLarge = {
    first: "é".repeat(3_000),
    second: "é".repeat(3_000),
    third: "é".repeat(3_000),
  };

  for (const [metadata, pattern] of [
    [deep, /no deeper/],
    [tooMany, /at most .* values/],
    [tooLarge, /no larger/],
  ]) {
    const fake = transactionPool();
    const repository = createPostgresSecurityAuditRepository(fake.pool, { schema: "fci_test" });
    await assert.rejects(repository.append(auditEvent({ metadata })), pattern);
    assert.equal(fake.connectCount, 0);
  }
});

test("unexpected insert counts roll back defensively without requiring SELECT privilege", async () => {
  const responses = [
    result([], 0),
    result([], 2),
    result([], null),
  ];

  for (const response of responses) {
    const fake = transactionPool(response);
    const repository = createPostgresSecurityAuditRepository(fake.pool, { schema: "fci_test" });
    await assert.rejects(repository.append(auditEvent()), /PostgreSQL security audit/);
    assert.equal(fake.queries.at(-1).sql, "ROLLBACK");
    assert.deepEqual(fake.releases, [undefined]);
  }
});
