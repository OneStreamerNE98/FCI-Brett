import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const OFFICE_EMAIL = "admincrm@cherryhillfci.com";
const SECOND_OFFICE_EMAIL = "task-editor@example.test";
const REVIEW_ADMIN_EMAIL = "inbox-review-admin@example.test";
const REVIEW_VALIDATION_ADMIN_EMAIL = "inbox-review-validation@example.test";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const LEAD_ID = "55555555-5555-4555-8555-555555555555";
const MISSING_PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_LEAD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const CREATE_ACTIVITY_ID = "22222222-2222-4222-8222-222222222222";
const COMPLETE_ACTIVITY_ID = "44444444-4444-4444-8444-444444444444";
const REOPEN_ACTIVITY_ID = "77777777-7777-4777-8777-777777777777";
const REVIEW_ID = "99999999-9999-4999-8999-999999999999";
const CONNECTION_KEY = "workspace-simulation";
const SIMULATION_MAILBOX = "workspace-simulation@fci.example";
const REVIEW_MAILBOX = "shared-intake@cherryhillfci.com";
const REVIEW_CONNECTION_KEY = "gmail_task_review_mailbox";
const GMAIL_MESSAGE_ID = "gmail-ai11-task-accept";
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

  reset({
    projectIds = [PROJECT_ID],
    leadIds = [LEAD_ID],
    mailItems = [],
    googleConnections = [],
  } = {}) {
    this.tasks = new Map();
    this.meetings = new Map();
    this.activities = [];
    this.mailItems = new Map(mailItems.map((item) => [item.id, { ...item }]));
    this.googleConnections = new Map(
      googleConnections.map((connection) => [connection.google_email.toLowerCase(), { ...connection }]),
    );
    this.prepared = [];
    this.projectIds = new Set(projectIds);
    this.leadIds = new Set(leadIds);
    this.taskReadBarrier = null;
    this.failNextTaskInsert = false;
    this.failNextActivityInsert = false;
  }

  armConcurrentTaskReads() {
    const waiting = [];
    this.taskReadBarrier = (row) => new Promise((resolve) => {
      waiting.push(() => resolve(row ? { ...row } : null));
      if (waiting.length === 2) {
        this.taskReadBarrier = null;
        for (const release of waiting) release();
      }
    });
  }

  prepare(sql) {
    const statement = new StatefulD1Statement(this, sql);
    this.prepared.push(statement);
    return statement;
  }

  first(statement) {
    if (statement.sql === "SELECT * FROM tasks WHERE id = ?") {
      const row = this.tasks.get(statement.values[0]) ?? null;
      return this.taskReadBarrier ? this.taskReadBarrier(row) : row;
    }
    if (statement.sql === "SELECT version FROM tasks WHERE id = ?") {
      const task = this.tasks.get(statement.values[0]);
      return task ? { version: task.version } : null;
    }
    if (statement.sql === "SELECT id FROM projects WHERE id = ?") {
      return this.projectIds.has(statement.values[0]) ? { id: statement.values[0] } : null;
    }
    if (statement.sql === "SELECT id FROM leads WHERE id = ?") {
      return this.leadIds.has(statement.values[0]) ? { id: statement.values[0] } : null;
    }
    if (statement.sql === "SELECT id, project_number FROM projects WHERE id = ?") {
      return this.projectIds.has(statement.values[0])
        ? { id: statement.values[0], project_number: "CF-2026-33333333" }
        : null;
    }
    if (statement.sql === "SELECT * FROM project_meetings WHERE id = ?") {
      return this.meetings.get(statement.values[0]) ?? null;
    }
    if (statement.sql.includes("FROM workspace_blueprints WHERE connection_key = ?")) {
      return null;
    }
    if (statement.sql.includes("FROM workspace_settings WHERE id = ?")) {
      return null;
    }
    if (statement.sql.includes("FROM google_connections WHERE lower(google_email) = ?")) {
      return this.googleConnections.get(String(statement.values[0]).toLowerCase()) ?? null;
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
    if (statement.sql.includes("FROM workspace_resources WHERE connection_key = ?")) {
      return [];
    }
    throw new Error(`Unexpected D1 all query: ${statement.sql}`);
  }

  async batch(statements) {
    const tasksSnapshot = new Map(
      [...this.tasks].map(([id, task]) => [id, { ...task }]),
    );
    const mailItemsSnapshot = new Map(
      [...this.mailItems].map(([id, item]) => [id, { ...item }]),
    );
    const activitiesSnapshot = this.activities.map((activity) => ({ ...activity }));
    const results = [];
    let previousChanges = 0;
    try {
      for (const statement of statements) {
      if (statement.sql.startsWith("UPDATE mail_items SET status = 'accepted'")) {
        const reviewId = statement.values.find((value) => this.mailItems.has(value));
        const current = reviewId ? this.mailItems.get(reviewId) : null;
        const connectionKey = statement.values.find(
          (value) => value === current?.connection_key,
        );
        const gmailMessageId = statement.values.find((value) => value === GMAIL_MESSAGE_ID);
        const intent = statement.values.find((value) =>
          value === "schedule" || value === "warranty"
        );
        const acceptedAt = statement.values.find((value) =>
          Number.isSafeInteger(value) && value >= CREATED_AT
        );
        const approvedProjectId = statement.values.find((value) =>
          value === PROJECT_ID || value === null
        ) ?? null;
        let storedIntents = [];
        if (current) {
          try {
            const payload = JSON.parse(current.analysis_payload);
            if (Array.isArray(payload?.intents)) storedIntents = payload.intents;
          } catch {
            storedIntents = [];
          }
        }
        if (
          !current
          || current.status !== "needs-review"
          || current.connection_key !== connectionKey
          || current.gmail_message_id !== gmailMessageId
          || !storedIntents.includes(intent)
        ) {
          previousChanges = 0;
          results.push({ meta: { changes: 0 } });
          continue;
        }
        this.mailItems.set(reviewId, {
          ...current,
          status: "accepted",
          approved_project_id: approvedProjectId,
          attempted_label_definition_version: null,
          failure_attempts: 0,
          error_code: null,
          updated_at: acceptedAt,
        });
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      if (statement.sql.startsWith("INSERT INTO tasks ")) {
        if (this.failNextTaskInsert) {
          this.failNextTaskInsert = false;
          throw new Error("simulated D1 task insert failure");
        }
        if (statement.sql.includes("WHERE changes() = 1") && previousChanges !== 1) {
          previousChanges = 0;
          results.push({ meta: { changes: 0 } });
          continue;
        }
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
        if (this.tasks.has(id)) {
          throw new Error("D1_ERROR: UNIQUE constraint failed: tasks.id: SQLITE_CONSTRAINT");
        }
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
          version: 1,
        });
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      if (statement.sql.startsWith("UPDATE tasks SET ")) {
        const id = statement.values[9];
        const current = this.tasks.get(id);
        const expectedVersion = String(statement.values[10]);
        const versionGuarded = statement.sql.includes("WHERE id = ? AND version = ?");
        if (!current || versionGuarded && String(current.version) !== expectedVersion) {
          previousChanges = 0;
          results.push({ meta: { changes: 0 } });
          continue;
        }
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
          version: current.version + 1,
        });
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
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
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      if (statement.sql.startsWith("INSERT INTO activity_events ")) {
        if (this.failNextActivityInsert) {
          this.failNextActivityInsert = false;
          throw new Error("simulated D1 activity insert failure");
        }
        const [id, recordId, action, actor, detail, createdAt] = statement.values;
        if (
          statement.sql.includes("EXISTS (SELECT 1 FROM tasks")
          && !this.tasks.has(recordId)
        ) {
          previousChanges = 0;
          results.push({ meta: { changes: 0 } });
          continue;
        }
        if (statement.sql.includes("changes() = 1")) {
          const task = this.tasks.get(statement.values[6]);
          const versionGuarded = statement.sql.includes("version = ?");
          if (
            previousChanges !== 1
            || !task
            || versionGuarded && (
              String(task.version) !== String(statement.values[7])
              || task.updated_at !== statement.values[8]
            )
          ) {
            previousChanges = 0;
            results.push({ meta: { changes: 0 } });
            continue;
          }
        }
        this.activities.push({ id, recordId, action, actor, detail, createdAt });
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      throw new Error(`Unexpected D1 batch statement: ${statement.sql}`);
      }
      return results;
    } catch (error) {
      this.tasks = tasksSnapshot;
      this.mailItems = mailItemsSnapshot;
      this.activities = activitiesSnapshot;
      throw error;
    }
  }
}

const database = new StatefulD1Database();
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
const workerEnvironment = {
  FCI_OFFICE_EMAILS: `${OFFICE_EMAIL},${SECOND_OFFICE_EMAIL},${REVIEW_ADMIN_EMAIL},${REVIEW_VALIDATION_ADMIN_EMAIL}`,
  FCI_ADMIN_EMAILS: `${OFFICE_EMAIL},${REVIEW_ADMIN_EMAIL},${REVIEW_VALIDATION_ADMIN_EMAIL}`,
  DB: database,
};
const deferredChatTasks = [];
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;
globalThis.__FCI_TEST_CLOUDFLARE_WAIT_UNTIL__ = (promise) => {
  deferredChatTasks.push({
    promise,
    persistedTaskIds: [...database.tasks.keys()],
  });
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
  d1TaskRepositoryModule,
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
  vite.ssrLoadModule("/app/adapters/d1/task-repository.ts"),
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
  delete globalThis.__FCI_TEST_CLOUDFLARE_WAIT_UNTIL__;
  await vite.close();
});

const { createTask, listTasks, updateTask } = taskOperationsModule;
const { creationAuthorizationFor } = taskAuthorizationModule;
const { AUTHORIZATION_CAPABILITIES } = authorizationCapabilitiesModule;
const { MemoryTaskRepository } = memoryTaskRepositoryModule;
const { createD1TaskRepository } = d1TaskRepositoryModule;
const { createPostgresTaskRepository } = postgresTaskRepositoryModule;
const {
  normalizeTaskCreation,
  normalizeTaskListFilters,
  normalizeTaskPatch,
  TASK_SOURCES,
  TASK_STATUSES,
  TASK_PATCH_KEYS,
} = taskDomainModule;

function taskAuthorization(...capabilities) {
  return creationAuthorizationFor({ actorId: OFFICE_EMAIL, capabilities });
}

function taskRequest(path, method, body, officeEmail = OFFICE_EMAIL) {
  const url = new URL(path, "https://fci.example.test");
  const request = new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: url.origin,
      "oai-authenticated-user-email": officeEmail,
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("task validation pins bounded text, closed enums, closed bodies, and filter limits", () => {
  assert.deepEqual([...TASK_STATUSES], ["open", "done"]);
  assert.deepEqual([...TASK_SOURCES], ["manual", "meeting", "email", "ai"]);
  assert.deepEqual([...TASK_PATCH_KEYS], [
    "title",
    "details",
    "status",
    "dueDate",
    "projectId",
    "leadId",
    "assigneeEmail",
  ]);
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
  assert.equal(normalizeTaskCreation({
    title: "Valid",
    source: "manual",
    sourceRef: 42,
  }).ok, false);
  assert.deepEqual(normalizeTaskPatch({ status: "done" }), {
    ok: true,
    value: { status: "done" },
  });
  assert.deepEqual(normalizeTaskPatch({ status: "done", version: "7" }), {
    ok: true,
    value: { version: "7", status: "done" },
  });
  assert.equal(normalizeTaskPatch({ status: "done", version: 0 }).ok, false);
  assert.equal(normalizeTaskPatch({ version: "1" }).ok, false);
  assert.equal(normalizeTaskPatch({ source: "ai" }).ok, false);
  assert.equal(normalizeTaskListFilters({ limit: "200" }).ok, true);
  assert.equal(normalizeTaskListFilters({ limit: "201" }).ok, false);
  assert.equal(normalizeTaskListFilters({ future: "value" }).ok, false);
});

test("memory task adapter round-trips create, filtered read, completion, and reopen", async () => {
  const repository = new MemoryTaskRepository({ projectIds: [PROJECT_ID] });
  const ids = [TASK_ID, CREATE_ACTIVITY_ID, COMPLETE_ACTIVITY_ID, REOPEN_ACTIVITY_ID];
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
    version: "1",
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
    ["Task created", "Task fields updated", "Task fields updated"],
  );
  assert.equal(repository.activityIntents()[1].detail, "Details: Check the FCI TEST — DO NOT USE project. → Not set; Status: open → done");
  assert.equal(repository.activityIntents()[2].detail, "Status: done → open");
  const current = await repository.findById(TASK_ID);
  const activityCount = repository.activityIntents().length;
  assert.deepEqual(await repository.update({
    task: { ...current, title: "Stale memory editor must lose" },
    expectedVersion: "1",
    updatedBy: OFFICE_EMAIL,
    activity: {
      id: "88888888-8888-4888-8888-888888888888",
      recordId: TASK_ID,
      action: "Task fields updated",
      actor: OFFICE_EMAIL,
      detail: "Title: Confirm material delivery → Stale memory editor must lose",
      createdAt: now + 1_000,
    },
  }), { outcome: "conflict", currentVersion: "3" });
  assert.equal((await repository.findById(TASK_ID)).title, "Confirm material delivery");
  assert.equal(repository.activityIntents().length, activityCount);
});

test("memory task adapter rejects orphan project and lead relationships on create and update", async () => {
  const repository = new MemoryTaskRepository({
    projectIds: [PROJECT_ID],
    leadIds: [LEAD_ID],
  });

  assert.deepEqual(
    await repository.create(taskCreationIntent({ project_id: MISSING_PROJECT_ID })),
    { outcome: "project-not-found" },
  );
  assert.deepEqual(
    await repository.create(taskCreationIntent({
      id: "66666666-6666-4666-8666-666666666666",
      project_id: null,
      lead_id: MISSING_LEAD_ID,
    })),
    { outcome: "lead-not-found" },
  );
  assert.deepEqual(repository.activityIntents(), []);

  const validIntent = taskCreationIntent({ project_id: PROJECT_ID, lead_id: LEAD_ID });
  assert.equal((await repository.create(validIntent)).outcome, "created");
  assert.deepEqual(
    await repository.update({
      task: { ...validIntent.task, project_id: MISSING_PROJECT_ID },
      expectedVersion: "1",
      updatedBy: OFFICE_EMAIL,
      activity: {
        id: COMPLETE_ACTIVITY_ID,
        recordId: TASK_ID,
        action: "Task fields updated",
        actor: OFFICE_EMAIL,
        detail: `${PROJECT_ID} → ${MISSING_PROJECT_ID}`,
        createdAt: COMPLETED_AT,
      },
    }),
    { outcome: "project-not-found" },
  );
  assert.deepEqual(
    await repository.update({
      task: { ...validIntent.task, lead_id: MISSING_LEAD_ID },
      expectedVersion: "1",
      updatedBy: OFFICE_EMAIL,
      activity: {
        id: REOPEN_ACTIVITY_ID,
        recordId: TASK_ID,
        action: "Task fields updated",
        actor: OFFICE_EMAIL,
        detail: `${LEAD_ID} → ${MISSING_LEAD_ID}`,
        createdAt: COMPLETED_AT,
      },
    }),
    { outcome: "lead-not-found" },
  );
  assert.deepEqual(await repository.findById(TASK_ID), validIntent.task);
  assert.deepEqual(
    repository.activityIntents().map(({ action }) => action),
    ["Task created"],
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
  assert.equal(
    database.prepared.some(({ sql }) =>
      /FROM (?:google_connections|workspace_resources|workspace_blueprints|workspace_settings)/u.test(sql)
    ),
    false,
    "ordinary task creation must not resolve a Gmail mailbox",
  );

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
  assert.equal(completed.version, "2");
  assert.deepEqual(
    database.activities.map(({ action }) => action),
    ["Task created", "Task fields updated"],
  );
  assert.equal(database.activities[1].detail, "Status: open → done");
  // EVERY task activity INSERT stays existence-guarded — creation-path included, not
  // only the changes()-guarded update path. Main pinned all of them; narrowing the
  // filter to changes() left the create guard unpinned (review finding, PR #225).
  const taskActivityInserts = database.prepared
    .filter(({ sql }) => sql.startsWith("INSERT INTO activity_events "));
  assert.equal(taskActivityInserts.length > 0, true);
  assert.equal(
    taskActivityInserts.every(({ sql }) => /EXISTS\s*\(\s*SELECT 1 FROM tasks/u.test(sql)),
    true,
  );
  assert.equal(
    taskActivityInserts
      .filter(({ sql }) => sql.includes("changes() = 1"))
      .every(({ sql }) => sql.includes("AND EXISTS (SELECT 1 FROM tasks")),
    true,
  );
});

test("D1 task route atomically accepts a matching schedule review through the existing POST", async () => {
  const reviewRow = inboxReviewRow({ connection_key: REVIEW_CONNECTION_KEY });
  database.reset({
    mailItems: [reviewRow],
    googleConnections: [googleConnectionRow()],
  });
  workerEnvironment.GOOGLE_INTEGRATION_MODE = "workspace";
  workerEnvironment.GOOGLE_WORKSPACE_INTAKE_MAILBOX = REVIEW_MAILBOX;
  const requestBody = {
    title: "Schedule the customer-requested measure",
    details: "Proposed from the reviewed email. Confirm the exact time before committing.",
    projectId: PROJECT_ID,
    source: "email",
    sourceRef: GMAIL_MESSAGE_ID,
    inboxReviewId: REVIEW_ID,
    inboxReviewIntent: "schedule",
    inboxReviewMailbox: REVIEW_MAILBOX.toUpperCase(),
  };
  let response;
  try {
    response = await tasksRoute.POST(taskRequest(
      "/api/v1/tasks",
      "POST",
      requestBody,
      REVIEW_ADMIN_EMAIL,
    ));
  } finally {
    delete workerEnvironment.GOOGLE_INTEGRATION_MODE;
    delete workerEnvironment.GOOGLE_WORKSPACE_INTAKE_MAILBOX;
  }

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.task.source, "email");
  assert.equal(body.task.sourceRef, GMAIL_MESSAGE_ID);
  assert.deepEqual(body.inboxReview, { id: REVIEW_ID, status: "accepted" });
  assert.equal(database.tasks.size, 1);
  assert.equal(
    database.prepared.some(({ sql, values }) =>
      sql.includes("FROM google_connections WHERE lower(google_email) = ?")
      && values[0] === REVIEW_MAILBOX
    ),
    true,
    "the server must resolve the human mailbox email to its internal key",
  );
  assert.deepEqual(
    database.activities.map(({ action }) => action),
    ["Task created"],
  );
  assert.deepEqual(database.mailItems.get(REVIEW_ID), {
    ...reviewRow,
    status: "accepted",
    approved_project_id: PROJECT_ID,
    attempted_label_definition_version: null,
    failure_attempts: 0,
    error_code: null,
    updated_at: database.mailItems.get(REVIEW_ID).updated_at,
  });
  assert.equal(
    Number.isSafeInteger(database.mailItems.get(REVIEW_ID).updated_at),
    true,
  );

  const reviewUpdate = database.prepared.find(({ sql }) =>
    sql.startsWith("UPDATE mail_items SET status = 'accepted'"));
  assert.ok(reviewUpdate);
  assert.match(reviewUpdate.sql, /status = 'needs-review'/u);
  assert.match(reviewUpdate.sql, /analysis_payload/u);
  assert.match(reviewUpdate.sql, /json_valid\(analysis_payload\) = 1/u);
  assert.match(reviewUpdate.sql, /json_type\(analysis_payload, '\$\.intents'\) = 'array'/u);
  assert.match(reviewUpdate.sql, /stored_intent\.type = 'text'/u);
  const guardedTaskInsert = database.prepared.find(({ sql }) =>
    sql.startsWith("INSERT INTO tasks ") && sql.includes("changes() = 1"));
  assert.ok(guardedTaskInsert, "task creation is fenced by the accepted-row update");

  workerEnvironment.GOOGLE_INTEGRATION_MODE = "workspace";
  workerEnvironment.GOOGLE_WORKSPACE_INTAKE_MAILBOX = REVIEW_MAILBOX;
  let repeated;
  try {
    repeated = await tasksRoute.POST(taskRequest(
      "/api/v1/tasks",
      "POST",
      requestBody,
      REVIEW_ADMIN_EMAIL,
    ));
  } finally {
    delete workerEnvironment.GOOGLE_INTEGRATION_MODE;
    delete workerEnvironment.GOOGLE_WORKSPACE_INTAKE_MAILBOX;
  }
  assert.equal(repeated.status, 409);
  assert.deepEqual(await repeated.json(), {
    error: "Inbox review changed since it was loaded.",
  });
  assert.equal(database.tasks.size, 1);
  assert.equal(database.activities.length, 1);
});

test("D1 task route keeps a stale or mismatched review atomic and admin-only", async () => {
  for (const row of [
    inboxReviewRow({ status: "dismissed" }),
    inboxReviewRow({
      analysis_payload: JSON.stringify({ intents: ["project-update"] }),
    }),
    inboxReviewRow({
      analysis_payload: JSON.stringify({ intents: "schedule" }),
    }),
    inboxReviewRow({
      analysis_payload: "{not-json",
    }),
    inboxReviewRow({
      connection_key: "another-workspace",
    }),
    inboxReviewRow({
      gmail_message_id: "another-gmail-message",
    }),
  ]) {
    database.reset({ mailItems: [row] });
    const response = await tasksRoute.POST(taskRequest("/api/v1/tasks", "POST", {
      title: "Must not be created",
      source: "email",
      sourceRef: GMAIL_MESSAGE_ID,
      inboxReviewId: REVIEW_ID,
      inboxReviewIntent: "schedule",
      inboxReviewMailbox: SIMULATION_MAILBOX,
    }, REVIEW_ADMIN_EMAIL));
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(database.tasks.size, 0);
    assert.deepEqual(database.activities, []);
    assert.deepEqual(database.mailItems.get(REVIEW_ID), row);
  }

  database.reset({ mailItems: [inboxReviewRow()] });
  const forbidden = await tasksRoute.POST(taskRequest(
    "/api/v1/tasks",
    "POST",
    {
      title: "Non-admin must not accept inbox work",
      source: "email",
      sourceRef: GMAIL_MESSAGE_ID,
      inboxReviewId: REVIEW_ID,
      inboxReviewIntent: "schedule",
      inboxReviewMailbox: SIMULATION_MAILBOX,
    },
    SECOND_OFFICE_EMAIL,
  ));
  assert.equal(forbidden.status, 403);
  assert.equal(database.tasks.size, 0);
  assert.deepEqual(database.activities, []);
  assert.deepEqual(database.mailItems.get(REVIEW_ID), inboxReviewRow());
});

test("D1 task route rejects malformed review composition before persistence", async () => {
  for (const body of [
    {
      title: "Missing the paired intent",
      source: "email",
      sourceRef: GMAIL_MESSAGE_ID,
      inboxReviewId: REVIEW_ID,
    },
    {
      title: "Unsupported accept action",
      source: "email",
      sourceRef: GMAIL_MESSAGE_ID,
      inboxReviewId: REVIEW_ID,
      inboxReviewIntent: "project-update",
      inboxReviewMailbox: SIMULATION_MAILBOX,
    },
    {
      title: "Review accepts cannot masquerade as manual work",
      source: "manual",
      sourceRef: GMAIL_MESSAGE_ID,
      inboxReviewId: REVIEW_ID,
      inboxReviewIntent: "schedule",
      inboxReviewMailbox: SIMULATION_MAILBOX,
    },
    {
      title: "Review accepts require a human mailbox email",
      source: "email",
      sourceRef: GMAIL_MESSAGE_ID,
      inboxReviewId: REVIEW_ID,
      inboxReviewIntent: "schedule",
      inboxReviewMailbox: REVIEW_CONNECTION_KEY,
    },
  ]) {
    database.reset({ mailItems: [inboxReviewRow()] });
    const response = await tasksRoute.POST(taskRequest(
      "/api/v1/tasks",
      "POST",
      body,
      REVIEW_VALIDATION_ADMIN_EMAIL,
    ));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(database.tasks.size, 0);
    assert.deepEqual(database.activities, []);
    assert.deepEqual(database.mailItems.get(REVIEW_ID), inboxReviewRow());
  }
});

test("D1 task adapter rolls the review decision back when task persistence fails", async () => {
  const row = inboxReviewRow();
  database.reset({ mailItems: [row] });
  database.failNextTaskInsert = true;
  const repository = createD1TaskRepository(database);

  await assert.rejects(
    repository.create(inboxReviewTaskCreationIntent("warranty")),
    /simulated D1 task insert failure/u,
  );
  assert.equal(database.tasks.size, 0);
  assert.deepEqual(database.activities, []);
  assert.deepEqual(database.mailItems.get(REVIEW_ID), row);
});

test("D1 task adapter rolls the review decision back when audit persistence fails", async () => {
  const row = inboxReviewRow();
  database.reset({ mailItems: [row] });
  database.failNextActivityInsert = true;
  const repository = createD1TaskRepository(database);

  await assert.rejects(
    repository.create(inboxReviewTaskCreationIntent()),
    /simulated D1 activity insert failure/u,
  );
  assert.equal(database.tasks.size, 0);
  assert.deepEqual(database.activities, []);
  assert.deepEqual(database.mailItems.get(REVIEW_ID), row);
});

test("D1 task route rejects a second write at the same version without audit evidence", async () => {
  database.reset();
  const createResponse = await tasksRoute.POST(taskRequest("/api/v1/tasks", "POST", {
    title: "Versioned task",
    source: "manual",
  }, SECOND_OFFICE_EMAIL));
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).task;
  assert.equal(created.version, "1");

  const first = await taskRoute.PATCH(
    taskRequest(`/api/v1/tasks/${created.id}`, "PATCH", {
      title: "First editor won",
      version: "1",
    }, SECOND_OFFICE_EMAIL),
    { params: Promise.resolve({ taskId: created.id }) },
  );
  assert.equal(first.status, 200);
  assert.equal((await first.json()).task.version, "2");
  const auditCount = database.activities.length;

  const stale = await taskRoute.PATCH(
    taskRequest(`/api/v1/tasks/${created.id}`, "PATCH", {
      title: "Stale editor must lose",
      version: "1",
    }, SECOND_OFFICE_EMAIL),
    { params: Promise.resolve({ taskId: created.id }) },
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.deepEqual(await stale.json(), {
    error: "Task changed since it was loaded.",
    currentVersion: "2",
  });
  assert.equal(database.tasks.get(created.id).title, "First editor won");
  assert.equal(database.tasks.get(created.id).version, 2);
  assert.equal(database.activities.length, auditCount);
});

test("D1 task adapter serializes two concurrent writes at one version and audits only the winner", async () => {
  database.reset();
  database.tasks.set(TASK_ID, { ...taskRow(), version: 1 });
  database.armConcurrentTaskReads();
  const repository = createD1TaskRepository(database);
  const updateIntent = (title, activityId) => ({
    task: taskRow({
      title,
      updated_at: COMPLETED_AT,
    }),
    expectedVersion: "1",
    updatedBy: OFFICE_EMAIL,
    activity: {
      id: activityId,
      recordId: TASK_ID,
      action: "Task fields updated",
      actor: OFFICE_EMAIL,
      detail: `Title: Review project notes → ${title}`,
      createdAt: COMPLETED_AT,
    },
  });

  const results = await Promise.all([
    repository.update(updateIntent("Concurrent editor A", COMPLETE_ACTIVITY_ID)),
    repository.update(updateIntent("Concurrent editor B", REOPEN_ACTIVITY_ID)),
  ]);
  assert.equal(results.filter(({ outcome }) => outcome === "updated").length, 1);
  assert.deepEqual(
    results.filter(({ outcome }) => outcome === "conflict"),
    [{ outcome: "conflict", currentVersion: "2" }],
  );
  assert.equal(database.tasks.get(TASK_ID).version, 2);
  assert.equal(database.activities.length, 1);
  const updateStatement = database.prepared.find(({ sql }) =>
    sql.startsWith("UPDATE tasks SET "));
  assert.match(updateStatement.sql, /WHERE id = \? AND version = \?$/u);
  const auditStatement = database.prepared.find(({ sql }) =>
    sql.startsWith("INSERT INTO activity_events ") && sql.includes("changes() = 1"));
  assert.match(
    auditStatement.sql,
    /WHERE changes\(\) = 1 AND EXISTS \(SELECT 1 FROM tasks WHERE id = \? AND version = \? AND updated_at = \?\)/u,
  );
});

test("task-create Chat trigger queues only assigned tasks after persistence and keeps the 201 response", async () => {
  deferredChatTasks.length = 0;
  workerEnvironment.GOOGLE_CHAT_NOTIFICATIONS_ENABLED = "true";
  try {
    database.reset();
    const unassigned = await tasksRoute.POST(taskRequest("/api/v1/tasks", "POST", {
      title: "Leave this task unassigned",
      source: "manual",
    }));
    assert.equal(unassigned.status, 201);
    assert.equal((await unassigned.json()).task.assigneeEmail, null);
    assert.equal(deferredChatTasks.length, 0);

    database.reset();
    const assigned = await tasksRoute.POST(taskRequest("/api/v1/tasks", "POST", {
      title: "Notify the assigned office user",
      assigneeEmail: OFFICE_EMAIL,
      source: "manual",
    }));
    const assignedBody = await assigned.json();
    assert.equal(assigned.status, 201);
    assert.equal(assignedBody.task.assigneeEmail, OFFICE_EMAIL);
    assert.equal(deferredChatTasks.length, 1);
    assert.deepEqual(deferredChatTasks[0].persistedTaskIds, [assignedBody.task.id]);
    await deferredChatTasks[0].promise;
  } finally {
    delete workerEnvironment.GOOGLE_CHAT_NOTIFICATIONS_ENABLED;
    deferredChatTasks.length = 0;
  }
});

test("D1 task routes return 404 for orphan project and lead relationships without writes", async () => {
  for (const [field, value, error] of [
    ["projectId", MISSING_PROJECT_ID, "Project not found."],
    ["leadId", MISSING_LEAD_ID, "Lead not found."],
  ]) {
    database.reset();
    const response = await tasksRoute.POST(taskRequest("/api/v1/tasks", "POST", {
      title: "Must not persist",
      source: "manual",
      [field]: value,
    }));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error });
    assert.equal(database.tasks.size, 0);
    assert.deepEqual(database.activities, []);
  }

  database.reset();
  const createResponse = await tasksRoute.POST(taskRequest("/api/v1/tasks", "POST", {
    title: "Keep valid relationships",
    projectId: PROJECT_ID,
    leadId: LEAD_ID,
    source: "manual",
  }));
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).task;

  for (const [field, value, error] of [
    ["projectId", MISSING_PROJECT_ID, "Project not found."],
    ["leadId", MISSING_LEAD_ID, "Lead not found."],
  ]) {
    const response = await taskRoute.PATCH(
      taskRequest(`/api/v1/tasks/${created.id}`, "PATCH", { [field]: value }),
      { params: Promise.resolve({ taskId: created.id }) },
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error });
  }

  assert.equal(database.tasks.get(created.id).project_id, PROJECT_ID);
  assert.equal(database.tasks.get(created.id).lead_id, LEAD_ID);
  assert.deepEqual(
    database.activities.map(({ action }) => action),
    ["Task created"],
  );
});

test("D1 task adapter maps duplicate IDs without appending duplicate activity", async () => {
  database.reset();
  const repository = createD1TaskRepository(database);
  const intent = taskCreationIntent({ project_id: PROJECT_ID, lead_id: LEAD_ID });

  assert.equal((await repository.create(intent)).outcome, "created");
  assert.deepEqual(await repository.create(intent), { outcome: "identifier-collision" });
  assert.deepEqual(
    database.activities.map(({ action }) => action),
    ["Task created"],
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

function pgErrorStep(match, error, inspect) {
  return { match, error, inspect };
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
    if (expected.error) throw expected.error;
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
    lead_id: LEAD_ID,
    assignee_email: OFFICE_EMAIL,
    source: "meeting",
    source_ref: "meeting-1",
    created_by: OFFICE_EMAIL,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    completed_at: null,
    version: "1",
    ...overrides,
  };
}

function taskCreationIntent(overrides = {}) {
  const task = taskRow(overrides);
  return {
    task,
    activities: [{
      id: CREATE_ACTIVITY_ID,
      recordId: task.id,
      action: "Task created",
      actor: task.created_by,
      detail: `${task.title}${task.due_date ? ` · due ${task.due_date}` : ""}`,
      createdAt: task.created_at,
    }],
  };
}

function inboxReviewRow(overrides = {}) {
  return {
    id: REVIEW_ID,
    connection_key: CONNECTION_KEY,
    gmail_message_id: GMAIL_MESSAGE_ID,
    status: "needs-review",
    approved_project_id: null,
    analysis_payload: JSON.stringify({
      intents: ["schedule", "warranty"],
    }),
    attempted_label_definition_version: "catalog-prior-attempt",
    failure_attempts: 2,
    error_code: "analysis_failed",
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function googleConnectionRow(overrides = {}) {
  return {
    id: "google-connection-task-review",
    connection_key: REVIEW_CONNECTION_KEY,
    google_subject: "google-subject-task-review",
    google_email: REVIEW_MAILBOX,
    refresh_token_ciphertext: "encrypted-token",
    key_version: "v1",
    scopes_json: JSON.stringify([
      "https://www.googleapis.com/auth/gmail.modify",
    ]),
    status: "connected",
    ...overrides,
  };
}

function inboxReviewTaskCreationIntent(
  intent = "schedule",
  overrides = {},
) {
  return {
    ...taskCreationIntent({
      source: "email",
      source_ref: GMAIL_MESSAGE_ID,
      ...overrides,
    }),
    inboxReview: {
      id: REVIEW_ID,
      connectionKey: CONNECTION_KEY,
      gmailMessageId: GMAIL_MESSAGE_ID,
      intent,
      approvedProjectId: PROJECT_ID,
      acceptedAt: CREATED_AT,
      reviewedBy: OFFICE_EMAIL,
      acceptedIntent: intent,
    },
  };
}

function postgresTaskRow(overrides = {}) {
  const task = taskRow(overrides);
  return {
    ...task,
    created_at: new Date(task.created_at),
    updated_at: new Date(task.updated_at),
    completed_at: task.completed_at === null ? null : new Date(task.completed_at),
    version: task.version,
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
    pgStep(/INSERT INTO tasks/u, pgResult([postgresTaskRow()], 1), ({ sql, values }) => {
      assert.match(sql, /due_date, project_id, lead_id,[\s\S]*\$5::date, \$6, \$7/u);
      assert.equal(values[0], TASK_ID);
      assert.equal(values[5], PROJECT_ID);
      assert.equal(values[6], LEAD_ID);
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

test("PostgreSQL task create atomically accepts a matching inbox review", async () => {
  const intent = inboxReviewTaskCreationIntent("warranty");
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(
      /UPDATE mail_items[\s\S]*status = 'accepted'[\s\S]*status = 'needs-review'/u,
      pgResult([{ id: REVIEW_ID }], 1),
      ({ sql, values }) => {
        assert.match(sql, /connection_key/u);
        assert.match(sql, /gmail_message_id/u);
        assert.match(sql, /analysis_payload/u);
        assert.match(
          sql,
          /pg_catalog\.jsonb_typeof\(analysis_payload -> 'intents'\) = 'array'/u,
        );
        assert.equal(values.includes(REVIEW_ID), true);
        assert.equal(values.includes(CONNECTION_KEY), true);
        assert.equal(values.includes(GMAIL_MESSAGE_ID), true);
        assert.equal(values.includes("warranty"), true);
        assert.equal(values.includes(PROJECT_ID), true);
      },
    ),
    pgStep(/INSERT INTO tasks/u, pgResult([postgresTaskRow({
      source: "email",
      source_ref: GMAIL_MESSAGE_ID,
    })], 1)),
    pgStep(/INSERT INTO activity_events[\s\S]*task_id/u, pgResult([], 1)),
    pgStep(/^COMMIT$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  assert.deepEqual(await repository.create(intent), {
    outcome: "review-accepted",
    value: taskRow({
      source: "email",
      source_ref: GMAIL_MESSAGE_ID,
    }),
    inboxReview: {
      id: REVIEW_ID,
      status: "accepted",
    },
  });
  client.assertComplete();
});

test("PostgreSQL stale inbox review creates no task or audit", async () => {
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(
      /UPDATE mail_items[\s\S]*status = 'needs-review'/u,
      pgResult([], 0),
    ),
    pgStep(/^COMMIT$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  assert.deepEqual(
    await repository.create(inboxReviewTaskCreationIntent()),
    { outcome: "review-not-found" },
  );
  assert.equal(
    client.queries.some(({ sql }) =>
      sql.startsWith("INSERT INTO tasks")
      || sql.startsWith("INSERT INTO activity_events")),
    false,
  );
  client.assertComplete();
});

test("PostgreSQL rolls back the inbox review when task persistence fails", async () => {
  const taskError = new Error("simulated PostgreSQL task insert failure");
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(
      /UPDATE mail_items[\s\S]*status = 'needs-review'/u,
      pgResult([{ id: REVIEW_ID }], 1),
    ),
    pgErrorStep(/INSERT INTO tasks/u, taskError),
    pgStep(/^ROLLBACK$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  await assert.rejects(
    repository.create(inboxReviewTaskCreationIntent()),
    /simulated PostgreSQL task insert failure/u,
  );
  assert.equal(
    client.queries.some(({ sql }) => sql.startsWith("INSERT INTO activity_events")),
    false,
  );
  client.assertComplete();
});

test("PostgreSQL rolls back the inbox review and task when audit persistence fails", async () => {
  const activityError = new Error("simulated PostgreSQL activity insert failure");
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(
      /UPDATE mail_items[\s\S]*status = 'needs-review'/u,
      pgResult([{ id: REVIEW_ID }], 1),
    ),
    pgStep(/INSERT INTO tasks/u, pgResult([postgresTaskRow({
      source: "email",
      source_ref: GMAIL_MESSAGE_ID,
    })], 1)),
    pgErrorStep(/INSERT INTO activity_events[\s\S]*task_id/u, activityError),
    pgStep(/^ROLLBACK$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  await assert.rejects(
    repository.create(inboxReviewTaskCreationIntent()),
    /simulated PostgreSQL activity insert failure/u,
  );
  client.assertComplete();
});

test("PostgreSQL task completion uses version CAS and appends guarded field-update evidence", async () => {
  const task = taskRow({
    status: "done",
    updated_at: COMPLETED_AT,
    completed_at: COMPLETED_AT,
    version: "2",
  });
  const activity = {
    id: COMPLETE_ACTIVITY_ID,
    recordId: TASK_ID,
    action: "Task fields updated",
    actor: OFFICE_EMAIL,
    detail: "Status: open → done",
    createdAt: COMPLETED_AT,
  };
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(/UPDATE tasks SET/u, pgResult([postgresTaskRow(task)], 1), ({ sql, values }) => {
      assert.match(sql, /project_id = \$5, lead_id = \$6/u);
      assert.equal(values[2], "done");
      assert.equal(values[4], PROJECT_ID);
      assert.equal(values[5], LEAD_ID);
      assert.equal(values[7], OFFICE_EMAIL);
      assert.equal(values[10], TASK_ID);
      assert.equal(values[11], "1");
    }),
    pgStep(/INSERT INTO activity_events[\s\S]*WHERE EXISTS[\s\S]*version = \$8::bigint/u, pgResult([], 1), ({ values }) => {
      assert.equal(values[2], "Task fields updated");
      assert.equal(values[5], JSON.stringify({ message: "Status: open → done" }));
      assert.equal(values[7], "2");
    }),
    pgStep(/^COMMIT$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  assert.deepEqual(await repository.update({
    task,
    expectedVersion: "1",
    updatedBy: OFFICE_EMAIL,
    activity,
  }), {
    outcome: "updated",
    value: task,
  });
  client.assertComplete();
});

test("PostgreSQL task stale version returns current version and writes no audit", async () => {
  const task = taskRow({
    title: "Stale editor must lose",
    updated_at: COMPLETED_AT,
  });
  const client = new ScriptedPostgresClient([
    ...transactionSteps(),
    pgStep(/UPDATE tasks SET[\s\S]*WHERE id = \$11 AND version = \$12::bigint/u, pgResult([], 0)),
    pgStep(/SELECT version::text AS version FROM tasks WHERE id = \$1/u, pgResult([
      { version: "2" },
    ], 1)),
    pgStep(/^COMMIT$/u),
  ]);
  const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
    schema: "task_test",
  });

  assert.deepEqual(await repository.update({
    task,
    expectedVersion: "1",
    updatedBy: OFFICE_EMAIL,
    activity: {
      id: COMPLETE_ACTIVITY_ID,
      recordId: TASK_ID,
      action: "Task fields updated",
      actor: OFFICE_EMAIL,
      detail: "Title: Review project notes → Stale editor must lose",
      createdAt: COMPLETED_AT,
    },
  }), {
    outcome: "conflict",
    currentVersion: "2",
  });
  assert.equal(
    client.queries.some(({ sql }) => sql.startsWith("INSERT INTO activity_events")),
    false,
  );
  client.assertComplete();
});

test("PostgreSQL task writes map project and lead FK violations to the shared port outcomes", async () => {
  for (const [constraint, outcome] of [
    ["tasks_project_id_fkey", "project-not-found"],
    ["tasks_lead_id_fkey", "lead-not-found"],
  ]) {
    for (const operation of ["create", "update"]) {
      const error = Object.assign(new Error("simulated PostgreSQL foreign-key violation"), {
        code: "23503",
        constraint,
      });
      const client = new ScriptedPostgresClient([
        ...transactionSteps(),
        pgErrorStep(
          operation === "create" ? /INSERT INTO tasks/u : /UPDATE tasks SET/u,
          error,
          ({ sql }) => {
            assert.match(sql, /project_id/u);
            assert.match(sql, /lead_id/u);
          },
        ),
        pgStep(/^ROLLBACK$/u),
      ]);
      const repository = createPostgresTaskRepository(new ScriptedPostgresPool(client), {
        schema: "task_test",
      });
      const result = operation === "create"
        ? await repository.create(taskCreationIntent())
        : await repository.update({
            task: taskRow(),
            expectedVersion: "1",
            updatedBy: OFFICE_EMAIL,
            activity: {
              id: COMPLETE_ACTIVITY_ID,
              recordId: TASK_ID,
              action: "Task fields updated",
              actor: OFFICE_EMAIL,
              detail: "Title: Before → After",
              createdAt: CREATED_AT,
            },
          });

      assert.deepEqual(result, { outcome });
      client.assertComplete();
    }
  }
});
