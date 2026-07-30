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
const INSTALLATION_ACTIVITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FOLLOW_UP_ACTIVITY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
      flooringCategory: "tile-stone",
      squareFeet: 2_500,
      contractValue: 130_000,
      segment: null,
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

test("project fingerprints bind every creation-time flooring KPI and segment field", () => {
  const baseline = projectIntent();
  for (const [field, value] of [
    ["flooringCategory", "carpet"],
    ["squareFeet", 2_501],
    ["contractValue", 130_001],
    ["segment", "residential"],
  ]) {
    const changed = structuredClone(baseline);
    changed.project[field] = value;
    assert.notEqual(
      calculatePostgresProjectCreationFingerprint(changed),
      calculatePostgresProjectCreationFingerprint(baseline),
      `${field} must participate in the PostgreSQL idempotency fingerprint`,
    );
  }
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

test("client update CAS writes one guarded audit and a stale peer writes nothing", async () => {
  const updateIntent = {
    clientId: CLIENT_ID,
    expectedVersion: "1",
    values: {
      name: "FCI TEST — DO NOT USE updated",
      status: "active",
      industry: "Flooring",
    },
    updatedAt: UPDATED_AT,
    updatedBy: "actor@example.test",
    activity: {
      id: CLIENT_ACTIVITY_ID,
      recordId: CLIENT_ID,
      action: "Client fields updated",
      actor: "actor@example.test",
      detail: "Name: FCI TEST — DO NOT USE → FCI TEST — DO NOT USE updated",
      createdAt: UPDATED_AT,
    },
  };
  const successfulClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE clients[\s\S]*WHERE id = \$7 AND version = \$8::bigint/, result([{
      id: CLIENT_ID,
      client_code: "CL-AB12CD34",
      name: updateIntent.values.name,
      status: updateIntent.values.status,
      industry: updateIntent.values.industry,
      updated_at: new Date(UPDATED_AT),
      version: "2",
    }], 1), {
      inspect: ({ values }) => assert.deepEqual(values.slice(-2), [CLIENT_ID, "1"]),
    }),
    step(/INSERT INTO activity_events[\s\S]*WHERE EXISTS[\s\S]*version = \$8::bigint/, result([], 1), {
      inspect: ({ values }) => {
        assert.equal(values[2], "Client fields updated");
        assert.equal(values[5], JSON.stringify({ message: updateIntent.activity.detail }));
        assert.equal(values[7], "2");
      },
    }),
    step(/^COMMIT$/),
  ]);
  const successfulRepository = createPostgresClientRepository(
    new ScriptedPostgresPool(successfulClient),
    { schema: "repository_test", request: clientRequest() },
  );
  const first = await successfulRepository.update(updateIntent);
  assert.equal(first.outcome, "updated");
  assert.equal(first.value.version, "2");
  successfulClient.assertComplete();

  const staleClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE clients[\s\S]*WHERE id = \$7 AND version = \$8::bigint/, result([], 0)),
    step(/SELECT version::text AS version FROM clients WHERE id = \$1/, result([
      { version: "2" },
    ], 1)),
    step(/^COMMIT$/),
  ]);
  const staleRepository = createPostgresClientRepository(
    new ScriptedPostgresPool(staleClient),
    { schema: "repository_test", request: clientRequest() },
  );
  assert.deepEqual(await staleRepository.update({
    ...updateIntent,
    values: { ...updateIntent.values, name: "Stale editor must lose" },
  }), { outcome: "conflict", currentVersion: "2" });
  assert.equal(
    staleClient.queries.some(({ sql }) => sql.startsWith("INSERT INTO activity_events")),
    false,
  );
  staleClient.assertComplete();
});

test("client update maps the normalized-name constraint to a typed duplicate outcome", async () => {
  const updateIntent = {
    clientId: CLIENT_ID,
    expectedVersion: "1",
    values: {
      name: "  FCI TEST — DO NOT USE EXISTING  ",
      status: "active",
      industry: "Flooring",
    },
    updatedAt: UPDATED_AT,
    updatedBy: "actor@example.test",
    activity: {
      id: CLIENT_ACTIVITY_ID,
      recordId: CLIENT_ID,
      action: "Client fields updated",
      actor: "actor@example.test",
      detail: "Name: old → existing",
      createdAt: UPDATED_AT,
    },
  };
  const duplicateClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE clients[\s\S]*normalized_name_key = \$2/, result(), {
      inspect: ({ values }) => assert.equal(values[1], "fci test — do not use existing"),
      error: Object.assign(new Error("duplicate normalized client name"), {
        code: "23505",
        constraint: "clients_normalized_name_key_key",
      }),
    }),
    step(/^ROLLBACK$/),
  ]);
  const repository = createPostgresClientRepository(
    new ScriptedPostgresPool(duplicateClient),
    { schema: "repository_test", request: clientRequest() },
  );
  assert.deepEqual(await repository.update(updateIntent), { outcome: "duplicate" });
  assert.equal(
    duplicateClient.queries.some(({ sql }) => sql.startsWith("INSERT INTO activity_events")),
    false,
  );
  duplicateClient.assertComplete();
});

test("contact update CAS writes one client-scoped guarded audit and a stale peer writes nothing", async () => {
  const updateIntent = {
    contactId: CONTACT_ID,
    expectedVersion: "1",
    values: {
      name: "Updated Contact",
      email: "updated@example.test",
      phone: "555-0123",
      role: "Account owner",
    },
    updatedAt: UPDATED_AT,
    updatedBy: "actor@example.test",
    activity: {
      id: CLIENT_ACTIVITY_ID,
      recordId: CLIENT_ID,
      action: "Contact fields updated",
      actor: "actor@example.test",
      detail: "Phone: Not set → 555-0123",
      createdAt: UPDATED_AT,
    },
  };
  const successfulClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE contacts[\s\S]*WHERE id = \$6 AND version = \$7::bigint/, result([{
      id: CONTACT_ID,
      client_id: CLIENT_ID,
      name: updateIntent.values.name,
      email: updateIntent.values.email,
      phone: updateIntent.values.phone,
      role: updateIntent.values.role,
      is_primary: true,
      updated_at: new Date(UPDATED_AT),
      version: "2",
    }], 1), {
      inspect: ({ values }) => assert.deepEqual(values.slice(-2), [CONTACT_ID, "1"]),
    }),
    step(/INSERT INTO activity_events[\s\S]*FROM contacts[\s\S]*version = \$9::bigint/, result([], 1), {
      inspect: ({ values }) => {
        assert.equal(values[1], CLIENT_ID);
        assert.equal(values[2], "Contact fields updated");
        assert.equal(values[7], CONTACT_ID);
        assert.equal(values[8], "2");
      },
    }),
    step(/^COMMIT$/),
  ]);
  const successfulRepository = createPostgresClientRepository(
    new ScriptedPostgresPool(successfulClient),
    { schema: "repository_test", request: clientRequest() },
  );
  const first = await successfulRepository.updateContact(updateIntent);
  assert.equal(first.outcome, "updated");
  assert.equal(first.value.version, "2");
  successfulClient.assertComplete();

  const staleClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE contacts[\s\S]*WHERE id = \$6 AND version = \$7::bigint/, result([], 0)),
    step(/SELECT version::text AS version FROM contacts WHERE id = \$1/, result([
      { version: "2" },
    ], 1)),
    step(/^COMMIT$/),
  ]);
  const staleRepository = createPostgresClientRepository(
    new ScriptedPostgresPool(staleClient),
    { schema: "repository_test", request: clientRequest() },
  );
  assert.deepEqual(await staleRepository.updateContact({
    ...updateIntent,
    values: { ...updateIntent.values, role: "Stale editor" },
  }), { outcome: "conflict", currentVersion: "2" });
  assert.equal(
    staleClient.queries.some(({ sql }) => sql.startsWith("INSERT INTO activity_events")),
    false,
  );
  staleClient.assertComplete();
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

test("client idempotency conflict rejects a changed body without record or evidence writes", async () => {
  const changedIntent = clientIntent();
  changedIntent.client.name = "FCI TEST — DO NOT USE Changed Idempotency Body";
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([], 0)),
    step(/SELECT request_fingerprint[\s\S]*FOR UPDATE/, result([{
      request_fingerprint: calculatePostgresClientCreationFingerprint(clientIntent()),
      status: "completed",
      response_status: 201,
      response_body: {},
      version: "2",
    }], 1)),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresClientRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: clientRequest(),
  });

  assert.deepEqual(await repository.create(changedIntent), { outcome: "idempotency-conflict" });
  for (const forbidden of ["insert client", "insert contact", "insert activity", "insert outbox", "complete idempotency"]) {
    assert.equal(queryKinds(client).includes(forbidden), false, `${forbidden} must not run on conflict`);
  }
  assert.equal(client.queries.at(-1).sql, "COMMIT");
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
    step(
      /SELECT id::text AS id, industry[\s\S]*FOR KEY SHARE/,
      result([{ id: CLIENT_ID, industry: "Residential" }], 1),
    ),
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

test("project creation mirrors D1 exact-choice segment fallback and safely parses returned values", async () => {
  const directSegmentIntent = projectIntent();
  directSegmentIntent.project.segment = " Residential ";
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: projectRequest().idempotencyRequestId }], 1), {
      inspect: ({ values }) => assert.equal(
        values[4],
        calculatePostgresProjectCreationFingerprint(directSegmentIntent),
      ),
    }),
    step(
      /SELECT id::text AS id, industry[\s\S]*FOR KEY SHARE/,
      result([{ id: CLIENT_ID, industry: "Commercial" }], 1),
    ),
    step(
      /INSERT INTO projects[\s\S]*flooring_category, square_feet, contract_value, segment[\s\S]*VALUES \(\$1, \$2, \$3[\s\S]*estimated_value::text/,
      result([acceptedProjectRow()], 1),
      {
        inspect: ({ values }) => {
          assert.deepEqual(
            values.slice(8, 12),
            ["tile-stone", 2_500, 130_000, "commercial"],
            "a non-canonical direct choice derives from the locked client industry exactly like D1",
          );
        },
      },
    ),
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

  const creation = await repository.create(directSegmentIntent, () => {
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

test("project update CAS writes one guarded audit and a stale peer writes nothing", async () => {
  const updateIntent = {
    projectId: PROJECT_ID,
    expectedVersion: "1",
    values: {
      clientId: CLIENT_ID,
      name: "FCI TEST — DO NOT USE updated project",
      status: "planning",
      site: "Cherry Hill, NJ",
      estimatedValue: 125_000,
      flooringCategory: "tile-stone",
      squareFeet: 2_500,
      contractValue: 130_000,
      segment: "commercial",
    },
    updatedAt: UPDATED_AT,
    updatedBy: "actor@example.test",
    activity: {
      id: PROJECT_ACTIVITY_ID,
      recordId: PROJECT_ID,
      action: "Project fields updated",
      actor: "actor@example.test",
      detail: "Name: FCI TEST — DO NOT USE → FCI TEST — DO NOT USE updated project",
      createdAt: UPDATED_AT,
    },
  };
  const successfulClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE projects[\s\S]*WHERE id = \$12 AND version = \$13::bigint/, result([{
      id: PROJECT_ID,
      project_number: "CF-2026-AB12CD34",
      client_id: CLIENT_ID,
      name: updateIntent.values.name,
      status: updateIntent.values.status,
      site: updateIntent.values.site,
      project_manager: "manager@example.test",
      estimated_value: String(updateIntent.values.estimatedValue),
      flooring_category: updateIntent.values.flooringCategory,
      square_feet: String(updateIntent.values.squareFeet),
      contract_value: String(updateIntent.values.contractValue),
      segment: updateIntent.values.segment,
      updated_at: new Date(UPDATED_AT),
      version: "2",
    }], 1), {
      inspect: ({ values }) => assert.deepEqual(values.slice(-2), [PROJECT_ID, "1"]),
    }),
    step(/INSERT INTO activity_events[\s\S]*WHERE EXISTS[\s\S]*version = \$8::bigint/, result([], 1), {
      inspect: ({ values }) => {
        assert.equal(values[2], "Project fields updated");
        assert.equal(values[5], JSON.stringify({ message: updateIntent.activity.detail }));
        assert.equal(values[7], "2");
      },
    }),
    step(/^COMMIT$/),
  ]);
  const successfulRepository = createPostgresProjectRepository(
    new ScriptedPostgresPool(successfulClient),
    { schema: "repository_test" },
  );
  const first = await successfulRepository.update(updateIntent);
  assert.equal(first.outcome, "updated");
  assert.equal(first.value.version, "2");
  successfulClient.assertComplete();

  const staleClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE projects[\s\S]*WHERE id = \$12 AND version = \$13::bigint/, result([], 0)),
    step(/SELECT version::text AS version FROM projects WHERE id = \$1/, result([
      { version: "2" },
    ], 1)),
    step(/^COMMIT$/),
  ]);
  const staleRepository = createPostgresProjectRepository(
    new ScriptedPostgresPool(staleClient),
    { schema: "repository_test" },
  );
  assert.deepEqual(await staleRepository.update({
    ...updateIntent,
    values: { ...updateIntent.values, name: "Stale editor must lose" },
  }), { outcome: "conflict", currentVersion: "2" });
  assert.equal(
    staleClient.queries.some(({ sql }) => sql.startsWith("INSERT INTO activity_events")),
    false,
  );
  staleClient.assertComplete();
});

test("assignManager updates the project and activity in one transaction while invalid UUIDs avoid the pool", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE projects[\s\S]*version = version \+ 1[\s\S]*WHERE id = \$4 AND version = \$5::bigint[\s\S]*RETURNING version::text/, result([{
      version: "9223372036854775807",
    }], 1)),
    step(/INSERT INTO activity_events/, result([], 1)),
    step(/^COMMIT$/),
  ]);
  const pool = new ScriptedPostgresPool(client);
  const repository = createPostgresProjectRepository(pool, { schema: "repository_test" });
  const intent = {
    projectId: PROJECT_ID,
    expectedVersion: "9223372036854775806",
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

test("installation dates update PostgreSQL with the D1 outcome contract and append activity atomically", async () => {
  const installationStartedAt = CREATED_AT + 10_000;
  const installationCompletedAt = installationStartedAt + 86_400_000;
  const updatedAt = installationCompletedAt + 1_000;
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(
      /UPDATE projects[\s\S]*installation_started_at = \$1, installation_completed_at = \$2[\s\S]*updated_by = \$3[\s\S]*version = version \+ 1[\s\S]*WHERE id = \$5 AND version = \$6::bigint[\s\S]*RETURNING version::text/,
      result([{ version: "2" }], 1),
      {
        inspect: ({ values }) => {
          assert.deepEqual(values, [
            new Date(installationStartedAt),
            new Date(installationCompletedAt),
            "actor@example.test",
            new Date(updatedAt),
            PROJECT_ID,
            "1",
          ]);
        },
      },
    ),
    step(/INSERT INTO activity_events/, result([], 1), {
      inspect: ({ values }) => {
        assert.equal(values[4], `project-installation:${INSTALLATION_ACTIVITY_ID}`);
      },
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresProjectRepository(
    new ScriptedPostgresPool(client),
    { schema: "repository_test" },
  );
  const intent = {
    projectId: PROJECT_ID,
    expectedVersion: "1",
    installationStartedAt,
    installationCompletedAt,
    updatedAt,
    activity: {
      id: INSTALLATION_ACTIVITY_ID,
      recordId: PROJECT_ID,
      action: "Installation dates recorded",
      actor: "actor@example.test",
      detail: "Installation dates recorded for parity",
      createdAt: updatedAt,
    },
  };

  assert.deepEqual(
    await repository.recordInstallationDates(intent),
    { outcome: "updated" },
  );
  assert.deepEqual(queryKinds(client).slice(-3), [
    "update project",
    "insert activity",
    "COMMIT",
  ]);
  client.assertComplete();

  const missingClient = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(/UPDATE projects[\s\S]*installation_started_at = \$1/, result([], 0)),
    step(/SELECT version::text AS version FROM projects WHERE id = \$1/, result([], 0)),
    step(/^COMMIT$/),
  ]);
  const missingRepository = createPostgresProjectRepository(
    new ScriptedPostgresPool(missingClient),
    { schema: "repository_test" },
  );
  assert.deepEqual(
    await missingRepository.recordInstallationDates(intent),
    { outcome: "project-not-found" },
  );
  assert.equal(queryKinds(missingClient).includes("insert activity"), false);
  missingClient.assertComplete();
});

test("follow-up results update PostgreSQL with boolean/text parity and append activity atomically", async () => {
  const updatedAt = CREATED_AT + 90_000_000;
  const client = new ScriptedPostgresClient([
    ...transactionSetupSteps(),
    step(
      /UPDATE projects[\s\S]*had_callback = \$1, callback_note = \$2[\s\S]*updated_by = \$3[\s\S]*version = version \+ 1[\s\S]*WHERE id = \$5 AND version = \$6::bigint[\s\S]*RETURNING version::text/,
      result([{ version: "3" }], 1),
      {
        inspect: ({ values }) => {
          assert.deepEqual(values, [
            true,
            "FCI TEST — DO NOT USE — Callback complete",
            "actor@example.test",
            new Date(updatedAt),
            PROJECT_ID,
            "2",
          ]);
        },
      },
    ),
    step(/INSERT INTO activity_events/, result([], 1), {
      inspect: ({ values }) => {
        assert.equal(values[4], `project-follow-up:${FOLLOW_UP_ACTIVITY_ID}`);
      },
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresProjectRepository(
    new ScriptedPostgresPool(client),
    { schema: "repository_test" },
  );
  const intent = {
    projectId: PROJECT_ID,
    expectedVersion: "2",
    hadCallback: true,
    callbackNote: "FCI TEST — DO NOT USE — Callback complete",
    updatedAt,
    activity: {
      id: FOLLOW_UP_ACTIVITY_ID,
      recordId: PROJECT_ID,
      action: "Follow-up result recorded",
      actor: "actor@example.test",
      detail: "Follow-up result recorded for parity",
      createdAt: updatedAt,
    },
  };

  assert.deepEqual(
    await repository.recordFollowUpResult(intent),
    { outcome: "updated" },
  );
  assert.deepEqual(queryKinds(client).slice(-3), [
    "update project",
    "insert activity",
    "COMMIT",
  ]);
  client.assertComplete();

  const unusedClient = new ScriptedPostgresClient([]);
  const unusedPool = new ScriptedPostgresPool(unusedClient);
  const invalidRepository = createPostgresProjectRepository(unusedPool, {
    schema: "repository_test",
  });
  assert.deepEqual(
    await invalidRepository.recordFollowUpResult({
      ...intent,
      projectId: "not-a-uuid",
      activity: { ...intent.activity, recordId: "not-a-uuid" },
    }),
    { outcome: "project-not-found" },
  );
  assert.equal(unusedPool.connectCount, 0);
});

test("legacy PostgreSQL project operations return current version and no audit on stale writes", async () => {
  const updatedAt = UPDATED_AT + 10_000;
  const cases = [
    {
      method: "assignManager",
      update: /UPDATE projects[\s\S]*WHERE id = \$4 AND version = \$5::bigint/,
      intent: {
        projectId: PROJECT_ID,
        expectedVersion: "1",
        projectManagerId: "new-manager@example.test",
        updatedAt,
        activity: {
          id: ASSIGNMENT_ACTIVITY_ID,
          recordId: PROJECT_ID,
          action: "Project manager assigned",
          actor: "actor@example.test",
          detail: "Assigned test project manager",
          createdAt: updatedAt,
        },
      },
    },
    {
      method: "recordInstallationDates",
      update: /UPDATE projects[\s\S]*WHERE id = \$5 AND version = \$6::bigint/,
      intent: {
        projectId: PROJECT_ID,
        expectedVersion: "1",
        installationStartedAt: updatedAt - 2_000,
        installationCompletedAt: updatedAt - 1_000,
        updatedAt,
        activity: {
          id: INSTALLATION_ACTIVITY_ID,
          recordId: PROJECT_ID,
          action: "Installation dates recorded",
          actor: "actor@example.test",
          detail: "Installation dates recorded for parity",
          createdAt: updatedAt,
        },
      },
    },
    {
      method: "recordFollowUpResult",
      update: /UPDATE projects[\s\S]*WHERE id = \$5 AND version = \$6::bigint/,
      intent: {
        projectId: PROJECT_ID,
        expectedVersion: "1",
        hadCallback: false,
        callbackNote: null,
        updatedAt,
        activity: {
          id: FOLLOW_UP_ACTIVITY_ID,
          recordId: PROJECT_ID,
          action: "Follow-up result recorded",
          actor: "actor@example.test",
          detail: "Post-installation callback: No",
          createdAt: updatedAt,
        },
      },
    },
  ];

  for (const { method, update, intent } of cases) {
    const client = new ScriptedPostgresClient([
      ...transactionSetupSteps(),
      step(update, result([], 0)),
      step(/SELECT version::text AS version FROM projects WHERE id = \$1/, result([
        { version: "2" },
      ], 1)),
      step(/^COMMIT$/),
    ]);
    const repository = createPostgresProjectRepository(
      new ScriptedPostgresPool(client),
      { schema: "repository_test" },
    );
    assert.deepEqual(await repository[method](intent), {
      outcome: "conflict",
      currentVersion: "2",
    });
    assert.equal(
      client.queries.some(({ sql }) => sql.startsWith("INSERT INTO activity_events")),
      false,
    );
    client.assertComplete();
  }
});
