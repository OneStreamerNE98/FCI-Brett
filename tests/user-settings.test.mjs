import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import {
  defaultUserNotificationPreferences,
  normalizeUserNotificationPreferences,
  parseStoredUserNotificationPreferences,
} from "../app/lib/user-settings.ts";
import { defaultPageLayouts } from "../app/lib/page-layouts.ts";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-user-settings", import.meta.url)),
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

const route = await vite.ssrLoadModule("/app/api/v1/settings/me/route.ts");

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
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
          if (/FROM user_preferences WHERE user_email = \?/u.test(sql)) return structuredClone(rows.get(query.values[0]) ?? null);
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          query.operation = "run";
          if (/^INSERT INTO user_preferences/u.test(sql)) {
            rows.set(query.values[0], {
              display_timezone: query.values[1],
              reply_signature: query.values[2],
              notification_preferences_json: query.values[3],
              page_layouts_json: query.values[4],
              updated_at: query.values[5],
            });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
      return statement;
    },
  };
}

function setEnvironment(database) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    DB: database,
  });
}

function routeRequest(email, method = "GET", body, path = "/api/v1/settings/me", requestOrigin = "https://fci.example.test", originHeader = requestOrigin) {
  const url = new URL(path, requestOrigin);
  const request = new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: originHeader, "content-type": "application/json" }),
      ...(email ? { "oai-authenticated-user-email": email } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function notificationPreferences(enabledKey) {
  return Object.fromEntries(Object.keys(defaultUserNotificationPreferences()).map((key) => [key, key === enabledKey]));
}

function pageLayouts(overviewFirst, overviewHidden, reportsFirst, reportsHidden) {
  const defaults = defaultPageLayouts(false);
  return {
    overview: {
      order: [overviewFirst, ...defaults.overview.order.filter((key) => key !== overviewFirst)],
      hidden: [overviewHidden],
    },
    reports: {
      order: [reportsFirst, ...defaults.reports.order.filter((key) => key !== reportsFirst)],
      hidden: [reportsHidden],
    },
  };
}

test("keeps the per-user notification catalog closed and fails stored corruption to safe defaults", () => {
  const defaults = defaultUserNotificationPreferences();
  assert.deepEqual(defaults, {
    "lead.created": false,
    "gmail.filing_review_needed": false,
    "calendar.schedule_changed": false,
    "project.warranty_follow_up_due": false,
  });
  assert.deepEqual(normalizeUserNotificationPreferences(notificationPreferences("lead.created")), {
    ...defaults,
    "lead.created": true,
  });
  assert.equal(normalizeUserNotificationPreferences({ "lead.created": true }), null);
  assert.equal(normalizeUserNotificationPreferences({ ...defaults, invented: true }), null);
  assert.equal(normalizeUserNotificationPreferences({ ...defaults, "lead.created": "yes" }), null);
  assert.deepEqual(parseStoredUserNotificationPreferences("not-json"), defaults);
  assert.deepEqual(parseStoredUserNotificationPreferences(JSON.stringify({ "lead.created": true })), defaults);
});

test("GET and PATCH read and write only the authenticated identity row", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const adminPreferences = {
    displayTimezone: "America/Chicago",
    replySignature: "Admin signature",
    notificationPreferences: notificationPreferences("lead.created"),
    pageLayouts: pageLayouts("scheduling", "gmail-project-inbox", "projects-by-status", "future-reports"),
  };
  const officePreferences = {
    displayTimezone: "America/Denver",
    replySignature: "Office signature",
    notificationPreferences: notificationPreferences("calendar.schedule_changed"),
    pageLayouts: pageLayouts("active-projects", "scheduling", "business-kpis", "summary-metrics"),
  };

  const adminWrite = await route.PATCH(routeRequest(ADMIN_EMAIL, "PATCH", adminPreferences));
  assert.equal(adminWrite.status, 200);
  assert.deepEqual((await adminWrite.json()).preferences, adminPreferences);
  assert.equal(database.queries.at(-1).values[0], ADMIN_EMAIL);

  const officeBefore = await route.GET(routeRequest(OFFICE_EMAIL));
  assert.equal(officeBefore.status, 200);
  const officeBeforeBody = await officeBefore.json();
  assert.deepEqual(officeBeforeBody.preferences.notificationPreferences, defaultUserNotificationPreferences());
  assert.deepEqual(officeBeforeBody.preferences.pageLayouts, defaultPageLayouts(false));
  assert.equal(database.queries.at(-1).values[0], OFFICE_EMAIL);

  const officeWrite = await route.PATCH(routeRequest(OFFICE_EMAIL, "PATCH", officePreferences));
  assert.equal(officeWrite.status, 200);
  assert.deepEqual((await officeWrite.json()).preferences, officePreferences);
  assert.equal(database.rows.size, 2);

  const [adminReadWithTargetQuery, officeRead] = await Promise.all([
    route.GET(routeRequest(ADMIN_EMAIL, "GET", undefined, `/api/v1/settings/me?userEmail=${encodeURIComponent(OFFICE_EMAIL)}`)),
    route.GET(routeRequest(OFFICE_EMAIL)),
  ]);
  const adminBody = await adminReadWithTargetQuery.json();
  assert.equal(adminReadWithTargetQuery.status, 200);
  assert.deepEqual(adminBody.preferences, adminPreferences);
  assert.equal(adminBody.isAdmin, true);

  const officeBody = await officeRead.json();
  assert.equal(officeBody.isAdmin, false);
  assert.deepEqual(officeBody.preferences, officePreferences);
  assert.deepEqual(database.queries.slice(-2).map(({ values }) => values[0]).sort(), [ADMIN_EMAIL, OFFICE_EMAIL].sort());
  assert.notEqual(database.rows.get(ADMIN_EMAIL).page_layouts_json, database.rows.get(OFFICE_EMAIL).page_layouts_json);
});

test("widens stale stored layouts and preserves them through unrelated partial updates", async () => {
  const savedLayouts = {
    overview: { order: ["scheduling", "stale-section", "metrics"], hidden: ["gmail-project-inbox", "stale-section"] },
  };
  const database = fakeDatabase({
    [OFFICE_EMAIL]: {
      display_timezone: "America/New_York",
      reply_signature: "Before",
      notification_preferences_json: JSON.stringify(notificationPreferences("lead.created")),
      page_layouts_json: JSON.stringify(savedLayouts),
      updated_at: 10,
    },
  });
  setEnvironment(database);

  const before = await route.GET(routeRequest(OFFICE_EMAIL));
  const beforeBody = await before.json();
  assert.deepEqual(beforeBody.preferences.pageLayouts.overview, {
    order: ["scheduling", "metrics", "lead-pipeline", "active-projects", "gmail-project-inbox"],
    hidden: ["gmail-project-inbox"],
  });
  assert.deepEqual(beforeBody.preferences.pageLayouts.reports, defaultPageLayouts(false).reports);

  const update = await route.PATCH(routeRequest(OFFICE_EMAIL, "PATCH", { replySignature: "After" }));
  assert.equal(update.status, 200);
  const updatedPreferences = (await update.json()).preferences;
  assert.equal(updatedPreferences.replySignature, "After");
  assert.deepEqual(updatedPreferences.pageLayouts, beforeBody.preferences.pageLayouts);
  assert.deepEqual(JSON.parse(database.rows.get(OFFICE_EMAIL).page_layouts_json).overview, beforeBody.preferences.pageLayouts.overview);
});

test("page-layout-only PATCH preserves every existing SET-28 preference", async () => {
  const notificationPreferences = {
    "lead.created": true,
    "gmail.filing_review_needed": false,
    "calendar.schedule_changed": true,
    "project.warranty_follow_up_due": false,
  };
  const database = fakeDatabase({
    [OFFICE_EMAIL]: {
      display_timezone: "America/Los_Angeles",
      reply_signature: "Keep this signature exactly.",
      notification_preferences_json: JSON.stringify(notificationPreferences),
      page_layouts_json: JSON.stringify(defaultPageLayouts(false)),
      updated_at: 10,
    },
  });
  setEnvironment(database);
  const nextLayouts = pageLayouts("scheduling", "gmail-project-inbox", "projects-by-status", "future-reports");

  const update = await route.PATCH(routeRequest(OFFICE_EMAIL, "PATCH", { pageLayouts: nextLayouts }));
  assert.equal(update.status, 200);
  const preferences = (await update.json()).preferences;
  assert.equal(preferences.displayTimezone, "America/Los_Angeles");
  assert.equal(preferences.replySignature, "Keep this signature exactly.");
  assert.deepEqual(preferences.notificationPreferences, notificationPreferences);
  assert.deepEqual(preferences.pageLayouts, nextLayouts);
  assert.equal(database.rows.get(OFFICE_EMAIL).display_timezone, "America/Los_Angeles");
  assert.equal(database.rows.get(OFFICE_EMAIL).reply_signature, "Keep this signature exactly.");
  assert.equal(database.rows.get(OFFICE_EMAIL).notification_preferences_json, JSON.stringify(notificationPreferences));
});

test("rejects target-identity injection, malformed preferences, cross-origin writes, and unauthenticated access before persistence", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const validPreferences = {
    displayTimezone: "America/New_York",
    replySignature: "Admin",
    notificationPreferences: notificationPreferences("gmail.filing_review_needed"),
  };

  const targetInjection = await route.PATCH(routeRequest(ADMIN_EMAIL, "PATCH", { ...validPreferences, userEmail: OFFICE_EMAIL }));
  assert.equal(targetInjection.status, 400);
  assert.equal(database.queries.length, 0);

  const incompleteCatalog = await route.PATCH(routeRequest(ADMIN_EMAIL, "PATCH", { notificationPreferences: { "lead.created": true } }));
  assert.equal(incompleteCatalog.status, 400);
  assert.equal(database.queries.filter(({ operation }) => operation === "run").length, 0);

  const unknownLayout = defaultPageLayouts(true);
  unknownLayout.overview.order = ["invented", ...unknownLayout.overview.order];
  const unknownSection = await route.PATCH(routeRequest(ADMIN_EMAIL, "PATCH", { pageLayouts: unknownLayout }));
  assert.equal(unknownSection.status, 400);
  assert.equal(database.queries.filter(({ operation }) => operation === "run").length, 0);

  const crossOrigin = await route.PATCH(routeRequest(ADMIN_EMAIL, "PATCH", validPreferences, "/api/v1/settings/me", "https://fci.example.test", "https://outside.example.test"));
  assert.equal(crossOrigin.status, 403);

  const unsigned = await route.GET(routeRequest(""));
  const outsider = await route.GET(routeRequest("outsider@example.test"));
  assert.equal(unsigned.status, 401);
  assert.equal(outsider.status, 403);
  assert.equal(database.queries.filter(({ operation }) => operation === "run").length, 0);
});
