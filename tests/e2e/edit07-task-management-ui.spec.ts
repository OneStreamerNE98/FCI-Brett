import { expect, test, type Page, type Route } from "@playwright/test";

type TaskRecord = {
  id: string;
  title: string;
  details: string | null;
  status: "open" | "done";
  dueDate: string | null;
  projectId: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
  source: string;
  sourceRef: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  version: string;
};

const now = Date.UTC(2026, 6, 29, 15);

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, "id" | "title">): TaskRecord {
  return {
    id: overrides.id,
    title: overrides.title,
    details: null,
    status: "open",
    dueDate: null,
    projectId: null,
    leadId: null,
    assigneeEmail: null,
    source: "manual",
    sourceRef: null,
    createdBy: "e2e-office@example.test",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    version: "1",
    ...overrides,
  };
}

async function mockEmptyToday(page: Page) {
  await page.route("**/api/v1/assistant/today", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: now,
        day: "2026-07-29",
        displayTimezone: "America/New_York",
        overdueTasks: { items: [], total: 0 },
        dueTodayTasks: { items: [], total: 0 },
        meetings: { items: [], total: 0 },
        leadFollowUps: { items: [], total: 0 },
        closeoutFollowUps: { items: [], total: 0 },
        inbox: {
          label: "Needs review",
          detail: "Open the inbox review queue",
          href: "/inbox?bucket=needs-review",
        },
      }),
    });
  });
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("tasks list, filter, create, edit, reopen, and re-apply a saved conflict through existing APIs", async ({ page }) => {
  await mockEmptyToday(page);

  const tasks = [
    task({
      id: "task-open",
      title: "Confirm material delivery",
      details: "Call the distributor.",
      dueDate: "2026-07-30",
      projectId: "e2e-project-001",
      assigneeEmail: "office@example.test",
    }),
    task({
      id: "task-done",
      title: "Send completed walkthrough",
      status: "done",
      completedAt: now,
    }),
    task({
      id: "task-conflict",
      title: "Draft customer recap",
      projectId: "e2e-project-001",
    }),
  ];
  const reads: string[] = [];
  const posts: unknown[] = [];
  const patches: Array<{ id: string; body: Record<string, unknown> }> = [];
  let conflictOnce = true;
  let conflictRecovery = false;
  const overflowTasks = Array.from({ length: 201 }, (_, index) => task({
    id: `task-overflow-${index}`,
    title: `Overflow task ${index}`,
    projectId: "other-project",
  }));
  let releaseTaskCreatedPatch = () => {};
  let taskCreatedPatchStarted = () => {};
  const taskCreatedPatchRelease = new Promise<void>((resolve) => {
    releaseTaskCreatedPatch = resolve;
  });
  const taskCreatedPatchStart = new Promise<void>((resolve) => {
    taskCreatedPatchStarted = resolve;
  });

  await page.route(/\/api\/v1\/tasks(?:\/[^?]+)?(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/tasks") {
      reads.push(url.search);
      const status = url.searchParams.get("status");
      const projectId = url.searchParams.get("projectId");
      const assigneeEmail = url.searchParams.get("assigneeEmail");
      const dueBefore = url.searchParams.get("dueBefore");
      const sourceRows = conflictRecovery && !projectId
        ? overflowTasks.slice(0, 200)
        : tasks;
      const visible = sourceRows.filter((row) => (
        (!status || row.status === status)
        && (!projectId || row.projectId === projectId)
        && (!assigneeEmail || row.assigneeEmail === assigneeEmail)
        && (!dueBefore || Boolean(row.dueDate && row.dueDate <= dueBefore))
      ));
      await fulfillJson(route, 200, { tasks: visible });
      return;
    }

    if (request.method() === "POST" && url.pathname === "/api/v1/tasks") {
      const body = request.postDataJSON();
      posts.push(body);
      const created = task({
        id: "task-created",
        title: body.title,
        details: body.details,
        status: body.status,
        dueDate: body.dueDate,
        projectId: body.projectId,
        leadId: body.leadId,
        assigneeEmail: body.assigneeEmail,
      });
      tasks.push(created);
      await fulfillJson(route, 201, { task: created });
      return;
    }

    if (request.method() === "PATCH" && url.pathname.startsWith("/api/v1/tasks/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/v1/tasks/".length));
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push({ id, body });
      const index = tasks.findIndex((row) => row.id === id);
      if (index < 0) {
        await fulfillJson(route, 404, { error: "Task not found." });
        return;
      }
      if (id === "task-conflict" && conflictOnce) {
        conflictOnce = false;
        conflictRecovery = true;
        tasks[index] = {
          ...tasks[index],
          title: "Saved by another user",
          version: "2",
          updatedAt: now + 1,
        };
        await fulfillJson(route, 409, {
          error: "Task changed since it was loaded.",
          currentVersion: "2",
        });
        return;
      }
      if (id === "task-created") {
        taskCreatedPatchStarted();
        await taskCreatedPatchRelease;
      }
      const next = { ...tasks[index] };
      for (const [key, value] of Object.entries(body)) {
        if (key !== "version") (next as unknown as Record<string, unknown>)[key] = value;
      }
      next.version = String(Number(next.version) + 1);
      next.updatedAt += 1;
      next.completedAt = next.status === "done" ? next.completedAt ?? next.updatedAt : null;
      tasks[index] = next;
      await fulfillJson(route, 200, { task: next });
      return;
    }

    await route.fallback();
  });

  await page.goto("/assistant");
  const tasksTab = page.getByRole("tab", { name: "Tasks", exact: true });
  await expect(async () => {
    await tasksTab.click();
    await expect(tasksTab).toHaveAttribute("aria-selected", "true", { timeout: 500 });
  }).toPass({ intervals: [100, 250, 500], timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Task management" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit task Confirm material delivery" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit task Send completed walkthrough" })).toBeVisible();

  const filters = page.getByRole("form", { name: "Task filters" });
  await filters.getByLabel("Status").selectOption("done");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("button", { name: "Edit task Send completed walkthrough" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit task Confirm material delivery" })).toHaveCount(0);
  expect(reads.at(-1)).toContain("status=done");

  await filters.getByRole("button", { name: "Clear" }).click();
  await filters.getByLabel("Project").selectOption("e2e-project-001");
  await filters.getByLabel("Assignee email").fill("office@example.test");
  await filters.getByLabel("Due on or before").fill("2026-07-31");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("button", { name: "Edit task Confirm material delivery" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit task Draft customer recap" })).toHaveCount(0);
  expect(reads.at(-1)).toContain("projectId=e2e-project-001");
  expect(reads.at(-1)).toContain("assigneeEmail=office%40example.test");
  expect(reads.at(-1)).toContain("dueBefore=2026-07-31");
  await filters.getByRole("button", { name: "Clear" }).click();

  await page.getByRole("button", { name: "New task" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create task" });
  await createDialog.getByLabel("Title").fill("Schedule installer confirmation");
  await createDialog.getByLabel("Details").fill("Confirm arrival window.");
  await createDialog.getByLabel("Due date").fill("2026-08-01");
  await createDialog.getByLabel("Project").selectOption("e2e-project-001");
  await createDialog.getByLabel("Lead ID").fill("lead-edit07");
  await createDialog.getByLabel("Assignee email").fill("ASSIGNEE@EXAMPLE.TEST");
  await createDialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("button", { name: "Edit task Schedule installer confirmation" })).toBeVisible();
  expect(posts).toEqual([{
    title: "Schedule installer confirmation",
    details: "Confirm arrival window.",
    status: "open",
    dueDate: "2026-08-01",
    projectId: "e2e-project-001",
    leadId: "lead-edit07",
    assigneeEmail: "assignee@example.test",
    source: "manual",
  }]);

  await page.getByRole("button", { name: "Edit task Schedule installer confirmation" }).click();
  const editCreated = page.getByRole("dialog", { name: "Edit task Schedule installer confirmation" });
  await editCreated.getByLabel("Details").fill("Confirm arrival and key handoff.");
  await editCreated.getByRole("button", { name: "Save changes" }).click();
  await taskCreatedPatchStart;
  for (const control of await editCreated.locator("input, select, textarea").all()) {
    await expect(control).toBeDisabled();
  }
  await expect(editCreated.getByRole("button", { name: "Saving…" })).toBeDisabled();
  releaseTaskCreatedPatch();
  await expect(editCreated).toHaveCount(0);
  expect(patches.at(-1)).toEqual({
    id: "task-created",
    body: {
      version: "1",
      details: "Confirm arrival and key handoff.",
    },
  });

  await filters.getByLabel("Status").selectOption("done");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("button", { name: "Edit task Send completed walkthrough" }).click();
  const doneDialog = page.getByRole("dialog", { name: "Edit task Send completed walkthrough" });
  await doneDialog.getByRole("button", { name: "Reopen task" }).click();
  await expect(page.getByRole("dialog", { name: /Edit task/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New task" })).toBeFocused();
  expect(patches.at(-1)).toEqual({
    id: "task-done",
    body: {
      version: "1",
      status: "open",
    },
  });
  await filters.getByRole("button", { name: "Clear" }).click();

  await filters.getByLabel("Project").selectOption("e2e-project-001");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("button", { name: "Edit task Draft customer recap" }).click();
  const conflictDialog = page.getByRole("dialog", { name: "Edit task Draft customer recap" });
  await conflictDialog.getByLabel("Title").fill("Send customer recap");
  await conflictDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(conflictDialog.getByText("Saved value: Saved by another user", { exact: true })).toBeVisible();
  await expect(conflictDialog.getByRole("button", { name: "Re-apply changes" })).toBeVisible();
  expect(overflowTasks).toHaveLength(201);
  expect(reads.at(-1)).toContain("projectId=e2e-project-001");
  await conflictDialog.getByRole("button", { name: "Re-apply changes" }).click();
  await expect(page.getByRole("button", { name: "Edit task Send customer recap" })).toBeVisible();
  expect(patches.slice(-2)).toEqual([{
    id: "task-conflict",
    body: {
      version: "1",
      title: "Send customer recap",
    },
  }, {
    id: "task-conflict",
    body: {
      version: "2",
      title: "Send customer recap",
    },
  }]);
});

test("a conflict outside every bounded list result never invents saved values or re-applies", async ({ page }) => {
  await mockEmptyToday(page);
  const savedTask = task({
    id: "task-filtered-conflict",
    title: "Review installation notes",
    projectId: "e2e-project-001",
  });
  const overflowTasks = Array.from({ length: 201 }, (_, index) => task({
    id: `task-unrelated-${index}`,
    title: `Unrelated task ${index}`,
    projectId: "other-project",
  }));
  let conflicted = false;
  let patchCount = 0;

  await page.route(/\/api\/v1\/tasks(?:\/[^?]+)?(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/tasks") {
      const projectId = url.searchParams.get("projectId");
      const status = url.searchParams.get("status");
      if (!conflicted) {
        await fulfillJson(route, 200, {
          tasks: !projectId || projectId === savedTask.projectId ? [savedTask] : [],
        });
        return;
      }
      const bounded = overflowTasks.slice(0, 200).filter((row) => (
        (!projectId || row.projectId === projectId)
        && (!status || row.status === status)
      ));
      await fulfillJson(route, 200, { tasks: bounded });
      return;
    }
    if (
      request.method() === "PATCH"
      && url.pathname === "/api/v1/tasks/task-filtered-conflict"
    ) {
      patchCount += 1;
      conflicted = true;
      savedTask.projectId = "other-project";
      savedTask.version = "2";
      await fulfillJson(route, 409, {
        error: "Task changed since it was loaded.",
        currentVersion: "2",
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/assistant");
  const tasksTab = page.getByRole("tab", { name: "Tasks", exact: true });
  await expect(async () => {
    await tasksTab.click();
    await expect(tasksTab).toHaveAttribute("aria-selected", "true", { timeout: 500 });
  }).toPass({ intervals: [100, 250, 500], timeout: 10_000 });

  const filters = page.getByRole("form", { name: "Task filters" });
  await filters.getByLabel("Project").selectOption("e2e-project-001");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("button", { name: "Edit task Review installation notes" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit task Review installation notes" });
  await dialog.getByLabel("Title").fill("Review revised installation notes");
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "its exact saved version could not be found in the bounded task results",
  );
  await expect(dialog.getByText(/^Saved value:/u)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Refresh list to continue" })).toBeDisabled();
  expect(overflowTasks).toHaveLength(201);
  expect(patchCount).toBe(1);
});
