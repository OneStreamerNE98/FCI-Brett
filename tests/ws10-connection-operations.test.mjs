import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const APP_ORIGIN = "https://fci.example.test";
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, rootUrl), "utf8");
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-ws10-connection-operations", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false },
});

const route = await vite.ssrLoadModule("/app/api/v1/integrations/google/operations/route.ts");

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

beforeEach(() => {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  globalThis.fetch = async () => {
    throw new Error("The operations reader must never contact Google.");
  };
});

function routeRequest(email = ADMIN_EMAIL, search = "") {
  const url = new URL(`/api/v1/integrations/google/operations${search}`, APP_ORIGIN);
  const headers = new Headers();
  if (email) headers.set("oai-authenticated-user-email", email);
  const request = new Request(url, { method: "GET", headers });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function fakeDatabase() {
  const now = Date.now();
  const state = {
    queries: [],
    googleConnections: [],
    driveOperations: [
      {
        id: "drive-failed",
        connection_key: "workspace-simulation",
        operation_key: "project:failed",
        project_id: "project-1",
        status: "failed",
        lease_expires_at: null,
        last_error_code: "drive_write_failed",
        updated_at: now - 100,
      },
      {
        id: "drive-stuck",
        connection_key: "workspace-simulation",
        operation_key: "project:stuck",
        project_id: "project-2",
        status: "in-progress",
        lease_expires_at: now - 5_000,
        last_error_code: null,
        updated_at: now - 50,
      },
      {
        id: "drive-active",
        connection_key: "workspace-simulation",
        operation_key: "project:active",
        project_id: "project-3",
        status: "in-progress",
        lease_expires_at: now + 60_000,
        last_error_code: null,
        updated_at: now,
      },
      {
        id: "drive-other-connection",
        connection_key: "google-workspace",
        operation_key: "project:other",
        project_id: "project-4",
        status: "failed",
        lease_expires_at: null,
        last_error_code: "must_not_leak",
        updated_at: now + 1,
      },
    ],
    archives: [
      {
        id: "archive-failed",
        connection_key: "workspace-simulation",
        gmail_message_id: "gmail-message-1",
        project_id: "project-1",
        status: "failed",
        last_error_code: "gmail_copy_failed",
        updated_at: now - 25,
      },
      {
        id: "archive-filed",
        connection_key: "workspace-simulation",
        gmail_message_id: "gmail-message-2",
        project_id: "project-2",
        status: "filed",
        last_error_code: null,
        updated_at: now,
      },
      {
        id: "archive-other-connection",
        connection_key: "google-workspace",
        gmail_message_id: "gmail-message-3",
        project_id: "project-3",
        status: "failed",
        last_error_code: "must_not_leak",
        updated_at: now + 1,
      },
    ],
    events: [
      {
        id: "event-old",
        connection_key: "workspace-simulation",
        event_type: "gmail.archive_approved",
        actor: ADMIN_EMAIL,
        entity_type: "project",
        entity_id: "project-1",
        detail: "mode=simulation;inbox_retained=true",
        created_at: now - 200,
      },
      {
        id: "event-new",
        connection_key: "workspace-simulation",
        event_type: "gmail.archive_failed",
        actor: ADMIN_EMAIL,
        entity_type: "project",
        entity_id: "project-1",
        detail: "mode=simulation;code=gmail_copy_failed",
        created_at: now - 10,
      },
      {
        id: "event-other-connection",
        connection_key: "google-workspace",
        event_type: "must.not_leak",
        actor: "outside@example.com",
        entity_type: null,
        entity_id: null,
        detail: null,
        created_at: now + 1,
      },
    ],
  };

  function applyCursor(rows, timestampKey, idKey, cursorValues, valuesStartIndex) {
    if (cursorValues.length <= valuesStartIndex) return rows;
    const cursorTs = cursorValues[valuesStartIndex];
    const cursorId = cursorValues[valuesStartIndex + 2];
    return rows.filter((row) => (
      row[timestampKey] < cursorTs
      || (row[timestampKey] === cursorTs && row[idKey] < cursorId)
    ));
  }

  return {
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
          if (/FROM google_connections/u.test(sql)) {
            return { results: state.googleConnections };
          }
          const connectionKey = query.values[0];
          if (/FROM google_drive_operations/u.test(sql)) {
            const checkedAt = query.values[1];
            let results = state.driveOperations
              .filter((row) => row.connection_key === connectionKey)
              .filter((row) => (
                row.status === "failed"
                || (
                  ["in-progress", "committing"].includes(row.status)
                  && row.lease_expires_at !== null
                  && row.lease_expires_at <= checkedAt
                )
              ));
            if (query.values.length > 2) {
              results = applyCursor(results, "updated_at", "id", query.values.slice(2), 0);
            }
            return { results: results.sort((left, right) => right.updated_at - left.updated_at) };
          }
          if (/FROM gmail_file_archives/u.test(sql)) {
            let results = state.archives
              .filter((row) => row.connection_key === connectionKey && row.status === "failed");
            if (query.values.length > 1) {
              results = applyCursor(results, "updated_at", "id", query.values.slice(1), 0);
            }
            return { results: results.sort((left, right) => right.updated_at - left.updated_at) };
          }
          if (/FROM google_integration_events/u.test(sql)) {
            let results = state.events
              .filter((row) => row.connection_key === connectionKey);
            if (query.values.length > 1) {
              results = applyCursor(results, "created_at", "id", query.values.slice(1), 0);
            }
            return { results: results.sort((left, right) => right.created_at - left.created_at) };
          }
          throw new Error(`Unexpected operations query: ${sql}`);
        },
      };
      return statement;
    },
  };
}

function fakeDatabaseWithManyEvents(count) {
  const db = fakeDatabase();
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    db.state.events.push({
      id: `event-many-${i}`,
      connection_key: "workspace-simulation",
      event_type: "test.bulk_event",
      actor: ADMIN_EMAIL,
      entity_type: "project",
      entity_id: `project-bulk-${i}`,
      detail: `index=${i}`,
      created_at: now - 1000 - i,
    });
  }
  return db;
}

function simulationEnvironment(database) {
  Object.assign(workerEnvironment, {
    NODE_ENV: "development",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: database,
  });
}

function workspaceEnvironment(database) {
  Object.assign(workerEnvironment, {
    NODE_ENV: "development",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    DB: database,
  });
}

test("admin enumerates current-connection failures and activity in simulation without Google calls", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("The operations reader must stay database-only.");
  };

  const response = await route.GET(routeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.runtimeMode, "simulation");
  assert.equal(body.simulation, true);
  assert.equal(body.limits.perCategory, 50);
  assert.deepEqual(
    body.driveOperations.items.map(({ id, condition }) => ({ id, condition })),
    [
      { id: "drive-stuck", condition: "stuck" },
      { id: "drive-failed", condition: "failed" },
    ],
  );
  assert.deepEqual(body.failedArchives.items.map(({ id }) => id), ["archive-failed"]);
  assert.deepEqual(body.events.items.map(({ id }) => id), ["event-new", "event-old"]);
  assert.equal(JSON.stringify(body).includes("must_not_leak"), false);
  assert.equal(providerCalls, 0);
  assert.equal(database.state.queries.length, 3);
  assert.equal(database.state.queries.every(({ sql }) => /^\s*SELECT\b/u.test(sql)), true);
  assert.equal(database.state.queries.every(({ values }) => values[0] === "workspace-simulation"), true);
  // No nextCursor when hasMore is false
  assert.equal(body.driveOperations.nextCursor, undefined);
  assert.equal(body.failedArchives.nextCursor, undefined);
  assert.equal(body.events.nextCursor, undefined);
});

test("workspace operations aggregate Drive, archives, and events across stable and attached mailbox keys", async () => {
  const database = fakeDatabase();
  workspaceEnvironment(database);
  database.state.googleConnections = [
    {
      id: "connection-a",
      connection_key: "gmail_shared_a",
      google_subject: "subject-a",
      google_email: "shared-a@cherryhillfci.com",
      refresh_token_ciphertext: "encrypted-a",
      key_version: "v1",
      scopes_json: "[]",
      status: "connected",
    },
    {
      id: "connection-b",
      connection_key: "gmail_shared_b",
      google_subject: "subject-b",
      google_email: "shared-b@cherryhillfci.com",
      refresh_token_ciphertext: "encrypted-b",
      key_version: "v1",
      scopes_json: "[]",
      status: "connected",
    },
  ];
  const now = Date.now();
  database.state.driveOperations = [
    {
      id: "drive-stable",
      connection_key: "google-workspace",
      operation_key: "google-workspace:setup:drive-roots",
      project_id: "project-stable",
      status: "failed",
      lease_expires_at: null,
      last_error_code: "stable-drive-failure",
      updated_at: now - 40,
    },
    {
      id: "drive-mailbox-visible",
      connection_key: "gmail_shared_a",
      operation_key: "gmail_shared_a:file-gmail:message-a",
      project_id: "project-mailbox",
      status: "failed",
      lease_expires_at: null,
      last_error_code: "mailbox-drive-failure",
      updated_at: now,
    },
  ];
  database.state.archives = [
    {
      id: "archive-a",
      connection_key: "gmail_shared_a",
      gmail_message_id: "message-a",
      project_id: "project-a",
      status: "failed",
      last_error_code: "archive-a-failed",
      updated_at: now - 10,
    },
    {
      id: "archive-b",
      connection_key: "gmail_shared_b",
      gmail_message_id: "message-b",
      project_id: "project-b",
      status: "failed",
      last_error_code: "archive-b-failed",
      updated_at: now - 5,
    },
    {
      id: "archive-unknown",
      connection_key: "gmail_not_attached",
      gmail_message_id: "message-unknown",
      project_id: "project-unknown",
      status: "failed",
      last_error_code: "must-not-leak",
      updated_at: now,
    },
  ];
  database.state.events = [
    {
      id: "event-stable",
      connection_key: "google-workspace",
      event_type: "drive.workspace_verified",
      actor: ADMIN_EMAIL,
      entity_type: "workspace",
      entity_id: "stable",
      detail: "stable event",
      created_at: now - 30,
    },
    {
      id: "event-a",
      connection_key: "gmail_shared_a",
      event_type: "gmail.archive_failed",
      actor: ADMIN_EMAIL,
      entity_type: "message",
      entity_id: "message-a",
      detail: "mailbox a event",
      created_at: now - 20,
    },
    {
      id: "event-b",
      connection_key: "gmail_shared_b",
      event_type: "gmail.archive_failed",
      actor: ADMIN_EMAIL,
      entity_type: "connection",
      entity_id: "gmail_shared_b",
      detail: "mailbox gmail_shared_b event",
      created_at: now - 10,
    },
    {
      id: "event-unknown",
      connection_key: "gmail_not_attached",
      event_type: "must.not.leak",
      actor: ADMIN_EMAIL,
      entity_type: null,
      entity_id: null,
      detail: "must-not-leak",
      created_at: now,
    },
  ];
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("The operations reader must remain database-only.");
  };

  const response = await route.GET(routeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.runtimeMode, "workspace");
  assert.deepEqual(body.driveOperations.items.map(({ id }) => id), ["drive-mailbox-visible", "drive-stable"]);
  assert.deepEqual(body.failedArchives.items.map(({ id }) => id), ["archive-b", "archive-a"]);
  assert.deepEqual(body.events.items.map(({ id }) => id), ["event-b", "event-a", "event-stable"]);
  assert.equal(
    body.driveOperations.items.find(({ id }) => id === "drive-mailbox-visible").operationKey,
    "shared-a@cherryhillfci.com:file-gmail:message-a",
  );
  assert.equal(
    body.driveOperations.items.find(({ id }) => id === "drive-stable").operationKey,
    "workspace:setup:drive-roots",
  );
  assert.equal(
    body.events.items.find(({ id }) => id === "event-b").entityId,
    "shared-b@cherryhillfci.com",
  );
  assert.equal(
    body.events.items.find(({ id }) => id === "event-b").detail,
    "mailbox shared-b@cherryhillfci.com event",
  );
  assert.equal(JSON.stringify(body).includes("gmail_shared"), false);
  assert.equal(JSON.stringify(body).includes("google-workspace"), false);
  assert.equal(JSON.stringify(body).includes("must-not-leak"), false);
  assert.equal(providerCalls, 0);
  const driveQueries = database.state.queries.filter(({ sql }) =>
    /FROM google_drive_operations/u.test(sql)
  );
  assert.deepEqual(
    driveQueries.map(({ values }) => values[0]).sort(),
    ["gmail_shared_a", "gmail_shared_b", "google-workspace"],
  );
  assert.deepEqual(
    database.state.queries
      .filter(({ sql }) => /FROM gmail_file_archives/u.test(sql))
      .map(({ values }) => values[0])
      .sort(),
    ["gmail_shared_a", "gmail_shared_b", "google-workspace"],
  );
});

test("workspace Drive pagination preserves global order and hides unattached operation scopes", async () => {
  const database = fakeDatabase();
  workspaceEnvironment(database);
  database.state.googleConnections = [
    {
      id: "connection-a",
      connection_key: "gmail_shared_a",
      google_subject: "subject-a",
      google_email: "shared-a@cherryhillfci.com",
      refresh_token_ciphertext: "encrypted-a",
      key_version: "v1",
      scopes_json: "[]",
      status: "connected",
    },
    {
      id: "connection-b",
      connection_key: "gmail_shared_b",
      google_subject: "subject-b",
      google_email: "shared-b@cherryhillfci.com",
      refresh_token_ciphertext: "encrypted-b",
      key_version: "v1",
      scopes_json: "[]",
      status: "connected",
    },
  ];
  const now = Date.now();
  const visibleKeys = ["google-workspace", "gmail_shared_a", "gmail_shared_b"];
  database.state.driveOperations = Array.from({ length: 60 }, (_, index) => ({
    id: `drive-page-${String(index).padStart(2, "0")}`,
    connection_key: visibleKeys[index % visibleKeys.length],
    operation_key: `operation-${index}`,
    project_id: `project-${index}`,
    status: "failed",
    lease_expires_at: null,
    last_error_code: `failure-${index}`,
    updated_at: now - index,
  }));
  database.state.driveOperations.push({
    id: "drive-unattached",
    connection_key: "gmail_not_attached",
    operation_key: "operation-unattached",
    project_id: "project-unattached",
    status: "failed",
    lease_expires_at: null,
    last_error_code: "must-not-leak",
    updated_at: now + 1,
  });

  const first = await route.GET(routeRequest(ADMIN_EMAIL, "?category=drive"));
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.driveOperations.items.length, 50);
  assert.equal(firstBody.driveOperations.hasMore, true);
  assert.ok(firstBody.driveOperations.nextCursor);
  const second = await route.GET(routeRequest(
    ADMIN_EMAIL,
    `?category=drive&cursor=${encodeURIComponent(firstBody.driveOperations.nextCursor)}`,
  ));
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.driveOperations.items.length, 10);
  assert.equal(secondBody.driveOperations.hasMore, false);
  const all = [...firstBody.driveOperations.items, ...secondBody.driveOperations.items];
  assert.deepEqual(
    all.map(({ id }) => id),
    Array.from({ length: 60 }, (_, index) => `drive-page-${String(index).padStart(2, "0")}`),
  );
  assert.equal(new Set(all.map(({ id }) => id)).size, 60);
  assert.equal(JSON.stringify(all).includes("drive-unattached"), false);
  assert.equal(JSON.stringify(all).includes("gmail_shared"), false);
  assert.equal(JSON.stringify(all).includes("must-not-leak"), false);
});

test("opaque cursor paginates events past 50 items", async () => {
  const database = fakeDatabaseWithManyEvents(55);
  simulationEnvironment(database);

  // First page: no cursor
  const firstResponse = await route.GET(routeRequest());
  const firstBody = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(firstBody.events.items.length, 50);
  assert.equal(firstBody.events.hasMore, true);
  assert.ok(firstBody.events.nextCursor, "first page must return nextCursor");
  assert.ok(typeof firstBody.events.nextCursor === "string", "nextCursor must be a string");

  // Second page: with cursor
  const secondResponse = await route.GET(routeRequest(ADMIN_EMAIL, `?category=events&cursor=${encodeURIComponent(firstBody.events.nextCursor)}`));
  const secondBody = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(secondBody.events.items.length, 7);
  assert.equal(secondBody.events.hasMore, false);
  assert.equal(secondBody.events.hasMore, false);
  assert.equal(secondBody.events.nextCursor, undefined);

  // No overlap between pages
  const firstIds = new Set(firstBody.events.items.map((e) => e.id));
  const secondIds = new Set(secondBody.events.items.map((e) => e.id));
  for (const id of secondIds) {
    assert.equal(firstIds.has(id), false, `event ${id} must not appear on both pages`);
  }
});

test("category param limits which tables are queried", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);

  const response = await route.GET(routeRequest(ADMIN_EMAIL, "?category=events"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.driveOperations.items.length, 0);
  assert.equal(body.failedArchives.items.length, 0);
  assert.equal(body.events.items.length, 2);
  assert.equal(database.state.queries.length, 1);
  assert.match(database.state.queries[0].sql, /FROM google_integration_events/u);
});

test("unknown or malformed category param returns typed 400", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);

  const unknown = await route.GET(routeRequest(ADMIN_EMAIL, "?category=drive,unknown"));
  assert.equal(unknown.status, 400);
  const unknownBody = await unknown.json();
  assert.ok(unknownBody.error.includes("Invalid category"), "unknown category must name the error");

  const wrongCase = await route.GET(routeRequest(ADMIN_EMAIL, "?category=Events"));
  assert.equal(wrongCase.status, 400, "wrong case must be rejected");

  const commaOnly = await route.GET(routeRequest(ADMIN_EMAIL, "?category=,"));
  assert.equal(commaOnly.status, 400, "comma-only must be rejected");

  const valid = await route.GET(routeRequest(ADMIN_EMAIL, "?category=events"));
  assert.equal(valid.status, 200, "valid category must succeed");

  const absent = await route.GET(routeRequest(ADMIN_EMAIL, ""));
  assert.equal(absent.status, 200, "absent category must query all");
});

test("bad cursor returns typed 400 instead of silent page-1 read", async () => {
  const database = fakeDatabase();
  simulationEnvironment(database);

  const notBase64 = await route.GET(routeRequest(ADMIN_EMAIL, "?cursor=not-valid-base64!!!"));
  assert.equal(notBase64.status, 400, "non-base64 cursor must be rejected");

  const wrongShape = await route.GET(routeRequest(ADMIN_EMAIL, `?cursor=${btoa(JSON.stringify(["array"]))}`));
  assert.equal(wrongShape.status, 400, "array cursor must be rejected");

  const nonObject = await route.GET(routeRequest(ADMIN_EMAIL, `?cursor=${btoa("42")}`));
  assert.equal(nonObject.status, 400, "non-object cursor must be rejected");

  const truncated = await route.GET(routeRequest(ADMIN_EMAIL, `?cursor=${btoa(JSON.stringify({ d: [1] })).slice(0, -2)}`));
  assert.equal(truncated.status, 400, "truncated cursor must be rejected");

  const wellFormed = await route.GET(routeRequest(ADMIN_EMAIL, `?cursor=${btoa(JSON.stringify({ e: [Date.now(), "x"] }))}`));
  assert.equal(wellFormed.status, 200, "well-formed cursor must succeed");
});

test("office and unauthenticated callers are denied before every database query", async (t) => {
  await t.test("office user", async () => {
    const database = fakeDatabase();
    simulationEnvironment(database);
    const response = await route.GET(routeRequest(OFFICE_EMAIL));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(database.state.queries.length, 0);
  });

  await t.test("missing identity", async () => {
    const database = fakeDatabase();
    simulationEnvironment(database);
    const response = await route.GET(routeRequest(""));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(database.state.queries.length, 0);
  });
});

test("source pins the authorization order, SELECT-only route, Settings surface, and operator copy", async () => {
  const [routeSource, panelSource, cardSource, rolloutGuide, settingsGuide] = await Promise.all([
    read("app/api/v1/integrations/google/operations/route.ts"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx"),
    read("docs/guides/google-workspace-rollout-guide.md"),
    read("docs/guides/settings-guide.md"),
  ]);

  const authIndex = routeSource.indexOf("requireOfficeUser(request, { admin: true })");
  assert.ok(authIndex >= 0);
  assert.ok(authIndex < routeSource.indexOf("getConnectionScope()"));
  assert.ok(authIndex < routeSource.indexOf("env.DB.prepare("));
  assert.doesNotMatch(routeSource, /ensureWorkspaceSchema/u);
  assert.doesNotMatch(routeSource, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/u);
  assert.match(routeSource, /LIMIT \$\{QUERY_LIMIT\}/u);
  assert.match(panelSource, /label="Operations health"[\s\S]*<WorkspaceOperationsHealthCard isAdmin=\{isAdmin\}/u);
  assert.match(cardSource, /\/api\/v1\/integrations\/google\/operations/u);
  assert.match(cardSource, /if \(!isAdmin\) return;/u);
  assert.match(cardSource, /Simulation only — these are locally recorded test operations and no Google call is made\./u);
  assert.match(cardSource, /hasStuckDriveLease = driveOperations\.some\(\(operation\) => operation\.condition === "stuck"\)/u);
  assert.match(cardSource, /\{hasStuckDriveLease && <p[\s\S]*<strong>Stuck lease:/u);
  assert.match(rolloutGuide, /deleted[\s\S]*FCI\/Intake[\s\S]*labels\/prepare[\s\S]*idempotent/iu);
  assert.match(rolloutGuide, /stuck lease[\s\S]*five minutes[\s\S]*never hand-edit Drive/iu);
  assert.match(rolloutGuide, /failed archive[\s\S]*re-POST[\s\S]*fciArchiveId/iu);
  assert.match(rolloutGuide, /FCI\/Intake[\s\S]*FCI\/Needs Review[\s\S]*accumulate[\s\S]*no automated cleanup/iu);
  assert.match(settingsGuide, /Operations health[\s\S]*stuck Drive leases[\s\S]*failed Gmail archives[\s\S]*recent integration\s+activity/u);
});

test("the empty integration-activity state does not promise simulation reset in workspace mode", async () => {
  const card = await read("app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx");
  const emptyState = card
    .split(/<p className=\{styles\.empty\}>/u)
    .slice(1)
    .map((segment) => segment.slice(0, segment.indexOf("</p>")))
    .find((segment) => segment.includes("No integration event is recorded"));
  assert.ok(emptyState, "the empty integration-activity state must still exist");
  assert.match(
    emptyState,
    /\{simulation\s*\r?\n?\s*\?/u,
    "the empty integration-activity state must gate its copy on simulation mode",
  );
  assert.doesNotMatch(
    card,
    /\{"No integration event is recorded for this connection\. Resetting simulation clears this history\."\}|>No integration event is recorded for this connection\. Resetting simulation clears this history\.</u,
    "simulation-reset copy must never render unconditionally",
  );
});

test("card source contains per-category load-more buttons gated on hasMore", async () => {
  const card = await read("app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx");
  assert.match(card, /Load more events/u, "card must offer Load more for events");
  assert.match(card, /moreEvents/u, "card must track events hasMore state");
  assert.match(card, /nextCursor/u, "card must read nextCursor from response");
  assert.match(card, /new URLSearchParams\(\{ category \}\)/u, "card must pass category param dynamically");
});

test("card source surfaces per-category paging errors with retry affordance", async () => {
  const card = await read("app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx");
  assert.match(card, /drive\.error/u, "card must expose drive paging error");
  assert.match(card, /archive\.error/u, "card must expose archive paging error");
  assert.match(card, /events\.error/u, "card must expose events paging error");
  assert.match(card, /retryCategory\("drive", drive\.nextCursor, drive\.retryMode\)/u, "card must retry drive through its recorded failure mode");
  assert.match(card, /retryCategory\("archive", archive\.nextCursor, archive\.retryMode\)/u, "card must retry archive through its recorded failure mode");
  assert.match(card, /retryCategory\("events", events\.nextCursor, events\.retryMode\)/u, "card must retry events through its recorded failure mode");
});

test("card source fences per-category reads through the operations request coordinator", async () => {
  const card = await read("app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx");
  assert.match(card, /beginCategory\(category, url\)/u, "card must gate duplicate in-flight requests by category");
  assert.match(card, /isCurrentCategory\(ticket\)/u, "card must fence stale category responses");
  assert.match(card, /settleCategory\(ticket, appended\)/u, "card must deregister only the matching request ticket");
  assert.doesNotMatch(card, /requestSequence\.current/u, "card must not use a shared sequence counter");
});
