import { expect, test, type Page } from "@playwright/test";

async function mockMeetingList(page: Page) {
  await page.route("**/api/v1/projects/*/meetings", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        meetings: [{
          id: "meeting-e2e-ai07",
          projectId: "e2e-project-001",
          title: "FCI TEST — DO NOT USE task review",
          meetingAt: "2026-07-24T14:00:00.000Z",
        }],
      }),
    });
  });
}

async function mockAssistantConfig(
  page: Page,
  keyState: "Configured" | "Missing",
  taskExtraction: boolean,
) {
  await page.route("**/api/v1/assistant/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "openai",
        keyState,
        model: "gpt-ai07-e2e",
        features: {
          orgQa: keyState === "Configured",
          triage: false,
          replyDrafts: false,
          taskExtraction,
        },
      }),
    });
  });
}

test("meeting task proposals stay review-first until each explicit Accept", async ({ page }) => {
  const extractionRequests: Array<Record<string, unknown>> = [];
  const taskRequests: Array<Record<string, unknown>> = [];

  await mockMeetingList(page);
  await mockAssistantConfig(page, "Configured", true);

  await page.route("**/api/v1/assistant/extract-tasks", async (route) => {
    extractionRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "ai-assisted",
        cause: null,
        proposals: [{
          title: "Dismiss this candidate",
          details: null,
          suggestedDueDate: null,
          suggestedAssigneeEmail: null,
        }, {
          title: "Confirm material quantity",
          details: "Use the saved meeting decision.",
          suggestedDueDate: "2026-07-30",
          suggestedAssigneeEmail: "e2e-office@example.test",
        }],
      }),
    });
  });

  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON();
    taskRequests.push(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          id: "task-e2e-ai07",
          ...body,
        },
      }),
    });
  });

  await page.goto("/assistant");
  const review = page.getByRole("region", { name: "Review proposed tasks" });
  await expect(review.getByLabel("Saved meeting")).toContainText(
    "FCI TEST — DO NOT USE task review",
  );

  await review.getByRole("button", {
    name: "Review proposed tasks",
    exact: true,
  }).click();
  await expect(review.getByRole("list", {
    name: "Proposed meeting tasks",
  })).toBeVisible();
  expect(extractionRequests).toEqual([{
    projectId: "e2e-project-001",
    meetingId: "meeting-e2e-ai07",
  }]);
  expect(taskRequests).toEqual([]);

  await review.getByRole("button", {
    name: "Dismiss proposed task Dismiss this candidate",
  }).click();
  await expect(review.getByText("Dismiss this candidate", { exact: true })).toHaveCount(0);
  expect(taskRequests).toEqual([]);

  await review.getByRole("button", {
    name: "Accept proposed task Confirm material quantity",
  }).click();
  await expect(review.getByText("Task created", { exact: true })).toBeVisible();
  expect(taskRequests).toEqual([{
    title: "Confirm material quantity",
    details: "Use the saved meeting decision.",
    dueDate: "2026-07-30",
    projectId: "e2e-project-001",
    assigneeEmail: "e2e-office@example.test",
    source: "meeting",
    sourceRef: "meeting-e2e-ai07",
  }]);
});

test("configured-off task extraction is disabled with its cause before a request", async ({ page }) => {
  let extractionRequests = 0;
  await mockMeetingList(page);
  await mockAssistantConfig(page, "Configured", false);
  await page.route("**/api/v1/assistant/extract-tasks", async (route) => {
    extractionRequests += 1;
    await route.abort();
  });

  await page.goto("/assistant");
  const review = page.getByRole("region", { name: "Review proposed tasks" });
  await expect(review.getByText(
    "Task extraction is turned off in AI settings.",
    { exact: true },
  )).toBeVisible();
  await expect(review.getByRole("button", {
    name: "Review proposed tasks",
    exact: true,
  })).toBeDisabled();
  expect(extractionRequests).toBe(0);
});

test("a missing key keeps the deterministic records-only review action available", async ({ page }) => {
  await mockMeetingList(page);
  await mockAssistantConfig(page, "Missing", false);

  await page.goto("/assistant");
  const review = page.getByRole("region", { name: "Review proposed tasks" });
  await expect(review.getByRole("button", {
    name: "Review saved action items",
    exact: true,
  })).toBeEnabled();
  await expect(review.getByText(
    "OpenAI is not configured. Saved meeting action items remain available for review.",
    { exact: true },
  )).toBeVisible();
  await expect(review.getByRole("button", {
    name: "Review proposed tasks",
    exact: true,
  })).toHaveCount(0);
});
