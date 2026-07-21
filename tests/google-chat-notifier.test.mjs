import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-google-chat-notifier", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24741 } },
});

const notifier = await vite.ssrLoadModule("/app/lib/google-chat-notifier.ts");

after(async () => {
  await vite.close();
});

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const APP_ORIGIN = "https://fci.example.test";

const events = [
  {
    eventType: "lead.created",
    entityId: "lead-1",
    leadNumber: "L-2026-0001",
    company: "FCI <North> & Sons",
    projectName: "Lobby \"Refresh\"",
  },
  {
    eventType: "gmail.filing_review_needed",
    entityId: "message-1",
    subject: "Review <proposal> & attachments",
    projectLabel: "P-2026-010",
  },
  {
    eventType: "calendar.schedule_changed",
    entityId: "event-1",
    projectName: "FCI 'Schedule'",
    changeSummary: "Start moved <one day>",
  },
  {
    eventType: "project.warranty_follow_up_due",
    entityId: "project-1",
    projectName: "Suite & Hall",
    followUpLabel: "Due <tomorrow>",
  },
];

const expectedLinks = new Map([
  ["lead.created", "/leads?stage=new-inquiry"],
  ["gmail.filing_review_needed", "/inbox?bucket=needs-review"],
  ["calendar.schedule_changed", "/schedule"],
  ["project.warranty_follow_up_due", "/projects?status=closeout"],
]);

function enabledRouting(eventType, spaceKey = "sales") {
  const defaults = notifier.defaultGoogleChatRouting();
  return {
    routes: defaults.routes.map((route) => ({
      ...route,
      enabled: route.eventType === eventType,
      spaceKey: route.eventType === eventType ? spaceKey : route.spaceKey,
    })),
  };
}

function webhookUrl() {
  const host = ["chat", "googleapis", "com"].join(".");
  const query = new URLSearchParams({
    key: "test-key-material",
    token: "test-token-material",
  });
  return `https://${host}/v1/spaces/SPACE_TEST/messages?${query}`;
}

function deliveryDependencies(overrides = {}) {
  return {
    fetch: async () => ({ ok: true, status: 200 }),
    resolveWebhook: () => webhookUrl(),
    writeAudit: async () => undefined,
    randomUUID: () => REQUEST_ID,
    sleep: async () => undefined,
    timeoutSignal: () => new AbortController().signal,
    retryDelayMs: 25,
    timeoutMs: 100,
    ...overrides,
  };
}

test("defines the exact four-event catalog and fixed default-off routing", () => {
  assert.deepEqual(
    notifier.GOOGLE_CHAT_EVENT_CATALOG.map(({ eventType }) => eventType),
    events.map(({ eventType }) => eventType),
  );
  assert.deepEqual(
    notifier.GOOGLE_CHAT_SPACE_CATALOG.map(({ spaceKey, envVar }) => [spaceKey, envVar]),
    [
      ["sales", "GOOGLE_CHAT_SALES_WEBHOOK_URL"],
      ["office-ops", "GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL"],
      ["field", "GOOGLE_CHAT_FIELD_WEBHOOK_URL"],
      ["service", "GOOGLE_CHAT_SERVICE_WEBHOOK_URL"],
    ],
  );
  assert.ok(notifier.defaultGoogleChatRouting().routes.every((route) => route.enabled === false));
  assert.equal(notifier.googleChatNotificationsEnabled({}), false);
  assert.equal(notifier.googleChatNotificationsEnabled({ GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "TRUE" }), false);
  assert.equal(notifier.googleChatNotificationsEnabled({ GOOGLE_CHAT_NOTIFICATIONS_ENABLED: " true" }), false);
  assert.equal(notifier.googleChatNotificationsEnabled({ GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "true" }), true);
});

test("builds bounded escaped cardsV2 payloads with canonical absolute deep links", () => {
  for (const event of events) {
    const payload = notifier.buildGoogleChatPayload(event, APP_ORIGIN);
    assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") < 32_000);
    assert.equal(typeof payload.fallbackText, "string");
    assert.ok(payload.fallbackText.length <= 500);
    assert.equal(payload.cardsV2.length, 1);
    const card = payload.cardsV2[0].card;
    const paragraph = card.sections[0].widgets[0].textParagraph.text;
    const button = card.sections[0].widgets[1].buttonList.buttons[0];
    assert.equal(button.altText, "Open this item in FCI Operations");
    assert.equal(button.onClick.openLink.url, new URL(expectedLinks.get(event.eventType), APP_ORIGIN).href);
    assert.doesNotMatch(paragraph, /<proposal>|<one day>|<tomorrow>|<North>/u);
    assert.doesNotMatch(payload.fallbackText, /&(?:amp|lt|gt|quot|#39);/u);
    assert.match(JSON.stringify(payload), /&(?:amp|lt|gt|quot|#39);/u);
  }
  assert.throws(
    () => notifier.buildGoogleChatPayload(events[0], "http://fci.example.test"),
    /HTTPS/u,
  );
});

test("strict routing parser accepts the exact full catalog and rejects caller-controlled expansion", () => {
  const body = {
    events: notifier.GOOGLE_CHAT_EVENT_CATALOG.map((entry) => ({
      type: entry.eventType,
      enabled: entry.eventType === "lead.created",
      spaceKey: entry.defaultSpaceKey,
    })),
  };
  const parsed = notifier.parseGoogleChatRoutingUpdate(body);
  assert.ok(parsed);
  assert.equal(parsed.routes.length, 4);
  assert.equal(parsed.routes[0].enabled, true);

  assert.equal(notifier.parseGoogleChatRoutingUpdate({ ...body, webhookUrl: "forbidden" }), null);
  assert.equal(notifier.parseGoogleChatRoutingUpdate({ events: body.events.slice(0, 3) }), null);
  assert.equal(notifier.parseGoogleChatRoutingUpdate({ events: [...body.events, body.events[0]] }), null);
  assert.equal(notifier.parseGoogleChatRoutingUpdate({
    events: body.events.map((event, index) => index === 0 ? { ...event, spaceKey: "custom-space" } : event),
  }), null);
  assert.equal(notifier.parseGoogleChatRoutingUpdate({
    events: body.events.map((event, index) => index === 0 ? { ...event, secretEnvVar: "CALLER_VALUE" } : event),
  }), null);
});

test("safe public config returns only fixed secret names and presence", () => {
  const secretValue = "opaque-webhook-value-that-must-not-return";
  const routing = enabledRouting("lead.created", "sales");
  routing.routes.find((route) => route.eventType === "project.warranty_follow_up_due").enabled = true;
  const config = notifier.buildGoogleChatPublicConfig({
    environment: {
      GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "true",
      GOOGLE_CHAT_SALES_WEBHOOK_URL: secretValue,
    },
    simulation: false,
    routing,
    updatedAt: Date.UTC(2026, 6, 21),
  });
  assert.equal(config.featureEnabled, true);
  assert.equal(config.mode, "webhook");
  assert.equal(config.events.length, 4);
  assert.equal(config.spaces.find((space) => space.key === "sales").configured, true);
  assert.deepEqual(config.missingDetails, [{
    label: "Service and warranty Google Chat webhook",
    envVar: "GOOGLE_CHAT_SERVICE_WEBHOOK_URL",
    secret: true,
  }]);
  assert.equal(config.updatedAt, "2026-07-21T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(config), new RegExp(secretValue, "u"));

  const simulation = notifier.buildGoogleChatPublicConfig({
    environment: { GOOGLE_CHAT_NOTIFICATIONS_ENABLED: "true" },
    simulation: true,
    routing,
    updatedAt: null,
  });
  assert.equal(simulation.mode, "simulation");
  assert.deepEqual(simulation.missingDetails, []);
});

test("default-off and disabled routes perform no secret, network, backoff, or audit work", async () => {
  const counters = { secret: 0, fetch: 0, sleep: 0, audit: 0, uuid: 0 };
  const dependencies = deliveryDependencies({
    resolveWebhook: () => { counters.secret += 1; return webhookUrl(); },
    fetch: async () => { counters.fetch += 1; return { ok: true, status: 200 }; },
    sleep: async () => { counters.sleep += 1; },
    writeAudit: async () => { counters.audit += 1; },
    randomUUID: () => { counters.uuid += 1; return REQUEST_ID; },
  });
  const off = await notifier.deliverGoogleChatNotification(events[0], "actor@example.test", APP_ORIGIN, {
    notificationsEnabled: false,
    simulation: false,
    routing: enabledRouting("lead.created"),
  }, dependencies);
  const routeOff = await notifier.deliverGoogleChatNotification(events[0], "actor@example.test", APP_ORIGIN, {
    notificationsEnabled: true,
    simulation: false,
    routing: notifier.defaultGoogleChatRouting(),
  }, dependencies);
  assert.deepEqual(off, { outcome: "skipped", attempts: 0 });
  assert.deepEqual(routeOff, { outcome: "skipped", attempts: 0 });
  assert.deepEqual(counters, { secret: 0, fetch: 0, sleep: 0, audit: 0, uuid: 0 });
});

test("simulation resolves no webhook and records only a sanitized integration event", async () => {
  const audits = [];
  let secretCalls = 0;
  let networkCalls = 0;
  const result = await notifier.deliverGoogleChatNotification(events[0], "actor@example.test", APP_ORIGIN, {
    notificationsEnabled: true,
    simulation: true,
    routing: enabledRouting("lead.created", "sales"),
  }, deliveryDependencies({
    resolveWebhook: () => { secretCalls += 1; throw new Error("must not resolve"); },
    fetch: async () => { networkCalls += 1; throw new Error("must not fetch"); },
    writeAudit: async (record) => { audits.push(record); },
  }));

  assert.equal(result.outcome, "simulated");
  assert.equal(secretCalls, 0);
  assert.equal(networkCalls, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].eventType, "chat.notification.simulated");
  assert.deepEqual(JSON.parse(audits[0].detail), {
    sourceEventType: "lead.created",
    spaceKey: "sales",
    outcome: "simulated",
    attempts: 0,
  });
  assert.doesNotMatch(audits[0].detail, /requestId|fallbackText|cardsV2|webhook|company/iu);
});

test("uses Google's stable requestId query parameter and retries once for network, 429, or 503", async (t) => {
  for (const scenario of ["network", 429, 503]) {
    await t.test(String(scenario), async () => {
      const calls = [];
      const sleeps = [];
      const audits = [];
      const result = await notifier.deliverGoogleChatNotification(events[0], "actor@example.test", APP_ORIGIN, {
        notificationsEnabled: true,
        simulation: false,
        routing: enabledRouting("lead.created", "sales"),
      }, deliveryDependencies({
        fetch: async (input, init) => {
          calls.push({ input: String(input), init });
          if (calls.length === 1 && scenario === "network") throw new Error("provider details must be discarded");
          if (calls.length === 1) return { ok: false, status: scenario };
          return { ok: true, status: 200 };
        },
        sleep: async (milliseconds) => { sleeps.push(milliseconds); },
        writeAudit: async (record) => { audits.push(record); },
      }));

      assert.equal(result.outcome, "sent");
      assert.equal(result.attempts, 2);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].input, calls[1].input);
      const deliveryUrl = new URL(calls[0].input);
      assert.equal(deliveryUrl.searchParams.get("requestId"), REQUEST_ID);
      assert.equal(deliveryUrl.searchParams.get("key"), "test-key-material");
      assert.equal(deliveryUrl.searchParams.get("token"), "test-token-material");
      assert.equal(calls[0].init.redirect, "error");
      assert.equal(calls[0].init.method, "POST");
      assert.equal(calls[0].init.body, calls[1].init.body);
      assert.equal(new Headers(calls[0].init.headers).has("X-FCI-Request-ID"), false);
      assert.deepEqual(sleeps, [25]);
      assert.equal(audits.at(-1).eventType, "chat.notification.sent");
      assert.deepEqual(JSON.parse(audits.at(-1).detail), {
        sourceEventType: "lead.created",
        spaceKey: "sales",
        outcome: "sent",
        attempts: 2,
      });
    });
  }
});

test("does not retry other HTTP failures and never consumes provider response content", async () => {
  let calls = 0;
  let sleeps = 0;
  let bodyReads = 0;
  const audits = [];
  const result = await notifier.deliverGoogleChatNotification(events[1], "actor@example.test", APP_ORIGIN, {
    notificationsEnabled: true,
    simulation: false,
    routing: enabledRouting("gmail.filing_review_needed", "office-ops"),
  }, deliveryDependencies({
    fetch: async () => {
      calls += 1;
      return {
        ok: false,
        status: 400,
        text: async () => { bodyReads += 1; return "secret provider error body"; },
      };
    },
    sleep: async () => { sleeps += 1; },
    writeAudit: async (record) => { audits.push(record); },
  }));
  assert.equal(result.outcome, "failed");
  assert.equal(result.errorCode, "provider_rejected");
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
  assert.equal(bodyReads, 0);
  assert.deepEqual(JSON.parse(audits[0].detail), {
    sourceEventType: "gmail.filing_review_needed",
    spaceKey: "office-ops",
    outcome: "failed",
    attempts: 1,
    errorCode: "provider_rejected",
  });
});

test("uses a one-second default backoff for the per-space write quota", async () => {
  const sleeps = [];
  let calls = 0;
  const dependencies = deliveryDependencies({
    fetch: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 429 } : { ok: true, status: 200 };
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  delete dependencies.retryDelayMs;
  const result = await notifier.deliverGoogleChatNotification(events[0], "actor@example.test", APP_ORIGIN, {
    notificationsEnabled: true,
    simulation: false,
    routing: enabledRouting("lead.created", "sales"),
  }, dependencies);
  assert.equal(result.outcome, "sent");
  assert.deepEqual(sleeps, [1_000]);
});

test("bounds default backoff and timeouts while isolating delivery and audit failures", async () => {
  const sleeps = [];
  const timeouts = [];
  let calls = 0;
  const result = await notifier.deliverGoogleChatNotification(events[2], "actor@example.test", APP_ORIGIN, {
    notificationsEnabled: true,
    simulation: false,
    routing: enabledRouting("calendar.schedule_changed", "field"),
  }, deliveryDependencies({
    fetch: async () => {
      calls += 1;
      throw new Error("raw URL and payload must never escape");
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    timeoutSignal: (milliseconds) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    },
    retryDelayMs: 99_999,
    timeoutMs: 99_999,
    writeAudit: async () => { throw new Error("audit unavailable"); },
  }));
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [5_000]);
  assert.deepEqual(timeouts, [10_000, 10_000]);
  assert.deepEqual(result, {
    outcome: "failed",
    attempts: 2,
    requestId: REQUEST_ID,
    errorCode: "network_error",
  });
  assert.doesNotMatch(JSON.stringify(result), /raw URL|payload|audit unavailable/iu);
});

test("invalid or throwing request id fails and audits before secret or network access", async (t) => {
  for (const randomUUID of [() => "not-a-uuid", () => { throw new Error("random source detail"); }]) {
    await t.test(randomUUID.toString().slice(0, 24), async () => {
      let secrets = 0;
      let network = 0;
      const audits = [];
      const result = await notifier.deliverGoogleChatNotification(events[3], "actor@example.test", APP_ORIGIN, {
        notificationsEnabled: true,
        simulation: false,
        routing: enabledRouting("project.warranty_follow_up_due", "service"),
      }, deliveryDependencies({
        randomUUID,
        resolveWebhook: () => { secrets += 1; return webhookUrl(); },
        fetch: async () => { network += 1; return { ok: true, status: 200 }; },
        writeAudit: async (record) => { audits.push(record); },
      }));
      assert.deepEqual(result, { outcome: "failed", attempts: 0, errorCode: "invalid_request_id" });
      assert.equal(secrets, 0);
      assert.equal(network, 0);
      assert.equal(audits[0].eventType, "chat.notification.failed");
      assert.equal(JSON.parse(audits[0].detail).errorCode, "invalid_request_id");
    });
  }
});

test("rejects non-Chat and malformed webhook secrets without network or leakage", async () => {
  const audits = [];
  let calls = 0;
  const result = await notifier.deliverGoogleChatNotification(events[0], "actor@example.test", APP_ORIGIN, {
    notificationsEnabled: true,
    simulation: false,
    routing: enabledRouting("lead.created", "sales"),
  }, deliveryDependencies({
    resolveWebhook: () => "https://example.test/not-chat?key=private&token=private",
    fetch: async () => { calls += 1; return { ok: true, status: 200 }; },
    writeAudit: async (record) => { audits.push(record); },
  }));
  assert.equal(calls, 0);
  assert.equal(result.errorCode, "invalid_webhook_secret");
  assert.doesNotMatch(JSON.stringify(result), /example|private/iu);
  assert.doesNotMatch(audits[0].detail, /example|private/iu);
});

test("defer API returns immediately, catches task failures, and does not start work when deferral rejects", async () => {
  let captured;
  let started = false;
  const returned = notifier.deferGoogleChatTask((task) => { captured = task; }, async () => {
    started = true;
    throw new Error("isolated");
  });
  assert.equal(returned, undefined);
  assert.equal(started, false);
  await captured;
  assert.equal(started, true);

  let rejectedTaskStarted = false;
  assert.doesNotThrow(() => notifier.deferGoogleChatTask(() => { throw new Error("no execution context"); }, async () => {
    rejectedTaskStarted = true;
  }));
  await Promise.resolve();
  assert.equal(rejectedTaskStarted, false);
});
