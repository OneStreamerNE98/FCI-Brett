import { expect, test, type Page, type Route } from "@playwright/test";

const project = {
  id: "ai11-project-westport",
  project_number: "CF-2026-111",
  client_id: "ai11-client-atlas",
  client_name: "FCI TEST — Atlas Health",
  name: "Westport warranty renovation",
  status: "mobilizing",
  site: "100 Test Lane, Cherry Hill, NJ",
  project_manager_id: "e2e-admin@example.test",
  estimated_value: 125_000,
  segment: "commercial",
  drive_folder_id: "ai11-drive-project",
  drive_url: "https://drive.google.test/ai11-project-westport",
  created_at: Date.UTC(2026, 6, 30, 12),
  updated_at: Date.UTC(2026, 6, 30, 12),
};

const reviewRow = {
  id: "mail-item-ai11-multi-intent",
  subject: "FCI TEST schedule warranty and project update",
  sender: "Taylor Example <taylor@example.test>",
  receivedAt: Date.parse("2026-07-30T13:00:00.000Z"),
  analysis: {
    gmailMessageId: "gmail-ai11-multi-intent",
    intents: ["lead", "project-update", "schedule", "warranty"],
    projectId: project.id,
    confidence: "high",
    rationale: "The stored analysis identified all four review actions.",
  },
  leadProposal: {
    company: "FCI TEST — DO NOT USE — AI-11 Lead",
    contactName: "Taylor Example",
    contactEmail: "taylor@example.test",
    contactPhone: "555-0111",
    projectName: "Westport warranty renovation",
    site: null,
    estimatedValue: null,
  },
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockInboxFoundation(page: Page) {
  await page.route("**/api/v1/settings/me", (route) => fulfillJson(route, {
    isAdmin: true,
    preferences: {
      displayTimezone: "America/New_York",
      replySignature: "",
      notificationPreferences: {},
      pageLayouts: {
        overview: { order: [], hidden: [] },
        reports: { order: [], hidden: [] },
      },
    },
  }));
  await page.route("**/api/v1/assistant/config", (route) => fulfillJson(route, {
    provider: "openai",
    keyState: "Configured",
    model: "gpt-ai11-e2e",
    features: {
      orgQa: true,
      triage: false,
      inboxAnalysis: true,
      replyDrafts: false,
      taskExtraction: false,
    },
  }));
  await page.route("**/api/v1/google-workspace", (route) => fulfillJson(route, {
    workspace: {
      connectionStatus: "connected",
      connectionAccount: "workspace-simulation@fci.example",
      gmailConnected: true,
      gmailEnabled: true,
      runtimeMode: "simulation",
      simulation: true,
    },
  }));
  await page.route("**/api/v1/leads", (route) => fulfillJson(route, { leads: [] }));
  await page.route("**/api/v1/clients", (route) => fulfillJson(route, {
    clients: [{
      id: project.client_id,
      client_code: "AI11-ATLAS",
      name: project.client_name,
      status: "active",
      industry: "Healthcare",
      primary_contact_name: "FCI TEST Contact",
      primary_contact_email: "contact@example.test",
    }],
  }));
  await page.route("**/api/v1/projects", (route) => fulfillJson(route, {
    projects: [project],
  }));
  await page.route("**/api/v1/dashboard", (route) => fulfillJson(route, {
    generatedAt: Date.UTC(2026, 6, 30, 12),
    metrics: {
      activeLeads: 0,
      estimatedPipelineValue: 0,
      activeProjects: 1,
      clientCount: 1,
      meetingCount: 0,
      filedEmailCount: 0,
    },
    projectsByStatus: [{ status: "mobilizing", count: 1 }],
    recentActivity: [],
    todayMeetings: { items: [], total: 0 },
    readiness: {
      scheduleDataAvailable: false,
      scheduleReason: "Scheduling is not available.",
      reportsUseLiveProjectLeadTotals: true,
    },
  }));
  await page.route("**/api/v1/filing-rules", (route) => fulfillJson(route, {
    rules: [],
  }));
  await page.route("**/api/v1/integrations/google/sheets/status", (route) =>
    fulfillJson(route, { mirror: null }));
}

async function mockReviewQueue(
  page: Page,
  currentRows: () => unknown[],
  patches: unknown[],
) {
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      await fulfillJson(route, {
        terminationReason: "caught-up",
        message: "You're caught up",
      });
      return;
    }
    if (method === "PATCH") {
      patches.push(route.request().postDataJSON());
      await fulfillJson(route, { error: "unexpected_review_patch" }, 500);
      return;
    }
    const rows = currentRows();
    await fulfillJson(route, { rows, totalCount: rows.length });
  });
}

test("one multi-intent row exposes every typed action and project-update reuses filing review", async ({ page }) => {
  await mockInboxFoundation(page);
  const patches: unknown[] = [];
  let previewCalls = 0;
  let filingCalls = 0;
  await mockReviewQueue(page, () => [reviewRow], patches);
  await page.route(
    `**/api/v1/integrations/google/gmail/messages/${reviewRow.analysis.gmailMessageId}/file*`,
    async (route) => {
      if (route.request().method() === "GET") previewCalls += 1;
      else filingCalls += 1;
      await fulfillJson(route, { error: "not_expected_before_human_review" }, 500);
    },
  );

  await page.goto("/inbox?bucket=needs-review");
  const row = page.locator(".live-message-row").filter({
    hasText: reviewRow.subject,
  });
  await expect(row.getByRole("button", {
    name: `Create lead: ${reviewRow.subject}`,
  })).toBeVisible();
  await expect(row.getByRole("button", {
    name: `Review project update: ${reviewRow.subject}`,
  })).toBeVisible();
  await expect(row.getByRole("button", {
    name: `Create schedule task: ${reviewRow.subject}`,
  })).toBeVisible();
  await expect(row.getByRole("button", {
    name: `Create warranty callback task: ${reviewRow.subject}`,
  })).toBeVisible();
  await expect(row.getByText(
    "Suggested actions: Lead · Project update · Schedule · Warranty callback",
    { exact: true },
  )).toBeVisible();

  await row.getByRole("button", {
    name: `Review project update: ${reviewRow.subject}`,
  }).click();
  const filingDialog = page.getByRole("dialog", {
    name: "File email to one project",
  });
  await expect(filingDialog).toBeVisible();
  await expect(filingDialog.getByRole("combobox", {
    name: "Exact independent project",
  })).toHaveValue(project.id);
  expect(previewCalls).toBe(0);
  expect(filingCalls).toBe(0);
  expect(patches).toEqual([]);
});

test("schedule accept posts once to the task route and its atomic 201 retires the row", async ({ page }) => {
  await mockInboxFoundation(page);
  const patches: unknown[] = [];
  const taskPosts: unknown[] = [];
  let queueRows: unknown[] = [reviewRow];
  await mockReviewQueue(page, () => queueRows, patches);
  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON();
    taskPosts.push(body);
    queueRows = [];
    await fulfillJson(route, {
      task: { id: "task-ai11-schedule", ...body },
      inboxReview: {
        id: reviewRow.id,
        status: "accepted",
      },
    }, 201);
  });

  await page.goto("/inbox?bucket=needs-review");
  await page.getByRole("button", {
    name: `Create schedule task: ${reviewRow.subject}`,
  }).click();
  const modal = page.getByRole("dialog", { name: "Create schedule task" });
  await expect(modal.getByLabel("Task title")).toHaveValue(
    `Schedule follow-up: ${reviewRow.subject}`,
  );
  await expect(modal.getByLabel("Task details")).toHaveValue(
    /Follow up with Taylor Example <taylor@example\.test> about this schedule request\./u,
  );
  await expect(modal.getByText(
    "Nothing is created until you submit this form.",
    { exact: false },
  )).toBeVisible();
  await modal.getByRole("button", { name: "Create schedule task" }).click();

  await expect(modal).toHaveCount(0);
  await expect(page.getByText(reviewRow.subject, { exact: true })).toHaveCount(0);
  await expect(page.getByText("No messages need review", { exact: true })).toBeVisible();
  expect(taskPosts).toEqual([{
    title: `Schedule follow-up: ${reviewRow.subject}`,
    details: "Follow up with Taylor Example <taylor@example.test> about this schedule request. The stored analysis identified all four review actions.",
    status: "open",
    dueDate: null,
    projectId: project.id,
    source: "email",
    sourceRef: reviewRow.analysis.gmailMessageId,
    inboxReviewId: reviewRow.id,
    inboxReviewIntent: "schedule",
  }]);
  expect(patches).toEqual([]);
});

test("a failed warranty accept keeps both the proposal and review row visible without a review PATCH", async ({ page }) => {
  await mockInboxFoundation(page);
  const patches: unknown[] = [];
  const taskPosts: unknown[] = [];
  await mockReviewQueue(page, () => [reviewRow], patches);
  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    taskPosts.push(route.request().postDataJSON());
    await fulfillJson(route, {
      error: "task_store_unavailable",
    }, 503);
  });

  await page.goto("/inbox?bucket=needs-review");
  await page.getByRole("button", {
    name: `Create warranty callback task: ${reviewRow.subject}`,
  }).click();
  const modal = page.getByRole("dialog", {
    name: "Create warranty callback task",
  });
  await expect(modal.getByLabel("Task title")).toHaveValue(
    `Warranty callback: ${reviewRow.subject}`,
  );
  await expect(modal.getByLabel("Task details")).toHaveValue(
    /Call back Taylor Example <taylor@example\.test> about this warranty or service request\./u,
  );
  await modal.getByRole("button", {
    name: "Create warranty callback task",
  }).click();

  await expect(modal).toBeVisible();
  await expect(modal.getByRole("alert")).toHaveText("task_store_unavailable");
  await expect(page.getByText(reviewRow.subject, { exact: true })).toBeVisible();
  expect(taskPosts).toEqual([{
    title: `Warranty callback: ${reviewRow.subject}`,
    details: "Call back Taylor Example <taylor@example.test> about this warranty or service request. The stored analysis identified all four review actions.",
    status: "open",
    dueDate: null,
    projectId: project.id,
    source: "email",
    sourceRef: reviewRow.analysis.gmailMessageId,
    inboxReviewId: reviewRow.id,
    inboxReviewIntent: "warranty",
  }]);
  expect(patches).toEqual([]);
});
