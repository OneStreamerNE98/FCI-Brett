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
} from "../app/assistant/task-management.ts";

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

test("task filters map to the existing closed GET query without introducing an endpoint", () => {
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

test("conflict helpers expose saved values and reject malformed task payloads", () => {
  const saved = task();
  assert.equal(isTaskManagementRecord(saved), true);
  assert.equal(isTaskManagementRecord({ ...saved, version: 4 }), false);
  assert.equal(isTaskManagementRecord({ ...saved, status: "cancelled" }), false);
  assert.equal(taskManagementSavedValue(saved, "status"), "Done");
  assert.equal(taskManagementSavedValue({ ...saved, dueDate: null }, "dueDate"), "Not set");
});

test("the Assistant task surface uses only the finished task APIs and preserves review-safe conflicts", async () => {
  const [assistant, panel, helper, today] = await Promise.all([
    read("app/assistant/components/AssistantView.tsx"),
    read("app/assistant/components/TaskManagementPanel.tsx"),
    read("app/assistant/task-management.ts"),
    read("app/assistant/components/TodayPanel.tsx"),
  ]);

  assert.match(assistant, /type AssistantTab = "today" \| "ask" \| "tasks"/u);
  assert.match(assistant, /<TaskManagementPanel projects=\{projects\} \/>/u);
  assert.match(panel, /fetch\(`\/api\/v1\/tasks\?\$\{taskManagementSearch\(nextFilters\)\}`\)/u);
  assert.match(panel, /fetch\("\/api\/v1\/tasks"/u);
  assert.match(panel, /fetch\(`\/api\/v1\/tasks\/\$\{encodeURIComponent\(editor\.task\.id\)\}`/u);
  assert.doesNotMatch(panel, /method: "DELETE"|\/api\/v1\/tasks\/[^$]/u);
  assert.match(panel, /body: JSON\.stringify\(patch\)/u);
  assert.match(panel, /This task changed after you opened it\./u);
  assert.match(panel, /Saved value: \{conflictValue\}/u);
  assert.match(panel, /Re-apply changes/u);
  assert.match(panel, /Reopen task/u);
  assert.match(panel, /fallbackFocusRef=\{stableFocusRef\}/u);
  assert.match(panel, /<fieldset className=\{styles\.formGrid\} disabled=\{saving\}>/u);
  assert.match(panel, /taskManagementSearch\(appliedFilters\)/u);
  assert.match(panel, /candidate\.id === taskId[\s\S]*candidate\.version === currentVersion/u);
  assert.match(panel, /conflict && !conflict\.current[\s\S]*"Refresh list to continue"/u);
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
});

test("EDIT-07 adds no task route and no second task table", async () => {
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
