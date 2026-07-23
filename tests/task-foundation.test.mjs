import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const OFFICE_EMAIL = "admincrm@cherryhillfci.com";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const CREATE_ACTIVITY_ID = "22222222-2222-4222-8222-222222222222";
const COMPLETE_ACTIVITY_ID = "44444444-4444-4444-8444-444444444444";
const CREATED_AT = Date.UTC(2026, 6, 23, 12, 0, 0);
const COMPLETED_AT = CREATED_AT + 60_000;

class StatefulD1Statement {
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

class StatefulD1Database {
  constructor() {
    this.reset();
  }

  reset() {
    this.tasks = new Map();
    this.meetings = new Map();
    this.activities = [];
  }

  prepare(sql) {
    return new StatefulD1Statement(this, sql);
  }

  first(statement) {
    if (statement.sql === "SELECT * FROM tasks WHERE id = ?") {
      return this.tasks.get(statement.values[0]) ?? null;
    }
    if (statement.sql === "SELECT id FROM projects WHERE id = ?") {
      return statement.values[0] === PROJECT_ID ? { id: PROJECT_ID } : null;
    }
    if (statement.sql === "SELECT id, project_number FROM projects WHERE id = ?") {
      return statement.values[0] === PROJECT_ID
        ? { id: PROJECT_ID, project_number: "CF-2026-33333333" }
        : null;
    }
    if (statement.sql === "SELECT * FROM project_meetings WHERE id = ?") {
      return this.meetings.get(statement.values[0]) ?? null;
    }
    throw new Error(`Unexpected D1 first query: ${statement.sql}`);
  }

  all(statement) {
    if (statement.sql.startsWith("SELECT * FROM tasks")) {
      let rows = [...this.tasks.values()];
      let valueIndex = 0;
      if (statement.sql.includes("status = ?")) {
        const status = statement.values[valueIndex++];
        rows = rows.filter((row) => row.status === status);
      }
      if (statement.sql.includes("due_date IS NOT NULL AND due_date <= ?")) {
        const dueBefore = statement.values[valueIndex++];
        rows = rows.filter((row) => row.due_date !== null && row.due_date <= dueBefore);
      }
      if (statement.sql.includes("project_id = ?")) {
        const projectId = statement.values[valueIndex++];
        rows = rows.filter((row) => row.project_id === projectId);
      }
      if (statement.sql.includes("lead_id = ?")) {
        const leadId = statement.values[valueIndex++];
        rows = rows.filter((row) => row.lead_id === leadId);
      }
      if (statement.sql.includes("assignee_email = ?")) {
        const assignee = statement.values[valueIndex++];
        rows = rows.filter((row) => row.assignee_email === assignee);
      }
      const limit = statement.values.at(-1);
      return rows
        .sort((left, right) =>
          (left.due_date === null ? 1 : 0) - (right.due_date === null ? 1 : 0)
          || (left.due_date ?? "").localeCompare(right.due_date ?? "")
          || right.updated_at - left.updated_at
          || left.id.localeCompare(right.id))
        .slice(0, limit);
    }
    if (statement.sql.startsWith("SELECT * FROM project_meetings WHERE project_id = ?")) {
      return [...this.meetings.values()].filter((row) => row.project_id === statement.values[0]);
    }
    throw new Error(`Unexpected D1 all query: ${statement.sql}`);
  }

  async batch(statements) {
    return statements.map((statement) => {
      if (statement.sql.startsWith("INSERT INTO tasks ")) {
        const [
          id,
          title,
          details,
          status,
          dueDate,
          projectId,
          leadId,
          assigneeEmail,
          source,
          sourceRef,
          createdBy,
          createdAt,
          updatedAt,
          completedAt,
        ] = statement.values;
        this.tasks.set(id, {
          id,
          title,
          details,
          status,
          due_date: dueDate,
          project_id: projectId,
          lead_id: leadId,
          assignee_email: assigneeEmail,
          source,
          source_ref: sourceRef,
          created_by: createdBy,
          created_at: createdAt,
          updated_at: updatedAt,
          completed_at: completedAt,
        });
        return { meta: { changes: 1 } };
      }
      if (statement.sql.startsWith("UPDATE tasks SET ")) {
        const id = statement.values[9];
        const current = this.tasks.get(id);
        if (!current) return { meta: { changes: 0 } };
        const [
          title,
          details,
          status,
          dueDate,
          projectId,
          leadId,
          assigneeEmail,
          updatedAt,
          completedAt,
        ] = statement.values;
        this.tasks.set(id, {
          ...current,
          title,
          details,
          status,
          due_date: dueDate,
          project_id: projectId,
          lead_id: leadId,
          assignee_email: assigneeEmail,
          updated_at: updatedAt,
          completed_at: completedAt,
        });
        return { meta: { changes: 1 } };
      }
      if (statement.sql.startsWith("INSERT INTO project_meetings ")) {
        const [
          id,
          projectId,
          title,
          meetingAt,
          meetingType,
          sourceProvider,
          sourceUrl,
          attendeesJson,
          notes,
          transcript,
          summary,
          decisions,
          actionItemsJson,
          createdBy,
          createdAt,
          updatedAt,
        ] = statement.values;
        this.meetings.set(id, {
          id,
          project_id: projectId,
          title,
          meeting_at: meetingAt,
          meeting_type: meetingType,
          source_provider: sourceProvider,
          source_url: sourceUrl,
          attendees_json: attendeesJson,
          notes,
          transcript,
          summary,
          decisions,
          action_items_json: actionItemsJson,
          created_by: createdBy,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return { meta: { changes: 1 } };
      }
      if (statement.sql.startsWith("INSERT INTO activity_events ")) {
        const [id, recordId, action, actor, detail, createdAt] = statement.values;
        this.activities.push({ id, recordId, action, actor, detail, createdAt });
        return { meta: { changes: 1 } };
      }
      throw new Error(`Unexpected D1 batch statement: ${statement.sql}`);
    });
  }
}

const database = new StatefulD1Database();
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = {
  FCI_OFFICE_EMAILS: OFFICE_EMAIL,
  FCI_ADMIN_EMAILS: OFFICE_EMAIL,
  DB: database,
};

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-task-foundation", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24715 } },
});

const [
  taskOperationsModule,
  taskAuthorizationModule,
  authorizationCapabilitiesModule,
  memoryTaskRepositoryModule,
  postgresTaskRepositoryModule,
  taskDomainModule,
  tasksRoute,
  taskRoute,
  meetingsRoute,
] = await Promise.all([
  vite.ssrLoadModule("/app/application/task-operations.ts"),
  vite.ssrLoadModule("/app/application/creation-authorization.ts"),
  vite.ssrLoadModule("/app/application/authorization-capabilities.ts"),
  vite.ssrLoadModule("/app/adapters/memory/task-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/task-repository.ts"),
  vite.ssrLoadModule("/app/domain/task.ts"),
  vite.ssrLoadModule("/app/api/v1/tasks/route.ts"),
  vite.ssrLoadModule("/app/api/v1/tasks/[taskId]/route.ts"),
  vite.ssrLoadModule("/app/api/v1/projects/[projectId]/meetings/route.ts"),
]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

const { createTask, listTasks, updateTask } = taskOperationsModule;
const { creationAuthorizationFor } = taskAuthorizationModule;
const { AUTHORIZATION_CAPABILITIES } = authorizationCapabilitiesModule;
const { MemoryTaskRepository } = memoryTaskRepositoryModule;
const { createPostgresTaskRepository } = postgresTaskRepositoryModule;
const {
  normalizeTaskCreation,
  normalizeTaskListFilters,
  normalizeTaskPatch,
  TASK_SOURCES,
  TASK_STATUSES,
} = taskDomainModule;

function taskAuthorization(...capabilities) {
  return creationAuthorizationFor({ actorId: OFFICE_EMAIL, capabilities });
}

function taskRequest(path, method, body) {
  const url = new URL(path, "https://fci.example.test");
  const request = new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: url.origin,
      "oai-authenticated-user-email": OFFICE_EMAIL,
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("task validation pins bounded text, closed enums, closed bodies, and filter limits", () => {
  assert.deepEqual([...TASK_STATUSES], ["open", "done"]);
  assert.deepEqual([...TASK_SOURCES], ["manual", "meeting", "email", "ai"]);
  assert.equal(normalizeTaskCreation({
    title: "x".repeat(200),
    details: "y".repeat(4_000),
    status: "open",
    source: "ai",
  }).ok, true);
  assert.equal(normalizeTaskCreation({
    title: "x".repeat(201),
    source: "manual",
  }).ok, false);
  assert.equal(normalizeTaskCreation({
    title: "Valid",
    details: "y".repeat(4_001),
    source: "manual",
  }).ok, false);
  assert.equal(normalizeTaskCreation({
    title: "Valid",
    status: "blocked",
    source: "manual",
  }).ok, false);
  assert.equal(normalizeTaskCreation({
    title: "Valid",
    source: "scheduled",
  }).ok, false);
  assert.equal(normalizeTaskCreation({
    title: "Valid",
    source: "manual",
    unexpected: true,
  }).ok, false);
  assert.deepEqual(normalizeTaskPatch({ status: "done" }), {
    ok: true,
    value: { status: "done" },
  });
  assert.equal(normalizeTaskPatch({ source: "ai" }).ok, false);
  assert.equal(normalizeTaskListFilters({ limit: "200" }).ok, true);
  assert.equal(normalizeTaskListFilters({ limit: "201" }).ok, false);
  assert.equal(normalizeTaskListFilters({ future: "value" }).ok, false);
});

test("memory task adapter round-trips create, filtered read, completion, and reopen", async () => {
  const repository = new MemoryTaskRepository();
  const ids = [TASK_ID, CREATE_ACTIVITY_ID, COMPLETE_ACTIVITY_ID];
  let now = CREATED_AT;
  const dependencies = {
    repository,
    newId: () => ids.shift(),
    now: () => now,
  };
  const created = await createTask(
    {
      title: "Confirm material delivery",
      details: "Check the FCI TEST — DO NOT USE project.",
      dueDate: "2026-07-24",
      projectId: PROJECT_ID,
      assigneeEmail: "Office.User@Example.Test",
      source: "manual",
    },
    taskAuthorization(AUTHORIZATION_CAPABILITIES.tasksUpdate),
    dependencies,
  );
  assert.equal(created.ok, true);
  assert.deepEqual(created.value, {
    id: TASK_ID,
    title: "Confirm material delivery",
    details: "Check the FCI TEST — DO NOT USE project.",
    status: "open",
    dueDate: "2026-07-24",
    projectId: PROJECT_ID,
    leadId: null,
    assigneeEmail: "office.user@example.test",
    source: "manual",
    sourceRef: null,
    createdBy: OFFICE_EMAIL,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: null,
  });

  const listed = await listTasks(
    { status: "open", projectId: PROJECT_ID, limit: "20" },
    taskAuthorization(AUTHORIZATION_CAPABILITIES.recordsRead),
    repository,
  );
  assert.deepEqual(listed, { ok: true, value: [created.value] });

  now = COMPLETED_AT;
  const completed = await updateTask(
    TASK_ID,
    { status: "done", details: null },
    taskAuthorization(AUTHORIZATION_CAPABILITIES.tasksUpdate),
    dependencies,
  );
  assert.equal(completed.ok, true);
  assert.equal(completed.value.status, "done");
  assert.equal(completed.value.details, null);
  assert.equal(completed.value.completedAt, COMPLETED_AT);

  now += 1_000;
  const reopened = await updateTask(
    TASK_ID,
    { status: "open" },
    taskAuthorization(AUTHORIZATION_CAPABILITIES.tasksUpdate),
    dependencies,
  );
  assert.equal(reopened.ok, true);
  assert.equal(reopened.value.status, "open");
  assert.equal(reopened.value.completedAt, null);
  assert.deepEqual(
    repository.activityIntents().map(({ action }) => action),
    ["Task created", "Task completed"],
  );
});

test("D1 task routes round-trip create, list, and completion with activity evidence", async () => {
  database.reset();
  const createResponse = await tasksRoute.POST(taskRequest("/api/v1/tasks", "POST", {
    title: "Review project notes",
    dueDate: "2026-07-25",
    projectId: PROJECT_ID,
    source: "meeting",
    sourceRef: "meeting-1",
  }));
  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.headers.get("cache-control"), "no-store");
  const created = (await createResponse.json()).task;
  assert.equal(created.title, "Review project notes");
  assert.equal(created.status, "open");
  assert.equal(created.source, "meeting");

  const listUrl = new URL(
    `/api/v1/tasks?status=open&projectId=${PROJECT_ID}`,
    "https://fci.example.test",
  );
  const listRequest = new Request(listUrl, {
    headers: { "oai-authenticated-user-email": OFFICE_EMAIL },
  });
  Object.defineProperty(listRequest, "nextUrl", { value: listUrl });
  const listResponse = await tasksRoute.GET(listRequest);
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).tasks.map(({ id }) => id), [created.id]);

  const updateResponse = await taskRoute.PATCH(
    taskRequest(`/api/v1/tasks/${created.id}`, "PATCH", { status: "done" }),
    { params: Promise.resolve({ taskId: created.id }) },
  );
  assert.equal(updateResponse.status, 200);
  const completed = (await updateResponse.json()).task;
  assert.equal(completed.status, "done");
  assert.equal(typeof completed.completedAt, "number");
  assert.deepEqual(
    database.activities.map(({ action }) => action),
    ["Task created", "Task completed"],
  );
});

test("project-meeting POST accepts phone-call and echoes the meeting type", async () => {
  database.reset();
  const response = await meetingsRoute.POST(
    taskRequest(`/api/v1/projects/${PROJECT_ID}/meetings`, "POST", {
      title: "FCI TEST — DO NOT USE phone call",
      meetingAt: "2026-07-23T13:00:00.000Z",
      meetingType: "phone-call",
      notes: "Customer confirmed the test-only delivery window.",
      attendees: ["Test Customer"],
      actionItems: ["Confirm the test-only delivery date"],
    }),
    { params: Promise.resolve({ projectId: PROJECT_ID }) },
  );

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.meeting.meetingType, "phone-call");
  assert.equal([...database.meetings.values()][0].meeting_type, "phone-call");
});

function pgResult(rows = [], rowCount = null) {
  return { rows, rowCount };
}

function pgStep(match, response = pgResult(), inspect) {
  return { match, response, inspect };
}

function transactionSteps(readOnly = false) {
  return [
    pgStep(readOnly ? /^BEGIN READ ONLY$/u : /^BEGIN$/u),
    pgStep(/^SET LOCAL lock_timeout = '5000ms'$/u),
    pgStep(/^SET LOCAL statement_timeout = '30000ms'$/u),
    pgStep(/set_config\('search_path'/u, pgResult([], 1)),
    pgStep(/current_schema\(\)/u, pgResult([{ current_schema: "task_test" }], 1)),
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
    assert.ok(expected, `Unexpected PostgreSQL query: ${query.sql}`);
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

function taskRow(overrides = {}) {
  return {
    id: TASK_ID,
    title: "Review project notes",
    details: "FCI TEST — DO NOT USE",
    status: "open",
    due_date: "2026-07-25",
    project_id: PROJECT_ID,
    lead_id: null,
    assignee_email: OFFICE_EMAIL,
    source: "meeting",
    source_ref: "meeting-1",
    created_by: OFFICE_EMAIL,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    completed_at: null,
    ...overrides,
  };
}

function postgresTaskRow(overrides = {}) {
  const task = taskRow(overrides);
  return {
    ...task,
    created_at: new Date(task.created_at),
    updated_at: new Date(task.updated_at),
    completed_at: task.completed_at === null ? null : new Date(task.completed_at),
    version: "1",
  };
}

test("PostgreSQL task create atomically stores the row and activity evidence", async () => {
  const task = taskRow();
  const activity = {
    id: CREATE_ACTIVITY_ID,
    recordId: TASK_ID,
    action: "Task created",
    actor: OFFICE_EMAIL,
    detail: "Review project notes · due 2026-07-25",
    createdAt: CREATED_AT,
  };
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(/INSERT INTO tasks/u, pgResult([postgresTaskRow()], 1), ({ values }) => {
      assert.equal(values[0], TASK_ID);
      assert.equal(values[5], PROJECT_ID);
      assert.equal(values[11], OFFICE_EMAIL);
    }),
    pgStep(/INSERT INTO activity_events[\s\S]*task_id/u, pgResult([], 1), ({ values }) => {
      assert.deepEqual(values.slice(0, 4), [
        CREATE_ACTIVITY_ID,
        TASK_ID,
        "Task created",
        OFFICE_EMAIL,
      ]);
    }),
    pgStep(/^COMMIT$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  assert.deepEqual(await repository.create({ task, activities: [activity] }), {
    outcome: "created",
    value: task,
  });
  client.assertComplete();
});

test("PostgreSQL task completion updates the row and appends completion evidence", async () => {
  const task = taskRow({
    status: "done",
    updated_at: COMPLETED_AT,
    completed_at: COMPLETED_AT,
  });
  const activity = {
    id: COMPLETE_ACTIVITY_ID,
    recordId: TASK_ID,
    action: "Task completed",
    actor: OFFICE_EMAIL,
    detail: task.title,
    createdAt: COMPLETED_AT,
  };
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(/UPDATE tasks SET/u, pgResult([postgresTaskRow(task)], 1), ({ values }) => {
      assert.equal(values[2], "done");
      assert.equal(values[7], OFFICE_EMAIL);
      assert.equal(values[10], TASK_ID);
    }),
    pgStep(/INSERT INTO activity_events[\s\S]*task_id/u, pgResult([], 1), ({ values }) => {
      assert.equal(values[2], "Task completed");
    }),
    pgStep(/^COMMIT$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  assert.deepEqual(await repository.update({
    task,
    updatedBy: OFFICE_EMAIL,
    activity,
  }), {
    outcome: "updated",
    value: task,
  });
  client.assertComplete();
});
