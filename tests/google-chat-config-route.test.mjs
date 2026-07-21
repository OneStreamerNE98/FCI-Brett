import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-google-chat-config-route", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24742 } },
});

const [route, notifier, sites] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/integrations/google/chat/config/route.ts"),
  vite.ssrLoadModule("/app/lib/google-chat-notifier.ts"),
  vite.ssrLoadModule("/app/lib/google-chat-notifier-sites.ts"),
]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  delete globalThis.__FCI_TEST_CLOUDFLARE_WAIT_UNTIL__;
  await vite.close();
});

function fakeDatabase(initialRows = {}) {
  const rows = new Map(Object.entries(initialRows));
  const queries = [];
  return {
    rows,
    queries,
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
          if (/FROM workspace_settings WHERE id = \?/u.test(sql)) {
            return rows.get(query.values[0]) ?? null;
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          query.operation = "run";
          if (/^INSERT INTO workspace_settings/u.test(sql)) {
            rows.set(query.values[0], {
              settings_json: query.values[1],
              updated_by: query.values[2],
              updated_at: query.values[3],
            });
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO google_integration_events/u.test(sql)) {
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
      return statement;
    },
  };
}

function setEnvironment(database, overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "false",
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

function exactUpdate(overrides = {}) {
  return {
    events: notifier.GOOGLE_CHAT_EVENT_CATALOG.map((entry) => ({
      type: entry.eventType,
      enabled: false,
      spaceKey: entry.defaultSpaceKey,
      ...(overrides[entry.eventType] ?? {}),
    })),
  };
}

function webhookValue() {
  const host = ["chat", "googleapis", "com"].join(".");
  return `https://${host}/v1/spaces/SPACE_TEST/messages?${new URLSearchParams({ key: "private-key", token: "private-token" })}`;
}

test("GET is office-readable, no-store, default-off, and returns only secret names and presence", async () => {
  const database = fakeDatabase();
  const privateWebhook = webhookValue();
  setEnvironment(database, { GOOGLE_CHAT_SALES_WEBHOOK_URL: privateWebhook });

  const response = await route.GET(routeRequest("/api/v1/integrations/google/chat/config", OFFICE_EMAIL));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.canEdit, false);
  assert.equal(body.featureEnabled, false);
  assert.equal(body.mode, "disabled");
  assert.equal(body.updatedAt, "");
  assert.equal(body.events.length, 4);
  assert.ok(body.events.every((event) => event.enabled === false));
  assert.deepEqual(body.events.map(({ type, spaceKey }) => [type, spaceKey]), [
    ["lead.created", "sales"],
    ["gmail.filing_review_needed", "office-ops"],
    ["calendar.schedule_changed", "field"],
    ["project.warranty_follow_up_due", "service"],
  ]);
  assert.deepEqual(body.spaces.map(({ key, secretEnvVar }) => [key, secretEnvVar]), [
    ["sales", "GOOGLE_CHAT_SALES_WEBHOOK_URL"],
    ["office-ops", "GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL"],
    ["field", "GOOGLE_CHAT_FIELD_WEBHOOK_URL"],
    ["service", "GOOGLE_CHAT_SERVICE_WEBHOOK_URL"],
  ]);
  assert.equal(body.spaces.find((space) => space.key === "sales").configured, true);
  assert.deepEqual(body.missingDetails, []);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(privateWebhook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.deepEqual(database.queries[0].values, ["google-chat-routing"]);

  const adminResponse = await route.GET(routeRequest("/api/v1/integrations/google/chat/config", ADMIN_EMAIL));
  assert.equal((await adminResponse.json()).canEdit, true);
});

test("GET requires an office identity but does not require Administrator access", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const unsigned = await route.GET(routeRequest("/api/v1/integrations/google/chat/config", ""));
  const outsider = await route.GET(routeRequest("/api/v1/integrations/google/chat/config", "outside@example.test"));
  assert.equal(unsigned.status, 401);
  assert.equal(outsider.status, 403);
  assert.equal(database.queries.length, 0);
});

test("PATCH is same-origin Administrator-only, persists a distinct row, and returns the card projection", async () => {
  const database = fakeDatabase({
    workspace: {
      settings_json: JSON.stringify({ timezone: "America/New_York" }),
      updated_by: ADMIN_EMAIL,
      updated_at: 1,
    },
  });
  const privateWebhook = webhookValue();
  setEnvironment(database, {
    GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "true",
    GOOGLE_CHAT_SALES_WEBHOOK_URL: privateWebhook,
  });
  const update = exactUpdate({
    "lead.created": { enabled: true, spaceKey: "sales" },
    "project.warranty_follow_up_due": { enabled: true, spaceKey: "service" },
  });

  const response = await route.PATCH(routeRequest(
    "/api/v1/integrations/google/chat/config",
    ADMIN_EMAIL,
    "PATCH",
    update,
  ));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.canEdit, true);
  assert.equal(body.featureEnabled, true);
  assert.equal(body.mode, "webhook");
  assert.equal(body.events.find((event) => event.type === "lead.created").enabled, true);
  assert.equal(body.events.find((event) => event.type === "project.warranty_follow_up_due").spaceKey, "service");
  assert.ok(Number.isFinite(Date.parse(body.updatedAt)));
  assert.deepEqual(body.missingDetails, [{
    label: "Service and warranty Google Chat webhook",
    envVar: "GOOGLE_CHAT_SERVICE_WEBHOOK_URL",
    secret: true,
  }]);
  assert.doesNotMatch(JSON.stringify(body), /private-key|private-token/u);

  const stored = database.rows.get("google-chat-routing");
  assert.ok(stored);
  assert.equal(stored.updated_by, ADMIN_EMAIL);
  assert.equal(JSON.parse(stored.settings_json).routes.length, 4);
  assert.equal(JSON.parse(database.rows.get("workspace").settings_json).timezone, "America/New_York");

  const getResponse = await route.GET(routeRequest("/api/v1/integrations/google/chat/config", OFFICE_EMAIL));
  const reloaded = await getResponse.json();
  assert.equal(reloaded.events.find((event) => event.type === "lead.created").enabled, true);
  assert.equal(reloaded.canEdit, false);
});

test("simulation PATCH and safe public helper expose no secret and never post", async () => {
  const database = fakeDatabase();
  const privateWebhook = webhookValue();
  setEnvironment(database, {
    GOOGLE_INTEGRATION_MODE: "simulation",
    GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "true",
    GOOGLE_CHAT_SALES_WEBHOOK_URL: privateWebhook,
  });
  const response = await route.PATCH(routeRequest(
    "/api/v1/integrations/google/chat/config",
    ADMIN_EMAIL,
    "PATCH",
    exactUpdate({ "lead.created": { enabled: true } }),
  ));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "simulation");
  assert.deepEqual(body.missingDetails, []);
  assert.doesNotMatch(JSON.stringify(body), /private-key|private-token/u);

  const safeConfig = await sites.readGoogleChatPublicConfig();
  assert.equal(safeConfig.mode, "simulation");
  assert.equal(safeConfig.spaces.find((space) => space.key === "sales").configured, true);
  assert.doesNotMatch(JSON.stringify(safeConfig), /private-key|private-token/u);
});

test("Sites queue composes simulation into google_integration_events without secret or network access", async () => {
  const storedRouting = {
    routes: notifier.GOOGLE_CHAT_EVENT_CATALOG.map((entry) => ({
      eventType: entry.eventType,
      enabled: entry.eventType === "lead.created",
      spaceKey: entry.defaultSpaceKey,
    })),
  };
  const database = fakeDatabase({
    "google-chat-routing": {
      settings_json: JSON.stringify(storedRouting),
      updated_by: ADMIN_EMAIL,
      updated_at: Date.UTC(2026, 6, 21),
    },
  });
  setEnvironment(database, {
    GOOGLE_INTEGRATION_MODE: "simulation",
    GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "true",
  });
  let secretReads = 0;
  Object.defineProperty(workerEnvironment, "GOOGLE_CHAT_SALES_WEBHOOK_URL", {
    configurable: true,
    enumerable: true,
    get() {
      secretReads += 1;
      throw new Error("simulation must not resolve the Chat secret");
    },
  });
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("simulation must not post");
  };
  let deferred;
  try {
    const returned = sites.queueGoogleChatNotification(
      {
        eventType: "lead.created",
        entityId: "lead-simulation-1",
        leadNumber: "L-2026-SIM",
        company: "FCI TEST",
        projectName: "DO NOT USE",
      },
      ADMIN_EMAIL,
      "https://fci.example.test",
      (task) => { deferred = task; },
    );
    assert.equal(returned, undefined);
    assert.ok(deferred instanceof Promise);
    await deferred;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(secretReads, 0);
  assert.equal(networkCalls, 0);
  const audit = database.queries.find((query) => /^INSERT INTO google_integration_events/u.test(query.sql));
  assert.ok(audit);
  assert.equal(audit.values[1], "workspace-simulation");
  assert.equal(audit.values[2], "chat.notification.simulated");
  assert.equal(audit.values[3], ADMIN_EMAIL);
  assert.equal(audit.values[4], "lead");
  assert.equal(audit.values[5], "lead-simulation-1");
  assert.deepEqual(JSON.parse(audit.values[6]), {
    sourceEventType: "lead.created",
    spaceKey: "sales",
    outcome: "simulated",
    attempts: 0,
  });
});

test("PATCH rejects cross-origin and non-Administrator requests before mutation", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const update = exactUpdate();

  const crossOriginRequest = routeRequest(
    "/api/v1/integrations/google/chat/config",
    ADMIN_EMAIL,
    "PATCH",
    update,
  );
  crossOriginRequest.headers.set("origin", "https://evil.example.test");
  const crossOrigin = await route.PATCH(crossOriginRequest);
  const office = await route.PATCH(routeRequest(
    "/api/v1/integrations/google/chat/config",
    OFFICE_EMAIL,
    "PATCH",
    update,
  ));
  assert.equal(crossOrigin.status, 403);
  assert.equal(office.status, 403);
  assert.equal(database.queries.some((query) => query.operation === "run"), false);
});

test("PATCH rejects every incomplete or expanded catalog shape without a write", async (t) => {
  const valid = exactUpdate();
  const invalidBodies = [
    { ...valid, webhookUrl: "caller-supplied" },
    { events: valid.events.slice(0, 3) },
    { events: [...valid.events, valid.events[0]] },
    { events: valid.events.map((event, index) => index === 0 ? { ...event, enabled: "true" } : event) },
    { events: valid.events.map((event, index) => index === 0 ? { ...event, type: "lead.unknown" } : event) },
    { events: valid.events.map((event, index) => index === 0 ? { ...event, spaceKey: "custom" } : event) },
    { events: valid.events.map((event, index) => index === 0 ? { ...event, secretEnvVar: "GOOGLE_CHAT_CUSTOM_WEBHOOK_URL" } : event) },
    { routes: valid.events.map(({ type, ...event }) => ({ eventType: type, ...event })) },
  ];

  for (const [index, body] of invalidBodies.entries()) {
    await t.test(String(index), async () => {
      const database = fakeDatabase();
      setEnvironment(database);
      const response = await route.PATCH(routeRequest(
        "/api/v1/integrations/google/chat/config",
        ADMIN_EMAIL,
        "PATCH",
        body,
      ));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: "Send the exact Google Chat notification routing catalog.",
      });
      assert.equal(database.queries.some((query) => query.operation === "run"), false);
    });
  }
});

test("PATCH enforces the 8 KB streamed body limit", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const response = await route.PATCH(routeRequest(
    "/api/v1/integrations/google/chat/config",
    ADMIN_EMAIL,
    "PATCH",
    JSON.stringify({ events: [], padding: "x".repeat(8_100) }),
  ));
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Google Chat notification settings are too large.",
  });
  assert.equal(database.queries.some((query) => query.operation === "run"), false);
});

test("malformed persisted settings fail closed to all routes disabled", async () => {
  const database = fakeDatabase({
    "google-chat-routing": {
      settings_json: "{not-json",
      updated_by: ADMIN_EMAIL,
      updated_at: Date.UTC(2026, 6, 21),
    },
  });
  setEnvironment(database, { GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "true" });
  const response = await route.GET(routeRequest("/api/v1/integrations/google/chat/config", OFFICE_EMAIL));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.events.every((event) => event.enabled === false));
  assert.equal(body.updatedAt, "2026-07-21T00:00:00.000Z");
});
