import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const APP_ORIGIN = "https://fci.example.test";
const CONNECTION_KEY = "workspace-simulation";
const SHEET_ID = "workspace-simulation-lead-form-sheet";
const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, rootUrl), "utf8");
const originalFetch = globalThis.fetch;
const originalNodeEnvironment = process.env.NODE_ENV;
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;
process.env.NODE_ENV = "test";

const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-gi01-google-form-lead-intake", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24798 } },
});

const [domain, firstRunDomain, adapter, config, route] = await Promise.all([
  vite.ssrLoadModule("/app/domain/google-form-lead-intake.ts"),
  vite.ssrLoadModule("/app/domain/first-run-import.ts"),
  vite.ssrLoadModule("/app/adapters/d1/google-form-lead-intake-repository.ts"),
  vite.ssrLoadModule("/app/lib/google-form-lead-intake-config.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/forms/leads/route.ts"),
]);

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
    throw new Error("GI-01 simulation must not call Google.");
  };
});

class SqliteD1Statement {
  constructor(statement, owner, sql) {
    this.statement = statement;
    this.owner = owner;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    this.owner.reads.push({ sql: this.sql, values: [...this.values] });
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    this.owner.reads.push({ sql: this.sql, values: [...this.values] });
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    this.owner.writes.push({ sql: this.sql, values: [...this.values] });
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class Gi01Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.reads = [];
    this.writes = [];
    this.batchTail = Promise.resolve();
    this.database.exec(`
      CREATE TABLE workspace_resources (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL, external_id TEXT NOT NULL, parent_external_id TEXT,
        external_url TEXT, origin TEXT NOT NULL, metadata_json TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_blueprints (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL UNIQUE, version INTEGER NOT NULL,
        blueprint_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY, shared_drive_id TEXT, client_directory_sheet_id TEXT,
        intake_mailbox TEXT, settings_json TEXT, updated_by TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE clients (
        id TEXT PRIMARY KEY, client_code TEXT NOT NULL, name TEXT NOT NULL, industry TEXT
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL, email TEXT, phone TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, site TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY, record_id TEXT NOT NULL, action TEXT NOT NULL,
        actor TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE leads (
        id TEXT PRIMARY KEY, created_by TEXT NOT NULL
      );
      CREATE TABLE google_form_lead_intake_watermarks (
        connection_key TEXT NOT NULL, spreadsheet_id TEXT NOT NULL,
        last_processed_row INTEGER NOT NULL, last_processed_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE (connection_key, spreadsheet_id)
      );
      CREATE TABLE google_form_lead_reviews (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, spreadsheet_id TEXT NOT NULL,
        source_row INTEGER NOT NULL, submitted_at TEXT, state TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'needs-review', proposal_json TEXT NOT NULL,
        reasons_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        reviewed_by TEXT, reviewed_at INTEGER, accepted_lead_id TEXT,
        UNIQUE (connection_key, spreadsheet_id, source_row)
      );
    `);
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql), this, sql);
  }

  async batch(statements) {
    const operation = this.batchTail.then(async () => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.database.exec("COMMIT");
        return results;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    });
    this.batchTail = operation.catch(() => undefined);
    return operation;
  }

  insertLead(id, actor = ADMIN_EMAIL) {
    this.database.prepare("INSERT INTO leads (id, created_by) VALUES (?, ?)").run(id, actor);
  }

  count(table) {
    return Number(this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  }

  row(sql, ...values) {
    return this.database.prepare(sql).get(...values) ?? null;
  }

  resetCounters() {
    this.reads.length = 0;
    this.writes.length = 0;
  }

  close() {
    this.database.close();
  }
}

function environment(database) {
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: database,
  });
}

function request(method, body, email = ADMIN_EMAIL, origin = APP_ORIGIN) {
  const url = new URL("/api/v1/integrations/google/forms/leads", APP_ORIGIN);
  const headers = new Headers();
  if (email) headers.set("oai-authenticated-user-email", email);
  if (method !== "GET") {
    headers.set("origin", origin);
    headers.set("content-type", "application/json");
  }
  const result = new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(result, "nextUrl", { value: url });
  return result;
}

function storedClient(overrides = {}) {
  return {
    id: "client-existing",
    clientCode: "CL-0001",
    sourceClientCodes: [],
    name: "FCI TEST — DO NOT USE — Existing account",
    industry: "Commercial",
    emails: ["match@example.test"],
    phones: ["856-555-0199"],
    addresses: ["25 Existing Way, Cherry Hill, NJ"],
    addressDigests: [],
    ...overrides,
  };
}

function draft(id, sourceRow) {
  return {
    id,
    sourceRow,
    submittedAt: "2026-07-31T13:00:00Z",
    state: "ready",
    proposal: {
      company: `FCI TEST — DO NOT USE — Row ${sourceRow}`,
      contactName: `FCI TEST — DO NOT USE — Row ${sourceRow}`,
      contactEmail: `row-${sourceRow}@example.test`,
      contactPhone: null,
      projectName: "Office flooring inquiry",
      source: "Google Form",
      stage: "New inquiry",
      site: `${sourceRow} Test Way`,
      estimatedValue: null,
      nextAction: "Confirm the preferred contact method and schedule a site visit.",
      nextActionAt: null,
      rooms: "Office",
      flooringType: "LVT",
      preferredContact: `row-${sourceRow}@example.test`,
    },
    reasons: [],
  };
}

test("GI-01 config exposes presence only and simulation needs no hosted Sheet value", () => {
  assert.deepEqual(config.googleFormLeadIntakeConfig({}, true), {
    configured: true,
    invalid: false,
    spreadsheetId: SHEET_ID,
    source: "simulation",
  });
  assert.deepEqual(config.googleFormLeadIntakeConfig({}, false), {
    configured: false,
    invalid: false,
    spreadsheetId: null,
    source: "none",
  });
  assert.equal(config.googleFormLeadIntakeConfig({
    GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID: "linkedResponseSheet_12345",
  }, false).configured, true);
  assert.deepEqual(config.googleFormLeadIntakeConfig({
    GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID: "not a provider id",
  }, false), {
    configured: false,
    invalid: true,
    spreadsheetId: null,
    source: "none",
  });
});

test("GI-01 mapping is bounded, leaves human-only lead fields blank, and reuses SET-25 matching", async () => {
  const rows = await domain.mapGoogleFormLeadRows({
    firstSourceRow: 2,
    clients: [storedClient()],
    rows: [
      [
        "2026-07-31T13:00:00Z",
        "FCI TEST — DO NOT USE — New account",
        "10 New Way",
        "Lobby",
        "Carpet tile",
        "match@example.test",
      ],
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "duplicate");
  assert.deepEqual(rows[0].reasons, ["This contact email matches an existing client."]);
  assert.equal(rows[0].proposal.estimatedValue, null);
  assert.equal(rows[0].proposal.source, "Google Form");
  assert.equal(rows[0].proposal.stage, "New inquiry");
  const longPreference = await domain.mapGoogleFormLeadRows({
    firstSourceRow: 2,
    clients: [],
    rows: [[
      "2026-07-31T13:00:00Z",
      "FCI TEST — DO NOT USE — Long preference",
      "11 New Way",
      "Office",
      "LVT",
      `${"Call the office extension, then ask for reception. ".repeat(4)}8565550199`,
    ]],
  });
  assert.equal(longPreference[0].proposal.contactPhone, null);
  assert.ok(domain.parseGoogleFormLeadProposal(longPreference[0].proposal));
  await assert.rejects(
    domain.mapGoogleFormLeadRows({
      firstSourceRow: 2,
      clients: [],
      rows: Array.from({ length: 26 }, () => []),
    }),
    /bounded Sheet range/u,
  );
});

test("GI-01's exported matcher preserves SET-25 mixed stored/import issue ordering", async () => {
  const headers = [
    "Client Code", "Client / Company", "Status", "Industry", "Primary Contact",
    "Email", "Phone", "Address",
  ];
  const duplicateRow = [
    "CL-0001",
    "FCI TEST — DO NOT USE — Existing account",
    "active",
    "Commercial",
    "Existing Contact",
    "match@example.test",
    "856-555-0199",
    "25 Existing Way, Cherry Hill, NJ",
  ];
  const preview = await firstRunDomain.previewFirstRunImport({
    entity: "clients",
    expectedHeaders: headers,
    snapshot: { clients: [storedClient()], projects: [] },
    values: [headers, duplicateRow, duplicateRow],
  });
  assert.deepEqual(preview.rows[0].issues.map(({ code }) => code), [
    "duplicate_code",
    "duplicate_import_code",
    "duplicate_name",
    "duplicate_import_name",
    "duplicate_email",
    "duplicate_import_email",
    "duplicate_phone",
    "duplicate_import_phone",
    "duplicate_address",
    "duplicate_import_address",
  ]);
});

test("GI-01 real-data gate redacts malformed, absent-name, and oversized rows before storage", async () => {
  const rows = await domain.mapGoogleFormLeadRows({
    firstSourceRow: 2,
    clients: [],
    rows: [
      ["", "Real Client", "", "Kitchen", "Hardwood", "real@example.com"],
      ["", "", "", "", "", ""],
      ["2026-07-31", "x".repeat(181), "Real address"],
    ],
  });
  assert.deepEqual(rows.map(({ state }) => state), [
    "blocked-real-data",
    "blocked-real-data",
    "blocked-real-data",
  ]);
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes("Real Client"), false);
  assert.equal(serialized.includes("real@example.com"), false);
  assert.equal(serialized.includes("Real address"), false);
  assert.equal(rows.every(({ submittedAt }) => submittedAt === null), true);

  const database = new Gi01Database();
  try {
    assert.equal(database.count("google_form_lead_reviews"), 0);
    assert.equal(database.count("google_form_lead_intake_watermarks"), 0);
    // The route rejects any batch containing this state before saveBatch.
    const routeSource = await read("app/api/v1/integrations/google/forms/leads/route.ts");
    assert.ok(routeSource.indexOf("blockedRows.length > 0") < routeSource.indexOf("repository.saveBatch"));
  } finally {
    database.close();
  }
});

test("GI-01 header contract is exact and rejects automatic collected-email columns", () => {
  assert.doesNotThrow(() => domain.assertGoogleFormLeadHeaders([[
    "Timestamp", "Name", "Address", "Rooms", "Flooring Type", "Preferred Contact",
  ]]));
  assert.throws(() => domain.assertGoogleFormLeadHeaders([[
    "Timestamp", "Email Address", "Name", "Address", "Rooms", "Flooring Type", "Preferred Contact",
  ]]), /columns in order/u);
  assert.throws(() => domain.assertGoogleFormLeadHeaders([[
    "Timestamp", "Name", "Address", "Rooms", "Flooring type", "Preferred contact",
  ]]), /columns in order/u);
});

test("GI-01 D1 overlap keeps source rows unique and watermark monotonic", async () => {
  const database = new Gi01Database();
  const repository = adapter.createD1GoogleFormLeadIntakeRepository(database);
  try {
    const first = repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [draft("review-2", 2), draft("review-3-a", 3)],
      lastProcessedRow: 3,
      processedAt: 100,
      actor: ADMIN_EMAIL,
    });
    const overlapping = repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [draft("review-3-b", 3), draft("review-4", 4)],
      lastProcessedRow: 4,
      processedAt: 200,
      actor: ADMIN_EMAIL,
    });
    const results = await Promise.all([first, overlapping]);
    assert.equal(results.reduce((sum, result) => sum + result.inserted, 0), 3);
    assert.deepEqual(
      (await repository.listNeedsReview(CONNECTION_KEY, 50)).map(({ sourceRow }) => sourceRow),
      [2, 3, 4],
    );
    assert.equal((await repository.getWatermark(CONNECTION_KEY, SHEET_ID)).lastProcessedRow, 4);

    const stale = await repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [draft("review-2-stale", 2)],
      lastProcessedRow: 2,
      processedAt: 300,
      actor: ADMIN_EMAIL,
    });
    assert.equal(stale.inserted, 0);
    assert.equal(stale.watermark.lastProcessedRow, 4);
    assert.equal(stale.watermark.lastProcessedAt, 200);
  } finally {
    database.close();
  }
});

test("GI-01 accepted retirement requires an existing lead owned by the acting admin", async () => {
  const database = new Gi01Database();
  const repository = adapter.createD1GoogleFormLeadIntakeRepository(database);
  const reviewId = "review-accept";
  try {
    await repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [draft(reviewId, 2)],
      lastProcessedRow: 2,
      processedAt: 100,
      actor: ADMIN_EMAIL,
    });
    assert.equal(await repository.retireReview({
      connectionKey: CONNECTION_KEY,
      reviewId,
      outcome: "accepted",
      acceptedLeadId: "lead-missing",
      actor: ADMIN_EMAIL,
      reviewedAt: 200,
    }), false);
    database.insertLead("lead-other", OFFICE_EMAIL);
    assert.equal(await repository.retireReview({
      connectionKey: CONNECTION_KEY,
      reviewId,
      outcome: "accepted",
      acceptedLeadId: "lead-other",
      actor: ADMIN_EMAIL,
      reviewedAt: 201,
    }), false);
    database.insertLead("lead-owned", ADMIN_EMAIL);
    assert.equal(await repository.retireReview({
      connectionKey: CONNECTION_KEY,
      reviewId,
      outcome: "accepted",
      acceptedLeadId: "lead-owned",
      actor: ADMIN_EMAIL,
      reviewedAt: 202,
    }), true);
    assert.equal((await repository.listNeedsReview(CONNECTION_KEY, 50)).length, 0);
    const acceptedRow = database.row(
      "SELECT status, accepted_lead_id FROM google_form_lead_reviews WHERE id = ?",
      reviewId,
    );
    assert.equal(acceptedRow.status, "accepted");
    assert.equal(acceptedRow.accepted_lead_id, "lead-owned");
  } finally {
    database.close();
  }
});

test("GI-01 admin simulation check queues once, never creates a lead, and second check is a no-op", async () => {
  const database = new Gi01Database();
  environment(database);
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("GI-01 simulation must not call Google.");
  };
  try {
    const first = await route.POST(request("POST"));
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal(firstBody.processed, 1);
    assert.equal(firstBody.inserted, 1);
    assert.equal(firstBody.queue.length, 1);
    assert.equal(firstBody.queue[0].proposal.estimatedValue, null);
    assert.equal(database.count("leads"), 0);
    assert.equal(providerCalls, 0);

    const writeCount = database.writes.length;
    const second = await route.POST(request("POST"));
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.processed, 0);
    assert.equal(secondBody.inserted, 0);
    assert.match(secondBody.message, /No new form responses/u);
    assert.equal(database.writes.length, writeCount);
    assert.equal(secondBody.watermark.lastProcessedRow, 2);
    assert.equal(database.count("google_form_lead_reviews"), 1);
  } finally {
    database.close();
  }
});

test("GI-01 route keeps admin and origin gates ahead of database work and retires only after lead creation", async () => {
  const database = new Gi01Database();
  environment(database);
  try {
    for (const denied of [
      request("GET", undefined, null),
      request("GET", undefined, OFFICE_EMAIL),
      request("POST", undefined, ADMIN_EMAIL, "https://attacker.example"),
    ]) {
      database.resetCounters();
      const handler = denied.method === "GET" ? route.GET : route.POST;
      const response = await handler(denied);
      assert.ok([401, 403].includes(response.status));
      assert.equal(database.reads.length, 0);
      assert.equal(database.writes.length, 0);
    }

    await route.POST(request("POST"));
    const queued = database.row("SELECT id FROM google_form_lead_reviews WHERE status = 'needs-review'");
    assert.ok(queued);
    const rejected = await route.PATCH(request("PATCH", {
      id: queued.id,
      outcome: "accepted",
      leadId: "lead-missing",
    }));
    assert.equal(rejected.status, 409);
    assert.equal(database.count("leads"), 0);
    assert.equal(database.count("google_form_lead_reviews"), 1);

    database.insertLead("lead-owned", ADMIN_EMAIL);
    const accepted = await route.PATCH(request("PATCH", {
      id: queued.id,
      outcome: "accepted",
      leadId: "lead-owned",
    }));
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { outcome: "accepted" });
    assert.equal(database.row(
      "SELECT status, accepted_lead_id FROM google_form_lead_reviews WHERE id = ?",
      queued.id,
    ).status, "accepted");
  } finally {
    database.close();
  }
});

test("GI-01 source laws pin manual triggering, adapter parity, safe acceptance ordering, and owner setup", async () => {
  const [
    routeSource,
    uiSource,
    domainSource,
    workerSource,
    postgresSource,
    productionComposition,
    productionSchema,
    checklist,
    rollout,
  ] = await Promise.all([
    read("app/api/v1/integrations/google/forms/leads/route.ts"),
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/domain/google-form-lead-intake.ts"),
    read("worker/index.ts"),
    read("app/adapters/postgres/google-form-lead-intake-repository.ts"),
    read("app/platform/google-cloud/production-composition.ts"),
    read("app/platform/postgres/google-form-lead-intake-schema.ts"),
    read("docs/task-checklists/11-google-quick-wins.md"),
    read("docs/google-workspace-rollout-guide.md"),
  ]);
  assert.match(domainSource, /matchFirstRunClientDuplicates\(/u);
  assert.doesNotMatch(routeSource, /POST \/api\/v1\/leads/u);
  assert.doesNotMatch(routeSource, /webhook|Pub\/Sub/iu);
  assert.doesNotMatch(workerSource, /\bscheduled\s*\(/u);
  assert.match(uiSource, /fetch\(LEADS_PATH/u);
  assert.match(
    uiSource,
    /if \(!response\.ok \|\| !lead\) \{[\s\S]*?\}\s*setCreatedLead\(lead\);\s*await retireAccepted\(lead\);/u,
  );
  assert.match(uiSource, /Retry retire review/u);
  assert.match(uiSource, /!loading && intake && queue\.length === 0/u);
  assert.match(postgresSource, /SELECT 1 FROM leads[\s\S]*leads\.id = \$3 AND leads\.created_by = \$1/u);
  assert.match(
    productionComposition,
    /const googleFormLeadIntake = createPostgresGoogleFormLeadIntakeRepository\([\s\S]*?googleFormLeadIntake,/u,
  );
  assert.match(productionSchema, /accepted_lead_id uuid REFERENCES leads \(id\)/u);
  assert.match(checklist, /\*\*Timestamp\*\*, \*\*Name\*\*,\s*\*\*Address\*\*, \*\*Rooms\*\*, \*\*Flooring Type\*\*, \*\*Preferred Contact\*\*/u);
  assert.match(checklist, /do not enable automatic email collection/iu);
  assert.match(rollout, /Do\s+not enable automatic email collection/iu);
});
