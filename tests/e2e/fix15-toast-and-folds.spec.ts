import { expect, test, type Page, type Route } from "@playwright/test";

const project = {
  id: "fix15-project-001",
  project_number: "CF-2026-FIX15001",
  client_id: "fix15-client-001",
  client_name: "FCI TEST — FIX-15 Client",
  name: "FIX-15 chronology project",
  status: "mobilizing",
  site: "150 FCI TEST Lane, Cherry Hill, NJ",
  project_manager_id: "e2e-admin@example.test",
  estimated_value: 15_000,
  flooring_category: "carpet",
  square_feet: 900,
  contract_value: 16_000,
  segment: "commercial",
  installation_started_at: null,
  installation_completed_at: null,
  had_callback: 0,
  callback_note: null,
  drive_folder_id: "fix15-drive-folder",
  drive_url: "https://drive.google.test/fix15-project",
  created_at: Date.UTC(2026, 6, 20, 12),
  updated_at: Date.UTC(2026, 6, 20, 12),
};

const client = {
  id: project.client_id,
  client_code: "FIX15",
  name: project.client_name,
  status: "active",
  industry: "Commercial",
  primary_contact_name: "FCI TEST Contact",
  primary_contact_email: "fix15-contact@example.test",
};

const freshLead = {
  id: "fix15-fresh-lead",
  leadNumber: "FCI-FIX15-FRESH",
  company: "FCI TEST — Newer directory snapshot",
  contactName: "Fresh Contact",
  projectName: "Fresh opportunity",
  source: "Referral",
  stage: "New inquiry",
  nextAction: "Keep the newest refresh",
  site: "Fresh Test Site",
  status: "active",
  estimatedValue: 25_000,
};

const staleLead = {
  ...freshLead,
  id: "fix15-stale-lead",
  leadNumber: "FCI-FIX15-STALE",
  company: "FCI TEST — Older directory snapshot",
};

const inboxMessage = {
  id: "fix15-message-001",
  threadId: "fix15-thread-001",
  from: "sender@example.test",
  to: "operations@example.test",
  subject: "FCI TEST — FIX-15 filing",
  date: "2026-07-25T13:00:00.000Z",
  snippet: "A safe simulated filing message.",
  labelIds: ["INBOX"],
};

function dashboard() {
  return {
    generatedAt: Date.UTC(2026, 6, 25, 12),
    metrics: {
      activeLeads: 1,
      estimatedPipelineValue: 25_000,
      activeProjects: 1,
      clientCount: 1,
      meetingCount: 2,
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
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockCurrentUser(page: Page) {
  await page.route("**/api/v1/settings/me", (route) => fulfillJson(route, {
    isAdmin: true,
    preferences: {
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
    },
  }));
}

async function mockStableDirectory(page: Page) {
  let dashboardReads = 0;
  await mockCurrentUser(page);
  await page.route("**/api/v1/leads", (route) => fulfillJson(route, { leads: [freshLead] }));
  await page.route("**/api/v1/clients", (route) => fulfillJson(route, { clients: [client] }));
  await page.route("**/api/v1/projects", (route) => fulfillJson(route, { projects: [project] }));
  await page.route("**/api/v1/dashboard", (route) => {
    dashboardReads += 1;
    return fulfillJson(route, dashboard());
  });
  await page.route("**/api/v1/filing-rules", (route) => fulfillJson(route, { rules: [] }));
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => fulfillJson(route, { mirror: null }));
  return { dashboardReads: () => dashboardReads };
}

async function expectSuccessToastLifetime(page: Page, message: string) {
  const successToast = page.locator(".toast.toast-success");
  await expect(successToast).toContainText(message);
  await expect(page.locator(".toast.toast-info")).toHaveCount(0);
  await page.clock.fastForward(3_199);
  await expect(successToast).toContainText(message);
  await page.clock.fastForward(1);
  await expect(page.locator(".toast")).toHaveCount(0);
}

// The simulation-reset toast test drives the REAL "Reset simulation data"
// endpoint (no route mocks), and that endpoint deletes every workspace_resources
// row for the shared "workspace-simulation" connection — see
// app/api/v1/integrations/google/simulation/reset/route.ts (DELETE FROM
// workspace_resources ...). resetWorkspaceSimulation() only re-seeds the Gmail /
// calendar state and never re-provisions the registry. That deleted partition
// includes the seed.sql-provisioned "client-directory" spreadsheet row
// (tests/e2e/fixtures/seed.sql) that workspace-setup-stepper.spec.ts reads as its
// "App-managed" / "Created" precondition. playwright.config.ts runs a single
// worker (workers: 1, fullyParallel: false) against one shared web server, and
// this spec sorts before workspace-setup-stepper.spec.ts, so the deletion leaks
// forward and leaves that precondition reading "Not configured". Re-provision the
// registry through the same real simulation setup endpoints the stepper creation
// journey exercises (adopt Shared Drive -> ensure root folders -> ensure
// spreadsheets); in simulation these run without a Google connection and recreate
// the app-managed "client-directory" row with origin "created".
async function restoreSimulationDirectoryRegistry(page: Page) {
  return page.evaluate(async () => {
    const post = async (url: string) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        throw new Error(`restore step ${url} failed: ${response.status} ${await response.text()}`);
      }
    };
    // Order matters: ensure-roots and ensure-spreadsheets both require the
    // Shared Drive to be adopted into the registry first.
    await post("/api/v1/integrations/google/drive/shared-drive/adopt");
    await post("/api/v1/integrations/google/drive/folders/ensure-roots");
    await post("/api/v1/integrations/google/sheets/ensure");
    const verify = await fetch("/api/v1/integrations/google/setup/resources");
    if (!verify.ok) throw new Error(`restore verification failed: ${verify.status}`);
    const payload = await verify.json() as {
      resources: Array<{ key: string; resourceType: string; source: string; origin?: string }>;
    };
    return payload.resources.find(
      (resource) => resource.resourceType === "sheets.spreadsheet" && resource.key === "client-directory",
    ) ?? null;
  });
}

test.describe("FIX-15 toast timeline", () => {
  test("simulation-reset success is not clobbered by its readiness refresh", async ({ page }) => {
    await page.goto("/settings?section=google-workspace");
    const stageTwo = page.locator('[data-workspace-stage="2"]');
    const stageToggle = stageTwo.locator(".workspace-stage-toggle");
    await expect(page.locator(".workspace-status-copy > strong")).not.toHaveText("Checking current status…");
    if (await stageToggle.getAttribute("aria-expanded") !== "true") await stageToggle.click();
    await expect(stageTwo.getByRole("button", { name: "Reset simulation data", exact: true })).toBeEnabled();
    await page.clock.install({ time: new Date("2026-07-25T15:00:00.000Z") });
    await page.clock.pauseAt(new Date("2026-07-25T15:00:01.000Z"));

    await stageTwo.getByRole("button", { name: "Reset simulation data", exact: true }).click();

    await expectSuccessToastLifetime(page, "Workspace simulation reset with");
    await expect(page.getByText("Workspace readiness refreshed. Current status is shown above.", { exact: true })).toHaveCount(0);

    // Restore the shared simulation registry this real reset destroyed so that
    // workspace-setup-stepper.spec.ts still reads an App-managed / Created
    // "client-directory" row for its pre-reset precondition.
    const restoredDirectory = await restoreSimulationDirectoryRegistry(page);
    expect(restoredDirectory?.source).toBe("app");
    expect(restoredDirectory?.origin).toBe("created");
  });

  test("Gmail filing success is not clobbered by the follow-up message reload", async ({ page }) => {
    await mockStableDirectory(page);
    await page.route("**/api/v1/google-workspace", (route) => fulfillJson(route, {
      workspace: {
        connectionStatus: "connected",
        connectionAccount: "simulation@example.test",
        gmailConnected: true,
        gmailEnabled: true,
        runtimeMode: "simulation",
        simulation: true,
      },
    }));
    await page.route("**/api/v1/integrations/google/gmail/messages?*", (route) => fulfillJson(route, {
      messages: [inboxMessage],
      labelReady: true,
    }));
    await page.route("**/api/v1/integrations/google/gmail/messages/*/file?*", (route) => fulfillJson(route, {
      message: {
        ...inboxMessage,
        attachmentCount: 2,
        attachments: [
          { filename: "scope.pdf", mimeType: "application/pdf", byteSize: 2_048 },
          { filename: "plan.png", mimeType: "image/png", byteSize: 4_096 },
        ],
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
    }));
    await page.route("**/api/v1/integrations/google/gmail/messages/*/file", (route) => fulfillJson(route, {
      filed: true,
      alreadyFiled: false,
      archive: { attachmentCount: 2 },
    }));

    await page.goto("/inbox");
    await expect(page.getByRole("button", { name: "Load messages", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Load messages", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review & copy", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page.clock.install({ time: new Date("2026-07-25T15:00:00.000Z") });
    await page.clock.pauseAt(new Date("2026-07-25T15:00:01.000Z"));

    await page.getByRole("button", { name: "Review & copy", exact: true }).click();
    const filingDialog = page.getByRole("dialog", { name: "File email to one project", exact: true });
    await filingDialog.getByRole("combobox", { name: "Exact independent project" }).selectOption(project.id);
    await filingDialog.getByRole("button", { name: "Review destination", exact: true }).click();
    await expect(filingDialog.getByRole("button", { name: "Copy email + 2 attachments", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await filingDialog.getByRole("button", { name: "Copy email + 2 attachments", exact: true }).click();

    await expectSuccessToastLifetime(page, "Email and 2 attachment(s) were copied");
    await expect(page.getByText("Loaded 1 message from Inbox.", { exact: true })).toHaveCount(0);
  });
});

async function installDirectoryRace(page: Page, staleOutcome: "success" | "error") {
  await mockCurrentUser(page);
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstResponsesDelivered = 0;
  const counts = new Map<string, number>();

  const routeDirectoryRead = async (route: Route, path: string, freshBody: unknown, staleBody: unknown) => {
    const nextCount = (counts.get(path) ?? 0) + 1;
    counts.set(path, nextCount);
    if (nextCount === 1) {
      await firstGate;
      if (staleOutcome === "error" && path === "/api/v1/dashboard") {
        await fulfillJson(route, { error: "Older directory snapshot failed." }, 503);
      } else {
        await fulfillJson(route, staleBody);
      }
      firstResponsesDelivered += 1;
      return;
    }
    await fulfillJson(route, freshBody);
  };

  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, { lead: freshLead }, 201);
      return;
    }
    await routeDirectoryRead(route, "/api/v1/leads", { leads: [freshLead] }, { leads: [staleLead] });
  });
  await page.route("**/api/v1/clients", (route) => routeDirectoryRead(route, "/api/v1/clients", { clients: [client] }, { clients: [] }));
  await page.route("**/api/v1/projects", (route) => routeDirectoryRead(route, "/api/v1/projects", { projects: [project] }, { projects: [] }));
  await page.route("**/api/v1/dashboard", (route) => routeDirectoryRead(route, "/api/v1/dashboard", dashboard(), {
    ...dashboard(),
    generatedAt: 1,
    metrics: {
      ...dashboard().metrics,
      activeLeads: 99,
      estimatedPipelineValue: 999_000,
      activeProjects: 0,
    },
  }));
  await page.route("**/api/v1/filing-rules", (route) => fulfillJson(route, { rules: [] }));
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => fulfillJson(route, { mirror: null }));

  return {
    releaseFirst,
    firstResponsesDelivered: () => firstResponsesDelivered,
    initialReadsStarted: () => [
      "/api/v1/leads",
      "/api/v1/clients",
      "/api/v1/projects",
      "/api/v1/dashboard",
    ].every((path) => counts.get(path) === 1),
  };
}

async function triggerNewerDirectoryRefresh(page: Page, navigate = true) {
  if (navigate) await page.goto("/leads");
  const addLeadButton = page.getByRole("button", { name: "Add lead", exact: true });
  await addLeadButton.click();
  const dialog = page.getByRole("dialog", { name: "Add a lead", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Client company" }).fill("FCI TEST — Refresh trigger");
  await dialog.getByRole("textbox", { name: "Primary contact" }).fill("Refresh Contact");
  await dialog.getByRole("textbox", { name: "Project / opportunity" }).fill("Refresh ordering");
  await dialog.getByRole("spinbutton", { name: "Estimated value" }).fill("25000");
  await dialog.getByRole("textbox", { name: "Project site" }).fill("Refresh Test Site");
  await dialog.getByRole("textbox", { name: "Next action" }).fill("Keep the newest snapshot");
  await dialog.getByRole("button", { name: "Add to pipeline", exact: true }).click();
  await expect(page.getByText(freshLead.company, { exact: true })).toBeVisible();
}

for (const staleOutcome of ["success", "error"] as const) {
  test(`N7-7 ignores an older directory ${staleOutcome} after a newer mutation refresh`, async ({ page }) => {
    const race = await installDirectoryRace(page, staleOutcome);
    await page.goto("/leads");
    await expect.poll(race.initialReadsStarted).toBe(true);
    await triggerNewerDirectoryRefresh(page, false);

    race.releaseFirst();
    await expect.poll(race.firstResponsesDelivered).toBe(4);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    await expect(page.getByText(freshLead.company, { exact: true })).toBeVisible();
    await expect(page.getByText(staleLead.company, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "Older directory snapshot failed." })).toHaveCount(0);
  });
}

test("N7-7 ignores old optional rule and mirror responses after a newer refresh", async ({ page }) => {
  await mockCurrentUser(page);
  let releaseSecondOptionals!: () => void;
  const oldOptionalGate = new Promise<void>((resolve) => {
    releaseSecondOptionals = resolve;
  });
  let oldOptionalsDelivered = 0;
  let rulesReads = 0;
  let mirrorReads = 0;
  let coreReads = 0;
  const freshRule = {
    id: "fix15-fresh-rule",
    name: "FCI TEST — Fresh filing rule",
    enabled: true,
    priority: 20,
    matchSummary: "Fresh response only",
    action: "review",
    targetCategory: "Needs review",
    approvalRequired: true,
  };
  const oldRule = {
    ...freshRule,
    id: "fix15-old-rule",
    name: "FCI TEST — Old filing rule",
    matchSummary: "Must never overwrite the fresh response",
  };
  const freshMirror = {
    configured: true,
    enabled: true,
    connected: true,
    spreadsheetUrl: null,
    spreadsheetName: "FCI TEST Fresh Mirror",
    clients: { status: "synced", lastSyncedAt: 2, lastError: null },
    projects: { status: "synced", lastSyncedAt: 2, lastError: null },
    lastSyncedAt: 2,
    reason: null,
    source: "app",
  };
  const oldMirror = {
    ...freshMirror,
    spreadsheetName: "FCI TEST Old Mirror",
    clients: { status: "failed", lastSyncedAt: 1, lastError: "Old client mirror error" },
    projects: { status: "failed", lastSyncedAt: 1, lastError: "Old project mirror error" },
    lastSyncedAt: 1,
    reason: "Old optional state",
  };
  const initialRule = {
    ...freshRule,
    id: "fix15-initial-rule",
    name: "FCI TEST — Initial filing rule",
    matchSummary: "Initial ready state",
  };
  const initialMirror = {
    ...freshMirror,
    spreadsheetName: "FCI TEST Initial Mirror",
    clients: { status: "synced", lastSyncedAt: 0, lastError: null },
    projects: { status: "synced", lastSyncedAt: 0, lastError: null },
    lastSyncedAt: 0,
  };

  await page.route("**/api/v1/leads", async (route) => {
    coreReads += 1;
    await fulfillJson(route, { leads: [freshLead] });
  });
  await page.route("**/api/v1/clients", (route) => fulfillJson(route, { clients: [client] }));
  await page.route("**/api/v1/projects", (route) => fulfillJson(route, { projects: [project] }));
  await page.route("**/api/v1/dashboard", (route) => fulfillJson(route, dashboard()));
  await page.route("**/api/v1/filing-rules", async (route) => {
    rulesReads += 1;
    if (rulesReads === 2) {
      await oldOptionalGate;
      await fulfillJson(route, { rules: [oldRule] });
      oldOptionalsDelivered += 1;
      return;
    }
    await fulfillJson(route, { rules: [rulesReads === 1 ? initialRule : freshRule] });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    mirrorReads += 1;
    if (mirrorReads === 2) {
      await oldOptionalGate;
      await fulfillJson(route, { mirror: oldMirror });
      oldOptionalsDelivered += 1;
      return;
    }
    await fulfillJson(route, { mirror: mirrorReads === 1 ? initialMirror : freshMirror });
  });
  await page.route("**/api/v1/integrations/google/sheets/sync", (route) => fulfillJson(route, {
    result: { clients: { total: 1 }, projects: { total: 1 } },
    mirror: freshMirror,
  }));

  await page.goto("/settings?section=client-directory");
  const syncNow = page.getByRole("button", { name: "Sync now", exact: true });
  await expect(syncNow).toBeEnabled();
  await expect.poll(() => coreReads).toBe(1);
  await expect.poll(() => rulesReads).toBe(1);
  await expect.poll(() => mirrorReads).toBe(1);

  await syncNow.click();
  await expect.poll(() => coreReads).toBe(2);
  await expect.poll(() => rulesReads).toBe(2);
  await expect.poll(() => mirrorReads).toBe(2);
  await expect(syncNow).toBeEnabled();

  await syncNow.click();
  await expect.poll(() => coreReads).toBe(3);
  await expect.poll(() => rulesReads).toBe(3);
  await expect.poll(() => mirrorReads).toBe(3);
  const mirrorLabels = page.locator(".directory-sync-summary article > strong");
  await expect(mirrorLabels).toHaveText(["Synced", "Synced"]);

  releaseSecondOptionals();
  await expect.poll(() => oldOptionalsDelivered).toBe(2);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(mirrorLabels).toHaveText(["Synced", "Synced"]);
  await expect(page.getByText("Old optional state", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Old client mirror error" })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Old project mirror error" })).toHaveCount(0);

  await page.locator(".settings-nav").getByRole("button", { name: "Inbox & file rules", exact: true }).click();
  await expect.poll(() => coreReads).toBe(3);
  await expect.poll(() => rulesReads).toBe(3);
  await expect.poll(() => mirrorReads).toBe(3);
  await expect(page.getByText(freshRule.name, { exact: true })).toBeVisible();
  await expect(page.getByText(oldRule.name, { exact: true })).toHaveCount(0);
});

test("N7-8 inserts a past-dated saved meeting in meetingAt-descending order", async ({ page }) => {
  const stableDirectory = await mockStableDirectory(page);
  const newestMeeting = {
    id: "fix15-meeting-newest",
    projectId: project.id,
    title: "Newest existing meeting",
    meetingAt: "2026-07-25T18:00:00.000Z",
    meetingType: "client",
    sourceProvider: "manual",
    sourceUrl: null,
    attendees: [],
    notes: null,
    transcript: null,
    summary: null,
    decisions: null,
    actionItems: [],
    createdBy: "e2e-admin@example.test",
    createdAt: Date.UTC(2026, 6, 25, 18),
    updatedAt: Date.UTC(2026, 6, 25, 18),
  };
  const oldestMeeting = {
    ...newestMeeting,
    id: "fix15-meeting-oldest",
    title: "Oldest existing meeting",
    meetingAt: "2026-07-23T18:00:00.000Z",
    createdAt: Date.UTC(2026, 6, 23, 18),
    updatedAt: Date.UTC(2026, 6, 23, 18),
  };
  const equalTimePeer = {
    ...newestMeeting,
    id: "fix15-meeting-peer",
    title: "Equal-time existing meeting",
    meetingAt: "2026-07-24T18:00:00.000Z",
    createdAt: Date.UTC(2026, 6, 25, 18),
    updatedAt: Date.UTC(2026, 6, 25, 18),
  };
  const staleSavedMeeting = {
    ...newestMeeting,
    id: "fix15-meeting-saved",
    title: "Old copy of saved meeting",
    meetingAt: "2026-07-24T18:00:00.000Z",
    createdAt: Date.UTC(2026, 6, 25, 17),
    updatedAt: Date.UTC(2026, 6, 25, 17),
  };
  const savedPastMeeting = {
    ...newestMeeting,
    id: "fix15-meeting-saved",
    title: "Past-dated saved meeting",
    meetingAt: "2026-07-24T18:00:00.000Z",
    createdAt: Date.UTC(2026, 6, 25, 19),
    updatedAt: Date.UTC(2026, 6, 25, 19),
  };
  await page.route("**/api/v1/projects/*/meetings", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, { meeting: savedPastMeeting }, 201);
      return;
    }
    await fulfillJson(route, { meetings: [newestMeeting, equalTimePeer, staleSavedMeeting, oldestMeeting] });
  });

  await page.goto("/projects");
  await page.getByRole("button", {
    name: `Open project ${project.project_number}: ${project.name}`,
    exact: true,
  }).click();
  const projectDrawer = page.getByRole("dialog", {
    name: `${project.project_number} ${project.name}`,
    exact: true,
  });
  await projectDrawer.getByRole("button", { name: "Meetings", exact: true }).click();
  await expect(projectDrawer.locator(".meeting-card h4")).toHaveText([
    newestMeeting.title,
    equalTimePeer.title,
    staleSavedMeeting.title,
    oldestMeeting.title,
  ]);
  const dashboardReadsBeforeSave = stableDirectory.dashboardReads();
  await projectDrawer.getByRole("button", { name: "Add meeting", exact: true }).click();
  const meetingDialog = page.getByRole("dialog", {
    name: `Capture meeting notes for ${project.project_number}`,
    exact: true,
  });
  await meetingDialog.getByRole("textbox", { name: "Meeting title" }).fill(savedPastMeeting.title);
  await meetingDialog.getByLabel("Date and time").fill("2026-07-24T14:00");
  await meetingDialog.getByRole("button", { name: "Save meeting", exact: true }).click();

  await expect(projectDrawer.locator(".meeting-card h4")).toHaveText([
    newestMeeting.title,
    savedPastMeeting.title,
    equalTimePeer.title,
    oldestMeeting.title,
  ]);
  await expect(projectDrawer.getByText(staleSavedMeeting.title, { exact: true })).toHaveCount(0);
  await expect(projectDrawer.locator(".meeting-card")).toHaveCount(4);
  await expect.poll(stableDirectory.dashboardReads).toBe(dashboardReadsBeforeSave + 1);
});
