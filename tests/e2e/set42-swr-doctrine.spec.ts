import { expect, test, type Page, type Route } from "@playwright/test";

const initialClient = {
  id: "set42-client-001",
  client_code: "SET42",
  name: "FCI TEST — SET-42 original client",
  status: "active",
  industry: "Commercial",
  primary_contact_name: "Freshness Test Contact",
  primary_contact_email: "set42@example.test",
};

const inboxMessage = {
  id: "set42-message-001",
  threadId: "set42-thread-001",
  from: "sender@example.test",
  to: "workspace-simulation@fci.example",
  subject: "FCI TEST — SET-42 action-gated Gmail read",
  date: "2026-08-04T13:00:00.000Z",
  snippet: "This message must not load until the user asks for it.",
  labelIds: ["INBOX"],
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function dashboard(clientCount = 1) {
  return {
    generatedAt: Date.UTC(2026, 7, 4, 13),
    metrics: {
      activeLeads: 0,
      estimatedPipelineValue: 0,
      activeProjects: 0,
      clientCount,
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
  };
}

async function mockShell(
  page: Page,
  readClients: (route: Route) => Promise<void>,
) {
  await page.route("**/api/v1/settings/me", (route) => fulfillJson(route, {
    isAdmin: true,
    preferences: {
      displayTimezone: "America/New_York",
      replySignature: "",
      notificationPreferences: {},
      pageLayouts: {
        overview: { order: [], hidden: [], fullWidth: [] },
        reports: { order: [], hidden: [], fullWidth: [] },
      },
    },
  }));
  await page.route("**/api/v1/leads", (route) => fulfillJson(route, { leads: [] }));
  await page.route("**/api/v1/clients", readClients);
  await page.route("**/api/v1/projects", (route) => fulfillJson(route, { projects: [] }));
  await page.route("**/api/v1/dashboard", (route) => fulfillJson(route, dashboard()));
  await page.route("**/api/v1/filing-rules", (route) => fulfillJson(route, { rules: [] }));
  await page.route("**/api/v1/integrations/google/sheets/status", (route) =>
    fulfillJson(route, { mirror: null }));
}

function mainNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}

async function mockConnectedMailbox(page: Page) {
  await page.route("**/api/v1/integrations/google/connection", (route) => fulfillJson(route, {
    runtimeMode: "simulation",
    simulation: true,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      status: "connected",
      account: "Local Workspace simulation",
      grantedServices: null,
      requiresReauthorization: false,
    },
    mailboxes: [{
      email: "workspace-simulation@fci.example",
      status: "connected",
      connected: true,
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: null,
      requiresReauthorization: false,
      gmailReady: true,
    }],
  }));
}

test("focus and navigation reveal changed server data without a refresh and share one in-flight GET", async ({ page }) => {
  let client = { ...initialClient };
  let clientReads = 0;
  let blockNextRead = false;
  let releaseBlockedRead: (() => void) | null = null;

  await mockShell(page, async (route) => {
    clientReads += 1;
    if (blockNextRead) {
      blockNextRead = false;
      await new Promise<void>((resolve) => {
        releaseBlockedRead = resolve;
      });
    }
    await fulfillJson(route, { clients: [client] });
  });

  await page.goto("/clients");
  await expect(page.getByText(initialClient.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);
  expect(clientReads).toBe(1);

  client = { ...client, name: "FCI TEST — SET-42 refreshed on focus" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText(client.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);
  expect(clientReads).toBe(2);

  client = { ...client, name: "FCI TEST — SET-42 shared focus and navigation" };
  blockNextRead = true;
  const readsBeforeConcurrentTriggers = clientReads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => clientReads).toBe(readsBeforeConcurrentTriggers + 1);

  await mainNavigation(page).getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/u);
  await page.waitForTimeout(100);
  expect(clientReads).toBe(
    readsBeforeConcurrentTriggers + 1,
    "the navigation trigger must join the focus-triggered client request",
  );

  expect(releaseBlockedRead).not.toBeNull();
  releaseBlockedRead?.();
  await mainNavigation(page).getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page.getByText(client.name, { exact: true })).toBeVisible();
});

test("Gmail message reads remain action-gated across focus and navigation", async ({ page }) => {
  let gmailMessageReads = 0;

  await mockShell(page, (route) => fulfillJson(route, { clients: [initialClient] }));
  await mockConnectedMailbox(page);
  await page.route("**/api/v1/assistant/config", (route) => fulfillJson(route, {
    provider: "openai",
    keyState: "Configured",
    model: "gpt-set42-e2e",
    features: {
      orgQa: false,
      triage: false,
      inboxAnalysis: false,
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
  await page.route("**/api/v1/integrations/google/gmail/messages?*", async (route) => {
    gmailMessageReads += 1;
    await fulfillJson(route, {
      bucket: "inbox",
      messages: [inboxMessage],
      labelReady: true,
      limit: 20,
    });
  });

  await page.goto("/inbox");
  const loadMessages = page.getByRole("button", { name: "Load messages", exact: true });
  await expect(loadMessages).toBeEnabled();
  expect(gmailMessageReads).toBe(0);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await mainNavigation(page).getByRole("link", { name: "Clients", exact: true }).click();
  await mainNavigation(page).getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(loadMessages).toBeEnabled();
  expect(gmailMessageReads).toBe(0);

  await loadMessages.click();
  await expect(page.getByText(inboxMessage.subject, { exact: true })).toBeVisible();
  expect(gmailMessageReads).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await mainNavigation(page).getByRole("link", { name: "Clients", exact: true }).click();
  await mainNavigation(page).getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: "Load messages", exact: true })).toBeEnabled();
  expect(gmailMessageReads).toBe(1);
});

test("the Google Workspace panel never auto-revalidates a Gmail read on focus, visibility, or navigation", async ({ page }) => {
  // The Settings → Google Workspace panel is the surface that owns the Gmail
  // subscription, so the counter has to be asserted here and not only on
  // /inbox. Enrolling a /gmail/messages URL in useCachedGetSubscription makes
  // revalidateSubscribedCachedGets() force-GET it once per focus, visibility
  // change, and navigation — regardless of what the panel's own logic decides —
  // and that route resolves a Workspace Gmail client and a live label lookup
  // before it reads its `verification` parameter.
  let gmailMailboxReads = 0;
  let gmailVerificationReads = 0;
  let workspaceReadinessReads = 0;

  await mockShell(page, (route) => fulfillJson(route, { clients: [initialClient] }));
  await mockConnectedMailbox(page);
  await page.route("**/api/v1/google-workspace", async (route) => {
    workspaceReadinessReads += 1;
    if (workspaceReadinessReads === 1) {
      await fulfillJson(route, { error: "FCI TEST — retry readiness after mailbox selection" }, 503);
      return;
    }
    await fulfillJson(route, {
      credentialsPresent: true,
      missing: [],
      missingDetails: [],
      workspace: {
        connectionStatus: "connected",
        connectionAccount: "workspace-simulation@fci.example",
        gmailConnected: true,
        gmailEnabled: true,
        calendarConnected: true,
        calendarEnabled: true,
        runtimeMode: "simulation",
        simulation: true,
      },
    });
  });
  await page.route("**/api/v1/integrations/google/gmail/messages?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("verification") === "status") {
      gmailVerificationReads += 1;
      await fulfillJson(route, { bucket: "needs-review", messages: [], labelReady: true, testEmailPassed: true, limit: 20 });
      return;
    }
    gmailMailboxReads += 1;
    await fulfillJson(route, { bucket: "inbox", messages: [inboxMessage], labelReady: true, limit: 20 });
  });

  await page.goto("/settings?section=google-workspace");
  await expect(page.getByRole("heading", { level: 2, name: "Google Workspace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry status check", exact: true }).click();
  await expect.poll(() => gmailVerificationReads).toBe(1);
  expect(gmailMailboxReads).toBe(0);

  // Fire all three lifecycle triggers back to back. The stage-4 verification
  // read stays on cachedGetJson, so none of them may reach the network.
  const readsBeforeTriggers = gmailVerificationReads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.locator(".settings-nav").getByRole("button", { name: "Calendar & appointments", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Calendar & appointments", exact: true })).toBeVisible();
  await page.locator(".settings-nav").getByRole("button", { name: "Google Workspace", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Google Workspace", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(gmailVerificationReads).toBe(readsBeforeTriggers);
  expect(gmailMailboxReads).toBe(0);
});
