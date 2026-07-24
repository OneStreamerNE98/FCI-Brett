import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-assistant-config-route", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24748 } },
});

const route = await vite.ssrLoadModule("/app/api/v1/assistant/config/route.ts");

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function fakeDatabase(initialSettings) {
  let row = initialSettings === undefined
    ? null
    : {
        id: "workspace",
        shared_drive_id: "saved-drive",
        client_directory_sheet_id: "saved-sheet",
        intake_mailbox: "ops@example.test",
        settings_json: JSON.stringify(initialSettings),
        updated_by: ADMIN_EMAIL,
        updated_at: 1,
      };
  const queries = [];
  return {
    queries,
    readSettings() {
      return row ? JSON.parse(row.settings_json) : null;
    },
    prepare(sql) {
      const query = { sql, values: [], operation: "prepared" };
      queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async first() {
          query.operation = "first";
          if (/FROM workspace_settings WHERE id = \?/u.test(sql)) return row;
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          query.operation = "run";
          if (!/^INSERT INTO workspace_settings/u.test(sql)) {
            throw new Error(`Unexpected run query: ${sql}`);
          }
          row = {
            ...(row ?? {}),
            id: query.values[0],
            settings_json: query.values[1],
            updated_by: query.values[2],
            updated_at: query.values[3],
          };
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

function setEnvironment(database, overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    OPENAI_API_KEY: "sk-test-config-secret-never-return",
    OPENAI_MODEL: "gpt-test-config-model",
    DB: database,
    ...overrides,
  });
}

function routeRequest(path, email, method = "GET", body, origin = "https://fci.example.test") {
  const url = new URL(path, origin);
  const request = new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: url.origin, "content-type": "application/json" }),
      ...(email ? { "oai-authenticated-user-email": email } : {}),
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("GET is office-readable, no-store, secret-safe, and defaults every feature from key presence", async () => {
  const database = fakeDatabase();
  const secret = "sk-test-config-secret-never-return";
  setEnvironment(database, { OPENAI_API_KEY: secret });

  const response = await route.GET(
    routeRequest("/api/v1/assistant/config", OFFICE_EMAIL),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    provider: "openai",
    keyState: "Configured",
    model: "gpt-test-config-model",
    features: {
      orgQa: true,
      triage: true,
      replyDrafts: true,
      taskExtraction: true,
    },
  });
  assert.doesNotMatch(JSON.stringify(body), new RegExp(secret, "u"));
  assert.deepEqual(Object.keys(body).sort(), ["features", "keyState", "model", "provider"]);
  assert.deepEqual(Object.keys(body.features).sort(), [
    "orgQa",
    "replyDrafts",
    "taskExtraction",
    "triage",
  ]);

  setEnvironment(database, { OPENAI_API_KEY: "" });
  const missingResponse = await route.GET(
    routeRequest("/api/v1/assistant/config", OFFICE_EMAIL),
  );
  const missing = await missingResponse.json();
  assert.equal(missing.keyState, "Missing");
  assert.deepEqual(missing.features, {
    orgQa: false,
    triage: false,
    replyDrafts: false,
    taskExtraction: false,
  });
});

test("GET rejects missing and out-of-office identities before database work", async () => {
  for (const [name, email, expectedStatus] of [
    ["missing identity", null, 401],
    ["outside allowlist", "outsider@example.test", 403],
  ]) {
    const database = fakeDatabase();
    setEnvironment(database);
    const response = await route.GET(
      routeRequest("/api/v1/assistant/config", email),
    );
    assert.equal(response.status, expectedStatus, name);
    assert.equal(response.headers.get("cache-control"), "no-store", name);
    assert.equal(database.queries.length, 0, name);
  }
});

test("GET widens stored features one key at a time and never exposes unknown stored keys", async () => {
  const database = fakeDatabase({
    timezone: "America/Chicago",
    aiFeatures: {
      orgQa: false,
      triage: "invalid-stored-value",
      futureFeature: "preserve-but-never-expose",
    },
  });
  setEnvironment(database);

  const response = await route.GET(
    routeRequest("/api/v1/assistant/config", OFFICE_EMAIL),
  );
  assert.deepEqual(await response.json(), {
    provider: "openai",
    keyState: "Configured",
    model: "gpt-test-config-model",
    features: {
      orgQa: false,
      triage: true,
      replyDrafts: true,
      taskExtraction: true,
    },
  });
});

test("PATCH round-trips a known subset while preserving sibling settings and unknown nested keys", async () => {
  const database = fakeDatabase({
    timezone: "America/Chicago",
    futureWorkspaceSetting: { retained: true },
    aiFeatures: {
      orgQa: false,
      futureFeature: "preserved",
    },
  });
  setEnvironment(database);

  const response = await route.PATCH(routeRequest(
    "/api/v1/assistant/config",
    ADMIN_EMAIL,
    "PATCH",
    { features: { triage: false, taskExtraction: false } },
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    provider: "openai",
    keyState: "Configured",
    model: "gpt-test-config-model",
    features: {
      orgQa: false,
      triage: false,
      replyDrafts: true,
      taskExtraction: false,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(body),
    /sk-test-config-secret-never-return/u,
  );
  assert.deepEqual(Object.keys(body).sort(), ["features", "keyState", "model", "provider"]);

  const stored = database.readSettings();
  assert.equal(stored.timezone, "America/Chicago");
  assert.deepEqual(stored.futureWorkspaceSetting, { retained: true });
  assert.equal(stored.aiFeatures.futureFeature, "preserved");
  assert.deepEqual(
    {
      orgQa: stored.aiFeatures.orgQa,
      triage: stored.aiFeatures.triage,
      replyDrafts: stored.aiFeatures.replyDrafts,
      taskExtraction: stored.aiFeatures.taskExtraction,
    },
    body.features,
  );
  assert.equal(
    database.queries.filter((query) => query.operation === "run").length,
    1,
  );

  const reloaded = await route.GET(
    routeRequest("/api/v1/assistant/config", OFFICE_EMAIL),
  );
  assert.deepEqual((await reloaded.json()).features, body.features);
});

test("PATCH while the key is missing preserves enabled defaults for a later configured runtime", async () => {
  const database = fakeDatabase();
  setEnvironment(database, { OPENAI_API_KEY: "" });

  const response = await route.PATCH(routeRequest(
    "/api/v1/assistant/config",
    ADMIN_EMAIL,
    "PATCH",
    { features: { triage: false } },
  ));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).features, {
    orgQa: false,
    triage: false,
    replyDrafts: false,
    taskExtraction: false,
  });
  assert.deepEqual(database.readSettings().aiFeatures, {
    orgQa: true,
    triage: false,
    replyDrafts: true,
    taskExtraction: true,
  });

  setEnvironment(database);
  const configured = await route.GET(
    routeRequest("/api/v1/assistant/config", OFFICE_EMAIL),
  );
  assert.deepEqual((await configured.json()).features, {
    orgQa: true,
    triage: false,
    replyDrafts: true,
    taskExtraction: true,
  });
});

test("PATCH is same-origin and Administrator-only before any settings write", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const update = { features: { orgQa: false } };

  const office = await route.PATCH(routeRequest(
    "/api/v1/assistant/config",
    OFFICE_EMAIL,
    "PATCH",
    update,
  ));
  const crossOriginRequest = routeRequest(
    "/api/v1/assistant/config",
    ADMIN_EMAIL,
    "PATCH",
    update,
  );
  crossOriginRequest.headers.set("origin", "https://evil.example.test");
  const crossOrigin = await route.PATCH(crossOriginRequest);

  assert.equal(office.status, 403);
  assert.equal(office.headers.get("cache-control"), "no-store");
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get("cache-control"), "no-store");
  assert.equal(
    database.queries.some((query) => query.operation === "run"),
    false,
  );
});

test("PATCH rejects empty, expanded, and non-boolean feature updates without a write", async (t) => {
  const invalidBodies = [
    {},
    { features: {} },
    { features: { invented: true } },
    { features: { orgQa: "true" } },
    { features: { orgQa: true }, provider: "caller-controlled" },
  ];

  for (const [index, body] of invalidBodies.entries()) {
    await t.test(String(index), async () => {
      const database = fakeDatabase();
      setEnvironment(database);
      const response = await route.PATCH(routeRequest(
        "/api/v1/assistant/config",
        ADMIN_EMAIL,
        "PATCH",
        body,
      ));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: "Send one or more valid AI feature settings.",
      });
      assert.equal(
        database.queries.some((query) => query.operation === "run"),
        false,
      );
    });
  }
});

test("PATCH enforces the 8 KB streamed body limit before persistence", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const response = await route.PATCH(routeRequest(
    "/api/v1/assistant/config",
    ADMIN_EMAIL,
    "PATCH",
    JSON.stringify({
      features: { orgQa: false },
      padding: "x".repeat(8_100),
    }),
  ));

  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "AI feature settings update is too large.",
  });
  assert.equal(database.queries.length, 0);
});
