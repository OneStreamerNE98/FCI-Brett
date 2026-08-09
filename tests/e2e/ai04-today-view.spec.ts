import { expect, test, type Page } from "@playwright/test";

type TodayTask = {
  id: string;
  title: string;
  dueDate: string;
  projectId: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
  updatedAt: number;
  href: string;
};

type TodayPayload = {
  generatedAt: number;
  day: string;
  displayTimezone: string;
  overdueTasks: { items: TodayTask[]; total: number };
  dueTodayTasks: { items: TodayTask[]; total: number };
  meetings: {
    items: Array<{
      id: string;
      projectId: string;
      title: string;
      meetingAt: number;
      projectNumber: string;
      projectName: string;
      href: string;
    }>;
    total: number;
  };
  leadFollowUps: {
    items: Array<{
      id: string;
      leadNumber: string;
      company: string;
      nextAction: string;
      nextActionAt: number;
      href: string;
    }>;
    total: number;
  };
  closeoutFollowUps: {
    items: Array<{
      id: string;
      projectNumber: string;
      name: string;
      installationCompletedAt: number;
      href: string;
    }>;
    total: number;
  };
  inbox: {
    label: "Needs review";
    detail: "Open the inbox review queue";
    href: "/inbox?bucket=needs-review";
  };
};

const generatedAt = Date.UTC(2026, 6, 25, 14);

function emptyToday(): TodayPayload {
  return {
    generatedAt,
    day: "2026-07-25",
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
  };
}

async function mockToday(page: Page, payload: TodayPayload) {
  await page.route("**/api/v1/assistant/today", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

test("Today is the default Assistant tab, Ask is second, Tasks is third, and saved rows deep-link honestly", async ({ page }) => {
  const payload = emptyToday();
  payload.overdueTasks = {
    items: [{
      id: "task-overdue",
      title: "Confirm flooring delivery",
      dueDate: "2026-07-24",
      projectId: "e2e-project-001",
      leadId: null,
      assigneeEmail: "e2e-office@example.test",
      updatedAt: generatedAt,
      href: "/projects",
    }],
    total: 1,
  };
  payload.meetings = {
    items: [{
      id: "meeting-ai04",
      projectId: "e2e-project-001",
      title: "Installation handoff",
      meetingAt: generatedAt,
      projectNumber: "CF-2026-E2E00001",
      projectName: "FCI TEST — DO NOT USE",
      href: "/projects",
    }],
    total: 1,
  };
  payload.leadFollowUps = {
    items: [{
      id: "lead-ai04",
      leadNumber: "LEAD-E2E-AI04",
      company: "FCI TEST — DO NOT USE",
      nextAction: "Call about site measurements",
      nextActionAt: generatedAt - 60_000,
      href: "/leads",
    }],
    total: 1,
  };
  payload.closeoutFollowUps = {
    items: [{
      id: "project-ai04",
      projectNumber: "CF-2026-E2E00002",
      name: "Closeout follow-up",
      installationCompletedAt: generatedAt - 86_400_000,
      href: "/projects?status=closeout",
    }],
    total: 1,
  };
  await mockToday(page, payload);

  await page.goto("/assistant");

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["Today", "Ask", "Tasks"]);
  await expect(page.getByRole("tab", { name: "Today", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Ask", exact: true })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tab", { name: "Tasks", exact: true })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tabpanel", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "4 saved items to review" })).toBeVisible();

  await expect(page.getByRole("link", { name: /Confirm flooring delivery/ })).toHaveAttribute("href", "/projects");
  await expect(page.getByRole("link", { name: /Installation handoff/ })).toHaveAttribute("href", "/projects");
  await expect(page.getByRole("link", { name: /LEAD-E2E-AI04/ })).toHaveAttribute("href", "/leads");
  await expect(page.getByRole("link", { name: /CF-2026-E2E00002/ })).toHaveAttribute("href", "/projects?status=closeout");
  const inboxLink = page.getByRole("link", { name: /Open the inbox review queue/ });
  await expect(inboxLink).toHaveAttribute("href", "/inbox?bucket=needs-review");
  await expect(inboxLink).toContainText("Review messages without guessing a count.");

  await page.getByRole("tab", { name: "Today", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Tasks", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Tasks", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Tasks" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Ask", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Ask", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Ask" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Today", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Today" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const documentWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(documentWidths.scroll).toBeLessThanOrEqual(documentWidths.client);
  const taskTarget = page.getByRole("checkbox", {
    name: "Complete task Confirm flooring delivery",
  }).locator("xpath=..");
  const targetBox = await taskTarget.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(targetBox?.width).toBeGreaterThanOrEqual(44);
  expect(targetBox?.height).toBeGreaterThanOrEqual(44);
});

test("Today distinguishes loading from a complete honest empty state", async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/v1/assistant/today", async (route) => {
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptyToday()),
    });
  });

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Loading today's saved records…" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today is unavailable" })).toHaveCount(0);

  releaseResponse();
  await expect(page.getByRole("heading", { name: "Nothing due in saved records" })).toBeVisible();
  for (const copy of [
    "No open tasks are overdue.",
    "No open tasks are due today.",
    "No project meetings are saved for today.",
    "No active lead follow-ups are past due.",
    "No completed installations are waiting for a recorded follow-up result.",
  ]) {
    await expect(page.getByText(copy, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Today is unavailable" })).toHaveCount(0);
});

test("Today exposes a distinct error with a working retry", async ({ page }) => {
  let unavailable = true;
  await page.route("**/api/v1/assistant/today", async (route) => {
    await route.fulfill({
      status: unavailable ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(unavailable
        ? { error: "Saved records are temporarily unavailable." }
        : emptyToday()),
    });
  });

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Today is unavailable" })).toBeVisible();
  await expect(page.getByText("Saved records are temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loading today's saved records…" })).toHaveCount(0);

  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nothing due in saved records" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today is unavailable" })).toHaveCount(0);
});

test("task completion sends the exact PATCH, reloads on success, and preserves a failed row", async ({ page }) => {
  let completed = false;
  let todayReads = 0;
  const patchCalls: Array<{ url: string; method: string; body: unknown }> = [];
  await page.route("**/api/v1/assistant/today", async (route) => {
    todayReads += 1;
    const payload = emptyToday();
    payload.overdueTasks = {
      items: [{
        id: "task-complete",
        title: "Complete this saved task",
        dueDate: "2026-07-24",
        projectId: "e2e-project-001",
        leadId: null,
        assigneeEmail: null,
        updatedAt: generatedAt,
        href: "/projects",
      }, {
        id: "task-fail",
        title: "Keep this failed task",
        dueDate: "2026-07-24",
        projectId: "e2e-project-001",
        leadId: null,
        assigneeEmail: null,
        updatedAt: generatedAt,
        href: "/projects",
      }].filter((task) => !completed || task.id !== "task-complete"),
      total: completed ? 1 : 2,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
  await page.route("**/api/v1/tasks/*", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Task not found." }),
      });
      return;
    }
    patchCalls.push({
      url: new URL(request.url()).pathname,
      method: request.method(),
      body: request.postDataJSON(),
    });
    if (request.url().endsWith("/task-fail")) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "The task changed before it could be completed." }),
      });
      return;
    }
    completed = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ task: { id: "task-complete", status: "done" } }),
    });
  });

  await page.goto("/assistant");
  await page.getByRole("checkbox", { name: "Complete task Keep this failed task" }).click();
  await expect(page.getByText("The task changed before it could be completed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Complete task Keep this failed task" })).toBeVisible();
  expect(todayReads).toBe(1);

  await page.getByRole("checkbox", { name: "Complete task Complete this saved task" }).click();
  await expect(page.getByText("Complete this saved task completed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Complete task Complete this saved task" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Complete task Keep this failed task" })).toBeVisible();
  expect(todayReads).toBe(2);
  expect(patchCalls).toEqual([{
    url: "/api/v1/tasks/task-fail",
    method: "PATCH",
    body: { status: "done" },
  }, {
    url: "/api/v1/tasks/task-complete",
    method: "PATCH",
    body: { status: "done" },
  }]);
});

test("Today re-reads automatically at the user's next local midnight", async ({ page }) => {
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  let reads = 0;
  await page.route("**/api/v1/assistant/today", async (route) => {
    reads += 1;
    if (reads === 1) await firstResponseGate;
    const payload = emptyToday();
    payload.day = reads === 1 ? "2026-07-24" : "2026-07-25";
    payload.generatedAt = reads === 1
      ? Date.parse("2026-07-25T03:59:00.000Z")
      : Date.parse("2026-07-25T04:00:01.000Z");
    if (reads === 1) {
      payload.dueTodayTasks = {
        items: [{
          id: "before-midnight",
          title: "Visible before midnight",
          dueDate: "2026-07-24",
          projectId: null,
          leadId: null,
          assigneeEmail: null,
          updatedAt: generatedAt,
          href: "/assistant",
        }],
        total: 1,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Loading today's saved records…" })).toBeVisible();
  await expect.poll(() => reads).toBe(1);
  await page.clock.install({ time: new Date("2026-07-25T03:59:00.000Z") });
  releaseFirstResponse();
  await expect(page.getByRole("heading", { name: "1 saved item to review" })).toBeVisible();

  await page.clock.fastForward(61_000);
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("heading", { name: "Nothing due in saved records" })).toBeVisible();
});

test("a pre-midnight response delivered after midnight causes an immediate corrective read", async ({ page }) => {
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  let reads = 0;
  await page.route("**/api/v1/assistant/today", async (route) => {
    reads += 1;
    const payload = emptyToday();
    if (reads === 1) {
      await firstResponseGate;
      payload.generatedAt = Date.parse("2026-07-25T03:59:59.000Z");
      payload.day = "2026-07-24";
      payload.dueTodayTasks = {
        items: [{
          id: "stale-before-midnight",
          title: "Stale response from yesterday",
          dueDate: "2026-07-24",
          projectId: null,
          leadId: null,
          assigneeEmail: null,
          updatedAt: generatedAt,
          href: "/assistant",
        }],
        total: 1,
      };
    } else {
      payload.generatedAt = Date.parse("2026-07-25T04:00:00.000Z");
      payload.day = "2026-07-25";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Loading today's saved records…" })).toBeVisible();
  await expect.poll(() => reads).toBe(1);

  await page.clock.install({ time: new Date("2026-07-25T03:59:59.000Z") });
  await page.clock.fastForward(2_000);
  releaseFirstResponse();
  await expect(page.getByRole("heading", { name: "1 saved item to review" })).toBeVisible();

  await page.clock.runFor(1);
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByRole("heading", { name: "Nothing due in saved records" })).toBeVisible();
  await expect(page.getByText("Stale response from yesterday", { exact: true })).toHaveCount(0);
});
