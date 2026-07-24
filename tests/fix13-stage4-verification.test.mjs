import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "fix13-admin@example.test";
const originalNodeEnvironment = process.env.NODE_ENV;
const previousWorkerEnvironment = globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
process.env.NODE_ENV = "test";

const routeState = {
  integrationEventInserts: [],
  projectionFailure: false,
  queries: [],
  simulationState: null,
  verificationEventTypes: [],
};

function routeDatabase() {
  return {
    prepare(sql) {
      const query = { sql, values: [], kind: "prepared" };
      routeState.queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async all() {
          query.kind = "all";
          if (/SELECT event_type\s+FROM google_integration_events/u.test(sql)) {
            if (routeState.projectionFailure) {
              throw new Error("FCI TEST verification projection must not run");
            }
            return {
              results: routeState.verificationEventTypes.map((event_type) => ({ event_type })),
            };
          }
          if (/FROM workspace_resources WHERE connection_key = \?/u.test(sql)) {
            return { results: [] };
          }
          return { results: [] };
        },
        async first() {
          query.kind = "first";
          if (/FROM workspace_simulation_state WHERE id = \?/u.test(sql)) {
            return routeState.simulationState
              ? { state_json: routeState.simulationState }
              : null;
          }
          return null;
        },
        async run() {
          query.kind = "run";
          if (/^INSERT INTO workspace_simulation_state/u.test(sql)) {
            routeState.simulationState = query.values[1];
          }
          if (/^INSERT INTO google_integration_events/u.test(sql)) {
            routeState.integrationEventInserts.push({
              connectionKey: query.values[1],
              eventType: query.values[2],
              actor: query.values[3],
            });
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

const workerEnvironment = {
  NODE_ENV: "test",
  FCI_OFFICE_EMAILS: ADMIN_EMAIL,
  FCI_ADMIN_EMAILS: ADMIN_EMAIL,
  GOOGLE_INTEGRATION_MODE: "simulation",
  DB: routeDatabase(),
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/fix13-stage4-verification",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false },
});
const [
  { readGoogleIntegrationVerification },
  gmailMessagesRoute,
  calendarEventsRoute,
] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/d1/google-integration-verification.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/gmail/messages/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/events/route.ts"),
]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  if (previousWorkerEnvironment === undefined) delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  else globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = previousWorkerEnvironment;
  await vite.close();
});

function resetRouteState({
  projectionFailure = false,
  verificationEventTypes = [],
} = {}) {
  routeState.integrationEventInserts = [];
  routeState.projectionFailure = projectionFailure;
  routeState.queries = [];
  routeState.simulationState = null;
  routeState.verificationEventTypes = [...verificationEventTypes];
}

function routeRequest(path) {
  const url = new URL(path, "https://fci.example.test");
  const request = new Request(url, {
    headers: { "oai-authenticated-user-email": ADMIN_EMAIL },
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function projectionQueries() {
  return routeState.queries.filter(({ sql }) => (
    /SELECT event_type\s+FROM google_integration_events/u.test(sql)
  ));
}

function verificationDatabase(eventTypes) {
  const calls = [];
  return {
    calls,
    database: {
      prepare(sql) {
        const call = { sql, values: [] };
        calls.push(call);
        const statement = {
          bind(...values) {
            call.values = values;
            return statement;
          },
          async all() {
            return { results: eventTypes.map((event_type) => ({ event_type })) };
          },
        };
        return statement;
      },
    },
  };
}

test("Stage-4 verification projection reads only the current connection's durable pass events", async () => {
  for (const fixture of [
    {
      name: "none",
      events: [],
      expected: { gmailTestEmailPassed: false, calendarChecked: false },
    },
    {
      name: "Gmail test",
      events: ["gmail.test_sent"],
      expected: { gmailTestEmailPassed: true, calendarChecked: false },
    },
    {
      name: "Calendar list",
      events: ["calendar.workspace_events_listed"],
      expected: { gmailTestEmailPassed: false, calendarChecked: true },
    },
    {
      name: "Calendar hold",
      events: ["calendar.workspace_hold_created"],
      expected: { gmailTestEmailPassed: false, calendarChecked: true },
    },
    {
      name: "both services and an unrelated event",
      events: ["gmail.test_sent", "calendar.workspace_events_listed", "gmail.archive_filed"],
      expected: { gmailTestEmailPassed: true, calendarChecked: true },
    },
  ]) {
    const { calls, database } = verificationDatabase(fixture.events);
    const result = await readGoogleIntegrationVerification(database, "google-workspace");
    assert.deepEqual(result, fixture.expected, fixture.name);
    assert.equal(calls.length, 1, fixture.name);
    assert.match(calls[0].sql, /SELECT event_type FROM google_integration_events/);
    assert.match(
      calls[0].sql,
      /created_at >= COALESCE\(\(SELECT MAX\(created_at\) FROM google_integration_events WHERE connection_key = \? AND event_type = \?\), 0\)/,
    );
    assert.deepEqual(calls[0].values, [
      "google-workspace",
      "google-workspace",
      "oauth.connected",
      "gmail.test_sent",
      "calendar.workspace_events_listed",
      "calendar.workspace_hold_created",
    ]);
  }
});

test("ordinary Gmail GET keeps its exact public shape and never reads the verification projection", async () => {
  resetRouteState({ projectionFailure: true });

  const response = await gmailMessagesRoute.GET(routeRequest(
    "/api/v1/integrations/google/gmail/messages?label=inbox",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["bucket", "labelReady", "limit", "messages"]);
  assert.equal(body.bucket, "inbox");
  assert.equal(body.labelReady, true);
  assert.equal(body.limit, 20);
  assert.ok(Array.isArray(body.messages));
  assert.equal(projectionQueries().length, 0);
});

test("Gmail verification=status executes the durable projection and exposes only public status fields", async () => {
  resetRouteState({ verificationEventTypes: ["gmail.test_sent"] });

  const response = await gmailMessagesRoute.GET(routeRequest(
    "/api/v1/integrations/google/gmail/messages?label=needs-review&verification=status",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    Object.keys(body).sort(),
    ["bucket", "labelReady", "limit", "messages", "testEmailPassed"],
  );
  assert.equal(body.bucket, "needs-review");
  assert.equal(typeof body.labelReady, "boolean");
  assert.equal(body.labelReady, true);
  assert.equal(typeof body.testEmailPassed, "boolean");
  assert.equal(body.testEmailPassed, true);
  assert.deepEqual(body.messages, []);
  assert.equal(projectionQueries().length, 1);
  assert.equal(routeState.integrationEventInserts.length, 0);
});

test("ordinary Calendar GET keeps its simulation response and audit behavior without reading verification", async () => {
  resetRouteState({ projectionFailure: true });

  const response = await calendarEventsRoute.GET(routeRequest(
    "/api/v1/integrations/google/calendar/events",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    Object.keys(body).sort(),
    ["events", "simulated", "timeZone", "window", "windowDays"],
  );
  assert.equal(body.simulated, true);
  assert.ok(Array.isArray(body.events));
  assert.equal(projectionQueries().length, 0);
  assert.deepEqual(routeState.integrationEventInserts, [{
    connectionKey: "workspace-simulation",
    eventType: "calendar.workspace_events_listed",
    actor: ADMIN_EMAIL,
  }]);
});

test("Calendar verification=status reads the projection without listing or auditing ordinary events", async () => {
  resetRouteState({ verificationEventTypes: ["calendar.workspace_events_listed"] });

  const response = await calendarEventsRoute.GET(routeRequest(
    "/api/v1/integrations/google/calendar/events?verification=status",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["events", "verificationPassed"]);
  assert.deepEqual(body.events, []);
  assert.equal(typeof body.verificationPassed, "boolean");
  assert.equal(body.verificationPassed, true);
  assert.equal(projectionQueries().length, 1);
  assert.equal(routeState.integrationEventInserts.length, 0);
  assert.equal(
    routeState.queries.some(({ sql }) => /FROM workspace_simulation_state/u.test(sql)),
    false,
  );
});

test("existing Gmail and Calendar reads expose only secret-free verification booleans", async () => {
  const [gmailRoute, calendarRoute, panel] = await Promise.all([
    read("app/api/v1/integrations/google/gmail/messages/route.ts"),
    read("app/api/v1/integrations/google/calendar/events/route.ts"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
  ]);

  assert.match(gmailRoute, /testEmailPassed: verification\.gmailTestEmailPassed/);
  assert.match(gmailRoute, /searchParams\.get\("verification"\) === "status"/);
  assert.match(calendarRoute, /verificationPassed: verification\.calendarChecked/);
  assert.match(calendarRoute, /new URL\(request\.url\)\.searchParams\.get\("verification"\) === "status"/);
  assert.doesNotMatch(`${gmailRoute}\n${calendarRoute}`, /verification\.(?:detail|actor|entityId|entityType)/);
  const gmailStatusStart = gmailRoute.indexOf("if (verificationOnly)");
  const gmailOrdinaryStart = gmailRoute.indexOf("if (!labelId)", gmailStatusStart);
  const gmailCatch = gmailRoute.indexOf("} catch (error)", gmailOrdinaryStart);
  assert.ok(gmailStatusStart >= 0 && gmailOrdinaryStart > gmailStatusStart && gmailCatch > gmailOrdinaryStart);
  assert.match(gmailRoute.slice(gmailStatusStart, gmailOrdinaryStart), /readGoogleIntegrationVerification/);
  const gmailOrdinary = gmailRoute.slice(gmailOrdinaryStart, gmailCatch);
  assert.doesNotMatch(gmailOrdinary, /readGoogleIntegrationVerification|testEmailPassed/);
  assert.match(gmailOrdinary, /\{ bucket, messages: \[\], labelReady: false, limit: 20 \}/);
  assert.match(gmailOrdinary, /\{ bucket, messages, labelReady: true, limit: 20 \}/);

  const calendarStatusStart = calendarRoute.indexOf("if (verificationOnly)");
  const calendarOrdinaryStart = calendarRoute.indexOf("if (config.simulation)", calendarStatusStart);
  const calendarCatch = calendarRoute.indexOf("} catch (error)", calendarOrdinaryStart);
  assert.ok(calendarStatusStart >= 0 && calendarOrdinaryStart > calendarStatusStart && calendarCatch > calendarOrdinaryStart);
  assert.match(calendarRoute.slice(calendarStatusStart, calendarOrdinaryStart), /readGoogleIntegrationVerification/);
  const calendarOrdinary = calendarRoute.slice(calendarOrdinaryStart, calendarCatch);
  assert.doesNotMatch(calendarOrdinary, /readGoogleIntegrationVerification|verificationPassed/);
  assert.match(calendarOrdinary, /return noStore\(result\)/);
  assert.match(calendarOrdinary, /return noStore\(await listWorkspaceCalendarEvents\(config, auth\.user\.email\)\)/);

  assert.match(
    panel,
    /gmail\/messages\?label=needs-review&verification=status[\s\S]+calendar\/events\?verification=status/,
  );
  assert.match(
    panel,
    /function stageFourServiceEligible[\s\S]+workspace\?\.gmailEnabled === true[\s\S]+workspace\?\.calendarEnabled === true[\s\S]+if \(!enabled\) return false[\s\S]+workspace\?\.simulation === true[\s\S]+workspace\?\.connectionStatus !== "connected"[\s\S]+workspace\.gmailConnected === true[\s\S]+workspace\.calendarConnected === true/,
  );
  assert.match(
    panel,
    /const \[data, sheetsResult\] = await Promise\.all[\s\S]+const gmailVerificationEligible = isAdmin && stageFourServiceEligible\(nextWorkspace, "gmail"\)[\s\S]+const calendarVerificationEligible = isAdmin && stageFourServiceEligible\(nextWorkspace, "calendar"\)[\s\S]+gmailVerificationEligible[\s\S]+readStageFourVerification[\s\S]+calendarVerificationEligible[\s\S]+readStageFourVerification/,
  );
  assert.match(
    panel,
    /if \(gmailVerificationEligible\)[\s\S]+setGmailVerificationState\("loading"\)[\s\S]+setGmailLabelsReady\(false\)[\s\S]+setGmailTestEmailPassed\(false\)[\s\S]+setGmailVerificationState\("idle"\)/,
  );
  assert.match(
    panel,
    /if \(calendarVerificationEligible\)[\s\S]+setCalendarVerificationState\("loading"\)[\s\S]+setCalendarChecked\(false\)[\s\S]+setCalendarVerificationState\("idle"\)/,
  );
  assert.match(
    panel,
    /setGmailLabelsReady\(Boolean\(gmailVerification\.data\.labelReady\)\)/,
  );
  assert.match(
    panel,
    /setGmailTestEmailPassed\(Boolean\(gmailVerification\.data\.testEmailPassed\)\)/,
  );
  assert.match(
    panel,
    /setCalendarChecked\(Boolean\(calendarVerification\.data\.verificationPassed\)\)/,
  );
  assert.doesNotMatch(panel, /current\) => current \|\| Boolean\((?:gmail|calendar)Verification\.data/);
  assert.match(panel, /const gmailVerificationPassed = gmailLabelsReady && gmailTestEmailPassed/);
  assert.doesNotMatch(
    panel,
    /setGmailTestEmailPassed\(\(current\) => current \|\| Boolean\(gmailVerification\.data\.labelReady\)\)/,
  );
  const refreshStart = panel.indexOf("async function refreshTestGmail()");
  const sendStart = panel.indexOf("async function sendSelfTestEmail()", refreshStart);
  assert.ok(refreshStart >= 0 && sendStart > refreshStart);
  const refreshSource = panel.slice(refreshStart, sendStart);
  assert.doesNotMatch(refreshSource, /setGmailLabelsReady|setGmailTestEmailPassed|labelReady|testEmailPassed/);
  const prepareStart = panel.indexOf("async function prepareTestGmailLabels()");
  const calendarStart = panel.indexOf("async function refreshTestCalendar()", sendStart);
  const sheetsStart = panel.indexOf("async function refreshSheetsStatus()", calendarStart);
  assert.ok(prepareStart >= 0 && sendStart > prepareStart && calendarStart > sendStart && sheetsStart > calendarStart);
  assert.doesNotMatch(
    panel.slice(prepareStart, sheetsStart),
    /setGmailVerificationState\("ready"\)|setCalendarVerificationState\("ready"\)/,
  );
});
