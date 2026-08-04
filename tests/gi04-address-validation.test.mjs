import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { createServer } from "vite";

const APP_ORIGIN = "https://fci.example.test";
const ACTOR = "office@cherryhillfci.com";
const TEST_ADDRESS = "123 Test Street, Portland, ME 04101";
const NOW = Date.UTC(2026, 7, 3, 14);
const rootUrl = new URL("../", import.meta.url);
const workerEnvironment = {};
const originalNodeEnvironment = process.env.NODE_ENV;
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;
process.env.NODE_ENV = "test";

const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-gi04-address-validation", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24804 } },
});

const [domain, engine, reviews, mutation, config, route] = await Promise.all([
  vite.ssrLoadModule("/app/domain/address-validation.ts"),
  vite.ssrLoadModule("/app/features/address-validation/address-validation.ts"),
  vite.ssrLoadModule("/app/adapters/d1/address-validation-reviews.ts"),
  vite.ssrLoadModule("/app/lib/address-mutation-sites.ts"),
  vite.ssrLoadModule("/app/lib/address-validation-sites.ts"),
  vite.ssrLoadModule("/app/api/v1/address-validation/route.ts"),
]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

beforeEach(() => {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
});

class SqliteD1Statement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class AddressReviewDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(`
      CREATE TABLE address_validation_reviews (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        input_address TEXT NOT NULL,
        standardized_address TEXT,
        latitude REAL,
        longitude REAL,
        verdict TEXT NOT NULL,
        failure_code TEXT,
        simulated INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
    `);
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  row(id) {
    return this.database.prepare(
      "SELECT id, actor_id, entity_kind, target_id, input_address, consumed_at FROM address_validation_reviews WHERE id = ?",
    ).get(id);
  }

  close() {
    this.database.close();
  }
}

function googlePayload(possibleNextAction, overrides = {}) {
  return {
    result: {
      address: { formattedAddress: "123 Test St, Portland, ME 04101, USA" },
      geocode: { location: { latitude: 43.6591, longitude: -70.2568 } },
      verdict: {
        possibleNextAction,
        addressComplete: true,
        hasUnconfirmedComponents: false,
        hasInferredComponents: false,
        hasReplacedComponents: false,
        ...overrides,
      },
    },
  };
}

function reviewResult(overrides = {}) {
  return {
    inputAddress: TEST_ADDRESS,
    standardizedAddress: "123 Test Street, Portland, ME 04101",
    latitude: 43.6591,
    longitude: -70.2568,
    verdict: "validated",
    failureCode: null,
    simulated: false,
    ...overrides,
  };
}

function request(body, email = ACTOR, origin = APP_ORIGIN) {
  const url = new URL("/api/v1/address-validation", APP_ORIGIN);
  const headers = new Headers({
    origin,
    "content-type": "application/json",
  });
  if (email) headers.set("oai-authenticated-user-email", email);
  const value = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  Object.defineProperty(value, "nextUrl", { value: url });
  return value;
}

test("address text, identifiers, and review references are closed and bounded", () => {
  assert.equal(domain.normalizeAddressText(`  ${TEST_ADDRESS}  `), TEST_ADDRESS);
  assert.equal(domain.normalizeAddressText("x".repeat(280)), "x".repeat(280));
  assert.equal(domain.normalizeAddressText("x".repeat(281)), undefined);
  assert.equal(domain.normalizeAddressText("line\nbreak"), undefined);
  assert.equal(domain.normalizeAddressText("", true), undefined);
  assert.equal(domain.normalizeAddressEntityKind("lead"), "lead");
  assert.equal(domain.normalizeAddressEntityKind("future"), null);
  assert.equal(domain.normalizeAddressTargetId("project-1"), "project-1");
  assert.equal(domain.normalizeAddressTargetId("project 1"), null);
  assert.equal(domain.normalizeAddressSessionToken("12345678-1234-4123-8123-123456789abc"), "12345678-1234-4123-8123-123456789abc");
  assert.equal(domain.normalizeAddressSessionToken("x".repeat(37)), null);
  assert.deepEqual(domain.normalizeAddressReviewReference({ id: "review-1", choice: "typed" }), {
    id: "review-1",
    choice: "typed",
  });
  assert.equal(domain.normalizeAddressReviewReference({ id: "review-1", choice: "typed", verdict: "validated" }), null);
});

test("simulation is fixture-only and can never manufacture a live validated verdict", () => {
  assert.deepEqual(engine.simulationAddressValidation(TEST_ADDRESS), {
    inputAddress: TEST_ADDRESS,
    standardizedAddress: TEST_ADDRESS,
    latitude: 43.6591,
    longitude: -70.2568,
    verdict: "simulated",
    failureCode: null,
    simulated: true,
  });
  assert.deepEqual(engine.simulationAddressValidation("999 Unknown Fixture Way"), {
    inputAddress: "999 Unknown Fixture Way",
    standardizedAddress: null,
    latitude: null,
    longitude: null,
    verdict: "unvalidated",
    failureCode: "simulation_fixture_not_found",
    simulated: false,
  });
});

test("Google verdict branches map to validated, confirmation, correction, and safe fallback", () => {
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("ACCEPT")).verdict,
    "validated",
  );
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("CONFIRM")).verdict,
    "needs-confirmation",
  );
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("ACCEPT", {
      hasInferredComponents: true,
    })).verdict,
    "needs-confirmation",
  );
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("FIX")).verdict,
    "needs-correction",
  );
  assert.deepEqual(engine.classifyGoogleAddressValidation(TEST_ADDRESS, {}), {
    inputAddress: TEST_ADDRESS,
    standardizedAddress: null,
    latitude: null,
    longitude: null,
    verdict: "unvalidated",
    failureCode: "provider_response_unusable",
    simulated: false,
  });
});

test("the owner gate and server-key check prevent live calls, while an enabled call pins the session token", async () => {
  let calls = 0;
  const noNetwork = async () => {
    calls += 1;
    throw new Error("must not call Google");
  };
  const closed = await engine.validateAddress(
    { address: TEST_ADDRESS, sessionToken: "session-token" },
    { simulation: false, liveEnabled: false, serverApiKey: "FCI_TEST_SECRET", enableUspsCass: false },
    { fetch: noNetwork },
  );
  assert.equal(closed.verdict, "unvalidated");
  assert.equal(closed.failureCode, "owner_gate_closed");
  const missingKey = await engine.validateAddress(
    { address: TEST_ADDRESS, sessionToken: "session-token" },
    { simulation: false, liveEnabled: true, enableUspsCass: false },
    { fetch: noNetwork },
  );
  assert.equal(missingKey.failureCode, "server_key_missing");
  assert.equal(calls, 0);

  let observed;
  const live = await engine.validateAddress(
    { address: TEST_ADDRESS, sessionToken: "same-autocomplete-token" },
    {
      simulation: false,
      liveEnabled: true,
      serverApiKey: "FCI_TEST_SECRET",
      enableUspsCass: true,
    },
    {
      async fetch(url, init) {
        observed = { url, init, body: JSON.parse(init.body) };
        return Response.json(googlePayload("ACCEPT"));
      },
    },
  );
  assert.equal(live.verdict, "validated");
  assert.equal(observed.url, engine.GOOGLE_ADDRESS_VALIDATION_ENDPOINT);
  assert.equal(observed.init.headers["X-Goog-Api-Key"], "FCI_TEST_SECRET");
  assert.equal(observed.body.sessionToken, "same-autocomplete-token");
  assert.equal(observed.body.enableUspsCass, true);
});

test("runtime configuration requires the explicit owner gate even when a server key exists", () => {
  assert.deepEqual(config.getSitesAddressValidationRuntime({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SECRET",
  }), {
    simulation: false,
    liveEnabled: false,
    serverApiKey: "FCI_TEST_SECRET",
    enableUspsCass: false,
  });
  assert.equal(config.getSitesAddressValidationRuntime({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED: "true",
    GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SECRET",
  }).liveEnabled, true);
});

test("review receipts are actor/entity/target/address bound, expire, and consume once", async () => {
  const database = new AddressReviewDatabase();
  try {
    const id = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id,
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      result: reviewResult({ verdict: "needs-confirmation" }),
      now: NOW,
    });
    for (const attempt of [
      { actorId: "other@example.test", entityKind: "project", targetId: "project-1", inputAddress: TEST_ADDRESS },
      { actorId: ACTOR, entityKind: "lead", targetId: "project-1", inputAddress: TEST_ADDRESS },
      { actorId: ACTOR, entityKind: "project", targetId: "project-2", inputAddress: TEST_ADDRESS },
      { actorId: ACTOR, entityKind: "project", targetId: "project-1", inputAddress: "Changed address" },
    ]) {
      const denied = await reviews.consumeAddressValidationReview(database, {
        ...attempt,
        review: { id, choice: "standardized" },
        now: NOW + 1,
      });
      assert.equal(denied.ok, false);
      assert.equal(database.row(id).consumed_at, null);
    }
    const accepted = await reviews.consumeAddressValidationReview(database, {
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      inputAddress: TEST_ADDRESS,
      review: { id, choice: "standardized" },
      now: NOW + 2,
    });
    assert.deepEqual(accepted, {
      ok: true,
      value: {
        address: TEST_ADDRESS,
        latitude: 43.6591,
        longitude: -70.2568,
        verdict: "review-confirmed",
      },
    });
    assert.equal(database.row(id).consumed_at, NOW + 2);
    assert.equal((await reviews.consumeAddressValidationReview(database, {
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      inputAddress: TEST_ADDRESS,
      review: { id, choice: "typed" },
      now: NOW + 3,
    })).ok, false);

    const expiredId = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id: expiredId,
      actorId: ACTOR,
      entityKind: "client",
      targetId: "new",
      result: reviewResult(),
      now: NOW,
    });
    assert.equal((await reviews.consumeAddressValidationReview(database, {
      actorId: ACTOR,
      entityKind: "client",
      targetId: "new",
      inputAddress: TEST_ADDRESS,
      review: { id: expiredId, choice: "typed" },
      now: NOW + domain.ADDRESS_REVIEW_TTL_MS,
    })).ok, false);
  } finally {
    database.close();
  }
});

test("typed fallback saves no geocode and never trusts client-supplied validation fields", async () => {
  const database = new AddressReviewDatabase();
  try {
    const id = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id,
      actorId: ACTOR,
      entityKind: "lead",
      targetId: "new",
      result: reviewResult({
        standardizedAddress: null,
        latitude: null,
        longitude: null,
        verdict: "unvalidated",
        failureCode: "owner_gate_closed",
      }),
      now: NOW,
    });
    assert.deepEqual(await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "lead",
      targetId: "new",
      rawAddress: TEST_ADDRESS,
      rawReview: {
        id,
        choice: "typed",
        latitude: 43.6591,
        longitude: -70.2568,
        verdict: "validated",
      },
      required: true,
      now: NOW + 1,
    }), {
      ok: false,
      message: "Address review reference is invalid.",
    });
    assert.deepEqual(await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "lead",
      targetId: "new",
      rawAddress: TEST_ADDRESS,
      rawReview: { id, choice: "typed" },
      required: true,
      now: NOW + 2,
    }), {
      ok: true,
      value: {
        address: TEST_ADDRESS,
        latitude: null,
        longitude: null,
        verdict: "unvalidated",
      },
    });
  } finally {
    database.close();
  }
});

test("the shared route is bounded, closed-key, simulation-backed, and never returns a key", async () => {
  const database = new AddressReviewDatabase();
  try {
    Object.assign(workerEnvironment, {
      NODE_ENV: "test",
      FCI_OFFICE_EMAILS: ACTOR,
      GOOGLE_INTEGRATION_MODE: "simulation",
      GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SECRET_MUST_NOT_LEAK",
      DB: database,
    });
    const valid = await route.POST(request({
      address: TEST_ADDRESS,
      entityKind: "client",
      targetId: "new",
      sessionToken: "12345678-1234-4123-8123-123456789abc",
    }));
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store");
    const payload = await valid.json();
    assert.equal(payload.availability, "simulation");
    assert.equal(payload.review.verdict, "simulated");
    assert.equal(payload.review.simulated, true);
    assert.doesNotMatch(JSON.stringify(payload), /FCI_TEST_SECRET_MUST_NOT_LEAK/u);

    const tooLong = await route.POST(request({
      address: "x".repeat(281),
      entityKind: "client",
      targetId: "new",
      sessionToken: "12345678-1234-4123-8123-123456789abd",
    }));
    assert.equal(tooLong.status, 400);
    const unknownKey = await route.POST(request({
      address: TEST_ADDRESS,
      entityKind: "client",
      targetId: "new",
      sessionToken: "12345678-1234-4123-8123-123456789abe",
      verdict: "validated",
    }));
    assert.equal(unknownKey.status, 400);
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS count FROM address_validation_reviews",
    ).get().count, 1);
  } finally {
    database.close();
  }
});
