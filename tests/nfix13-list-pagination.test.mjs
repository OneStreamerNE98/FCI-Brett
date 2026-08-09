/**
 * NFIX-13 — Paginate the clients and projects list endpoints.
 *
 * Proves:
 * 1. First page returns ≤ page-size items + an opaque nextCursor
 * 2. Following the cursor chain returns the full dataset exactly once
 * 3. Limit validation (rejects <1, >500)
 * 4. Invalid cursor → 400
 * 5. Projects clientId filter works with pagination
 * 6. Response envelope is backward-compatible (clients / projects keys preserved)
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createServer } from "vite";

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
const CLIENT_COUNT = 250;
const PROJECT_COUNT = 250;
const CLIENT_A_ID = "client-filter-a";
const CONNECTION_KEY = "google-workspace";
const ADMIN_EMAIL = "admin@fci.example.test";

function makeClient(index) {
  const padded = String(index).padStart(4, "0");
  return {
    id: `client-${padded}`,
    client_code: `FC${padded}`,
    name: `FCI TEST Client ${padded}`,
    status: index % 5 === 0 ? "inactive" : "active",
    industry: index % 3 === 0 ? "Commercial" : "Residential",
    site_address: `${100 + index} Test St`,
    latitude: null,
    longitude: null,
    address_validation_verdict: null,
    created_by: ADMIN_EMAIL,
    created_at: 1700000000000 + index * 1000,
    updated_at: 1700000000000 + index * 2000,
    version: "1",
  };
}

function makeProject(index, clientId) {
  const padded = String(index).padStart(4, "0");
  const cid = clientId ?? `client-${String(index % 50).padStart(4, "0")}`;
  return {
    id: `project-${padded}`,
    project_number: `FC-P${padded}`,
    client_id: cid,
    name: `FCI TEST Project ${padded}`,
    status: index % 3 === 0 ? "completed" : "active",
    site: `${200 + index} Project Ave`,
    latitude: null,
    longitude: null,
    address_validation_verdict: null,
    project_manager: ADMIN_EMAIL,
    estimated_value: 10000 + index * 500,
    flooring_category: index % 2 === 0 ? "hardwood" : "tile",
    square_feet: 1000 + index * 10,
    contract_value: 8000 + index * 400,
    segment: index % 3 === 0 ? "commercial" : "residential",
    installation_started_at: null,
    installation_completed_at: null,
    had_callback: 0,
    callback_note: null,
    created_by: ADMIN_EMAIL,
    created_at: 1700000000000 + index * 1000,
    updated_at: 1700000000000 + index * 2000,
    version: "1",
  };
}

// Build seed arrays and pre-sort for mock filtering
const allClients = Array.from({ length: CLIENT_COUNT }, (_, i) => makeClient(i));
const allProjects = Array.from({ length: PROJECT_COUNT }, (_, i) => makeProject(i));

// Extra records for filtered tests
allClients.push({
  id: CLIENT_A_ID,
  client_code: "FC-FILT",
  name: "FCI TEST Client Filter A",
  status: "active",
  industry: "Commercial",
  site_address: "999 Filter Ln",
  latitude: null,
  longitude: null,
  address_validation_verdict: null,
  created_by: ADMIN_EMAIL,
  created_at: 1700099999000,
  updated_at: 1700099999000,
  version: "1",
});
allProjects.push(makeProject(999, CLIENT_A_ID));
allProjects.push(makeProject(998, CLIENT_A_ID));
allProjects.push(makeProject(997, CLIENT_A_ID));

// ---------------------------------------------------------------------------
// Sort helpers (mirror SQL ORDER BY)
// ---------------------------------------------------------------------------
const clientsSorted = [...allClients].sort((a, b) => {
  const n = (a.name ?? "").localeCompare(b.name ?? "");
  return n !== 0 ? n : (a.id ?? "").localeCompare(b.id ?? "");
});

const projectsSorted = [...allProjects].sort((a, b) => {
  const t = (b.updated_at ?? 0) - (a.updated_at ?? 0);
  return t !== 0 ? t : (b.id ?? "").localeCompare(a.id ?? "");
});

function clientsAfter(list, cursorName, cursorId) {
  if (cursorName === null && cursorId === null) return list;
  const idx = list.findIndex((c) => c.name === cursorName && c.id === cursorId);
  return idx >= 0 ? list.slice(idx + 1) : [];
}

function projectsAfter(list, cursorTs, cursorId) {
  if (cursorTs === null && cursorId === null) return list;
  const idx = list.findIndex((p) => p.updated_at === cursorTs && p.id === cursorId);
  return idx >= 0 ? list.slice(idx + 1) : [];
}

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------
const WORKSPACE_RESOURCES = [
  {
    id: "wr-cal",
    connection_key: CONNECTION_KEY,
    resource_type: "google_calendar",
    resource_key: "primary",
    external_id: "primary-cal@example.test",
  },
];
const WORKSPACE_BLUEPRINT = {
  id: "bp-001",
  connection_key: CONNECTION_KEY,
  blueprint_json: JSON.stringify({ calendarId: "primary-cal@example.test" }),
};
const WORKSPACE_SETTINGS = {
  id: "ws-001",
  settings_json: JSON.stringify({ simulation: true, tenantDomain: "example.test" }),
};

const dbQueries = []; // for inspecting bind values in tests

const database = {
  prepare(sql) {
    const entry = { sql, values: [], kind: "prepared" };
    dbQueries.push(entry);
    const statement = {
      bind(...values) {
        entry.values = values;
        return statement;
      },
      async all() {
        entry.kind = "all";

        // Workspace provisioning queries
        if (/workspace_resources/.test(sql)) return { results: WORKSPACE_RESOURCES };
        if (/workspace_blueprints/.test(sql)) return { results: [WORKSPACE_BLUEPRINT] };
        if (/workspace_settings/.test(sql)) return { results: [WORKSPACE_SETTINGS] };
        if (/google_connections/.test(sql)) return { results: [] };

        // Clients list: [connectionKey, cursorName, cursorId, queryLimit]
        if (/FROM clients c/.test(sql)) {
          const cursorName = entry.values[1] ?? null;
          const cursorId = entry.values[2] ?? null;
          const queryLimit = entry.values[3];
          const after = clientsAfter(clientsSorted, cursorName, cursorId);
          return { results: after.slice(0, queryLimit) };
        }

        // Projects list:
        //   Without clientId: [connectionKey, cursorTs, cursorId, queryLimit]
        //   With clientId:    [connectionKey, clientId, cursorTs, cursorId, queryLimit]
        if (/FROM projects p/.test(sql)) {
          const hasClientId = entry.values.length === 5;
          const clientId = hasClientId ? entry.values[1] : null;
          const cursorTs = hasClientId ? entry.values[2] ?? null : entry.values[1] ?? null;
          const cursorId = hasClientId ? entry.values[3] ?? null : entry.values[2] ?? null;
          const queryLimit = hasClientId ? entry.values[4] : entry.values[3];
          const filtered = clientId
            ? projectsSorted.filter((p) => p.client_id === clientId)
            : projectsSorted;
          const after = projectsAfter(filtered, cursorTs, cursorId);
          return { results: after.slice(0, queryLimit) };
        }

        return { results: [] };
      },
      async first() {
        entry.kind = "first";
        if (/workspace_settings/.test(sql)) return WORKSPACE_SETTINGS;
        if (/workspace_blueprints/.test(sql)) return WORKSPACE_BLUEPRINT;
        if (/google_connections/.test(sql)) return null;
        if (/workspace_resources/.test(sql)) return null;
        return null;
      },
      async run() {
        entry.kind = "run";
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  },
  async batch(statements) {
    return Promise.all(statements.map((s) => s.run()));
  },
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "test";

const workerEnvironment = {
  FCI_OFFICE_EMAILS: ADMIN_EMAIL,
  FCI_ADMIN_EMAILS: ADMIN_EMAIL,
  DB: database,
};
let vite;
let clientsRoute;
let projectsRoute;

before(async () => {
  globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

  const rootUrl = new URL("../", import.meta.url);
  vite = await createServer({
    root: fileURLToPath(rootUrl),
    cacheDir: "work/vite-tests/nfix13-list-pagination",
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    resolve: {
      alias: {
        "cloudflare:workers": fileURLToPath(
          new URL("fixtures/cloudflare-workers.mjs", import.meta.url),
        ),
      },
    },
    server: { middlewareMode: true, hmr: false },
  });

  [clientsRoute, projectsRoute] = await Promise.all([
    vite.ssrLoadModule("/app/api/v1/clients/route.ts"),
    vite.ssrLoadModule("/app/api/v1/projects/route.ts"),
  ]);
});

after(async () => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  if (vite) await vite.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function officeRequest(path) {
  const url = new URL(path, "https://fci.example.test");
  const request = new Request(url, {
    headers: { "oai-authenticated-user-email": ADMIN_EMAIL },
  });
  // Next.js NextRequest compatibility: handlers access request.nextUrl.searchParams
  Object.defineProperty(request, "nextUrl", { value: url, writable: false });
  return request;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test("GET /api/v1/clients returns first page with clients array and nextCursor", async () => {
  const response = await clientsRoute.GET(officeRequest("/api/v1/clients?limit=50"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.clients));
  assert.equal(body.clients.length, 50);
  assert.ok(typeof body.nextCursor === "string" && body.nextCursor.length > 0);

  // Verify sort: name ASC, id ASC
  for (let i = 1; i < body.clients.length; i++) {
    const prev = body.clients[i - 1];
    const curr = body.clients[i];
    const nameCmp = (prev.name ?? "").localeCompare(curr.name ?? "");
    assert.ok(
      nameCmp < 0 || (nameCmp === 0 && (prev.id ?? "").localeCompare(curr.id ?? "") <= 0),
      `row ${i} out of order`,
    );
  }
});

test("GET /api/v1/clients cursor chain returns all clients exactly once", async () => {
  const seen = new Set();
  let cursor = null;
  let pageCount = 0;
  do {
    const url = cursor
      ? `/api/v1/clients?limit=37&cursor=${encodeURIComponent(cursor)}`
      : "/api/v1/clients?limit=37";
    const response = await clientsRoute.GET(officeRequest(url));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.clients));
    assert.ok(body.clients.length > 0);
    assert.ok(body.clients.length <= 37);
    for (const client of body.clients) {
      assert.equal(seen.has(client.id), false, `duplicate client ${client.id}`);
      seen.add(client.id);
    }
    cursor = body.nextCursor;
    pageCount += 1;
  } while (cursor);
  assert.equal(seen.size, allClients.length);
  assert.ok(pageCount > 2);
});

test("GET /api/v1/clients returns null nextCursor when all rows fit in one page", async () => {
  const response = await clientsRoute.GET(
    officeRequest(`/api/v1/clients?limit=${CLIENT_COUNT + 50}`),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clients.length, allClients.length);
  assert.equal(body.nextCursor, null);
});

test("GET /api/v1/clients invalid cursor returns 400", async () => {
  const response = await clientsRoute.GET(
    officeRequest("/api/v1/clients?cursor=not-a-valid-cursor"),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "Invalid cursor.");
});

test("GET /api/v1/clients defaults to limit=100 when no limit given", async () => {
  const response = await clientsRoute.GET(officeRequest("/api/v1/clients"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clients.length, 100);
  assert.ok(typeof body.nextCursor === "string");
});

test("GET /api/v1/clients rejects limit=0", async () => {
  const response = await clientsRoute.GET(officeRequest("/api/v1/clients?limit=0"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.error.includes("Limit"));
});

test("GET /api/v1/clients rejects limit=501", async () => {
  const response = await clientsRoute.GET(officeRequest("/api/v1/clients?limit=501"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.error.includes("Limit"));
});

test("GET /api/v1/clients accepts limit=500", async () => {
  const response = await clientsRoute.GET(officeRequest("/api/v1/clients?limit=500"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.clients.length, allClients.length);
  assert.equal(body.nextCursor, null);
});

test("GET /api/v1/clients cursor past last row returns empty page", async () => {
  const last = clientsSorted[clientsSorted.length - 1];
  // Construct a cursor for a name that sorts after everything
  const pastEnd = Buffer.from(
    JSON.stringify({ name: `${last.name}￿`, id: last.id }),
    "utf8",
  ).toString("base64url");
  const response = await clientsRoute.GET(
    officeRequest(`/api/v1/clients?cursor=${encodeURIComponent(pastEnd)}`),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.clients, []);
  assert.equal(body.nextCursor, null);
});

// --- Projects ---

test("GET /api/v1/projects returns first page with projects array and nextCursor", async () => {
  const response = await projectsRoute.GET(officeRequest("/api/v1/projects?limit=50"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.projects));
  assert.equal(body.projects.length, 50);
  assert.ok(typeof body.nextCursor === "string" && body.nextCursor.length > 0);
});

test("GET /api/v1/projects cursor chain returns all projects exactly once", async () => {
  const seen = new Set();
  let cursor = null;
  let pageCount = 0;
  do {
    const url = cursor
      ? `/api/v1/projects?limit=43&cursor=${encodeURIComponent(cursor)}`
      : "/api/v1/projects?limit=43";
    const response = await projectsRoute.GET(officeRequest(url));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.projects));
    assert.ok(body.projects.length > 0);
    assert.ok(body.projects.length <= 43);
    for (const project of body.projects) {
      assert.equal(seen.has(project.id), false, `duplicate project ${project.id}`);
      seen.add(project.id);
    }
    cursor = body.nextCursor;
    pageCount += 1;
  } while (cursor);
  assert.equal(seen.size, allProjects.length);
  assert.ok(pageCount > 2);
});

test("GET /api/v1/projects returns null nextCursor when all fit in one page", async () => {
  const response = await projectsRoute.GET(
    officeRequest(`/api/v1/projects?limit=${PROJECT_COUNT + 50}`),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.projects.length, allProjects.length);
  assert.equal(body.nextCursor, null);
});

test("GET /api/v1/projects invalid cursor returns 400", async () => {
  const response = await projectsRoute.GET(
    officeRequest("/api/v1/projects?cursor=bad-cursor"),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "Invalid cursor.");
});

test("GET /api/v1/projects filters by clientId with pagination", async () => {
  const page1 = await projectsRoute.GET(
    officeRequest(`/api/v1/projects?clientId=${CLIENT_A_ID}&limit=2`),
  );
  assert.equal(page1.status, 200);
  const body1 = await page1.json();
  assert.ok(Array.isArray(body1.projects));
  assert.equal(body1.projects.length, 2);
  assert.ok(body1.projects.every((p) => p.client_id === CLIENT_A_ID));
  assert.ok(typeof body1.nextCursor === "string");

  const page2 = await projectsRoute.GET(
    officeRequest(
      `/api/v1/projects?clientId=${CLIENT_A_ID}&limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
    ),
  );
  assert.equal(page2.status, 200);
  const body2 = await page2.json();
  assert.equal(body2.projects.length, 1);
  assert.equal(body2.projects[0].client_id, CLIENT_A_ID);
  assert.equal(body2.nextCursor, null);
});

test("GET /api/v1/projects defaults to limit=100 when no limit given", async () => {
  const response = await projectsRoute.GET(officeRequest("/api/v1/projects"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.projects.length, 100);
  assert.ok(typeof body.nextCursor === "string");
});

test("GET /api/v1/projects rejects limit=0", async () => {
  const response = await projectsRoute.GET(officeRequest("/api/v1/projects?limit=0"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.error.includes("Limit"));
});

test("GET /api/v1/projects rejects limit=501", async () => {
  const response = await projectsRoute.GET(officeRequest("/api/v1/projects?limit=501"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.error.includes("Limit"));
});

// --- Opaque cursor ---

test("client cursor is opaque base64url JSON", async () => {
  const response = await clientsRoute.GET(officeRequest("/api/v1/clients?limit=5"));
  const body = await response.json();
  const raw = Buffer.from(body.nextCursor, "base64url").toString("utf8");
  const decoded = JSON.parse(raw);
  assert.equal(typeof decoded.name, "string");
  assert.equal(typeof decoded.id, "string");
});

test("project cursor is opaque base64url JSON", async () => {
  const response = await projectsRoute.GET(officeRequest("/api/v1/projects?limit=5"));
  const body = await response.json();
  const raw = Buffer.from(body.nextCursor, "base64url").toString("utf8");
  const decoded = JSON.parse(raw);
  assert.equal(typeof decoded.updatedAt, "number");
  assert.equal(typeof decoded.id, "string");
});
