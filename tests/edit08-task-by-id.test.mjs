import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const officeEmail = "task-reader@example.test";
const taskId = "task-beyond-list-cap";
const taskRow = {
  id: taskId,
  title: "Review installation notes",
  details: "Confirm the revised closeout list.",
  status: "open",
  due_date: "2026-08-03",
  project_id: "project-201",
  lead_id: null,
  assignee_email: officeEmail,
  source: "manual",
  source_ref: null,
  created_by: officeEmail,
  created_at: Date.UTC(2026, 6, 30, 14, 0, 0),
  updated_at: Date.UTC(2026, 6, 30, 15, 0, 0),
  completed_at: null,
  version: 7,
};

class ReadStatement {
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
}

class ReadOnlyTaskDatabase {
  constructor() {
    this.queries = [];
  }

  prepare(sql) {
    const statement = new ReadStatement(this, sql);
    this.queries.push(statement);
    return statement;
  }

  first(statement) {
    assert.equal(statement.sql, "SELECT * FROM tasks WHERE id = ?");
    return statement.values[0] === taskId ? taskRow : null;
  }

  batch() {
    throw new Error("The task-by-id GET must not write.");
  }
}

const database = new ReadOnlyTaskDatabase();
const previousEnvironment = globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = {
  FCI_OFFICE_EMAILS: officeEmail,
  DB: database,
};

const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-edit08-task-by-id", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("fixtures/cloudflare-workers.mjs", import.meta.url),
      ),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24729 } },
});
const taskRoute = await vite.ssrLoadModule("/app/api/v1/tasks/[taskId]/route.ts");

after(async () => {
  await vite.close();
  if (previousEnvironment === undefined) delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  else globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = previousEnvironment;
});

function taskRequest(id) {
  const url = new URL(`/api/v1/tasks/${id}`, "https://fci.example.test");
  const request = new Request(url, {
    headers: { "oai-authenticated-user-email": officeEmail },
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("EDIT-08 returns one task by id in the existing management record shape", async () => {
  database.queries.length = 0;
  const response = await taskRoute.GET(taskRequest(taskId), {
    params: Promise.resolve({ taskId }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    task: {
      id: taskId,
      title: "Review installation notes",
      details: "Confirm the revised closeout list.",
      status: "open",
      dueDate: "2026-08-03",
      projectId: "project-201",
      leadId: null,
      assigneeEmail: officeEmail,
      source: "manual",
      sourceRef: null,
      createdBy: officeEmail,
      createdAt: Date.UTC(2026, 6, 30, 14, 0, 0),
      updatedAt: Date.UTC(2026, 6, 30, 15, 0, 0),
      completedAt: null,
      version: "7",
    },
  });
  assert.deepEqual(
    database.queries.map(({ sql, values }) => ({ sql, values })),
    [{ sql: "SELECT * FROM tasks WHERE id = ?", values: [taskId] }],
  );
});

test("EDIT-08 returns no-store 404 for a missing task and rejects an invalid id before D1", async () => {
  database.queries.length = 0;
  const missingResponse = await taskRoute.GET(taskRequest("missing-task"), {
    params: Promise.resolve({ taskId: "missing-task" }),
  });
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await missingResponse.json(), { error: "Task not found." });
  assert.equal(database.queries.length, 1);

  const invalidResponse = await taskRoute.GET(taskRequest("invalid task"), {
    params: Promise.resolve({ taskId: "invalid task" }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await invalidResponse.json(), {
    error: "Task identifier is invalid.",
  });
  assert.equal(database.queries.length, 1);
});
