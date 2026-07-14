import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CORE_REHEARSAL_ACKNOWLEDGMENT,
  CORE_REHEARSAL_IMPORTER_ROLE,
  CoreRecordRehearsalError,
  createCoreRecordRehearsalPlan,
  runCoreRecordRehearsal,
} from "../app/platform/migration/core-record-rehearsal.ts";
import { EXPECTED_PRODUCTION_SCHEMA_HISTORY } from "../app/platform/google-cloud/database-readiness.ts";
import {
  CORE_REHEARSAL_MAX_SNAPSHOT_BYTES,
  runCoreRehearsalCommand,
} from "../production-runtime/src/run-core-rehearsal.ts";

const fixtureUrl = new URL("fixtures/production-core-rehearsal.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const options = {
  targetEnvironment: "staging",
  targetSchema: "fci_rehearsal_core_20260713",
  acknowledgment: CORE_REHEARSAL_ACKNOWLEDGMENT,
};
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function clone(value) {
  return structuredClone(value);
}

function expectRefusal(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof CoreRecordRehearsalError);
    assert.equal(error.code, code);
    return true;
  });
}

test("bounded core rehearsal validates marked test data and emits row-free deterministic evidence", () => {
  const plan = createCoreRecordRehearsalPlan(fixture, options);
  assert.equal(plan.rows.clients[0].id, fixture.clients[0].id);
  assert.equal(plan.rows.contacts[0].id, fixture.contacts[0].id);
  assert.equal(plan.rows.projects[0].id, fixture.projects[0].id);
  assert.deepEqual(plan.rows.activityEvents.map((row) => row.id), fixture.activityEvents.map((row) => row.id));

  for (const evidence of Object.values(plan.sourceEvidence)) {
    assert.ok(SHA256_PATTERN.test(evidence.contentSha256));
    assert.ok(SHA256_PATTERN.test(evidence.identifiersSha256));
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(plan.sourceEvidence).map(([table, evidence]) => [table, evidence.count])),
    { clients: 1, contacts: 1, projects: 1, activityEvents: 2 },
  );

  const serializedEvidence = JSON.stringify(plan.sourceEvidence);
  assert.doesNotMatch(serializedEvidence, /FCI TEST|rehearsal@example\.test|11111111-1111/);

  const reordered = clone(fixture);
  reordered.activityEvents.reverse();
  assert.deepEqual(createCoreRecordRehearsalPlan(reordered, options).sourceEvidence, plan.sourceEvidence);
});

test("bounded core rehearsal refuses unsafe targets before connecting", () => {
  expectRefusal(
    () => createCoreRecordRehearsalPlan(fixture, { ...options, targetEnvironment: "production" }),
    "production_target_refused",
  );
  expectRefusal(
    () => createCoreRecordRehearsalPlan(fixture, { ...options, targetSchema: "fci_app" }),
    "unsafe_target_schema",
  );
  expectRefusal(
    () => createCoreRecordRehearsalPlan(fixture, { ...options, targetSchema: "fci_rehearsal_" }),
    "unsafe_target_schema",
  );
  expectRefusal(
    () => createCoreRecordRehearsalPlan(fixture, { ...options, acknowledgment: "yes" }),
    "acknowledgment_required",
  );
});

test("bounded core rehearsal refuses unmarked, deferred, unsupported, or remapped source data", () => {
  const unmarked = clone(fixture);
  unmarked.projects[0].name = "Unmarked project";
  expectRefusal(() => createCoreRecordRehearsalPlan(unmarked, options), "unsafe_test_record");

  const markerSuffix = clone(fixture);
  markerSuffix.clients[0].name = `Real client ${markerSuffix.clients[0].name}`;
  markerSuffix.clients[0].normalizedNameKey = "real client fci test — do not use client";
  expectRefusal(() => createCoreRecordRehearsalPlan(markerSuffix, options), "unsafe_test_record");

  const deferred = clone(fixture);
  deferred.deferredSourceCounts.leads = 1;
  expectRefusal(() => createCoreRecordRehearsalPlan(deferred, options), "deferred_source_data_present");

  const driveData = clone(fixture);
  driveData.clients[0].driveFolderId = "legacy-folder";
  expectRefusal(() => createCoreRecordRehearsalPlan(driveData, options), "unsupported_legacy_drive_data");

  const remappedId = clone(fixture);
  remappedId.clients[0].id = "E2E-CLIENT";
  expectRefusal(() => createCoreRecordRehearsalPlan(remappedId, options), "invalid_identifier");

  const unknownField = clone(fixture);
  unknownField.projects[0].futureField = "would otherwise be dropped";
  expectRefusal(() => createCoreRecordRehearsalPlan(unknownField, options), "unsupported_snapshot_field");

  const tooManyRows = clone(fixture);
  tooManyRows.clients = Array(5_001).fill(fixture.clients[0]);
  expectRefusal(() => createCoreRecordRehearsalPlan(tooManyRows, options), "snapshot_too_large");
});

test("bounded core rehearsal requires explicit activity classification and valid relationships", () => {
  const unclassified = clone(fixture);
  unclassified.activityEvents[0].result = "unknown";
  expectRefusal(() => createCoreRecordRehearsalPlan(unclassified, options), "unclassified_activity");

  const unsupportedRecord = clone(fixture);
  unsupportedRecord.activityEvents[0].recordType = "lead";
  expectRefusal(() => createCoreRecordRehearsalPlan(unsupportedRecord, options), "unclassified_activity");

  const orphan = clone(fixture);
  orphan.projects[0].clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expectRefusal(() => createCoreRecordRehearsalPlan(orphan, options), "orphan_source_record");

  const duplicatePrimary = clone(fixture);
  duplicatePrimary.contacts.push({
    ...clone(duplicatePrimary.contacts[0]),
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  expectRefusal(() => createCoreRecordRehearsalPlan(duplicatePrimary, options), "duplicate_source_value");
});

function destinationRows(source = fixture) {
  return {
    clients: source.clients.map((row) => ({
      id: row.id,
      clientCode: row.clientCode,
      name: row.name,
      normalizedNameKey: row.normalizedNameKey,
      status: row.status,
      industry: row.industry,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      version: row.version,
    })),
    contacts: source.contacts.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    })),
    projects: source.projects.map((row) => ({
      id: row.id,
      projectNumber: row.projectNumber,
      clientId: row.clientId,
      name: row.name,
      status: row.status,
      site: row.site,
      projectManager: row.projectManager,
      estimatedValue: row.estimatedValue === null ? null : String(row.estimatedValue),
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      version: row.version,
    })),
    activityEvents: source.activityEvents.map((row) => ({
      ...row,
      occurredAt: new Date(row.occurredAt),
    })),
  };
}

class FakeRehearsalClient {
  constructor({
    targetRows = destinationRows(),
    preflightCount = 0,
    failBegin = false,
    migrationHistory = EXPECTED_PRODUCTION_SCHEMA_HISTORY,
  } = {}) {
    this.targetRows = targetRows;
    this.preflightCount = preflightCount;
    this.failBegin = failBegin;
    this.migrationHistory = migrationHistory;
    this.queries = [];
    this.releasedWith = undefined;
  }

  async query(sql, values = []) {
    this.queries.push({ sql, values });
    if (sql === "BEGIN" && this.failBegin) throw new Error("lost begin response");
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rowCount: null, rows: [] };
    }
    if (sql.startsWith("SET LOCAL ROLE") || sql.startsWith("SET LOCAL lock_timeout") || sql.startsWith("SET LOCAL statement_timeout")) {
      return { rowCount: null, rows: [] };
    }
    if (sql.includes("current_user AS")) {
      return { rowCount: 1, rows: [{ currentUser: CORE_REHEARSAL_IMPORTER_ROLE }] };
    }
    if (sql.includes("set_config('search_path'")) return { rowCount: 1, rows: [{ set_config: values[0] }] };
    if (sql.includes("current_schema()")) return { rowCount: 1, rows: [{ currentSchema: options.targetSchema }] };
    if (sql.includes("pg_try_advisory_xact_lock")) return { rowCount: 1, rows: [{ acquired: true }] };
    if (sql.includes("FROM production_schema_migrations")) {
      return { rowCount: this.migrationHistory.length, rows: this.migrationHistory };
    }
    if (sql.includes("count(*)::text FROM clients")) {
      const count = String(this.preflightCount);
      return {
        rowCount: 1,
        rows: [{
          clients: count,
          contacts: "0",
          projects: "0",
          activityEvents: "0",
          idempotencyRequests: "0",
          outboxEvents: "0",
        }],
      };
    }
    if (sql.includes("count(*)::text FROM idempotency_requests")) {
      return { rowCount: 1, rows: [{ idempotencyRequests: "0", outboxEvents: "0" }] };
    }
    if (sql.startsWith("INSERT INTO clients")) return { rowCount: fixture.clients.length, rows: [] };
    if (sql.startsWith("INSERT INTO contacts")) return { rowCount: fixture.contacts.length, rows: [] };
    if (sql.startsWith("INSERT INTO projects")) return { rowCount: fixture.projects.length, rows: [] };
    if (sql.startsWith("INSERT INTO activity_events")) return { rowCount: fixture.activityEvents.length, rows: [] };
    if (sql.includes("FROM clients ORDER BY id")) return { rowCount: this.targetRows.clients.length, rows: this.targetRows.clients };
    if (sql.includes("FROM contacts ORDER BY id")) return { rowCount: this.targetRows.contacts.length, rows: this.targetRows.contacts };
    if (sql.includes("FROM projects ORDER BY id")) return { rowCount: this.targetRows.projects.length, rows: this.targetRows.projects };
    if (sql.includes("FROM activity_events ORDER BY id")) {
      return { rowCount: this.targetRows.activityEvents.length, rows: this.targetRows.activityEvents };
    }
    throw new Error(`Unexpected fake SQL shape: ${sql.slice(0, 40)}`);
  }

  release(error) {
    this.releasedWith = error;
  }
}

function fakePool(client) {
  return { connect: async () => client };
}

test("bounded core rehearsal uses the restricted role, reconciles inside one transaction, and emits no rows", async () => {
  const client = new FakeRehearsalClient();
  const report = await runCoreRecordRehearsal(fakePool(client), fixture, options);
  assert.equal(report.status, "reconciled");
  assert.equal(report.cutoverReady, false);
  assert.deepEqual(report.sideEffects, {
    idempotencyRequestsInserted: 0,
    outboxEventsInserted: 0,
    providerCalls: 0,
  });
  assert.ok(Object.values(report.tables).every((table) => table.matched));

  const sql = client.queries.map((query) => query.sql).join("\n");
  assert.match(sql, new RegExp(`SET LOCAL ROLE ${CORE_REHEARSAL_IMPORTER_ROLE}`));
  assert.match(sql, /BEGIN[\s\S]*COMMIT/);
  assert.doesNotMatch(sql, /INSERT INTO (?:idempotency_requests|outbox_events)/);
  assert.doesNotMatch(sql, /https?:|google|gmail|calendar|drive/i);
  assert.equal(client.releasedWith, undefined);
  const searchPathQuery = client.queries.find((query) => query.sql.includes("set_config('search_path'"));
  assert.deepEqual(searchPathQuery?.values, [`${options.targetSchema}, pg_catalog, pg_temp`]);
  assert.ok(
    client.queries.findIndex((query) => query.sql.includes("set_config('search_path'")) <
      client.queries.findIndex((query) => query.sql.startsWith("INSERT INTO clients")),
  );

  const serializedReport = JSON.stringify(report);
  assert.doesNotMatch(serializedReport, /FCI TEST|rehearsal@example\.test|11111111-1111/);
});

test("bounded core rehearsal rolls back rather than accepting target tampering", async () => {
  const tampered = destinationRows();
  tampered.projects[0].name = `${tampered.projects[0].name} changed`;
  const client = new FakeRehearsalClient({ targetRows: tampered });
  await assert.rejects(runCoreRecordRehearsal(fakePool(client), fixture, options), (error) => {
    assert.ok(error instanceof CoreRecordRehearsalError);
    assert.equal(error.code, "reconciliation_mismatch");
    return true;
  });
  assert.ok(client.queries.some((query) => query.sql === "ROLLBACK"));
  assert.ok(!client.queries.some((query) => query.sql === "COMMIT"));
});

test("bounded core rehearsal refuses a nonempty destination without inserting", async () => {
  const client = new FakeRehearsalClient({ preflightCount: 1 });
  await assert.rejects(runCoreRecordRehearsal(fakePool(client), fixture, options), (error) => {
    assert.ok(error instanceof CoreRecordRehearsalError);
    assert.equal(error.code, "nonempty_target");
    return true;
  });
  assert.ok(client.queries.some((query) => query.sql === "ROLLBACK"));
  assert.ok(!client.queries.some((query) => query.sql.startsWith("INSERT INTO")));
});

test("bounded core rehearsal requires the exact reviewed migration history before inserting", async () => {
  const client = new FakeRehearsalClient({
    migrationHistory: [{
      ...EXPECTED_PRODUCTION_SCHEMA_HISTORY[0],
      checksum: `sha256:${"0".repeat(64)}`,
    }],
  });
  await assert.rejects(runCoreRecordRehearsal(fakePool(client), fixture, options), (error) => {
    assert.ok(error instanceof CoreRecordRehearsalError);
    assert.equal(error.code, "schema_history_mismatch");
    return true;
  });
  assert.ok(client.queries.some((query) => query.sql.includes("FROM production_schema_migrations")));
  assert.ok(!client.queries.some((query) => query.sql.startsWith("INSERT INTO")));
  assert.ok(client.queries.some((query) => query.sql === "ROLLBACK"));
});

test("bounded core rehearsal rolls back and discards a connection after a lost BEGIN response", async () => {
  const client = new FakeRehearsalClient({ failBegin: true });
  await assert.rejects(runCoreRecordRehearsal(fakePool(client), fixture, options), (error) => {
    assert.ok(error instanceof CoreRecordRehearsalError);
    assert.equal(error.code, "database_operation_failed");
    return true;
  });
  assert.deepEqual(client.queries.slice(0, 2).map((query) => query.sql), ["BEGIN", "ROLLBACK"]);
  assert.ok(client.releasedWith instanceof Error);
});

function rehearsalConfig(deploymentStage = "staging") {
  return {
    appEnvironment: "production",
    deploymentStage,
    host: "0.0.0.0",
    port: 8080,
    postgres: {
      accessMode: "rehearsal",
      schema: options.targetSchema,
      pool: {
        max: 1,
        lockTimeoutMs: 5_000,
        statementTimeoutMs: 30_000,
      },
    },
  };
}

test("rehearsal command uses the shared validated pool and derives the real deployment stage", async () => {
  const client = new FakeRehearsalClient();
  let closed = false;
  const config = rehearsalConfig("staging");
  const report = await runCoreRehearsalCommand(
    ["--snapshot", fileURLToPath(fixtureUrl)],
    { FCI_REHEARSAL_ACKNOWLEDGMENT: CORE_REHEARSAL_ACKNOWLEDGMENT },
    {
      loadConfig: () => config,
      createPool: async (received) => {
        assert.equal(received, config);
        return {
          pool: fakePool(client),
          close: async () => {
            closed = true;
          },
        };
      },
    },
  );
  assert.equal(report.targetEnvironment, "staging");
  assert.equal(report.targetSchema, options.targetSchema);
  assert.equal(closed, true);
});

test("rehearsal command refuses the configured production stage before creating a pool", async () => {
  let poolCreated = false;
  await assert.rejects(
    runCoreRehearsalCommand(
      ["--snapshot", join(tmpdir(), "does-not-exist-fci-rehearsal.json")],
      { FCI_REHEARSAL_ACKNOWLEDGMENT: CORE_REHEARSAL_ACKNOWLEDGMENT },
      {
        loadConfig: () => rehearsalConfig("production"),
        createPool: async () => {
          poolCreated = true;
          throw new Error("must not be reached");
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof CoreRecordRehearsalError);
      assert.equal(error.code, "production_target_refused");
      return true;
    },
  );
  assert.equal(poolCreated, false);
});

test("rehearsal command rejects an oversized regular file before creating a pool", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fci-rehearsal-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "oversized.json");
  const file = await open(path, "w");
  await file.truncate(CORE_REHEARSAL_MAX_SNAPSHOT_BYTES + 1);
  await file.close();
  let poolCreated = false;

  await assert.rejects(
    runCoreRehearsalCommand(
      ["--snapshot", path],
      { FCI_REHEARSAL_ACKNOWLEDGMENT: CORE_REHEARSAL_ACKNOWLEDGMENT },
      {
        loadConfig: () => rehearsalConfig("staging"),
        createPool: async () => {
          poolCreated = true;
          throw new Error("must not be reached");
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof CoreRecordRehearsalError);
      assert.equal(error.code, "snapshot_too_large");
      return true;
    },
  );
  assert.equal(poolCreated, false);
});
