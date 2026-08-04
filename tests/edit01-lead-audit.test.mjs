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
  FCI_OFFICE_EMAILS: "owner@example.test,office@example.test",
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

const [leadRoute, leadCollectionRoute, d1LeadModule, leadDomainModule] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/leads/[leadId]/route.ts"),
  vite.ssrLoadModule("/app/api/v1/leads/route.ts"),
  vite.ssrLoadModule("/app/adapters/d1/lead-repository.ts"),
  vite.ssrLoadModule("/app/domain/lead.ts"),
]);
const {
  LEAD_PATCH_KEYS,
  mergeLeadPatch,
  normalizeLeadPatch,
} = leadDomainModule;

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
        latitude REAL,
        longitude REAL,
        address_validation_verdict TEXT,
        estimated_value INTEGER NOT NULL,
        next_action TEXT NOT NULL,
        next_action_at INTEGER,
        owner_email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
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

  lead() {
    return this.database
      .prepare("SELECT site, stage, version FROM leads WHERE id = ?")
      .get("lead-edit-fixture");
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
  ["ownerEmail", "office@example.test", "Lead owner changed", "owner@example.test → office@example.test"],
  ["status", "converted", "Lead status changed", "active → converted"],
];

test("lead patch normalization is closed, field-specific, and preserves explicit null and zero", () => {
  assert.deepEqual([...LEAD_PATCH_KEYS], fieldCases.map(([field]) => field));
  assert.deepEqual(normalizeLeadPatch({ stage: " Proposal ", version: "7" }), {
    ok: true,
    value: { version: "7", stage: "Proposal" },
  });
  assert.deepEqual(normalizeLeadPatch({ version: "1" }), {
    ok: false,
    message: "Only supported lead fields can be updated.",
  });
  assert.deepEqual(normalizeLeadPatch({ stage: "Proposal", future: true }), {
    ok: false,
    message: "Only supported lead fields can be updated.",
  });
  assert.deepEqual(normalizeLeadPatch({ stage: "Proposal", version: "01" }), {
    ok: false,
    message: "Lead version must be a positive whole number.",
  });

  for (const [field, value, message] of [
    ["company", "", "Lead company must be 180 characters or fewer."],
    ["contactName", "", "Lead contact name must be 160 characters or fewer."],
    ["contactEmail", 42, "Lead contact email is invalid."],
    ["contactPhone", 42, "Lead contact phone must be 40 characters or fewer."],
    ["projectName", "", "Lead project name must be 180 characters or fewer."],
    ["source", "", "Lead source must be 80 characters or fewer."],
    ["stage", "", "Lead stage must be 80 characters or fewer."],
    ["site", "", "Lead site must be 300 characters or fewer."],
    ["estimatedValue", -1, "Lead estimated value must be a non-negative whole number."],
    ["nextAction", "", "Lead next action must be 500 characters or fewer."],
    ["nextActionAt", "not-a-time", "Lead next action due date is invalid."],
    ["ownerEmail", "not-an-email", "Lead owner email is invalid."],
    ["status", "future", "Lead status is invalid."],
  ]) {
    assert.deepEqual(normalizeLeadPatch({ [field]: value }), { ok: false, message }, field);
  }

  assert.deepEqual(normalizeLeadPatch({
    contactEmail: null,
    contactPhone: null,
    estimatedValue: 0,
    nextActionAt: null,
  }), {
    ok: true,
    value: {
      contactEmail: null,
      contactPhone: null,
      estimatedValue: 0,
      nextActionAt: null,
    },
  });

  const current = {
    company: "FCI TEST — DO NOT USE",
    contactName: "Test Contact",
    contactEmail: "contact@example.test",
    contactPhone: "555-0100",
    projectName: "Test Flooring",
    source: "Referral",
    stage: "Qualified",
    site: "Old site",
    estimatedValue: 125_000,
    nextAction: "Schedule site walk",
    nextActionAt: Date.UTC(2026, 6, 28, 14, 0, 0),
    ownerEmail: "owner@example.test",
    status: "active",
  };
  assert.deepEqual(mergeLeadPatch(current, {
    contactEmail: null,
    estimatedValue: 0,
    stage: "Proposal",
  }), {
    ...current,
    contactEmail: null,
    estimatedValue: 0,
    stage: "Proposal",
  });
});

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
      expectedVersion: "1",
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
      /SELECT \?, \?, \?, \?, \?, \? WHERE changes\(\) = 1 AND EXISTS \(SELECT 1 FROM leads WHERE id = \? AND version = \?\)/u,
    );
  } finally {
    database.close();
  }
});

test("D1 lead adapter rejects a second same-version update and audits only the winner", async () => {
  const database = new LeadD1Database();
  database.seedLead();
  try {
    const repository = d1LeadModule.createD1LeadRepository(database);
    const values = {
      company: "FCI TEST — DO NOT USE",
      contactName: "Test Contact",
      contactEmail: "contact@example.test",
      contactPhone: "555-0100",
      projectName: "Test Flooring",
      source: "Referral",
      stage: "Proposal",
      site: "Old site",
      estimatedValue: 125_000,
      nextAction: "Schedule site walk",
      nextActionAt: Date.UTC(2026, 6, 28, 14, 0, 0),
      ownerEmail: "owner@example.test",
      status: "active",
    };
    const first = await repository.update({
      leadId: "lead-edit-fixture",
      expectedVersion: "1",
      values,
      updatedAt: Date.UTC(2026, 6, 27, 13, 0, 0),
      updatedBy: "owner@example.test",
      activities: [{
        id: "lead-direct-first",
        recordId: "lead-edit-fixture",
        action: "Lead stage changed",
        actor: "owner@example.test",
        detail: "Qualified → Proposal",
        createdAt: Date.UTC(2026, 6, 27, 13, 0, 0),
      }],
    });
    assert.equal(first.outcome, "updated");
    assert.equal(first.value.version, "2");

    const stale = await repository.update({
      leadId: "lead-edit-fixture",
      expectedVersion: "1",
      values: { ...values, site: "Must not persist" },
      updatedAt: Date.UTC(2026, 6, 27, 13, 1, 0),
      updatedBy: "owner@example.test",
      activities: [{
        id: "lead-direct-stale",
        recordId: "lead-edit-fixture",
        action: "Lead site changed",
        actor: "owner@example.test",
        detail: "Old site → Must not persist",
        createdAt: Date.UTC(2026, 6, 27, 13, 1, 0),
      }],
    });
    assert.deepEqual(stale, { outcome: "conflict", currentVersion: "2" });
    assert.deepEqual({ ...database.lead() }, {
      site: "Old site",
      stage: "Proposal",
      version: 2,
    });
    assert.deepEqual(database.activities(), [{
      action: "Lead stage changed",
      actor: "owner@example.test",
      detail: "Qualified → Proposal",
    }]);
    const updateSql = database.preparedSql.find((sql) => /^UPDATE leads SET/u.test(sql));
    assert.match(updateSql, /WHERE id = \? AND version = \?$/u);
  } finally {
    database.close();
  }
});

test("lead PATCH returns the current version and no audit for a stale write", async () => {
  const database = new LeadD1Database();
  database.seedLead();
  cloudflareEnv.DB = database;
  try {
    const first = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({ stage: "Proposal", version: "1" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(first.status, 200);
    assert.equal((await first.json()).lead.version, "2");

    const stale = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({ site: "Must not persist", version: "1" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.headers.get("cache-control"), "no-store");
    assert.deepEqual(await stale.json(), {
      error: "Lead changed since it was loaded.",
      currentVersion: "2",
      currentValues: {
        site: "Old site",
      },
    });
    assert.deepEqual({ ...database.lead() }, {
      site: "Old site",
      stage: "Proposal",
      version: 2,
    });
    assert.equal(database.activities().length, 1);
  } finally {
    database.close();
  }
});

test("lead estimated-value authorization runs before conflicts while office users can edit descriptive fields", async () => {
  const database = new LeadD1Database();
  database.seedLead();
  cloudflareEnv.DB = database;
  try {
    const winner = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({ stage: "Proposal", version: "1" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(winner.status, 200);

    const forbidden = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "office@example.test",
        },
        body: JSON.stringify({ estimatedValue: 1, version: "1" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), {
      error: "An FCI administrator must update lead estimated value.",
    });
    assert.equal(database.activities().length, 1);
    assert.equal(database.lead().version, 2);

    const descriptive = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "office@example.test",
        },
        body: JSON.stringify({ site: "Office-safe edit", version: "2" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(descriptive.status, 200);
    assert.equal(database.lead().site, "Office-safe edit");
    assert.equal(database.activities().length, 2);
  } finally {
    database.close();
  }
});

test("admin conflicts disclose only attempted lead keys and preserve external contact email", async () => {
  const database = new LeadD1Database();
  database.seedLead();
  database.database.prepare(
    "UPDATE leads SET owner_email = ?, created_by = ? WHERE id = ?",
  ).run("offboarded@example.test", "former@example.test", "lead-edit-fixture");
  cloudflareEnv.DB = database;
  try {
    const winner = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({ stage: "Proposal", version: "1" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(winner.status, 200);
    const winnerBody = await winner.json();
    assert.equal(winnerBody.lead.ownerEmail, null);
    assert.equal(winnerBody.lead.createdBy, null);
    assert.equal(winnerBody.lead.contactEmail, "contact@example.test");

    const stale = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({
          ownerEmail: "owner@example.test",
          estimatedValue: 130_000,
          version: "1",
        }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), {
      error: "Lead changed since it was loaded.",
      currentVersion: "2",
      currentValues: {
        estimatedValue: 125_000,
        ownerEmail: null,
      },
    });
  } finally {
    database.close();
  }
});

test("lead collection responses disclose office identities but preserve external customer contact email", async () => {
  const database = new LeadD1Database();
  database.seedLead();
  cloudflareEnv.DB = database;
  try {
    const configured = await leadCollectionRoute.GET(
      new NextRequest("https://fci.example.test/api/v1/leads", {
        headers: {
          "oai-authenticated-user-email": "owner@example.test",
        },
      }),
    );
    assert.equal(configured.status, 200);
    const configuredLead = (await configured.json()).leads[0];
    assert.equal(configuredLead.contactEmail, "contact@example.test");
    assert.equal(configuredLead.ownerEmail, "owner@example.test");
    assert.equal(configuredLead.createdBy, "owner@example.test");

    database.database.prepare(
      "UPDATE leads SET owner_email = ?, created_by = ? WHERE id = ?",
    ).run("offboarded@example.test", "former@example.test", "lead-edit-fixture");
    const filtered = await leadCollectionRoute.GET(
      new NextRequest("https://fci.example.test/api/v1/leads", {
        headers: {
          "oai-authenticated-user-email": "owner@example.test",
        },
      }),
    );
    assert.equal(filtered.status, 200);
    const filteredLead = (await filtered.json()).leads[0];
    assert.equal(filteredLead.contactEmail, "contact@example.test");
    assert.equal(filteredLead.ownerEmail, null);
    assert.equal(filteredLead.createdBy, null);
  } finally {
    database.close();
  }
});

test("lead creation and editing reject an external owner without writing rows", async () => {
  const database = new LeadD1Database();
  database.seedLead();
  cloudflareEnv.DB = database;
  try {
    const invalidCreate = await leadCollectionRoute.POST(
      new NextRequest("https://fci.example.test/api/v1/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({
          company: "FCI TEST — DO NOT USE — owner validation",
          contactName: "Customer Contact",
          contactEmail: "customer@example.test",
          projectName: "Test project",
          source: "Referral",
          stage: "New inquiry",
          site: "Test site",
          estimatedValue: 1_000,
          nextAction: "Review",
          ownerEmail: "outside@example.test",
          status: "active",
        }),
      }),
    );
    assert.equal(invalidCreate.status, 400);
    assert.deepEqual(await invalidCreate.json(), {
      error: "Lead owner must be a current authorized office identity.",
    });
    assert.equal(
      database.database.prepare("SELECT COUNT(*) AS total FROM leads").get().total,
      1,
    );
    assert.deepEqual(database.activities(), []);

    const invalidEdit = await leadRoute.PATCH(
      new NextRequest("https://fci.example.test/api/v1/leads/lead-edit-fixture", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({
          ownerEmail: "outside@example.test",
          version: "1",
        }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(invalidEdit.status, 400);
    assert.deepEqual(await invalidEdit.json(), {
      error: "Lead owner must be a current authorized office identity.",
    });
    assert.equal(
      database.database.prepare("SELECT owner_email FROM leads WHERE id = ?")
        .get("lead-edit-fixture").owner_email,
      "owner@example.test",
    );
    assert.deepEqual(database.activities(), []);
  } finally {
    database.close();
  }
});

test("lead creation accepts configured and nullish-default owners with disclosure-safe versioned rows", async () => {
  const database = new LeadD1Database();
  cloudflareEnv.DB = database;
  try {
    const response = await leadCollectionRoute.POST(
      new NextRequest("https://fci.example.test/api/v1/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({
          company: "FCI TEST — DO NOT USE — configured owner",
          contactName: "Customer Contact",
          contactEmail: "customer@example.test",
          contactPhone: "555-0199",
          projectName: "Test project",
          source: "Referral",
          stage: "New inquiry",
          site: "Test site",
          estimatedValue: 1_000,
          nextAction: "Review",
          nextActionAt: "2026-07-30T13:00:37.500Z",
          ownerEmail: "office@example.test",
          status: "active",
        }),
      }),
    );
    assert.equal(response.status, 201);
    const createdLead = (await response.json()).lead;
    assert.equal(createdLead.contactEmail, "customer@example.test");
    assert.equal(createdLead.ownerEmail, "office@example.test");
    assert.equal(createdLead.createdBy, "owner@example.test");
    assert.equal(createdLead.version, "1");

    const nullOwnerResponse = await leadCollectionRoute.POST(
      new NextRequest("https://fci.example.test/api/v1/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://fci.example.test",
          "oai-authenticated-user-email": "owner@example.test",
        },
        body: JSON.stringify({
          company: "FCI TEST — DO NOT USE — null owner",
          contactName: "Customer Contact",
          projectName: "Second test project",
          source: "Referral",
          stage: "New inquiry",
          site: "Second test site",
          estimatedValue: 2_000,
          nextAction: "Review",
          ownerEmail: null,
          status: "active",
        }),
      }),
    );
    assert.equal(nullOwnerResponse.status, 201);
    const nullOwnerLead = (await nullOwnerResponse.json()).lead;
    assert.equal(nullOwnerLead.ownerEmail, "owner@example.test");
    assert.equal(nullOwnerLead.createdBy, "owner@example.test");
    assert.equal(nullOwnerLead.version, "1");
    assert.equal(
      database.database.prepare("SELECT COUNT(*) AS total FROM leads").get().total,
      2,
    );
    assert.deepEqual(
      database.activities().map(({ action, actor }) => ({ action, actor })),
      [
        { action: "Lead created", actor: "owner@example.test" },
        { action: "Lead created", actor: "owner@example.test" },
      ],
    );
  } finally {
    database.close();
  }
});

test("an update-time lead race re-reads one coherent latest row for conflict values", async () => {
  class RacingLeadD1Database extends LeadD1Database {
    raced = false;

    async batch(statements) {
      if (!this.raced) {
        this.raced = true;
        this.database.prepare(
          "UPDATE leads SET site = ?, version = version + 1 WHERE id = ?",
        ).run("Peer-saved site", "lead-edit-fixture");
      }
      return super.batch(statements);
    }
  }

  const database = new RacingLeadD1Database();
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
        body: JSON.stringify({ site: "My retained draft", version: "1" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Lead changed since it was loaded.",
      currentVersion: "2",
      currentValues: {
        site: "Peer-saved site",
      },
    });
    assert.deepEqual(database.activities(), []);
  } finally {
    database.close();
  }
});

test("a no-op lead PATCH echoes the same version and writes no audit row", async () => {
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
        body: JSON.stringify({ company: "FCI TEST — DO NOT USE", version: "1" }),
      }),
      { params: Promise.resolve({ leadId: "lead-edit-fixture" }) },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).lead.version, "1");
    assert.equal(database.lead().version, 1);
    assert.deepEqual(database.activities(), []);
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
