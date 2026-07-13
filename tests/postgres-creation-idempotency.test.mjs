import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24679 } },
});
const idempotencyModule = await vite.ssrLoadModule("/app/adapters/postgres/creation-idempotency.ts");
after(async () => {
  await vite.close();
});

const {
  calculatePostgresRequestFingerprint,
  claimPostgresCreation,
  completePostgresCreation,
  failPostgresCreation,
  POSTGRES_CREATION_OPERATIONS,
  validatePostgresCreationRequest,
} = idempotencyModule;

const CREATED_AT = Date.UTC(2026, 6, 13, 12);
const REQUEST = {
  idempotencyRequestId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "create-client-1",
  requestFingerprint: calculatePostgresRequestFingerprint({ name: "FCI TEST — DO NOT USE", status: "active" }),
  correlationId: "request-create-client-1",
  expiresAt: CREATED_AT + 60_000,
  outboxEventId: "22222222-2222-4222-8222-222222222222",
};

test("request fingerprints are deterministic canonical JSON and reject unsafe inputs", () => {
  assert.equal(
    calculatePostgresRequestFingerprint({ status: "active", nested: { b: 2, a: 1 }, tags: ["one", "two"] }),
    calculatePostgresRequestFingerprint({ tags: ["one", "two"], nested: { a: 1, b: 2 }, status: "active" }),
  );
  assert.notEqual(
    calculatePostgresRequestFingerprint({ name: "Client A" }),
    calculatePostgresRequestFingerprint({ name: "Client B" }),
  );
  assert.throws(() => calculatePostgresRequestFingerprint({ missing: undefined }), /undefined values/);
  const circular = {};
  circular.self = circular;
  assert.throws(() => calculatePostgresRequestFingerprint(circular), /circular values/);
});

test("creation request metadata is bounded and expires after the record timestamp", () => {
  assert.doesNotThrow(() => validatePostgresCreationRequest(REQUEST, CREATED_AT));
  assert.throws(
    () => validatePostgresCreationRequest({ ...REQUEST, idempotencyKey: " untrimmed" }, CREATED_AT),
    /idempotency key must be trimmed text/,
  );
  assert.throws(
    () => validatePostgresCreationRequest({ ...REQUEST, requestFingerprint: "client-value" }, CREATED_AT),
    /lowercase SHA-256/,
  );
  assert.throws(
    () => validatePostgresCreationRequest({ ...REQUEST, expiresAt: CREATED_AT }, CREATED_AT),
    /expiry must be a safe epoch millisecond after creation/,
  );
});

test("claim inserts atomically before reading a completed concurrent request", async () => {
  const queries = [];
  const stored = { id: "stored-client", version: "1" };
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (queries.length === 1) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          request_fingerprint: REQUEST.requestFingerprint,
          status: "completed",
          response_status: 201,
          response_body: stored,
          version: "2",
        }],
        rowCount: 1,
      };
    },
  };

  assert.deepEqual(
    await claimPostgresCreation(
      client,
      POSTGRES_CREATION_OPERATIONS.client,
      "actor@example.test",
      CREATED_AT,
      REQUEST,
      (value) => value,
    ),
    { outcome: "replayed", value: stored },
  );
  assert.match(queries[0].sql, /INSERT INTO idempotency_requests/);
  assert.match(queries[0].sql, /ON CONFLICT \(actor_id, operation, idempotency_key\) DO NOTHING/);
  assert.match(queries[1].sql, /FOR UPDATE/);
  assert.doesNotMatch(queries[0].sql, /SELECT[\s\S]*idempotency_requests/i);
});

test("claim rejects fingerprint reuse and fails closed on unfinished state", async () => {
  async function outcome(row) {
    let call = 0;
    return claimPostgresCreation(
      {
        async query() {
          call += 1;
          return call === 1 ? { rows: [], rowCount: 0 } : { rows: [row], rowCount: 1 };
        },
      },
      POSTGRES_CREATION_OPERATIONS.project,
      "actor@example.test",
      CREATED_AT,
      REQUEST,
      (value) => value,
    );
  }

  assert.deepEqual(await outcome({
    request_fingerprint: `sha256:${"f".repeat(64)}`,
    status: "completed",
    response_status: 201,
    response_body: {},
  }), { outcome: "idempotency-conflict" });
  assert.deepEqual(await outcome({
    request_fingerprint: REQUEST.requestFingerprint,
    status: "processing",
    response_status: null,
    response_body: null,
  }), { outcome: "in-progress" });
  assert.deepEqual(await outcome({
    request_fingerprint: REQUEST.requestFingerprint,
    status: "failed",
    response_status: 409,
    response_body: { outcome: "duplicate" },
  }), {
    outcome: "failed-replay",
    responseStatus: 409,
    responseBody: { outcome: "duplicate" },
  });
});

test("deterministic failure stores a replayable 4xx response and increments the fence", async () => {
  let query;
  const client = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [{ version: "2" }], rowCount: 1 };
    },
  };
  await failPostgresCreation(
    client,
    POSTGRES_CREATION_OPERATIONS.project,
    "actor@example.test",
    CREATED_AT,
    REQUEST,
    404,
    { outcome: "client-not-found" },
  );

  assert.match(query.sql, /status = 'failed'/);
  assert.match(query.sql, /version = version \+ 1/);
  assert.equal(query.values[0], 404);
  assert.equal(query.values[1], JSON.stringify({ outcome: "client-not-found" }));
  await assert.rejects(
    failPostgresCreation(
      client,
      POSTGRES_CREATION_OPERATIONS.project,
      "actor@example.test",
      CREATED_AT,
      REQUEST,
      503,
      { outcome: "unavailable" },
    ),
    /must be a 4xx integer/,
  );
});

test("completion stores only the allowlisted response and increments the idempotency fence", async () => {
  let query;
  const client = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [{ version: "2" }], rowCount: 1 };
    },
  };
  const response = { id: "client-1", version: "1" };
  await completePostgresCreation(
    client,
    POSTGRES_CREATION_OPERATIONS.client,
    "actor@example.test",
    CREATED_AT,
    REQUEST,
    response,
  );

  assert.match(query.sql, /status = 'completed'/);
  assert.match(query.sql, /response_status = 201/);
  assert.match(query.sql, /version = version \+ 1/);
  assert.equal(query.values[0], JSON.stringify(response));
  assert.equal(query.values.includes("actor@example.test"), true);
});
