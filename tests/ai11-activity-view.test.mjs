import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const ADMIN_EMAIL = "owner@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const CONNECTION_KEY = "google-workspace";
const workerEnvironment = {
  NODE_ENV: "test",
  FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
  FCI_ADMIN_EMAILS: ADMIN_EMAIL,
  GOOGLE_INTEGRATION_MODE: "workspace",
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/ai11-activity-view",
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
  server: { middlewareMode: true, hmr: { port: 24838 } },
});

const [activityRoute, queueRoute, analysisApplication] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/inbox-analysis/activity/route.ts"),
  vite.ssrLoadModule("/app/api/v1/inbox-analysis/route.ts"),
  vite.ssrLoadModule("/app/application/assistant/inbox-analysis.ts"),
]);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

class SqliteD1Statement {
  constructor(statement, observeBindCount) {
    this.statement = statement;
    this.observeBindCount = observeBindCount;
    this.values = [];
  }

  bind(...values) {
    this.observeBindCount(values.length);
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

class ActivityDatabase {
  constructor() {
    this.maxBindCount = 0;
    this.database = new DatabaseSync(":memory:");
    this.database.exec(`
      CREATE TABLE mail_items (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        gmail_message_id TEXT NOT NULL,
        gmail_thread_id TEXT,
        client_id TEXT,
        suggested_project_id TEXT,
        approved_project_id TEXT,
        status TEXT NOT NULL,
        match_reason TEXT,
        email_drive_file_id TEXT,
        analysis_payload TEXT,
        party TEXT,
        confidence TEXT,
        content_hash TEXT,
        label_definition_version TEXT,
        attempted_label_definition_version TEXT,
        subject TEXT,
        sender TEXT,
        received_at INTEGER,
        failure_attempts INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        coverage_complete INTEGER NOT NULL DEFAULT 0,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        accepted_intent TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX mail_items_profile_message_unique
        ON mail_items (connection_key, gmail_message_id);
      CREATE TABLE assistant_label_definitions (
        slug TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        retired INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const insertLabel = this.database.prepare(
      "INSERT INTO assistant_label_definitions (slug, description, retired, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
    );
    for (const definition of analysisApplication.INBOX_ANALYSIS_LABEL_DEFINITIONS) {
      insertLabel.run(definition.slug, definition.description, 0);
    }
    insertLabel.run("historic_custom", "A saved custom category used by older reviews.", 1);
  }

  prepare(sql) {
    return new SqliteD1Statement(
      this.database.prepare(sql),
      (count) => {
        this.maxBindCount = Math.max(this.maxBindCount, count);
      },
    );
  }

  insertActivity({
    id,
    status = "accepted",
    intents = ["lead"],
    analysisPayload = { intents },
    reviewedBy = ADMIN_EMAIL,
    reviewedAt = 1_775_000_000_000,
    acceptedIntent = status === "accepted" ? "lead" : null,
    confidence = "medium",
    matchReason = "The saved message was reviewed by a person.",
    labelDefinitionVersion = "earlier-label-set",
    updatedAt = reviewedAt ?? 1_775_000_000_000,
  }) {
    this.database.prepare(`INSERT INTO mail_items (
      id, connection_key, gmail_message_id, gmail_thread_id, client_id,
      suggested_project_id, approved_project_id, status, match_reason,
      email_drive_file_id, analysis_payload, party, confidence, content_hash,
      label_definition_version, attempted_label_definition_version, subject,
      sender, received_at, failure_attempts, error_code, coverage_complete,
      reviewed_by, reviewed_at, accepted_intent, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, ?, 'prospect', ?, NULL,
      ?, NULL, ?, ?, ?, 0, NULL, 0, ?, ?, ?, ?, ?)`)
      .run(
        id,
        CONNECTION_KEY,
        `gmail-${id}`,
        status,
        matchReason,
        JSON.stringify(analysisPayload),
        confidence,
        labelDefinitionVersion,
        `FCI TEST — DO NOT USE ${id}`,
        `Sender ${id} <sender@example.test>`,
        updatedAt - 1_000,
        reviewedBy,
        reviewedAt,
        acceptedIntent,
        updatedAt - 2_000,
        updatedAt,
      );
  }

  row(id) {
    return this.database.prepare("SELECT * FROM mail_items WHERE id = ?").get(id);
  }

  insertRetiredLabel(slug) {
    this.database.prepare(
      "INSERT INTO assistant_label_definitions (slug, description, retired, created_at, updated_at) VALUES (?, ?, 1, 1, 1)",
    ).run(slug, `Historic category ${slug}`);
  }

  close() {
    this.database.close();
  }
}

function request(email = ADMIN_EMAIL, method = "GET", body = undefined) {
  const url = new URL("/api/v1/inbox-analysis/activity", "https://fci.example.test");
  const value = new Request(url, {
    method,
    headers: {
      "oai-authenticated-user-email": email,
      ...(method === "GET" ? {} : {
        origin: url.origin,
        "content-type": "application/json",
      }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(value, "nextUrl", { value: url });
  return value;
}

test("activity GET enforces admin authorization before database work", async () => {
  let databaseCalls = 0;
  const originalDatabase = workerEnvironment.DB;
  workerEnvironment.DB = {
    prepare() {
      databaseCalls += 1;
      throw new Error("database must not be reached");
    },
  };
  try {
    const denied = await activityRoute.GET(request(OFFICE_EMAIL));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("Cache-Control"), "no-store");
    assert.equal(databaseCalls, 0);
  } finally {
    workerEnvironment.DB = originalDatabase;
  }
});

test("activity GET counts the chosen accepted category and each distinct dismissed proposal while keeping degraded and unattributed history visible with zero provider calls", async () => {
  const database = new ActivityDatabase();
  const originalDatabase = workerEnvironment.DB;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  workerEnvironment.DB = database;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Activity reads must not contact a provider.");
  };
  const currentVersion = analysisApplication.inboxAnalysisLabelDefinitionVersion(
    analysisApplication.INBOX_ANALYSIS_LABEL_DEFINITIONS,
  );
  database.insertActivity({
    id: "accepted-multi",
    intents: ["lead", "schedule"],
    acceptedIntent: "schedule",
    labelDefinitionVersion: currentVersion,
    updatedAt: 1_775_000_004_000,
  });
  database.insertActivity({
    id: "dismissed-multi",
    status: "dismissed",
    intents: ["lead", "schedule", "schedule"],
    acceptedIntent: null,
    updatedAt: 1_775_000_003_000,
  });
  database.insertActivity({
    id: "legacy-unattributed",
    acceptedIntent: "lead",
    reviewedBy: null,
    reviewedAt: null,
    labelDefinitionVersion: null,
    updatedAt: 1_775_000_002_000,
  });
  database.insertActivity({
    id: "unknown-category",
    intents: ["removed_label"],
    acceptedIntent: "removed_label",
    updatedAt: 1_775_000_001_000,
  });
  database.insertActivity({
    id: "malformed-analysis",
    analysisPayload: { intents: "lead" },
    acceptedIntent: "lead",
    updatedAt: 1_775_000_000_000,
  });
  database.insertActivity({
    id: "malformed-dismissed-analysis",
    status: "dismissed",
    analysisPayload: { intents: "lead" },
    acceptedIntent: null,
    updatedAt: 1_774_999_999_000,
  });

  try {
    const response = await activityRoute.GET(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.totalCount, 6);
    assert.equal(payload.pageLimit, 100);
    assert.deepEqual(payload.rows.map(({ id }) => id), [
      "accepted-multi",
      "dismissed-multi",
      "legacy-unattributed",
      "unknown-category",
      "malformed-analysis",
      "malformed-dismissed-analysis",
    ]);
    assert.equal(payload.rows[0].analysis.state, "available");
    assert.equal(payload.rows[0].labelSetState, "current");
    assert.equal(payload.rows[1].analysis.state, "degraded");
    assert.equal(payload.rows[2].attributionState, "not-recorded");
    assert.equal(payload.rows[2].reviewedBy, null);
    assert.equal(payload.rows[2].labelSetState, "not-recorded");
    assert.equal(payload.rows[3].acceptedIntentAvailable, false);
    assert.equal(payload.rows[3].analysis.state, "degraded");
    assert.equal(payload.rows[4].analysis.state, "degraded");
    assert.equal(payload.rows[5].analysis.state, "degraded");
    assert.equal(providerCalls, 0);

    const counts = Object.fromEntries(payload.counts.map((count) => [count.slug, count]));
    assert.deepEqual(counts.lead, {
      slug: "lead",
      acceptedCount: 1,
      dismissedCount: 1,
    });
    assert.deepEqual(counts.schedule, {
      slug: "schedule",
      acceptedCount: 1,
      dismissedCount: 1,
    });
    assert.equal(counts["project-update"].acceptedCount, 0);
    assert.equal(counts.historic_custom.acceptedCount, 0);
  } finally {
    workerEnvironment.DB = originalDatabase;
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("activity GET counts across the full 100-row active-plus-retired catalog with three D1 binds", async () => {
  const database = new ActivityDatabase();
  const originalDatabase = workerEnvironment.DB;
  workerEnvironment.DB = database;
  for (let index = 0; index < 95; index += 1) {
    database.insertRetiredLabel(`historic_${String(index).padStart(2, "0")}`);
  }
  try {
    const response = await activityRoute.GET(request());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.labels.length, 100);
    assert.equal(payload.counts.length, 100);
    assert.equal(database.maxBindCount, 3);
    assert.deepEqual(payload.counts.find(({ slug }) => slug === "historic_94"), {
      slug: "historic_94",
      acceptedCount: 0,
      dismissedCount: 0,
    });
  } finally {
    workerEnvironment.DB = originalDatabase;
    database.close();
  }
});

test("activity GET bounds the page at 100 while counts cover terminal rows beyond it", async () => {
  const database = new ActivityDatabase();
  const originalDatabase = workerEnvironment.DB;
  workerEnvironment.DB = database;
  for (let index = 0; index < 101; index += 1) {
    database.insertActivity({
      id: `bounded-${String(index).padStart(3, "0")}`,
      updatedAt: 1_775_100_000_000 + index,
    });
  }
  try {
    const response = await activityRoute.GET(request());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.rows.length, 100);
    assert.equal(payload.totalCount, 101);
    assert.equal(payload.rows[0].id, "bounded-100");
    assert.equal(
      payload.counts.find(({ slug }) => slug === "lead").acceptedCount,
      101,
    );
  } finally {
    workerEnvironment.DB = originalDatabase;
    database.close();
  }
});

test("activity GET returns an honest empty payload", async () => {
  const database = new ActivityDatabase();
  const originalDatabase = workerEnvironment.DB;
  workerEnvironment.DB = database;
  try {
    const response = await activityRoute.GET(request());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.rows, []);
    assert.equal(payload.totalCount, 0);
    assert.equal(payload.counts.every((count) =>
      count.acceptedCount === 0 && count.dismissedCount === 0
    ), true);
  } finally {
    workerEnvironment.DB = originalDatabase;
    database.close();
  }
});

test("accepted lead PATCH derives the label server-side while manual dismissal stores none", async () => {
  const database = new ActivityDatabase();
  const originalDatabase = workerEnvironment.DB;
  workerEnvironment.DB = database;
  database.insertActivity({
    id: "lead-accept",
    status: "needs-review",
    acceptedIntent: null,
    reviewedBy: null,
    reviewedAt: null,
  });
  database.insertActivity({
    id: "manual-dismiss",
    status: "needs-review",
    acceptedIntent: null,
    reviewedBy: null,
    reviewedAt: null,
  });
  database.insertActivity({
    id: "scalar-intent-accept",
    status: "needs-review",
    analysisPayload: { intents: "lead" },
    acceptedIntent: null,
    reviewedBy: null,
    reviewedAt: null,
  });
  try {
    const accepted = await queueRoute.PATCH(request(ADMIN_EMAIL, "PATCH", {
      id: "lead-accept",
      outcome: "accepted",
    }));
    assert.equal(accepted.status, 200);
    assert.equal(database.row("lead-accept").accepted_intent, "lead");
    assert.equal(database.row("lead-accept").reviewed_by, ADMIN_EMAIL);
    assert.equal(typeof database.row("lead-accept").reviewed_at, "number");

    const dismissed = await queueRoute.PATCH(request(ADMIN_EMAIL, "PATCH", {
      id: "manual-dismiss",
      outcome: "dismissed",
    }));
    assert.equal(dismissed.status, 200);
    assert.equal(database.row("manual-dismiss").accepted_intent, null);
    assert.equal(database.row("manual-dismiss").reviewed_by, ADMIN_EMAIL);

    const rejectedScalar = await queueRoute.PATCH(request(ADMIN_EMAIL, "PATCH", {
      id: "scalar-intent-accept",
      outcome: "accepted",
    }));
    assert.equal(rejectedScalar.status, 404);
    assert.equal(database.row("scalar-intent-accept").status, "needs-review");
    assert.equal(database.row("scalar-intent-accept").reviewed_by, null);
  } finally {
    workerEnvironment.DB = originalDatabase;
    database.close();
  }
});
