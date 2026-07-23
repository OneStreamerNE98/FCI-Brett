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
  workspaceDomain,
  workspaceRoute,
  filingRoute,
  filingItemRoute,
] =
  await Promise.all([
    vite.ssrLoadModule("/app/adapters/d1/workspace-settings-repository.ts"),
    vite.ssrLoadModule("/app/adapters/d1/user-preferences-repository.ts"),
    vite.ssrLoadModule("/app/adapters/d1/filing-rule-repository.ts"),
    vite.ssrLoadModule("/app/adapters/d1/mail-item-repository.ts"),
    vite.ssrLoadModule("/app/domain/workspace-settings.ts"),
    vite.ssrLoadModule("/app/api/v1/settings/workspace/route.ts"),
    vite.ssrLoadModule("/app/api/v1/filing-rules/route.ts"),
    vite.ssrLoadModule("/app/api/v1/filing-rules/[ruleId]/route.ts"),
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

test("workspace settings use one safe normalizer and JSON upserts preserve scalar resource columns", async () => {
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
  assert.deepEqual(workspaceDomain.normalizeWorkspacePreferences(record.settings), {
    ...workspaceDomain.DEFAULT_WORKSPACE_PREFERENCES,
    timezone: "America/Chicago",
    appointmentCalendarId: "saved-client-calendar",
    fieldCalendarId: "saved-field-calendar",
    appointmentReminderHours: 12,
  });
  assert.deepEqual(
    workspaceDomain.normalizeWorkspacePreferences(
      workspaceDomain.parseWorkspaceSettingsDocument("{not-json"),
    ),
    workspaceDomain.DEFAULT_WORKSPACE_PREFERENCES,
  );

  await repository.upsert({
    id: "workspace",
    settings: record.settings,
    updatedBy: "next-admin@example.test",
    updatedAt: 1_790_000_000_001,
  });
  const write = database.statements.at(-1);
  assert.match(write.sql, /^INSERT INTO workspace_settings/u);
  assert.match(write.sql, /DO UPDATE SET settings_json = excluded\.settings_json/u);
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
    gmail_message_id: "message-1",
    gmail_thread_id: null,
    client_id: MAIL_CLIENT_ID,
    suggested_project_id: MAIL_SUGGESTED_PROJECT_ID,
    approved_project_id: null,
    status: "needs-review",
    match_reason: "Known sender",
    email_drive_file_id: null,
    created_at: 30,
    updated_at: 31,
  };
  const database = new FakeDatabase({
    first(statement) {
      if (/FROM mail_items WHERE id = \?/u.test(statement.sql)) return row;
      if (/^SELECT id FROM (?:clients|projects) WHERE id = \?$/u.test(statement.sql)) {
        return { id: statement.values[0] };
      }
      return null;
    },
    all: () => [row],
  });
  const repository = mailModule.createD1MailItemRepository(database);
  const item = await repository.findById("mail-1");
  assert.equal(item.gmailMessageId, "message-1");
  assert.equal(item.approvedProjectId, null);

  const listed = await repository.listByStatus("needs-review", 501);
  assert.equal(listed.length, 1);
  assert.deepEqual(database.statements.at(-1).values, ["needs-review", 100]);

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
  assert.equal(write.values[5], MAIL_APPROVED_PROJECT_ID);
  assert.equal(write.values.at(-1), 32);
  assert.equal(database.runs.length, 1);
});

const baseMailItem = Object.freeze({
  id: "mail-validation",
  gmailMessageId: "message-validation",
  gmailThreadId: null,
  clientId: null,
  suggestedProjectId: null,
  approvedProjectId: null,
  status: "needs-review",
  matchReason: null,
  emailDriveFileId: null,
  createdAt: 40,
  updatedAt: 41,
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
    label: "missing suggested project",
    item: { ...baseMailItem, suggestedProjectId: MAIL_SUGGESTED_PROJECT_ID },
    outcome: "suggested-project-not-found",
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
    }),
  );
  const patchBody = await patchResponse.json();
  assert.equal(patchResponse.status, 200);
  assert.equal(patchResponse.headers.get("cache-control"), "no-store");
  assert.equal(patchBody.settings.timezone, "America/Denver");
  assert.equal(patchBody.settings.appointmentReminderHours, 6);
  const write = database.statements.at(-1);
  assert.match(write.sql, /^INSERT INTO workspace_settings/u);
  assert.doesNotMatch(write.sql, /client_directory_sheet_id = excluded/u);
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
    routeRequest("/api/v1/filing-rules", OFFICE_EMAIL, "POST", {
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
    routeRequest("/api/v1/filing-rules/custom-rule", OFFICE_EMAIL, "PATCH", {
      enabled: false,
    }),
    { params: Promise.resolve({ ruleId: "custom-rule" }) },
  );
  assert.equal(patchResponse.status, 200);
  assert.equal((await patchResponse.json()).updated, true);

  const deleteResponse = await filingItemRoute.DELETE(
    routeRequest("/api/v1/filing-rules/custom-rule", OFFICE_EMAIL, "DELETE"),
    { params: Promise.resolve({ ruleId: "custom-rule" }) },
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { deleted: true });
});
