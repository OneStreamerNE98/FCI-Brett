import { expect, test, type Page, type Route } from "@playwright/test";

const project = {
  id: "ai05-project-westport",
  project_number: "CF-2026-041",
  client_id: "ai05-client-atlas",
  client_name: "FCI TEST — Atlas Health",
  name: "Westport Medical Center",
  status: "mobilizing",
  site: "100 Test Lane, Cherry Hill, NJ",
  project_manager_id: "e2e-admin@example.test",
  estimated_value: 125_000,
  segment: "commercial",
  drive_folder_id: "ai05-drive-project",
  drive_url: "https://drive.google.test/ai05-project-westport",
  created_at: Date.UTC(2026, 6, 25, 12),
  updated_at: Date.UTC(2026, 6, 25, 12),
};

const message = {
  id: "ai05-message-westport",
  threadId: "ai05-thread-westport",
  from: "project-manager@example.test",
  to: "workspace-simulation@fci.example",
  subject: "CF-2026-041 revised phasing plan",
  date: "2026-07-25T13:00:00.000Z",
  snippet: "Updated phasing plan for Westport Medical Center.",
  labelIds: ["INBOX"],
};

const settingsPreferences = {
  displayTimezone: "America/New_York",
  replySignature: "",
  notificationPreferences: {
    "lead.created": false,
    "gmail.filing_review_needed": false,
    "calendar.schedule_changed": false,
    "project.warranty_follow_up_due": false,
    "task.assigned": false,
  },
  pageLayouts: {
    overview: { order: [], hidden: [] },
    reports: { order: [], hidden: [] },
  },
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockInboxFoundation(
  page: Page,
  identity: { isAdmin: boolean },
  assistant: { keyState: "Configured" | "Missing"; triage: boolean },
) {
  await page.route("**/api/v1/settings/me", (route) => fulfillJson(route, {
    isAdmin: identity.isAdmin,
    preferences: settingsPreferences,
  }));
  await page.route("**/api/v1/assistant/config", (route) => fulfillJson(route, {
    provider: "openai",
    keyState: assistant.keyState,
    model: "gpt-ai05-e2e",
    features: {
      orgQa: true,
      triage: assistant.triage,
      replyDrafts: false,
      taskExtraction: true,
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
      client_code: "AI05-ATLAS",
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
    generatedAt: Date.UTC(2026, 6, 25, 12),
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
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => fulfillJson(route, {
    mirror: null,
  }));
  await page.route(
    "**/api/v1/integrations/google/gmail/messages?*",
    (route) => fulfillJson(route, {
      bucket: "inbox",
      messages: [message],
      labelReady: true,
      limit: 20,
    }),
  );
}

test("simulation suggests one message and preserves the existing human filing review", async ({ page }) => {
  const identity = { isAdmin: true };
  const assistant = { keyState: "Configured" as const, triage: true };
  await mockInboxFoundation(page, identity, assistant);
  const triageBodies: unknown[] = [];
  let previewCalls = 0;
  let filingCalls = 0;

  await page.route("**/api/v1/assistant/triage", async (route) => {
    triageBodies.push(route.request().postDataJSON());
    await fulfillJson(route, {
      suggestions: [{
        messageId: message.id,
        projectId: project.id,
        confidence: "high",
        rationale: "The exact project number appears in the saved subject.",
      }],
    });
  });
  await page.route(
    `**/api/v1/integrations/google/gmail/messages/${message.id}/file*`,
    async (route) => {
      if (route.request().method() === "GET") {
        previewCalls += 1;
        await fulfillJson(route, {
          message: {
            ...message,
            attachmentCount: 0,
            attachments: [],
          },
          project: {
            id: project.id,
            number: project.project_number,
            name: project.name,
            client: project.client_name,
          },
          destinations: {
            emailArchive: "05_Correspondence / Email Archive",
            attachments: "05_Correspondence / Email Attachments",
          },
          existing: null,
          inboxRetained: true,
        });
        return;
      }
      filingCalls += 1;
      expect(route.request().postDataJSON()).toEqual({ projectId: project.id });
      await fulfillJson(route, {
        filed: true,
        alreadyFiled: false,
        archive: { attachmentCount: 0 },
      });
    },
  );

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  const messageRow = page.locator(".live-message-row").filter({
    hasText: message.subject,
  });
  await expect(messageRow).toBeVisible();
  await page.getByRole("button", { name: "Suggest with AI" }).click();

  expect(triageBodies).toEqual([{ messageIds: [message.id] }]);
  await expect(messageRow.locator(".inbox-project-suggestion")).toHaveCount(2);
  await expect(messageRow.getByText(/FCI\/Intake:/)).toBeVisible();
  const aiSuggestion = messageRow.locator(".inbox-project-suggestion").filter({
    hasText: "AI suggestion",
  });
  await expect(aiSuggestion).toContainText("high");
  await expect(aiSuggestion).toContainText(
    `${project.project_number} — ${project.name}`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  expect(await aiSuggestion.getByRole("button", {
    name: `Accept AI suggestion for ${message.subject}: ${project.project_number} — ${project.name}; high confidence; The exact project number appears in the saved subject.`,
  }).evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })).toBe(true);

  await aiSuggestion.getByRole("button", {
    name: `Accept AI suggestion for ${message.subject}: ${project.project_number} — ${project.name}; high confidence; The exact project number appears in the saved subject.`,
  }).click();
  const filingDialog = page.getByRole("dialog", {
    name: "File email to one project",
  });
  await expect(filingDialog).toBeVisible();
  await expect(
    filingDialog.getByRole("combobox", { name: "Exact independent project" }),
  ).toHaveValue(project.id);
  expect(previewCalls).toBe(0);
  expect(filingCalls).toBe(0);

  await filingDialog.getByRole("button", {
    name: "Review destination",
  }).click();
  await expect(filingDialog.getByText(
    "Nothing has been copied yet. Select Copy email to project to complete this one approved filing.",
  )).toBeVisible();
  expect(previewCalls).toBe(1);
  expect(filingCalls).toBe(0);

  await filingDialog.getByRole("button", {
    name: "Copy email + 0 attachments",
  }).click();
  await expect(filingDialog).toHaveCount(0);
  expect(filingCalls).toBe(1);
});

test("AI suggestion state clears across mailbox changes and the action stays honestly gated", async ({ page }) => {
  const identity = { isAdmin: true };
  const assistant: {
    keyState: "Configured" | "Missing";
    triage: boolean;
  } = { keyState: "Configured", triage: true };
  await mockInboxFoundation(page, identity, assistant);
  let delayNextSuggestion = false;
  let releaseDelayedSuggestion = () => undefined;
  let markDelayedSuggestionStarted = () => undefined;
  const delayedSuggestionGate = new Promise<void>((resolve) => {
    releaseDelayedSuggestion = resolve;
  });
  const delayedSuggestionStarted = new Promise<void>((resolve) => {
    markDelayedSuggestionStarted = resolve;
  });
  await page.route("**/api/v1/assistant/triage", async (route) => {
    if (delayNextSuggestion) {
      markDelayedSuggestionStarted();
      await delayedSuggestionGate;
    }
    await fulfillJson(route, {
      suggestions: [{
        messageId: message.id,
        projectId: project.id,
        confidence: "medium",
        rationale: "The saved subject names the project number.",
      }],
    });
  });

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  await page.getByRole("button", { name: "Suggest with AI" }).click();
  await expect(page.getByText("AI suggestion · medium", { exact: false })).toBeVisible();

  await page.getByRole("combobox", { name: "Mailbox" }).selectOption("intake");
  await page.getByRole("combobox", { name: "Mailbox" }).selectOption("inbox");
  await expect(page.getByText("AI suggestion · medium", { exact: false })).toHaveCount(0);

  delayNextSuggestion = true;
  await page.getByRole("button", { name: "Suggest with AI" }).click();
  await delayedSuggestionStarted;
  await page.getByRole("combobox", { name: "Mailbox" }).selectOption("intake");
  releaseDelayedSuggestion();
  await page.getByRole("combobox", { name: "Mailbox" }).selectOption("inbox");
  await expect(page.getByText("AI suggestion · medium", { exact: false })).toHaveCount(0);

  assistant.keyState = "Missing";
  await page.reload();
  await expect(page.getByRole("button", { name: "Suggest with AI" })).toHaveCount(0);
  await expect(page.getByText("AI suggestion", { exact: false })).toHaveCount(0);

  assistant.keyState = "Configured";
  assistant.triage = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "Suggest with AI" })).toHaveCount(0);

  assistant.triage = true;
  identity.isAdmin = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "Suggest with AI" })).toHaveCount(0);
});
