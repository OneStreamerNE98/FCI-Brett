import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  isTaskManagementRecord,
  TASK_MANAGEMENT_PATCH_KEYS,
  taskManagementCreateBody,
  taskManagementDraft,
  taskManagementPatch,
  taskManagementSavedValue,
  taskManagementSearch,
  TASK_MANAGEMENT_RESULT_LIMIT,
} from "../app/assistant/task-management.ts";
import {
  MAX_TASK_LIST_RESULTS,
  TASK_PATCH_KEYS as DOMAIN_TASK_PATCH_KEYS,
} from "../app/domain/task.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function task(overrides = {}) {
  return {
    id: "task-edit07",
    title: "Confirm material delivery",
    details: "Call the distributor.",
    status: "done",
    dueDate: "2026-07-31",
    projectId: "project-edit07",
    leadId: "lead-edit07",
    assigneeEmail: "office@example.test",
    source: "manual",
    sourceRef: null,
    createdBy: "admin@example.test",
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
    version: "4",
    ...overrides,
  };
}

test("task form helpers expose every PATCH field and send changed keys only", () => {
  assert.deepEqual(
    TASK_MANAGEMENT_PATCH_KEYS,
    DOMAIN_TASK_PATCH_KEYS,
    "the UI field catalog must grow with the authoritative task PATCH contract",
  );
  assert.deepEqual(TASK_MANAGEMENT_PATCH_KEYS, [
    "title",
    "details",
    "status",
    "dueDate",
    "projectId",
    "leadId",
    "assigneeEmail",
  ]);

  const saved = task();
  assert.equal(taskManagementPatch(saved, taskManagementDraft(saved)), null);

  const changed = {
    ...taskManagementDraft(saved),
    title: "Confirm revised delivery",
    status: "open",
    details: "",
    assigneeEmail: "",
  };
  assert.deepEqual(taskManagementPatch(saved, changed), {
    version: "4",
    title: "Confirm revised delivery",
    details: null,
    status: "open",
    assigneeEmail: null,
  });
  assert.deepEqual(taskManagementCreateBody(changed), {
    title: "Confirm revised delivery",
    details: null,
    status: "open",
    dueDate: "2026-07-31",
    projectId: "project-edit07",
    leadId: "lead-edit07",
    assigneeEmail: null,
    source: "manual",
  });
});

test("task filters map to the existing closed collection GET query", () => {
  assert.equal(
    taskManagementSearch({
      status: "done",
      assigneeEmail: " Office@Example.Test ",
      dueBefore: "2026-08-01",
      projectId: "project-edit07",
    }),
    "limit=200&status=done&assigneeEmail=office%40example.test&dueBefore=2026-08-01&projectId=project-edit07",
  );
  assert.equal(
    taskManagementSearch({
      status: "",
      assigneeEmail: "",
      dueBefore: "",
      projectId: "",
    }),
    "limit=200",
  );
});

test("a full page of task results is disclosed as possibly incomplete", async () => {
  // The API rejects any limit above MAX_TASK_LIST_RESULTS, so the client cannot request
  // one extra row to detect truncation — a full page is the only available signal, and
  // the panel must not present it as the whole set. The default filter carries no status,
  // so completed tasks occupy the same budget. The server orders undated rows after every
  // dated row (`ORDER BY due_date IS NULL, due_date, ...`); within the undated group,
  // older rows fall off before newer ones because updated_at sorts descending.
  assert.equal(TASK_MANAGEMENT_RESULT_LIMIT, MAX_TASK_LIST_RESULTS);
  const panel = await read("app/assistant/components/TaskManagementPanel.tsx");
  assert.match(
    panel,
    /tasks\.length >= TASK_MANAGEMENT_RESULT_LIMIT \?[\s\S]{0,400}Showing the first \{TASK_MANAGEMENT_RESULT_LIMIT\} tasks/u,
  );
  assert.match(panel, /Tasks without a due date are listed last/u);
});

test("conflict helpers expose saved values and reject malformed task payloads", () => {
  const saved = task();
  assert.equal(isTaskManagementRecord(saved), true);
  assert.equal(isTaskManagementRecord({ ...saved, version: 4 }), false);
  assert.equal(isTaskManagementRecord({ ...saved, status: "cancelled" }), false);
  assert.equal(taskManagementSavedValue(saved, "status"), "Done");
  assert.equal(taskManagementSavedValue({ ...saved, dueDate: null }, "dueDate"), "Not set");
});

test("the Assistant task surface uses the exact-task GET for review-safe conflict recovery", async () => {
  const [assistant, panel, helper, today, itemRoute] = await Promise.all([
    read("app/assistant/components/AssistantView.tsx"),
    read("app/assistant/components/TaskManagementPanel.tsx"),
    read("app/assistant/task-management.ts"),
    read("app/assistant/components/TodayPanel.tsx"),
    read("app/api/v1/tasks/[taskId]/route.ts"),
  ]);

  assert.match(assistant, /type AssistantTab = "today" \| "ask" \| "tasks"/u);
  assert.match(assistant, /<TaskManagementPanel projects=\{projects\} \/>/u);
  // SET-42 migrates task GETs to the shared SWR transport; task writes below
  // remain ordinary route mutations.
  assert.match(panel, /cachedGetJson<[\s\S]{0,100}>\(`\/api\/v1\/tasks\?\$\{taskManagementSearch\(nextFilters\)\}`, \{ force \}\)/u);
  assert.match(panel, /fetch\("\/api\/v1\/tasks"/u);
  assert.match(panel, /fetch\(`\/api\/v1\/tasks\/\$\{encodeURIComponent\(editor\.task\.id\)\}`/u);
  assert.match(panel, /cachedGetJson<[\s\S]{0,100}>\(taskUrl, \{ force: true \}\)/u);
  assert.doesNotMatch(panel, /method: "DELETE"|\/api\/v1\/tasks\/[^$]/u);
  assert.match(panel, /body: JSON\.stringify\(patch\)/u);
  assert.match(panel, /This task changed after you opened it\./u);
  assert.match(panel, /Saved value: \{conflictValue\}/u);
  assert.match(panel, /Re-apply changes/u);
  assert.match(panel, /Reopen task/u);
  assert.match(panel, /fallbackFocusRef=\{stableFocusRef\}/u);
  assert.match(panel, /<fieldset className=\{styles\.formGrid\} disabled=\{saving\}>/u);
  assert.match(panel, /loadTasks\(appliedFilters, true, true\)/u);
  assert.match(panel, /data\.task\.version !== currentVersion/u);
  assert.doesNotMatch(panel, /const searches =|for \(const \[index, search\] of searches/u);
  assert.match(panel, /conflict && !conflict\.current[\s\S]*"Wait for the automatic list update to continue"/u);
  assert.doesNotMatch(panel, /fetch\("\/api\/v1\/tasks\?limit=200"\)/u);
  assert.doesNotMatch(panel, /requestAnimationFrame/u);
  assert.match(helper, /Object\.keys\(patch\)\.length > 1 \? patch : null/u);
  for (const key of TASK_MANAGEMENT_PATCH_KEYS) {
    assert.match(panel, new RegExp(`conflictKeys\\.has\\("${key}"\\)`, "u"));
  }

  // EDIT-07 may add a sibling surface but cannot modify TodayPanel's completed-task
  // mutation or its pinned count calculation.
  assert.match(today, /body: JSON\.stringify\(\{ status: "done" \}\)/u);
  assert.match(today, /today\.overdueTasks\.total\s*\+\s*today\.dueTodayTasks\.total/u);
  assert.doesNotMatch(today, /TaskManagementPanel|Reopen task/u);

  const getStart = itemRoute.indexOf("export async function GET");
  const patchStart = itemRoute.indexOf("export async function PATCH");
  assert.ok(getStart >= 0 && patchStart > getStart);
  const getHandler = itemRoute.slice(getStart, patchStart);
  assert.ok(
    getHandler.indexOf("requireOfficeUser(request)") < getHandler.indexOf("context.params"),
    "the office gate must run before route parameters or database work",
  );
  assert.ok(
    getHandler.indexOf("context.params") < getHandler.indexOf("ensureWorkspaceSchema()"),
    "the task identifier must be validated before database work",
  );
  assert.match(getHandler, /noStoreResponse\(auth\.response\)/u);
  assert.match(getHandler, /\.findById\(taskId\)/u);
  assert.match(getHandler, /json\(\{ error: "Task not found\." \}, 404\)/u);
  assert.match(getHandler, /json\(\{ task: taskResponse\(task\) \}\)/u);
  assert.doesNotMatch(
    getHandler,
    /\b(?:INSERT|UPDATE|DELETE|UPSERT|REPLACE|ALTER|DROP|TRUNCATE)\b/iu,
    "the exact-task GET must remain read-only",
  );
});

test("EDIT-08 adds no new task route file and no second task table", async () => {
  const routeEntries = await readdir(new URL("app/api/v1/tasks/", root), {
    withFileTypes: true,
  });
  assert.deepEqual(
    routeEntries.map((entry) => `${entry.isDirectory() ? "directory" : "file"}:${entry.name}`).sort(),
    ["directory:[taskId]", "file:route.ts"],
  );
  const taskRouteEntries = await readdir(new URL("app/api/v1/tasks/[taskId]/", root));
  assert.deepEqual(taskRouteEntries, ["route.ts"]);

  const schema = await read("db/schema.ts");
  assert.equal(schema.match(/sqliteTable\("tasks"/gu)?.length, 1);
  const migrations = await readdir(new URL("drizzle/", root));
  assert.equal(migrations.filter((file) => file.startsWith("0018_")).length, 1);
});
