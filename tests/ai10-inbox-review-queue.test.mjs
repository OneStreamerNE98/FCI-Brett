import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const ADMIN_EMAIL = "owner@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const CONNECTION_KEY = "google-workspace";
const SIMULATION_CONNECTION_KEY = "workspace-simulation";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const STALE_CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const STALE_PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const workerEnvironment = {
  NODE_ENV: "test",
  FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
  FCI_ADMIN_EMAILS: ADMIN_EMAIL,
  GOOGLE_INTEGRATION_MODE: "workspace",
  OPENAI_API_KEY: "sk-ai10-review-queue-never-return",
  OPENAI_MODEL: "gpt-ai10-review-queue",
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const vite = await createServer({
  root: rootPath,
  cacheDir: "work/vite-tests/ai10-inbox-review-queue",
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
  server: { middlewareMode: true, hmr: { port: 24831 } },
});

const [route, application] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/inbox-analysis/route.ts"),
  vite.ssrLoadModule("/app/application/assistant/inbox-analysis.ts"),
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

class ReviewQueueDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        project_number TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE gmail_file_archives (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        gmail_message_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE mail_items (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL DEFAULT 'google-workspace',
        gmail_message_id TEXT,
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX mail_items_profile_message_unique
        ON mail_items (connection_key, gmail_message_id);
      CREATE TABLE google_drive_operations (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        operation_key TEXT NOT NULL UNIQUE,
        project_id TEXT,
        status TEXT NOT NULL,
        lease_expires_at INTEGER,
        last_error_code TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY,
        shared_drive_id TEXT,
        client_directory_sheet_id TEXT,
        intake_mailbox TEXT,
        settings_json TEXT,
        updated_by TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
    this.database.prepare(
      "INSERT INTO clients (id, name) VALUES (?, ?)",
    ).run(CLIENT_ID, "Atlas Health");
    this.database.prepare(
      `INSERT INTO projects
         (id, client_id, project_number, name, status, updated_at)
       VALUES (?, ?, 'CF-2026-041', 'Westport Medical Center', 'installation', 20)`,
    ).run(PROJECT_ID, CLIENT_ID);
    this.database.prepare(
      `INSERT INTO workspace_settings
         (id, settings_json, updated_by, updated_at)
       VALUES ('workspace', ?, ?, 1)`,
    ).run(
      JSON.stringify({ aiFeatures: { inboxAnalysis: true } }),
      ADMIN_EMAIL,
    );
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  insertReview({
    id,
    messageId,
    connectionKey = CONNECTION_KEY,
    status = "needs-review",
    subject = "FCI TEST stored review subject",
    sender = "Stored Sender <stored@example.test>",
    clientId = null,
    approvedProjectId = null,
  }) {
    this.database.prepare(
      `INSERT INTO mail_items (
         id, connection_key, gmail_message_id, gmail_thread_id, client_id,
         suggested_project_id, approved_project_id, status, match_reason,
         email_drive_file_id, analysis_payload, party, confidence, content_hash,
         label_definition_version, attempted_label_definition_version,
         subject, sender, received_at, failure_attempts, error_code,
         coverage_complete, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'Review required', NULL, '{}',
                 'prospect', 'medium', ?, ?, NULL, ?, ?, ?, 0, NULL, 1, ?, ?)`,
    ).run(
      id,
      connectionKey,
      messageId,
      `thread-${messageId}`,
      clientId,
      approvedProjectId,
      status,
      "a".repeat(64),
      application.INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
      subject,
      sender,
      Date.parse("2026-07-28T13:00:00.000Z"),
      1_775_000_000_000,
      1_775_000_000_000,
    );
  }

  rows(connectionKey = CONNECTION_KEY) {
    return this.database.prepare(
      "SELECT * FROM mail_items WHERE connection_key = ? ORDER BY gmail_message_id",
    ).all(connectionKey);
  }

  close() {
    this.database.close();
  }
}

function routeRequest(
  email = ADMIN_EMAIL,
  {
    method = "GET",
    body = method === "GET" ? undefined : {},
    origin = "same-origin",
  } = {},
) {
  const url = new URL("/api/v1/inbox-analysis", "https://fci.example.test");
  const request = new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(origin === "none"
        ? {}
        : { origin: origin === "same-origin" ? url.origin : origin }),
      "oai-authenticated-user-email": email,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function summary(id, overrides = {}) {
  return {
    id,
    threadId: `thread-${id}`,
    from: "sender@example.test",
    to: "operations@cherryhillfci.com",
    subject: `CF-2026-041 ${id}`,
    date: "2026-07-28T12:00:00.000Z",
    snippet: `Summary for ${id}`,
    labelIds: ["INBOX"],
    ...overrides,
  };
}

function gmailClient(messages, {
  listUnsubscribe = new Set(),
} = {}) {
  return {
    async listMessages() {
      return {
        messages,
        messageIds: messages.map(({ id }) => id),
        failedMessageIds: [],
        nextPageToken: null,
      };
    },
    async getMessageAnalysisInput(messageId) {
      const message = messages.find(({ id }) => id === messageId);
      if (!message) throw new Error("missing fixture message");
      return {
        summary: message,
        bodyText: `Body for ${messageId}`,
        listUnsubscribe: listUnsubscribe.has(messageId)
          ? "<mailto:unsubscribe@example.test>"
          : null,
      };
    },
  };
}

function providerOutput(messageId) {
  return {
    messageId,
    party: "prospect",
    intents: ["lead"],
    leadFields: {
      company: "FCI TEST — DO NOT USE",
      contactName: "Taylor Example",
      contactEmail: "taylor@example.test",
      contactPhone: "555-0100",
      projectName: "Westport finish update",
      site: "123 Test Street",
      estimatedValue: 25_000,
    },
    referencedProjectIds: [PROJECT_ID],
    confidence: "medium",
    rationale: "The message needs an Administrator's review.",
  };
}

function sweepInput(database, client, provider, overrides = {}) {
  return {
    database,
    environment: workerEnvironment,
    featureEnabled: true,
    actor: ADMIN_EMAIL,
    signal: new AbortController().signal,
    workspace: {
      config: {
        simulation: false,
        connectionKey: CONNECTION_KEY,
      },
      client,
    },
    provider,
    now: () => 1_775_000_000_000,
    ...overrides,
  };
}

test("review queue GET is admin, no-store, snapshot-counted, and network free", async () => {
  const database = new ReviewQueueDatabase();
  const originalDatabase = workerEnvironment.DB;
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  workerEnvironment.DB = database;
  globalThis.fetch = async () => {
    outboundCalls += 1;
    throw new Error("Queue reads must not contact Gmail or OpenAI.");
  };
  database.insertReview({
    id: "mail-live",
    messageId: "gmail-live",
  });
  database.insertReview({
    id: "mail-simulation",
    messageId: "gmail-simulation",
    connectionKey: SIMULATION_CONNECTION_KEY,
  });
  try {
    const denied = await route.GET(routeRequest(OFFICE_EMAIL));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("Cache-Control"), "no-store");

    const response = await route.GET(routeRequest());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      rows: [{
        id: "mail-live",
        subject: "FCI TEST stored review subject",
        sender: "Stored Sender <stored@example.test>",
        receivedAt: Date.parse("2026-07-28T13:00:00.000Z"),
      }],
      totalCount: 1,
    });
    assert.equal(outboundCalls, 0);
  } finally {
    workerEnvironment.DB = originalDatabase;
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("Mark reviewed dismisses an orphaned relationship atomically and failures stay no-store", async () => {
  const database = new ReviewQueueDatabase();
  const originalDatabase = workerEnvironment.DB;
  workerEnvironment.DB = database;
  database.insertReview({
    id: "mail-orphan",
    messageId: "gmail-orphan",
    clientId: STALE_CLIENT_ID,
    approvedProjectId: STALE_PROJECT_ID,
  });
  try {
    const crossOrigin = await route.PATCH(routeRequest(ADMIN_EMAIL, {
      method: "PATCH",
      body: { id: "mail-orphan" },
      origin: "https://attacker.example.test",
    }));
    assert.equal(crossOrigin.status, 403);

    const denied = await route.PATCH(routeRequest(OFFICE_EMAIL, {
      method: "PATCH",
      body: { id: "mail-orphan" },
    }));
    assert.equal(denied.status, 403);
    assert.equal(database.rows()[0].status, "needs-review");

    const prepare = database.prepare.bind(database);
    database.prepare = (sql) => {
      if (/^UPDATE mail_items SET status = 'dismissed'/u.test(sql)) {
        throw new Error("Injected queue update failure");
      }
      return prepare(sql);
    };
    const failedUpdate = await route.PATCH(routeRequest(ADMIN_EMAIL, {
      method: "PATCH",
      body: { id: "mail-orphan" },
    }));
    assert.equal(failedUpdate.status, 500);
    assert.equal(failedUpdate.headers.get("Cache-Control"), "no-store");
    assert.equal(database.rows()[0].status, "needs-review");
    database.prepare = prepare;

    const response = await route.PATCH(routeRequest(ADMIN_EMAIL, {
      method: "PATCH",
      body: { id: "mail-orphan" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      id: "mail-orphan",
      status: "dismissed",
    });
    assert.equal(database.rows()[0].status, "dismissed");
    assert.equal(database.rows()[0].client_id, STALE_CLIENT_ID);
    assert.equal(database.rows()[0].approved_project_id, STALE_PROJECT_ID);

    const repeated = await route.PATCH(routeRequest(ADMIN_EMAIL, {
      method: "PATCH",
      body: { id: "mail-orphan" },
    }));
    assert.equal(repeated.status, 404);
    assert.equal(repeated.headers.get("Cache-Control"), "no-store");

    database.prepare = (sql) => {
      if (/COUNT\(\*\) OVER/u.test(sql)) {
        throw new Error("Injected queue read failure");
      }
      return prepare(sql);
    };
    const failedRead = await route.GET(routeRequest());
    assert.equal(failedRead.status, 500);
    assert.equal(failedRead.headers.get("Cache-Control"), "no-store");
  } finally {
    workerEnvironment.DB = originalDatabase;
    database.close();
  }
});

test("one sweep schedules exactly one coalesced notification naming the newest arrival", async () => {
  const database = new ReviewQueueDatabase();
  const reviewOne = summary("gmail-review-one", {
    date: "2026-07-28T09:00:00.000Z",
  });
  const reviewTwo = summary("gmail-review-two", {
    date: "2026-07-28T11:00:00.000Z",
  });
  const noise = summary("gmail-noise", { subject: "Vendor newsletter" });
  const failed = summary("gmail-failed");
  const messages = [reviewOne, reviewTwo, noise, failed];
  const client = gmailClient(messages, {
    listUnsubscribe: new Set([noise.id]),
  });
  const providerCalls = [];

  const provider = {
    async complete(request) {
      const messageId = request.output.schema.properties.messageId.enum[0];
      providerCalls.push(messageId);
      if (messageId === failed.id) {
        throw new Error("Injected provider failure");
      }
      return { kind: "output", value: providerOutput(messageId) };
    },
  };
  const notifications = [];
  const input = () => sweepInput(database, client, provider, {
    onNeedsReviewBatch(notification) {
      notifications.push(notification);
      return new Promise(() => {});
    },
  });
  try {
    await route.runInboxAnalysisSweep(input());
    assert.deepEqual(notifications, [
      {
        gmailMessageId: reviewTwo.id,
        subject: `${reviewTwo.subject} · plus 1 more need review`,
        count: 2,
      },
    ], "two arrivals share one card that names the newest subject");
    assert.deepEqual(
      database.rows().map(({ gmail_message_id, status }) => [
        gmail_message_id,
        status,
      ]),
      [
        [failed.id, "failed"],
        [noise.id, "skipped-noise"],
        [reviewOne.id, "needs-review"],
        [reviewTwo.id, "needs-review"],
      ],
    );

    const callsAfterFirstSweep = providerCalls.length;
    await route.runInboxAnalysisSweep(input());
    assert.equal(
      providerCalls.filter((id) => id === reviewOne.id || id === reviewTwo.id).length,
      2,
      "reload must not call the provider for analyzed review rows",
    );
    assert.ok(providerCalls.length >= callsAfterFirstSweep);
    assert.equal(notifications.length, 1, "reload must not schedule duplicate events");

    database.database.prepare(
      "UPDATE mail_items SET label_definition_version = 'old-catalog' WHERE status = 'needs-review'",
    ).run();
    await route.runInboxAnalysisSweep(input());
    assert.equal(
      providerCalls.filter((id) => id === reviewOne.id || id === reviewTwo.id).length,
      4,
      "catalog widening may re-analyze both review rows",
    );
    assert.equal(
      notifications.length,
      1,
      "catalog re-analysis refreshes rows already in review and schedules nothing",
    );

  } finally {
    database.close();
  }
});

test("a failed row schedules its card when it later enters review", async () => {
  // The bootstrap sweep manufactures failed rows in bulk (deadline, abort,
  // Gmail read, daily cap), so gating the card on a row's first insert alone
  // would silently drop every one of those recoveries.
  const database = new ReviewQueueDatabase();
  const message = summary("gmail-recovers");
  const client = gmailClient([message]);
  let recovers = false;
  const provider = {
    async complete(request) {
      if (!recovers) throw new Error("Injected provider failure");
      const messageId = request.output.schema.properties.messageId.enum[0];
      return { kind: "output", value: providerOutput(messageId) };
    },
  };
  const notifications = [];
  const input = () => sweepInput(database, client, provider, {
    onNeedsReviewBatch(notification) {
      notifications.push(notification);
    },
  });
  try {
    await route.runInboxAnalysisSweep(input());
    assert.equal(database.rows()[0].status, "failed");
    assert.deepEqual(notifications, [], "a failed row owes no card");

    recovers = true;
    await route.runInboxAnalysisSweep(input());
    assert.equal(database.rows()[0].status, "needs-review");
    assert.deepEqual(notifications, [
      {
        gmailMessageId: message.id,
        subject: message.subject,
        count: 1,
      },
    ], "the recovery is an arrival and schedules exactly one card");
  } finally {
    database.close();
  }
});

test("filing a message retires its review row inside the lease-guarded batch", async () => {
  // Review-bot P1 (PR #238): filing is the decision the queue waits on, but a
  // row already in `needs-review` is never re-swept, so nothing except the
  // filing route can retire it. Without this the filed message stays in the
  // queue and inflates its count forever.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL(
      "app/api/v1/integrations/google/gmail/messages/[messageId]/file/route.ts",
      root,
    ),
    "utf8",
  );
  const batch = source.indexOf("const finalResults = await env.DB.batch([");
  assert.ok(batch >= 0);
  const archiveUpdate = source.indexOf(
    "UPDATE gmail_file_archives SET status = 'filed'",
    batch,
  );
  const mailItemUpdate = source.indexOf("UPDATE mail_items SET status = 'accepted'", batch);
  const activityInsert = source.indexOf("INSERT INTO activity_events", batch);
  assert.ok(
    archiveUpdate > batch
      && mailItemUpdate > archiveUpdate
      && activityInsert > mailItemUpdate,
    "the review-row transition belongs in the same batch as the archive commit",
  );
  const statement = source.slice(mailItemUpdate, mailItemUpdate + 400);
  assert.match(statement, /approved_project_id = \?/u);
  // A terminal row carrying retry state violates the v12 failure-state CHECK on
  // PostgreSQL and is rejected by normalizeStoredMailItem on read, so every
  // later sweep would throw on this message (review-bot P1, second round).
  assert.match(statement, /attempted_label_definition_version = NULL/u);
  assert.match(statement, /failure_attempts = 0/u);
  assert.match(statement, /error_code = NULL/u);
  assert.match(statement, /WHERE connection_key = \? AND gmail_message_id = \?/u);
  // Terminal rows are never resurrected, and the lease guard keeps a lost lease
  // from retiring somebody else's review row.
  assert.match(statement, /status IN \('needs-review', 'failed'\)/u);
  assert.match(statement, /AND \$\{FILING_LEASE_EXISTS\}/u);
  assert.doesNotMatch(statement, /INSERT INTO mail_items/u);
});
