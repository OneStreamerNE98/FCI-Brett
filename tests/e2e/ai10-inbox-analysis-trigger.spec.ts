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

test("Needs review renders the stored queue, continues bounded coverage, and dismisses without a Gmail label read", async ({ page }) => {
  await mockInbox(page, true);
  const calls: Array<{ method: string; body: unknown }> = [];
  const gmailQueueReads: string[] = [];
  let queueRows = [{
    id: "mail-item-ai10-review",
    subject: "FCI TEST stored queue subject",
    sender: "Stored Sender <stored@example.test>",
    receivedAt: Date.parse("2026-07-28T13:00:00.000Z"),
  }];
  let postCalls = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/integrations/google/gmail/messages")
      && request.url().includes("label=needs-review")
      && !request.url().includes("verification=status")
    ) {
      gmailQueueReads.push(request.url());
    }
  });
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    const method = route.request().method();
    const body = method === "GET"
      ? null
      : route.request().postDataJSON();
    calls.push({ method, body });
    if (method === "GET") {
      await fulfillJson(route, {
        rows: queueRows,
        totalCount: queueRows.length,
      });
      return;
    }
    if (method === "PATCH") {
      const update = body as { id?: string };
      queueRows = queueRows.filter((row) => row.id !== update.id);
      await fulfillJson(route, {
        id: update.id,
        status: "dismissed",
      });
      return;
    }
    postCalls += 1;
    await fulfillJson(route, postCalls === 1
      ? {
          terminationReason: "older-pending",
          message: "Older messages not yet analyzed",
          nextPageToken: "ai10-queue-next-page",
        }
      : {
          terminationReason: "caught-up",
          message: "You're caught up",
        });
  });

  await page.goto("/inbox?bucket=needs-review");
  await expect(page.getByText("FCI TEST stored queue subject", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Stored Sender <stored@example.test>",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("1 stored message needs review.", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Older messages not yet analyzed",
    { exact: true },
  )).toBeVisible();
  expect(calls.slice(0, 2).map(({ method }) => method)).toEqual(["POST", "GET"]);
  expect(gmailQueueReads).toEqual([]);

  await page.getByRole("button", { name: "Check older" }).click();
  await expect(page.getByText("You're caught up", { exact: true })).toBeVisible();
  expect(calls[2]).toEqual({
    method: "POST",
    body: { pageToken: "ai10-queue-next-page" },
  });
  expect(calls[3]?.method).toBe("GET");

  await page.getByRole("button", {
    name: "Mark reviewed: FCI TEST stored queue subject",
  }).click();
  await expect(page.getByText("FCI TEST stored queue subject", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No messages need review", { exact: true })).toBeVisible();
  await expect(page.getByText("0 stored messages need review.", { exact: true })).toBeVisible();
  expect(calls.at(-2)).toEqual({
    method: "PATCH",
    body: { id: "mail-item-ai10-review" },
  });
  expect(calls.at(-1)?.method).toBe("GET");
  expect(gmailQueueReads).toEqual([]);
});

test("Needs review stays indeterminate until its stored queue read settles", async ({ page }) => {
  await mockInbox(page, true);
  let releaseQueue: (() => void) | null = null;
  const queueReleased = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, {
        terminationReason: "caught-up",
        message: "You're caught up",
      });
      return;
    }
    await queueReleased;
    await fulfillJson(route, { rows: [], totalCount: 0 });
  });

  await page.goto("/inbox?bucket=needs-review");
  await expect(page.getByText("Checking the review queue…", { exact: true })).toBeVisible();
  await expect(page.getByText("No messages need review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0 stored messages need review.", { exact: true })).toHaveCount(0);
  releaseQueue?.();
  await expect(page.getByText("No messages need review", { exact: true })).toBeVisible();
  await expect(page.getByText("0 stored messages need review.", { exact: true })).toBeVisible();
});

test("Needs review read failures stay unavailable instead of fabricating an empty queue", async ({ page }) => {
  await mockInbox(page, true);
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, {
        terminationReason: "caught-up",
        message: "You're caught up",
      });
      return;
    }
    await fulfillJson(route, { error: "queue_unavailable" }, 503);
  });

  await page.goto("/inbox?bucket=needs-review");
  await expect(page.getByText("Review queue unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("The stored review queue is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("No messages need review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0 stored messages need review.", { exact: true })).toHaveCount(0);
});

test("connected non-admins cannot refresh the Administrator-only review queue", async ({ page }) => {
  await mockInbox(page, true, { isAdmin: false });
  let analysisRequests = 0;
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    analysisRequests += 1;
    await fulfillJson(route, { rows: [], totalCount: 0 });
  });

  await page.goto("/inbox?bucket=needs-review");
  await expect(page.getByText("Administrator review queue", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh queue", exact: true })).toHaveCount(0);
  expect(analysisRequests).toBe(0);
});

test("missing-key Needs review loads stored rows without claiming or starting a sweep", async ({ page }) => {
  await mockInbox(page, true, { keyState: "Missing" });
  const methods: string[] = [];
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    methods.push(route.request().method());
    await fulfillJson(route, {
      rows: [{
        id: "missing-key-stored-row",
        subject: "FCI TEST stored while AI is unavailable",
        sender: "stored@example.test",
        receivedAt: Date.parse("2026-07-28T13:00:00.000Z"),
      }],
      totalCount: 1,
    });
  });

  await page.goto("/inbox?bucket=needs-review");
  await expect(page.getByText(
    "FCI TEST stored while AI is unavailable",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText(
    "Loading stored review rows. A bounded sweep runs only when Gmail and AI analysis are available.",
    { exact: true },
  )).toHaveCount(0);
  await expect(page.getByText("Checking inbox analysis…", { exact: true })).toHaveCount(0);
  expect(methods).toEqual(["GET"]);
});

test("a stale queue read cannot replace a newer Gmail bucket load", async ({ page }) => {
  await mockInbox(page, true);
  let releaseQueue: (() => void) | null = null;
  const queueReleased = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await page.route("**/api/v1/inbox-analysis", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, {
        terminationReason: "caught-up",
        message: "You're caught up",
      });
      return;
    }
    await queueReleased;
    await fulfillJson(route, {
      rows: [{
        id: "stale-queue-row",
        subject: "FCI TEST stale queue row",
        sender: "stale@example.test",
        receivedAt: Date.parse("2026-07-28T13:00:00.000Z"),
      }],
      totalCount: 1,
    });
  });

  await page.goto("/inbox?bucket=needs-review");
  await expect(page.getByText("Checking the review queue…", { exact: true })).toBeVisible();
  await page.getByLabel("Mailbox").selectOption("inbox");
  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  await expect(page.getByText(message.subject, { exact: true })).toBeVisible();
  releaseQueue?.();
  await expect(page.getByText(message.subject, { exact: true })).toBeVisible();
  await expect(page.getByText("FCI TEST stale queue row", { exact: true })).toHaveCount(0);
});

test("a delayed Mark reviewed response cannot restore the queue after a mailbox switch", async ({ page }) => {
  await mockInbox(page, true);
  let releaseDismissal: (() => void) | null = null;
  const dismissalReleased = new Promise<void>((resolve) => {
    releaseDismissal = resolve;
  });
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
      await dismissalReleased;
      await fulfillJson(route, {
        id: "delayed-review-row",
        status: "dismissed",
      });
      return;
    }
    await fulfillJson(route, {
      rows: [{
        id: "delayed-review-row",
        subject: "FCI TEST delayed review row",
        sender: "delayed@example.test",
        receivedAt: Date.parse("2026-07-28T13:00:00.000Z"),
      }],
      totalCount: 1,
    });
  });

  await page.goto("/inbox?bucket=needs-review");
  await expect(page.getByText("FCI TEST delayed review row", { exact: true })).toBeVisible();
  await page.getByRole("button", {
    name: "Mark reviewed: FCI TEST delayed review row",
  }).click();
  await page.getByLabel("Mailbox").selectOption("inbox");
  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  await expect(page.getByText(message.subject, { exact: true })).toBeVisible();
  releaseDismissal?.();
  await expect(page.getByText(message.subject, { exact: true })).toBeVisible();
  await expect(page.getByText("FCI TEST delayed review row", { exact: true })).toHaveCount(0);
});
