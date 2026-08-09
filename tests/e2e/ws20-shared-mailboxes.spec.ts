import { expect, test, type Page, type Route } from "@playwright/test";

type MailboxEmail = "ops@fci.example" | "info@fci.example";

const mailboxEmails: MailboxEmail[] = ["ops@fci.example", "info@fci.example"];
const sharedMessageId = "ws20-shared-message-id";
const project = {
  id: "ws20-project",
  project_number: "CF-2026-WS20",
  client_id: "ws20-client",
  client_name: "FCI TEST — WS-20 Client",
  name: "Shared mailbox project",
  status: "planning",
  site: "20 Test Lane",
  project_manager_id: "admin@example.test",
  estimated_value: 20_000,
  segment: "commercial",
  drive_folder_id: "ws20-project-folder",
  drive_url: "https://drive.google.test/ws20-project",
  created_at: Date.UTC(2026, 7, 8, 12),
  updated_at: Date.UTC(2026, 7, 8, 12),
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function mailboxConnection(email: MailboxEmail) {
  return {
    email,
    status: "connected",
    connected: true,
    services: { drive: true, gmail: true, calendar: true, sheets: true },
    grantedServices: { drive: true, gmail: true, calendar: true, sheets: true },
    requiresReauthorization: false,
  };
}

function workspaceResources() {
  return {
    resources: [
      {
        key: "primary",
        resourceType: "drive.shared-drive",
        label: "Shared Drive",
        name: "FCI Operations",
        blueprintName: "FCI Operations",
        management: "owner",
        parentKey: null,
        externalId: "ws20-drive",
        source: "app",
        origin: "adopted",
        state: "Adopted",
        restrictions: {
          adminManagedRestrictions: true,
          copyRequiresWriterPermission: true,
          domainUsersOnly: true,
          driveMembersOnly: true,
          sharingFoldersRequiresOrganizerPermission: true,
        },
      },
    ],
    connectReady: true,
    simulation: false,
    identity: {
      connectionAccount: "ops@fci.example",
      intakeMailboxMatches: true,
      allowedDomains: ["fci.example"],
      mode: "workspace",
    },
  };
}

async function mockShell(page: Page) {
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
  await page.route("**/api/v1/settings/workspace", (route) => fulfillJson(route, {
    settings: { intakeMailbox: "ops@fci.example" },
    intakeMailboxOptions: mailboxEmails,
  }));
  await page.route("**/api/v1/assistant/config", (route) => fulfillJson(route, {
    provider: "openai",
    keyState: "Configured",
    model: "gpt-ws20-e2e",
    features: {
      orgQa: false,
      triage: false,
      inboxAnalysis: false,
      replyDrafts: false,
      taskExtraction: false,
    },
  }));
  await page.route("**/api/v1/google-workspace", (route) => fulfillJson(route, {
    credentialsPresent: true,
    missing: [],
    missingDetails: [],
    workspace: {
      runtimeMode: "workspace",
      simulation: false,
      storageName: "FCI Operations",
      storageConfigured: true,
      connectionStatus: "connected",
      connectionAccount: "ops@fci.example",
      driveConnected: true,
      gmailConnected: true,
      calendarConnected: true,
      sheetsConnected: true,
      requiresReauthorization: false,
      provisioningEnabled: true,
      gmailEnabled: true,
      calendarEnabled: true,
      sheetsEnabled: true,
      clientDirectorySheetConfigured: true,
      enabledServices: ["drive", "gmail", "calendar", "sheets"],
    },
  }));
  await page.route("**/api/v1/integrations/google/setup/resources", (route) =>
    fulfillJson(route, workspaceResources()));
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => fulfillJson(route, {
    mirror: {
      configured: true,
      enabled: true,
      connected: true,
      spreadsheetUrl: "https://docs.google.test/ws20",
      spreadsheetName: "Client Directory",
      clients: { status: "synced", lastSyncedAt: Date.UTC(2026, 7, 8, 12), lastError: null },
      projects: { status: "synced", lastSyncedAt: Date.UTC(2026, 7, 8, 12), lastError: null },
      lastSyncedAt: Date.UTC(2026, 7, 8, 12),
      reason: null,
      source: "app",
    },
  }));
  await page.route("**/api/v1/integrations/google/calendar/events?verification=status", (route) =>
    fulfillJson(route, { events: [], verificationPassed: true }));
  await page.route("**/api/v1/leads", (route) => fulfillJson(route, { leads: [] }));
  await page.route("**/api/v1/clients", (route) => fulfillJson(route, {
    clients: [{
      id: project.client_id,
      client_code: "WS20",
      name: project.client_name,
      status: "active",
      industry: "Commercial",
      primary_contact_name: "FCI TEST Contact",
      primary_contact_email: "contact@example.test",
    }],
  }));
  await page.route("**/api/v1/projects", (route) => fulfillJson(route, { projects: [project] }));
  await page.route("**/api/v1/dashboard", (route) => fulfillJson(route, {
    generatedAt: Date.UTC(2026, 7, 8, 12),
    metrics: {
      activeLeads: 0,
      estimatedPipelineValue: 0,
      activeProjects: 1,
      clientCount: 1,
      meetingCount: 0,
      filedEmailCount: 0,
    },
    projectsByStatus: [{ status: "planning", count: 1 }],
    recentActivity: [],
    todayMeetings: { items: [], total: 0 },
    readiness: {
      scheduleDataAvailable: false,
      scheduleReason: "Scheduling is unavailable.",
      reportsUseLiveProjectLeadTotals: true,
    },
  }));
  await page.route("**/api/v1/filing-rules", (route) => fulfillJson(route, { rules: [] }));
}

test("mailbox switching isolates messages, queue counts, filing identity, and disconnect", async ({ page }) => {
  test.slow();
  await mockShell(page);
  let attachedMailboxes = mailboxEmails.map(mailboxConnection);
  const disconnected: string[] = [];
  const filedMailboxes: string[] = [];
  const messageReads: string[] = [];
  const settingsInboxReads: string[] = [];
  let holdFirstOpsRead = true;
  let releaseFirstOpsRead: (() => void) | null = null;
  let settingsReadMode: "normal" | "fail-ops" | "hold-info" = "normal";
  let releaseSettingsInfoRead: (() => void) | null = null;

  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    if (route.request().method() === "DELETE") {
      const body = route.request().postDataJSON() as { mailbox?: unknown };
      expect(typeof body.mailbox).toBe("string");
      const mailbox = String(body.mailbox);
      disconnected.push(mailbox);
      attachedMailboxes = attachedMailboxes.filter((row) => row.email !== mailbox);
      await fulfillJson(route, {
        disconnected: true,
        mailbox,
        providerRevocation: "succeeded",
        revocationRequested: true,
      });
      return;
    }
    await fulfillJson(route, {
      runtimeMode: "workspace",
      simulation: false,
      enabledServices: ["drive", "gmail", "calendar", "sheets"],
      connection: {
        connected: attachedMailboxes.length > 0,
        status: attachedMailboxes.length > 0 ? "connected" : "not-connected",
        account: attachedMailboxes[0]?.email ?? null,
        services: { drive: true, gmail: true, calendar: true, sheets: true },
        grantedServices: { drive: true, gmail: true, calendar: true, sheets: true },
        requiresReauthorization: false,
      },
      mailboxes: attachedMailboxes,
    });
  });

  await page.route("**/api/v1/integrations/google/gmail/messages?*", async (route) => {
    const url = new URL(route.request().url());
    const mailbox = url.searchParams.get("mailbox") ?? "";
    messageReads.push(mailbox);
    if (url.searchParams.get("label") === "inbox" && settingsReadMode !== "normal") {
      settingsInboxReads.push(mailbox);
      if (settingsReadMode === "fail-ops" && mailbox === "ops@fci.example") {
        await fulfillJson(route, { error: "FCI TEST forced mailbox read failure" }, 503);
        return;
      }
      if (settingsReadMode === "hold-info" && mailbox === "info@fci.example") {
        await new Promise<void>((resolve) => {
          releaseSettingsInfoRead = resolve;
        });
      }
    }
    if (mailbox === "ops@fci.example" && holdFirstOpsRead) {
      holdFirstOpsRead = false;
      await new Promise<void>((resolve) => {
        releaseFirstOpsRead = resolve;
      });
    }
    const count = mailbox === "info@fci.example" ? 2 : 1;
    await fulfillJson(route, {
      bucket: "inbox",
      messages: Array.from({ length: count }, (_, index) => ({
        id: index === 0 ? sharedMessageId : `ws20-info-${index}`,
        threadId: `ws20-thread-${mailbox}-${index}`,
        from: `sender-${index}@example.test`,
        to: mailbox,
        subject: `${mailbox} message ${index + 1}`,
        date: "2026-08-08T12:00:00.000Z",
        snippet: `Loaded only for ${mailbox}`,
        labelIds: ["INBOX"],
      })),
      labelReady: true,
      limit: 20,
    });
  });

  await page.route("**/api/v1/inbox-analysis?*", async (route) => {
    const url = new URL(route.request().url());
    const mailbox = url.searchParams.get("mailbox") as MailboxEmail;
    const count = mailbox === "info@fci.example" ? 2 : 1;
    await fulfillJson(route, {
      labels: [],
      rows: Array.from({ length: count }, (_, index) => ({
        id: `${mailbox}-review-${index}`,
        subject: `${mailbox} review ${index + 1}`,
        sender: `review-${index}@example.test`,
        receivedAt: Date.UTC(2026, 7, 8, 12 + index),
        analysis: null,
        leadProposal: null,
      })),
      totalCount: count,
    });
  });

  await page.route(`**/api/v1/integrations/google/gmail/messages/${sharedMessageId}/file*`, async (route) => {
    const url = new URL(route.request().url());
    const mailbox = url.searchParams.get("mailbox") ?? "";
    if (route.request().method() === "POST") {
      filedMailboxes.push(mailbox);
      expect(route.request().postDataJSON()).toEqual({ projectId: project.id });
      await fulfillJson(route, { filed: true, alreadyFiled: false, archive: { attachmentCount: 0 } });
      return;
    }
    await fulfillJson(route, {
      message: {
        id: sharedMessageId,
        threadId: `thread-${mailbox}`,
        from: "sender@example.test",
        to: mailbox,
        subject: `${mailbox} message 1`,
        date: "2026-08-08T12:00:00.000Z",
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
  });

  await page.goto("/inbox");
  const mailboxPicker = page.getByRole("combobox", { name: "Connected mailbox", exact: true });
  await expect(mailboxPicker).toBeVisible({ timeout: 20_000 });
  await expect(mailboxPicker).toHaveValue("ops@fci.example");
  await expect(mailboxPicker.locator("option")).toHaveText(mailboxEmails);
  await expect(page.getByText(/gmail_[a-f0-9]+/iu)).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(messageReads).toEqual([]);

  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  await expect.poll(() => messageReads).toEqual(["ops@fci.example"]);
  await mailboxPicker.selectOption("info@fci.example");
  releaseFirstOpsRead?.();
  await expect(page.getByText("ops@fci.example message 1", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Load messages", exact: true }).click();
  await expect(page.getByText("info@fci.example message 1", { exact: true })).toBeVisible();
  await expect(page.getByText("info@fci.example message 2", { exact: true })).toBeVisible();
  await expect(page.locator(".inbox-summary")).toContainText("Showing 2 loaded messages from Inbox.");

  await page.getByRole("combobox", { name: "Mailbox", exact: true }).selectOption("needs-review");
  await expect(page.locator(".inbox-summary")).toContainText("2 stored messages need review.");
  await mailboxPicker.selectOption("ops@fci.example");
  await expect(page.locator(".inbox-summary")).toContainText("1 stored message needs review.");

  async function fileSharedMessage(mailbox: MailboxEmail) {
    await mailboxPicker.selectOption(mailbox);
    await page.getByRole("combobox", { name: "Mailbox", exact: true }).selectOption("inbox");
    await page.getByRole("button", { name: "Load messages", exact: true }).click();
    const row = page.locator(".live-message-row").filter({ hasText: `${mailbox} message 1` });
    await row.getByRole("button", { name: "Review & copy" }).click();
    await page.getByLabel("Exact independent project").selectOption(project.id);
    await page.getByRole("button", { name: "Review destination" }).click();
    await page.getByRole("button", { name: "Copy email + 0 attachments" }).click();
  }

  await fileSharedMessage("ops@fci.example");
  await fileSharedMessage("info@fci.example");
  expect(filedMailboxes).toEqual(mailboxEmails);

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  await expect(page.getByRole("heading", { level: 2, name: "Google Workspace", exact: true })).toBeVisible();
  const stageTwo = page.locator('[data-workspace-stage="2"]');
  const stageTwoToggle = stageTwo.locator(".workspace-stage-toggle");
  const stageFour = page.locator('[data-workspace-stage="4"]');
  const stageFourToggle = stageFour.locator(".workspace-stage-toggle");
  if (await stageFourToggle.getAttribute("aria-expanded") !== "true") await stageFourToggle.click();
  const settingsMailboxPicker = stageFour.getByRole("combobox", { name: /^Mailbox for Gmail verification/ });
  const viewInbox = stageFour.getByRole("button", { name: "View inbox", exact: true });
  await expect(settingsMailboxPicker).toHaveValue("ops@fci.example");
  await expect(viewInbox).toBeEnabled();

  settingsReadMode = "fail-ops";
  await viewInbox.click();
  const settingsReadError = page.locator(".toast-error").filter({ hasText: "The test inbox could not be loaded." });
  await expect(settingsReadError).toBeVisible();
  expect(settingsInboxReads).toEqual(["ops@fci.example"]);
  await settingsMailboxPicker.selectOption("info@fci.example");
  await settingsReadError.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Switch back to ops@fci.example before retrying that mailbox action.", { exact: true })).toBeVisible();
  expect(settingsInboxReads).toEqual(["ops@fci.example"]);

  settingsReadMode = "hold-info";
  await viewInbox.click();
  await expect.poll(() => releaseSettingsInfoRead !== null).toBe(true);
  if (await stageTwoToggle.getAttribute("aria-expanded") !== "true") await stageTwoToggle.click();
  await stageTwo.getByRole("button", { name: "Disconnect info@fci.example", exact: true }).click();
  await expect(stageTwo.getByRole("button", { name: "Disconnect info@fci.example", exact: true })).toHaveCount(0);
  releaseSettingsInfoRead?.();
  await expect(settingsMailboxPicker).toHaveValue("ops@fci.example");
  await expect(settingsMailboxPicker).toBeEnabled();
  await expect(viewInbox).toBeEnabled();
  await expect(stageTwo.getByLabel("Attached Google mailboxes").getByText("ops@fci.example", { exact: true })).toBeVisible();
  expect(disconnected).toEqual(["info@fci.example"]);
});

test("an Inbox error retry cannot act on or reveal its former mailbox after a switch", async ({ page }) => {
  await mockShell(page);
  await page.route("**/api/v1/integrations/google/connection", (route) => fulfillJson(route, {
    runtimeMode: "workspace",
    simulation: false,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      connected: true,
      status: "connected",
      account: "ops@fci.example",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: { drive: true, gmail: true, calendar: true, sheets: true },
      requiresReauthorization: false,
    },
    mailboxes: mailboxEmails.map(mailboxConnection),
  }));

  const patchedMailboxes: string[] = [];
  await page.route("**/api/v1/inbox-analysis?*", async (route) => {
    const mailbox = new URL(route.request().url()).searchParams.get("mailbox") as MailboxEmail;
    if (route.request().method() === "PATCH") {
      patchedMailboxes.push(mailbox);
      await fulfillJson(route, { error: "FCI TEST forced review update failure" }, 503);
      return;
    }
    await fulfillJson(route, {
      labels: [],
      rows: [{
        id: `${mailbox}-review`,
        subject: `${mailbox} private review`,
        sender: `sender@${mailbox.split("@")[1]}`,
        receivedAt: Date.UTC(2026, 7, 8, 12),
        analysis: null,
        leadProposal: null,
      }],
      totalCount: 1,
    });
  });

  await page.goto("/inbox");
  const mailboxPicker = page.getByRole("combobox", { name: "Connected mailbox", exact: true });
  await expect(mailboxPicker).toHaveValue("ops@fci.example");
  await page.getByRole("combobox", { name: "Mailbox", exact: true }).selectOption("needs-review");
  await expect(page.getByText("ops@fci.example private review", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark reviewed: ops@fci.example private review", exact: true }).click();
  const retryToast = page.locator(".toast-error").filter({ hasText: "The message could not be marked reviewed." });
  await expect(retryToast).toBeVisible();
  expect(patchedMailboxes).toEqual(["ops@fci.example"]);

  await mailboxPicker.selectOption("info@fci.example");
  await expect(page.getByText("info@fci.example private review", { exact: true })).toBeVisible();
  await retryToast.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Switch back to ops@fci.example before retrying that mailbox action.", { exact: true })).toBeVisible();
  expect(patchedMailboxes).toEqual(["ops@fci.example"]);
  await expect(page.getByText("ops@fci.example private review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("info@fci.example private review", { exact: true })).toBeVisible();
});

test("a created lead cannot be created again after retirement fails and the mailbox is revisited", async ({ page }) => {
  await mockShell(page);
  await page.route("**/api/v1/integrations/google/connection", (route) => fulfillJson(route, {
    runtimeMode: "workspace",
    simulation: false,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      connected: true,
      status: "connected",
      account: "ops@fci.example",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: { drive: true, gmail: true, calendar: true, sheets: true },
      requiresReauthorization: false,
    },
    mailboxes: mailboxEmails.map(mailboxConnection),
  }));

  const leadReviewRow = {
    id: "ws20-created-lead-review",
    subject: "FCI TEST mailbox lead request",
    sender: "Taylor Example <taylor@example.test>",
    receivedAt: Date.UTC(2026, 7, 8, 12),
    analysis: null,
    leadProposal: {
      company: "FCI TEST — DO NOT USE — Mailbox Lead",
      contactName: "Taylor Example",
      contactEmail: "taylor@example.test",
      contactPhone: "555-0120",
      projectName: "Mailbox lead estimate",
      site: "20 Test Lane",
      estimatedValue: 20_000,
    },
  };
  let leadPosts = 0;
  const reviewPatches: string[] = [];
  await page.unroute("**/api/v1/leads");
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() === "POST") {
      leadPosts += 1;
      await fulfillJson(route, { lead: { id: "ws20-created-lead" } }, 201);
      return;
    }
    await fulfillJson(route, { leads: [] });
  });
  await page.route("**/api/v1/inbox-analysis?*", async (route) => {
    const mailbox = new URL(route.request().url()).searchParams.get("mailbox") ?? "";
    if (route.request().method() === "PATCH") {
      reviewPatches.push(mailbox);
      await fulfillJson(route, { error: "FCI TEST forced review retirement failure" }, 503);
      return;
    }
    const rows = mailbox === "ops@fci.example" ? [leadReviewRow] : [];
    await fulfillJson(route, { labels: [], rows, totalCount: rows.length });
  });

  await page.goto("/inbox?bucket=needs-review");
  const mailboxPicker = page.getByRole("combobox", { name: "Connected mailbox", exact: true });
  const createLead = page.getByRole("button", {
    name: `Create lead: ${leadReviewRow.subject}`,
    exact: true,
  });
  await expect(mailboxPicker).toHaveValue("ops@fci.example");
  await createLead.click();
  const modal = page.getByRole("dialog", { name: "Add a lead" });
  await modal.getByRole("button", { name: "Add to pipeline", exact: true }).click();

  await expect(modal).toBeHidden();
  await expect(page.getByText(
    "Lead created, but this message is still in review. Use Mark reviewed to retire it when the queue is available.",
    { exact: true },
  )).toBeVisible();
  await expect(createLead).toHaveCount(0);
  expect(leadPosts).toBe(1);
  expect(reviewPatches).toEqual(["ops@fci.example"]);

  await mailboxPicker.selectOption("info@fci.example");
  await expect(page.getByText("No messages need review", { exact: true })).toBeVisible();
  await mailboxPicker.selectOption("ops@fci.example");
  await expect(page.getByText(leadReviewRow.subject, { exact: true })).toBeVisible();
  await expect(createLead).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: `Mark reviewed: ${leadReviewRow.subject}`,
    exact: true,
  })).toBeVisible();
  expect(leadPosts).toBe(1);
});

test("a delayed setup verification cannot mark the newly selected mailbox ready", async ({ page }) => {
  await mockShell(page);
  await page.unroute("**/api/v1/google-workspace");
  let firstReadinessRead = true;
  await page.route("**/api/v1/google-workspace", async (route) => {
    if (firstReadinessRead) {
      firstReadinessRead = false;
      await fulfillJson(route, { error: "FCI TEST force a visible retry" }, 503);
      return;
    }
    await fulfillJson(route, {
      credentialsPresent: true,
      missing: [],
      missingDetails: [],
      workspace: {
        runtimeMode: "workspace",
        simulation: false,
        storageName: "FCI Operations",
        storageConfigured: true,
        connectionStatus: "connected",
        connectionAccount: "ops@fci.example",
        driveConnected: true,
        gmailConnected: true,
        calendarConnected: true,
        sheetsConnected: true,
        requiresReauthorization: false,
        provisioningEnabled: true,
        gmailEnabled: true,
        calendarEnabled: true,
        sheetsEnabled: true,
        clientDirectorySheetConfigured: true,
        enabledServices: ["drive", "gmail", "calendar", "sheets"],
      },
    });
  });
  await page.route("**/api/v1/integrations/google/connection", (route) => fulfillJson(route, {
    runtimeMode: "workspace",
    simulation: false,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      connected: true,
      status: "connected",
      account: "ops@fci.example",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: { drive: true, gmail: true, calendar: true, sheets: true },
      requiresReauthorization: false,
    },
    mailboxes: mailboxEmails.map(mailboxConnection),
  }));

  let verificationMailbox = "";
  let releaseVerification: (() => void) | null = null;
  await page.unroute("**/api/v1/integrations/google/gmail/messages?*");
  await page.route("**/api/v1/integrations/google/gmail/messages?*", async (route) => {
    const url = new URL(route.request().url());
    verificationMailbox = url.searchParams.get("mailbox") ?? "";
    await new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    await fulfillJson(route, {
      bucket: "needs-review",
      messages: [],
      labelReady: true,
      testEmailPassed: true,
      limit: 20,
    });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  const stageFour = page.locator('[data-workspace-stage="4"]');
  const mailboxPicker = stageFour.getByRole("combobox", { name: /^Mailbox for Gmail verification/ });
  await expect(mailboxPicker).toHaveValue("ops@fci.example");
  await page.getByRole("button", { name: "Retry status check", exact: true }).click();
  await expect.poll(() => releaseVerification !== null).toBe(true);
  expect(verificationMailbox).toBe("ops@fci.example");
  await mailboxPicker.selectOption("info@fci.example");
  releaseVerification?.();

  const gmailVerification = stageFour.locator('[data-stage-four-verification="gmail"]');
  await expect(mailboxPicker).toHaveValue("info@fci.example");
  await expect(gmailVerification).not.toHaveAttribute("data-stage-four-state", "VERIFIED");
  await expect(gmailVerification).toHaveAttribute("data-stage-four-state", "READY TO VERIFY");
});

test("Gmail verification remains available when the default mailbox is disconnected", async ({ page }) => {
  await mockShell(page);
  await page.unroute("**/api/v1/google-workspace");
  let firstReadinessRead = true;
  await page.route("**/api/v1/google-workspace", (route) => {
    if (firstReadinessRead) {
      firstReadinessRead = false;
      return fulfillJson(route, { error: "FCI TEST force a visible retry" }, 503);
    }
    return fulfillJson(route, {
      credentialsPresent: true,
      missing: [],
      missingDetails: [],
      workspace: {
        runtimeMode: "workspace",
        simulation: false,
        storageName: "FCI Operations",
        storageConfigured: true,
        connectionStatus: "not-connected",
        connectionAccount: null,
        driveConnected: false,
        gmailConnected: false,
        calendarConnected: false,
        sheetsConnected: false,
        requiresReauthorization: false,
        provisioningEnabled: true,
        gmailEnabled: true,
        calendarEnabled: true,
        sheetsEnabled: true,
        clientDirectorySheetConfigured: true,
        enabledServices: ["drive", "gmail", "calendar", "sheets"],
      },
    });
  });
  await page.route("**/api/v1/integrations/google/connection", (route) => fulfillJson(route, {
    runtimeMode: "workspace",
    simulation: false,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      connected: true,
      status: "connected",
      account: "info@fci.example",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: { drive: true, gmail: true, calendar: true, sheets: true },
      requiresReauthorization: false,
    },
    mailboxes: [mailboxConnection("info@fci.example")],
  }));

  const verificationMailboxes: string[] = [];
  await page.route("**/api/v1/integrations/google/gmail/messages?*", async (route) => {
    const url = new URL(route.request().url());
    verificationMailboxes.push(url.searchParams.get("mailbox") ?? "");
    await fulfillJson(route, {
      bucket: "needs-review",
      messages: [],
      labelReady: true,
      testEmailPassed: true,
      limit: 20,
    });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  const stageFour = page.locator('[data-workspace-stage="4"]');
  const mailboxPicker = stageFour.getByRole("combobox", { name: /^Mailbox for Gmail verification/ });
  await expect(mailboxPicker).toHaveValue("info@fci.example");

  await page.getByRole("button", { name: "Retry status check", exact: true }).click();
  await expect.poll(() => verificationMailboxes).toContain("info@fci.example");
  await expect(stageFour.getByRole("button", { name: "View inbox", exact: true })).toBeEnabled();
  await expect(stageFour.locator('[data-stage-four-verification="gmail"]')).toHaveAttribute(
    "data-stage-four-state",
    "VERIFIED",
  );
});
