import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24706 } },
});
const [d1LeadModule, d1MeetingModule, pgLeadModule, pgMeetingModule] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/d1/lead-repository.ts"),
  vite.ssrLoadModule("/app/adapters/d1/project-meeting-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/lead-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/project-meeting-repository.ts"),
]);

after(async () => vite.close());

const { createD1LeadRepository } = d1LeadModule;
const { createD1ProjectMeetingRepository } = d1MeetingModule;
const {
  calculatePostgresLeadCreationFingerprint,
  createPostgresLeadRepository,
} = pgLeadModule;
const {
  calculatePostgresProjectMeetingCreationFingerprint,
  createPostgresProjectMeetingRepository,
} = pgMeetingModule;

const CREATED_AT = Date.UTC(2026, 6, 19, 12, 0, 0);
const UPDATED_AT = CREATED_AT + 1_000;
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ACTIVITY_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const MEETING_ID = "44444444-4444-4444-8444-444444444444";
const MEETING_ACTIVITY_ID = "55555555-5555-4555-8555-555555555555";

function leadIntent(overrides = {}) {
  const lead = {
    id: LEAD_ID,
    lead_number: "L-2026-11111111",
    company: "FCI TEST — DO NOT USE",
    contact_name: "Test Contact",
    contact_email: "contact@example.test",
    contact_phone: "555-0100",
    project_name: "Test Flooring",
    source: "Referral",
    stage: "Qualified",
    site: "FCI TEST — DO NOT USE",
    estimated_value: 125000,
    next_action: "Schedule site walk",
    next_action_at: UPDATED_AT + 86_400_000,
    owner_email: "owner@example.test",
    status: "active",
    created_by: "owner@example.test",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
  return {
    lead,
    activity: {
      id: LEAD_ACTIVITY_ID,
      recordId: lead.id,
      action: "Lead created",
      actor: lead.created_by,
      detail: `${lead.lead_number} · ${lead.company} · ${lead.project_name}`,
      createdAt: lead.created_at,
    },
  };
}

function meetingIntent(overrides = {}) {
  const meeting = {
    id: MEETING_ID,
    project_id: PROJECT_ID,
    title: "FCI TEST — DO NOT USE kickoff",
    meeting_at: CREATED_AT,
    meeting_type: "client",
    source_provider: "otter",
    source_url: "https://otter.ai/u/fci-test",
    attendees_json: JSON.stringify(["Test Contact", "Owner"]),
    notes: "Test-only meeting notes.",
    transcript: null,
    summary: "Test-only summary.",
    decisions: null,
    action_items_json: JSON.stringify(["Schedule site walk"]),
    created_by: "owner@example.test",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
  return {
    meeting,
    activity: {
      id: MEETING_ACTIVITY_ID,
      recordId: meeting.project_id,
      action: "Meeting notes captured",
      actor: meeting.created_by,
      detail: `${meeting.title} · Otter`,
      createdAt: meeting.created_at,
    },
  };
}

function creationRequest() {
  return {
    idempotencyRequestId: "66666666-6666-4666-8666-666666666666",
    idempotencyKey: "request-key-1",
    correlationId: "request-1",
    expiresAt: CREATED_AT + 86_400_000,
    outboxEventId: "77777777-7777-4777-8777-777777777777",
  };
}

class FakeD1Statement {
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
}

class FakeD1Database {
  constructor({ first = () => null, all = () => [] } = {}) {
    this.first = first;
    this.all = all;
    this.prepared = [];
    this.batches = [];
  }
  prepare(sql) {
    const statement = new FakeD1Statement(this, sql);
    this.prepared.push(statement);
    return statement;
  }
  async batch(statements) {
    this.batches.push(statements);
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}

test("D1 lead adapter preserves list, create, and activity SQL behavior", async () => {
  const intent = leadIntent();
  const database = new FakeD1Database({
    all: () => [intent.lead],
    first: ({ sql }) => sql === "SELECT * FROM leads WHERE id = ?" ? intent.lead : null,
  });
  const repository = createD1LeadRepository(database);

  assert.deepEqual(await repository.list(), [intent.lead]);
  const created = await repository.create(intent);
  assert.deepEqual(created, { outcome: "created", value: intent.lead });
  assert.equal(
    database.prepared[0].sql,
    "SELECT * FROM leads ORDER BY updated_at DESC, created_at DESC LIMIT 500",
  );
  assert.equal(database.batches.length, 1);
  assert.match(database.batches[0][0].sql, /^INSERT INTO leads /);
  assert.match(database.batches[0][1].sql, /^INSERT INTO activity_events /);
  assert.deepEqual(database.batches[0][1].values.slice(1, 4), [
    LEAD_ID,
    "Lead created",
    "owner@example.test",
  ]);
});

test("D1 lead updates keep stage evidence before next-action evidence", async () => {
  const intent = leadIntent();
  const database = new FakeD1Database({ first: () => intent.lead });
  const repository = createD1LeadRepository(database);
  const result = await repository.update({
    leadId: LEAD_ID,
    values: {
      company: intent.lead.company,
      contactName: intent.lead.contact_name,
      contactEmail: intent.lead.contact_email,
      contactPhone: intent.lead.contact_phone,
      projectName: intent.lead.project_name,
      source: intent.lead.source,
      stage: "Proposal",
      site: intent.lead.site,
      estimatedValue: intent.lead.estimated_value,
      nextAction: "Send proposal",
      nextActionAt: intent.lead.next_action_at,
      ownerEmail: intent.lead.owner_email,
      status: "active",
    },
    updatedAt: UPDATED_AT,
    updatedBy: "owner@example.test",
    activities: [
      { id: LEAD_ACTIVITY_ID, recordId: LEAD_ID, action: "Lead stage changed", actor: "owner@example.test", detail: "Qualified → Proposal", createdAt: UPDATED_AT },
      { id: MEETING_ACTIVITY_ID, recordId: LEAD_ID, action: "Lead next action changed", actor: "owner@example.test", detail: "Send proposal", createdAt: UPDATED_AT },
    ],
  });
  assert.equal(result.outcome, "updated");
  assert.deepEqual(database.batches[0].slice(1).map(({ values }) => values[2]), [
    "Lead stage changed",
    "Lead next action changed",
  ]);
});

test("D1 meeting adapter preserves project lookups and batched activity evidence", async () => {
  const intent = meetingIntent();
  const database = new FakeD1Database({
    first: ({ sql }) => {
      if (sql === "SELECT id FROM projects WHERE id = ?") return { id: PROJECT_ID };
      if (sql === "SELECT id, project_number FROM projects WHERE id = ?") {
        return { id: PROJECT_ID, project_number: "CF-2026-33333333" };
      }
      if (sql === "SELECT * FROM project_meetings WHERE id = ?") return intent.meeting;
      return null;
    },
    all: () => [intent.meeting],
  });
  const repository = createD1ProjectMeetingRepository(database);

  assert.equal(await repository.projectExists(PROJECT_ID), true);
  assert.deepEqual(await repository.findProjectForCreation(PROJECT_ID), {
    id: PROJECT_ID,
    projectNumber: "CF-2026-33333333",
  });
  assert.deepEqual(await repository.listForProject(PROJECT_ID), [intent.meeting]);
  assert.deepEqual(await repository.create(intent), { outcome: "created", value: intent.meeting });
  assert.match(database.batches[0][0].sql, /^INSERT INTO project_meetings /);
  assert.match(database.batches[0][1].sql, /^INSERT INTO activity_events /);
});

function result(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function step(match, response = result(), inspect) {
  return { match, response, inspect };
}

function transactionSteps(readOnly = false) {
  return [
    step(readOnly ? /^BEGIN READ ONLY$/ : /^BEGIN$/),
    step(/^SET LOCAL lock_timeout = '5000ms'$/),
    step(/^SET LOCAL statement_timeout = '30000ms'$/),
    step(/set_config\('search_path'/, result([], 1)),
    step(/current_schema\(\)/, result([{ current_schema: "repository_test" }], 1)),
  ];
}

class ScriptedPostgresClient {
  constructor(steps) {
    this.steps = [...steps];
    this.queries = [];
    this.releases = [];
  }
  async query(sql, values = []) {
    const query = { sql: sql.trim(), values: [...values] };
    this.queries.push(query);
    const expected = this.steps.shift();
    assert.ok(expected, `unexpected PostgreSQL query: ${query.sql}`);
    assert.match(query.sql, expected.match);
    expected.inspect?.(query);
    return expected.response;
  }
  release(error) {
    this.releases.push(error);
  }
  assertComplete() {
    assert.deepEqual(this.steps, []);
    assert.deepEqual(this.releases, [undefined]);
  }
}

class ScriptedPostgresPool {
  constructor(client) {
    this.client = client;
  }
  async connect() {
    return this.client;
  }
}

function postgresLeadRow() {
  const { lead } = leadIntent();
  return {
    ...lead,
    estimated_value: String(lead.estimated_value),
    next_action_at: new Date(lead.next_action_at),
    created_at: new Date(lead.created_at),
    updated_at: new Date(lead.updated_at),
    version: "1",
  };
}

function postgresMeetingRow() {
  const { meeting } = meetingIntent();
  return {
    id: meeting.id,
    project_id: meeting.project_id,
    title: meeting.title,
    meeting_at: new Date(meeting.meeting_at),
    meeting_type: meeting.meeting_type,
    source_provider: meeting.source_provider,
    source_url: meeting.source_url,
    attendees: JSON.parse(meeting.attendees_json),
    notes: meeting.notes,
    transcript: meeting.transcript,
    summary: meeting.summary,
    decisions: meeting.decisions,
    action_items: JSON.parse(meeting.action_items_json),
    created_by: meeting.created_by,
    created_at: new Date(meeting.created_at),
    updated_at: new Date(meeting.updated_at),
    version: "1",
  };
}

test("PostgreSQL lead create atomically stores activity, outbox, and idempotent response", async () => {
  const intent = leadIntent();
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: creationRequest().idempotencyRequestId }], 1), ({ values }) => {
      assert.equal(values[2], "leads.create");
      assert.equal(values[4], calculatePostgresLeadCreationFingerprint(intent));
    }),
    step(/INSERT INTO leads/, result([postgresLeadRow()], 1)),
    step(/INSERT INTO activity_events[\s\S]*lead_id/, result([], 1)),
    step(/INSERT INTO outbox_events[\s\S]*'lead\.created'/, result([], 1)),
    step(/UPDATE idempotency_requests[\s\S]*status = 'completed'/, result([{ version: "2" }], 1)),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresLeadRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: creationRequest(),
  });

  const accepted = await repository.create(intent);
  assert.equal(accepted.outcome, "accepted");
  assert.equal(accepted.replayed, false);
  assert.deepEqual(accepted.value.row, intent.lead);
  assert.equal(accepted.value.version, "1");
  const completion = client.queries.find(({ sql }) => /status = 'completed'/.test(sql));
  assert.equal(completion.values[0], JSON.stringify(accepted.value));
  client.assertComplete();
});

test("PostgreSQL lead fingerprints exclude generated IDs and timestamps", () => {
  const first = leadIntent();
  const second = leadIntent({
    id: "88888888-8888-4888-8888-888888888888",
    lead_number: "L-2026-88888888",
    created_at: CREATED_AT + 50_000,
    updated_at: UPDATED_AT + 50_000,
  });
  second.activity.recordId = second.lead.id;
  second.activity.createdAt = second.lead.created_at;
  assert.equal(
    calculatePostgresLeadCreationFingerprint(first),
    calculatePostgresLeadCreationFingerprint(second),
  );
});

test("PostgreSQL meeting create records a replayable missing-project result", async () => {
  const intent = meetingIntent();
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: creationRequest().idempotencyRequestId }], 1), ({ values }) => {
      assert.equal(values[2], "project_meetings.create");
      assert.equal(values[4], calculatePostgresProjectMeetingCreationFingerprint(intent));
    }),
    step(/SELECT id::text AS id FROM projects[\s\S]*FOR KEY SHARE/, result([], 0)),
    step(/UPDATE idempotency_requests[\s\S]*status = 'failed'/, result([{ version: "2" }], 1), ({ values }) => {
      assert.equal(values[0], 404);
      assert.equal(values[1], JSON.stringify({ outcome: "project-not-found" }));
    }),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresProjectMeetingRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: creationRequest(),
  });

  assert.deepEqual(await repository.create(intent), { outcome: "project-not-found" });
  assert.equal(client.queries.some(({ sql }) => /INSERT INTO project_meetings/.test(sql)), false);
  client.assertComplete();
});

test("PostgreSQL meeting create keeps record, project activity, outbox, and response in one transaction", async () => {
  const intent = meetingIntent();
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    step(/INSERT INTO idempotency_requests/, result([{ id: creationRequest().idempotencyRequestId }], 1)),
    step(/SELECT id::text AS id FROM projects[\s\S]*FOR KEY SHARE/, result([{ id: PROJECT_ID }], 1)),
    step(/INSERT INTO project_meetings/, result([postgresMeetingRow()], 1)),
    step(/INSERT INTO activity_events[\s\S]*project_id/, result([], 1)),
    step(/INSERT INTO outbox_events[\s\S]*'project\.meeting\.created'/, result([], 1)),
    step(/UPDATE idempotency_requests[\s\S]*status = 'completed'/, result([{ version: "2" }], 1)),
    step(/^COMMIT$/),
  ]);
  const repository = createPostgresProjectMeetingRepository(new ScriptedPostgresPool(client), {
    schema: "repository_test",
    request: creationRequest(),
  });

  const accepted = await repository.create(intent);
  assert.equal(accepted.outcome, "accepted");
  assert.equal(accepted.replayed, false);
  assert.deepEqual(accepted.value.row, intent.meeting);
  assert.equal(accepted.value.version, "1");
  client.assertComplete();
});
