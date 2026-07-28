import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { NextRequest } from "next/server.js";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const cloudflareEnv = {
  DB: null,
  FCI_OFFICE_EMAILS: "admin@example.test,office@example.test",
  FCI_OFFICE_DOMAINS: "",
  FCI_ADMIN_EMAILS: "admin@example.test",
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = cloudflareEnv;

const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/edit05-project-editing",
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
  server: { middlewareMode: true, hmr: { port: 24805 } },
});

const [projectRoute, projectPatchModule] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/projects/[projectId]/route.ts"),
  vite.ssrLoadModule("/app/domain/project-patch.ts"),
]);
const {
  PROJECT_ADMIN_EDIT_KEYS,
  PROJECT_PATCH_KEYS,
  normalizeProjectPatch,
} = projectPatchModule;

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

const PROJECT_ID = "project-edit-fixture";
const CLIENT_ID = "client-edit-fixture";
const OTHER_CLIENT_ID = "client-edit-other";
const UPDATED_AT = Date.UTC(2026, 6, 27, 16, 0, 0);

class SqliteD1Statement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class ProjectD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.preparedSql = [];
    this.database.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        project_number TEXT NOT NULL,
        client_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        site TEXT,
        project_manager TEXT,
        estimated_value INTEGER,
        flooring_category TEXT,
        square_feet INTEGER,
        contract_value INTEGER,
        segment TEXT,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.database.prepare("INSERT INTO clients (id, name) VALUES (?, ?), (?, ?)").run(
      CLIENT_ID,
      "FCI TEST — DO NOT USE client",
      OTHER_CLIENT_ID,
      "FCI TEST — DO NOT USE other client",
    );
    this.database.prepare(`
      INSERT INTO projects (
        id, project_number, client_id, name, status, site, project_manager,
        estimated_value, flooring_category, square_feet, contract_value,
        segment, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      PROJECT_ID,
      "CF-2026-EDIT0001",
      CLIENT_ID,
      "FCI TEST — DO NOT USE project",
      "planning",
      "Old project site",
      "manager@example.test",
      125_000,
      "tile-stone",
      2_500,
      130_000,
      "commercial",
      UPDATED_AT,
    );
  }

  prepare(sql) {
    this.preparedSql.push(sql);
    return new SqliteD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    const results = [];
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  project() {
    return {
      ...this.database.prepare(`
        SELECT client_id, name, status, site, estimated_value, flooring_category,
               square_feet, contract_value, segment, version
        FROM projects WHERE id = ?
      `).get(PROJECT_ID),
    };
  }

  activities() {
    return this.database
      .prepare("SELECT action, actor, detail FROM activity_events ORDER BY rowid")
      .all()
      .map((row) => ({ ...row }));
  }

  close() {
    this.database.close();
  }
}

function patchRequest(database, body, email = "admin@example.test") {
  cloudflareEnv.DB = database;
  return projectRoute.PATCH(
    new NextRequest(`https://fci.example.test/api/v1/projects/${PROJECT_ID}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://fci.example.test",
        "oai-authenticated-user-email": email,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId: PROJECT_ID }) },
  );
}

test("project patch normalization is closed, version-fenced, and validates all nine fields", () => {
  assert.deepEqual([...PROJECT_PATCH_KEYS], [
    "name",
    "status",
    "site",
    "clientId",
    "estimatedValue",
    "flooringCategory",
    "squareFeet",
    "contractValue",
    "segment",
  ]);
  assert.deepEqual([...PROJECT_ADMIN_EDIT_KEYS], [
    "status",
    "estimatedValue",
    "contractValue",
  ]);
  assert.deepEqual(normalizeProjectPatch({ name: " Updated ", version: "7" }), {
    ok: true,
    value: { version: "7", name: "Updated" },
  });
  assert.deepEqual(normalizeProjectPatch({ version: "1" }), {
    ok: false,
    message: "Only supported project fields can be updated.",
  });
  assert.deepEqual(normalizeProjectPatch({ name: "Updated" }), {
    ok: false,
    message: "Project version must be a positive whole number.",
  });
  assert.deepEqual(normalizeProjectPatch({ name: "Updated", version: "1", future: true }), {
    ok: false,
    message: "Only supported project fields can be updated.",
  });

  for (const [field, value, message] of [
    ["name", "", "Project name must be 180 characters or fewer."],
    ["status", "future", "Project status is invalid."],
    ["site", 42, "Project site is invalid."],
    ["clientId", "bad client", "Project client is invalid."],
    ["estimatedValue", -1, "Project estimated value must be a non-negative whole number."],
    ["flooringCategory", "future", "Project flooring category is invalid."],
    ["squareFeet", 0, "Project square feet must be a positive whole number."],
    ["contractValue", -1, "Project contract value must be a non-negative whole number."],
    ["segment", "future", "Project segment is invalid."],
  ]) {
    assert.deepEqual(
      normalizeProjectPatch({ [field]: value, version: "1" }),
      { ok: false, message },
      field,
    );
  }
});

const fieldCases = [
  [
    "name",
    "FCI TEST — DO NOT USE updated project",
    "name",
    "FCI TEST — DO NOT USE updated project",
    "Name: FCI TEST — DO NOT USE project → FCI TEST — DO NOT USE updated project",
  ],
  ["status", "installation", "status", "installation", "Status: planning → installation"],
  ["site", null, "site", null, "Site: Old project site → Not set"],
  [
    "clientId",
    OTHER_CLIENT_ID,
    "client_id",
    OTHER_CLIENT_ID,
    `Client: ${CLIENT_ID} → ${OTHER_CLIENT_ID}`,
  ],
  [
    "estimatedValue",
    0,
    "estimated_value",
    0,
    "Estimated value: 125000 → 0",
  ],
  [
    "flooringCategory",
    "carpet",
    "flooring_category",
    "carpet",
    "Flooring category: tile-stone → carpet",
  ],
  ["squareFeet", 3_000, "square_feet", 3_000, "Square feet: 2500 → 3000"],
  [
    "contractValue",
    0,
    "contract_value",
    0,
    "Contract value: Set → Updated",
  ],
  ["segment", "residential", "segment", "residential", "Segment: commercial → residential"],
];

test("admin project PATCH persists each editable field and writes exactly one before-to-after audit", async () => {
  assert.equal(fieldCases.length, 9);
  for (const [field, value, column, expected, expectedDetail] of fieldCases) {
    const database = new ProjectD1Database();
    try {
      const response = await patchRequest(database, { [field]: value, version: "1" });
      assert.equal(response.status, 200, field);
      assert.equal(response.headers.get("cache-control"), "no-store", field);
      assert.equal(database.project()[column], expected, field);
      assert.equal(database.project().version, 2, field);
      assert.equal(database.activities().length, 1, field);
      assert.equal(database.activities()[0].action, "Project fields updated", field);
      assert.equal(database.activities()[0].detail, expectedDetail, field);
      if (field === "contractValue") {
        assert.doesNotMatch(database.activities()[0].detail, /130000|130,000/u);
      }
      const body = await response.json();
      assert.equal(body.project.version, "2", field);
    } finally {
      database.close();
    }
  }
});

test("one multi-field project edit writes one audit row and admin can move planning to installation to completed", async () => {
  const database = new ProjectD1Database();
  try {
    const installation = await patchRequest(database, {
      name: "FCI TEST — DO NOT USE installation project",
      status: "installation",
      site: "Installation site",
      clientId: OTHER_CLIENT_ID,
      estimatedValue: 150_000,
      flooringCategory: "hardwood",
      squareFeet: 4_000,
      contractValue: 155_000,
      segment: "residential",
      version: "1",
    });
    assert.equal(installation.status, 200);
    assert.equal(database.project().status, "installation");
    assert.equal(database.activities().length, 1);
    assert.equal(database.activities()[0].detail.split("; ").length, 9);

    const completed = await patchRequest(database, { status: "completed", version: "2" });
    assert.equal(completed.status, 200);
    assert.equal(database.project().status, "completed");
    assert.equal(database.project().version, 3);
    assert.equal(database.activities().length, 2);
  } finally {
    database.close();
  }
});

test("Office users can edit descriptive project fields but protected fields fail closed and stay redacted", async () => {
  for (const key of PROJECT_ADMIN_EDIT_KEYS) {
    const database = new ProjectD1Database();
    try {
      const value = key === "status" ? "installation" : 1;
      const response = await patchRequest(
        database,
        { [key]: value, version: "1" },
        "office@example.test",
      );
      assert.equal(response.status, 403, key);
      assert.equal(response.headers.get("cache-control"), "no-store", key);
      assert.equal(database.project().version, 1, key);
      assert.deepEqual(database.activities(), [], key);
    } finally {
      database.close();
    }
  }

  const database = new ProjectD1Database();
  try {
    const response = await patchRequest(
      database,
      { name: "Office-safe project name", version: "1" },
      "office@example.test",
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.project.name, "Office-safe project name");
    assert.equal(body.project.contractValue, null);
    assert.equal(database.project().contract_value, 130_000);
  } finally {
    database.close();
  }
});

test("stale project PATCH returns currentVersion and performs no write or audit", async () => {
  const database = new ProjectD1Database();
  try {
    const first = await patchRequest(database, { name: "First editor wins", version: "1" });
    assert.equal(first.status, 200);
    const stale = await patchRequest(database, { site: "Must not persist", version: "1" });
    assert.equal(stale.status, 409);
    assert.equal(stale.headers.get("cache-control"), "no-store");
    assert.deepEqual(await stale.json(), {
      error: "Project changed since it was loaded.",
      currentVersion: "2",
    });
    assert.equal(database.project().site, "Old project site");
    assert.equal(database.project().version, 2);
    assert.equal(database.activities().length, 1);
  } finally {
    database.close();
  }
});

test("project PATCH auth and origin failures are no-store", async () => {
  const database = new ProjectD1Database();
  cloudflareEnv.DB = database;
  try {
    const missingAuth = await projectRoute.PATCH(
      new NextRequest(`https://fci.example.test/api/v1/projects/${PROJECT_ID}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
        },
        body: JSON.stringify({ name: "No", version: "1" }),
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );
    assert.equal(missingAuth.status, 401);
    assert.equal(missingAuth.headers.get("cache-control"), "no-store");

    const crossOrigin = await projectRoute.PATCH(
      new NextRequest(`https://fci.example.test/api/v1/projects/${PROJECT_ID}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.test",
          "oai-authenticated-user-email": "admin@example.test",
        },
        body: JSON.stringify({ name: "No", version: "1" }),
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get("cache-control"), "no-store");
    assert.equal(database.project().version, 1);
  } finally {
    database.close();
  }
});

test("project edit source keeps legacy operations isolated and reloads D1 creation before editing", async () => {
  const [app, collectionRoute, itemRoute, operations, creation, recordOperation] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/api/v1/projects/route.ts"),
    read("app/api/v1/projects/[projectId]/route.ts"),
    read("app/domain/project-operations.ts"),
    read("app/application/create-project.ts"),
    read("app/application/record-project-operation.ts"),
  ]);
  const addProject = app.slice(
    app.indexOf("async function addProject"),
    app.indexOf("async function saveProjectEdits"),
  );
  assert.ok(
    addProject.indexOf("await refreshDirectoryData();")
      < addProject.indexOf("setProjectModal(false);"),
    "D1 creation must refresh the collection GET before the versioned edit surface can open",
  );
  assert.match(app, /version: normalizeRecordVersion\(project\.version\) \?\? undefined/u);
  assert.match(app, /Re-apply changes/u);
  assert.match(app, /throw new ProjectEditConflictError/u);
  assert.doesNotMatch(app, /planned-project-updates|Project updates planned/u);
  assert.doesNotMatch(itemRoute, /\bcreationAuthorizationFor\b/u);
  assert.match(itemRoute, /noStoreResponse\(originError\)/u);
  assert.match(itemRoute, /noStoreResponse\(auth\.response\)/u);

  assert.match(creation, /action: "Project manager assigned"/u);
  assert.match(operations, /"record-installation-dates"/u);
  assert.match(operations, /"record-follow-up-result"/u);
  assert.match(recordOperation, /action: "Installation dates recorded"/u);
  assert.match(recordOperation, /action: "Follow-up result recorded"/u);
  assert.doesNotMatch(collectionRoute, /updateProject\s*\(/u);
});
