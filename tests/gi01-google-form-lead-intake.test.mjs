import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { createServer } from "vite";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const APP_ORIGIN = "https://fci.example.test";
const CONNECTION_KEY = "workspace-simulation";
const SHEET_ID = "workspace-simulation-lead-form-sheet";
const WORKSPACE_SHEET_ID = "workspaceLeadFormSheet_12345";
const CONNECTION_EMAIL = "operations@cherryhillfci.com";
const TOKEN_KEY = Buffer.alloc(32, 0x37).toString("base64url");
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
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

const [domain, firstRunDomain, adapter, postgresAdapter, d1Lead, config, route, leadRoute, oauthSites] = await Promise.all([
  vite.ssrLoadModule("/app/domain/google-form-lead-intake.ts"),
  vite.ssrLoadModule("/app/domain/first-run-import.ts"),
  vite.ssrLoadModule("/app/adapters/d1/google-form-lead-intake-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/google-form-lead-intake-repository.ts"),
  vite.ssrLoadModule("/app/adapters/d1/lead-repository.ts"),
  vite.ssrLoadModule("/app/lib/google-form-lead-intake-config.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/forms/leads/route.ts"),
  vite.ssrLoadModule("/app/api/v1/leads/route.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
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
    if (this.owner.failWritePattern?.test(this.sql)) {
      this.owner.failWriteMatches += 1;
    }
    if (
      this.owner.failWritePattern
      && this.owner.failWriteMatches === this.owner.failWriteOnMatch
    ) {
      throw new Error("Injected GI-01 transaction failure.");
    }
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class Gi01Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.reads = [];
    this.writes = [];
    this.failWritePattern = null;
    this.failWriteOnMatch = 1;
    this.failWriteMatches = 0;
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
        id TEXT PRIMARY KEY, lead_number TEXT NOT NULL UNIQUE,
        company TEXT NOT NULL, contact_name TEXT NOT NULL,
        contact_email TEXT, contact_phone TEXT, project_name TEXT NOT NULL,
        source TEXT NOT NULL, stage TEXT NOT NULL, site TEXT NOT NULL,
        estimated_value INTEGER NOT NULL, next_action TEXT NOT NULL,
        next_action_at INTEGER, owner_email TEXT NOT NULL, status TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE google_connections (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL UNIQUE,
        google_subject TEXT NOT NULL, google_email TEXT NOT NULL,
        scopes_json TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL,
        key_version TEXT NOT NULL, status TEXT NOT NULL,
        last_error_code TEXT, last_success_at INTEGER, created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER
      );
      CREATE TABLE google_form_lead_intake_watermarks (
        connection_key TEXT NOT NULL, spreadsheet_id TEXT NOT NULL,
        last_processed_row INTEGER NOT NULL, last_processed_submission_key TEXT NOT NULL,
        last_processed_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE (connection_key, spreadsheet_id)
      );
      CREATE TABLE google_form_lead_reviews (
        id TEXT PRIMARY KEY, connection_key TEXT NOT NULL, spreadsheet_id TEXT NOT NULL,
        submission_key TEXT NOT NULL, source_row INTEGER NOT NULL,
        submitted_at TEXT, state TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'needs-review', proposal_json TEXT NOT NULL,
        reasons_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        reviewed_by TEXT, reviewed_at INTEGER, accepted_lead_id TEXT,
        UNIQUE (connection_key, spreadsheet_id, submission_key)
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

  count(table) {
    return Number(this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  }

  row(sql, ...values) {
    return this.database.prepare(sql).get(...values) ?? null;
  }

  resetCounters() {
    this.reads.length = 0;
    this.writes.length = 0;
    this.failWriteMatches = 0;
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

async function workspaceEnvironment(database) {
  const encryptedRefreshToken = await oauthSites.encryptGoogleSecret(
    "FCI_TEST_REFRESH_TOKEN",
    TOKEN_KEY,
    "google-connection:google-workspace:refresh",
  );
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "sheets",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "workspaceSharedDrive_12345",
    GOOGLE_WORKSPACE_CLIENT_ID: "workspace-client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "workspace-client-secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/oauth/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION: "1",
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: CONNECTION_EMAIL,
    GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID: WORKSPACE_SHEET_ID,
    DB: database,
  });
  database.database.prepare(`
    INSERT INTO google_connections (
      id, connection_key, google_subject, google_email, scopes_json,
      refresh_token_ciphertext, key_version, status, last_error_code,
      last_success_at, created_by, created_at, updated_at, revoked_at
    ) VALUES (?, 'google-workspace', ?, ?, ?, ?, '1', 'connected', NULL, NULL, ?, 1, 1, NULL)
  `).run(
    randomUUID(),
    "google-subject-gi01",
    CONNECTION_EMAIL,
    JSON.stringify([SHEETS_SCOPE]),
    encryptedRefreshToken,
    ADMIN_EMAIL,
  );
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

function leadRequest(body, email = ADMIN_EMAIL, origin = APP_ORIGIN) {
  const url = new URL("/api/v1/leads", APP_ORIGIN);
  const headers = new Headers({
    origin,
    "content-type": "application/json",
    "idempotency-key": String(body.formLeadReviewId ?? "ordinary-lead"),
  });
  if (email) headers.set("oai-authenticated-user-email", email);
  const result = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  Object.defineProperty(result, "nextUrl", { value: url });
  return result;
}

function leadBody(reviewId, overrides = {}) {
  return {
    company: "FCI TEST — DO NOT USE — GI-01 accepted lead",
    contactName: "GI-01 contact",
    contactEmail: "gi01-accepted@example.test",
    contactPhone: null,
    projectName: "Office flooring inquiry",
    source: "Google Form",
    stage: "New inquiry",
    site: "2 Review Way",
    estimatedValue: 125000,
    nextAction: "Schedule a site visit.",
    nextActionAt: null,
    ownerEmail: ADMIN_EMAIL,
    status: "active",
    formLeadReviewId: reviewId,
    ...overrides,
  };
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

function stableKey(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceRows(rows, firstSourceRow = 2) {
  return rows.map((cells, index) => ({ sourceRow: firstSourceRow + index, cells }));
}

function draft(id, sourceRow, identity = id) {
  return {
    id,
    submissionKey: stableKey(identity),
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
    clients: [storedClient()],
    rows: sourceRows([
      [
        "2026-07-31T13:00:00Z",
        "FCI TEST — DO NOT USE — New account",
        "10 New Way",
        "Lobby",
        "Carpet tile",
        "match@example.test",
      ],
    ]),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "duplicate");
  assert.deepEqual(rows[0].reasons, ["This contact email matches an existing client."]);
  assert.equal(rows[0].proposal.estimatedValue, null);
  assert.equal(rows[0].proposal.source, "Google Form");
  assert.equal(rows[0].proposal.stage, "New inquiry");
  const longPreference = await domain.mapGoogleFormLeadRows({
    clients: [],
    rows: sourceRows([[
      "2026-07-31T13:00:00Z",
      "FCI TEST — DO NOT USE — Long preference",
      "11 New Way",
      "Office",
      "LVT",
      `${"Call the office extension, then ask for reception. ".repeat(4)}8565550199`,
    ]]),
  });
  assert.equal(longPreference[0].proposal.contactPhone, null);
  assert.ok(domain.parseGoogleFormLeadProposal(longPreference[0].proposal));
  await assert.rejects(
    domain.mapGoogleFormLeadRows({
      clients: [],
      rows: sourceRows(Array.from({ length: 26 }, () => [])),
    }),
    /bounded Sheet range/u,
  );
});

test("GI-01 submission identity uses Timestamp plus content and never the Sheet row ordinal", async () => {
  const cells = [
    "2026-07-31T13:00:00Z",
    "FCI TEST — DO NOT USE — Stable identity",
    "10 Stable Way",
    "Lobby",
    "LVT",
    "stable@example.test",
  ];
  const [atRowTwo, atRowNinetyNine] = await domain.mapGoogleFormLeadRows({
    clients: [],
    rows: [
      { sourceRow: 2, cells },
      { sourceRow: 99, cells },
    ],
  });
  assert.equal(atRowTwo.submissionKey, atRowNinetyNine.submissionKey);
  assert.match(atRowTwo.submissionKey, /^[a-f0-9]{64}$/u);
  assert.notEqual(
    await domain.googleFormLeadSubmissionKey(["2026-07-31T13:01:00Z", ...cells.slice(1)]),
    atRowTwo.submissionKey,
  );
  assert.notEqual(
    await domain.googleFormLeadSubmissionKey([...cells.slice(0, 2), "11 Stable Way", ...cells.slice(3)]),
    atRowTwo.submissionKey,
  );
  assert.equal(
    await domain.googleFormLeadSubmissionKey([...cells.slice(0, 5)]),
    await domain.googleFormLeadSubmissionKey([...cells.slice(0, 5), ""]),
  );
});

test("GI-01 position refresh batches stay bounded and disjoint from new reviews", () => {
  const positions = Array.from({ length: 25 }, (_, index) => ({
    submissionKey: stableKey(`bounded-position-${index}`),
    sourceRow: index + 2,
  }));
  assert.equal(domain.isGoogleFormLeadPositionBatch(positions, []), true);
  assert.equal(domain.isGoogleFormLeadPositionBatch(positions.slice(0, 24), [positions[24]]), true);
  assert.equal(domain.isGoogleFormLeadPositionBatch(positions, [
    { submissionKey: stableKey("overflow"), sourceRow: 27 },
  ]), false);
  assert.equal(domain.isGoogleFormLeadPositionBatch([positions[0]], [positions[0]]), false);
  assert.equal(domain.isGoogleFormLeadPositionBatch([], [{
    submissionKey: stableKey("invalid-row"),
    sourceRow: 1,
  }]), false);
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

test("GI-01 validates blank and oversized names before the real-data gate and redacts their values", async () => {
  const rows = await domain.mapGoogleFormLeadRows({
    clients: [],
    rows: sourceRows([
      ["", "Real Client", "", "Kitchen", "Hardwood", "real@example.com"],
      ["", "", "", "", "", ""],
      ["2026-07-31", "x".repeat(181), "Real address"],
    ]),
  });
  assert.deepEqual(rows.map(({ state }) => state), [
    "invalid",
    "invalid",
    "invalid",
  ]);
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes("Real Client"), false);
  assert.equal(serialized.includes("real@example.com"), false);
  assert.equal(serialized.includes("Real address"), false);
  assert.deepEqual(rows.map(({ submittedAt }) => submittedAt), [null, null, "2026-07-31"]);
  for (const row of rows) {
    assert.deepEqual(
      [row.proposal.company, row.proposal.contactName, row.proposal.projectName, row.proposal.site],
      ["", "", "", ""],
    );
  }
  assert.ok(rows[1].reasons.includes("Name is required."));
  assert.ok(rows[2].reasons.includes("Name contains an unsupported or oversized value."));

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

test("GI-01 route keeps malformed marked rows correctable while a mixed real row blocks the batch", async () => {
  const virtualSimulationId = "\0gi01-test-form-lead-simulation";
  const testVite = await createServer({
    root: fileURLToPath(rootUrl),
    cacheDir: fileURLToPath(new URL("../node_modules/.vite-gi01-google-form-lead-mixed", import.meta.url)),
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    plugins: [{
      name: "gi01-test-form-lead-simulation",
      enforce: "pre",
      resolveId(source) {
        return /google-form-lead-intake-simulation(?:\.ts)?$/u.test(source)
          ? virtualSimulationId
          : null;
      },
      load(id) {
        if (id !== virtualSimulationId) return null;
        return `
          const headers = [[
            "Timestamp", "Name", "Address", "Rooms", "Flooring Type", "Preferred Contact",
          ]];
          export function googleFormLeadSimulationHeaders() {
            return headers;
          }
          export function googleFormLeadSimulationRows(firstSourceRow, limit) {
            const rows = globalThis.__GI01_TEST_FORM_LEAD_ROWS__ ?? [];
            const offset = firstSourceRow - 2;
            return rows.slice(offset, offset + limit);
          }
        `;
      },
    }],
    resolve: {
      alias: {
        "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
      },
    },
    server: { middlewareMode: true, hmr: { port: 24799 } },
  });
  const database = new Gi01Database();
  environment(database);
  try {
    const testRoute = await testVite.ssrLoadModule(
      "/app/api/v1/integrations/google/forms/leads/route.ts",
    );
    const malformedMarkerRow = [
      "2026-07-31T13:00:00Z",
      "FCI TEST — DO NOT USE — Correctable response",
      "17 Test Way",
      "x".repeat(161),
      "LVT",
      "correctable@example.test",
    ];
    const marker = "FCI TEST — DO NOT USE";
    const name160 = `${marker} ${"A".repeat(160 - marker.length - 1)}`;
    const name161 = `${marker} ${"B".repeat(161 - marker.length - 1)}`;
    globalThis.__GI01_TEST_FORM_LEAD_ROWS__ = [
      malformedMarkerRow,
      [
        "2026-07-31T13:01:00Z",
        "Real Customer",
        "18 Private Way",
        "Kitchen",
        "Hardwood",
        "real@example.com",
      ],
    ];

    const blocked = await testRoute.POST(request("POST"));
    assert.equal(blocked.status, 409);
    assert.deepEqual((await blocked.json()).blockedRows, [3]);
    assert.equal(database.count("google_form_lead_reviews"), 0);
    assert.equal(database.count("google_form_lead_intake_watermarks"), 0);

    globalThis.__GI01_TEST_FORM_LEAD_ROWS__ = [
      malformedMarkerRow,
      ["2026-07-31T13:02:00Z", name160, "19 Test Way", "Lobby", "LVT", "call"],
      ["2026-07-31T13:03:00Z", name161, "20 Test Way", "Office", "LVT", "call"],
      [],
      [
        "2026-07-31T13:05:00Z",
        "FCI TEST — DO NOT USE — After invalid rows",
        "21 Test Way",
        "Hall",
        "Carpet",
        "after@example.test",
      ],
    ];
    const saved = await testRoute.POST(request("POST"));
    const body = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(body.processed, 5);
    assert.equal(body.inserted, 5);
    assert.equal(body.watermark.lastProcessedRow, 6);
    assert.equal(body.queue[0].state, "invalid");
    assert.equal(body.queue[0].proposal.company, malformedMarkerRow[1]);
    assert.equal(body.queue[0].proposal.rooms, null);
    assert.deepEqual(body.queue[0].reasons, [
      "Rooms contains an unsupported or oversized value.",
    ]);
    assert.equal(body.queue[1].proposal.contactName.length, 160);
    assert.equal(body.queue[1].state, "ready");
    assert.equal(body.queue[2].state, "invalid");
    assert.deepEqual(body.queue[2].reasons, [
      "Name contains an unsupported or oversized value.",
      "Name is required.",
    ]);
    assert.equal(body.queue[3].state, "invalid");
    assert.ok(body.queue[3].reasons.includes("Name is required."));
    assert.equal(body.queue[4].state, "ready");
    assert.equal(database.count("google_form_lead_reviews"), 5);
    assert.equal(database.count("google_form_lead_intake_watermarks"), 1);
    assert.equal(database.count("leads"), 0);
  } finally {
    delete globalThis.__GI01_TEST_FORM_LEAD_ROWS__;
    database.close();
    await testVite.close();
  }
});

test("GI-01 circular scanning neither skips a response after deletion nor duplicates one after insertion", async () => {
  const virtualSimulationId = "\0gi01-test-form-lead-mutable-simulation";
  const testVite = await createServer({
    root: fileURLToPath(rootUrl),
    cacheDir: fileURLToPath(new URL("../node_modules/.vite-gi01-google-form-lead-mutable", import.meta.url)),
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    plugins: [{
      name: "gi01-test-form-lead-mutable-simulation",
      enforce: "pre",
      resolveId(source) {
        return /google-form-lead-intake-simulation(?:\.ts)?$/u.test(source)
          ? virtualSimulationId
          : null;
      },
      load(id) {
        if (id !== virtualSimulationId) return null;
        return `
          const headers = [[
            "Timestamp", "Name", "Address", "Rooms", "Flooring Type", "Preferred Contact",
          ]];
          export function googleFormLeadSimulationHeaders() { return headers; }
          export function googleFormLeadSimulationRows(firstSourceRow, limit) {
            const rows = globalThis.__GI01_TEST_MUTABLE_FORM_LEAD_ROWS__ ?? [];
            return rows.slice(firstSourceRow - 2, firstSourceRow - 2 + limit);
          }
        `;
      },
    }],
    resolve: {
      alias: {
        "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
      },
    },
    server: { middlewareMode: true, hmr: { port: 24800 } },
  });
  const database = new Gi01Database();
  environment(database);
  const responseRow = (number) => [
    `2026-07-31T14:${String(number).padStart(2, "0")}:00Z`,
    `FCI TEST — DO NOT USE — Submission ${number}`,
    `${number} Mutation Way`,
    "Office",
    "LVT",
    `submission-${number}@example.test`,
  ];
  try {
    const testRoute = await testVite.ssrLoadModule(
      "/app/api/v1/integrations/google/forms/leads/route.ts",
    );
    globalThis.__GI01_TEST_MUTABLE_FORM_LEAD_ROWS__ = Array.from(
      { length: 26 },
      (_, index) => responseRow(index + 1),
    );
    const first = await testRoute.POST(request("POST"));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).inserted, 25);

    globalThis.__GI01_TEST_MUTABLE_FORM_LEAD_ROWS__.splice(12, 1);
    const afterDeletion = await testRoute.POST(request("POST"));
    const afterDeletionBody = await afterDeletion.json();
    assert.equal(afterDeletion.status, 200);
    assert.equal(afterDeletionBody.inserted, 1);
    assert.equal(afterDeletionBody.queue.length, 26);
    assert.deepEqual(
      afterDeletionBody.queue.map(({ proposal }) => proposal.company).sort(),
      Array.from(
        { length: 26 },
        (_, index) => `FCI TEST — DO NOT USE — Submission ${index + 1}`,
      ).sort(),
    );
    const submission14Key = await domain.googleFormLeadSubmissionKey(responseRow(14));
    assert.equal(database.row(
      "SELECT source_row FROM google_form_lead_reviews WHERE submission_key = ?",
      submission14Key,
    ).source_row, 14);

    globalThis.__GI01_TEST_MUTABLE_FORM_LEAD_ROWS__.splice(12, 0, responseRow(99));
    const afterInsertion = await testRoute.POST(request("POST"));
    const afterInsertionBody = await afterInsertion.json();
    assert.equal(afterInsertion.status, 200);
    assert.equal(afterInsertionBody.inserted, 1);
    assert.equal(afterInsertionBody.queue.length, 27);
    assert.deepEqual(
      afterInsertionBody.queue.map(({ proposal }) => proposal.company).sort(),
      [
        ...Array.from(
          { length: 26 },
          (_, index) => `FCI TEST — DO NOT USE — Submission ${index + 1}`,
        ),
        "FCI TEST — DO NOT USE — Submission 99",
      ].sort(),
    );
    const submission99Key = await domain.googleFormLeadSubmissionKey(responseRow(99));
    assert.equal(database.row(
      "SELECT source_row FROM google_form_lead_reviews WHERE submission_key = ?",
      submission14Key,
    ).source_row, 15);
    assert.equal(database.row(
      "SELECT source_row FROM google_form_lead_reviews WHERE submission_key = ?",
      submission99Key,
    ).source_row, 14);
    assert.equal(database.count("google_form_lead_reviews"), 27);
    assert.equal(database.row(
      "SELECT COUNT(DISTINCT submission_key) AS count FROM google_form_lead_reviews",
    ).count, 27);
    assert.equal(database.count("leads"), 0);
  } finally {
    delete globalThis.__GI01_TEST_MUTABLE_FORM_LEAD_ROWS__;
    database.close();
    await testVite.close();
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

test("GI-01 D1 deduplicates stable submissions while source rows and the scan cursor may move", async () => {
  const database = new Gi01Database();
  const repository = adapter.createD1GoogleFormLeadIntakeRepository(database);
  try {
    const rowA = draft("review-2", 2, "submission-a");
    const rowB = draft("review-3-a", 3, "submission-b");
    const first = await repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [rowA, rowB],
      observedPositions: [],
      lastProcessedRow: 3,
      lastProcessedSubmissionKey: rowB.submissionKey,
      processedAt: 100,
      actor: ADMIN_EMAIL,
    });
    assert.equal(first.inserted, 2);
    const replacementAtRowThree = draft("review-4", 3, "submission-c");
    const overlapping = await repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [replacementAtRowThree],
      observedPositions: [{ submissionKey: rowB.submissionKey, sourceRow: 30 }],
      lastProcessedRow: 3,
      lastProcessedSubmissionKey: replacementAtRowThree.submissionKey,
      processedAt: 200,
      actor: ADMIN_EMAIL,
    });
    assert.equal(overlapping.inserted, 1);
    assert.equal(overlapping.repositioned, 1);
    assert.deepEqual(
      (await repository.listNeedsReview(CONNECTION_KEY, 50)).map(({ sourceRow }) => sourceRow),
      [2, 3, 30],
    );
    assert.deepEqual(
      (await repository.findProcessedSubmissions(CONNECTION_KEY, SHEET_ID, [
        rowA.submissionKey,
        rowB.submissionKey,
        stableKey("not-seen"),
      ])).map(({ submissionKey }) => submissionKey).sort(),
      [rowA.submissionKey, rowB.submissionKey].sort(),
    );

    const failedReview = draft("review-failed-reposition", 31, "submission-d");
    database.failWritePattern = /^INSERT INTO google_form_lead_intake_watermarks/u;
    await assert.rejects(repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [failedReview],
      observedPositions: [{ submissionKey: rowB.submissionKey, sourceRow: 31 }],
      lastProcessedRow: 31,
      lastProcessedSubmissionKey: failedReview.submissionKey,
      processedAt: 250,
      actor: ADMIN_EMAIL,
    }), /Injected GI-01 transaction failure/u);
    assert.equal(database.row(
      "SELECT source_row FROM google_form_lead_reviews WHERE submission_key = ?",
      rowB.submissionKey,
    ).source_row, 30);
    assert.deepEqual(await repository.findProcessedSubmissions(
      CONNECTION_KEY,
      SHEET_ID,
      [failedReview.submissionKey],
    ), []);
    database.failWritePattern = null;
    database.failWriteMatches = 0;

    const wrapped = await repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [],
      observedPositions: [],
      lastProcessedRow: 2,
      lastProcessedSubmissionKey: rowA.submissionKey,
      processedAt: 300,
      actor: ADMIN_EMAIL,
    });
    assert.equal(wrapped.inserted, 0);
    assert.equal(wrapped.watermark.lastProcessedRow, 2);
    assert.equal(wrapped.watermark.lastProcessedSubmissionKey, rowA.submissionKey);
    assert.equal(wrapped.watermark.lastProcessedAt, 300);
  } finally {
    database.close();
  }
});

test("GI-01 D1 batch rollback retries exactly the still-unprocessed stable submissions", async () => {
  const database = new Gi01Database();
  const repository = adapter.createD1GoogleFormLeadIntakeRepository(database);
  const reviews = [
    draft("review-recovery-a", 2),
    draft("review-recovery-b", 3),
    draft("review-recovery-c", 4),
  ];
  const input = {
    connectionKey: CONNECTION_KEY,
    spreadsheetId: SHEET_ID,
    reviews,
    observedPositions: [],
    lastProcessedRow: 4,
    lastProcessedSubmissionKey: reviews.at(-1).submissionKey,
    processedAt: 100,
    actor: ADMIN_EMAIL,
  };
  try {
    database.failWritePattern = /^INSERT INTO google_form_lead_reviews/u;
    database.failWriteOnMatch = 2;
    await assert.rejects(repository.saveBatch(input), /Injected GI-01 transaction failure/u);
    assert.equal(database.count("google_form_lead_reviews"), 0);
    assert.equal(database.count("google_form_lead_intake_watermarks"), 0);

    database.failWritePattern = null;
    database.failWriteMatches = 0;
    const recovered = await repository.saveBatch({ ...input, processedAt: 200 });
    assert.equal(recovered.inserted, 3);
    assert.equal(database.count("google_form_lead_reviews"), 3);
    assert.deepEqual(
      (await repository.findProcessedSubmissions(
        CONNECTION_KEY,
        SHEET_ID,
        reviews.map(({ submissionKey }) => submissionKey),
      )).map(({ submissionKey }) => submissionKey).sort(),
      reviews.map(({ submissionKey }) => submissionKey).sort(),
    );

    const invalid = {
      ...draft("review-invalid", 77),
      proposal: {
        ...draft("review-invalid", 77).proposal,
        contactName: "x".repeat(161),
      },
    };
    await assert.rejects(
      repository.saveBatch({
        ...input,
        reviews: [invalid],
        lastProcessedRow: 77,
        lastProcessedSubmissionKey: invalid.submissionKey,
        processedAt: 300,
      }),
      (error) => error?.code === "form_lead_review_draft_invalid"
        && error?.sourceRow === 77,
    );
  } finally {
    database.close();
  }
});

test("GI-01 review repository exposes dismissal as its only disposition writer", async () => {
  const database = new Gi01Database();
  const repository = adapter.createD1GoogleFormLeadIntakeRepository(database);
  const reviewId = "review-dismiss";
  try {
    await repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [draft(reviewId, 2)],
      observedPositions: [],
      lastProcessedRow: 2,
      lastProcessedSubmissionKey: stableKey(reviewId),
      processedAt: 100,
      actor: ADMIN_EMAIL,
    });
    assert.equal(await repository.dismissReview({
      connectionKey: CONNECTION_KEY,
      reviewId,
      actor: ADMIN_EMAIL,
      reviewedAt: 200,
    }), true);
    assert.equal(await repository.dismissReview({
      connectionKey: CONNECTION_KEY,
      reviewId,
      actor: ADMIN_EMAIL,
      reviewedAt: 201,
    }), false);
    const ignoredPosition = await repository.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [],
      observedPositions: [{ submissionKey: stableKey(reviewId), sourceRow: 50 }],
      lastProcessedRow: 50,
      lastProcessedSubmissionKey: stableKey(reviewId),
      processedAt: 202,
      actor: ADMIN_EMAIL,
    });
    assert.equal(ignoredPosition.repositioned, 0);
    assert.equal((await repository.listNeedsReview(CONNECTION_KEY, 50)).length, 0);
    const dismissedRow = database.row(
      "SELECT status, source_row, accepted_lead_id FROM google_form_lead_reviews WHERE id = ?",
      reviewId,
    );
    assert.equal(dismissedRow.status, "dismissed");
    assert.equal(dismissedRow.source_row, 2);
    assert.equal(dismissedRow.accepted_lead_id, null);
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

    const current = await route.GET(request("GET"));
    const currentBody = await current.json();
    assert.equal(current.status, 200);
    assert.deepEqual(currentBody, {
      configured: true,
      invalidConfiguration: false,
      configurationName: "GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID",
      simulation: true,
      actorEmail: ADMIN_EMAIL,
      rowLimit: 25,
      watermark: firstBody.watermark,
      queue: firstBody.queue,
    });
    assert.deepEqual(Object.keys(currentBody.queue[0]).sort(), [
      "createdAt",
      "id",
      "proposal",
      "reasons",
      "sourceRow",
      "state",
      "status",
      "submittedAt",
      "updatedAt",
    ]);
    assert.equal(JSON.stringify(currentBody).includes("submissionKey"), false);
    assert.equal(JSON.stringify(currentBody).includes("connectionKey"), false);
    assert.equal(JSON.stringify(currentBody).includes("spreadsheetId"), false);

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

test("GI-01 workspace route acquires a Sheets token, performs the bounded production read, and returns the GET contract", async () => {
  const database = new Gi01Database();
  await workspaceEnvironment(database);
  const providerCalls = [];
  const providerRows = Array.from({ length: 26 }, (_, index) => [
    `2026-07-31T15:${String(index).padStart(2, "0")}:00Z`,
    `FCI TEST — DO NOT USE — Workspace ${index + 1}`,
    `${index + 1} Provider Way`,
    "Office",
    "LVT",
    `workspace-${index + 1}@example.test`,
  ]);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    providerCalls.push({ url: url.href, init });
    if (url.hostname === "oauth2.googleapis.com") {
      assert.equal(init.method, "POST");
      assert.match(String(init.body), /grant_type=refresh_token/u);
      return new Response(JSON.stringify({ access_token: "workspace-access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.hostname === "sheets.googleapis.com") {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer workspace-access-token");
      const encodedRange = url.pathname.split("/values/")[1] ?? "";
      const range = decodeURIComponent(encodedRange);
      if (range === "A1:F1") {
        return new Response(JSON.stringify({ values: [[
          "Timestamp", "Name", "Address", "Rooms", "Flooring Type", "Preferred Contact",
        ]] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (range === "A2:F26") {
        return new Response(JSON.stringify({ values: providerRows }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected Sheets range ${range}`);
    }
    throw new Error(`Unexpected provider request ${url.href}`);
  };
  try {
    const response = await route.POST(request("POST"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.processed, 25);
    assert.equal(body.inserted, 25);
    assert.equal(body.watermark.lastProcessedRow, 26);
    assert.equal(database.count("google_form_lead_reviews"), 25);
    assert.equal(database.count("leads"), 0);
    assert.deepEqual(
      providerCalls
        .filter(({ url }) => url.includes("sheets.googleapis.com"))
        .map(({ url }) => decodeURIComponent(new URL(url).pathname.split("/values/")[1] ?? ""))
        .sort(),
      ["A1:F1", "A2:F26"],
    );

    const current = await route.GET(request("GET"));
    const currentBody = await current.json();
    assert.equal(current.status, 200);
    assert.deepEqual(currentBody, {
      configured: true,
      invalidConfiguration: false,
      configurationName: "GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID",
      simulation: false,
      actorEmail: ADMIN_EMAIL,
      rowLimit: 25,
      watermark: body.watermark,
      queue: body.queue,
    });
    assert.equal(JSON.stringify(currentBody).includes("submissionKey"), false);
    assert.equal(JSON.stringify(currentBody).includes("connectionKey"), false);
    assert.equal(JSON.stringify(currentBody).includes("spreadsheetId"), false);
  } finally {
    database.close();
  }
});

test("GI-01 lead POST atomically accepts one review and rejects a concurrent duplicate", async () => {
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
    database.resetCounters();
    const rejectedPatch = await route.PATCH(request("PATCH", {
      id: queued.id,
      outcome: "accepted",
    }));
    assert.equal(rejectedPatch.status, 400);
    assert.equal(database.writes.length, 0);

    database.resetCounters();
    const deniedLead = await leadRoute.POST(leadRequest(
      leadBody(queued.id),
      OFFICE_EMAIL,
    ));
    assert.equal(deniedLead.status, 403);
    assert.equal(database.reads.length, 0);
    assert.equal(database.writes.length, 0);

    const responses = await Promise.all([
      leadRoute.POST(leadRequest(leadBody(queued.id))),
      leadRoute.POST(leadRequest(leadBody(queued.id))),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
    const accepted = bodies.find((body) => body.formLeadReview?.status === "accepted");
    const stale = bodies.find((body) => body.code === "form_lead_review_not_found");
    assert.deepEqual(accepted.formLeadReview, { id: queued.id, status: "accepted" });
    assert.ok(stale);
    assert.equal(database.count("leads"), 1);
    assert.equal(database.count("activity_events"), 1);
    const acceptedRow = database.row(
      "SELECT status, accepted_lead_id FROM google_form_lead_reviews WHERE id = ?",
      queued.id,
    );
    assert.equal(acceptedRow.status, "accepted");
    assert.equal(acceptedRow.accepted_lead_id, accepted.lead.id);
  } finally {
    database.close();
  }
});

test("GI-01 D1 lead acceptance rolls back both records when batched evidence fails", async () => {
  const database = new Gi01Database();
  const reviews = adapter.createD1GoogleFormLeadIntakeRepository(database);
  const reviewId = "review-rollback";
  try {
    await reviews.saveBatch({
      connectionKey: CONNECTION_KEY,
      spreadsheetId: SHEET_ID,
      reviews: [draft(reviewId, 2)],
      observedPositions: [],
      lastProcessedRow: 2,
      lastProcessedSubmissionKey: stableKey(reviewId),
      processedAt: 100,
      actor: ADMIN_EMAIL,
    });
    database.failWritePattern = /^INSERT INTO activity_events/u;
    await assert.rejects(
      d1Lead.createD1LeadRepository(database).create({
        lead: {
          id: "11111111-1111-4111-8111-111111111111",
          lead_number: "L-2026-11111111",
          company: "FCI TEST — DO NOT USE — rollback",
          contact_name: "Rollback contact",
          contact_email: null,
          contact_phone: null,
          project_name: "Rollback project",
          source: "Google Form",
          stage: "New inquiry",
          site: "1 Rollback Way",
          estimated_value: 1,
          next_action: "Retry safely",
          next_action_at: null,
          owner_email: ADMIN_EMAIL,
          status: "active",
          created_by: ADMIN_EMAIL,
          created_at: 200,
          updated_at: 200,
          version: "1",
        },
        activity: {
          id: "22222222-2222-4222-8222-222222222222",
          recordId: "11111111-1111-4111-8111-111111111111",
          action: "Lead created",
          actor: ADMIN_EMAIL,
          detail: "Rollback evidence",
          createdAt: 200,
        },
        formLeadReview: {
          id: reviewId,
          connectionKey: CONNECTION_KEY,
          acceptedAt: 200,
        },
      }),
      /Injected GI-01 transaction failure/u,
    );
    assert.equal(database.count("leads"), 0);
    assert.equal(database.row(
      "SELECT status FROM google_form_lead_reviews WHERE id = ?",
      reviewId,
    ).status, "needs-review");
  } finally {
    database.close();
  }
});

test("GI-01 PostgreSQL adapter executes stable-key reads, writes, conflicts, and dismissal", {
  skip: process.env.TEST_POSTGRES_URL?.trim()
    ? false
    : "TEST_POSTGRES_URL is not configured",
  timeout: 30_000,
}, async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.TEST_POSTGRES_URL.trim(),
    max: 4,
    application_name: "fci_gi01_intake_integration",
  });
  const schema = `fci_gi01_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  try {
    await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema });
    const repository = postgresAdapter.createPostgresGoogleFormLeadIntakeRepository(
      pool,
      { schema },
    );
    const rowA = draft(randomUUID(), 2, "postgres-submission-a");
    const rowB = draft(randomUUID(), 3, "postgres-submission-b");
    const first = await repository.saveBatch({
      connectionKey: "google-workspace",
      spreadsheetId: WORKSPACE_SHEET_ID,
      reviews: [rowA, rowB],
      observedPositions: [],
      lastProcessedRow: 3,
      lastProcessedSubmissionKey: rowB.submissionKey,
      processedAt: 100,
      actor: ADMIN_EMAIL,
    });
    assert.equal(first.inserted, 2);

    const replacement = draft(randomUUID(), 2, "postgres-submission-c");
    const second = await repository.saveBatch({
      connectionKey: "google-workspace",
      spreadsheetId: WORKSPACE_SHEET_ID,
      reviews: [replacement],
      observedPositions: [{ submissionKey: rowA.submissionKey, sourceRow: 99 }],
      lastProcessedRow: 2,
      lastProcessedSubmissionKey: replacement.submissionKey,
      processedAt: 200,
      actor: ADMIN_EMAIL,
    });
    assert.equal(second.inserted, 1);
    assert.equal(second.repositioned, 1);
    assert.equal(second.watermark.lastProcessedRow, 2);
    assert.equal(second.watermark.lastProcessedSubmissionKey, replacement.submissionKey);
    assert.deepEqual(
      (await repository.findProcessedSubmissions(
        "google-workspace",
        WORKSPACE_SHEET_ID,
        [rowA.submissionKey, rowB.submissionKey, replacement.submissionKey],
      )).map(({ submissionKey }) => submissionKey).sort(),
      [rowA.submissionKey, rowB.submissionKey, replacement.submissionKey].sort(),
    );
    const currentReviews = await repository.listNeedsReview("google-workspace", 50);
    assert.equal(currentReviews.length, 3);
    assert.equal(
      currentReviews.find(({ submissionKey }) => submissionKey === rowA.submissionKey).sourceRow,
      99,
    );

    const recoveryA = draft(randomUUID(), 80, "postgres-recovery-a");
    const recoveryBWithConflictingId = {
      ...draft(rowA.id, 81, "postgres-recovery-b"),
    };
    await assert.rejects(repository.saveBatch({
      connectionKey: "google-workspace",
      spreadsheetId: WORKSPACE_SHEET_ID,
      reviews: [recoveryA, recoveryBWithConflictingId],
      observedPositions: [{ submissionKey: rowA.submissionKey, sourceRow: 100 }],
      lastProcessedRow: 81,
      lastProcessedSubmissionKey: recoveryBWithConflictingId.submissionKey,
      processedAt: 250,
      actor: ADMIN_EMAIL,
    }));
    assert.equal(
      (await repository.listNeedsReview("google-workspace", 50))
        .find(({ submissionKey }) => submissionKey === rowA.submissionKey).sourceRow,
      99,
    );
    assert.deepEqual(
      (await repository.findProcessedSubmissions(
        "google-workspace",
        WORKSPACE_SHEET_ID,
        [recoveryA.submissionKey, recoveryBWithConflictingId.submissionKey],
      )).map(({ submissionKey }) => submissionKey),
      [],
    );
    assert.equal(
      (await repository.getWatermark("google-workspace", WORKSPACE_SHEET_ID))
        .lastProcessedSubmissionKey,
      replacement.submissionKey,
    );
    const recoveryB = { ...recoveryBWithConflictingId, id: randomUUID() };
    const recovered = await repository.saveBatch({
      connectionKey: "google-workspace",
      spreadsheetId: WORKSPACE_SHEET_ID,
      reviews: [recoveryA, recoveryB],
      observedPositions: [],
      lastProcessedRow: 81,
      lastProcessedSubmissionKey: recoveryB.submissionKey,
      processedAt: 275,
      actor: ADMIN_EMAIL,
    });
    assert.equal(recovered.inserted, 2);
    assert.equal(await repository.dismissReview({
      connectionKey: "google-workspace",
      reviewId: rowB.id,
      actor: ADMIN_EMAIL,
      reviewedAt: 300,
    }), true);
    assert.deepEqual(
      (await repository.findProcessedSubmissions(
        "google-workspace",
        WORKSPACE_SHEET_ID,
        [rowB.submissionKey],
      )).map(({ submissionKey }) => submissionKey),
      [rowB.submissionKey],
    );
    const persisted = await pool.query(
      `SELECT COUNT(*)::integer AS count,
              COUNT(DISTINCT submission_key)::integer AS identity_count
       FROM ${schema}.google_form_lead_reviews`,
    );
    assert.deepEqual(persisted.rows, [{ count: 5, identity_count: 5 }]);

    const invalid = {
      ...draft(randomUUID(), 77, "postgres-invalid"),
      proposal: {
        ...draft(randomUUID(), 77, "postgres-invalid").proposal,
        contactName: "x".repeat(161),
      },
    };
    await assert.rejects(repository.saveBatch({
      connectionKey: "google-workspace",
      spreadsheetId: WORKSPACE_SHEET_ID,
      reviews: [invalid],
      observedPositions: [],
      lastProcessedRow: 77,
      lastProcessedSubmissionKey: invalid.submissionKey,
      processedAt: 400,
      actor: ADMIN_EMAIL,
    }), (error) => error?.code === "form_lead_review_draft_invalid"
      && error?.sourceRow === 77);
  } finally {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
});

test("GI-01 source laws pin manual triggering, adapter parity, safe acceptance ordering, and owner setup", async () => {
  const [
    routeSource,
    uiSource,
    domainSource,
    workerSource,
    postgresIntakeSource,
    leadRouteSource,
    d1LeadSource,
    postgresLeadSource,
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
    read("app/api/v1/leads/route.ts"),
    read("app/adapters/d1/lead-repository.ts"),
    read("app/adapters/postgres/lead-repository.ts"),
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
  assert.match(uiSource, /"Idempotency-Key": review\.id/u);
  assert.match(uiSource, /formLeadReviewId: review\.id/u);
  assert.match(uiSource, /<input value=\{FORM_LEAD_SOURCE\} readOnly aria-readonly="true"/u);
  assert.match(uiSource, /source: FORM_LEAD_SOURCE/u);
  assert.match(uiSource, /Retry queue refresh/u);
  assert.match(uiSource, /FIRST_RUN_IMPORT_TEST_MARKER/u);
  assert.match(uiSource, /Last observed at response Sheet row \{review\.sourceRow\}/u);
  assert.doesNotMatch(uiSource, /<small>Response Sheet row \{review\.sourceRow\}/u);
  assert.match(
    uiSource,
    /const acceptedReview = [\s\S]*?body\.formLeadReview\.id === review\.id[\s\S]*?body\.formLeadReview\.status === "accepted";[\s\S]*?if \(!response\.ok \|\| !lead \|\| !acceptedReview\)[\s\S]*?setAcceptedLead\(lead\);[\s\S]*?await onRetired\(\);[\s\S]*?GET-only queue-refresh recovery action/u,
  );
  assert.doesNotMatch(uiSource, /retireAccepted|Retry retire review|outcome: "accepted"/u);
  assert.match(uiSource, /!loading && intake && queue\.length === 0/u);
  assert.match(uiSource, /await onRetired\(\)/u);
  assert.match(uiSource, /onRetired=\{refreshAfterRetirement\}/u);
  assert.doesNotMatch(uiSource, /queue:\s*current\.queue\.filter/u);
  assert.doesNotMatch(routeSource, /outcome === "accepted"|outcome: "accepted"/u);
  assert.match(routeSource, /outcome !== "dismissed"/u);
  assert.match(routeSource, /findProcessedSubmissions\(/u);
  assert.match(routeSource, /processed\?\.status === "needs-review"/u);
  assert.match(routeSource, /observedPositions/u);
  assert.match(routeSource, /googleFormLeadSubmissionKey\(row\.cells\)/u);
  assert.match(routeSource, /firstSourceRow > 2 && remaining > 0[\s\S]*?readRange\(2, remaining\)/u);
  assert.match(postgresIntakeSource, /ON CONFLICT \(connection_key, spreadsheet_id, submission_key\) DO NOTHING/u);
  assert.match(
    postgresIntakeSource,
    /SET source_row = \$1, updated_at = \$2[\s\S]*?status = 'needs-review'[\s\S]*?updated_at <= \$2/u,
  );
  assert.match(productionSchema, /last_processed_submission_key text NOT NULL/u);
  assert.match(productionSchema, /UNIQUE \(\s*connection_key,\s*spreadsheet_id,\s*submission_key\s*\)/u);
  assert.match(leadRouteSource, /requireOfficeUser\(request, \{ admin: true \}\)/u);
  assert.match(leadRouteSource, /connectionKey: getGoogleRuntimeConfig\(\)\.connectionKey/u);
  assert.match(leadRouteSource, /result\.formLeadReview\?\.replayed !== true/u);
  assert.match(d1LeadSource, /UPDATE google_form_lead_reviews[\s\S]*status = 'needs-review'/u);
  assert.match(d1LeadSource, /INSERT INTO leads[\s\S]*WHERE changes\(\) = 1/u);
  assert.match(postgresLeadSource, /FROM google_form_lead_reviews[\s\S]*FOR UPDATE/u);
  assert.match(postgresLeadSource, /UPDATE google_form_lead_reviews[\s\S]*accepted_lead_id = \$3/u);
  assert.match(postgresLeadSource, /completePostgresCreation\([\s\S]*?value,/u);
  assert.match(postgresIntakeSource, /async dismissReview\(input\)/u);
  assert.match(postgresIntakeSource, /SET status = 'dismissed'/u);
  assert.doesNotMatch(postgresIntakeSource, /retireReview|SET status = 'accepted'/u);
  const leadPostSource = leadRouteSource.slice(leadRouteSource.indexOf("export async function POST"));
  assert.ok(
    leadPostSource.indexOf("requireOfficeUser(request, { admin: true })")
      < leadPostSource.indexOf("await ensureWorkspaceSchema()"),
    "the review admin gate must run before database work",
  );
  assert.match(
    productionComposition,
    /const googleFormLeadIntake = createPostgresGoogleFormLeadIntakeRepository\([\s\S]*?googleFormLeadIntake,/u,
  );
  assert.match(productionSchema, /accepted_lead_id uuid REFERENCES leads \(id\)/u);
  assert.match(checklist, /\*\*Timestamp\*\*, \*\*Name\*\*,\s*\*\*Address\*\*, \*\*Rooms\*\*, \*\*Flooring Type\*\*, \*\*Preferred Contact\*\*/u);
  assert.match(checklist, /do not enable automatic email collection/iu);
  assert.match(checklist, /whose \*\*Name\*\* begins exactly with\s+\*\*FCI TEST — DO NOT USE\*\*/u);
  assert.match(rollout, /Do\s+not enable automatic email collection/iu);
  assert.match(rollout, /Timestamp(?:-plus-| plus a )content hash/iu);
});
