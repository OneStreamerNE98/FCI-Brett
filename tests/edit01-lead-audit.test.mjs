import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { NextRequest } from "next/server.js";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path) => readFile(new URL(path, root), "utf8");
const cloudflareEnv = {
  DB: null,
  FCI_OFFICE_EMAILS: "owner@example.test",
  FCI_OFFICE_DOMAINS: "",
  FCI_ADMIN_EMAILS: "owner@example.test",
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = cloudflareEnv;

const vite = await createServer({
  root: rootPath,
  cacheDir: "work/vite-tests/edit01-lead-audit",
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
  server: { middlewareMode: true, hmr: { port: 24780 } },
});

const [leadRoute, d1LeadModule] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/leads/[leadId]/route.ts"),
  vite.ssrLoadModule("/app/adapters/d1/lead-repository.ts"),
]);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

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

class LeadD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.preparedSql = [];
    this.database.exec(`
      CREATE TABLE leads (
        id TEXT PRIMARY KEY,
        lead_number TEXT NOT NULL,
        company TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        project_name TEXT NOT NULL,
        source TEXT NOT NULL,
        stage TEXT NOT NULL,
        site TEXT NOT NULL,
        estimated_value INTEGER NOT NULL,
        next_action TEXT NOT NULL,
        next_action_at INTEGER,
        owner_email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
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

  seedLead() {
    this.database.prepare(`
      INSERT INTO leads (
        id, lead_number, company, contact_name, contact_email, contact_phone,
        project_name, source, stage, site, estimated_value, next_action,
        next_action_at, owner_email, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "lead-edit-fixture",
      "L-2026-EDIT0001",
      "FCI TEST — DO NOT USE",
      "Test Contact",
      "contact@example.test",
      "555-0100",
      "Test Flooring",
      "Referral",
      "Qualified",
      "Old site",
      125_000,
      "Schedule site walk",
      Date.UTC(2026, 6, 28, 14, 0, 0),
      "owner@example.test",
      "active",
      "owner@example.test",
      Date.UTC(2026, 6, 27, 12, 0, 0),
      Date.UTC(2026, 6, 27, 12, 0, 0),
    );
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

const fieldCases = [
  ["company", "FCI TEST — DO NOT USE UPDATED", "Lead company changed", "FCI TEST — DO NOT USE → FCI TEST — DO NOT USE UPDATED"],
  ["contactName", "Updated Contact", "Lead contact name changed", "Test Contact → Updated Contact"],
  ["contactEmail", null, "Lead contact email changed", "contact@example.test → Not set"],
  ["contactPhone", null, "Lead contact phone changed", "555-0100 → Not set"],
  ["projectName", "Updated Flooring", "Lead project name changed", "Test Flooring → Updated Flooring"],
  ["source", "Website", "Lead source changed", "Referral → Website"],
  ["stage", "Proposal", "Lead stage changed", "Qualified → Proposal"],
  ["site", "Updated site", "Lead site changed", "Old site → Updated site"],
  ["estimatedValue", 130_000, "Lead estimated value changed", "125000 → 130000"],
  ["nextAction", "Send proposal", "Lead next action changed", "Schedule site walk → Send proposal"],
  [
    "nextActionAt",
    null,
    "Lead next action due date changed",
    "2026-07-28T14:00:00.000Z → Not set",
  ],
  ["ownerEmail", "new-owner@example.test", "Lead owner changed", "owner@example.test → new-owner@example.test"],
  ["status", "converted", "Lead status changed", "active → converted"],
];

test("lead PATCH writes one before-to-after audit row for every mutable field", async () => {
  assert.equal(fieldCases.length, 13);
  for (const [field, value, action, detail] of fieldCases) {
    const database = new LeadD1Database();
    database.seedLead();
    cloudflareEnv.DB = database;
    try {
      const response = await leadRoute.PATCH(
        new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            origin: "https://fci.example.test",
            "oai-authenticated-user-email": "owner@example.test",
          },
          body: JSON.stringify({ [field]: value }),
        }),
        { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
      );

      assert.equal(response.status, 200, `${field} PATCH should succeed`);
      assert.deepEqual(database.activities(), [{
        action,
        actor: "owner@example.test",
        detail,
      }], `${field} should write exactly one field-specific audit row`);
    } finally {
      database.close();
    }
  }
});

test("one PATCH changing all 13 fields writes 13 distinct audit rows", async () => {
  const database = new LeadD1Database();
  database.seedLead();
  cloudflareEnv.DB = database;
  try {
    const response = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify(Object.fromEntries(
          fieldCases.map(([field, value]) => [field, value]),
        )),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(
      database.activities(),
      fieldCases.map(([, , action, detail]) => ({
        action,
        actor: "owner@example.test",
        detail,
      })),
    );
  } finally {
    database.close();
  }
});

test("D1 failed lead update cannot leave an audit row", async () => {
  const database = new LeadD1Database();
  try {
    const repository = d1LeadModule.createD1LeadRepository(database);
    const result = await repository.update({
      leadId: "missing-lead",
      values: {
        company: "FCI TEST — DO NOT USE",
        contactName: "Test Contact",
        contactEmail: null,
        contactPhone: null,
        projectName: "Test Flooring",
        source: "Referral",
        stage: "Proposal",
        site: "Old site",
        estimatedValue: 125_000,
        nextAction: "Send proposal",
        nextActionAt: null,
        ownerEmail: "owner@example.test",
        status: "active",
      },
      updatedAt: Date.UTC(2026, 6, 27, 13, 0, 0),
      updatedBy: "owner@example.test",
      activities: [{
        id: "audit-that-must-not-exist",
        recordId: "missing-lead",
        action: "Lead stage changed",
        actor: "owner@example.test",
        detail: "Qualified → Proposal",
        createdAt: Date.UTC(2026, 6, 27, 13, 0, 0),
      }],
    });

    assert.deepEqual(result, { outcome: "lead-not-found" });
    assert.deepEqual(database.activities(), []);
    const guardedInsert = database.preparedSql.find((sql) =>
      /^INSERT INTO activity_events/u.test(sql)
    );
    assert.match(
      guardedInsert,
      /SELECT \?, \?, \?, \?, \?, \? WHERE EXISTS \(SELECT 1 FROM leads WHERE id = \? AND updated_at = \?\)/u,
    );
  } finally {
    database.close();
  }
});

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await routeFiles(path));
    else if (entry.name === "route.ts") files.push(path);
  }
  return files;
}

test("development API authorization gap is documented and the lead PATCH stays free of decorative capability checks", async () => {
  const [leadItemRoute, authorizationDoc, files] = await Promise.all([
    read("app/api/v1/leads/[leadId]/route.ts"),
    read("docs/authorization-simulation.md"),
    routeFiles(join(rootPath, "app", "api", "v1")),
  ]);
  assert.doesNotMatch(leadItemRoute, /\bcreationAuthorizationFor\s*\(/u);

  const selfGrantedCalls = [];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(
      /creationAuthorizationFor\(\{[\s\S]*?capabilities:\s*\[([A-Z_]+\.[A-Za-z]+)\][\s\S]*?\}\)/gu,
    )) {
      selfGrantedCalls.push(match[1]);
    }
  }
  assert.deepEqual(selfGrantedCalls.toSorted(), [
    "AUTHORIZATION_CAPABILITIES.leadsCreate",
    "AUTHORIZATION_CAPABILITIES.meetingsUpdate",
    "AUTHORIZATION_CAPABILITIES.recordsRead",
    "AUTHORIZATION_CAPABILITIES.recordsRead",
    "AUTHORIZATION_CAPABILITIES.recordsRead",
    "AUTHORIZATION_CAPABILITIES.tasksUpdate",
    "AUTHORIZATION_CAPABILITIES.tasksUpdate",
    "CREATION_CAPABILITIES.createClient",
    "CREATION_CAPABILITIES.createProject",
  ]);

  const gapSection = authorizationDoc.slice(
    authorizationDoc.indexOf("## Development API authorization gap"),
    authorizationDoc.indexOf("## Implemented source controls"),
  );
  assert.match(gapSection, /Six distinct capabilities are self-granted at nine route call\s+sites/u);
  assert.match(gapSection, /`leads\.update`[\s\S]*zero API call sites/u);
  assert.match(gapSection, /`isAdmin`[\s\S]*only working per-operation authorization\s+primitive/u);
  assert.match(gapSection, /source-only Cloud Run employee\s+router/u);
});
