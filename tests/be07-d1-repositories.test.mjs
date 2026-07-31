import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const MAIL_CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const MAIL_SUGGESTED_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const MAIL_APPROVED_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-be07-d1-repositories", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24744 } },
});

const [
  workspaceModule,
  userModule,
  filingModule,
  mailModule,
  mailDomain,
  workspaceDomain,
  workspaceRoute,
  filingRoute,
  filingItemRoute,
  googleWorkspace,
] =
  await Promise.all([
    vite.ssrLoadModule("/app/adapters/d1/workspace-settings-repository.ts"),
    vite.ssrLoadModule("/app/adapters/d1/user-preferences-repository.ts"),
    vite.ssrLoadModule("/app/adapters/d1/filing-rule-repository.ts"),
    vite.ssrLoadModule("/app/adapters/d1/mail-item-repository.ts"),
    vite.ssrLoadModule("/app/domain/mail-item.ts"),
    vite.ssrLoadModule("/app/domain/workspace-settings.ts"),
    vite.ssrLoadModule("/app/api/v1/settings/workspace/route.ts"),
    vite.ssrLoadModule("/app/api/v1/filing-rules/route.ts"),
    vite.ssrLoadModule("/app/api/v1/filing-rules/[ruleId]/route.ts"),
    vite.ssrLoadModule("/app/lib/google-workspace.ts"),
  ]);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  first() {
    return Promise.resolve(this.database.first(this));
  }

  all() {
    return Promise.resolve({ results: this.database.all(this) });
  }

  run() {
    this.database.runs.push(this);
    return Promise.resolve({ meta: { changes: this.database.run(this) } });
  }
}

class FakeDatabase {
  constructor({ first = () => null, all = () => [], run = () => 1 } = {}) {
    this.first = first;
    this.all = all;
    this.run = run;
    this.statements = [];
    this.runs = [];
  }

  prepare(sql) {
    const statement = new FakeStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  batch() {
    throw new Error("BE-07 repositories must use their explicit statement operation.");
  }
}

function setEnvironment(database) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    DB: database,
  });
}

function routeRequest(path, email, method = "GET", body, origin = "https://fci.example.test") {
  const url = new URL(path, origin);
  const request = new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: url.origin, "content-type": "application/json" }),
      ...(email ? { "oai-authenticated-user-email": email } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("workspace settings use one safe normalizer and atomic JSON merges preserve scalar resource columns", async () => {
  const database = new FakeDatabase({
    first(statement) {
      assert.match(statement.sql, /FROM workspace_settings WHERE id = \?/u);
      assert.deepEqual(statement.values, ["workspace"]);
      return {
        id: "workspace",
        shared_drive_id: "saved-drive",
        client_directory_sheet_id: "saved-sheet",
        intake_mailbox: "ops@example.test",
        settings_json: JSON.stringify({
          timezone: " America/Chicago ",
          appointmentCalendarId: " saved-client-calendar ",
          fieldCalendarId: "saved-field-calendar",
          appointmentReminderHours: 12,
        }),
        updated_by: "admin@example.test",
        updated_at: 1_790_000_000_000,
      };
    },
  });
  const repository = workspaceModule.createD1WorkspaceSettingsRepository(database);
  const record = await repository.findById("workspace");
  assert.equal(record.clientDirectorySheetId, "saved-sheet");
  assert.equal(record.settings.appointmentCalendarId, " saved-client-calendar ");
  const widenedPreferences = workspaceDomain.normalizeWorkspacePreferences(record.settings);
  assert.deepEqual(widenedPreferences, {
    ...workspaceDomain.DEFAULT_WORKSPACE_PREFERENCES,
    timezone: "America/Chicago",
    appointmentCalendarId: "saved-client-calendar",
    fieldCalendarId: "saved-field-calendar",
    appointmentReminderHours: 12,
  });
  assert.equal(
    widenedPreferences.clientReminderHours,
    24,
    "an older row must widen with the client-reminder default rather than copying appointment hours",
  );
  assert.deepEqual(
    workspaceDomain.normalizeWorkspacePreferences(
      workspaceDomain.parseWorkspaceSettingsDocument("{not-json"),
    ),
    workspaceDomain.DEFAULT_WORKSPACE_PREFERENCES,
  );

  await repository.mergeSettings({
    id: "workspace",
    settings: record.settings,
    updatedBy: "next-admin@example.test",
    updatedAt: 1_790_000_000_001,
  });
  const write = database.statements.at(-1);
  assert.match(write.sql, /^INSERT INTO workspace_settings/u);
  assert.match(write.sql, /settings_json = json_patch\(/u);
  assert.match(write.sql, /json_remove\(/u);
  assert.doesNotMatch(write.sql, /settings_json = excluded\.settings_json/u);
  assert.doesNotMatch(
    write.sql,
    /DO UPDATE SET[^]*?(?:shared_drive_id|client_directory_sheet_id|intake_mailbox)\s*=/u,
  );
  assert.deepEqual(write.values.slice(0, 1), ["workspace"]);
});

test("user preferences stay keyed to one email and preserve every persisted preference column", async () => {
  const database = new FakeDatabase({
    first(statement) {
      assert.match(statement.sql, /WHERE user_email = \?/u);
      assert.deepEqual(statement.values, ["office@example.test"]);
      return {
        user_email: "office@example.test",
        display_timezone: "America/Denver",
        reply_signature: "Office",
        notification_preferences_json: '{"lead.created":true}',
        page_layouts_json: '{"overview":{"order":[],"hidden":[]}}',
        updated_at: 12,
      };
    },
  });
  const repository = userModule.createD1UserPreferencesRepository(database);
  const record = await repository.findByEmail("office@example.test");
  assert.deepEqual(record, {
    userEmail: "office@example.test",
    displayTimezone: "America/Denver",
    replySignature: "Office",
    notificationPreferencesJson: '{"lead.created":true}',
    pageLayoutsJson: '{"overview":{"order":[],"hidden":[]}}',
    updatedAt: 12,
  });

  await repository.upsert({ ...record, replySignature: "Updated", updatedAt: 13 });
  const write = database.statements.at(-1);
  assert.match(write.sql, /^INSERT INTO user_preferences/u);
  assert.deepEqual(write.values, [
    "office@example.test",
    "America/Denver",
    "Updated",
    '{"lead.created":true}',
    '{"overview":{"order":[],"hidden":[]}}',
    13,
  ]);
});

test("filing-rule D1 CRUD keeps camel-case API values and review-first approval writes", async () => {
  const database = new FakeDatabase({
    all() {
      return [{
        id: "rule-1",
        name: "Estimator",
        enabled: 1,
        priority: 9,
        match_summary: "Known sender",
        action: "review",
        target_category: "99_Unsorted Intake",
        approval_required: 1,
        created_by: "office@example.test",
        created_at: 10,
        updated_at: 11,
      }];
    },
  });
  const repository = filingModule.createD1FilingRuleRepository(database);
  const [rule] = await repository.list();
  assert.equal(rule.matchSummary, "Known sender");
  assert.equal(rule.targetCategory, "99_Unsorted Intake");
  assert.equal(rule.approvalRequired, true);

  await repository.create({
    id: "rule-2",
    values: {
      name: "Builder",
      enabled: true,
      priority: 10,
      matchSummary: "Builder invite",
      action: "suggest",
      targetCategory: "05_Correspondence / Email Archive",
      approvalRequired: true,
    },
    createdBy: "office@example.test",
    createdAt: 20,
  });
  assert.deepEqual(database.statements.at(-1).values.slice(0, 9), [
    "rule-2",
    "Builder",
    1,
    10,
    "Builder invite",
    "suggest",
    "05_Correspondence / Email Archive",
    1,
    "office@example.test",
  ]);

  assert.equal(await repository.update({
    id: "rule-2",
    values: { enabled: false, priority: 3 },
    updatedAt: 21,
  }), true);
  assert.match(database.statements.at(-1).sql, /SET enabled = \?, priority = \?, updated_at = \?/u);
  assert.deepEqual(database.statements.at(-1).values, [0, 3, 21, "rule-2"]);
  assert.equal(await repository.delete("rule-2"), true);
});

test("mail-item adapter maps nullable relationships, bounds list size, and upserts the full item", async () => {
  const row = {
    id: "mail-1",
    connection_key: "google-workspace",
    gmail_message_id: "message-1",
    gmail_thread_id: null,
    client_id: MAIL_CLIENT_ID,
    suggested_project_id: MAIL_SUGGESTED_PROJECT_ID,
    approved_project_id: null,
    status: "needs-review",
    match_reason: "Known sender",
    email_drive_file_id: null,
    analysis_payload: JSON.stringify({
      intents: ["lead"],
      leadFields: { companyName: "FCI TEST — DO NOT USE" },
    }),
    party: "prospect",
    confidence: "high",
    content_hash: "a".repeat(64),
    label_definition_version: "catalog-2026-07-27",
    subject: "FCI TEST — DO NOT USE flooring request",
    sender: "Prospect <prospect@example.test>",
    received_at: 29,
    failure_attempts: 0,
    error_code: null,
    coverage_complete: 0,
    created_at: 30,
    updated_at: 31,
  };
  const database = new FakeDatabase({
    first(statement) {
      if (/FROM mail_items WHERE id = \?/u.test(statement.sql)) return row;
      if (/FROM mail_items WHERE connection_key = \? AND gmail_message_id = \?/u.test(statement.sql)) return row;
      if (/^SELECT id FROM (?:clients|projects) WHERE id = \?$/u.test(statement.sql)) {
        return { id: statement.values[0] };
      }
      return null;
    },
    all(statement) {
      return /COUNT\(\*\) OVER \(\) AS total_count/u.test(statement.sql)
        ? [{ ...row, total_count: 1 }]
        : [row];
    },
  });
  const repository = mailModule.createD1MailItemRepository(database);
  const item = await repository.findById("mail-1");
  assert.equal(item.gmailMessageId, "message-1");
  assert.equal(item.approvedProjectId, null);
  assert.equal(item.connectionKey, "google-workspace");
  assert.equal(item.coverageComplete, false);
  assert.deepEqual(item.analysisPayload, {
    intents: ["lead"],
    leadFields: { companyName: "FCI TEST — DO NOT USE" },
  });
  assert.equal(Object.isFrozen(item.analysisPayload), true);
  assert.equal(Object.isFrozen(item.analysisPayload.leadFields), true);

  assert.deepEqual(
    await repository.findByGmailMessageId("google-workspace", "message-1"),
    item,
  );
  assert.deepEqual(database.statements.at(-1).values, [
    "google-workspace",
    "message-1",
  ]);

  const listed = await repository.listByStatus(
    "google-workspace",
    "needs-review",
    501,
  );
  assert.equal(listed.length, 1);
  assert.deepEqual(database.statements.at(-1).values, [
    "google-workspace",
    "needs-review",
    100,
  ]);
  const page = await repository.listByStatusPage(
    "google-workspace",
    "needs-review",
    501,
  );
  assert.deepEqual(page.items, [item]);
  assert.equal(page.totalCount, 1);
  assert.deepEqual(database.statements.at(-1).values, [
    "google-workspace",
    "needs-review",
    100,
  ]);

  const result = await repository.upsert({
    ...item,
    approvedProjectId: MAIL_APPROVED_PROJECT_ID,
    updatedAt: 32,
  });
  assert.deepEqual(result, { outcome: "saved" });
  assert.deepEqual(
    database.statements
      .filter((statement) => /^SELECT id FROM (?:clients|projects) WHERE id = \?$/u.test(statement.sql))
      .map((statement) => [statement.sql, statement.values]),
    [
      ["SELECT id FROM clients WHERE id = ?", [MAIL_CLIENT_ID]],
      ["SELECT id FROM projects WHERE id = ?", [MAIL_SUGGESTED_PROJECT_ID]],
      ["SELECT id FROM projects WHERE id = ?", [MAIL_APPROVED_PROJECT_ID]],
    ],
  );
  const write = database.statements.at(-1);
  assert.match(write.sql, /^INSERT INTO mail_items/u);
  assert.match(
    write.sql,
    /ON CONFLICT\(connection_key, gmail_message_id\) DO UPDATE/u,
  );
  assert.doesNotMatch(write.sql.split("DO UPDATE SET")[1], /\bid\s*=/u);
  assert.doesNotMatch(write.sql.split("DO UPDATE SET")[1], /\bcreated_at\s*=/u);
  assert.match(
    write.sql,
    /coverage_complete = mail_items\.coverage_complete OR excluded\.coverage_complete/u,
  );
  assert.equal(write.values[6], MAIL_APPROVED_PROJECT_ID);
  assert.equal(write.values[10], JSON.stringify(item.analysisPayload));
  assert.equal(write.values.at(-1), 32);
  assert.equal(database.runs.length, 1);

  await repository.markCoverageComplete("google-workspace");
  const coverageWrite = database.statements.at(-1);
  assert.equal(
    coverageWrite.sql,
    "UPDATE mail_items SET coverage_complete = 1 WHERE connection_key = ? AND coverage_complete = 0",
  );
  assert.deepEqual(coverageWrite.values, ["google-workspace"]);
  assert.equal(database.runs.length, 2);

  assert.equal(
    await repository.dismissNeedsReview("mail-1", "google-workspace", 33),
    true,
  );
  const dismissal = database.statements.at(-1);
  assert.match(
    dismissal.sql,
    // The retirement status is now bound, not a literal, so a row records whether it
    // was accepted or dismissed rather than collapsing every exit to "dismissed".
    /^UPDATE mail_items SET status = \?/u,
  );
  assert.deepEqual(dismissal.values, ["dismissed", 33, "mail-1", "google-workspace"]);
  assert.equal(database.runs.length, 3);
});

const baseMailItem = Object.freeze({
  id: "mail-validation",
  connectionKey: "google-workspace",
  gmailMessageId: "message-validation",
  gmailThreadId: null,
  clientId: null,
  suggestedProjectId: null,
  approvedProjectId: null,
  status: "needs-review",
  matchReason: null,
  emailDriveFileId: null,
  analysisPayload: Object.freeze({
    intents: Object.freeze(["lead"]),
    rationale: "A bounded rationale.",
  }),
  party: "prospect",
  confidence: "medium",
  contentHash: "b".repeat(64),
  labelDefinitionVersion: "catalog-2026-07-27",
  attemptedLabelDefinitionVersion: null,
  subject: "FCI TEST — DO NOT USE",
  sender: "sender@example.test",
  receivedAt: 39,
  failureAttempts: 0,
  errorCode: null,
  coverageComplete: false,
  createdAt: 40,
  updatedAt: 41,
});

test("mail-item insertIfAbsent preserves any existing analysis row on identity conflict", async () => {
  const database = new FakeDatabase({ run: () => 0 });
  const repository = mailModule.createD1MailItemRepository(database);
  assert.deepEqual(
    await repository.insertIfAbsent({
      ...baseMailItem,
      status: "failed",
      analysisPayload: null,
      party: null,
      confidence: null,
      contentHash: null,
      attemptedLabelDefinitionVersion: "catalog-2026-07-27",
      failureAttempts: 1,
      errorCode: "analysis_state_read_failed",
    }),
    { outcome: "existing-preserved" },
  );
  const write = database.statements.at(-1);
  assert.match(write.sql, /^INSERT INTO mail_items/u);
  assert.match(
    write.sql,
    /ON CONFLICT\(connection_key, gmail_message_id\) DO NOTHING$/u,
  );
  assert.doesNotMatch(write.sql, /DO UPDATE/u);
});

function d1MailItemRow(overrides = {}) {
  const item = { ...baseMailItem, ...overrides };
  return {
    id: item.id,
    connection_key: item.connectionKey,
    gmail_message_id: item.gmailMessageId,
    gmail_thread_id: item.gmailThreadId,
    client_id: item.clientId,
    suggested_project_id: item.suggestedProjectId,
    approved_project_id: item.approvedProjectId,
    status: item.status,
    match_reason: item.matchReason,
    email_drive_file_id: item.emailDriveFileId,
    analysis_payload: item.analysisPayload === null
      ? null
      : JSON.stringify(item.analysisPayload),
    party: item.party,
    confidence: item.confidence,
    content_hash: item.contentHash,
    label_definition_version: item.labelDefinitionVersion,
    attempted_label_definition_version: item.attemptedLabelDefinitionVersion,
    subject: item.subject,
    sender: item.sender,
    received_at: item.receivedAt,
    failure_attempts: item.failureAttempts,
    error_code: item.errorCode,
    coverage_complete: item.coverageComplete ? 1 : 0,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

test("mail-item domain closes party and confidence to the shipped catalogs", () => {
  for (const party of ["client", "prospect", "vendor", "employee", "unknown"]) {
    assert.equal(
      mailDomain.normalizeStoredMailItem({ ...baseMailItem, party }).party,
      party,
    );
  }
  for (const confidence of ["high", "medium", "low"]) {
    assert.equal(
      mailDomain.normalizeStoredMailItem({
        ...baseMailItem,
        confidence,
      }).confidence,
      confidence,
    );
  }
  assert.throws(
    () => mailDomain.normalizeStoredMailItem({
      ...baseMailItem,
      party: "customer",
    }),
    /party.*catalog/iu,
  );
  assert.throws(
    () => mailDomain.normalizeStoredMailItem({
      ...baseMailItem,
      confidence: "certain",
    }),
    /confidence.*catalog/iu,
  );
  assert.equal(
    mailDomain.normalizeStoredMailItem({
      ...baseMailItem,
      attemptedLabelDefinitionVersion: "catalog-2026-07-27",
      failureAttempts: 1,
      errorCode: "analysis_daily_limit_reached",
    }).errorCode,
    "analysis_daily_limit_reached",
  );
  assert.throws(
    () => mailDomain.normalizeStoredMailItem({
      ...baseMailItem,
      attemptedLabelDefinitionVersion: "catalog-2026-07-27",
      failureAttempts: 1,
      errorCode: null,
    }),
    /re-analysis requires an error code/iu,
  );
});

test("mail-item adapter filters retryable analysis rows before LIMIT so a current backlog cannot starve work", async () => {
  const currentCatalogRows = Array.from({ length: 101 }, (_, index) =>
    d1MailItemRow({
      id: `mail-current-${index}`,
      gmailMessageId: `message-current-${index}`,
      labelDefinitionVersion: "catalog-v3",
      createdAt: 100 + index,
      updatedAt: 100 + index,
    })
  );
  const retryable = d1MailItemRow({
    id: "mail-exhausted-v2",
    gmailMessageId: "message-exhausted-v2",
    labelDefinitionVersion: "catalog-v1",
    attemptedLabelDefinitionVersion: "catalog-v2",
    failureAttempts: 3,
    errorCode: "analysis_failed",
    createdAt: 10,
    updatedAt: 10,
  });
  assert.equal([...currentCatalogRows, retryable].length > 100, true);

  const database = new FakeDatabase({
    all(statement) {
      assert.match(
        statement.sql,
        /^SELECT \* FROM mail_items WHERE connection_key = \? AND \(error_code = 'analysis_daily_limit_reached' OR failure_attempts < \? OR attempted_label_definition_version IS NOT \?\) AND \(status = 'failed' OR \(status = 'needs-review' AND label_definition_version IS NOT \?\)\) ORDER BY updated_at ASC, id ASC LIMIT \?$/u,
      );
      assert.ok(
        statement.sql.indexOf("failure_attempts") < statement.sql.indexOf("LIMIT"),
        "retryability must be selected before the hard limit",
      );
      return [retryable];
    },
  });
  const repository = mailModule.createD1MailItemRepository(database);

  assert.deepEqual(
    (await repository.listRetryableAnalysisRows(
      "google-workspace",
      "catalog-v3",
      100,
    )).map(({ gmailMessageId }) => gmailMessageId),
    ["message-exhausted-v2"],
  );
  assert.deepEqual(database.statements.at(-1).values, [
    "google-workspace",
    3,
    "catalog-v3",
    "catalog-v3",
    100,
  ]);
});

for (const terminalStatus of ["accepted", "dismissed", "skipped-noise"]) {
  test(`mail-item adapter preserves an existing ${terminalStatus} row against a late sweep`, async () => {
    const database = new FakeDatabase({ run: () => 0 });
    const repository = mailModule.createD1MailItemRepository(database);
    const incoming = {
      ...baseMailItem,
      id: `late-${terminalStatus}`,
      gmailMessageId: `terminal-${terminalStatus}`,
      updatedAt: 42,
    };

    assert.deepEqual(await repository.upsert(incoming), {
      outcome: "terminal-preserved",
    });
    const upsert = database.statements.at(-1);
    assert.match(
      upsert.sql,
      /WHERE mail_items\.status IN \('needs-review', 'failed'\)$/u,
    );
    assert.equal(
      upsert.sql.includes(`'${terminalStatus}'`),
      false,
      `${terminalStatus} must not be admitted to the mutable conflict states`,
    );
  });
}

test("mail-item adapter preserves a terminal row while nulling an orphan suggested project", async () => {
  const database = new FakeDatabase({
    first(statement) {
      assert.match(statement.sql, /^SELECT id FROM projects WHERE id = \?$/u);
      assert.deepEqual(statement.values, [MAIL_SUGGESTED_PROJECT_ID]);
      return null;
    },
    run: () => 0,
  });
  const repository = mailModule.createD1MailItemRepository(database);

  assert.deepEqual(await repository.upsert({
    ...baseMailItem,
    suggestedProjectId: MAIL_SUGGESTED_PROJECT_ID,
  }), { outcome: "terminal-preserved" });

  const upsert = database.runs.at(-1);
  assert.equal(
    upsert.values[5],
    null,
    "a classifier suggestion whose project disappeared must not block the durable row",
  );
});

for (const scenario of [
  {
    label: "malformed client",
    item: { ...baseMailItem, clientId: "not-a-postgres-uuid" },
    outcome: "client-not-found",
    expectedLookupCount: 0,
  },
  {
    label: "malformed suggested project",
    item: { ...baseMailItem, suggestedProjectId: "not-a-postgres-uuid" },
    outcome: "suggested-project-not-found",
    expectedLookupCount: 0,
  },
  {
    label: "malformed approved project",
    item: { ...baseMailItem, approvedProjectId: "not-a-postgres-uuid" },
    outcome: "approved-project-not-found",
    expectedLookupCount: 0,
  },
  {
    label: "missing client",
    item: { ...baseMailItem, clientId: MAIL_CLIENT_ID },
    outcome: "client-not-found",
    expectedLookupCount: 1,
  },
  {
    label: "missing approved project",
    item: { ...baseMailItem, approvedProjectId: MAIL_APPROVED_PROJECT_ID },
    outcome: "approved-project-not-found",
    expectedLookupCount: 1,
  },
]) {
  test(`mail-item adapter fails closed without a write for a ${scenario.label} relationship`, async () => {
    const database = new FakeDatabase({ first: () => null });
    const repository = mailModule.createD1MailItemRepository(database);

    assert.deepEqual(await repository.upsert(scenario.item), { outcome: scenario.outcome });
    assert.equal(
      database.statements.filter((statement) =>
        /^SELECT id FROM (?:clients|projects) WHERE id = \?$/u.test(statement.sql)
      ).length,
      scenario.expectedLookupCount,
    );
    assert.equal(
      database.statements.some((statement) => /^INSERT INTO mail_items/u.test(statement.sql)),
      false,
    );
    assert.equal(database.runs.length, 0);
  });
}

test("mail-item adapter rejects unsafe analysis state before a D1 write", async () => {
  for (const item of [
    { ...baseMailItem, status: "approved" },
    { ...baseMailItem, party: "customer" },
    { ...baseMailItem, confidence: "certain" },
    { ...baseMailItem, contentHash: "not-a-sha256" },
    { ...baseMailItem, subject: "unsafe\u0000subject" },
    { ...baseMailItem, coverageComplete: "yes" },
    {
      ...baseMailItem,
      analysisPayload: { rationale: "x".repeat(8_001) },
    },
    {
      ...baseMailItem,
      status: "failed",
      analysisPayload: null,
      party: null,
      confidence: null,
      contentHash: null,
      labelDefinitionVersion: null,
      failureAttempts: 0,
      errorCode: null,
    },
  ]) {
    const database = new FakeDatabase();
    const repository = mailModule.createD1MailItemRepository(database);
    await assert.rejects(repository.upsert(item), /mail item/i);
    assert.equal(database.runs.length, 0);
  }
});

test("mail-item adapter persists a bounded failed row with nullable analysis and client", async () => {
  const database = new FakeDatabase();
  const repository = mailModule.createD1MailItemRepository(database);
  assert.deepEqual(await repository.upsert({
    ...baseMailItem,
    id: "mail-failed",
    gmailMessageId: "message-failed",
    clientId: null,
    status: "failed",
    analysisPayload: null,
    party: null,
    confidence: null,
    contentHash: null,
    labelDefinitionVersion: null,
    attemptedLabelDefinitionVersion: "catalog-2026-07-27",
    matchReason: "Provider response was structurally invalid.",
    failureAttempts: 1,
    errorCode: "provider_invalid",
  }), { outcome: "saved" });
  const write = database.statements.at(-1);
  assert.equal(write.values[4], null);
  assert.equal(write.values[10], null);
  assert.equal(write.values[19], 1);
  assert.equal(write.values[20], "provider_invalid");
});

test("Workspace Settings GET/PATCH keep their public contract while delegating persistence", async () => {
  const database = new FakeDatabase({
    first: () => ({
      id: "workspace",
      shared_drive_id: "saved-drive",
      client_directory_sheet_id: "saved-sheet",
      intake_mailbox: "ops@example.test",
      settings_json: JSON.stringify({
        timezone: "America/Chicago",
        appointmentCalendarId: "client-calendar",
        fieldCalendarId: "field-calendar",
        futureWorkspaceSetting: { retained: true },
        aiFeatures: {
          orgQa: false,
          futureFeature: "preserved",
        },
      }),
      updated_by: ADMIN_EMAIL,
      updated_at: 40,
    }),
  });
  setEnvironment(database);

  const getResponse = await workspaceRoute.GET(
    routeRequest("/api/v1/settings/workspace", OFFICE_EMAIL),
  );
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await getResponse.json(), {
    settings: {
      ...workspaceDomain.DEFAULT_WORKSPACE_PREFERENCES,
      timezone: "America/Chicago",
      appointmentCalendarId: "client-calendar",
      fieldCalendarId: "field-calendar",
    },
    updatedAt: 40,
  });

  const patchResponse = await workspaceRoute.PATCH(
    routeRequest("/api/v1/settings/workspace", ADMIN_EMAIL, "PATCH", {
      timezone: "America/Denver",
      appointmentReminderHours: 6,
      clientReminderHours: 48,
    }),
  );
  const patchBody = await patchResponse.json();
  assert.equal(patchResponse.status, 200);
  assert.equal(patchResponse.headers.get("cache-control"), "no-store");
  assert.equal(patchBody.settings.timezone, "America/Denver");
  assert.equal(patchBody.settings.appointmentReminderHours, 6);
  assert.equal(patchBody.settings.clientReminderHours, 48);
  const write = database.statements.at(-1);
  assert.match(write.sql, /^INSERT INTO workspace_settings/u);
  assert.doesNotMatch(write.sql, /client_directory_sheet_id = excluded/u);
  const storedSettings = JSON.parse(write.values[1]);
  assert.equal(storedSettings.appointmentReminderHours, 6);
  assert.equal(storedSettings.clientReminderHours, 48);
  assert.equal("futureWorkspaceSetting" in storedSettings, false);
  assert.equal("aiFeatures" in storedSettings, false);
  assert.match(write.sql, /settings_json = json_patch\(/u);
  assert.doesNotMatch(write.sql, /settings_json = excluded\.settings_json/u);
});

// SET-06: custom rules remain inert while their row presents that state honestly.
test("a higher-priority custom rule does not change the built-in filing suggestion", () => {
  const input = {
    message: {
      from: "client@example.test",
      subject: "Update for FCI-2026-014",
      snippet: "",
    },
    projects: [{
      id: "project-14",
      clientId: "client-14",
      number: "FCI-2026-014",
      client: "FCI TEST — DO NOT USE",
      status: "active",
    }],
    clients: [{
      id: "client-14",
      name: "FCI TEST — DO NOT USE",
      email: "client@example.test",
    }],
  };
  const baseline = googleWorkspace.evaluateInboxFilingRules({
    ...input,
    rules: googleWorkspace.DEFAULT_FILING_RULES,
  });
  const withCustomRule = googleWorkspace.evaluateInboxFilingRules({
    ...input,
    rules: [{
      id: "custom-priority-zero",
      name: "Custom always-suggest rule",
      enabled: true,
      priority: 0,
      matchSummary: "Every loaded message",
      action: "suggest",
      targetCategory: "99_Unsorted Intake",
      approvalRequired: true,
    }, ...googleWorkspace.DEFAULT_FILING_RULES],
  });

  assert.deepEqual(withCustomRule, baseline);
  assert.equal(withCustomRule.ruleName, "Exact project number");
});

test("filing-rule routes preserve built-in merging and mutation response semantics through the repository", async () => {
  const database = new FakeDatabase({
    all: () => [{
      id: "custom-rule",
      name: "Estimator invitations",
      enabled: 1,
      priority: 10,
      match_summary: "Known estimator",
      action: "review",
      target_category: "99_Unsorted Intake",
      approval_required: 1,
      created_by: OFFICE_EMAIL,
      created_at: 50,
      updated_at: 50,
    }],
  });
  setEnvironment(database);

  const getResponse = await filingRoute.GET(
    routeRequest("/api/v1/filing-rules", OFFICE_EMAIL),
  );
  const getBody = await getResponse.json();
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers.get("cache-control"), "no-store");
  assert.equal(getBody.rules.length, 4);
  assert.equal(getBody.rules.at(-1).id, "custom-rule");
  assert.equal(getBody.rules.at(-1).approvalRequired, true);

  const postResponse = await filingRoute.POST(
    routeRequest("/api/v1/filing-rules", ADMIN_EMAIL, "POST", {
      name: "Builder invitations",
      priority: 8,
      matchSummary: "Known builder",
      action: "suggest",
      targetCategory: "05_Correspondence / Email Archive",
    }),
  );
  assert.equal(postResponse.status, 201);
  assert.equal(postResponse.headers.get("cache-control"), "no-store");

  const patchResponse = await filingItemRoute.PATCH(
    routeRequest("/api/v1/filing-rules/custom-rule", ADMIN_EMAIL, "PATCH", {
      enabled: false,
    }),
    { params: Promise.resolve({ ruleId: "custom-rule" }) },
  );
  assert.equal(patchResponse.status, 200);
  assert.equal((await patchResponse.json()).updated, true);

  const deleteResponse = await filingItemRoute.DELETE(
    routeRequest("/api/v1/filing-rules/custom-rule", ADMIN_EMAIL, "DELETE"),
    { params: Promise.resolve({ ruleId: "custom-rule" }) },
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { deleted: true });
});

test("filing-rule POST, PATCH, and DELETE reject a non-admin office user before persistence", async () => {
  const database = new FakeDatabase();
  setEnvironment(database);
  const context = { params: Promise.resolve({ ruleId: "custom-rule" }) };

  const responses = await Promise.all([
    filingRoute.POST(
      routeRequest("/api/v1/filing-rules", OFFICE_EMAIL, "POST", {
        name: "Builder invitations",
        priority: 8,
        matchSummary: "Known builder",
        action: "suggest",
        targetCategory: "05_Correspondence / Email Archive",
      }),
    ),
    filingItemRoute.PATCH(
      routeRequest("/api/v1/filing-rules/custom-rule", OFFICE_EMAIL, "PATCH", {
        enabled: false,
      }),
      context,
    ),
    filingItemRoute.DELETE(
      routeRequest("/api/v1/filing-rules/custom-rule", OFFICE_EMAIL, "DELETE"),
      context,
    ),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "An FCI administrator must complete this action." });
  }
  assert.equal(database.statements.length, 0);
  assert.equal(database.runs.length, 0);
});
