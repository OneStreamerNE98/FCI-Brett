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
  workspaceSettingsDomain,
  userPreferencesModule,
  filingRuleModule,
  mailItemModule,
] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/postgres/workspace-settings-repository.ts"),
  vite.ssrLoadModule("/app/domain/workspace-settings.ts"),
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

test("PostgreSQL Workspace settings atomically merge owned keys and preserve scalar resource IDs", async () => {
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
  await writer.mergeSettings({
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
    ["appointmentCalendarId"],
  ]);
  const conflictUpdate = upsert.sql.split("DO UPDATE SET")[1];
  assert.match(
    conflictUpdate,
    /workspace_settings\.settings_json - \$5::text\[\][\s\S]*\|\| EXCLUDED\.settings_json/u,
  );
  assert.doesNotMatch(conflictUpdate, /settings_json = EXCLUDED\.settings_json/u);
  assert.doesNotMatch(
    conflictUpdate,
    /shared_drive_id|client_directory_sheet_id|intake_mailbox/,
    "document updates must not erase registered Workspace resource IDs",
  );
});

test("PostgreSQL Workspace settings fence the merged document byte length and reject oversize merges atomically", async () => {
  // The conflict update carries a WHERE on the merged jsonb text's byte length,
  // measured on the same expression the update writes, so the fence is atomic.
  const shapePool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO workspace_settings/);
    return result([], 1);
  });
  await createPostgresWorkspaceSettingsRepository(shapePool, {
    schema: "settings_test",
  }).mergeSettings({
    id: "workspace",
    settings: { appointmentCalendarId: "calendar-2" },
    updatedBy: "admin@example.test",
    updatedAt: UPDATED_AT,
  });
  const conflictUpdate = dataQuery(shapePool, /^INSERT INTO workspace_settings/)
    .sql.split("DO UPDATE SET")[1];
  assert.match(
    conflictUpdate,
    /WHERE octet_length\([\s\S]*workspace_settings\.settings_json - \$5::text\[\][\s\S]*\|\| EXCLUDED\.settings_json[\s\S]*\)::text\) <= 64000/u,
  );

  // A guard that matches no row (rowCount 0) surfaces the shared typed oversize
  // error and rolls the bounded transaction back without a partial write.
  const rejectingPool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO workspace_settings/);
    return result([], 0);
  });
  await assert.rejects(
    createPostgresWorkspaceSettingsRepository(rejectingPool, {
      schema: "settings_test",
    }).mergeSettings({
      id: "workspace",
      settings: { appointmentCalendarId: "calendar-2" },
      updatedBy: "admin@example.test",
      updatedAt: UPDATED_AT,
    }),
    (error) =>
      error instanceof TypeError
      && error.message
        === workspaceSettingsDomain.WORKSPACE_SETTINGS_DOCUMENT_TOO_LARGE_MESSAGE,
  );
  assert.equal(
    rejectingPool.queries.some(({ sql }) => sql === "ROLLBACK"),
    true,
    "a rejected oversize merge must roll its bounded transaction back",
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
    connectionKey: "google-workspace",
    gmailMessageId: "gmail-1",
    gmailThreadId: "thread-1",
    clientId: CLIENT_ID,
    suggestedProjectId: SUGGESTED_PROJECT_ID,
    approvedProjectId: APPROVED_PROJECT_ID,
    status: "accepted",
    matchReason: "Exact project number.",
    emailDriveFileId: "drive-file-1",
    analysisPayload: Object.freeze({
      intents: Object.freeze(["project-update"]),
      rationale: "Exact project number.",
    }),
    party: "client",
    confidence: "high",
    contentHash: "a".repeat(64),
    labelDefinitionVersion: "catalog-2026-07-27",
    attemptedLabelDefinitionVersion: null,
    subject: "FCI TEST — DO NOT USE project update",
    sender: "Client <client@example.test>",
    receivedAt: CREATED_AT - 1_000,
    failureAttempts: 0,
    errorCode: null,
    coverageComplete: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function postgresMailItemRow(item) {
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
    analysis_payload: item.analysisPayload,
    party: item.party,
    confidence: item.confidence,
    content_hash: item.contentHash,
    label_definition_version: item.labelDefinitionVersion,
    attempted_label_definition_version: item.attemptedLabelDefinitionVersion,
    subject: item.subject,
    sender: item.sender,
    received_at: item.receivedAt === null ? null : new Date(item.receivedAt),
    failure_attempts: item.failureAttempts,
    error_code: item.errorCode,
    coverage_complete: item.coverageComplete,
    created_at: new Date(item.createdAt),
    updated_at: new Date(item.updatedAt),
  };
}

test("PostgreSQL mail items read only within one connection and expose frozen analysis", async () => {
  const stored = mailItem();
  const row = postgresMailItemRow(stored);
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^SELECT id, connection_key/);
    return result([row], 1);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });

  const found = await repository.findByGmailMessageId(
    "google-workspace",
    "gmail-1",
  );
  assert.deepEqual(found, stored);
  assert.equal(Object.isFrozen(found.analysisPayload), true);
  assert.equal(Object.isFrozen(found.analysisPayload.intents), true);
  assert.deepEqual(
    dataQuery(pool, /WHERE connection_key = \$1 AND gmail_message_id = \$2/).values,
    ["google-workspace", "gmail-1"],
  );

  assert.deepEqual(
    await repository.listByStatus("google-workspace", "accepted", 900),
    [stored],
  );
  assert.deepEqual(
    dataQuery(pool, /WHERE connection_key = \$1 AND status = \$2/).values,
    ["google-workspace", "accepted", 100],
  );
});

test("PostgreSQL mail item status pages carry one snapshot count and are connection scoped", async () => {
  const stored = mailItem({ status: "needs-review" });
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^SELECT page\.\*, COUNT\(\*\) OVER \(\)::text AS total_count/u);
    return result([{
      ...postgresMailItemRow(stored),
      total_count: "123",
    }], 1);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });

  assert.deepEqual(
    await repository.listByStatusPage("google-workspace", "needs-review", 500),
    { items: [stored], totalCount: 123 },
  );
  assert.deepEqual(
    dataQuery(pool, /COUNT\(\*\) OVER \(\)::text AS total_count/).values,
    ["google-workspace", "needs-review", 500],
  );
});

test("PostgreSQL dismissal is one guarded status transition with no relationship lookup", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^UPDATE mail_items/u);
    assert.match(
      sql,
      // Positions shifted by one: the retirement status is now $1 (bound, not a
      // literal) so the row records accepted vs dismissed. Mirrors the D1 adapter.
      /WHERE id = \$3\s+AND connection_key = \$4\s+AND status = 'needs-review'/u,
    );
    assert.match(sql, /^UPDATE mail_items\s+SET status = \$1/u);
    assert.doesNotMatch(sql, /clients|projects/u);
    return result([], 1);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });

  assert.equal(
    await repository.dismissNeedsReview(
      "mail-1",
      "google-workspace",
      UPDATED_AT,
    ),
    true,
  );
  // The retirement status leads the bound values now, matching D1. Defaulting the
  // fourth argument keeps a hand dismissal recording "dismissed".
  assert.deepEqual(
    dataQuery(pool, /^UPDATE mail_items/u).values,
    ["dismissed", new Date(UPDATED_AT), "mail-1", "google-workspace"],
  );
});

test("PostgreSQL mail items select retryable work before LIMIT and renew an exhausted budget for a new catalog", async () => {
  const currentCatalogRows = Array.from({ length: 101 }, (_, index) =>
    postgresMailItemRow(mailItem({
      id: `mail-current-${index}`,
      gmailMessageId: `gmail-current-${index}`,
      status: "needs-review",
      labelDefinitionVersion: "catalog-v3",
      createdAt: CREATED_AT + index,
      updatedAt: UPDATED_AT + index,
    }))
  );
  const retryable = postgresMailItemRow(mailItem({
    id: "mail-exhausted-v2",
    gmailMessageId: "gmail-exhausted-v2",
    status: "needs-review",
    labelDefinitionVersion: "catalog-v1",
    attemptedLabelDefinitionVersion: "catalog-v2",
    failureAttempts: 3,
    errorCode: "analysis_failed",
  }));
  assert.equal([...currentCatalogRows, retryable].length > 100, true);

  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^SELECT id, connection_key/);
    assert.match(
      sql,
      /error_code IN \('analysis_daily_limit_reached', 'analysis_label_catalog_changed'\)[\s\S]*failure_attempts < \$2[\s\S]*attempted_label_definition_version IS DISTINCT FROM \$3[\s\S]*status = 'failed'[\s\S]*status = 'needs-review'[\s\S]*label_definition_version IS DISTINCT FROM \$4[\s\S]*ORDER BY updated_at ASC, id ASC[\s\S]*LIMIT \$5/u,
    );
    assert.ok(
      sql.indexOf("failure_attempts") < sql.indexOf("LIMIT"),
      "retryability must be selected before the hard limit",
    );
    return result([retryable], 1);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });

  assert.deepEqual(
    (await repository.listRetryableAnalysisRows(
      "google-workspace",
      "catalog-v3",
      100,
    )).map(({ gmailMessageId }) => gmailMessageId),
    ["gmail-exhausted-v2"],
  );
  assert.deepEqual(
    dataQuery(
      pool,
      /attempted_label_definition_version IS DISTINCT FROM \$3/,
    ).values,
    ["google-workspace", 3, "catalog-v3", "catalog-v3", 100],
  );
});

test("PostgreSQL mail-item insertIfAbsent preserves any existing analysis row on identity conflict", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO mail_items/);
    return result([], 0);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });
  assert.deepEqual(
    await repository.insertIfAbsent(mailItem({
      clientId: null,
      suggestedProjectId: null,
      approvedProjectId: null,
      status: "failed",
      analysisPayload: null,
      party: null,
      confidence: null,
      contentHash: null,
      attemptedLabelDefinitionVersion: "catalog-2026-07-27",
      failureAttempts: 1,
      errorCode: "analysis_state_read_failed",
    })),
    { outcome: "existing-preserved" },
  );
  const insert = dataQuery(pool, /^INSERT INTO mail_items/);
  assert.match(
    insert.sql,
    /ON CONFLICT \(connection_key, gmail_message_id\) DO NOTHING$/u,
  );
  assert.doesNotMatch(insert.sql, /DO UPDATE/u);
});

test("PostgreSQL mail-item analysis locks every active label before its guarded write", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    if (/^SELECT slug[\s\S]*FROM assistant_label_definitions/u.test(sql)) {
      return result([{ slug: "project-update" }], 1);
    }
    assert.match(sql, /^INSERT INTO mail_items/u);
    return result([], 1);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });
  assert.deepEqual(
    await repository.saveAnalysisIfLabelsActive(
      mailItem({ status: "needs-review" }),
      ["project-update"],
      "upsert",
    ),
    { outcome: "saved" },
  );
  const labelLock = dataQuery(pool, /^SELECT slug[\s\S]*assistant_label_definitions/u);
  assert.deepEqual(labelLock.values, [["project-update"]]);
  assert.match(labelLock.sql, /WHERE retired = false[\s\S]*FOR SHARE$/u);
  const lockIndex = pool.queries.indexOf(labelLock);
  const insertIndex = pool.queries.findIndex(({ sql }) => /^INSERT INTO mail_items/u.test(sql));
  assert.ok(lockIndex >= 0 && insertIndex > lockIndex);
});

test("PostgreSQL mail-item analysis rejects a stale catalog snapshot without writing", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^SELECT slug[\s\S]*FROM assistant_label_definitions/u);
    return result([], 0);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });
  assert.deepEqual(
    await repository.saveAnalysisIfLabelsActive(
      mailItem({ status: "needs-review" }),
      ["project-update"],
      "upsert",
    ),
    { outcome: "label-catalog-changed" },
  );
  assert.equal(
    pool.queries.some(({ sql }) => /^INSERT INTO mail_items/u.test(sql)),
    false,
  );
});

test("PostgreSQL mail items require valid record references and preserve creation time on upsert", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO mail_items/);
    return result([], 1);
  });
  assert.deepEqual(await createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  }).upsert(mailItem()), { outcome: "saved" });

  const upsert = dataQuery(pool, /^INSERT INTO mail_items/);
  assert.deepEqual(upsert.values.slice(4, 7), [
    CLIENT_ID,
    SUGGESTED_PROJECT_ID,
    APPROVED_PROJECT_ID,
  ]);
  assert.equal(upsert.values[10], JSON.stringify(mailItem().analysisPayload));
  assert.match(
    upsert.sql,
    /ON CONFLICT \(connection_key, gmail_message_id\) DO UPDATE SET/u,
  );
  assert.doesNotMatch(
    upsert.sql.split("DO UPDATE SET")[1],
    /\b(?:id|created_at)\s*=/,
    "an update must retain the original mail-item creation timestamp",
  );
  assert.match(
    upsert.sql,
    /coverage_complete = mail_items\.coverage_complete OR EXCLUDED\.coverage_complete/u,
  );
  assert.match(
    upsert.sql,
    /\(SELECT id FROM projects WHERE id = \$6::uuid\)/u,
    "a missing classifier suggestion must persist as null instead of violating its foreign key",
  );
  assert.match(
    upsert.sql,
    /WHERE mail_items\.status IN \('needs-review', 'failed'\)$/u,
  );

  const nullableClientPool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO mail_items/);
    return result([], 1);
  });
  assert.deepEqual(await createPostgresMailItemRepository(nullableClientPool, {
    schema: "settings_test",
  }).upsert(mailItem({
    id: "mail-no-client",
    gmailMessageId: "gmail-no-client",
    clientId: null,
    suggestedProjectId: null,
    approvedProjectId: null,
    status: "needs-review",
  })), { outcome: "saved" });
  assert.equal(dataQuery(nullableClientPool, /^INSERT INTO mail_items/).values[4], null);

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

test("PostgreSQL mail items preserve a terminal row while nulling an orphan suggested project", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^INSERT INTO mail_items/);
    return result([], 0);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });

  assert.deepEqual(await repository.upsert(mailItem({
    suggestedProjectId: SUGGESTED_PROJECT_ID,
  })), { outcome: "terminal-preserved" });

  const upsert = dataQuery(pool, /^INSERT INTO mail_items/);
  assert.match(upsert.sql, /\(SELECT id FROM projects WHERE id = \$6::uuid\)/u);
  assert.equal(upsert.values[5], SUGGESTED_PROJECT_ID);
});

for (const terminalStatus of ["accepted", "dismissed", "skipped-noise"]) {
  test(`PostgreSQL mail items preserve an existing ${terminalStatus} row against a late sweep`, async () => {
    const pool = new RecordingPostgresPool(({ sql }) => {
      assert.match(sql, /^INSERT INTO mail_items/);
      return result([], 0);
    });
    const repository = createPostgresMailItemRepository(pool, {
      schema: "settings_test",
    });
    assert.deepEqual(await repository.upsert(mailItem({
      id: `late-${terminalStatus}`,
      gmailMessageId: `terminal-${terminalStatus}`,
      status: "needs-review",
    })), { outcome: "terminal-preserved" });

    const upsert = dataQuery(pool, /^INSERT INTO mail_items/);
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

test("PostgreSQL mail items mark coverage only for the requested connection", async () => {
  const pool = new RecordingPostgresPool(({ sql }) => {
    assert.match(sql, /^UPDATE mail_items/);
    return result([], 2);
  });
  const repository = createPostgresMailItemRepository(pool, {
    schema: "settings_test",
  });
  await repository.markCoverageComplete("workspace-simulation");
  const update = dataQuery(pool, /^UPDATE mail_items/);
  assert.match(
    update.sql,
    /SET coverage_complete = true[\s\S]*WHERE connection_key = \$1 AND coverage_complete = false/u,
  );
  assert.deepEqual(update.values, ["workspace-simulation"]);
});

test("PostgreSQL mail items reject unsafe analysis state before connecting", async () => {
  for (const item of [
    mailItem({ status: "approved" }),
    mailItem({ party: "customer" }),
    mailItem({ confidence: "certain" }),
    mailItem({ contentHash: "not-a-sha256" }),
    mailItem({ sender: "unsafe\u0000sender" }),
    mailItem({ coverageComplete: 1 }),
    mailItem({ analysisPayload: { rationale: "x".repeat(8_001) } }),
    mailItem({
      status: "failed",
      analysisPayload: null,
      party: null,
      confidence: null,
      contentHash: null,
      labelDefinitionVersion: null,
      failureAttempts: 0,
      errorCode: null,
    }),
  ]) {
    const pool = new RecordingPostgresPool(() => {
      throw new Error("invalid mail item must not reach PostgreSQL");
    });
    await assert.rejects(
      createPostgresMailItemRepository(pool, {
        schema: "settings_test",
      }).upsert(item),
      /mail item/i,
    );
    assert.equal(pool.clients.length, 0);
  }
});
