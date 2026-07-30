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

function routeRequest(email = ADMIN_EMAIL) {
  const url = new URL("/api/v1/integrations/google/operations", APP_ORIGIN);
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
          const connectionKey = query.values[0];
          if (/FROM google_drive_operations/u.test(sql)) {
            const checkedAt = query.values[1];
            return {
              results: state.driveOperations
                .filter((row) => row.connection_key === connectionKey)
                .filter((row) => (
                  row.status === "failed"
                  || (
                    ["in-progress", "committing"].includes(row.status)
                    && row.lease_expires_at !== null
                    && row.lease_expires_at <= checkedAt
                  )
                ))
                .sort((left, right) => right.updated_at - left.updated_at),
            };
          }
          if (/FROM gmail_file_archives/u.test(sql)) {
            return {
              results: state.archives
                .filter((row) => row.connection_key === connectionKey && row.status === "failed")
                .sort((left, right) => right.updated_at - left.updated_at),
            };
          }
          if (/FROM google_integration_events/u.test(sql)) {
            return {
              results: state.events
                .filter((row) => row.connection_key === connectionKey)
                .sort((left, right) => right.created_at - left.created_at),
            };
          }
          throw new Error(`Unexpected operations query: ${sql}`);
        },
      };
      return statement;
    },
  };
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
    read("docs/google-workspace-rollout-guide.md"),
    read("docs/settings-guide.md"),
  ]);

  const authIndex = routeSource.indexOf("requireOfficeUser(request, { admin: true })");
  assert.ok(authIndex >= 0);
  assert.ok(authIndex < routeSource.indexOf("getGoogleRuntimeConfig()"));
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
  // The card renders in BOTH runtime modes, so unconditional simulation copy would tell a
  // live-connection admin that resetting simulation clears real Google history. The wording
  // came from SET-09's spec line, which assumed a simulation-only surface; WS-10's card is
  // not one. The component already gates its toolbar sentence on payload.simulation, so the
  // empty state must gate the same way.
  const card = await read("app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx");
  // Two styles.empty paragraphs exist — the failures one and the events one. Select the
  // events block by its own copy rather than by position, so a reorder cannot silently
  // point this assertion at the wrong paragraph.
  const emptyState = card
    .split(/<p className=\{styles\.empty\}>/u)
    .slice(1)
    .map((segment) => segment.slice(0, segment.indexOf("</p>")))
    .find((segment) => segment.includes("No integration event is recorded"));
  assert.ok(emptyState, "the empty integration-activity state must still exist");
  assert.match(
    emptyState,
    /payload\?\.simulation/u,
    "the empty integration-activity state must gate its copy on payload.simulation",
  );
  assert.doesNotMatch(
    card,
    /\{"No integration event is recorded for this connection\. Resetting simulation clears this history\."\}|>No integration event is recorded for this connection\. Resetting simulation clears this history\.</u,
    "simulation-reset copy must never render unconditionally",
  );
});
