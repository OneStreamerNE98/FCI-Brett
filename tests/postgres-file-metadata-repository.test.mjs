import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/file-metadata",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24687 } },
});
const { createPostgresFileMetadataRepository } = await vite.ssrLoadModule(
  "/app/adapters/postgres/file-metadata-repository.ts",
);

after(async () => {
  await vite.close();
});

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const FILE_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const STORAGE_OBJECT_ID = "33333333-3333-4333-8333-333333333333";
const FILE_LINK_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const AUDIT_ID = "77777777-7777-4777-8777-777777777777";
const CREATED_AT = Date.UTC(2026, 6, 15, 13, 0, 0);
const RECORDED_AT = new Date(CREATED_AT + 10);
const FILE_VERSION = "9007199254740992";
const STORAGE_VERSION = "9007199254740993";
const NEXT_FILE_VERSION = "9007199254740993";
const NEXT_STORAGE_VERSION = "9007199254740994";
const CHECKSUM = `sha256:${"a".repeat(64)}`;

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function step(match, response = result(), options = {}) {
  return { match, response, ...options };
}

function transactionSetupSteps() {
  return [
    step(/^BEGIN$/),
    step(/^SET LOCAL lock_timeout = '5000ms'$/),
    step(/^SET LOCAL statement_timeout = '30000ms'$/),
    step(
      /SELECT pg_catalog\.set_config\('search_path', \$1, true\)/,
      result([{ set_config: "file_test, pg_catalog, pg_temp" }], 1),
      { inspect: ({ values }) => assert.deepEqual(values, ["file_test, pg_catalog, pg_temp"]) },
    ),
    step(
      /SELECT pg_catalog\.current_schema\(\) AS current_schema/,
      result([{ current_schema: "file_test" }], 1),
    ),
  ];
}

class ScriptedPostgresClient {
  constructor(steps) {
    this.steps = [...steps];
    this.queries = [];
    this.releaseCalls = [];
  }

  async query(sql, values = []) {
    const query = { sql: sql.trim(), values: [...values] };
    this.queries.push(query);
    const expected = this.steps.shift();
    assert.ok(expected, `unexpected PostgreSQL query: ${query.sql}`);
    if (typeof expected.match === "string") assert.equal(query.sql, expected.match);
    else assert.match(query.sql, expected.match);
    expected.inspect?.(query);
    if (expected.error) throw expected.error;
    return expected.response;
  }

  release(error) {
    this.releaseCalls.push(error);
  }

  assertComplete(releaseCount = 1) {
    assert.deepEqual(this.steps, []);
    assert.equal(this.releaseCalls.length, releaseCount);
  }
}

class ScriptedPostgresPool {
  constructor(client) {
    this.client = client;
    this.connectCount = 0;
  }

  async connect() {
    this.connectCount += 1;
    return this.client;
  }
}

function auditEvent(overrides = {}) {
  return {
    id: AUDIT_ID,
    executorType: "user",
    executorUserId: USER_ID,
    executorKey: `user:${USER_ID}`,
    originatingUserId: null,
    originatingActorKey: null,
    action: "file.upload_reserved",
    targetType: "file",
    targetId: FILE_ID,
    result: "succeeded",
    reasonCode: null,
    requestId: "request-file-1",
    correlationId: "correlation-file-1",
    source: "cloud_run",
    metadata: { category: "project_document" },
    occurredAt: CREATED_AT,
    retentionPolicyKey: "security_default",
    retentionUntil: CREATED_AT + 86_400_000,
    ...overrides,
  };
}

function reservationIntent(overrides = {}) {
  return {
    fileId: FILE_ID,
    fileVersionId: FILE_VERSION_ID,
    storageObjectId: STORAGE_OBJECT_ID,
    fileLinkId: FILE_LINK_ID,
    projectId: PROJECT_ID,
    category: "project_document",
    relationshipKey: "document",
    sourceKey: "upload/11111111-1111-4111-8111-111111111111",
    originalFilename: "FCI TEST proposal.pdf",
    declaredMediaType: "application/pdf",
    storageProvider: "memory",
    storageContainer: "fci-quarantine-test",
    objectKey: "quarantine/22222222-2222-4222-8222-222222222222",
    retentionPolicyKey: "file_default",
    retentionUntil: CREATED_AT + 86_400_000,
    createdByUserId: USER_ID,
    createdByActorKey: `user:${USER_ID}`,
    createdAt: CREATED_AT,
    audit: auditEvent(),
    ...overrides,
  };
}

function finalizeIntent(overrides = {}) {
  return {
    fileVersionId: FILE_VERSION_ID,
    storageObjectId: STORAGE_OBJECT_ID,
    expectedFileVersion: FILE_VERSION,
    expectedStorageVersion: STORAGE_VERSION,
    opaqueGeneration: "provider-opaque-generation-90071992547409931234",
    detectedMediaType: "application/pdf",
    byteSize: "33554432",
    sha256Checksum: CHECKSUM,
    verifiedAt: CREATED_AT + 1_000,
    audit: auditEvent({
      action: "file.upload_finalized",
      targetType: "file_version",
      targetId: FILE_VERSION_ID,
      occurredAt: CREATED_AT + 1_000,
    }),
    ...overrides,
  };
}

function failIntent(overrides = {}) {
  return {
    fileVersionId: FILE_VERSION_ID,
    storageObjectId: STORAGE_OBJECT_ID,
    expectedFileVersion: FILE_VERSION,
    expectedStorageVersion: STORAGE_VERSION,
    failureCode: "checksum_mismatch",
    failedAt: CREATED_AT + 1_000,
    audit: auditEvent({
      action: "file.upload_failed",
      targetType: "file_version",
      targetId: FILE_VERSION_ID,
      result: "failed",
      reasonCode: "checksum_mismatch",
      occurredAt: CREATED_AT + 1_000,
    }),
    ...overrides,
  };
}

function auditInsertStep(options = {}) {
  return step(
    /^INSERT INTO audit_events/,
    result([{ id: AUDIT_ID, recorded_at: RECORDED_AT }], 1),
    options,
  );
}

function uploadLockStep(row = {
  file_version: FILE_VERSION,
  file_status: "registered",
  storage_version: STORAGE_VERSION,
  storage_status: "pending",
}) {
  return step(
    /SELECT file_version\.row_version::text AS file_version[\s\S]*FOR UPDATE OF file_version, storage$/,
    row === null ? result([], 0) : result([row], 1),
  );
}

function releasedStorageRow(overrides = {}) {
  return {
    file_id: FILE_ID,
    file_version_id: FILE_VERSION_ID,
    storage_object_id: STORAGE_OBJECT_ID,
    provider: "gcs",
    container: "fci-released-test",
    object_key: "released/22222222-2222-4222-8222-222222222222",
    generation: "opaque-generation-9223372036854775807",
    media_type: "application/pdf",
    byte_size: "33554432",
    sha256_checksum: CHECKSUM,
    ...overrides,
  };
}

test("project upload reservation atomically writes file, version, storage, link, and audit evidence", async () => {
  const intent = reservationIntent();
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(
      /SELECT id FROM projects WHERE id = \$1 FOR KEY SHARE/,
      result([{ id: PROJECT_ID }], 1),
      { inspect: ({ values }) => assert.deepEqual(values, [PROJECT_ID]) },
    ),
    step(/^INSERT INTO files/, result([], 1)),
    step(
      /^INSERT INTO file_versions/,
      result([{ version: FILE_VERSION }], 1),
      {
        inspect: ({ values }) => {
          assert.equal(values[3], intent.originalFilename);
          assert.equal(values.includes(intent.objectKey), false);
        },
      },
    ),
    step(
      /^INSERT INTO storage_objects/,
      result([{ version: STORAGE_VERSION }], 1),
      {
        inspect: ({ values }) => {
          assert.equal(values[4], intent.objectKey);
          assert.equal(values.includes(intent.originalFilename), false);
        },
      },
    ),
    step(/^INSERT INTO file_links/, result([], 1)),
    auditInsertStep({
      inspect: ({ values }) => assert.deepEqual(values.slice(6, 11), [
        "file.upload_reserved",
        "file",
        FILE_ID,
        "succeeded",
        null,
      ]),
    }),
    step(/^COMMIT$/),
  ]);
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresFileMetadataRepository(pool, { schema: "file_test" });

  assert.deepEqual(await repository.reserveProjectUpload(intent), {
    outcome: "accepted",
    fileVersion: FILE_VERSION,
    storageVersion: STORAGE_VERSION,
  });
  assert.equal(pool.connectCount, 1);
  const kinds = client.queries.map(({ sql }) => sql.split("\n", 1)[0]);
  assert.deepEqual(kinds.slice(-7), [
    "SELECT id FROM projects WHERE id = $1 FOR KEY SHARE",
    "INSERT INTO files (",
    "INSERT INTO file_versions (",
    "INSERT INTO storage_objects (",
    "INSERT INTO file_links (",
    "INSERT INTO audit_events (",
    "COMMIT",
  ]);
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();
});

test("reservation requires an existing project and audits a missing-project conflict", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/SELECT id FROM projects WHERE id = \$1 FOR KEY SHARE/, result([], 0)),
    auditInsertStep({
      inspect: ({ values }) => assert.deepEqual(values.slice(6, 11), [
        "file.upload_reserved",
        "file",
        FILE_ID,
        "denied",
        "conflict",
      ]),
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresFileMetadataRepository(
    new ScriptedPostgresPool(client),
    { schema: "file_test" },
  );

  assert.deepEqual(await repository.reserveProjectUpload(reservationIntent()), { outcome: "conflict" });
  assert.equal(
    client.queries.some(({ sql }) => /^INSERT INTO (?:files|file_versions|storage_objects|file_links)/.test(sql)),
    false,
  );
  assert.equal(client.queries.filter(({ sql }) => /^INSERT INTO audit_events/.test(sql)).length, 1);
  client.assertComplete();
});

test("a named reservation conflict rolls back state and records denied audit evidence", async () => {
  const duplicate = Object.assign(new Error("simulated duplicate file"), {
    code: "23505",
    constraint: "files_pkey",
  });
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/SELECT id FROM projects WHERE id = \$1 FOR KEY SHARE/, result([{ id: PROJECT_ID }], 1)),
    step(/^INSERT INTO files/, result(), { error: duplicate }),
    step(/^ROLLBACK$/),
    ...transactionSetupSteps(),
    auditInsertStep({
      inspect: ({ values }) => assert.deepEqual(values.slice(6, 11), [
        "file.upload_reserved",
        "file",
        FILE_ID,
        "denied",
        "conflict",
      ]),
    }),
    step(/^COMMIT$/),
  ]);
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresFileMetadataRepository(pool, { schema: "file_test" });

  assert.deepEqual(await repository.reserveProjectUpload(reservationIntent()), {
    outcome: "conflict",
  });
  assert.equal(pool.connectCount, 2);
  client.assertComplete(2);
});

test("filename-leaking object keys are rejected before borrowing a connection", async () => {
  const unusedClient = new ScriptedPostgresClient([]);
  const pool = new ScriptedPostgresPool(unusedClient);
  const repository = createPostgresFileMetadataRepository(pool, { schema: "file_test" });

  for (const [originalFilename, objectKey] of [
    ["private_filename", "quarantine/private_filename"],
    ["Client Proposal.pdf", "quarantine/client_proposal_pdf"],
  ]) {
    await assert.rejects(
      repository.reserveProjectUpload(reservationIntent({ originalFilename, objectKey })),
      /must not contain the original filename/,
    );
  }
  assert.equal(pool.connectCount, 0);
  assert.deepEqual(unusedClient.queries, []);
  assert.deepEqual(unusedClient.releaseCalls, []);
});

test("file metadata enforces the object-storage contract before borrowing a connection", async () => {
  const client = new ScriptedPostgresClient([]);
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresFileMetadataRepository(pool, { schema: "file_test" });
  const cases = [
    () => repository.reserveProjectUpload(reservationIntent({ declaredMediaType: "application/pdf\n" })),
    () => repository.reserveProjectUpload(reservationIntent({ objectKey: `quarantine/${"a".repeat(513)}` })),
    () => repository.finalizeStoredUpload(finalizeIntent({ opaqueGeneration: "provider:generation" })),
    () => repository.finalizeStoredUpload(finalizeIntent({ byteSize: "33554433" })),
    () => repository.finalizeStoredUpload(finalizeIntent({ sha256Checksum: "not-a-checksum" })),
  ];

  for (const operation of cases) await assert.rejects(operation());
  assert.equal(pool.connectCount, 0);
  assert.deepEqual(client.queries, []);
});

test("finalization stores the opaque generation and advances only to quarantine", async () => {
  const intent = finalizeIntent();
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    uploadLockStep(),
    step(
      /^UPDATE storage_objects/,
      result([{ version: NEXT_STORAGE_VERSION }], 1),
      {
        inspect: ({ sql, values }) => {
          assert.match(sql, /generation = \$3, status = 'available'/);
          assert.equal(values[2], intent.opaqueGeneration);
          assert.equal(values[4], intent.byteSize);
        },
      },
    ),
    step(
      /^UPDATE file_versions/,
      result([{ version: NEXT_FILE_VERSION }], 1),
      {
        inspect: ({ sql, values }) => {
          assert.match(sql, /SET status = 'quarantined'/);
          assert.doesNotMatch(sql, /status = 'released'/);
          assert.equal(values[2], intent.byteSize);
        },
      },
    ),
    auditInsertStep({
      inspect: ({ values }) => assert.deepEqual(values.slice(6, 11), [
        "file.upload_stored",
        "file_version",
        FILE_VERSION_ID,
        "succeeded",
        null,
      ]),
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresFileMetadataRepository(
    new ScriptedPostgresPool(client),
    { schema: "file_test" },
  );

  assert.deepEqual(await repository.finalizeStoredUpload(intent), {
    outcome: "accepted",
    fileVersion: NEXT_FILE_VERSION,
    storageVersion: NEXT_STORAGE_VERSION,
  });
  assert.ok(
    client.queries.findIndex(({ sql }) => sql.startsWith("UPDATE file_versions"))
      < client.queries.findIndex(({ sql }) => sql.startsWith("INSERT INTO audit_events")),
  );
  client.assertComplete();
});

test("stale finalize and failure attempts append audit evidence without mutating file state", async (context) => {
  for (const [name, invoke] of [
    ["finalize", (repository) => repository.finalizeStoredUpload(finalizeIntent())],
    ["failure", (repository) => repository.failStoredUpload(failIntent())],
  ]) {
    await context.test(name, async () => {
      const client = new ScriptedPostgresClient([
        ...transactionSetupSteps(),
        uploadLockStep({
          file_version: NEXT_FILE_VERSION,
          file_status: "quarantined",
          storage_version: NEXT_STORAGE_VERSION,
          storage_status: "available",
        }),
        auditInsertStep({
          inspect: ({ values }) => assert.deepEqual(values.slice(6, 11), [
            name === "finalize" ? "file.upload_stored" : "file.upload_failed",
            "file_version",
            FILE_VERSION_ID,
            "denied",
            "stale_state",
          ]),
        }),
        step(/^COMMIT$/),
      ]);
      const repository = createPostgresFileMetadataRepository(
        new ScriptedPostgresPool(client),
        { schema: "file_test" },
      );

      assert.deepEqual(await invoke(repository), { outcome: "stale" });
      assert.equal(client.queries.some(({ sql }) => sql.startsWith("UPDATE ")), false);
      assert.equal(client.queries.filter(({ sql }) => sql.startsWith("INSERT INTO audit_events")).length, 1);
      client.assertComplete();
    });
  }
});

test("a recorded upload failure is a successful audited mutation", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    uploadLockStep(),
    step(/^UPDATE storage_objects/, result([{ version: NEXT_STORAGE_VERSION }], 1)),
    step(/^UPDATE file_versions/, result([{ version: NEXT_FILE_VERSION }], 1)),
    auditInsertStep({
      inspect: ({ values }) => assert.deepEqual(values.slice(6, 11), [
        "file.upload_failed",
        "file_version",
        FILE_VERSION_ID,
        "succeeded",
        null,
      ]),
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresFileMetadataRepository(
    new ScriptedPostgresPool(client),
    { schema: "file_test" },
  );

  assert.deepEqual(await repository.failStoredUpload(failIntent()), {
    outcome: "accepted",
    fileVersion: NEXT_FILE_VERSION,
    storageVersion: NEXT_STORAGE_VERSION,
  });
  client.assertComplete();
});

test("an audit insertion failure rolls the complete reservation back", async () => {
  const auditError = new Error("simulated audit failure");
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/SELECT id FROM projects WHERE id = \$1 FOR KEY SHARE/, result([{ id: PROJECT_ID }], 1)),
    step(/^INSERT INTO files/, result([], 1)),
    step(/^INSERT INTO file_versions/, result([{ version: FILE_VERSION }], 1)),
    step(/^INSERT INTO storage_objects/, result([{ version: STORAGE_VERSION }], 1)),
    step(/^INSERT INTO file_links/, result([], 1)),
    auditInsertStep({ error: auditError }),
    step(/^ROLLBACK$/),
  ]);
  const repository = createPostgresFileMetadataRepository(
    new ScriptedPostgresPool(client),
    { schema: "file_test" },
  );

  await assert.rejects(repository.reserveProjectUpload(reservationIntent()), (error) => error === auditError);
  assert.equal(client.queries.some(({ sql }) => sql === "COMMIT"), false);
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();
});

test("released storage reference parsing returns canonical object-storage size text", async () => {
  const byteSize = "33554432";
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(
      /^SELECT file\.id::text AS file_id/,
      result([releasedStorageRow({ byte_size: byteSize })], 1),
    ),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresFileMetadataRepository(
    new ScriptedPostgresPool(client),
    { schema: "file_test" },
  );

  assert.deepEqual(await repository.findReleasedStorageReference(FILE_ID), {
    fileId: FILE_ID,
    fileVersionId: FILE_VERSION_ID,
    storageObjectId: STORAGE_OBJECT_ID,
    provider: "gcs",
    container: "fci-released-test",
    objectKey: "released/22222222-2222-4222-8222-222222222222",
    opaqueGeneration: "opaque-generation-9223372036854775807",
    mediaType: "application/pdf",
    byteSize,
    sha256Checksum: CHECKSUM,
  });
  client.assertComplete();
});

test("released storage reference rejects database values outside the storage boundary", async () => {
  const cases = [
    { generation: "provider:generation" },
    { byte_size: "33554433" },
    { object_key: "released/../escape" },
    { media_type: "application/pdf\n" },
    { sha256_checksum: `sha256:${"A".repeat(64)}` },
  ];

  for (const overrides of cases) {
    const client = new ScriptedPostgresClient([
      ...transactionSetupSteps(),
      step(/^SELECT file\.id::text AS file_id/, result([releasedStorageRow(overrides)], 1)),
      step(/^ROLLBACK$/),
    ]);
    const repository = createPostgresFileMetadataRepository(
      new ScriptedPostgresPool(client),
      { schema: "file_test" },
    );
    await assert.rejects(repository.findReleasedStorageReference(FILE_ID));
    client.assertComplete();
  }
});
