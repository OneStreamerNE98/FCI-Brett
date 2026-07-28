import { expect, test, type Page, type Route } from "@playwright/test";

const message = {
  id: "ai10-message",
  threadId: "ai10-thread",
  from: "client@example.test",
  to: "workspace-simulation@fci.example",
  subject: "FCI TEST inbox analysis",
  date: "2026-07-28T13:00:00.000Z",
  snippet: "A safe Inbox analysis fixture.",
  labelIds: ["INBOX"],
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockInbox(
  page: Page,
  inboxAnalysis: boolean,
  options: {
    isAdmin?: boolean;
    keyState?: "Configured" | "Missing";
  } = {},
) {
  await page.route("**/api/v1/settings/me", (route) => fulfillJson(route, {
    isAdmin: options.isAdmin ?? true,
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
    keyState: options.keyState ?? "Configured",
    model: "gpt-ai10-e2e",
    features: {
      orgQa: true,
      triage: false,
      inboxAnalysis,
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
  await page.route("**/api/v1/clients", (route) => fulfillJson(route, { clients: [] }));
  await page.route("**/api/v1/projects", (route) => fulfillJson(route, { projects: [] }));
  await page.route("**/api/v1/dashboard", (route) => fulfillJson(route, {
    generatedAt: Date.UTC(2026, 6, 28, 12),
    metrics: {
      activeLeads: 0,
      estimatedPipelineValue: 0,
      activeProjects: 0,
      clientCount: 0,
      meetingCount: 0,
      filedEmailCount: 0,
    },
    projectsByStatus: [],
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

test("inboxAnalysis off makes an Inbox open and load issue zero sweep requests", async ({ page }) => {
  await mockInbox(page, false);
  let analysisRequests = 0;
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    analysisRequests += 1;
    await fulfillJson(route, {
      terminationReason: "caught-up",
      message: "You're caught up",
    });
  });

  await page.goto("/inbox");
  const load = page.getByRole("button", { name: "Load messages", exact: true });
  await expect(load).toBeEnabled();
  await load.click();
  await expect(page.getByText(message.subject, { exact: true })).toBeVisible();
  expect(analysisRequests).toBe(0);
  await expect(page.getByText("You're caught up", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check older" })).toHaveCount(0);
});

test("Inbox open reports honest bounded coverage and Check older carries only the continuation token", async ({ page }) => {
  await mockInbox(page, true);
  const requestBodies: unknown[] = [];
  let releaseSecondResponse: (() => void) | null = null;
  const secondResponse = new Promise<void>((resolve) => {
    releaseSecondResponse = resolve;
  });
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    requestBodies.push(route.request().postDataJSON());
    if (requestBodies.length === 1) {
      await fulfillJson(route, {
        terminationReason: "older-pending",
        message: "Older messages not yet analyzed",
        nextPageToken: "ai10-next-page",
      });
      return;
    }
    await secondResponse;
    await fulfillJson(route, {
      terminationReason: "caught-up",
      message: "You're caught up",
    });
  });

  await page.goto("/inbox");
  await expect(page.getByText(
    "Older messages not yet analyzed",
    { exact: true },
  )).toBeVisible();
  expect(requestBodies).toEqual([{}]);

  const checkOlder = page.getByRole("button", { name: "Check older" });
  await checkOlder.focus();
  await checkOlder.press("Enter");
  const checkingOlder = page.getByRole("button", { name: "Checking older…" });
  await expect(checkingOlder).toBeFocused();
  await expect(checkingOlder).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Checking inbox analysis…", { exact: true })).toBeVisible();
  releaseSecondResponse?.();
  await expect(page.getByText("You're caught up", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Older messages not yet analyzed",
    { exact: true },
  )).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check older" })).toHaveCount(0);
  expect(requestBodies).toEqual([
    {},
    { pageToken: "ai10-next-page" },
  ]);
});

test("tokenless older-pending remains actionable and restarts one bounded scan", async ({ page }) => {
  await mockInbox(page, true);
  const requestBodies: unknown[] = [];
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    requestBodies.push(route.request().postDataJSON());
    if (requestBodies.length === 1) {
      await fulfillJson(route, {
        terminationReason: "older-pending",
        message: "Older messages not yet analyzed",
      });
      return;
    }
    await fulfillJson(route, {
      terminationReason: "caught-up",
      message: "You're caught up",
    });
  });

  await page.goto("/inbox");
  await expect(page.getByText(
    "Older messages not yet analyzed",
    { exact: true },
  )).toBeVisible();
  await page.getByRole("button", { name: "Check older" }).click();
  await expect(page.getByText("You're caught up", { exact: true })).toBeVisible();
  expect(requestBodies).toEqual([{}, {}]);
});

for (const denied of [
  { label: "non-admin", options: { isAdmin: false } },
  { label: "missing-key", options: { keyState: "Missing" as const } },
]) {
  test(`${denied.label} Inbox rendering makes zero analysis requests`, async ({ page }) => {
    await mockInbox(page, true, denied.options);
    let analysisRequests = 0;
    await page.route("**/api/v1/inbox-analysis", async (route) => {
      analysisRequests += 1;
      await fulfillJson(route, {
        terminationReason: "caught-up",
        message: "You're caught up",
      });
    });

    await page.goto("/inbox");
    await page.getByRole("button", { name: "Load messages", exact: true }).click();
    await expect(page.getByText(message.subject, { exact: true })).toBeVisible();
    expect(analysisRequests).toBe(0);
    await expect(page.getByText("Checking inbox analysis…", { exact: true })).toHaveCount(0);
    await expect(page.getByText("You're caught up", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Older messages not yet analyzed", { exact: true })).toHaveCount(0);
  });
}

test("a failed refresh clears an earlier caught-up result instead of leaving stale success copy", async ({ page }) => {
  await mockInbox(page, true);
  let analysisRequests = 0;
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    analysisRequests += 1;
    if (analysisRequests === 1) {
      await fulfillJson(route, {
        terminationReason: "caught-up",
        message: "You're caught up",
      });
      return;
    }
    await fulfillJson(route, { error: "provider_degraded" }, 503);
  });

  await page.goto("/inbox");
  await expect(page.getByText("You're caught up", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  await expect(page.getByText(
    "Inbox analysis could not finish. Refresh to retry.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("You're caught up", { exact: true })).toHaveCount(0);
  expect(analysisRequests).toBe(2);
});
