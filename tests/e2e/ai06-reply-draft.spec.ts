import { expect, test, type Page, type Route } from "@playwright/test";

const project = {
  id: "ai06-project-westport",
  project_number: "CF-2026-041",
  client_id: "ai06-client-atlas",
  client_name: "FCI TEST — Atlas Health",
  name: "Westport Medical Center",
  status: "mobilizing",
  site: "100 Test Lane, Cherry Hill, NJ",
  project_manager_id: "e2e-admin@example.test",
  estimated_value: 125_000,
  segment: "commercial",
  drive_folder_id: "ai06-drive-project",
  drive_url: "https://drive.google.test/ai06-project-westport",
  created_at: Date.UTC(2026, 6, 25, 12),
  updated_at: Date.UTC(2026, 6, 25, 12),
};

const message = {
  id: "ai06-message-westport",
  threadId: "ai06-thread-westport",
  from: "Sarah Kim <sarah.kim@atlas.example>",
  to: "workspace-simulation@fci.example",
  subject: "CF-2026-041 phasing plan question",
  date: "2026-07-25T13:00:00.000Z",
  snippet: "Can you confirm the install date for the Westport project?",
  labelIds: ["INBOX"],
};

const draftText = "Hi [...],\n\nThanks for reaching out about CF-2026-041 — Westport Medical Center. The project is mobilizing. [...]\n\nJordan Vega, FCI Operations";

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
  assistant: { keyState: "Configured" | "Missing"; replyDrafts: boolean },
) {
  await page.route("**/api/v1/settings/me", (route) => fulfillJson(route, {
    isAdmin: true,
    preferences: settingsPreferences,
  }));
  await page.route("**/api/v1/assistant/config", (route) => fulfillJson(route, {
    provider: "openai",
    keyState: assistant.keyState,
    model: "gpt-ai06-e2e",
    features: {
      orgQa: true,
      triage: false,
      replyDrafts: assistant.replyDrafts,
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
      client_code: "AI06-ATLAS",
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
  await page.route("**/api/v1/filing-rules", (route) => fulfillJson(route, { rules: [] }));
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

async function openReplyModal(page: Page) {
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  await expect(page.locator(".live-message-row").filter({ hasText: message.subject })).toBeVisible();
  await page.getByRole("button", { name: "Draft reply" }).click();
  const dialog = page.getByRole("dialog", { name: "Save a Gmail reply draft" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Draft with AI fills the textarea, keeps the pinned no-send copy, and confirms before replacing", async ({ page }) => {
  await mockInboxFoundation(page, { keyState: "Configured", replyDrafts: true });
  const replyDraftBodies: unknown[] = [];
  await page.route("**/api/v1/assistant/reply-draft", async (route) => {
    replyDraftBodies.push(route.request().postDataJSON());
    await fulfillJson(route, { draft: draftText });
  });

  const dialog = await openReplyModal(page);
  const textarea = dialog.getByRole("textbox", { name: "Reply message" });
  await expect(textarea).toHaveValue("");
  await expect(dialog.getByText("Sending remains a separate, deliberate action.", { exact: false })).toBeVisible();

  const draftButton = dialog.getByRole("button", { name: "Draft with AI" });
  await expect(draftButton).toBeEnabled();
  await draftButton.click();

  await expect(textarea).toHaveValue(draftText);
  expect(replyDraftBodies).toEqual([{ messageId: message.id }]);
  // The draft carries [...] placeholders where saved records do not answer.
  await expect(textarea).toHaveValue(/\[\.\.\.\]/);

  // With existing text, a second Draft with AI must confirm before replacing.
  await draftButton.click();
  await expect(dialog.getByText("Replace your current reply text with an AI draft?", { exact: false })).toBeVisible();
  expect(replyDraftBodies.length).toBe(1);
  await dialog.getByRole("button", { name: "Keep my text" }).click();
  await expect(dialog.getByText("Replace your current reply text with an AI draft?", { exact: false })).toHaveCount(0);
  await expect(textarea).toHaveValue(draftText);

  await draftButton.click();
  await dialog.getByRole("button", { name: "Replace with AI draft" }).click();
  await expect.poll(() => replyDraftBodies.length).toBe(2);
  await expect(textarea).toHaveValue(draftText);

  // The existing human Save draft action remains the only Gmail write path.
  await expect(dialog.getByRole("button", { name: "Save draft" })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test("Draft with AI is honestly disabled when the key is Missing or the toggle is off", async ({ page }) => {
  const assistant = { keyState: "Missing" as "Configured" | "Missing", replyDrafts: false };
  await mockInboxFoundation(page, assistant);
  let replyDraftCalls = 0;
  await page.route("**/api/v1/assistant/reply-draft", async (route) => {
    replyDraftCalls += 1;
    await fulfillJson(route, { draft: draftText });
  });

  let dialog = await openReplyModal(page);
  await expect(dialog.getByRole("button", { name: "Draft with AI" })).toBeDisabled();
  await expect(dialog.getByText("AI reply drafting is unavailable until OPENAI_API_KEY is configured for the workspace.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Sending remains a separate, deliberate action.", { exact: false })).toBeVisible();

  assistant.keyState = "Configured";
  assistant.replyDrafts = false;
  await page.reload();
  dialog = await openReplyModal(page);
  await expect(dialog.getByRole("button", { name: "Draft with AI" })).toBeDisabled();
  await expect(dialog.getByText("AI reply drafting is turned off in AI settings.", { exact: true })).toBeVisible();

  expect(replyDraftCalls).toBe(0);
});
