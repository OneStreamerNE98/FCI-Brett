import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24681 } },
});

const [clientAdapterModule, projectAdapterModule, outboxAdapterModule] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/postgres/client-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/project-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/outbox-repository.ts"),
]);

after(async () => {
  await vite.close();
});

const { createPostgresClientRepository } = clientAdapterModule;
const { createPostgresProjectRepository } = projectAdapterModule;
const { createPostgresOutboxRepository, deadLetterActivityId } = outboxAdapterModule;

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();
const MAX_SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);
const UNTRUSTED_FINGERPRINT = `sha256:${"0".repeat(64)}`;

test(
  "GitHub CI supplies PostgreSQL for repository integration coverage",
  { skip: process.env.GITHUB_ACTIONS !== "true" },
  () => {
    assert.ok(postgresTestUrl, "TEST_POSTGRES_URL must be configured in GitHub Actions");
  },
);

function clientCode(id) {
  return `CL-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function projectNumber(id, createdAt) {
  return `CF-${new Date(createdAt).getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function clientIntent({
  actorId,
  name,
  createdAt,
  id = randomUUID(),
  contactId = randomUUID(),
  activityId = randomUUID(),
  code = clientCode(id),
  contact = true,
}) {
  return {
    client: {
      id,
      clientCode: code,
      name,
      status: "active",
      industry: "Flooring",
      createdBy: actorId,
      createdAt,
      updatedAt: createdAt,
    },
    primaryContact: contact
      ? {
          id: contactId,
          clientId: id,
          name: "FCI TEST — DO NOT USE Contact",
          email: "postgres-test@example.test",
          phone: "555-0100",
          role: "Primary contact",
          isPrimary: true,
          createdAt,
          updatedAt: createdAt,
        }
      : null,
    activity: {
      id: activityId,
      recordId: id,
      action: "Client created",
      actor: actorId,
      detail: `${code} · ${name}`,
      createdAt,
    },
  };
}

function projectIntent({
  actorId,
  clientId,
  name,
  projectManagerId,
  estimatedValue,
  createdAt,
  id = randomUUID(),
  activityId = randomUUID(),
  number = projectNumber(id, createdAt),
}) {
  return {
    project: {
      id,
      projectNumber: number,
      clientId,
      name,
      status: "planning",
      site: "FCI TEST — DO NOT USE Site",
      projectManagerId,
      estimatedValue,
      createdBy: actorId,
      createdAt,
      updatedAt: createdAt,
    },
    activity: {
      id: activityId,
      recordId: id,
      action: "Project created",
      actor: actorId,
      detail: `${number} · ${name}`,
      createdAt,
    },
  };
}

function creationRequest({
  idempotencyKey,
  requestFingerprint,
  createdAt,
  idempotencyRequestId = randomUUID(),
  correlationId = `postgres-test:${randomUUID()}`,
  outboxEventId = randomUUID(),
}) {
  return {
    idempotencyRequestId,
    idempotencyKey,
    requestFingerprint,
    correlationId,
    expiresAt: createdAt + 60 * 60 * 1000,
    outboxEventId,
  };
}

async function oneRow(pool, sql, values = []) {
  const result = await pool.query(sql, values);
  assert.equal(result.rows.length, 1, "query must return exactly one row");
  return result.rows[0];
}

async function insertPendingOutbox(pool, schema, {
  id,
  eventType,
  clientId = null,
  projectId = null,
  actorId,
  createdAt,
  availableAt,
  version = "1",
}) {
  await pool.query(
    `INSERT INTO ${schema}.outbox_events (
       id, event_key, event_type, client_id, project_id, actor_id,
       correlation_id, payload, status, available_at, attempt_count,
       created_at, updated_at, version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending',
       $9, 0, $10, $10, $11::bigint)`,
    [
      id,
      `repository-test:${id}`,
      eventType,
      clientId,
      projectId,
      actorId,
      `repository-test:${id}`,
      JSON.stringify({ testRecord: "FCI TEST — DO NOT USE" }),
      new Date(availableAt),
      new Date(createdAt),
      version,
    ],
  );
}

async function insertProcessingOutbox(pool, schema, {
  id,
  eventType,
  clientId = null,
  projectId = null,
  actorId,
  createdAt,
  availableAt = createdAt,
  leaseExpiresAt,
  attemptCount = 1,
  version = "2",
}) {
  await pool.query(
    `INSERT INTO ${schema}.outbox_events (
       id, event_key, event_type, client_id, project_id, actor_id,
       correlation_id, payload, status, available_at, attempt_count,
       lease_expires_at, created_at, updated_at, version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'processing',
       $9, $10, $11, $12, $12, $13::bigint)`,
    [
      id,
      `repository-test:${id}`,
      eventType,
      clientId,
      projectId,
      actorId,
      `repository-test:${id}`,
      JSON.stringify({ testRecord: "FCI TEST — DO NOT USE" }),
      new Date(availableAt),
      attemptCount,
      new Date(leaseExpiresAt),
      new Date(createdAt),
      version,
    ],
  );
}

test(
  "PostgreSQL 16 repositories preserve idempotency, atomic evidence, exact values, and worker-safe outbox transitions",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 90_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 12 });
    const schema = `fci_repositories_${randomUUID().replaceAll("-", "")}`;
    let schemaCreated = false;

    try {
      const version = await oneRow(
        pool,
        "SELECT current_setting('server_version_num')::integer AS server_version_num",
      );
      assert.equal(
        Math.floor(version.server_version_num / 10_000),
        16,
        `repository integration coverage requires PostgreSQL 16, received ${version.server_version_num}`,
      );

      await pool.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema });

      const actorA = "postgres-agent-a@example.test";
      const actorB = "postgres-agent-b@example.test";
      const sharedKey = "repository-shared-key";
      const raceCreatedAt = Date.now();
      const raceName = "FCI TEST — DO NOT USE Concurrent Client";
      const raceFingerprint = UNTRUSTED_FINGERPRINT;
      const raceIntents = Array.from({ length: 8 }, () => clientIntent({
        actorId: actorA,
        name: raceName,
        createdAt: raceCreatedAt,
      }));
      const raceRequests = raceIntents.map(() => creationRequest({
        idempotencyKey: sharedKey,
        requestFingerprint: raceFingerprint,
        createdAt: raceCreatedAt,
      }));

      const raceResults = await Promise.all(raceIntents.map((intent, index) => (
        createPostgresClientRepository(pool, {
          schema,
          request: raceRequests[index],
        }).create(intent)
      )));
      assert.ok(raceResults.every((result) => result.outcome === "accepted"));
      assert.equal(raceResults.filter((result) => result.replayed === false).length, 1);
      assert.equal(raceResults.filter((result) => result.replayed === true).length, 7);
      assert.equal(new Set(raceResults.map((result) => result.value.id)).size, 1);
      assert.equal(new Set(raceResults.map((result) => result.value.version)).size, 1);
      assert.equal(raceResults[0].value.version, "1");

      const winningClientId = raceResults[0].value.id;
      const winningIntent = raceIntents.find((intent) => intent.client.id === winningClientId);
      assert.ok(winningIntent, "one concurrent intent must own the accepted client ID");
      const atomicClientState = await oneRow(
        pool,
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.clients WHERE id = $1) AS clients,
           (SELECT count(*)::integer FROM ${schema}.contacts WHERE client_id = $1) AS contacts,
           (SELECT count(*)::integer FROM ${schema}.activity_events WHERE client_id = $1) AS activities,
           (SELECT count(*)::integer FROM ${schema}.outbox_events WHERE client_id = $1) AS outbox_events,
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests
             WHERE actor_id = $2 AND operation = 'clients.create' AND idempotency_key = $3) AS requests`,
        [winningClientId, actorA, sharedKey],
      );
      assert.deepEqual(atomicClientState, {
        clients: 1,
        contacts: 1,
        activities: 1,
        outbox_events: 1,
        requests: 1,
      });
      const completedRequest = await oneRow(
        pool,
        `SELECT request_fingerprint, status, response_status, response_body, version::text AS version
         FROM ${schema}.idempotency_requests
         WHERE actor_id = $1 AND operation = 'clients.create' AND idempotency_key = $2`,
        [actorA, sharedKey],
      );
      assert.equal(completedRequest.status, "completed");
      assert.equal(completedRequest.response_status, 201);
      assert.equal(completedRequest.response_body.id, winningClientId);
      assert.equal(completedRequest.version, "2");
      assert.match(completedRequest.request_fingerprint, /^sha256:[0-9a-f]{64}$/);
      assert.notEqual(
        completedRequest.request_fingerprint,
        raceFingerprint,
        "the adapter must ignore a caller-supplied fingerprint and bind the hash to normalized intent",
      );

      const conflictIntent = clientIntent({
        actorId: actorA,
        name: "FCI TEST — DO NOT USE Fingerprint Conflict",
        createdAt: raceCreatedAt,
      });
      const conflictResult = await createPostgresClientRepository(pool, {
        schema,
        request: creationRequest({
          idempotencyKey: sharedKey,
          requestFingerprint: raceFingerprint,
          createdAt: raceCreatedAt,
        }),
      }).create(conflictIntent);
      assert.deepEqual(conflictResult, { outcome: "idempotency-conflict" });
      const conflictState = await oneRow(
        pool,
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.clients WHERE id = $1) AS clients,
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests
             WHERE actor_id = $2 AND operation = 'clients.create' AND idempotency_key = $3) AS requests`,
        [conflictIntent.client.id, actorA, sharedKey],
      );
      assert.deepEqual(conflictState, { clients: 0, requests: 1 });

      const actorScopedIntent = clientIntent({
        actorId: actorB,
        name: "FCI TEST — DO NOT USE Actor Scoped Client",
        createdAt: raceCreatedAt,
      });
      const actorScopedFingerprint = UNTRUSTED_FINGERPRINT;
      const actorScopedResult = await createPostgresClientRepository(pool, {
        schema,
        request: creationRequest({
          idempotencyKey: sharedKey,
          requestFingerprint: actorScopedFingerprint,
          createdAt: raceCreatedAt,
        }),
      }).create(actorScopedIntent);
      assert.equal(actorScopedResult.outcome, "accepted");
      assert.equal(actorScopedResult.replayed, false);

      const unicodeCreatedAt = Date.now();
      const unicodeIntent = clientIntent({
        actorId: actorA,
        name: "  ＦＣＩ\u00a0TEST  ",
        createdAt: unicodeCreatedAt,
      });
      const unicodeResult = await createPostgresClientRepository(pool, {
        schema,
        request: creationRequest({
          idempotencyKey: "unicode-client-first",
          requestFingerprint: UNTRUSTED_FINGERPRINT,
          createdAt: unicodeCreatedAt,
        }),
      }).create(unicodeIntent);
      assert.equal(unicodeResult.outcome, "accepted");
      const unicodeRow = await oneRow(
        pool,
        `SELECT name, normalized_name_key FROM ${schema}.clients WHERE id = $1`,
        [unicodeIntent.client.id],
      );
      assert.equal(unicodeRow.name, unicodeIntent.client.name);
      assert.equal(unicodeRow.normalized_name_key, "fci test");

      const unicodeDuplicateIntent = clientIntent({
        actorId: actorA,
        name: "FCI\tTEST",
        createdAt: unicodeCreatedAt,
      });
      const unicodeDuplicateRequest = creationRequest({
        idempotencyKey: "unicode-client-duplicate",
        requestFingerprint: UNTRUSTED_FINGERPRINT,
        createdAt: unicodeCreatedAt,
      });
      const unicodeDuplicateResult = await createPostgresClientRepository(pool, {
        schema,
        request: unicodeDuplicateRequest,
      }).create(unicodeDuplicateIntent);
      assert.deepEqual(unicodeDuplicateResult, { outcome: "duplicate" });
      const unicodeDuplicateState = await oneRow(
        pool,
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.clients WHERE id = $1) AS clients,
           (SELECT count(*)::integer FROM ${schema}.contacts WHERE id = $2) AS contacts,
           (SELECT count(*)::integer FROM ${schema}.activity_events WHERE id = $3) AS activities,
           (SELECT count(*)::integer FROM ${schema}.outbox_events WHERE id = $4) AS outbox_events,
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests WHERE id = $5) AS requests`,
        [
          unicodeDuplicateIntent.client.id,
          unicodeDuplicateIntent.primaryContact.id,
          unicodeDuplicateIntent.activity.id,
          unicodeDuplicateRequest.outboxEventId,
          unicodeDuplicateRequest.idempotencyRequestId,
        ],
      );
      assert.deepEqual(unicodeDuplicateState, {
        clients: 0,
        contacts: 0,
        activities: 0,
        outbox_events: 0,
        requests: 1,
      });
      assert.deepEqual(
        await createPostgresClientRepository(pool, {
          schema,
          request: unicodeDuplicateRequest,
        }).create(unicodeDuplicateIntent),
        { outcome: "duplicate" },
        "the stored duplicate failure must replay without attempting another write",
      );
      const unicodeDuplicateReplayState = await oneRow(
        pool,
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.clients WHERE id = $1) AS clients,
           (SELECT count(*)::integer FROM ${schema}.activity_events WHERE id = $2) AS activities,
           (SELECT count(*)::integer FROM ${schema}.outbox_events WHERE id = $3) AS outbox_events,
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests WHERE id = $4) AS requests,
           (SELECT version::text FROM ${schema}.idempotency_requests WHERE id = $4) AS request_version`,
        [
          unicodeDuplicateIntent.client.id,
          unicodeDuplicateIntent.activity.id,
          unicodeDuplicateRequest.outboxEventId,
          unicodeDuplicateRequest.idempotencyRequestId,
        ],
      );
      assert.deepEqual(unicodeDuplicateReplayState, {
        clients: 0,
        activities: 0,
        outbox_events: 0,
        requests: 1,
        request_version: "2",
      });

      const collisionOutboxId = randomUUID();
      const collisionCreatedAt = Date.now();
      await pool.query(
        `INSERT INTO ${schema}.outbox_events (
           id, event_key, event_type, client_id, actor_id, correlation_id,
           payload, status, available_at, created_at, updated_at, version
         ) VALUES ($1, $2, 'client.created', $3, $4, $5, '{}'::jsonb,
           'pending', $6, $6, $6, 1)`,
        [
          collisionOutboxId,
          `collision-seed:${collisionOutboxId}`,
          winningClientId,
          actorA,
          `collision-seed:${collisionOutboxId}`,
          new Date(collisionCreatedAt),
        ],
      );
      const rollbackIntent = clientIntent({
        actorId: actorA,
        name: "FCI TEST — DO NOT USE Outbox Rollback",
        createdAt: collisionCreatedAt,
      });
      const rollbackRequest = creationRequest({
        idempotencyKey: "late-outbox-collision",
        requestFingerprint: UNTRUSTED_FINGERPRINT,
        createdAt: collisionCreatedAt,
        outboxEventId: collisionOutboxId,
      });
      assert.deepEqual(
        await createPostgresClientRepository(pool, { schema, request: rollbackRequest }).create(rollbackIntent),
        { outcome: "identifier-collision" },
      );
      const rollbackState = await oneRow(
        pool,
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.clients WHERE id = $1) AS clients,
           (SELECT count(*)::integer FROM ${schema}.contacts WHERE id = $2) AS contacts,
           (SELECT count(*)::integer FROM ${schema}.activity_events WHERE id = $3) AS activities,
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests WHERE id = $4) AS requests,
           (SELECT count(*)::integer FROM ${schema}.outbox_events WHERE id = $5) AS collision_seed`,
        [
          rollbackIntent.client.id,
          rollbackIntent.primaryContact.id,
          rollbackIntent.activity.id,
          rollbackRequest.idempotencyRequestId,
          collisionOutboxId,
        ],
      );
      assert.deepEqual(rollbackState, {
        clients: 0,
        contacts: 0,
        activities: 0,
        requests: 0,
        collision_seed: 1,
      });

      const missingProjectCreatedAt = Date.now();
      const missingProjectIntent = projectIntent({
        actorId: actorA,
        clientId: randomUUID(),
        name: "FCI TEST — DO NOT USE Missing Client Project",
        projectManagerId: actorA,
        estimatedValue: 100,
        createdAt: missingProjectCreatedAt,
      });
      const missingProjectRequest = creationRequest({
        idempotencyKey: "missing-client-project",
        requestFingerprint: UNTRUSTED_FINGERPRINT,
        createdAt: missingProjectCreatedAt,
      });
      const missingProjectResult = await createPostgresProjectRepository(pool, {
        schema,
        request: missingProjectRequest,
      }).create(missingProjectIntent);
      assert.deepEqual(missingProjectResult, { outcome: "client-not-found" });
      const missingProjectState = await oneRow(
        pool,
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.projects WHERE id = $1) AS projects,
           (SELECT count(*)::integer FROM ${schema}.activity_events WHERE id = $2) AS activities,
           (SELECT count(*)::integer FROM ${schema}.outbox_events WHERE id = $3) AS outbox_events,
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests WHERE id = $4) AS requests,
           (SELECT status FROM ${schema}.idempotency_requests WHERE id = $4) AS request_status`,
        [
          missingProjectIntent.project.id,
          missingProjectIntent.activity.id,
          missingProjectRequest.outboxEventId,
          missingProjectRequest.idempotencyRequestId,
        ],
      );
      assert.deepEqual(missingProjectState, {
        projects: 0,
        activities: 0,
        outbox_events: 0,
        requests: 1,
        request_status: "failed",
      });
      assert.deepEqual(
        await createPostgresProjectRepository(pool, {
          schema,
          request: missingProjectRequest,
        }).create(missingProjectIntent),
        { outcome: "client-not-found" },
        "the stored missing-client failure must replay without another project write",
      );
      const missingProjectReplayState = await oneRow(
        pool,
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.projects WHERE id = $1) AS projects,
           (SELECT count(*)::integer FROM ${schema}.activity_events WHERE id = $2) AS activities,
           (SELECT count(*)::integer FROM ${schema}.outbox_events WHERE id = $3) AS outbox_events,
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests WHERE id = $4) AS requests,
           (SELECT version::text FROM ${schema}.idempotency_requests WHERE id = $4) AS request_version`,
        [
          missingProjectIntent.project.id,
          missingProjectIntent.activity.id,
          missingProjectRequest.outboxEventId,
          missingProjectRequest.idempotencyRequestId,
        ],
      );
      assert.deepEqual(missingProjectReplayState, {
        projects: 0,
        activities: 0,
        outbox_events: 0,
        requests: 1,
        request_version: "2",
      });

      const changedMissingProjectIntent = projectIntent({
        actorId: actorA,
        clientId: winningClientId,
        name: "FCI TEST — DO NOT USE Changed Missing Client Request",
        projectManagerId: actorA,
        estimatedValue: 100,
        createdAt: missingProjectCreatedAt,
      });
      assert.deepEqual(
        await createPostgresProjectRepository(pool, {
          schema,
          request: {
            ...missingProjectRequest,
            idempotencyRequestId: randomUUID(),
            outboxEventId: randomUUID(),
          },
        }).create(changedMissingProjectIntent),
        { outcome: "idempotency-conflict" },
        "a deterministic 404 must bind the key to the original request body",
      );

      const projectCreatedAt = Date.now();
      const acceptedProjectIntent = projectIntent({
        actorId: actorA,
        clientId: winningClientId,
        name: "FCI TEST — DO NOT USE Maximum Value Project",
        projectManagerId: actorA,
        estimatedValue: Number.MAX_SAFE_INTEGER,
        createdAt: projectCreatedAt,
      });
      const projectRequest = creationRequest({
        idempotencyKey: sharedKey,
        requestFingerprint: UNTRUSTED_FINGERPRINT,
        createdAt: projectCreatedAt,
      });
      const acceptedProjectResult = await createPostgresProjectRepository(pool, {
        schema,
        request: projectRequest,
      }).create(acceptedProjectIntent);
      assert.equal(acceptedProjectResult.outcome, "accepted");
      assert.equal(acceptedProjectResult.replayed, false);
      assert.equal(acceptedProjectResult.value.estimatedValue, Number.MAX_SAFE_INTEGER);
      assert.equal(acceptedProjectResult.value.version, "1");
      const projectState = await oneRow(
        pool,
        `SELECT p.estimated_value::text AS estimated_value,
                p.version::text AS version,
                (SELECT count(*)::integer FROM ${schema}.activity_events WHERE project_id = p.id) AS activities,
                (SELECT count(*)::integer FROM ${schema}.outbox_events WHERE project_id = p.id) AS outbox_events,
                (SELECT count(*)::integer FROM ${schema}.idempotency_requests
                  WHERE actor_id = $2 AND operation = 'projects.create' AND idempotency_key = $3) AS requests
         FROM ${schema}.projects p WHERE p.id = $1`,
        [acceptedProjectIntent.project.id, actorA, sharedKey],
      );
      assert.deepEqual(projectState, {
        estimated_value: MAX_SAFE_INTEGER_TEXT,
        version: "1",
        activities: 1,
        outbox_events: 1,
        requests: 1,
      });

      const scopedRequests = await pool.query(
        `SELECT actor_id, operation, count(*)::integer AS total
         FROM ${schema}.idempotency_requests
         WHERE idempotency_key = $1
         GROUP BY actor_id, operation
         ORDER BY actor_id, operation`,
        [sharedKey],
      );
      assert.deepEqual(scopedRequests.rows, [
        { actor_id: actorA, operation: "clients.create", total: 1 },
        { actor_id: actorA, operation: "projects.create", total: 1 },
        { actor_id: actorB, operation: "clients.create", total: 1 },
      ]);

      await pool.query(
        `UPDATE ${schema}.projects SET version = $2::bigint WHERE id = $1`,
        [acceptedProjectIntent.project.id, MAX_SAFE_INTEGER_TEXT],
      );
      const managerActivityId = randomUUID();
      const changedManager = "replacement-manager@example.test";
      const managerResult = await createPostgresProjectRepository(pool, { schema }).assignManager({
        projectId: acceptedProjectIntent.project.id,
        projectManagerId: changedManager,
        updatedAt: projectCreatedAt + 1_000,
        activity: {
          id: managerActivityId,
          recordId: acceptedProjectIntent.project.id,
          action: "Project manager assigned",
          actor: actorA,
          detail: `Project manager assigned to ${changedManager}`,
          createdAt: projectCreatedAt + 1_000,
        },
      });
      assert.deepEqual(managerResult, { outcome: "updated" });
      const managerState = await oneRow(
        pool,
        `SELECT project_manager, updated_by, version::text AS version,
                (SELECT count(*)::integer FROM ${schema}.activity_events WHERE id = $2) AS activities
         FROM ${schema}.projects WHERE id = $1`,
        [acceptedProjectIntent.project.id, managerActivityId],
      );
      assert.deepEqual(managerState, {
        project_manager: changedManager,
        updated_by: actorA,
        version: "9007199254740992",
        activities: 1,
      });
      const missingManagerActivityId = randomUUID();
      const missingManagerProjectId = randomUUID();
      const missingManagerResult = await createPostgresProjectRepository(pool, { schema }).assignManager({
        projectId: missingManagerProjectId,
        projectManagerId: changedManager,
        updatedAt: projectCreatedAt + 2_000,
        activity: {
          id: missingManagerActivityId,
          recordId: missingManagerProjectId,
          action: "Project manager assigned",
          actor: actorA,
          detail: `Project manager assigned to ${changedManager}`,
          createdAt: projectCreatedAt + 2_000,
        },
      });
      assert.deepEqual(missingManagerResult, { outcome: "project-not-found" });
      const missingManagerActivity = await oneRow(
        pool,
        `SELECT count(*)::integer AS total FROM ${schema}.activity_events WHERE id = $1`,
        [missingManagerActivityId],
      );
      assert.equal(missingManagerActivity.total, 0);

      await pool.query(`DELETE FROM ${schema}.outbox_events`);
      const outboxCreatedAt = Date.now() - 120_000;
      const outboxAvailableAt = Date.now() - 60_000;
      const outboxIds = Array.from({ length: 5 }, () => randomUUID());
      await Promise.all(outboxIds.map((id, index) => insertPendingOutbox(pool, schema, {
        id,
        eventType: index % 2 === 0 ? "client.created" : "project.created",
        clientId: index % 2 === 0 ? winningClientId : null,
        projectId: index % 2 === 1 ? acceptedProjectIntent.project.id : null,
        actorId: actorA,
        createdAt: outboxCreatedAt,
        availableAt: outboxAvailableAt,
        version: index === 0 ? MAX_SAFE_INTEGER_TEXT : "1",
      })));

      const outboxRepository = createPostgresOutboxRepository(pool, { schema });
      const lockClient = await pool.connect();
      let lockedOutboxId;
      let skipLockedClaims;
      try {
        await lockClient.query("BEGIN");
        const lockedCandidate = await lockClient.query(
          `SELECT id::text AS id
           FROM ${schema}.outbox_events
           WHERE status = 'pending' AND available_at <= pg_catalog.now()
           ORDER BY available_at, created_at, id
           LIMIT 1
           FOR UPDATE`,
        );
        assert.equal(lockedCandidate.rowCount, 1);
        lockedOutboxId = lockedCandidate.rows[0].id;
        const boundedOutboxRepository = createPostgresOutboxRepository(pool, {
          schema,
          lockTimeoutMs: 1_000,
          statementTimeoutMs: 2_000,
        });
        skipLockedClaims = await boundedOutboxRepository.claimAvailable({
          batchSize: 1,
          leaseDurationMs: 60_000,
        });
        assert.equal(skipLockedClaims.length, 1);
        assert.notEqual(
          skipLockedClaims[0].id,
          lockedOutboxId,
          "a held lock on the oldest event must not block another worker",
        );
      } finally {
        await lockClient.query("ROLLBACK");
        lockClient.release();
      }

      const [firstClaims, secondClaims] = await Promise.all([
        outboxRepository.claimAvailable({ batchSize: 2, leaseDurationMs: 60_000 }),
        outboxRepository.claimAvailable({ batchSize: 2, leaseDurationMs: 60_000 }),
      ]);
      assert.equal(skipLockedClaims.length + firstClaims.length + secondClaims.length, 5);
      const firstClaimIds = new Set([...skipLockedClaims, ...firstClaims].map((event) => event.id));
      assert.ok(secondClaims.every((event) => !firstClaimIds.has(event.id)));
      const claimedById = new Map(
        [...skipLockedClaims, ...firstClaims, ...secondClaims].map((event) => [event.id, event]),
      );
      assert.deepEqual(new Set(claimedById.keys()), new Set(outboxIds));
      for (const id of outboxIds) {
        const claimed = claimedById.get(id);
        assert.equal(claimed.attemptCount, 1);
        assert.ok(claimed.leaseExpiresAt > Date.now());
      }
      assert.equal(claimedById.get(outboxIds[0]).version, "9007199254740992");
      for (const id of outboxIds.slice(1)) assert.equal(claimedById.get(id).version, "2");

      const completionClaim = claimedById.get(outboxIds[0]);
      const completion = await outboxRepository.complete({
        eventId: completionClaim.id,
        expectedVersion: completionClaim.version,
      });
      assert.equal(completion.outcome, "completed");
      assert.equal(completion.version, "9007199254740993");
      assert.deepEqual(
        await outboxRepository.complete({
          eventId: completionClaim.id,
          expectedVersion: completionClaim.version,
        }),
        { outcome: "stale" },
      );

      const retryClaim = claimedById.get(outboxIds[1]);
      const retry = await outboxRepository.retryOrDeadLetter({
        eventId: retryClaim.id,
        expectedVersion: retryClaim.version,
        retryDelayMs: 60_000,
        maxAttempts: 3,
        errorCode: "provider_unavailable",
        errorMessage: "FCI TEST — DO NOT USE transient provider failure.",
      });
      assert.equal(retry.outcome, "retry");
      assert.equal(retry.version, "3");
      assert.deepEqual(
        await outboxRepository.retryOrDeadLetter({
          eventId: retryClaim.id,
          expectedVersion: retryClaim.version,
          retryDelayMs: 60_000,
          maxAttempts: 3,
          errorCode: "provider_unavailable",
          errorMessage: "FCI TEST — DO NOT USE stale retry.",
        }),
        { outcome: "stale" },
      );
      const retryState = await oneRow(
        pool,
        `SELECT status, lease_expires_at, last_error_code, version::text AS version
         FROM ${schema}.outbox_events WHERE id = $1`,
        [retryClaim.id],
      );
      assert.deepEqual(retryState, {
        status: "pending",
        lease_expires_at: null,
        last_error_code: "provider_unavailable",
        version: "3",
      });

      const deadClaim = claimedById.get(outboxIds[2]);
      const dead = await outboxRepository.retryOrDeadLetter({
        eventId: deadClaim.id,
        expectedVersion: deadClaim.version,
        retryDelayMs: 0,
        maxAttempts: 1,
        errorCode: "attempts_exhausted",
        errorMessage: "FCI TEST — DO NOT USE exhausted delivery.",
      });
      assert.equal(dead.outcome, "dead-lettered");
      assert.equal(dead.version, "3");
      assert.ok(Number.isSafeInteger(dead.deadLetteredAt));
      const deadState = await oneRow(
        pool,
        `SELECT status, lease_expires_at, dead_lettered_at IS NOT NULL AS has_dead_letter_time,
                last_error_code, version::text AS version
         FROM ${schema}.outbox_events WHERE id = $1`,
        [deadClaim.id],
      );
      assert.deepEqual(deadState, {
        status: "dead",
        lease_expires_at: null,
        has_dead_letter_time: true,
        last_error_code: "attempts_exhausted",
        version: "3",
      });
      const deadActivity = await oneRow(
        pool,
        `SELECT client_id::text AS client_id, project_id::text AS project_id,
                action, actor_id, correlation_id, result, reason, detail
         FROM ${schema}.activity_events WHERE id = $1`,
        [deadLetterActivityId(deadClaim.id)],
      );
      assert.deepEqual(deadActivity, {
        client_id: winningClientId,
        project_id: null,
        action: "Outbox event dead-lettered",
        actor_id: actorA,
        correlation_id: `repository-test:${deadClaim.id}`,
        result: "failed",
        reason: "attempts_exhausted",
        detail: {
          outboxEventId: deadClaim.id,
          eventKey: `repository-test:${deadClaim.id}`,
          eventType: "client.created",
          attemptCount: 1,
          errorCode: "attempts_exhausted",
          errorMessage: "FCI TEST — DO NOT USE exhausted delivery.",
        },
      });

      const expiredClaim = claimedById.get(outboxIds[3]);
      const activeClaim = claimedById.get(outboxIds[4]);
      await pool.query(
        `UPDATE ${schema}.outbox_events
         SET lease_expires_at = CASE
           WHEN id = $1 THEN pg_catalog.now() - interval '1 minute'
           WHEN id = $2 THEN pg_catalog.now() + interval '1 day'
           ELSE lease_expires_at
         END
         WHERE id IN ($1, $2)`,
        [expiredClaim.id, activeClaim.id],
      );
      const recovered = await outboxRepository.recoverExpiredLeases({
        batchSize: 5,
        retryDelayMs: 0,
        maxAttempts: 3,
      });
      assert.deepEqual(recovered.map(({ id, outcome, version }) => ({ id, outcome, version })), [
        { id: expiredClaim.id, outcome: "retry", version: "3" },
      ]);
      const recoveryState = await pool.query(
        `SELECT id::text AS id, status, lease_expires_at,
                last_error_code, version::text AS version
         FROM ${schema}.outbox_events
         WHERE id IN ($1, $2)
         ORDER BY id`,
        [expiredClaim.id, activeClaim.id],
      );
      const recoveredRow = recoveryState.rows.find((row) => row.id === expiredClaim.id);
      const activeRow = recoveryState.rows.find((row) => row.id === activeClaim.id);
      assert.deepEqual(recoveredRow, {
        id: expiredClaim.id,
        status: "pending",
        lease_expires_at: null,
        last_error_code: "lease_expired",
        version: "3",
      });
      assert.equal(activeRow.status, "processing");
      assert.ok(activeRow.lease_expires_at instanceof Date);
      assert.equal(activeRow.last_error_code, null);
      assert.equal(activeRow.version, "2");

      const recoveryContentionIds = [randomUUID(), randomUUID()];
      const recoveryContentionCreatedAt = Date.now() - 180_000;
      const recoveryContentionLeaseAt = Date.now() - 60_000;
      await Promise.all(recoveryContentionIds.map((id) => insertProcessingOutbox(pool, schema, {
        id,
        eventType: "client.created",
        clientId: winningClientId,
        actorId: actorA,
        createdAt: recoveryContentionCreatedAt,
        leaseExpiresAt: recoveryContentionLeaseAt,
      })));
      const recoveryLockClient = await pool.connect();
      let lockedRecoveryId;
      let skipLockedRecovery;
      try {
        await recoveryLockClient.query("BEGIN");
        const lockedRecoveryCandidate = await recoveryLockClient.query(
          `SELECT id::text AS id
           FROM ${schema}.outbox_events
           WHERE status = 'processing' AND lease_expires_at <= pg_catalog.now()
           ORDER BY lease_expires_at, id
           LIMIT 1
           FOR UPDATE`,
        );
        assert.equal(lockedRecoveryCandidate.rowCount, 1);
        lockedRecoveryId = lockedRecoveryCandidate.rows[0].id;
        const boundedRecoveryRepository = createPostgresOutboxRepository(pool, {
          schema,
          lockTimeoutMs: 1_000,
          statementTimeoutMs: 2_000,
        });
        skipLockedRecovery = await boundedRecoveryRepository.recoverExpiredLeases({
          batchSize: 1,
          retryDelayMs: 0,
          maxAttempts: 3,
        });
        assert.equal(skipLockedRecovery.length, 1);
        assert.notEqual(
          skipLockedRecovery[0].id,
          lockedRecoveryId,
          "a held expired lease must not block recovery of another event",
        );
      } finally {
        await recoveryLockClient.query("ROLLBACK");
        recoveryLockClient.release();
      }
      const remainingRecovery = await outboxRepository.recoverExpiredLeases({
        batchSize: 1,
        retryDelayMs: 0,
        maxAttempts: 3,
      });
      assert.deepEqual(
        remainingRecovery.map(({ id, outcome, version }) => ({ id, outcome, version })),
        [{ id: lockedRecoveryId, outcome: "retry", version: "3" }],
      );

      const rollbackDeadLetterEventId = randomUUID();
      const rollbackDeadLetterCreatedAt = Date.now() - 120_000;
      await insertProcessingOutbox(pool, schema, {
        id: rollbackDeadLetterEventId,
        eventType: "client.created",
        clientId: winningClientId,
        actorId: actorA,
        createdAt: rollbackDeadLetterCreatedAt,
        leaseExpiresAt: Date.now() + 60_000,
      });
      const conflictingDeadLetterActivityId = deadLetterActivityId(rollbackDeadLetterEventId);
      await pool.query(
        `INSERT INTO ${schema}.activity_events (
           id, client_id, action, actor_id, correlation_id, result, detail, occurred_at
         ) VALUES ($1, $2, 'FCI TEST dead-letter collision seed', $3, $4,
           'succeeded', '{}'::jsonb, $5)`,
        [
          conflictingDeadLetterActivityId,
          winningClientId,
          actorA,
          `repository-test:dead-letter-collision:${rollbackDeadLetterEventId}`,
          new Date(rollbackDeadLetterCreatedAt),
        ],
      );
      await assert.rejects(
        outboxRepository.retryOrDeadLetter({
          eventId: rollbackDeadLetterEventId,
          expectedVersion: "2",
          retryDelayMs: 0,
          maxAttempts: 1,
          errorCode: "forced_activity_collision",
          errorMessage: "FCI TEST — DO NOT USE terminal rollback proof.",
        }),
        (error) => error?.code === "23505",
      );
      const rolledBackDeadLetter = await oneRow(
        pool,
        `SELECT status, attempt_count, lease_expires_at IS NOT NULL AS has_lease,
                last_error_code, last_error_message, completed_at,
                dead_lettered_at, version::text AS version
         FROM ${schema}.outbox_events WHERE id = $1`,
        [rollbackDeadLetterEventId],
      );
      assert.deepEqual(rolledBackDeadLetter, {
        status: "processing",
        attempt_count: 1,
        has_lease: true,
        last_error_code: null,
        last_error_message: null,
        completed_at: null,
        dead_lettered_at: null,
        version: "2",
      });
    } finally {
      if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);

test(
  "a reused PostgreSQL session cannot shadow repository tables with pg_temp",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 30_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 1 });
    const schema = `fci_temp_guard_${randomUUID().replaceAll("-", "")}`;
    let schemaCreated = false;

    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema });

      const reusedSession = await pool.connect();
      try {
        await reusedSession.query("CREATE TEMP TABLE clients (shadow_marker text)");
      } finally {
        reusedSession.release();
      }

      const createdAt = Date.now();
      const intent = clientIntent({
        actorId: "postgres-temp-guard@example.test",
        name: "FCI TEST — DO NOT USE Temp Shadow Guard",
        createdAt,
      });
      const accepted = await createPostgresClientRepository(pool, {
        schema,
        request: creationRequest({
          idempotencyKey: "temp-shadow-guard",
          requestFingerprint: UNTRUSTED_FINGERPRINT,
          createdAt,
        }),
      }).create(intent);
      assert.equal(accepted.outcome, "accepted");

      const durable = await oneRow(
        pool,
        `SELECT count(*)::integer AS count FROM ${schema}.clients WHERE id = $1`,
        [intent.client.id],
      );
      const shadow = await oneRow(
        pool,
        "SELECT count(*)::integer AS count FROM pg_temp.clients",
      );
      assert.deepEqual(durable, { count: 1 });
      assert.deepEqual(shadow, { count: 0 });

      const projectCreatedAt = Date.now();
      const uppercaseClientProject = projectIntent({
        actorId: "postgres-temp-guard@example.test",
        clientId: intent.client.id.toUpperCase(),
        name: "FCI TEST — DO NOT USE Uppercase Parent UUID",
        projectManagerId: "postgres-temp-guard@example.test",
        estimatedValue: 1,
        createdAt: projectCreatedAt,
      });
      const project = await createPostgresProjectRepository(pool, {
        schema,
        request: creationRequest({
          idempotencyKey: "uppercase-parent-uuid",
          requestFingerprint: UNTRUSTED_FINGERPRINT,
          createdAt: projectCreatedAt,
        }),
      }).create(uppercaseClientProject);
      assert.equal(project.outcome, "accepted");
    } finally {
      if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);
