import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-blueprint-routes", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24741 } },
});

const [blueprintRoute, resetRoute, blueprintModule] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/integrations/google/setup/blueprint/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/simulation/reset/route.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
]);

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function routeRequest(path, email, method = "GET", body, extraHeaders = {}) {
  const url = new URL(path, "https://fci.example.test");
  const request = new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: url.origin }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "oai-authenticated-user-email": email,
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function fakeDatabase(initialRow = null, { failEvent = false } = {}) {
  const queries = [];
  const events = [];
  const batches = [];
  let row = initialRow ? structuredClone(initialRow) : null;
  let lastChanges = 0;
  const database = {
    queries,
    events,
    batches,
    get row() { return row; },
    prepare(sql) {
      const query = { sql, values: [], kind: "prepared" };
      queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async first() {
          query.kind = "first";
          if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) {
            return row?.connection_key === query.values[0] ? structuredClone(row) : null;
          }
          if (/FROM workspace_simulation_state/u.test(sql)) return null;
          return null;
        },
        async run() {
          query.kind = "run";
          if (/^INSERT INTO workspace_blueprints/u.test(sql)) {
            const expectedVersion = query.values[11];
            if ((!row && expectedVersion !== 0) || (row && row.version !== expectedVersion)) {
              lastChanges = 0;
              return { meta: { changes: 0 } };
            }
            row = row ? {
              ...row,
              version: query.values[2],
              blueprint_json: query.values[3],
              updated_by: query.values[6],
              updated_at: query.values[7],
            } : {
              id: query.values[0],
              connection_key: query.values[1],
              version: query.values[2],
              blueprint_json: query.values[3],
              created_by: query.values[4],
              created_at: query.values[5],
              updated_by: query.values[6],
              updated_at: query.values[7],
            };
            lastChanges = 1;
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO google_integration_events/u.test(sql)) {
            if (failEvent) throw new Error("Simulated integration-event insert failure.");
            const matchesSavedBlueprint = row
              && row.connection_key === query.values[8]
              && row.version === query.values[9]
              && row.updated_by === query.values[10]
              && row.updated_at === query.values[11]
              && row.blueprint_json === query.values[12];
            if (lastChanges !== 1 || !matchesSavedBlueprint) {
              lastChanges = 0;
              return { meta: { changes: 0 } };
            }
            events.push({
              id: query.values[0],
              connectionKey: query.values[1],
              eventType: query.values[2],
              actor: query.values[3],
              entityType: query.values[4],
              entityId: query.values[5],
              detail: query.values[6],
              createdAt: query.values[7],
            });
            lastChanges = 1;
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM workspace_blueprints/u.test(sql) && row?.connection_key === query.values[0]) row = null;
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements);
      const previousRow = row ? structuredClone(row) : null;
      const previousEventCount = events.length;
      const previousChanges = lastChanges;
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      } catch (error) {
        row = previousRow;
        events.splice(previousEventCount);
        lastChanges = previousChanges;
        throw error;
      }
    },
  };
  return database;
}

function workspaceEnvironment(database, overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "development",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: database,
    ...overrides,
  });
}

function persistedRow(blueprint, version = 1) {
  return {
    id: "blueprint-1",
    connection_key: "workspace-simulation",
    version,
    blueprint_json: JSON.stringify(blueprint),
    created_by: ADMIN_EMAIL,
    created_at: 1_790_000_000_000,
    updated_by: ADMIN_EMAIL,
    updated_at: 1_790_000_000_000,
  };
}

test("blueprint GET is admin-only, no-store, seeded at version zero, and makes no Google call", async () => {
  const database = fakeDatabase();
  workspaceEnvironment(database);
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Blueprint reads must not call Google.");
  };

  const response = await blueprintRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.version, 0);
  assert.equal(body.seeded, true);
  assert.equal(body.blueprint.calendars.at(-1).name, "FCI Holidays");
  assert.equal(providerCalls, 0);
  assert.equal(database.queries.some((query) => /^INSERT INTO workspace_blueprints/u.test(query.sql)), false);

  const deniedDatabase = {
    prepare() { throw new Error("Denied Office GET must not touch D1."); },
  };
  workspaceEnvironment(deniedDatabase);
  const denied = await blueprintRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    OFFICE_EMAIL,
  ));
  assert.equal(denied.status, 403);
});

test("blueprint PUT saves version one, emits only a bounded change summary, and GET reflects it", async () => {
  const database = fakeDatabase();
  workspaceEnvironment(database);
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.drive.roots[0].name = "00_Administration";
  blueprint.templates.push({ key: "site-walk", name: "Site Walk", kind: "doc", targetFolderKey: "templates", management: "owner" });

  const response = await blueprintRoute.PUT(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
    "PUT",
    { blueprint, expectedVersion: 0 },
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.version, 1);
  assert.equal(body.seeded, false);
  assert.equal(body.blueprint.drive.roots[0].name, "00_Administration");
  assert.equal(database.events.length, 1);
  assert.equal(database.events[0].eventType, "setup.blueprint_updated");
  assert.equal(database.events[0].entityType, "workspace-blueprint");
  assert.equal(database.events[0].entityId, "workspace-simulation");
  assert.match(database.events[0].detail, /^version=1;folders=/u);
  assert.equal(database.events[0].detail.includes("Administration"), false);
  assert.equal(database.batches.length, 1);
  assert.equal(database.batches[0].length, 2);

  const getResponse = await blueprintRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
  ));
  const getBody = await getResponse.json();
  assert.equal(getBody.version, 1);
  assert.equal(getBody.seeded, false);
  assert.equal(getBody.blueprint.templates.at(-1).key, "site-walk");
});

test("blueprint PUT rolls back the version when its audit event cannot be recorded", async () => {
  const database = fakeDatabase(null, { failEvent: true });
  workspaceEnvironment(database);

  await assert.rejects(
    blueprintRoute.PUT(routeRequest(
      "/api/v1/integrations/google/setup/blueprint",
      ADMIN_EMAIL,
      "PUT",
      { blueprint: blueprintModule.seedWorkspaceBlueprint(), expectedVersion: 0 },
    )),
    /Simulated integration-event insert failure/u,
  );
  assert.equal(database.row, null);
  assert.equal(database.events.length, 0);
  assert.equal(database.batches.length, 1);
});

test("blueprint PUT rejects stale or impossible expected versions without overwriting", async () => {
  const seed = blueprintModule.seedWorkspaceBlueprint();
  const database = fakeDatabase(persistedRow(seed, 1));
  workspaceEnvironment(database);
  const staleDraft = structuredClone(seed);
  staleDraft.business.displayName = "Stale editor value";

  const response = await blueprintRoute.PUT(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
    "PUT",
    { blueprint: staleDraft, expectedVersion: 0 },
  ));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "workspace_blueprint_version_conflict");
  assert.equal(body.currentVersion, 1);
  assert.equal(JSON.parse(database.row.blueprint_json).business.displayName, seed.business.displayName);
  assert.equal(database.events.length, 0);

  const emptyDatabase = fakeDatabase();
  workspaceEnvironment(emptyDatabase);
  const impossible = await blueprintRoute.PUT(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
    "PUT",
    { blueprint: seed, expectedVersion: 7 },
  ));
  assert.equal(impossible.status, 409);
  assert.equal((await impossible.json()).currentVersion, 0);
  assert.equal(emptyDatabase.row, null);
});

test("blueprint PUT returns exact sanitizer paths and rejects oversized or cross-origin bodies", async () => {
  const database = fakeDatabase();
  workspaceEnvironment(database);
  const lockedMutation = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  lockedMutation.drive.projectFolders.find((folder) => folder.key === "correspondence").name = "Mail";

  const invalid = await blueprintRoute.PUT(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
    "PUT",
    { blueprint: lockedMutation, expectedVersion: 0 },
  ));
  const invalidBody = await invalid.json();
  assert.equal(invalid.status, 400);
  assert.equal(invalidBody.path, "blueprint.drive.projectFolders[correspondence].name");
  assert.match(invalidBody.error, /system-managed/u);

  const oversized = await blueprintRoute.PUT(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
    "PUT",
    JSON.stringify({ blueprint: "x".repeat(70_000), expectedVersion: 0 }),
  ));
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "The Workspace blueprint request is too large." });

  const crossOrigin = await blueprintRoute.PUT(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
    "PUT",
    { blueprint: blueprintModule.seedWorkspaceBlueprint(), expectedVersion: 0 },
    { origin: "https://attacker.example" },
  ));
  assert.equal(crossOrigin.status, 403);
  assert.equal(database.queries.some((query) => /^INSERT INTO workspace_blueprints/u.test(query.sql)), false);
});

test("simulation reset deletes only its blueprint row so the next GET returns the seed", async () => {
  const customized = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  customized.business.displayName = "FCI TEST — CUSTOM BLUEPRINT";
  const database = fakeDatabase(persistedRow(customized, 3));
  workspaceEnvironment(database);

  const response = await resetRoute.POST(routeRequest(
    "/api/v1/integrations/google/simulation/reset",
    ADMIN_EMAIL,
    "POST",
  ));
  assert.equal(response.status, 200);
  const blueprintDeletes = database.queries.filter((query) => /^DELETE FROM workspace_blueprints/u.test(query.sql));
  assert.equal(blueprintDeletes.length, 1);
  assert.deepEqual(blueprintDeletes[0].values, ["workspace-simulation"]);
  assert.match(blueprintDeletes[0].sql, /WHERE connection_key = \?/u);

  const getResponse = await blueprintRoute.GET(routeRequest(
    "/api/v1/integrations/google/setup/blueprint",
    ADMIN_EMAIL,
  ));
  const body = await getResponse.json();
  assert.equal(body.version, 0);
  assert.equal(body.seeded, true);
  assert.equal(body.blueprint.business.displayName, blueprintModule.seedWorkspaceBlueprint().business.displayName);
});
