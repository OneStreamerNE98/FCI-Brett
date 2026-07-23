import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24741 } },
});

const [
  workspaceSettingsModule,
  userPreferencesModule,
  filingRuleModule,
  mailItemModule,
] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/postgres/workspace-settings-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/user-preferences-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/filing-rule-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/mail-item-repository.ts"),
]);

after(async () => vite.close());

const { createPostgresWorkspaceSettingsRepository } = workspaceSettingsModule;
const { createPostgresUserPreferencesRepository } = userPreferencesModule;
const { createPostgresFilingRuleRepository } = filingRuleModule;
const { createPostgresMailItemRepository } = mailItemModule;

const CREATED_AT = Date.UTC(2026, 6, 23, 14, 0, 0);
const UPDATED_AT = CREATED_AT + 1_000;
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SUGGESTED_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const APPROVED_PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function result(rows = [], rowCount = rows.length) {
  return { rows, rowCount };
}

class RecordingPostgresClient {
  constructor(handler) {
    this.handler = handler;
    this.queries = [];
    this.releases = [];
  }

  async query(sql, values = []) {
    const query = { sql: sql.trim(), values: [...values] };
    this.queries.push(query);
    if (/^(?:BEGIN(?: READ ONLY)?|COMMIT|ROLLBACK)$/.test(query.sql)) {
      return result([], null);
    }
    if (/^SET LOCAL (?:lock_timeout|statement_timeout)/.test(query.sql)) {
      return result([], null);
    }
    if (/^SELECT pg_catalog\.set_config\('search_path'/.test(query.sql)) {
      return result([{ set_config: "settings_test, pg_catalog, pg_temp" }], 1);
    }
    if (/^SELECT pg_catalog\.current_schema\(\) AS current_schema/.test(query.sql)) {
      return result([{ current_schema: "settings_test" }], 1);
    }
    return this.handler(query);
  }

  release(error) {
    this.releases.push(error);
  }
}

class RecordingPostgresPool {
  constructor(handler) {
    this.clients = [];
    this.handler = handler;
  }

  async connect() {
    const client = new RecordingPostgresClient(this.handler);
    this.clients.push(client);
    return client;
  }

  get queries() {
    return this.clients.flatMap(({ queries }) => queries);
  }
}

function dataQuery(pool, pattern) {
  const query = pool.queries.find(({ sql }) => pattern.test(sql));
  assert.ok(query, `missing PostgreSQL query matching ${pattern}`);
  return query;
}

test("PostgreSQL Workspace settings preserve scalar resource IDs on document upsert", async () => {
  const readPool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /FROM workspace_settings[\s\S]*WHERE id = \$1/);
    return result([{
      id: "workspace",
      shared_drive_id: "drive-1",
      client_directory_sheet_id: "sheet-1",
      intake_mailbox: "operations@example.test",
      settings_json: { appointmentCalendarId: "calendar-1" },
      updated_by: "admin@example.test",
      updated_at: new Date(UPDATED_AT),
    }], 1);
  });
  const repository = createPostgresWorkspaceSettingsRepository(readPool, {
    schema: "settings_test",
  });

  assert.deepEqual(await repository.findById("workspace"), {
    id: "workspace",
    sharedDriveId: "drive-1",
    clientDirectorySheetId: "sheet-1",
    intakeMailbox: "operations@example.test",
    settings: { appointmentCalendarId: "calendar-1" },
    updatedBy: "admin@example.test",
    updatedAt: UPDATED_AT,
  });
  assert.deepEqual(dataQuery(readPool, /FROM workspace_settings/).values, ["workspace"]);

  const writePool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO workspace_settings/);
    return result([], 1);
  });
  const writer = createPostgresWorkspaceSettingsRepository(writePool, {
    schema: "settings_test",
  });
  await writer.upsert({
    id: "workspace",
    settings: { appointmentCalendarId: "calendar-2" },
    updatedBy: "admin@example.test",
    updatedAt: UPDATED_AT,
  });

  const upsert = dataQuery(writePool, /^INSERT INTO workspace_settings/);
  assert.deepEqual(upsert.values, [
    "workspace",
    JSON.stringify({ appointmentCalendarId: "calendar-2" }),
    "admin@example.test",
    new Date(UPDATED_AT),
  ]);
  const conflictUpdate = upsert.sql.split("DO UPDATE SET")[1];
  assert.doesNotMatch(
    conflictUpdate,
    /shared_drive_id|client_directory_sheet_id|intake_mailbox/,
    "document updates must not erase registered Workspace resource IDs",
  );
});

test("PostgreSQL user preferences expose exact-email own-row operations only", async () => {
  const pool = new RecordingPostgresPool(({ sql, values }) => {
    assert.match(sql, /FROM user_preferences[\s\S]*WHERE user_email = \$1/);
    assert.deepEqual(values, ["office@example.test"]);
    return result([{
      user_email: "office@example.test",
      display_timezone: "America/New_York",
      reply_signature: "Regards",
      notification_preferences_json: '{"lead.created":true}',
      page_layouts_json: '{"overview":{"order":[],"hidden":[]}}',
      updated_at: new Date(UPDATED_AT),
    }], 1);
  });
  const repository = createPostgresUserPreferencesRepository(pool, {
    schema: "settings_test",
  });

  assert.deepEqual(Object.keys(repository).sort(), ["findByEmail", "upsert"]);
  assert.deepEqual(await repository.findByEmail("office@example.test"), {
    userEmail: "office@example.test",
    displayTimezone: "America/New_York",
    replySignature: "Regards",
    notificationPreferencesJson: '{"lead.created":true}',
    pageLayoutsJson: '{"overview":{"order":[],"hidden":[]}}',
    updatedAt: UPDATED_AT,
  });

  const rejectedPool = new RecordingPostgresPool(() => {
    throw new Error("invalid email must not reach PostgreSQL");
  });
  const rejected = createPostgresUserPreferencesRepository(rejectedPool, {
    schema: "settings_test",
  });
  assert.equal(await rejected.findByEmail("Other@Example.test"), null);
  assert.equal(rejectedPool.clients.length, 0);

  const writePool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO user_preferences/);
    assert.match(sql, /ON CONFLICT \(user_email\) DO UPDATE/);
    return result([], 1);
  });
  await createPostgresUserPreferencesRepository(writePool, {
    schema: "settings_test",
  }).upsert({
    userEmail: "office@example.test",
    displayTimezone: "America/New_York",
    replySignature: "",
    notificationPreferencesJson: '{"lead.created":false}',
    pageLayoutsJson: "{}",
    updatedAt: UPDATED_AT,
  });
  assert.equal(
    dataQuery(writePool, /^INSERT INTO user_preferences/).values[0],
    "office@example.test",
  );
});

test("PostgreSQL filing rules round-trip booleans and keep bounded CRUD statements", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    if (/^SELECT id, name/.test(sql)) {
      return result([{
        id: "rule-1",
        name: "Exact project",
        enabled: true,
        priority: 10,
        match_summary: "Project number appears in the subject.",
        action: "suggest",
        target_category: "05_Correspondence / Email Archive",
        approval_required: true,
        created_by: "admin@example.test",
        created_at: new Date(CREATED_AT),
        updated_at: new Date(UPDATED_AT),
      }], 1);
    }
    if (/^(?:INSERT INTO|UPDATE|DELETE FROM) filing_rules/.test(sql)) {
      return result([], 1);
    }
    throw new Error(`unexpected filing-rule query: ${sql}`);
  });
  const repository = createPostgresFilingRuleRepository(pool, {
    schema: "settings_test",
  });

  assert.deepEqual(await repository.list(), [{
    id: "rule-1",
    name: "Exact project",
    enabled: true,
    priority: 10,
    matchSummary: "Project number appears in the subject.",
    action: "suggest",
    targetCategory: "05_Correspondence / Email Archive",
    approvalRequired: true,
    created_by: "admin@example.test",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  }]);
  await repository.create({
    id: "rule-2",
    values: {
      name: "Manual review",
      enabled: true,
      priority: 20,
      matchSummary: "The sender is a known estimator.",
      action: "review",
      targetCategory: "05_Correspondence / Email Archive",
      approvalRequired: true,
    },
    createdBy: "admin@example.test",
    createdAt: CREATED_AT,
  });
  assert.equal(await repository.update({
    id: "rule-2",
    values: { enabled: false, priority: 25 },
    updatedAt: UPDATED_AT,
  }), true);
  assert.equal(await repository.delete("rule-2"), true);

  const update = dataQuery(pool, /^UPDATE filing_rules/);
  assert.match(update.sql, /enabled = \$1, priority = \$2, updated_at = \$3/);
  assert.deepEqual(update.values, [false, 25, new Date(UPDATED_AT), "rule-2"]);
  assert.deepEqual(dataQuery(pool, /^DELETE FROM filing_rules/).values, ["rule-2"]);
});

function mailItem(overrides = {}) {
  return {
    id: "mail-1",
    gmailMessageId: "gmail-1",
    gmailThreadId: "thread-1",
    clientId: CLIENT_ID,
    suggestedProjectId: SUGGESTED_PROJECT_ID,
    approvedProjectId: APPROVED_PROJECT_ID,
    status: "approved",
    matchReason: "Exact project number.",
    emailDriveFileId: "drive-file-1",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

test("PostgreSQL mail items require valid record references and preserve creation time on upsert", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO mail_items/);
    return result([], 1);
  });
  assert.deepEqual(await createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  }).upsert(mailItem()), { outcome: "saved" });

  const upsert = dataQuery(pool, /^INSERT INTO mail_items/);
  assert.deepEqual(upsert.values.slice(3, 6), [
    CLIENT_ID,
    SUGGESTED_PROJECT_ID,
    APPROVED_PROJECT_ID,
  ]);
  assert.doesNotMatch(
    upsert.sql.split("DO UPDATE SET")[1],
    /created_at\s*=/,
    "an update must retain the original mail-item creation timestamp",
  );

  for (const [property, outcome] of [
    ["clientId", "client-not-found"],
    ["suggestedProjectId", "suggested-project-not-found"],
    ["approvedProjectId", "approved-project-not-found"],
  ]) {
    const invalidPool = new RecordingPostgresPool(() => {
      throw new Error("invalid UUID must not reach PostgreSQL");
    });
    assert.deepEqual(await createPostgresMailItemRepository(invalidPool, {
      schema: "settings_test",
    }).upsert(mailItem({ [property]: "not-a-uuid" })), { outcome });
    assert.equal(invalidPool.clients.length, 0);
  }

  for (const [constraint, outcome] of [
    ["mail_items_client_id_fkey", "client-not-found"],
    ["mail_items_suggested_project_id_fkey", "suggested-project-not-found"],
    ["mail_items_approved_project_id_fkey", "approved-project-not-found"],
  ]) {
    const foreignKey = Object.assign(new Error("foreign key violation"), {
      code: "23503",
      constraint,
    });
    const missingReferencePool = new RecordingPostgresPool(({ sql }) => {
      assert.match(sql, /^INSERT INTO mail_items/);
      throw foreignKey;
    });
    assert.deepEqual(await createPostgresMailItemRepository(missingReferencePool, {
      schema: "settings_test",
    }).upsert(mailItem()), { outcome });
    assert.equal(
      missingReferencePool.queries.some(({ sql }) => sql === "ROLLBACK"),
      true,
    );
  }

  const unexpectedError = Object.assign(new Error("unexpected constraint"), {
    code: "23503",
    constraint: "mail_items_unknown_fkey",
  });
  const unexpectedPool = new RecordingPostgresPool(() => {
    throw unexpectedError;
  });
  await assert.rejects(
    createPostgresMailItemRepository(unexpectedPool, {
      schema: "settings_test",
    }).upsert(mailItem()),
    (error) => error === unexpectedError,
  );
});
