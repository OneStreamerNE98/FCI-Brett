import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24682 } },
});

const [clientRepositoryModule, projectRepositoryModule] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/postgres/client-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/project-repository.ts"),
]);

after(async () => {
  await vite.close();
});

const {
  calculatePostgresClientCreationFingerprint,
  createPostgresClientRepository,
} = clientRepositoryModule;
const {
  calculatePostgresProjectCreationFingerprint,
  createPostgresProjectRepository,
} = projectRepositoryModule;
const CREATED_AT = Date.UTC(2026, 6, 13, 12, 0, 0);
const UPDATED_AT = CREATED_AT + 1_000;
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ACTIVITY_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ACTIVITY_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT_ACTIVITY_ID = "66666666-6666-4666-8666-666666666666";

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
    step(/SELECT pg_catalog\.set_config\('search_path', \$1, true\)/, result([{ set_config: "repository_test, pg_catalog, pg_temp" }], 1), {
      inspect: ({ values }) => assert.deepEqual(values, ["repository_test, pg_catalog, pg_temp"]),
    }),
    step(/SELECT pg_catalog\.current_schema\(\) AS current_schema/, result([{ current_schema: "repository_test" }], 1)),
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
    if (typeof expected.match === "string") {
      assert.equal(query.sql, expected.match);
    } else {
      assert.match(query.sql, expected.match);
    }
    expected.inspect?.(query);
    if (expected.error) throw expected.error;
    return expected.response;
  }

  release(error) {
    this.releaseCalls.push(error);
  }

  assertComplete() {
    assert.deepEqual(this.steps, []);
    assert.equal(this.releaseCalls.length, 1);
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

function queryKind(sql) {
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return sql;
  if (sql.startsWith("SET LOCAL lock_timeout")) return "lock timeout";
  if (sql.startsWith("SET LOCAL statement_timeout")) return "statement timeout";
  if (sql.includes("set_config('search_path'")) return "search path";
  if (sql.includes("current_schema()")) return "schema verification";
  if (sql.startsWith("INSERT INTO idempotency_requests")) return "claim idempotency";
  if (sql.startsWith("SELECT request_fingerprint")) return "read idempotency";
  if (sql.startsWith("UPDATE idempotency_requests") && sql.includes("status = 'failed'")) return "fail idempotency";
  if (sql.startsWith("UPDATE idempotency_requests")) return "complete idempotency";
  if (sql.startsWith("INSERT INTO clients")) return "insert client";
  if (sql.startsWith("INSERT INTO contacts")) return "insert contact";
  if (sql.startsWith("SELECT id::text AS id") && sql.includes("FROM clients")) return "lock client";
  if (sql.startsWith("INSERT INTO projects")) return "insert project";
  if (sql.startsWith("UPDATE projects")) return "update project";
  if (sql.startsWith("INSERT INTO activity_events")) return "insert activity";
  if (sql.startsWith("INSERT INTO outbox_events")) return "insert outbox";
  return sql;
}

function queryKinds(client) {
  return client.queries.map(({ sql }) => queryKind(sql));
}

function assertCreationEvidenceCommittedLast(client) {
  const kinds = queryKinds(client);
  const activity = kinds.indexOf("insert activity");
  const outbox = kinds.indexOf("insert outbox");
  const completion = kinds.indexOf("complete idempotency");
  const commit = kinds.indexOf("COMMIT");
  assert.ok(activity >= 0 && activity < commit, "activity must be written before COMMIT");
  assert.ok(outbox > activity && outbox < commit, "outbox must be written before COMMIT");
  assert.ok(completion > outbox && completion < commit, "idempotency must complete before COMMIT");
}

function clientRequest(overrides = {}) {
  return {
    idempotencyRequestId: "77777777-7777-4777-8777-777777777777",
    idempotencyKey: "create-client-1",
    requestFingerprint: `sha256:${"0".repeat(64)}`,
    correlationId: "request-create-client-1",
    expiresAt: CREATED_AT + 60_000,
    outboxEventId: "88888888-8888-4888-8888-888888888888",
    ...overrides,
  };
}

function projectRequest(overrides = {}) {
  return {
    idempotencyRequestId: "99999999-9999-4999-8999-999999999999",
    idempotencyKey: "create-project-1",
    requestFingerprint: `sha256:${"0".repeat(64)}`,
    correlationId: "request-create-project-1",
    expiresAt: CREATED_AT + 60_000,
    outboxEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...overrides,
  };
}

function clientIntent({ withContact = true } = {}) {
  return {
    client: {
      id: CLIENT_ID,
      clientCode: "CL-AB12CD34",
      name: "ＦＣＩ\u2003TEST — DO NOT USE",
      status: "active",
      industry: "  Flooring  ",
      createdBy: "actor@example.test",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
    primaryContact: withContact ? {
      id: CONTACT_ID,
      clientId: CLIENT_ID,
      name: "FCI Test Contact",
      email: "  contact@example.test  ",
      phone: "  555-0100  ",
      role: "   ",
      isPrimary: true,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    } : null,
    activity: {
      id: CLIENT_ACTIVITY_ID,
      recordId: CLIENT_ID,
      action: "Client created",
      actor: "actor@example.test",
      detail: "Created test client",
      createdAt: CREATED_AT,
    },
  };
}

function projectIntent() {
  return {
    project: {
      id: PROJECT_ID,
      projectNumber: "CF-2026-AB12CD34",
      clientId: CLIENT_ID,
      name: "FCI TEST — DO NOT USE project",
      status: "active",
      site: "  Test site  ",
      projectManagerId: "manager@example.test",
      estimatedValue: 125_000,
      createdBy: "actor@example.test",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
    activity: {
      id: PROJECT_ACTIVITY_ID,
      recordId: PROJECT_ID,
      action: "Project created",
      actor: "actor@example.test",
      detail: "Created test project",
      createdAt: CREATED_AT,
    },
  };
}

test("project fingerprints canonicalize equivalent uppercase UUIDs", () => {
  const lower = projectIntent();
  lower.project.clientId = "abcdef12-3456-4789-abcd-ef1234567890";
  const upper = structuredClone(lower);
  upper.project.clientId = lower.project.clientId.toUpperCase();
  assert.equal(
    calculatePostgresProjectCreationFingerprint(lower),
    calculatePostgresProjectCreationFingerprint(upper),
  );
});

function acceptedClientRow() {
  return {
    id: CLIENT_ID,
    client_code: "CL-AB12CD34",
    name: "ＦＣＩ\u2003TEST — DO NOT USE",
    created_at: new Date(CREATED_AT),
    version: "9007199254740992",
  };
}

function acceptedProjectRow() {
  return {
    id: PROJECT_ID,
    project_number: "CF-2026-AB12CD34",
    project_manager: "manager@example.test",
    estimated_value: "125000.000",
    created_at: "2026-07-13T08:00:00-04:00",
    version: "9007199254740992",
  };
}

function clientCreationSteps({ withContact = true } = {}) {
  return [
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: clientRequest().idempotencyRequestId }], 1), {
      inspect: ({ values }) => {
        assert.equal(values[4], calculatePostgresClientCreationFingerprint(clientIntent({ withContact })));
        assert.notEqual(values[4], clientRequest().requestFingerprint);
      },
    }),
    step(/INSERT INTO clients[\s\S]*RETURNING id::text/, result([acceptedClientRow()], 1), {
      inspect: ({ values }) => {
        assert.equal(values[3], "fci test — do not use");
        assert.equal(values[5], "Flooring");
      },
    }),
    ...(withContact ? [
      step(/INSERT INTO contacts/, result([], 1), {
        inspect: ({ values }) => {
          assert.equal(values[3], "contact@example.test");
          assert.equal(values[4], "555-0100");
          assert.equal(values[5], "Primary contact");
        },
      }),
    ] : []),
    step(/INSERT INTO activity_events/, result([], 1)),
    step(/INSERT INTO outbox_events/, result([], 1)),
    step(/UPDATE idempotency_requests[\s\S]*status = 'completed'/, result([{ version: "2" }], 1)),
    step(/^COMMIT$/),
  ];
}

test("client creation keeps record, optional contact, activity, outbox, and accepted response in one transaction", async () => {
  const client = new ScriptedPostgresClient(clientCreationSteps());
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresClientRepository(pool, {
    schema: "repository_test",
    request: clientRequest(),
  });
  let providerCalls = 0;

  const creation = await repository.create(clientIntent(), () => {
    providerCalls += 1;
  });

  const accepted = {
    id: CLIENT_ID,
    clientCode: "CL-AB12CD34",
    name: "ＦＣＩ\u2003TEST — DO NOT USE",
    createdAt: CREATED_AT,
    version: "9007199254740992",
  };
  assert.deepEqual(creation, { outcome: "accepted", value: accepted, replayed: false });
  assert.equal(repository.create.length, 1);
  assert.equal(providerCalls, 0, "repository transactions must not invoke provider callbacks");
  assert.equal(pool.connectCount, 1);
  assert.deepEqual(queryKinds(client), [
    "BEGIN",
    "lock timeout",
    "statement timeout",
    "search path",
    "schema verification",
    "claim idempotency",
    "insert client",
    "insert contact",
    "insert activity",
    "insert outbox",
    "complete idempotency",
    "COMMIT",
  ]);
  const completion = client.queries.find(({ sql }) => queryKind(sql) === "complete idempotency");
  assert.equal(completion.values[0], JSON.stringify(accepted));
  assertCreationEvidenceCommittedLast(client);
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();
});

test("client creation skips the optional contact statement when no contact is supplied", async () => {
  const client = new ScriptedPostgresClient(clientCreationSteps({ withContact: false }));
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresClientRepository(pool, {
    schema: "repository_test",
    request: clientRequest(),
  });

  const creation = await repository.create(clientIntent({ withContact: false }));

  assert.equal(creation.outcome, "accepted");
  assert.equal(queryKinds(client).includes("insert contact"), false);
  assertCreationEvidenceCommittedLast(client);
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();
});

test("client idempotency replay returns the original accepted value without record or evidence writes", async () => {
  const stored = {
    id: CLIENT_ID,
    clientCode: "CL-AB12CD34",
    name: "Original FCI TEST — DO NOT USE",
    createdAt: CREATED_AT - 20_000,
    version: "9007199254740993",
  };
  const request = clientRequest();
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([], 0)),
    step(/SELECT request_fingerprint[\s\S]*FOR UPDATE/, result([{
      request_fingerprint: calculatePostgresClientCreationFingerprint(clientIntent()),
      status: "completed",
      response_status: 201,
      response_body: stored,
      version: "2",
    }], 1)),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresClientRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request,
  });

  assert.deepEqual(
    await repository.create(clientIntent()),
    { outcome: "accepted", value: stored, replayed: true },
  );
  assert.deepEqual(queryKinds(client), [
    "BEGIN",
    "lock timeout",
    "statement timeout",
    "search path",
    "schema verification",
    "claim idempotency",
    "read idempotency",
    "COMMIT",
  ]);
  for (const forbidden of ["insert client", "insert contact", "insert activity", "insert outbox", "complete idempotency"]) {
    assert.equal(queryKinds(client).includes(forbidden), false, `${forbidden} must not run on replay`);
  }
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();
});

test("a duplicate client name commits a replayable deterministic failure", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: clientRequest().idempotencyRequestId }], 1)),
    step(/INSERT INTO clients[\s\S]*ON CONFLICT ON CONSTRAINT clients_normalized_name_key_key DO NOTHING/, result([], 0)),
    step(/UPDATE idempotency_requests[\s\S]*status = 'failed'/, result([{ version: "2" }], 1), {
      inspect: ({ values }) => {
        assert.equal(values[0], 409);
        assert.equal(values[1], JSON.stringify({ outcome: "duplicate" }));
      },
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresClientRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: clientRequest(),
  });

  assert.deepEqual(await repository.create(clientIntent()), { outcome: "duplicate" });
  assert.equal(queryKinds(client).includes("insert activity"), false);
  assert.equal(queryKinds(client).includes("insert outbox"), false);
  assert.equal(queryKinds(client).includes("fail idempotency"), true);
  assert.equal(client.queries.at(-1).sql, "COMMIT");
  client.assertComplete();
});

test("a completed duplicate failure replays without new record writes", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([], 0)),
    step(/SELECT request_fingerprint[\s\S]*FOR UPDATE/, result([{
      request_fingerprint: calculatePostgresClientCreationFingerprint(clientIntent()),
      status: "failed",
      response_status: 409,
      response_body: { outcome: "duplicate" },
    }], 1)),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresClientRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: clientRequest(),
  });

  assert.deepEqual(await repository.create(clientIntent()), { outcome: "duplicate" });
  assert.equal(queryKinds(client).some((kind) => kind.startsWith("insert ")), false);
  client.assertComplete();
});

test("generated client identifier collisions are retryable and unrelated constraints still throw", async (t) => {
  async function runWithConstraint(constraint) {
    const uniqueError = Object.assign(new Error(`simulated ${constraint}`), {
      code: "23505",
      constraint,
    });
    const client = new ScriptedPostgresClient([
      ...transactionSetupSteps(),
      step(/INSERT INTO idempotency_requests/, result([{ id: clientRequest().idempotencyRequestId }], 1)),
      step(/INSERT INTO clients/, result(), { error: uniqueError }),
      step(/^ROLLBACK$/),
    ]);
    const repository = createPostgresClientRepository(new ScriptedPostgresPool(client), {
      schema: "repository_test",
      request: clientRequest(),
    });
    return { repository, client, uniqueError };
  }

  for (const constraint of ["clients_pkey", "clients_client_code_key"]) {
    await t.test(constraint, async () => {
      const { repository, client } = await runWithConstraint(constraint);
      assert.deepEqual(await repository.create(clientIntent()), { outcome: "identifier-collision" });
      assert.equal(client.queries.at(-1).sql, "ROLLBACK");
      assert.equal(client.releaseCalls[0], undefined);
      client.assertComplete();
    });
  }

  await t.test("unrelated unique constraint", async () => {
    const { repository, client, uniqueError } = await runWithConstraint("contacts_primary_per_client_key");
    await assert.rejects(repository.create(clientIntent()), (error) => error === uniqueError);
    assert.equal(client.queries.at(-1).sql, "ROLLBACK");
    assert.equal(client.releaseCalls[0], undefined);
    client.assertComplete();
  });
});

test("a locked missing project client commits a replayable 404", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: projectRequest().idempotencyRequestId }], 1), {
      inspect: ({ values }) => {
        assert.equal(values[4], calculatePostgresProjectCreationFingerprint(projectIntent()));
        assert.notEqual(values[4], projectRequest().requestFingerprint);
      },
    }),
    step(/SELECT id::text AS id[\s\S]*FROM clients[\s\S]*WHERE id = \$1[\s\S]*FOR KEY SHARE/, result([], 0)),
    step(/UPDATE idempotency_requests[\s\S]*status = 'failed'/, result([{ version: "2" }], 1), {
      inspect: ({ values }) => {
        assert.equal(values[0], 404);
        assert.equal(values[1], JSON.stringify({ outcome: "client-not-found" }));
      },
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresProjectRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: projectRequest(),
  });

  assert.deepEqual(await repository.create(projectIntent()), { outcome: "client-not-found" });
  assert.equal(queryKinds(client).includes("insert activity"), false);
  assert.equal(queryKinds(client).includes("insert outbox"), false);
  assert.equal(queryKinds(client).includes("complete idempotency"), false);
  assert.equal(queryKinds(client).includes("fail idempotency"), true);
  assert.equal(client.queries.at(-1).sql, "COMMIT");
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();
});

test("generated project-number collisions return a retryable typed outcome", async () => {
  const uniqueError = Object.assign(new Error("simulated project number collision"), {
    code: "23505",
    constraint: "projects_project_number_key",
  });
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: projectRequest().idempotencyRequestId }], 1)),
    step(/SELECT id::text AS id[\s\S]*FOR KEY SHARE/, result([{ id: CLIENT_ID }], 1)),
    step(/INSERT INTO projects/, result(), { error: uniqueError }),
    step(/^ROLLBACK$/),
  ]);
  const repository = createPostgresProjectRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: projectRequest(),
  });

  assert.deepEqual(await repository.create(projectIntent()), { outcome: "identifier-collision" });
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
  client.assertComplete();
});

test("project creation safely parses numeric and bigint values before storing its accepted response", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: projectRequest().idempotencyRequestId }], 1), {
      inspect: ({ values }) => assert.equal(
        values[4],
        calculatePostgresProjectCreationFingerprint(projectIntent()),
      ),
    }),
    step(/SELECT id::text AS id[\s\S]*FOR KEY SHARE/, result([{ id: CLIENT_ID }], 1)),
    step(/INSERT INTO projects[\s\S]*VALUES \(\$1, \$2, \$3[\s\S]*estimated_value::text/, result([acceptedProjectRow()], 1)),
    step(/INSERT INTO activity_events/, result([], 1)),
    step(/INSERT INTO outbox_events/, result([], 1)),
    step(/UPDATE idempotency_requests[\s\S]*status = 'completed'/, result([{ version: "2" }], 1)),
    step(/^COMMIT$/),
  ]);
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresProjectRepository(pool, {
    schema: "repository_test",
    request: projectRequest(),
  });
  let providerCalls = 0;

  const creation = await repository.create(projectIntent(), () => {
    providerCalls += 1;
  });

  const accepted = {
    id: PROJECT_ID,
    projectNumber: "CF-2026-AB12CD34",
    projectManagerId: "manager@example.test",
    createdAt: CREATED_AT,
    estimatedValue: 125_000,
    version: "9007199254740992",
  };
  assert.deepEqual(creation, { outcome: "accepted", value: accepted, replayed: false });
  assert.equal(repository.create.length, 1);
  assert.equal(providerCalls, 0, "repository transactions must not invoke provider callbacks");
  const completion = client.queries.find(({ sql }) => queryKind(sql) === "complete idempotency");
  assert.equal(completion.values[0], JSON.stringify(accepted));
  assertCreationEvidenceCommittedLast(client);
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();
});

test("assignManager updates the project and activity in one transaction while invalid UUIDs avoid the pool", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE projects[\s\S]*version = version \+ 1[\s\S]*RETURNING version::text/, result([{
      version: "9223372036854775807",
    }], 1)),
    step(/INSERT INTO activity_events/, result([], 1)),
    step(/^COMMIT$/),
  ]);
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresProjectRepository(pool, { schema: "repository_test" });
  const intent = {
    projectId: PROJECT_ID,
    projectManagerId: "new-manager@example.test",
    updatedAt: UPDATED_AT,
    activity: {
      id: ASSIGNMENT_ACTIVITY_ID,
      recordId: PROJECT_ID,
      action: "Project manager assigned",
      actor: "actor@example.test",
      detail: "Assigned test project manager",
      createdAt: UPDATED_AT,
    },
  };

  assert.deepEqual(await repository.assignManager(intent), { outcome: "updated" });
  assert.deepEqual(queryKinds(client), [
    "BEGIN",
    "lock timeout",
    "statement timeout",
    "search path",
    "schema verification",
    "update project",
    "insert activity",
    "COMMIT",
  ]);
  assert.ok(
    queryKinds(client).indexOf("insert activity") < queryKinds(client).indexOf("COMMIT"),
    "assignment activity must be written before COMMIT",
  );
  assert.equal(client.releaseCalls[0], undefined);
  client.assertComplete();

  const unusedClient = new ScriptedPostgresClient([]);
  const unusedPool = new ScriptedPostgresPool(unusedClient);
  const invalidRepository = createPostgresProjectRepository(unusedPool, { schema: "repository_test" });
  assert.deepEqual(
    await invalidRepository.assignManager({ ...intent, projectId: "not-a-uuid" }),
    { outcome: "project-not-found" },
  );
  assert.equal(unusedPool.connectCount, 0);
  assert.deepEqual(unusedClient.queries, []);
  assert.deepEqual(unusedClient.releaseCalls, []);
});
