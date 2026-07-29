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

test("a message filed while its analysis is in flight never lands in the queue", async () => {
  // Review-bot P1 (PR #238, round three): the pre-filter's isAlreadyFiled runs
  // before the Gmail read and the provider call, so filing can commit while the
  // analysis is outstanding. The filing batch updates zero rows because no row
  // exists yet, and a current needs-review row is never re-swept — so without a
  // post-write re-check the filed message sits in the queue forever.
  const database = new ReviewQueueDatabase();
  const message = summary("gmail-filed-midflight");
  const client = gmailClient([message]);
  const notifications = [];
  const provider = {
    async complete(request) {
      const messageId = request.output.schema.properties.messageId.enum[0];
      database.database.prepare(
        `INSERT INTO gmail_file_archives (id, connection_key, gmail_message_id, status)
         VALUES (?, ?, ?, 'filed')`,
      ).run("archive-midflight", CONNECTION_KEY, message.id);
      return { kind: "output", value: providerOutput(messageId) };
    },
  };
  try {
    await route.runInboxAnalysisSweep(sweepInput(database, client, provider, {
      onNeedsReviewBatch(notification) {
        notifications.push(notification);
      },
    }));
    const rows = database.rows();
    assert.equal(rows.length, 1, "the swept message still owes exactly one row");
    assert.equal(rows[0].status, "skipped-noise");
    assert.deepEqual(notifications, [], "a filed message owes no review card");
  } finally {
    database.close();
  }
});

test("a row filed after its analysis but before the sweep ends raises no card", async () => {
  // Review-bot P2 (PR #238): arrivals accumulate as workers finish, but the
  // coalesced card is emitted once at the end of the sweep. Filing can retire a
  // row in that gap, and the card must not describe a message that has already
  // left the queue — nor over-count the ones that remain.
  const database = new ReviewQueueDatabase();
  const filedLater = summary("gmail-filed-after-analysis", {
    date: "2026-07-28T11:00:00.000Z",
  });
  const staysPending = summary("gmail-stays-pending", {
    date: "2026-07-28T09:00:00.000Z",
  });
  const client = gmailClient([filedLater, staysPending]);
  const notifications = [];
  const provider = {
    async complete(request) {
      const messageId = request.output.schema.properties.messageId.enum[0];
      if (messageId === staysPending.id) {
        // Both messages are analyzed concurrently. Wait until the other row is
        // durable, then retire it exactly as the filing route's guarded batch
        // would — landing inside the window between its write and the emit.
        for (let attempt = 0; attempt < 500; attempt += 1) {
          const stored = database.database.prepare(
            "SELECT status FROM mail_items WHERE gmail_message_id = ?",
          ).get(filedLater.id);
          if (stored) {
            database.database.prepare(
              `UPDATE mail_items SET status = 'accepted', approved_project_id = ?,
                 attempted_label_definition_version = NULL, failure_attempts = 0,
                 error_code = NULL
               WHERE connection_key = ? AND gmail_message_id = ?`,
            ).run(PROJECT_ID, CONNECTION_KEY, filedLater.id);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      return { kind: "output", value: providerOutput(messageId) };
    },
  };
  try {
    await route.runInboxAnalysisSweep(sweepInput(database, client, provider, {
      onNeedsReviewBatch(notification) {
        notifications.push(notification);
      },
    }));
    assert.equal(
      database.rows().find(({ gmail_message_id }) =>
        gmail_message_id === filedLater.id
      ).status,
      "accepted",
      "the filed row really was retired before the emit",
    );
    assert.deepEqual(notifications, [
      {
        gmailMessageId: staysPending.id,
        subject: staysPending.subject,
        count: 1,
      },
    ], "the card names only the arrival still owed a decision");
  } finally {
    database.close();
  }
});

test("a transient filed-state read error still counts the arrival", async () => {
  // Review-bot P2 (PR #238): the post-write filed-state re-check runs after the
  // analysis is durably committed. If that read fails transiently the row is
  // still a genuine review arrival, so returning early would silently drop its
  // card. The emit-time re-read verifies the row again before anything is sent.
  const database = new ReviewQueueDatabase();
  const message = summary("gmail-filed-read-error");
  const client = gmailClient([message]);
  const notifications = [];
  const provider = {
    async complete(request) {
      const messageId = request.output.schema.properties.messageId.enum[0];
      return { kind: "output", value: providerOutput(messageId) };
    },
  };
  const realPrepare = database.prepare.bind(database);
  let archiveReads = 0;
  database.prepare = (sql) => {
    // Count only the isAlreadyFiled probes, not the sweep's reconciliation
    // statement, which also names the archive table in a subquery.
    if (sql.trim().startsWith("SELECT id") && sql.includes("gmail_file_archives")) {
      archiveReads += 1;
      // Fail only the post-write re-check, not the pre-filter.
      if (archiveReads > 1) throw new Error("Injected archive read failure.");
    }
    return realPrepare(sql);
  };
  try {
    await route.runInboxAnalysisSweep(sweepInput(database, client, provider, {
      onNeedsReviewBatch(notification) {
        notifications.push(notification);
      },
    }));
    assert.equal(database.rows()[0].status, "needs-review");
    assert.deepEqual(notifications, [
      { gmailMessageId: message.id, subject: message.subject, count: 1 },
    ], "an unknown filed state must not silence a real arrival");
  } finally {
    database.prepare = realPrepare;
    database.close();
  }
});

test("a failed retirement leaves the row retryable rather than stranded", async () => {
  // Review-bot P2 (PR #238): a needs-review row is never re-swept, so if the
  // retire write fails after the message was filed, leaving it as-is strands it
  // exactly like the defect the re-check exists to prevent. It must be demoted
  // to a retryable failure so the next sweep can retire it properly.
  const database = new ReviewQueueDatabase();
  const message = summary("gmail-retire-write-fails");
  const client = gmailClient([message]);
  const notifications = [];
  const provider = {
    async complete(request) {
      const messageId = request.output.schema.properties.messageId.enum[0];
      database.database.prepare(
        `INSERT INTO gmail_file_archives (id, connection_key, gmail_message_id, status)
         VALUES (?, ?, ?, 'filed')`,
      ).run("archive-retire-fail", CONNECTION_KEY, message.id);
      return { kind: "output", value: providerOutput(messageId) };
    },
  };
  const realPrepare = database.prepare.bind(database);
  let mailItemWrites = 0;
  database.prepare = (sql) => {
    if (sql.includes("INSERT INTO mail_items")) {
      mailItemWrites += 1;
      // Let the analysis commit, then fail the retirement write only.
      if (mailItemWrites === 2) throw new Error("Injected retirement write failure.");
    }
    return realPrepare(sql);
  };
  try {
    await route.runInboxAnalysisSweep(sweepInput(database, client, provider, {
      onNeedsReviewBatch(notification) {
        notifications.push(notification);
      },
    }));
    const row = database.rows()[0];
    assert.equal(row.status, "failed", "a stranded needs-review row is the bug");
    assert.equal(row.error_code, "analysis_retire_failed");
    assert.ok(
      row.failure_attempts >= 1 && row.failure_attempts < 3,
      "the row must remain inside its retry budget",
    );
    assert.deepEqual(notifications, [], "a filed message still owes no card");
  } finally {
    database.prepare = realPrepare;
    database.close();
  }
});

test("an archive-confirmed row is retired at emit, not merely silenced", async () => {
  // Review-bot P2 (PR #238): if the post-write archive read fails but the
  // emit-time read succeeds, suppressing only the card would leave a filed
  // message sitting in the queue. The emit retires it as well.
  const database = new ReviewQueueDatabase();
  const message = summary("gmail-emit-retire");
  const client = gmailClient([message]);
  const notifications = [];
  const provider = {
    async complete(request) {
      const messageId = request.output.schema.properties.messageId.enum[0];
      database.database.prepare(
        `INSERT INTO gmail_file_archives (id, connection_key, gmail_message_id, status)
         VALUES (?, ?, ?, 'filed')`,
      ).run("archive-emit-retire", CONNECTION_KEY, message.id);
      return { kind: "output", value: providerOutput(messageId) };
    },
  };
  const realPrepare = database.prepare.bind(database);
  let archiveReads = 0;
  database.prepare = (sql) => {
    // Count only the isAlreadyFiled probes, not the sweep's reconciliation
    // statement, which also names the archive table in a subquery.
    if (sql.trim().startsWith("SELECT id") && sql.includes("gmail_file_archives")) {
      archiveReads += 1;
      // Fail the post-write re-check only; the emit-time read succeeds.
      if (archiveReads === 2) throw new Error("Injected archive read failure.");
    }
    return realPrepare(sql);
  };
  try {
    await route.runInboxAnalysisSweep(sweepInput(database, client, provider, {
      onNeedsReviewBatch(notification) {
        notifications.push(notification);
      },
    }));
    assert.deepEqual(notifications, [], "a filed message owes no card");
    assert.equal(
      database.rows()[0].status,
      "skipped-noise",
      "a filed message must not be left sitting in the queue",
    );
  } finally {
    database.prepare = realPrepare;
    database.close();
  }
});

test("a sweep reconciles any review row whose message was already filed", async () => {
  // The structural close of a class the per-item compensations could not
  // guarantee: a needs-review row is never re-queued, so ANY retirement that
  // failed mid-flight — racing filing, transient write, failed fallback —
  // stranded its message in the queue forever. This row stands for every one of
  // those interleavings: whatever failed last time, the next sweep retires it.
  const database = new ReviewQueueDatabase();
  try {
    database.insertReview({ id: "stranded-row", messageId: "gmail-stranded" });
    database.database.prepare(
      `INSERT INTO gmail_file_archives (id, connection_key, gmail_message_id, status)
       VALUES (?, ?, ?, 'filed')`,
    ).run("archive-stranded", CONNECTION_KEY, "gmail-stranded");
    assert.equal(database.rows()[0].status, "needs-review");

    const client = gmailClient([]);
    const provider = {
      async complete() {
        throw new Error("Reconciliation must not need the provider.");
      },
    };
    await route.runInboxAnalysisSweep(sweepInput(database, client, provider));

    const row = database.rows()[0];
    assert.equal(
      row.status,
      "skipped-noise",
      "a filed message must be out of the queue by the next sweep",
    );
    assert.equal(row.failure_attempts, 0);
    assert.equal(row.error_code, null);
  } finally {
    database.close();
  }
});
