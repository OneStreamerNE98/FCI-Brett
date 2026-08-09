import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const APP_ORIGIN = "https://fci.example.test";
const SIMULATION_CONNECTION_KEY = "workspace-simulation";
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-ws20-gmail-mutation-fences", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24749 } },
});

const [labelsRoute, sendTestRoute, replyDraftRoute] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/integrations/google/gmail/labels/prepare/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/gmail/send-test/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/gmail/messages/[messageId]/reply-draft/route.ts"),
]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function simulationState() {
  return {
    labelsPrepared: false,
    messages: [{
      id: "sim-msg-fence",
      threadId: "sim-thread-fence",
      from: "FCI TEST Customer <customer@example.test>",
      to: "workspace-simulation@fci.example",
      subject: "FCI TEST mutation fence",
      date: "2026-08-08T12:00:00.000Z",
      snippet: "Mutation fence fixture",
      labelIds: ["INBOX"],
      body: "Please save a reply draft.",
      attachments: [],
    }],
    calendarEvents: [],
    drafts: [],
  };
}

function fakeDatabase({ activeOperationKey = null, failIntegrationEvent = false } = {}) {
  const state = {
    simulation: simulationState(),
    leases: new Map(),
    events: [],
    timeline: [],
    queries: [],
    failIntegrationEvent,
  };
  if (activeOperationKey) {
    state.leases.set(activeOperationKey, {
      operationKey: activeOperationKey,
      status: "in-progress",
      leaseExpiresAt: Date.now() + 300_000,
      errorCode: null,
    });
  }

  const database = {
    state,
    prepare(sql) {
      const query = { sql, values: [] };
      state.queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async all() {
          if (/FROM workspace_resources WHERE connection_key = \?/u.test(sql)) {
            return { results: [] };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async first() {
          if (/FROM workspace_settings WHERE id = \?/u.test(sql)) return null;
          if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) return null;
          if (/FROM workspace_simulation_state WHERE id = \?/u.test(sql)) {
            return { state_json: JSON.stringify(state.simulation) };
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          if (/^INSERT INTO google_drive_operations/u.test(sql)) {
            const operationKey = query.values[2];
            const now = query.values[6];
            const existing = state.leases.get(operationKey);
            if (
              existing?.status === "in-progress"
              && existing.leaseExpiresAt >= now
            ) {
              state.timeline.push(`lease-blocked:${operationKey}`);
              return { meta: { changes: 0 } };
            }
            state.leases.set(operationKey, {
              operationKey,
              status: "in-progress",
              leaseExpiresAt: query.values[4],
              errorCode: null,
            });
            state.timeline.push(`lease-acquired:${operationKey}`);
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO workspace_simulation_state/u.test(sql)) {
            state.simulation = JSON.parse(query.values[1]);
            state.timeline.push("provider-mutation");
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO google_integration_events/u.test(sql)) {
            state.timeline.push("integration-event");
            if (state.failIntegrationEvent) throw new Error("FCI TEST event write failed");
            state.events.push({
              connectionKey: query.values[1],
              eventType: query.values[2],
            });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE google_drive_operations SET status = 'completed'/u.test(sql)) {
            const lease = state.leases.get(query.values[1]);
            if (lease?.status !== "in-progress" || lease.leaseExpiresAt !== query.values[2]) {
              return { meta: { changes: 0 } };
            }
            lease.status = "completed";
            lease.leaseExpiresAt = null;
            state.timeline.push("lease-completed");
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE google_drive_operations SET status = 'failed'/u.test(sql)) {
            const lease = state.leases.get(query.values[2]);
            if (lease?.status !== "in-progress" || lease.leaseExpiresAt !== query.values[3]) {
              return { meta: { changes: 0 } };
            }
            lease.status = "failed";
            lease.leaseExpiresAt = null;
            lease.errorCode = query.values[0];
            state.timeline.push(`lease-failed:${query.values[0]}`);
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
      return statement;
    },
  };
  return database;
}

function configure(database) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: ADMIN_EMAIL,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail,calendar,sheets",
    DB: database,
  });
}

function postRequest(path, body = {}) {
  const url = new URL(path, APP_ORIGIN);
  const request = new Request(url, {
    method: "POST",
    headers: {
      origin: APP_ORIGIN,
      "content-type": "application/json",
      "oai-authenticated-user-email": ADMIN_EMAIL,
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function assertMutationOrder(database, operationKey, eventType) {
  assert.deepEqual(database.state.timeline, [
    `lease-acquired:${operationKey}`,
    "provider-mutation",
    "integration-event",
    "lease-completed",
  ]);
  assert.deepEqual(database.state.events, [{
    connectionKey: SIMULATION_CONNECTION_KEY,
    eventType,
  }]);
  assert.equal(database.state.leases.get(operationKey)?.status, "completed");
}

test("WS-20 Gmail provider mutations hold a fenced lease through event persistence", async (t) => {
  await t.test("label preparation", async () => {
    const database = fakeDatabase();
    configure(database);
    const response = await labelsRoute.POST(postRequest(
      "/api/v1/integrations/google/gmail/labels/prepare",
    ));
    assert.equal(response.status, 200);
    assertMutationOrder(
      database,
      `${SIMULATION_CONNECTION_KEY}:setup:gmail-labels-prepare`,
      "gmail.labels_prepared",
    );
  });

  await t.test("test send", async () => {
    const database = fakeDatabase();
    configure(database);
    const response = await sendTestRoute.POST(postRequest(
      "/api/v1/integrations/google/gmail/send-test",
      { to: "workspace-simulation@fci.example", subject: "FCI TEST", body: "Fence test" },
    ));
    assert.equal(response.status, 200);
    assertMutationOrder(
      database,
      `${SIMULATION_CONNECTION_KEY}:setup:gmail-send-test`,
      "gmail.test_sent",
    );
  });

  await t.test("reply draft", async () => {
    const database = fakeDatabase();
    configure(database);
    const response = await replyDraftRoute.POST(
      postRequest(
        "/api/v1/integrations/google/gmail/messages/sim-msg-fence/reply-draft",
        { body: "FCI TEST reply" },
      ),
      { params: Promise.resolve({ messageId: "sim-msg-fence" }) },
    );
    assert.equal(response.status, 200);
    assertMutationOrder(
      database,
      `${SIMULATION_CONNECTION_KEY}:setup:gmail-reply-draft:sim-msg-fence`,
      "gmail.reply_draft_created",
    );
  });
});

test("WS-20 Gmail provider mutations do no work when the fenced lease is unavailable", async (t) => {
  const cases = [
    {
      name: "label preparation",
      operationKey: `${SIMULATION_CONNECTION_KEY}:setup:gmail-labels-prepare`,
      expectedCode: "gmail_labels_prepare_in_progress",
      execute: () => labelsRoute.POST(postRequest(
        "/api/v1/integrations/google/gmail/labels/prepare",
      )),
      assertUnchanged: (database) => assert.equal(database.state.simulation.labelsPrepared, false),
    },
    {
      name: "test send",
      operationKey: `${SIMULATION_CONNECTION_KEY}:setup:gmail-send-test`,
      expectedCode: "gmail_test_send_in_progress",
      execute: () => sendTestRoute.POST(postRequest(
        "/api/v1/integrations/google/gmail/send-test",
        { subject: "FCI TEST", body: "Fence test" },
      )),
      assertUnchanged: (database) => assert.equal(database.state.simulation.messages.length, 1),
    },
    {
      name: "reply draft",
      operationKey: `${SIMULATION_CONNECTION_KEY}:setup:gmail-reply-draft:sim-msg-fence`,
      expectedCode: "gmail_reply_draft_in_progress",
      execute: () => replyDraftRoute.POST(
        postRequest(
          "/api/v1/integrations/google/gmail/messages/sim-msg-fence/reply-draft",
          { body: "FCI TEST reply" },
        ),
        { params: Promise.resolve({ messageId: "sim-msg-fence" }) },
      ),
      assertUnchanged: (database) => assert.equal(database.state.simulation.drafts.length, 0),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const database = fakeDatabase({ activeOperationKey: fixture.operationKey });
      configure(database);
      const response = await fixture.execute(database);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, fixture.expectedCode);
      fixture.assertUnchanged(database);
      assert.deepEqual(database.state.timeline, [`lease-blocked:${fixture.operationKey}`]);
      assert.equal(database.state.events.length, 0);
    });
  }
});

test("WS-20 Gmail provider mutation failures leave a terminal failed lease", async () => {
  const operationKey = `${SIMULATION_CONNECTION_KEY}:setup:gmail-send-test`;
  const database = fakeDatabase({ failIntegrationEvent: true });
  configure(database);
  const response = await sendTestRoute.POST(postRequest(
    "/api/v1/integrations/google/gmail/send-test",
    { subject: "FCI TEST", body: "Fence test" },
  ));

  assert.equal(response.status, 500);
  assert.deepEqual(database.state.timeline, [
    `lease-acquired:${operationKey}`,
    "provider-mutation",
    "integration-event",
    "lease-failed:gmail_test_send_failed",
  ]);
  assert.equal(database.state.leases.get(operationKey)?.status, "failed");
  assert.equal(database.state.leases.get(operationKey)?.errorCode, "gmail_test_send_failed");
});
