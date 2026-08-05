import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import { seedWorkspaceBlueprint, type WorkspaceBlueprint } from "../../app/lib/workspace-blueprint";
import { registerSimulationResetRecovery } from "./simulation-workspace";

// Teardown-budget recovery for the real reset one test in this file drives. Not
// an in-test finally: that shares the test's 45s timeout and is abandoned when
// it expires, which would leak the wiped registry into every later spec.
const { markResetAttempted } = registerSimulationResetRecovery(test);

const e2eOrigin = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";

type MirrorStatus = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  clients: { status: string; lastSyncedAt: number | null; lastError: string | null };
  projects: { status: string; lastSyncedAt: number | null; lastError: string | null };
  lastSyncedAt: number | null;
  reason: string | null;
  source: "app" | "env" | "none";
};
type ReadinessPayload = {
  credentialsPresent: boolean;
  missing: string[];
  missingDetails: Array<{ label: string; envVar: string; secret: boolean }>;
  workspace: Record<string, unknown>;
};
type GoogleServiceKey = "drive" | "gmail" | "calendar" | "sheets";
type ConnectionHealthPayload = {
  runtimeMode: "simulation" | "workspace";
  simulation: boolean;
  enabledServices: GoogleServiceKey[];
  connection: {
    connected: boolean;
    status: string;
    account: string | null;
    services: Record<GoogleServiceKey, boolean>;
    grantedServices: Record<GoogleServiceKey, boolean> | null;
    requiresReauthorization: boolean;
  };
};
type WorkspaceResourcesPayload = {
  resources: Array<{
    key: string;
    resourceType?: "drive.shared-drive" | "drive.folder" | "drive.file" | "sheets.spreadsheet" | "calendar.calendar";
    label: string;
    name?: string;
    blueprintName: string;
    management?: "owner" | "system";
    role?: "system-mirror" | "import" | "reference";
    parentKey?: string | null;
    externalId?: string;
    source: "app" | "env" | "none";
    origin?: "created" | "adopted" | "env-adopted";
    url?: string;
    updatedAt?: number;
    restrictions?: {
      adminManagedRestrictions: boolean | null;
      copyRequiresWriterPermission: boolean | null;
      domainUsersOnly: boolean | null;
      driveMembersOnly: boolean | null;
      sharingFoldersRequiresOrganizerPermission: boolean | null;
    };
    state: "Found" | "Created" | "Adopted" | "Not configured" | "Simulated";
    restrictions?: {
      adminManagedRestrictions: boolean | null;
      copyRequiresWriterPermission: boolean | null;
      domainUsersOnly: boolean | null;
      driveMembersOnly: boolean | null;
      sharingFoldersRequiresOrganizerPermission: boolean | null;
    };
  }>;
  connectReady: boolean;
  simulation: boolean;
  identity: {
    connectionAccount: string | null;
    intakeMailboxMatches: boolean | null;
    allowedDomains: string[];
    mode: "simulation" | "workspace";
  };
};

const missingInvariant = "Google Workspace intake mailbox dispatch@cherryhillfci.com matching connected account op•••@cherryhillfci.com";

function readiness(overrides: Record<string, unknown> = {}): ReadinessPayload {
  return {
    credentialsPresent: true,
    missing: [],
    missingDetails: [],
    workspace: {
      runtimeMode: "workspace",
      simulation: false,
      storageName: "FCI Operations",
      storageConfigured: true,
      connectionStatus: "connected",
      connectionAccount: "op•••@cherryhillfci.com",
      driveConnected: true,
      gmailConnected: true,
      calendarConnected: true,
      sheetsConnected: true,
      requiresReauthorization: false,
      provisioningEnabled: false,
      gmailEnabled: true,
      calendarEnabled: true,
      sheetsEnabled: true,
      clientDirectorySheetConfigured: true,
      enabledServices: ["drive", "gmail", "calendar", "sheets"],
      ...overrides,
    },
  };
}

function unsyncedMirror(): MirrorStatus {
  return {
    configured: true,
    enabled: true,
    connected: true,
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fci-test/edit",
    spreadsheetName: "Client Directory",
    clients: { status: "not-synced", lastSyncedAt: null, lastError: null },
    projects: { status: "not-synced", lastSyncedAt: null, lastError: null },
    lastSyncedAt: null,
    reason: null,
    source: "app",
  };
}

function connectedHealth(): ConnectionHealthPayload {
  return {
    runtimeMode: "workspace",
    simulation: false,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      connected: true,
      status: "connected",
      account: "op•••@cherryhillfci.com",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: { drive: true, gmail: true, calendar: true, sheets: true },
      requiresReauthorization: false,
    },
  };
}

function operationsHealthPayload(detail: string, nextCursor?: string) {
  return {
    runtimeMode: "simulation",
    simulation: true,
    checkedAt: Date.UTC(2026, 7, 4, 20),
    limits: { perCategory: 50 },
    driveOperations: { items: [], hasMore: false },
    failedArchives: { items: [], hasMore: false },
    events: {
      items: [{
        id: `event-${detail.toLowerCase().replaceAll(" ", "-")}`,
        eventType: "workspace.test",
        actor: "admin@example.test",
        entityType: "connection",
        entityId: "simulation",
        detail,
        createdAt: Date.UTC(2026, 7, 4, 20),
      }],
      hasMore: Boolean(nextCursor),
      nextCursor,
    },
  };
}

function workspaceResources(overrides: Partial<WorkspaceResourcesPayload> = {}): WorkspaceResourcesPayload {
  return {
    resources: [
      { key: "primary", resourceType: "drive.shared-drive", label: "Shared Drive", name: "FCI Operations", blueprintName: "FCI Operations", management: "owner", parentKey: null, externalId: "drive-id", source: "env", state: "Found" },
      { key: "client-accounts", resourceType: "drive.folder", label: "Root folder", name: "01_Client Accounts", blueprintName: "01_Client Accounts", management: "owner", parentKey: null, externalId: "folder-id", source: "app", origin: "created", state: "Created" },
      { key: "client-directory", resourceType: "sheets.spreadsheet", label: "Client directory spreadsheet", name: "FCI Operations Directory", blueprintName: "FCI Operations Directory", management: "system", role: "system-mirror", parentKey: "company-admin", externalId: "sheet-id", source: "app", origin: "created", state: "Created" },
      { key: "estimate-proposal", resourceType: "drive.file", label: "Document template", name: "Estimate Proposal", blueprintName: "Estimate Proposal", management: "owner", parentKey: "templates", externalId: "template-id", source: "app", origin: "created", state: "Created" },
      { key: "client-appointments", resourceType: "calendar.calendar", label: "Client appointments calendar", name: "FCI • Client Appointments", blueprintName: "FCI • Client Appointments", management: "system", parentKey: null, externalId: "appointments-id", source: "env", state: "Found" },
      { key: "field-schedule", resourceType: "calendar.calendar", label: "Field schedule calendar", name: "FCI • Field Schedule", blueprintName: "FCI • Field Schedule", management: "system", parentKey: null, source: "none", state: "Not configured" },
    ],
    connectReady: true,
    simulation: false,
    identity: {
      connectionAccount: "operations@cherryhillfci.com",
      intakeMailboxMatches: true,
      allowedDomains: ["cherryhillfci.com"],
      mode: "workspace",
    },
    ...overrides,
  };
}

function completedWorkspaceResources(): WorkspaceResourcesPayload {
  return workspaceResources({
    resources: workspaceResources().resources.map((resource) => {
      if (resource.resourceType === "drive.shared-drive") {
        return { ...resource, source: "app" as const, origin: "adopted" as const, state: "Adopted" as const };
      }
      if (resource.resourceType === "drive.folder" || resource.resourceType === "sheets.spreadsheet" || resource.resourceType === "drive.file") {
        return { ...resource, source: "app" as const, origin: "created" as const, state: "Created" as const };
      }
      return resource;
    }),
  });
}

async function mockConnectionHealth(page: Page, payload: ConnectionHealthPayload) {
  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      return;
    }
    await route.continue();
  });
}

async function mockWorkspaceResources(page: Page, payload: WorkspaceResourcesPayload = workspaceResources()) {
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

type StageFourVerificationStatus = {
  labelReady: boolean;
  testEmailPassed: boolean;
  calendarChecked: boolean;
};

async function mockStageFourVerificationStatus(
  page: Page,
  status: StageFourVerificationStatus = {
    labelReady: false,
    testEmailPassed: false,
    calendarChecked: false,
  },
) {
  await page.route("**/api/v1/integrations/google/gmail/messages?label=needs-review&verification=status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bucket: "needs-review",
        messages: [],
        labelReady: status.labelReady,
        testEmailPassed: status.testEmailPassed,
        limit: 20,
      }),
    });
  });
  await page.route("**/api/v1/integrations/google/calendar/events?verification=status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [], verificationPassed: status.calendarChecked }),
    });
  });
}

async function mockWorkspaceBlueprint(page: Page, initial: WorkspaceBlueprint = seedWorkspaceBlueprint(), initialVersion = 0) {
  let blueprint = structuredClone(initial) as WorkspaceBlueprint;
  let version = initialVersion;
  let nextSaveFailure: { status: number; error: string } | null = null;
  await page.route("**/api/v1/integrations/google/setup/blueprint", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ blueprint, version, seeded: version === 0 }) });
      return;
    }
    if (nextSaveFailure) {
      const failure = nextSaveFailure;
      nextSaveFailure = null;
      await route.fulfill({ status: failure.status, contentType: "application/json", body: JSON.stringify({ error: failure.error }) });
      return;
    }
    const body = route.request().postDataJSON() as { blueprint: WorkspaceBlueprint; expectedVersion: number };
    if (body.expectedVersion !== version) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "The Workspace blueprint changed after this editor loaded. Load the latest version before saving again.",
          code: "workspace_blueprint_version_conflict",
          currentVersion: version,
        }),
      });
      return;
    }
    blueprint = structuredClone(body.blueprint);
    version += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ blueprint, version, seeded: false }) });
  });
  return {
    current: () => ({ blueprint: structuredClone(blueprint), version }),
    replace: (nextBlueprint: WorkspaceBlueprint, nextVersion: number) => {
      blueprint = structuredClone(nextBlueprint) as WorkspaceBlueprint;
      version = nextVersion;
    },
    failNextSave: (status: number, error: string) => {
      nextSaveFailure = { status, error };
    },
  };
}

test.beforeEach(async ({ page }) => {
  await mockWorkspaceResources(page);
  await mockWorkspaceBlueprint(page);
});

type WorkspaceStageNumber = 1 | 2 | 3 | 4;

function setupStage(page: Page, number: WorkspaceStageNumber) {
  return page.locator(`.workspace-setup-stage[data-workspace-stage="${number}"]`);
}

function stageToggle(page: Page, number: WorkspaceStageNumber) {
  return setupStage(page, number).locator(".workspace-stage-toggle");
}

function creationCard(page: Page) {
  return setupStage(page, 3).locator('section[aria-labelledby="workspace-creation-heading"]');
}

type StageThreeSubsectionKey = "creation" | "blueprint";

function stageThreeSubsection(page: Page, key: StageThreeSubsectionKey) {
  return setupStage(page, 3).locator(`[data-stage-three-subsection="${key}"]`);
}

function stageThreeSubsectionToggle(page: Page, key: StageThreeSubsectionKey) {
  return stageThreeSubsection(page, key).getByRole("button", {
    name: new RegExp(`^(?:Expand|Collapse) ${key === "creation" ? "Workspace creation" : "Blueprint"}$`),
  });
}

function creationRow(page: Page, key: "shared-drive" | "folder-tree" | "spreadsheets" | "templates" | "calendars") {
  return creationCard(page).locator(`[data-workspace-creation-row="${key}"]`);
}

function verificationRow(page: Page, key: "gmail" | "calendar" | "sheets") {
  return setupStage(page, 4).locator(`[data-stage-four-verification="${key}"]`);
}

function upkeepRow(page: Page, key: "drift" | "renames" | "operations-health" | "notifications") {
  return setupStage(page, 4).locator(`[data-stage-four-upkeep="${key}"]`);
}

async function waitForStageShellToSettle(page: Page) {
  await expect(page.locator(".workspace-status-copy > strong")).not.toHaveText("Checking current status…");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function setStageExpanded(page: Page, number: WorkspaceStageNumber, expanded: boolean) {
  await waitForStageShellToSettle(page);
  const toggle = stageToggle(page, number);
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== String(expanded)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(expanded));
  const body = setupStage(page, number).locator(".workspace-stage-body");
  if (expanded) await expect(body).toBeVisible();
  else await expect(body).toBeHidden();
}

/**
 * SET-42 deleted the six manual refresh buttons and replaced them with
 * focus/visibility/navigation revalidation, so this helper is the only
 * regression test left for "focus revalidates the panel". It therefore has to
 * prove a network read happened *because of* the focus — not merely that some
 * response for this URL arrived at some point.
 */
async function triggerAutomaticWorkspaceRefresh(
  page: Page,
  expectedPath = "/api/v1/integrations/google/setup/resources",
) {
  const matches = (request: Request) => (
    request.method() === "GET" && new URL(request.url()).pathname === expectedPath
  );
  let started = 0;
  let settled = 0;
  let snapshotTaken = false;
  const startedAfterSnapshot = new Set<Request>();
  const onRequest = (request: Request) => {
    if (!matches(request)) return;
    started += 1;
    if (snapshotTaken) startedAfterSnapshot.add(request);
  };
  const onSettled = (request: Request) => {
    if (matches(request)) settled += 1;
  };
  page.on("request", onRequest);
  page.on("requestfinished", onSettled);
  page.on("requestfailed", onSettled);
  try {
    // `page.waitForLoadState("networkidle")` used to stand here. Playwright
    // never re-arms networkidle after a document's first idle, so it resolved
    // instantly and guarded nothing. Gate on this endpoint alone instead: that
    // removes the real hazard (a response already in flight satisfying the wait
    // below) while deliberately leaving the lifecycle census free to still be
    // mid-pass, which is the exact race this helper must keep exercising.
    await expect
      .poll(() => started - settled, {
        timeout: 15_000,
        message: `${expectedPath} never went quiet before the focus trigger`,
      })
      .toBe(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    const readsBeforeFocus = started;
    snapshotTaken = true;
    // Only a response whose REQUEST began after the focus can settle this wait.
    // Accepting any response for the path let a request issued before the test
    // mutated its payload satisfy the helper, so the assertions that followed
    // read the previous payload.
    const response = page.waitForResponse((candidate) => startedAfterSnapshot.has(candidate.request()));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await response;
    expect(
      started,
      `focus produced no new GET ${expectedPath}: lifecycle revalidation dropped the trigger`,
    ).toBeGreaterThan(readsBeforeFocus);

    await expect
      .poll(() => started - settled, {
        timeout: 15_000,
        message: `${expectedPath} never went quiet after the focus trigger`,
      })
      .toBe(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onSettled);
    page.off("requestfailed", onSettled);
  }
}

async function setStageThreeSubsectionExpanded(page: Page, key: StageThreeSubsectionKey, expanded: boolean) {
  await setStageExpanded(page, 3, true);
  const toggle = stageThreeSubsectionToggle(page, key);
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== String(expanded)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(expanded));
  const bodyId = await toggle.getAttribute("aria-controls");
  expect(bodyId).toBeTruthy();
  const body = page.locator(`[id="${bodyId}"]`);
  await expect(body).toHaveCount(1);
  if (expanded) await expect(body).toBeVisible();
  else await expect(body).toBeHidden();
}

async function mockReadyWorkspaceForStageThree(page: Page) {
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });
  await mockStageFourVerificationStatus(page);
}

function tenantChecklistRow(page: Page, title: string) {
  return page.locator(".workspace-prerequisites li").filter({ has: page.getByText(title, { exact: true }) });
}

async function expectNeutralStageChips(page: Page, label: "CHECKING" | "UNAVAILABLE") {
  const chips = page.locator(".workspace-stage-chip");
  await expect(chips).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(chips.nth(index)).toHaveText(label);
    await expect(chips.nth(index)).toHaveClass(/\bneutral\b/);
    await expect(chips.nth(index)).toHaveClass(/stageChipNeutral/);
  }
}

test("administrator selects an allowlisted intake mailbox without changing the hosted allowlist", async ({ page }) => {
  const primary = "operations@cherryhillfci.com";
  const secondary = "dispatch@cherryhillfci.com";
  let selectedMailbox = primary;
  let currentReadiness = readiness();
  let currentResources = workspaceResources();
  const patchBodies: unknown[] = [];

  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentResources) });
  });
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentReadiness) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });
  await page.route("**/api/v1/settings/workspace", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          settings: { intakeMailbox: selectedMailbox },
          intakeMailboxOptions: [primary, secondary],
          updatedAt: 1,
        }),
      });
      return;
    }
    const body = route.request().postDataJSON() as { intakeMailbox: string };
    patchBodies.push(body);
    selectedMailbox = body.intakeMailbox;
    currentReadiness = {
      ...readiness(),
      missing: [missingInvariant],
      missingDetails: [{
        label: missingInvariant,
        envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX",
        secret: false,
      }],
    };
    currentResources = workspaceResources({
      connectReady: true,
      identity: {
        ...workspaceResources().identity,
        intakeMailboxMatches: false,
      },
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        settings: { intakeMailbox: selectedMailbox },
        intakeMailboxOptions: [primary, secondary],
        updatedAt: 2,
      }),
    });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 1, true);
  const selector = page.getByLabel("Gmail intake mailbox");
  await expect(selector).toHaveValue(primary);
  await expect(selector.locator("option")).toHaveCount(3);
  await selector.selectOption(secondary);
  await page.getByRole("button", { name: "Save mailbox" }).click();

  expect(patchBodies).toEqual([{ intakeMailbox: secondary }]);
  await expect(selector).toHaveValue(secondary);
  await expect(page.getByText(missingInvariant, { exact: true })).toBeVisible();
  await expect(tenantChecklistRow(page, "Operations account").getByText("MISSING", { exact: true })).toBeVisible();
});

test("the status banner waits for every source and resolves a mixed-mode all-connected response conservatively", async ({ page }) => {
  let releaseConnection: (() => void) | undefined;
  let markConnectionRequested: (() => void) | undefined;
  const connectionGate = new Promise<void>((resolve) => { releaseConnection = resolve; });
  const connectionRequested = new Promise<void>((resolve) => { markConnectionRequested = resolve; });
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, workspaceResources());
  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    markConnectionRequested?.();
    await connectionGate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(connectedHealth()) });
  });
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readiness({ runtimeMode: "simulation", simulation: true })),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await connectionRequested;
  const banner = page.locator(".workspace-status-banner");
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText("Checking current status…");
  await expect(banner.locator(".workspace-status-mode")).toHaveText("CHECKING");
  await expect(banner.locator(".workspace-status-mode")).not.toHaveText(/SIMULATION|WORKSPACE/);
  await expect(banner.locator(".workspace-status-mode")).toHaveClass(/statusModeNeutral/);
  await expect(banner.locator(".workspace-status-progress")).toContainText("Stage status pending");
  await expect(banner.locator(".workspace-status-progress")).not.toContainText(/Stage [1-4] of 4/);
  await expectNeutralStageChips(page, "CHECKING");
  await expect(page.locator(".workspace-mode-card")).toHaveCount(0);
  if (await stageToggle(page, 1).getAttribute("aria-expanded") !== "true") await stageToggle(page, 1).click();
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "true");
  await expect(setupStage(page, 1).locator(".workspace-stage-body")).toBeVisible();
  const loadingChecklist = setupStage(page, 1).locator(".workspace-prerequisites");
  await expect(loadingChecklist.getByText("DONE", { exact: true })).toHaveCount(6);
  await expect(loadingChecklist.getByText("MISSING", { exact: true })).toHaveCount(0);
  await expect(loadingChecklist.getByText("Drive authority:", { exact: true })).toHaveCount(0);
  await expect(loadingChecklist.getByRole("heading", { level: 4, name: "App-managed Workspace configuration" })).toBeVisible();
  await expect(loadingChecklist.getByText("Project-folder provisioning", { exact: true })).toBeVisible();
  await expect(loadingChecklist.getByText("Client Directory spreadsheet ID", { exact: true })).toBeVisible();
  await expect(loadingChecklist.getByText("Lead-form response spreadsheet ID", { exact: true })).toBeVisible();
  await expect(loadingChecklist.getByText("Source: Simulation fixture (always enabled)", { exact: true })).toBeVisible();
  await expect(loadingChecklist.getByText("Gmail intake mailbox", { exact: true })).toBeVisible();
  await expect(loadingChecklist.getByText("Source: None", { exact: true })).toHaveCount(3);
  await expect(loadingChecklist.getByText("current mirror source:", { exact: false })).toHaveCount(0);

  releaseConnection?.();
  await expect(banner.locator(".workspace-status-mode")).toHaveText("WORKSPACE");
  await expect(banner).toHaveAttribute("data-status-agreement", "conservative");
  await expect(banner).toContainText("Ready to connect Google");
  await expect(banner).toContainText("Next: connect the company account in Stage 2");
  await expect(banner.locator(".workspace-status-progress")).toContainText("Stage 2 of 4");
  await expect(banner.locator(".workspace-status-progress")).toContainText("Connect");
  await expect(setupStage(page, 1).locator(".workspace-stage-chip")).toHaveText("DONE");
  await expect(setupStage(page, 1).locator(".workspace-stage-chip")).not.toHaveClass(/stageChipNeutral/);
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText("IN PROGRESS");
  await expect(stageToggle(page, 2)).toHaveAttribute("aria-expanded", "true");
  await expect(banner).not.toContainText("Simulation ready");
  await expect(banner).not.toContainText("Connected as");
  await expect(page.getByText("Company Google Workspace", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sample data only · no Google account connected · nothing is sent to Google", { exact: true })).toHaveCount(0);
  await expect(page.getByText("One administrator-approved organization connection", { exact: true })).toHaveCount(0);
});

test("mixed-mode Stage 1 rendering follows readiness simulation instead of the banner consensus", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, workspaceResources({ connectReady: false }));
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readiness({ runtimeMode: "simulation", simulation: true })),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await waitForStageShellToSettle(page);

  const banner = page.locator(".workspace-status-banner");
  await expect(banner.locator(".workspace-status-mode")).toHaveText("WORKSPACE");
  await expect(banner).toHaveAttribute("data-status-agreement", "conservative");
  await expect(setupStage(page, 1).locator(".workspace-stage-chip")).toHaveText("IN PROGRESS · 6 of 6");
  const checklist = setupStage(page, 1).locator(".workspace-prerequisites");
  await expect(checklist.getByText("DONE", { exact: true })).toHaveCount(6);
  await expect(checklist.getByText("MISSING", { exact: true })).toHaveCount(0);
  await expect(checklist.getByText("Drive authority:", { exact: true })).toHaveCount(0);
  await expect(checklist.getByRole("heading", { level: 4, name: "App-managed Workspace configuration" })).toBeVisible();
  await expect(checklist.getByText("Project-folder provisioning", { exact: true })).toBeVisible();
  await expect(checklist.getByText("Client Directory spreadsheet ID", { exact: true })).toBeVisible();
  await expect(checklist.getByText("Lead-form response spreadsheet ID", { exact: true })).toBeVisible();
  await expect(checklist.getByText("Source: Simulation fixture (always enabled)", { exact: true })).toBeVisible();
  await expect(checklist.getByText("Gmail intake mailbox", { exact: true })).toBeVisible();
  await expect(checklist.getByText("Source: None", { exact: true })).toHaveCount(3);
  await expect(checklist.getByText("current mirror source:", { exact: false })).toHaveCount(0);
});

test("stages derive one open step from endpoint state and keep completed stages manually expandable", async ({ page }) => {
  let currentReadiness = readiness({
    storageConfigured: false,
    connectionStatus: "not-connected",
    connectionAccount: null,
    driveConnected: false,
    gmailConnected: false,
    calendarConnected: false,
    sheetsConnected: false,
  });
  currentReadiness.credentialsPresent = true;
  currentReadiness.missingDetails = [
    { label: "Allowed Workspace domains", envVar: "GOOGLE_WORKSPACE_ALLOWED_DOMAINS", secret: false },
  ];
  currentReadiness.missing = currentReadiness.missingDetails.map((detail) => detail.label);
  let currentHealth: ConnectionHealthPayload = {
    ...connectedHealth(),
    connection: {
      ...connectedHealth().connection,
      connected: false,
      status: "not-connected",
      account: null,
      grantedServices: null,
    },
  };
  const incompleteResourceRows: WorkspaceResourcesPayload["resources"] = workspaceResources().resources.map((resource) => {
    if (resource.resourceType === "drive.shared-drive") return { ...resource, source: "app", origin: "adopted", state: "Adopted", externalId: "drive-id" };
    if (resource.resourceType === "sheets.spreadsheet") return { ...resource, source: "none", origin: undefined, state: "Not configured", externalId: undefined };
    return resource;
  });
  let currentResources = workspaceResources({
    connectReady: false,
    resources: incompleteResourceRows,
    identity: { connectionAccount: null, intakeMailboxMatches: null, allowedDomains: [], mode: "workspace" },
  });

  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentResources) });
  });
  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentHealth) });
  });
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentReadiness) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await expect(page.locator(".workspace-stage-list")).toHaveAttribute("aria-label", "Google Workspace setup stages");
  await expect(page.locator(".workspace-setup-stage")).toHaveCount(4);
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "true");
  for (const number of [2, 3, 4] as const) await expect(stageToggle(page, number)).toHaveAttribute("aria-expanded", "false");
  await expect(setupStage(page, 1).locator(".workspace-stage-chip")).toHaveText("IN PROGRESS · 3 of 6");
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText("WAITING ON STAGE 1");

  currentReadiness = readiness({
    connectionStatus: "not-connected",
    connectionAccount: null,
    driveConnected: false,
    gmailConnected: false,
    calendarConnected: false,
    sheetsConnected: false,
  });
  currentResources = workspaceResources({
    connectReady: false,
    resources: incompleteResourceRows,
    identity: {
      connectionAccount: "operations@cherryhillfci.com",
      intakeMailboxMatches: true,
      allowedDomains: ["cherryhillfci.com"],
      mode: "workspace",
    },
  });
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(setupStage(page, 1).locator(".workspace-stage-chip")).toHaveText("IN PROGRESS · 4 of 6");
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "true");
  await expect(stageToggle(page, 2)).toHaveAttribute("aria-expanded", "false");

  currentResources = { ...currentResources, connectReady: true };
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(setupStage(page, 1).locator(".workspace-stage-chip")).toHaveText("DONE");
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "false");
  await expect(stageToggle(page, 2)).toHaveAttribute("aria-expanded", "true");
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText(/^IN PROGRESS/);

  currentReadiness = readiness();
  currentHealth = connectedHealth();
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText("DONE");
  await expect(stageToggle(page, 2)).toHaveAttribute("aria-expanded", "false");
  await expect(stageToggle(page, 3)).toHaveAttribute("aria-expanded", "true");
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText(/^IN PROGRESS/);

  currentResources = workspaceResources({
    connectReady: true,
    resources: incompleteResourceRows.map((resource) => resource.resourceType === "calendar.calendar" ? resource : {
      ...resource,
      source: "app",
      origin: resource.resourceType === "drive.shared-drive" ? "adopted" : "created",
      state: resource.resourceType === "drive.shared-drive" ? "Adopted" : "Created",
      externalId: resource.externalId ?? `${resource.key}-id`,
    }),
  });
  await triggerAutomaticWorkspaceRefresh(page, "/api/v1/integrations/google/setup/resources");
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");
  await expect(stageToggle(page, 3)).toHaveAttribute("aria-expanded", "false");
  await expect(stageToggle(page, 4)).toHaveAttribute("aria-expanded", "true");

  await setStageExpanded(page, 1, true);
  await expect(setupStage(page, 1).locator(".workspace-prerequisites")).toBeVisible();
  await page.reload();
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "false");
  await expect(stageToggle(page, 4)).toHaveAttribute("aria-expanded", "true");

  await expect(setupStage(page, 1).locator(".workspace-prerequisites")).toHaveCount(1);
  await expect(setupStage(page, 2).locator("details.workspace-connection-health")).toHaveCount(1);
  await expect(setupStage(page, 2).locator("section.workspace-connection-health")).toHaveCount(0);
  await expect(setupStage(page, 2).locator("#workspace-connection-actions-heading")).toHaveCount(1);
  await expect(setupStage(page, 3).locator(".workspace-blueprint-card")).toHaveCount(1);
  await expect(creationCard(page)).toHaveCount(1);
  await expect(creationCard(page).locator("[data-workspace-creation-row]")).toHaveCount(5);
  await expect(setupStage(page, 3).locator(".workspace-setup-step")).toHaveCount(0);
  await expect(setupStage(page, 4).locator("[data-stage-four-verification]")).toHaveCount(3);
  await expect(verificationRow(page, "gmail").getByRole("heading", { name: "Gmail — labels & test email", exact: true })).toBeVisible();
  await expect(verificationRow(page, "calendar").getByRole("heading", { name: "Calendar — appointments & test hold", exact: true })).toBeVisible();
  await expect(verificationRow(page, "sheets").getByRole("heading", { name: "Sheets — mirror sync", exact: true })).toBeVisible();
  await expect(setupStage(page, 4).getByRole("heading", { name: "Ongoing upkeep", exact: true })).toBeVisible();
});

test("stage anchors open completed targets and survive hash navigation history", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, completedWorkspaceResources());
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  const expectTargetOpen = async (number: WorkspaceStageNumber) => {
    await expect(page).toHaveURL(new RegExp(`#workspace-stage-${number}$`));
    const stage = setupStage(page, number);
    await expect(stage).toHaveAttribute("id", `workspace-stage-${number}`);
    await expect(stageToggle(page, number)).toHaveAttribute("aria-expanded", "true");
    await expect(stage.locator(".workspace-stage-body")).toBeVisible();
    const stageTop = await stage.evaluate((element) => element.getBoundingClientRect().top);
    expect(stageTop).toBeGreaterThanOrEqual(85);
    expect(stageTop).toBeLessThanOrEqual(88);
  };

  await page.goto("/settings?section=google-workspace#workspace-stage-1");
  await expectTargetOpen(1);
  await expect(setupStage(page, 1).locator(".workspace-stage-chip")).toHaveText("DONE");

  await page.evaluate(() => {
    window.location.hash = "#workspace-stage-2";
  });
  await expectTargetOpen(2);
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText("DONE");
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "false");

  await page.goBack();
  await expectTargetOpen(1);
  await expect(stageToggle(page, 2)).toHaveAttribute("aria-expanded", "false");

  await page.goto("/settings?section=google-workspace#workspace-stage-3");
  await expectTargetOpen(3);
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  await expectTargetOpen(4);
  await stageToggle(page, 1).click();
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  const stageFourAfterManualExpansion = await setupStage(page, 4).evaluate((element) => element.getBoundingClientRect().top);
  expect(stageFourAfterManualExpansion).toBeGreaterThan(500);
});

test("Client Directory and Testing launch bounce links land on their exact setup stages", async ({ page }) => {
  const expectStageAtSetupAnchor = async (number: WorkspaceStageNumber) => {
    await expect.poll(async () => {
      const top = await setupStage(page, number).evaluate((element) => element.getBoundingClientRect().top);
      return top >= 85 && top <= 88;
    }, { message: `Stage ${number} should settle at the setup anchor` }).toBe(true);
  };
  const unavailableMirror = {
    ...unsyncedMirror(),
    configured: false,
    enabled: false,
    connected: false,
    reason: "Google Sheets setup is required for this test.",
  };
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unavailableMirror }) });
  });

  await page.goto("/settings?section=client-directory");
  const directoryLink = page.getByRole("link", { name: "Open Google Workspace setup", exact: true });
  await expect(directoryLink).toHaveAttribute("href", "/settings?section=google-workspace#workspace-stage-3");
  await directoryLink.click();
  await expect(page).toHaveURL(/\/settings\?section=google-workspace#workspace-stage-3$/);
  await expect(stageToggle(page, 3)).toHaveAttribute("aria-expanded", "true");
  await waitForStageShellToSettle(page);
  await expectStageAtSetupAnchor(3);

  await page.goto("/settings?section=testing-launch");
  const testingLink = page.getByRole("link", { name: "Open Google Workspace setup", exact: true });
  await expect(testingLink).toHaveAttribute("href", "/settings?section=google-workspace#workspace-stage-4");
  await testingLink.click();
  await expect(page).toHaveURL(/\/settings\?section=google-workspace#workspace-stage-4$/);
  await expect(stageToggle(page, 4)).toHaveAttribute("aria-expanded", "true");
  await waitForStageShellToSettle(page);
  await expectStageAtSetupAnchor(4);
});

test("Stage 4 keeps normative copy, polished mirror labels, and operational upkeep routes", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, completedWorkspaceResources());
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  const mirror = unsyncedMirror();
  mirror.clients.status = "syncing";
  mirror.projects.status = "pending";
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 4, true);

  for (const expected of [
    {
      key: "gmail" as const,
      label: "Gmail — labels & test email",
      info: "Creates the three FCI labels and sends one test email to yourself to confirm filing works. Nothing is ever sent to clients from here.",
    },
    {
      key: "calendar" as const,
      label: "Calendar — appointments & test hold",
      info: "Reads the upcoming appointments window and can create one private test hold with no invitations — confirm access without touching anyone's calendar.",
    },
    {
      key: "sheets" as const,
      label: "Sheets — mirror sync",
      info: "Runs one sync of the Client Directory and Project Register mirrors and reports exactly what changed.",
    },
  ]) {
    const row = verificationRow(page, expected.key);
    await expect(row.getByRole("heading", { name: expected.label, exact: true })).toBeVisible();
    const hint = row.getByRole("button", { name: `About ${expected.label}`, exact: true });
    const descriptionId = await hint.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    await hint.focus();
    await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText(expected.info);
    await page.keyboard.press("Escape");
  }

  const sheets = verificationRow(page, "sheets");
  await expect(sheets.getByText("Syncing", { exact: true })).toHaveCount(1);
  await expect(sheets.getByText("Not synced", { exact: true })).toHaveCount(1);
  await expect(sheets.getByText("syncing", { exact: true })).toHaveCount(0);
  await expect(sheets.getByText("pending", { exact: true })).toHaveCount(0);

  await expect(setupStage(page, 4).getByRole("heading", { name: "Ongoing upkeep", exact: true })).toBeVisible();
  await expect(setupStage(page, 4).getByText("Tools you'll come back to — these never block setup.", { exact: true })).toBeVisible();
  for (const [key, label] of [
    ["drift", "Drift check"],
    ["renames", "Renames"],
    ["notifications", "Notification routing"],
  ] as const) {
    const row = upkeepRow(page, key);
    await expect(row.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: `About ${label}`, exact: true })).toHaveCount(1);
  }
  const drift = upkeepRow(page, "drift");
  await expect(drift).toHaveAttribute("data-stage-four-upkeep-state", "AVAILABLE");
  await expect(drift.getByText("Check Google against the saved blueprint. The check reads provider metadata only; every repair waits for your click, and removed resources stay in Google.", { exact: true })).toBeVisible();
  await expect(drift.locator("button, a")).toHaveCount(2);
  await expect(drift.getByRole("button", { name: "About Drift check", exact: true })).toHaveCount(1);
  await expect(drift.getByRole("button", { name: "Check for drift", exact: true })).toBeEnabled();
  await expect(drift.getByRole("link")).toHaveCount(0);
  await expect(verificationRow(page, "gmail").getByText("Gmail verification", { exact: true })).toBeVisible();
  await expect(verificationRow(page, "calendar").getByText("Calendar verification", { exact: true })).toBeVisible();
  await expect(setupStage(page, 4).getByText(/^(?:Simulated )?Workspace Gmail$|^(?:Simulated |Workspace )shared calendars$/)).toHaveCount(0);
  const notifications = upkeepRow(page, "notifications");
  const notificationBody = "Review the closed event-to-space map. Hosted webhook secrets stay outside the browser, application data, logs, and source control.";
  await expect(notifications.getByText(notificationBody, { exact: true })).toHaveCount(1);
  const notificationHint = notifications.getByRole("button", { name: "About Notification routing", exact: true });
  const notificationHintId = await notificationHint.getAttribute("aria-describedby");
  expect(notificationHintId).toBeTruthy();
  await notificationHint.focus();
  await expect(page.locator(`[id="${notificationHintId}"]`)).toHaveText("Choose which supported events can notify each approved Google Chat space. The routing page shows what is available before anything is enabled.");
  await expect(page.locator(`[id="${notificationHintId}"]`)).not.toHaveText(notificationBody);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  const stageFour = setupStage(page, 4);
  const renameDetails = upkeepRow(page, "renames").locator("details");
  await renameDetails.locator("summary").click();
  await expect(renameDetails).toHaveAttribute("open", "");
  await renameDetails.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(renameDetails.getByRole("textbox", { name: "New name for 01_Client Accounts", exact: true })).toBeVisible();
  expect(await stageFour.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const stageFourBox = await stageFour.boundingBox();
  expect(stageFourBox).not.toBeNull();
  const stageFourControls = await stageFour.locator("button:visible, a:visible, summary:visible, input:visible, select:visible").all();
  for (const control of stageFourControls) {
    const box = await control.boundingBox();
    const controlName = await control.getAttribute("aria-label") ?? await control.textContent() ?? "Stage 4 control";
    expect(box?.height ?? 0, controlName).toBeGreaterThanOrEqual(44);
    expect(box?.x ?? 0, controlName).toBeGreaterThanOrEqual((stageFourBox?.x ?? 0) - 1);
    expect((box?.x ?? 0) + (box?.width ?? 0), controlName).toBeLessThanOrEqual((stageFourBox?.x ?? 0) + (stageFourBox?.width ?? 0) + 1);
  }
  const wrappedActionButtons = await stageFour.locator(".workspace-actions > .administrator-action-control > button:visible").all();
  for (const button of wrappedActionButtons) {
    const [buttonBox, wrapperBox] = await Promise.all([button.boundingBox(), button.locator("xpath=..").boundingBox()]);
    expect(Math.abs((buttonBox?.width ?? 0) - (wrapperBox?.width ?? 0)), await button.textContent() ?? "Administrator action").toBeLessThanOrEqual(1);
  }

  const notificationLink = upkeepRow(page, "notifications").getByRole("link", { name: "Open notification routing", exact: true });
  await expect(notificationLink).toHaveAttribute("href", "/settings?section=workflow-notifications");
  await notificationLink.click();
  await expect(page).toHaveURL(/\/settings\?section=workflow-notifications$/);
  await expect(page.getByRole("heading", { level: 2, name: "Google Chat notifications", exact: true })).toBeVisible();
  await expect(page.getByText("Review the closed event-to-space map. Hosted webhook secrets stay outside the browser, application data, logs, and source control.", { exact: true })).toBeVisible();
});

test("Stage 4 disabled verification actions are described by their actual dependency", async ({ page }) => {
  let currentReadiness = readiness({
    storageConfigured: false,
    driveConnected: false,
  });
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, completedWorkspaceResources());
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentReadiness) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });
  await mockStageFourVerificationStatus(page);

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  await setStageExpanded(page, 4, true);

  const gmail = verificationRow(page, "gmail");
  const gmailReason = gmail.getByText("Blocked until the prior step is complete", { exact: true });
  await expect(gmailReason).toHaveAttribute("id", "workspace-verification-gmail-dependency");
  for (const name of ["Prepare FCI labels", "View inbox", "Send Workspace test"]) {
    const control = gmail.getByRole("button", { name, exact: true });
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute("aria-describedby", "workspace-verification-gmail-dependency");
  }

  const calendar = verificationRow(page, "calendar");
  const calendarReason = calendar.getByText("Blocked until Gmail setup is complete", { exact: true });
  await expect(calendarReason).toHaveAttribute("id", "workspace-verification-calendar-dependency");
  for (const name of ["View upcoming events", "Create test hold"]) {
    const control = calendar.getByRole("button", { name, exact: true });
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute("aria-describedby", "workspace-verification-calendar-dependency");
  }

  currentReadiness = readiness();
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(gmail.getByText("Ready for explicit actions", { exact: true })).not.toHaveAttribute("id");
  for (const name of ["Prepare FCI labels", "View inbox", "Send Workspace test"]) {
    const control = gmail.getByRole("button", { name, exact: true });
    await expect(control).toBeEnabled();
    await expect(control).not.toHaveAttribute("aria-describedby");
  }
});

test("Operations health enumerates recorded simulation failures and activity without repair actions", async ({ page }) => {
  await mockReadyWorkspaceForStageThree(page);
  let operationsReads = 0;
  await page.route("**/api/v1/integrations/google/operations", async (route) => {
    expect(route.request().method()).toBe("GET");
    operationsReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runtimeMode: "simulation",
        simulation: true,
        checkedAt: Date.UTC(2026, 6, 30, 12),
        limits: { perCategory: 50 },
        driveOperations: {
          items: [
            {
              id: "drive-stuck",
              operationKey: "project:stuck",
              projectId: "project-1",
              condition: "stuck",
              status: "in-progress",
              leaseExpiresAt: Date.UTC(2026, 6, 30, 11, 55),
              lastErrorCode: null,
              updatedAt: Date.UTC(2026, 6, 30, 11, 54),
            },
            {
              id: "drive-failed",
              operationKey: "project:failed",
              projectId: "project-2",
              condition: "failed",
              status: "failed",
              leaseExpiresAt: null,
              lastErrorCode: "drive_write_failed",
              updatedAt: Date.UTC(2026, 6, 30, 11, 53),
            },
          ],
          hasMore: false,
        },
        failedArchives: {
          items: [{
            id: "archive-failed",
            gmailMessageId: "gmail-message-1",
            projectId: "project-3",
            status: "failed",
            lastErrorCode: "gmail_copy_failed",
            updatedAt: Date.UTC(2026, 6, 30, 11, 52),
          }],
          hasMore: false,
        },
        events: {
          items: [{
            id: "event-1",
            eventType: "gmail.archive_failed",
            actor: "admin@example.test",
            entityType: "project",
            entityId: "project-3",
            detail: "mode=simulation;code=gmail_copy_failed",
            createdAt: Date.UTC(2026, 6, 30, 11, 52),
          }],
          hasMore: false,
        },
      }),
    });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 4, true);
  const row = upkeepRow(page, "operations-health");
  await expect(row).toHaveAttribute("data-stage-four-upkeep-state", "AVAILABLE");
  await expect(row.getByText("Simulation only — these are locally recorded test operations and no Google call is made.", { exact: true })).toBeVisible();
  await expect(row.getByText("Stuck Drive lease", { exact: true })).toBeVisible();
  await expect(row.getByText("Failed Drive operation", { exact: true })).toBeVisible();
  await expect(row.getByText("Failed Gmail archive", { exact: true })).toBeVisible();
  await expect(row.getByText("Gmail Archive Failed", { exact: true })).toBeVisible();
  await expect(row.getByText("mode=simulation;code=gmail_copy_failed", { exact: true })).toBeVisible();
  await expect(row.getByText("wait out the five-minute lease", { exact: false })).toBeVisible();
  await expect(row.getByText("retry only through the original app action", { exact: false })).toBeVisible();
  await expect(row.getByRole("button", { name: "Refresh operations", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /delete|repair|clear lease/i })).toHaveCount(0);
  expect(operationsReads).toBe(1);
  await triggerAutomaticWorkspaceRefresh(page);
  await expect.poll(() => operationsReads).toBe(2);
});

test("Operations health lets a terminal trailing refresh supersede a delayed page replay", async ({ page }) => {
  await mockReadyWorkspaceForStageThree(page);
  let baseReads = 0;
  let releaseReplay = () => undefined;
  let markReplayStarted = () => undefined;
  const replayGate = new Promise<void>((resolve) => {
    releaseReplay = resolve;
  });
  const replayStarted = new Promise<void>((resolve) => {
    markReplayStarted = resolve;
  });

  await page.route("**/api/v1/integrations/google/operations**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    const category = url.searchParams.get("category");
    const cursor = url.searchParams.get("cursor");
    if (category === "events" && cursor === "initial-more") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(operationsHealthPayload("Initial extra row")) });
      return;
    }
    if (category === "events" && cursor === "delayed-replay") {
      markReplayStarted();
      await replayGate;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(operationsHealthPayload("Stale delayed row")) });
      return;
    }
    expect(category).toBeNull();
    baseReads += 1;
    if (baseReads === 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(operationsHealthPayload("Initial base row", "initial-more")) });
      return;
    }
    if (baseReads === 2) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(operationsHealthPayload("Fresh base awaiting replay", "delayed-replay")) });
      return;
    }
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Administrator access expired." }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 4, true);
  const row = upkeepRow(page, "operations-health");
  await row.getByRole("button", { name: "Load more events", exact: true }).click();
  await expect(row.getByText("Initial extra row", { exact: true })).toBeVisible();

  const firstRefresh = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/integrations/google/operations"
      && !url.search
      && response.status() === 200;
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await firstRefresh;
  await replayStarted;

  let staleReplayResponse: Promise<unknown> | undefined;
  try {
    // The global lifecycle census has completed by the time its base response
    // has notified the card; let its promise settle while replay remains held.
    await page.waitForTimeout(50);
    const terminalRefresh = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/integrations/google/operations"
        && !url.search
        && response.status() === 403;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await terminalRefresh;

    await expect(row.getByText("Recorded Google operations could not be loaded", { exact: true })).toBeVisible();
    await expect(row.getByText("Initial base row", { exact: true })).toHaveCount(0);
    await expect(row.getByText("Initial extra row", { exact: true })).toHaveCount(0);
    staleReplayResponse = page.waitForResponse((response) => (
      new URL(response.url()).searchParams.get("cursor") === "delayed-replay"
    ));
  } finally {
    // Never leave the mocked request unresolved when an assertion fails.
    releaseReplay();
  }
  await staleReplayResponse;
  await expect(row.getByText("Stale delayed row", { exact: true })).toHaveCount(0);
});

test("Operations health replay failure Retry restarts base reconciliation from fresh cursors", async ({ page }) => {
  await mockReadyWorkspaceForStageThree(page);
  let baseReads = 0;
  const categoryCursors: string[] = [];
  await page.route("**/api/v1/integrations/google/operations**", async (route) => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    const category = url.searchParams.get("category");
    const cursor = url.searchParams.get("cursor");
    if (category === "events") {
      expect(cursor).not.toBeNull();
      categoryCursors.push(cursor ?? "");
      if (cursor === "initial-page-two") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(operationsHealthPayload("Initial page two")) });
        return;
      }
      if (cursor === "failed-refresh-page-two") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Replay temporarily unavailable." }) });
        return;
      }
      expect(cursor).toBe("recovered-page-two");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(operationsHealthPayload("Recovered page two")) });
      return;
    }

    baseReads += 1;
    const payload = baseReads === 1
      ? operationsHealthPayload("Initial page one", "initial-page-two")
      : baseReads === 2
        ? operationsHealthPayload("Failed refresh page one", "failed-refresh-page-two")
        : operationsHealthPayload("Recovered page one", "recovered-page-two");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 4, true);
  const row = upkeepRow(page, "operations-health");
  await row.getByRole("button", { name: "Load more events", exact: true }).click();
  await expect(row.getByText("Initial page two", { exact: true })).toBeVisible();

  const replayFailure = page.waitForResponse((response) => (
    new URL(response.url()).searchParams.get("cursor") === "failed-refresh-page-two"
  ));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await replayFailure;
  await expect(row.getByText("Replay temporarily unavailable.", { exact: true })).toBeVisible();

  const recoveredBase = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/integrations/google/operations" && !url.search;
  });
  const recoveredReplay = page.waitForResponse((response) => (
    new URL(response.url()).searchParams.get("cursor") === "recovered-page-two"
  ));
  await row.getByRole("button", { name: "Retry", exact: true }).click();
  await Promise.all([recoveredBase, recoveredReplay]);

  await expect(row.getByText("Recovered page one", { exact: true })).toBeVisible();
  await expect(row.getByText("Recovered page two", { exact: true })).toBeVisible();
  await expect(row.getByText("Initial page one", { exact: true })).toHaveCount(0);
  await expect(row.getByText("Initial page two", { exact: true })).toHaveCount(0);
  expect(categoryCursors).toEqual([
    "initial-page-two",
    "failed-refresh-page-two",
    "recovered-page-two",
  ]);
});

test("InfoHint opens on keyboard focus and hover and Escape dismisses it", async ({ page }) => {
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await waitForStageShellToSettle(page);
  const hint = page.getByRole("button", { name: "About Stage 1 status", exact: true });
  const descriptionId = await hint.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  const tooltip = page.locator(`[id="${descriptionId}"]`);
  await expect(tooltip).toHaveAttribute("role", "tooltip");
  await expect(tooltip).toBeHidden();

  await stageToggle(page, 1).focus();
  await page.keyboard.press("Tab");
  await expect(hint).toBeFocused();
  await expect(hint).toHaveAttribute("aria-expanded", "true");
  await expect(hint.locator("xpath=..")).toHaveClass(/\bopen\b/);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(hint).toBeFocused();

  await hint.blur();
  await hint.hover();
  await expect(tooltip).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();

  const describedIds = await page.locator(".info-hint-trigger").evaluateAll((triggers) => triggers.map((trigger) => trigger.getAttribute("aria-describedby")));
  // Four stage headers + six tenant rows + five creation rows + three
  // verification rows + four ongoing rows + two blueprint naming fields
  // are all mounted in this state.
  expect(describedIds).toHaveLength(24);
  const formsAuditBlueprintHints = await stageThreeSubsection(page, "blueprint")
    .locator(".info-hint-trigger")
    .count();
  const postAuditOperationsHealthHints = await upkeepRow(page, "operations-health")
    .locator(".info-hint-trigger")
    .count();
  expect(formsAuditBlueprintHints).toBe(2);
  expect(postAuditOperationsHealthHints).toBe(1);
  expect(describedIds.length - formsAuditBlueprintHints - postAuditOperationsHealthHints).toBe(21);
  expect(describedIds.every(Boolean)).toBe(true);
  expect(new Set(describedIds).size).toBe(describedIds.length);
  const tooltipText = await page.locator(".info-hint-tooltip").allTextContents();
  for (const text of tooltipText) expect(text).not.toMatch(/GOOGLE_[A-Z0-9_]+\s*=|<secret>|token value/i);
});

test.describe("Workspace stage hints on touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("InfoHint toggles by tap without overflowing the stage shell", async ({ page }) => {
    await mockConnectionHealth(page, connectedHealth());
    await page.route("**/api/v1/google-workspace", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
    });
    await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
    });

    await page.goto("/settings?section=google-workspace");
    await waitForStageShellToSettle(page);
    const banner = page.locator(".workspace-status-banner");
    const [modeBox, copyBox, progressBox] = await Promise.all([
      banner.locator(".workspace-status-mode").boundingBox(),
      banner.locator(".workspace-status-copy").boundingBox(),
      banner.locator(".workspace-status-progress").boundingBox(),
    ]);
    const modeAndCopyOverlap = Math.min(
      (modeBox?.y ?? 0) + (modeBox?.height ?? 0),
      (copyBox?.y ?? 0) + (copyBox?.height ?? 0),
    ) - Math.max(modeBox?.y ?? 0, copyBox?.y ?? 0);
    expect(modeAndCopyOverlap).toBeGreaterThan(0);
    expect(progressBox?.y ?? 0).toBeGreaterThan((modeBox?.y ?? 0) + (modeBox?.height ?? 0) - 1);
    expect(progressBox?.y ?? 0).toBeGreaterThan((copyBox?.y ?? 0) + (copyBox?.height ?? 0) - 1);

    const stageListBox = await page.locator(".workspace-stage-list").boundingBox();
    expect(stageListBox).not.toBeNull();
    for (const number of [1, 2, 3, 4] as const) {
      const stageBox = await setupStage(page, number).boundingBox();
      expect(stageBox).not.toBeNull();
      expect(Math.abs((stageBox?.x ?? 0) - (stageListBox?.x ?? 0)), `Stage ${number} left alignment`).toBeLessThanOrEqual(1);
      expect(Math.abs((stageBox?.width ?? 0) - (stageListBox?.width ?? 0)), `Stage ${number} full width`).toBeLessThanOrEqual(1);
      await setStageExpanded(page, number, true);
      const hint = page.getByRole("button", { name: `About Stage ${number} status`, exact: true });
      const descriptionId = await hint.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      const tooltip = page.locator(`[id="${descriptionId}"]`);
      await hint.tap();
      await expect(tooltip).toBeVisible();
      await expect(hint).toHaveAttribute("aria-expanded", "true");
      if (number === 1) {
        const tooltipBox = await tooltip.boundingBox();
        expect(tooltipBox).not.toBeNull();
        const leftInset = (tooltipBox?.x ?? 0) - (stageBox?.x ?? 0);
        const rightInset = ((stageBox?.x ?? 0) + (stageBox?.width ?? 0))
          - ((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0));
        expect(leftInset).toBeGreaterThanOrEqual(12);
        expect(leftInset).toBeLessThanOrEqual(13);
        expect(rightInset).toBeGreaterThanOrEqual(12);
        expect(rightInset).toBeLessThanOrEqual(13);
        await hint.tap();
        await expect(tooltip).toBeHidden();
        await expect(hint).toHaveAttribute("aria-expanded", "false");
        await hint.tap();
        await expect(tooltip).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(tooltip).toBeHidden();
      await expect(hint).toHaveAttribute("aria-expanded", "false");
    }

    await setStageExpanded(page, 3, true);
    const templateHint = creationRow(page, "templates").getByRole("button", { name: "About Templates", exact: true });
    const templateDescriptionId = await templateHint.getAttribute("aria-describedby");
    expect(templateDescriptionId).toBeTruthy();
    await templateHint.tap();
    await expect(page.locator(`[id="${templateDescriptionId}"]`)).toHaveText("Starter documents — estimate, work order, change order, checklist, budget — placed in your Templates folder. Edit their content in Google; the app only creates them.");
    await expect(page.locator(`[id="${templateDescriptionId}"]`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(`[id="${templateDescriptionId}"]`)).toBeHidden();
    const compactPanes = setupStage(page, 3).locator("[data-stage-three-pane]");
    await expect(compactPanes).toHaveCount(2);
    expect(await compactPanes.evaluateAll((panes) => panes.map((pane) => pane.getAttribute("data-stage-three-pane"))))
      .toEqual(["creation", "blueprint"]);
    const compactGeometry = await compactPanes.evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().top));
    expect(compactGeometry[0]).toBeLessThan(compactGeometry[1]);
    const firstFocusablePane = await compactPanes.first().locator("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), summary").first();
    await expect(firstFocusablePane).toBeVisible();
    expect(await firstFocusablePane.evaluate((element) => element.closest("[data-stage-three-pane]")?.getAttribute("data-stage-three-pane")))
      .toBe("creation");
    const visibleHintTargets = await page.locator(".info-hint-trigger:visible").evaluateAll((triggers) => (
      triggers.map((trigger) => {
        const rect = trigger.getBoundingClientRect();
        return {
          label: trigger.getAttribute("aria-label"),
          width: rect.width,
          height: rect.height,
        };
      })
    ));
    expect(visibleHintTargets.length).toBeGreaterThanOrEqual(10);
    for (const target of visibleHintTargets) {
      expect(target.width, `${target.label} width`).toBeGreaterThanOrEqual(44);
      expect(target.height, `${target.label} height`).toBeGreaterThanOrEqual(44);
    }
    const creationTargets = [
      creationRow(page, "folder-tree").getByRole("button", { name: "Ensure root folders" }),
      creationRow(page, "folder-tree").locator("details > summary"),
      creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" }),
      creationRow(page, "templates").getByRole("button", { name: "Ensure templates" }),
    ];
    for (const target of creationTargets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const stageOverflow = await page.locator(".workspace-stage-list").evaluate((element) => {
      const listRect = element.getBoundingClientRect();
      const overflowing = Array.from(element.querySelectorAll<HTMLElement>("*"))
        .map((descendant) => {
          const rect = descendant.getBoundingClientRect();
          return {
            selector: `${descendant.tagName.toLowerCase()}.${descendant.className}`,
            left: Math.round(rect.left * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
          };
        })
        .filter(({ left, right }) => left < listRect.left - 0.5 || right > listRect.right + 0.5)
        .slice(0, 8);
      const internalOverflowing = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))]
        .filter((descendant) => descendant.clientWidth > 0 && descendant.scrollWidth > descendant.clientWidth)
        .map((descendant) => ({
          selector: `${descendant.tagName.toLowerCase()}.${descendant.className}`,
          clientWidth: descendant.clientWidth,
          scrollWidth: descendant.scrollWidth,
          display: getComputedStyle(descendant).display,
          position: getComputedStyle(descendant).position,
          text: descendant.textContent?.trim().slice(0, 80),
        }))
        .slice(0, 50);
      return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowing, internalOverflowing };
    });
    expect(stageOverflow.scrollWidth, JSON.stringify(stageOverflow)).toBeLessThanOrEqual(stageOverflow.clientWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe("shared InfoHint mobile containment", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("left, right, and auto hint anchors stay inside a modal and the viewport", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const fixture = document.createElement("div");
      fixture.id = "info-hint-modal-fixture";
      fixture.className = "modal-backdrop";
      fixture.innerHTML = `
        <section class="modal" aria-label="InfoHint modal fixture">
          <form>
            <div style="display:flex;justify-content:flex-start">
              <span class="info-hint info-hint-anchor-left open" data-test-anchor="left">
                <button class="info-hint-trigger" type="button" aria-describedby="info-hint-modal-tooltip-left">i</button>
                <span id="info-hint-modal-tooltip-left" class="info-hint-tooltip" role="tooltip">Left anchored mobile hint.</span>
              </span>
            </div>
            <div style="display:flex;justify-content:flex-end">
              <span class="info-hint open" data-test-anchor="right">
                <button class="info-hint-trigger" type="button" aria-describedby="info-hint-modal-tooltip-right">i</button>
                <span id="info-hint-modal-tooltip-right" class="info-hint-tooltip" role="tooltip">Right anchored mobile hint.</span>
              </span>
            </div>
            <div style="display:flex;justify-content:flex-start">
              <span class="info-hint info-hint-anchor-left open" data-test-anchor="auto-left">
                <button class="info-hint-trigger" type="button" aria-describedby="info-hint-modal-tooltip-auto">i</button>
                <span id="info-hint-modal-tooltip-auto" class="info-hint-tooltip" role="tooltip">Auto resolved mobile hint.</span>
              </span>
            </div>
          </form>
        </section>`;
      document.body.append(fixture);
    });

    const modal = page.getByRole("region", { name: "InfoHint modal fixture" });
    const modalBox = await modal.boundingBox();
    expect(modalBox).not.toBeNull();
    for (const [anchor, edge] of [["left", "left"], ["right", "right"], ["auto-left", "left"]] as const) {
      const hint = page.locator(`[data-test-anchor="${anchor}"]`);
      const tooltip = hint.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      const [hintBox, tooltipBox] = await Promise.all([hint.boundingBox(), tooltip.boundingBox()]);
      expect(hintBox).not.toBeNull();
      expect(tooltipBox).not.toBeNull();
      expect(tooltipBox?.x ?? -1).toBeGreaterThanOrEqual(modalBox?.x ?? 0);
      expect((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)).toBeLessThanOrEqual((modalBox?.x ?? 0) + (modalBox?.width ?? 0));
      expect(tooltipBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((tooltipBox?.y ?? 0) + (tooltipBox?.height ?? 0)).toBeLessThanOrEqual(844);
      if (edge === "left") {
        expect(Math.abs((tooltipBox?.x ?? 0) - (hintBox?.x ?? 0))).toBeLessThanOrEqual(1);
      } else {
        expect(Math.abs(((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)) - ((hintBox?.x ?? 0) + (hintBox?.width ?? 0)))).toBeLessThanOrEqual(1);
      }
    }
  });
});

test("domain checklist renders only payload-bounded unconfigured, partial, and connect-ready claims", async ({ page }) => {
  let currentReadiness = readiness({
    storageConfigured: false,
    connectionStatus: "not-connected",
    connectionAccount: null,
    driveConnected: false,
    gmailConnected: false,
    calendarConnected: false,
    sheetsConnected: false,
  });
  currentReadiness.credentialsPresent = false;
  currentReadiness.missingDetails = [
    { label: "Allowed Workspace domains", envVar: "GOOGLE_WORKSPACE_ALLOWED_DOMAINS", secret: false },
    { label: "Authorized Workspace accounts", envVar: "GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS", secret: false },
    { label: "Gmail intake mailbox", envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX", secret: false },
    { label: "OAuth client ID", envVar: "GOOGLE_WORKSPACE_CLIENT_ID", secret: false },
    { label: "OAuth redirect URI", envVar: "GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI", secret: false },
    { label: "OAuth client secret", envVar: "GOOGLE_WORKSPACE_CLIENT_SECRET", secret: true },
    { label: "Token encryption key", envVar: "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY", secret: true },
  ];
  currentReadiness.missing = currentReadiness.missingDetails.map((detail) => detail.label);
  let currentResources = workspaceResources({
    connectReady: false,
    identity: { connectionAccount: null, intakeMailboxMatches: null, allowedDomains: [], mode: "workspace" },
  });
  let resourcesShouldFail = false;
  let currentHealth: ConnectionHealthPayload = {
    ...connectedHealth(),
    connection: {
      ...connectedHealth().connection,
      connected: false,
      status: "not-connected",
      account: null,
      grantedServices: null,
    },
  };

  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    if (resourcesShouldFail) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Resources temporarily unavailable" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentResources) });
  });
  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentHealth) });
  });
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentReadiness) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  const card = page.locator(".workspace-prerequisites");
  await expect(card.getByRole("heading", { level: 3, name: "Domain & tenant checklist", exact: true })).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(6);
  for (const title of ["Company domain", "Operations account", "Workspace APIs", "OAuth web client", "Hosted secrets", "Role-aligned Google Groups"]) {
    const row = tenantChecklistRow(page, title);
    await expect(row.locator(".info-hint-trigger")).toHaveCount(1);
    await expect(row.getByText("MISSING", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: `About ${title}`, exact: true })).toHaveAttribute("aria-describedby", /.+/);
  }
  const domainHint = tenantChecklistRow(page, "Company domain").getByRole("button", { name: "About Company domain", exact: true });
  const domainDescriptionId = await domainHint.getAttribute("aria-describedby");
  expect(domainDescriptionId).toBeTruthy();
  const domainInstruction = "Verify the company domain in Google Admin, then keep only the approved Workspace domain in hosted configuration.";
  await expect(page.locator(`#${domainDescriptionId}`)).toHaveText(domainInstruction);
  await expect(card.getByRole("link")).toHaveCount(6);
  await expect(card.getByRole("table", { name: "Hosted Workspace configuration" })).toBeVisible();
  await expect(card.getByRole("heading", { level: 4, name: "Copy-exact setup helpers" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 4, name: "Copy-exact setup helpers" })).toHaveCount(1);
  await expect(card.locator('input[type="checkbox"]')).toHaveCount(0);

  currentReadiness = readiness({ connectionStatus: "not-connected", connectionAccount: null });
  currentReadiness.missingDetails = [
    { label: "OAuth redirect URI", envVar: "GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI", secret: false },
    { label: "Token encryption key", envVar: "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY", secret: true },
  ];
  currentReadiness.missing = currentReadiness.missingDetails.map((detail) => detail.label);
  currentResources = workspaceResources({
    connectReady: false,
    identity: { connectionAccount: null, intakeMailboxMatches: null, allowedDomains: ["cherryhillfci.com"], mode: "workspace" },
  });
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(page.getByText("Workspace configuration is present.", { exact: false })).toHaveCount(0);
  await expect(tenantChecklistRow(page, "Company domain").getByText("DONE", { exact: true })).toBeVisible();
  await expect(page.locator(`#${domainDescriptionId}`)).toHaveText(domainInstruction);
  await expect(tenantChecklistRow(page, "Operations account").getByText("DONE", { exact: true })).toBeVisible();
  await expect(tenantChecklistRow(page, "OAuth web client").getByText("MISSING", { exact: true })).toBeVisible();
  await expect(tenantChecklistRow(page, "Hosted secrets").getByText("MISSING", { exact: true })).toBeVisible();

  const appManagedResources = workspaceResources().resources.map((resource) => ({
    ...resource,
    externalId: resource.externalId ?? `${resource.key}-id`,
    source: "app" as const,
    state: resource.state === "Not configured" ? "Adopted" as const : resource.state,
    ...(resource.key === "primary" ? {
      restrictions: {
        adminManagedRestrictions: true,
        copyRequiresWriterPermission: true,
        domainUsersOnly: true,
        driveMembersOnly: true,
        sharingFoldersRequiresOrganizerPermission: true,
      },
    } : {}),
  }));
  currentReadiness = readiness({ connectionStatus: "not-connected", connectionAccount: null });
  currentReadiness.missingDetails = [
    { label: "Shared Drive ID", envVar: "GOOGLE_WORKSPACE_SHARED_DRIVE_ID", secret: false },
    { label: "Client directory spreadsheet", envVar: "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID", secret: false },
    { label: "Client appointments calendar", envVar: "GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID", secret: false },
    { label: "Field schedule calendar", envVar: "GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID", secret: false },
  ];
  currentReadiness.missing = currentReadiness.missingDetails.map((detail) => detail.label);
  currentResources = workspaceResources({
    resources: appManagedResources,
    connectReady: true,
    identity: {
      connectionAccount: "operations@cherryhillfci.com",
      intakeMailboxMatches: true,
      allowedDomains: ["cherryhillfci.com"],
      mode: "workspace",
    },
  });
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "false");
  await setStageExpanded(page, 1, true);
  await expect(tenantChecklistRow(page, "Operations account").getByText("DONE", { exact: true })).toBeVisible();
  await expect(tenantChecklistRow(page, "OAuth web client").getByText("DONE", { exact: true })).toBeVisible();
  await expect(tenantChecklistRow(page, "Hosted secrets").getByText("DONE", { exact: true })).toBeVisible();
  await expect(card.getByText("All required hosted values are present.", { exact: true })).toBeVisible();
  await expect(card.getByText("Restricted", { exact: true })).toBeVisible();

  resourcesShouldFail = true;
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(card.getByText("Not verified", { exact: true })).toBeVisible();
  await expect(card.getByText("Restricted", { exact: true })).toHaveCount(0);
  resourcesShouldFail = false;

  currentReadiness = readiness();
  currentResources = workspaceResources({ resources: appManagedResources });
  currentHealth = connectedHealth();
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(stageToggle(page, 1)).toHaveAttribute("aria-expanded", "true");
  await expect(tenantChecklistRow(page, "Operations account").getByText("DONE", { exact: true })).toBeVisible();
  await expect(tenantChecklistRow(page, "OAuth web client").getByText("DONE", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: /^(Collapse|Expand)$/ })).toHaveCount(0);
  await setStageExpanded(page, 1, false);
  await expect(card).toBeHidden();
  await setStageExpanded(page, 1, true);
  await expect(card.getByRole("listitem")).toHaveCount(6);
});

test("live Workspace setup advances only from endpoint-confirmed steps", async ({ page }) => {
  let currentReadiness = readiness({
    storageConfigured: false,
    connectionStatus: "not-connected",
    connectionAccount: null,
    driveConnected: false,
    gmailConnected: false,
    calendarConnected: false,
    sheetsConnected: false,
  });
  currentReadiness.credentialsPresent = false;
  currentReadiness.missing = [missingInvariant];
  currentReadiness.missingDetails = [{
    label: missingInvariant,
    envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX",
    secret: false,
  }];
  let mirror = unsyncedMirror();
  let resourcePayload = workspaceResources({ connectReady: true });
  let driveVerifyRequest: { method: string; body: string | null } | null = null;
  let driveAdoptRequest: { method: string; body: unknown } | null = null;
  let gmailPrepareRequest: { method: string; body: string | null } | null = null;
  let gmailSendRequest: { method: string; body: string | null } | null = null;
  let calendarReadRequest: { method: string; body: string | null } | null = null;
  let sheetsSyncRequest: { method: string; body: string | null } | null = null;
  let resourcesShouldFail = false;
  const stageFourVerificationStatus: StageFourVerificationStatus = {
    labelReady: false,
    testEmailPassed: false,
    calendarChecked: false,
  };

  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    if (resourcesShouldFail) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Registry unavailable after verification" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(resourcePayload),
    });
  });

  await mockConnectionHealth(page, connectedHealth());

  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentReadiness) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror }) });
  });
  await mockStageFourVerificationStatus(page, stageFourVerificationStatus);
  await page.route("**/api/v1/integrations/google/drive/verify", async (route) => {
    driveVerifyRequest = { method: route.request().method(), body: route.request().postData() };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verified: true }) });
  });
  await page.route("**/api/v1/integrations/google/drive/shared-drive/adopt", async (route) => {
    driveAdoptRequest = { method: route.request().method(), body: route.request().postDataJSON() };
    resourcePayload = {
      ...resourcePayload,
      resources: resourcePayload.resources.map((resource) => resource.resourceType === "drive.shared-drive" ? {
        ...resource,
        source: "app",
        origin: "adopted",
        state: "Adopted",
      } : resource),
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ adopted: true, verified: true }) });
  });
  await page.route("**/api/v1/integrations/google/gmail/labels/prepare", async (route) => {
    gmailPrepareRequest = { method: route.request().method(), body: route.request().postData() };
    stageFourVerificationStatus.labelReady = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prepared: true }) });
  });
  await page.route("**/api/v1/integrations/google/gmail/send-test", async (route) => {
    gmailSendRequest = { method: route.request().method(), body: route.request().postData() };
    stageFourVerificationStatus.testEmailPassed = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: true }) });
  });
  await page.route("**/api/v1/integrations/google/calendar/events", async (route) => {
    calendarReadRequest = { method: route.request().method(), body: route.request().postData() };
    stageFourVerificationStatus.calendarChecked = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) });
  });
  await page.route("**/api/v1/integrations/google/sheets/sync", async (route) => {
    sheetsSyncRequest = { method: route.request().method(), body: route.request().postData() };
    const now = Date.now();
    mirror = {
      ...mirror,
      clients: { status: "synced", lastSyncedAt: now, lastError: null },
      projects: { status: "synced", lastSyncedAt: now, lastError: null },
      lastSyncedAt: now,
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 1, true);
  await expect(page.getByRole("table", { name: "Hosted Workspace configuration" })).toBeVisible();
  await expect(page.getByText(missingInvariant, { exact: true })).toBeVisible();
  await setStageExpanded(page, 2, true);
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText("IN PROGRESS");
  await expect(setupStage(page, 2).getByRole("heading", { level: 3, name: "Company account authorization", exact: true })).toBeVisible();
  await expect(setupStage(page, 2).getByRole("button", { name: "Connect Google Workspace" })).toBeEnabled();
  await setStageExpanded(page, 3, true);
  await expect(creationRow(page, "shared-drive")).toHaveAttribute("data-workspace-creation-state", "FOUND — ADOPT");
  await expect(creationRow(page, "shared-drive")).toContainText("Unlocks after Connect.");
  await expect(page.getByRole("button", { name: "Verify Shared Drive" })).toBeDisabled();
  await expect(creationRow(page, "shared-drive").getByRole("button", { name: "Verify and adopt" })).toBeDisabled();

  currentReadiness = readiness();
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(stageToggle(page, 2)).toHaveAttribute("aria-expanded", "false");
  await setStageExpanded(page, 2, true);
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText("DONE");
  await setStageExpanded(page, 3, true);
  await expect(creationRow(page, "shared-drive").getByRole("button", { name: "Verify and adopt" })).toBeEnabled();
  await expect(page.getByRole("table", { name: "Hosted Workspace configuration" })).toHaveCount(0);

  await page.getByRole("button", { name: "Verify Shared Drive" }).click();
  expect(driveVerifyRequest).toEqual({ method: "POST", body: null });
  await expect(creationRow(page, "shared-drive")).toHaveAttribute("data-workspace-creation-state", "FOUND — ADOPT");
  await creationRow(page, "shared-drive").getByRole("button", { name: "Verify and adopt" }).click();
  expect(driveAdoptRequest).toEqual({ method: "POST", body: {} });
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");
  await setStageExpanded(page, 4, true);
  await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("0 OF 3 VERIFIED");
  await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "READY TO VERIFY");

  await page.getByRole("button", { name: "Prepare FCI labels" }).click();
  expect(gmailPrepareRequest).toEqual({ method: "POST", body: null });
  await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "TEST EMAIL NEEDED");
  await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("0 OF 3 VERIFIED");
  await page.getByRole("button", { name: "Send Workspace test" }).click();
  expect(gmailSendRequest).toEqual({ method: "POST", body: "{}" });
  await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "VERIFIED");
  await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("1 OF 3 VERIFIED");
  await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "READY TO VERIFY");

  await page.getByRole("button", { name: "View upcoming events" }).click();
  expect(calendarReadRequest).toEqual({ method: "GET", body: null });
  await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "VERIFIED");
  await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("2 OF 3 VERIFIED");
  await expect(verificationRow(page, "sheets")).toHaveAttribute("data-stage-four-state", "READY TO VERIFY");

  await page.getByRole("button", { name: "Sync now" }).click();
  expect(sheetsSyncRequest).toEqual({ method: "POST", body: null });
  await expect(verificationRow(page, "sheets")).toHaveAttribute("data-stage-four-state", "VERIFIED");
  await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("READY");
  mirror = {
    ...mirror,
    clients: { status: "syncing", lastSyncedAt: mirror.clients.lastSyncedAt, lastError: null },
    projects: { status: "failed", lastSyncedAt: mirror.projects.lastSyncedAt, lastError: "Synthetic drift after a successful verification" },
  };
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(verificationRow(page, "sheets")).toHaveAttribute("data-stage-four-state", "VERIFIED");
  await expect(verificationRow(page, "sheets").getByText("Syncing", { exact: true })).toBeVisible();
  await expect(verificationRow(page, "sheets").getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(verificationRow(page, "sheets").getByText("syncing", { exact: true })).toHaveCount(0);
  await expect(verificationRow(page, "sheets").getByText("failed", { exact: true })).toHaveCount(0);
  await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("READY");
  resourcesShouldFail = true;
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("READY");
});

test.describe("FIX-13 Stage 4 verification durability", () => {
  async function mockDurableStageFourState(page: Page, initial: {
    labelReady?: boolean;
    testEmailPassed?: boolean;
    calendarChecked?: boolean;
    sheetsSynced?: boolean;
  } = {}) {
    let labelReady = initial.labelReady ?? false;
    let testEmailPassed = initial.testEmailPassed ?? false;
    let calendarChecked = initial.calendarChecked ?? false;
    let gmailStatusFailure = false;
    let calendarStatusFailure = false;
    const syncedAt = Date.now();
    let mirror: MirrorStatus = initial.sheetsSynced
      ? {
          ...unsyncedMirror(),
          clients: { status: "synced", lastSyncedAt: syncedAt, lastError: null },
          projects: { status: "synced", lastSyncedAt: syncedAt, lastError: null },
          lastSyncedAt: syncedAt,
        }
      : unsyncedMirror();

    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await mockWorkspaceResources(page, completedWorkspaceResources());
    await mockConnectionHealth(page, connectedHealth());
    await page.route("**/api/v1/google-workspace", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(readiness()),
      });
    });
    await page.route("**/api/v1/integrations/google/gmail/messages*", async (route) => {
      const verificationOnly = new URL(route.request().url()).searchParams.get("verification") === "status";
      if (verificationOnly && gmailStatusFailure) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "FCI TEST Gmail verification status unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bucket: verificationOnly ? "needs-review" : "inbox",
          messages: [],
          labelReady,
          testEmailPassed,
          limit: 20,
        }),
      });
    });
    await page.route("**/api/v1/integrations/google/gmail/labels/prepare", async (route) => {
      labelReady = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prepared: true }),
      });
    });
    await page.route("**/api/v1/integrations/google/gmail/send-test", async (route) => {
      testEmailPassed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sent: true }),
      });
    });
    await page.route("**/api/v1/integrations/google/calendar/events*", async (route) => {
      const verificationOnly = new URL(route.request().url()).searchParams.get("verification") === "status";
      if (verificationOnly && calendarStatusFailure) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "FCI TEST Calendar verification status unavailable" }),
        });
        return;
      }
      if (!verificationOnly) calendarChecked = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [],
          verificationPassed: calendarChecked,
        }),
      });
    });
    await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mirror }),
      });
    });
    await page.route("**/api/v1/integrations/google/sheets/sync", async (route) => {
      const now = Date.now();
      mirror = {
        ...mirror,
        clients: { status: "synced", lastSyncedAt: now, lastError: null },
        projects: { status: "synced", lastSyncedAt: now, lastError: null },
        lastSyncedAt: now,
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mirror }),
      });
    });
    return {
      setDurableState(next: {
        labelReady?: boolean;
        testEmailPassed?: boolean;
        calendarChecked?: boolean;
      }) {
        if (next.labelReady !== undefined) labelReady = next.labelReady;
        if (next.testEmailPassed !== undefined) testEmailPassed = next.testEmailPassed;
        if (next.calendarChecked !== undefined) calendarChecked = next.calendarChecked;
      },
      setStatusFailures(next: { gmail?: boolean; calendar?: boolean }) {
        if (next.gmail !== undefined) gmailStatusFailure = next.gmail;
        if (next.calendar !== undefined) calendarStatusFailure = next.calendar;
      },
    };
  }

  async function expectStageFourReady(page: Page) {
    await setStageExpanded(page, 4, true);
    await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("READY");
    await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "VERIFIED");
    await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "VERIFIED");
    await expect(verificationRow(page, "sheets")).toHaveAttribute("data-stage-four-state", "VERIFIED");
  }

  test("rehydrates READY after reload and an in-app navigate-away-and-back", async ({ page }) => {
    await mockDurableStageFourState(page);
    await page.goto("/settings?section=google-workspace#workspace-stage-4");
    await setStageExpanded(page, 4, true);

    await verificationRow(page, "gmail").getByRole("button", { name: "Prepare FCI labels" }).click();
    await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "TEST EMAIL NEEDED");
    await verificationRow(page, "gmail").getByRole("button", { name: "Send Workspace test" }).click();
    await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "VERIFIED");
    await verificationRow(page, "calendar").getByRole("button", { name: "View upcoming events" }).click();
    await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "VERIFIED");
    await verificationRow(page, "sheets").getByRole("button", { name: "Sync now" }).click();
    await expectStageFourReady(page);

    await page.reload();
    await expectStageFourReady(page);

    await page.locator(".settings-nav").getByRole("button", { name: "Calendar & appointments", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Calendar & appointments", exact: true })).toBeVisible();
    await page.locator(".settings-nav").getByRole("button", { name: "Google Workspace", exact: true }).click();
    await expectStageFourReady(page);
  });

  test("reflects a server-ready Gmail label on the first render without inventing a test send", async ({ page }) => {
    await mockDurableStageFourState(page, { labelReady: true });
    await page.goto("/settings?section=google-workspace#workspace-stage-4");
    await setStageExpanded(page, 4, true);

    const gmail = verificationRow(page, "gmail");
    await expect(gmail).toHaveAttribute("data-stage-four-state", "TEST EMAIL NEEDED");
    await expect(gmail).not.toHaveAttribute("data-stage-four-state", "READY TO VERIFY");
    await expect(gmail.getByRole("button", { name: "Prepare FCI labels" })).toBeVisible();
    await expect(gmail.getByRole("button", { name: "Refresh FCI labels" })).toHaveCount(0);
    await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("0 OF 3 VERIFIED");
  });

  test("retains stale verification on transient failures and reconciles exact recovered booleans", async ({ page }) => {
    const durable = await mockDurableStageFourState(page, {
      labelReady: true,
      testEmailPassed: true,
      calendarChecked: true,
      sheetsSynced: true,
    });
    await page.goto("/settings?section=google-workspace#workspace-stage-4");
    await expectStageFourReady(page);

    durable.setStatusFailures({ gmail: true, calendar: true });
    await triggerAutomaticWorkspaceRefresh(page);
    await setStageExpanded(page, 4, true);
    await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("READY");
    await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveClass(/\bready\b/);
    await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "VERIFIED");
    await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "VERIFIED");
    await expect(verificationRow(page, "gmail").getByRole("button", { name: "Prepare FCI labels" })).toBeVisible();
    await expect(verificationRow(page, "gmail").getByRole("button", { name: "Refresh FCI labels" })).toHaveCount(0);

    durable.setStatusFailures({ gmail: false, calendar: false });
    durable.setDurableState({
      labelReady: false,
      testEmailPassed: false,
      calendarChecked: false,
    });
    await triggerAutomaticWorkspaceRefresh(page);
    await setStageExpanded(page, 4, true);
    // The Calendar status read is enrolled in the lifecycle census, so the focus
    // trigger reconciles it and it drops out of VERIFIED. The Gmail read is
    // deliberately not enrolled: /gmail/messages resolves a mailbox API client
    // and a live label lookup before it reads its `verification` parameter, so
    // enrolling it would cost an OAuth refresh-token grant and a mailbox round
    // trip on every focus. It stays mount- and action-gated and keeps showing
    // its last read value — which is also why Calendar reads READY TO VERIFY
    // instead of WAITING here: its actions are still unblocked by a Gmail step
    // that has not been re-read yet.
    await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "READY TO VERIFY");
    await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "VERIFIED");

    // A fresh mount is how the panel asks for the Gmail verification read again.
    await page.reload();
    await setStageExpanded(page, 4, true);
    await expect(setupStage(page, 4).locator(".workspace-stage-chip")).toHaveText("1 OF 3 VERIFIED");
    await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "READY TO VERIFY");
    await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "WAITING");
    await expect(verificationRow(page, "sheets")).toHaveAttribute("data-stage-four-state", "VERIFIED");
  });

  test("keeps unavailable services waiting without making pre-connect verification reads", async ({ page }) => {
    let gmailVerificationReads = 0;
    let calendarVerificationReads = 0;
    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await mockWorkspaceResources(page, workspaceResources({
      connectReady: true,
      identity: {
        connectionAccount: null,
        intakeMailboxMatches: null,
        allowedDomains: ["cherryhillfci.com"],
        mode: "workspace",
      },
    }));
    await mockConnectionHealth(page, {
      ...connectedHealth(),
      connection: {
        connected: false,
        status: "not-connected",
        account: null,
        services: { drive: false, gmail: false, calendar: false, sheets: false },
        grantedServices: null,
        requiresReauthorization: false,
      },
    });
    await page.route("**/api/v1/google-workspace", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(readiness({
          connectionStatus: "not-connected",
          connectionAccount: null,
          driveConnected: false,
          gmailConnected: false,
          calendarConnected: false,
          sheetsConnected: false,
        })),
      });
    });
    await page.route("**/api/v1/integrations/google/gmail/messages*", async (route) => {
      gmailVerificationReads += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "FCI TEST expected pre-connect Gmail response" }),
      });
    });
    await page.route("**/api/v1/integrations/google/calendar/events*", async (route) => {
      calendarVerificationReads += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "FCI TEST expected pre-connect Calendar response" }),
      });
    });
    await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mirror: unsyncedMirror() }),
      });
    });

    await page.goto("/settings?section=google-workspace#workspace-stage-4");
    await setStageExpanded(page, 4, true);
    await expect(verificationRow(page, "gmail")).toHaveAttribute("data-stage-four-state", "WAITING");
    await expect(verificationRow(page, "calendar")).toHaveAttribute("data-stage-four-state", "WAITING");
    await expect(setupStage(page, 4).locator(".workspace-stage-chip")).not.toHaveText("UNAVAILABLE");
    expect(gmailVerificationReads).toBe(0);
    expect(calendarVerificationReads).toBe(0);
  });
});

test("Stage 3 pins exact creation copy, dependency gates, request contracts, and calendar-excluded completion", async ({ page }) => {
  let resources: WorkspaceResourcesPayload["resources"] = [
    {
      key: "primary",
      resourceType: "drive.shared-drive",
      label: "Shared Drive",
      name: "FCI Operations",
      blueprintName: "FCI Operations",
      management: "owner",
      parentKey: null,
      externalId: "environment-drive-id",
      source: "env",
      state: "Found",
    },
    {
      key: "client-accounts",
      resourceType: "drive.folder",
      label: "Root folder",
      name: "01_Client Accounts",
      blueprintName: "01_Client Accounts",
      management: "owner",
      parentKey: null,
      externalId: "stale-folder-id",
      source: "none",
      state: "Not configured",
    },
    {
      key: "client-directory",
      resourceType: "sheets.spreadsheet",
      label: "Client directory spreadsheet",
      name: "FCI Operations Directory",
      blueprintName: "FCI Operations Directory",
      management: "system",
      role: "system-mirror",
      parentKey: "company-admin",
      source: "none",
      state: "Not configured",
    },
    {
      key: "estimate-proposal",
      resourceType: "drive.file",
      label: "Document template",
      name: "Estimate Proposal",
      blueprintName: "Estimate Proposal",
      management: "owner",
      parentKey: "templates",
      source: "none",
      state: "Not configured",
    },
  ];
  const requests: Record<string, { method: string; contentType?: string; body: unknown }> = {};
  const payload = (): WorkspaceResourcesPayload => workspaceResources({ resources });

  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload()) });
  });
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });
  await page.route("**/api/v1/integrations/google/drive/verify", async (route) => {
    requests.verify = { method: route.request().method(), body: route.request().postData() };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verified: true }) });
  });
  await page.route("**/api/v1/integrations/google/drive/shared-drive/adopt", async (route) => {
    requests.adopt = {
      method: route.request().method(),
      contentType: route.request().headers()["content-type"],
      body: route.request().postDataJSON(),
    };
    resources = resources.map((resource) => resource.resourceType === "drive.shared-drive" ? {
      ...resource,
      source: "app",
      origin: "adopted",
      state: "Adopted",
    } : resource);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ adopted: true, verified: true }) });
  });
  await page.route("**/api/v1/integrations/google/drive/folders/ensure-roots", async (route) => {
    requests.folders = {
      method: route.request().method(),
      contentType: route.request().headers()["content-type"],
      body: route.request().postDataJSON(),
    };
    resources = resources.map((resource) => resource.resourceType === "drive.folder" ? {
      ...resource,
      externalId: resource.externalId ?? "created-folder-id",
      source: "app",
      origin: "created",
      state: "Created",
    } : resource);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ensured: true, counts: { found: 0, created: 1, adopted: 0 } }) });
  });
  await page.route("**/api/v1/integrations/google/sheets/ensure", async (route) => {
    requests.spreadsheets = {
      method: route.request().method(),
      contentType: route.request().headers()["content-type"],
      body: route.request().postDataJSON(),
    };
    resources = resources.map((resource) => resource.resourceType === "sheets.spreadsheet" ? {
      ...resource,
      externalId: "created-sheet-id",
      source: "app",
      origin: "created",
      state: "Created",
    } : resource);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ensured: true, counts: { found: 0, created: 1, adopted: 0 } }) });
  });
  await page.route("**/api/v1/integrations/google/drive/templates/ensure", async (route) => {
    requests.templates = {
      method: route.request().method(),
      contentType: route.request().headers()["content-type"],
      body: route.request().postDataJSON(),
    };
    resources = resources.map((resource) => resource.resourceType === "drive.file" ? {
      ...resource,
      externalId: "created-template-id",
      source: "app",
      origin: "created",
      state: "Created",
    } : resource);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ensured: true, counts: { found: 0, created: 1, adopted: 0 } }) });
  });
  await page.route("**/api/v1/integrations/google/calendar/events", async (route) => {
    requests.calendar = { method: route.request().method(), body: route.request().postData() };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 3, true);
  const stageThreePanes = setupStage(page, 3).locator("[data-stage-three-pane]");
  await expect(stageThreePanes).toHaveCount(2);
  expect(await stageThreePanes.evaluateAll((panes) => panes.map((pane) => pane.getAttribute("data-stage-three-pane"))))
    .toEqual(["creation", "blueprint"]);
  const exactRows = [
    {
      key: "shared-drive" as const,
      label: "Shared Drive",
      state: "FOUND — ADOPT",
      info: "The one company drive where every project folder lives. The app never creates a second drive — it adopts the one your admin set up.",
    },
    {
      key: "folder-tree" as const,
      label: "Folder tree (from your blueprint)",
      state: "AFTER DRIVE",
      info: "Creates the top-level folders exactly as your blueprint defines them. Rename them from this screen later — never directly in Drive.",
    },
    {
      key: "spreadsheets" as const,
      label: "Spreadsheets",
      state: "AFTER FOLDERS",
      info: "The Client Directory and Project Register the app keeps in sync, plus any extra sheets you defined. The app is the source of truth — the sheets are mirrors.",
    },
    {
      key: "templates" as const,
      label: "Templates",
      state: "AFTER FOLDERS",
      info: "Starter documents — estimate, work order, change order, checklist, budget — placed in your Templates folder. Edit their content in Google; the app only creates them.",
    },
    {
      key: "calendars" as const,
      label: "Calendars",
      state: "VERIFY ONLY",
      info: "Checks that the appointments calendar your admin shared is reachable. The app doesn't create calendars yet — that arrives with a later update.",
    },
  ];
  await expect(creationCard(page).locator("[data-workspace-creation-row]")).toHaveCount(exactRows.length);
  expect(await creationCard(page).locator("[data-workspace-creation-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-workspace-creation-row")))).toEqual(exactRows.map(({ key }) => key));
  for (const expected of exactRows) {
    const row = creationRow(page, expected.key);
    await expect(row.getByRole("heading", { level: 4, name: expected.label, exact: true })).toBeVisible();
    await expect(row).toHaveAttribute("data-workspace-creation-state", expected.state);
    const hint = row.getByRole("button", { name: `About ${expected.label}`, exact: true });
    const descriptionId = await hint.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    await hint.focus();
    await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText(expected.info);
    await expect(page.locator(`[id="${descriptionId}"]`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(`[id="${descriptionId}"]`)).toBeHidden();
  }
  await expect(creationRow(page, "folder-tree")).toContainText("Unlocks after Shared Drive.");
  await expect(creationRow(page, "spreadsheets")).toContainText("Unlocks after Folder tree (from your blueprint).");
  await expect(creationRow(page, "templates")).toContainText("Unlocks after Folder tree (from your blueprint).");
  await expect(creationRow(page, "calendars")).toContainText("Unlocks after Templates.");
  for (const [key, buttonName, dependency] of [
    ["folder-tree", "Ensure root folders", "Unlocks after Shared Drive."],
    ["spreadsheets", "Ensure spreadsheets", "Unlocks after Folder tree (from your blueprint)."],
    ["templates", "Ensure templates", "Unlocks after Folder tree (from your blueprint)."],
    ["calendars", "Verify calendar access", "Unlocks after Templates."],
  ] as const) {
    const control = creationRow(page, key).getByRole("button", { name: buttonName });
    const descriptionId = await control.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText(dependency);
  }
  await expect(creationRow(page, "folder-tree").getByRole("button", { name: "Ensure root folders" })).toBeDisabled();
  await expect(creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" })).toBeDisabled();
  await expect(creationRow(page, "templates").getByRole("button", { name: "Ensure templates" })).toBeDisabled();
  await expect(creationRow(page, "calendars").getByRole("button", { name: "Verify calendar access" })).toBeDisabled();
  const folderDetails = creationRow(page, "folder-tree").locator("details");
  await folderDetails.locator("summary").click();
  await expect(folderDetails.getByRole("button", { name: "Rename" })).toHaveCount(0);
  await setStageExpanded(page, 4, true);
  const renameDetails = upkeepRow(page, "renames").locator("details");
  await renameDetails.locator("summary").click();
  await expect(upkeepRow(page, "renames")).toHaveAttribute("data-stage-four-upkeep-state", "WAITING");
  await expect(renameDetails.getByRole("button", { name: "Rename" })).toBeDisabled();
  await setStageExpanded(page, 3, true);

  await creationRow(page, "shared-drive").getByRole("button", { name: "Verify Shared Drive" }).click();
  expect(requests.verify).toEqual({ method: "POST", body: null });
  await creationRow(page, "shared-drive").getByRole("button", { name: "Verify and adopt" }).click();
  expect(requests.adopt).toEqual({ method: "POST", contentType: "application/json", body: {} });
  await expect(creationRow(page, "shared-drive")).toHaveAttribute("data-workspace-creation-state", "DONE");
  await expect(creationRow(page, "folder-tree")).toHaveAttribute("data-workspace-creation-state", "CREATE");
  await expect(creationRow(page, "folder-tree").getByRole("button", { name: "Ensure root folders" })).toBeEnabled();
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("IN PROGRESS · 1 of 4");
  await expect(upkeepRow(page, "renames")).toHaveAttribute("data-stage-four-upkeep-state", "AVAILABLE");
  await expect(renameDetails.getByRole("button", { name: "Rename" })).toBeEnabled();
  await expect(creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" })).toBeDisabled();
  await expect(creationRow(page, "templates").getByRole("button", { name: "Ensure templates" })).toBeDisabled();
  await expect(creationRow(page, "spreadsheets")).toContainText("Unlocks after Folder tree (from your blueprint).");
  await expect(creationRow(page, "templates")).toContainText("Unlocks after Folder tree (from your blueprint).");
  await expect(creationRow(page, "calendars")).toContainText("Unlocks after Templates.");

  await creationRow(page, "folder-tree").getByRole("button", { name: "Ensure root folders" }).click();
  expect(requests.folders).toEqual({ method: "POST", contentType: "application/json", body: {} });
  await expect(creationRow(page, "spreadsheets")).toHaveAttribute("data-workspace-creation-state", "CREATE");
  await expect(creationRow(page, "templates")).toHaveAttribute("data-workspace-creation-state", "CREATE");
  await expect(creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" })).toBeEnabled();
  await expect(creationRow(page, "templates").getByRole("button", { name: "Ensure templates" })).toBeEnabled();
  await expect(creationRow(page, "calendars")).toContainText("Unlocks after Templates.");

  await creationRow(page, "templates").getByRole("button", { name: "Ensure templates" }).click();
  expect(requests.templates).toEqual({ method: "POST", contentType: "application/json", body: {} });
  await expect(creationRow(page, "calendars").getByRole("button", { name: "Verify calendar access" })).toBeEnabled();
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("IN PROGRESS · 3 of 4");
  await creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" }).click();
  expect(requests.spreadsheets).toEqual({ method: "POST", contentType: "application/json", body: {} });
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");
  await expect(stageToggle(page, 4)).toHaveAttribute("aria-expanded", "true");
  await expect(renameDetails.getByRole("button", { name: "Rename" })).toBeEnabled();
  await setStageExpanded(page, 3, true);
  await expect(creationRow(page, "calendars")).toHaveAttribute("data-workspace-creation-state", "VERIFY ONLY");
  await creationRow(page, "calendars").getByRole("button", { name: "Verify calendar access" }).click();
  expect(requests.calendar).toEqual({ method: "GET", body: null });

  const completeRequiredResources = structuredClone(resources);
  for (const missingType of ["drive.shared-drive", "drive.folder", "sheets.spreadsheet"] as const) {
    resources = completeRequiredResources.filter((resource) => resource.resourceType !== missingType);
    await triggerAutomaticWorkspaceRefresh(page);
    const expectedReadyCount = missingType === "drive.shared-drive"
      ? 0
      : missingType === "drive.folder"
        ? 1
        : 3;
    await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText(`IN PROGRESS · ${expectedReadyCount} of 4`);
    await expect(stageToggle(page, 3)).toHaveAttribute("aria-expanded", "true");
    await expect(stageToggle(page, 4)).toHaveAttribute("aria-expanded", "false");
    if (missingType === "drive.shared-drive") {
      await expect(creationRow(page, "shared-drive").getByRole("button", { name: /Verify Shared Drive/ })).toBeEnabled();
      await expect(creationRow(page, "shared-drive").getByRole("button", { name: /adopt/i })).toHaveCount(0);
      await expect(creationRow(page, "folder-tree").getByRole("button", { name: "Ensure root folders" })).toBeDisabled();
      await expect(creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" })).toBeDisabled();
      await expect(creationRow(page, "templates").getByRole("button", { name: "Ensure templates" })).toBeDisabled();
      await expect(creationRow(page, "calendars").getByRole("button", { name: "Verify calendar access" })).toBeDisabled();
    } else if (missingType === "drive.folder") {
      await expect(creationRow(page, "folder-tree").getByRole("button", { name: "Ensure root folders" })).toBeEnabled();
      await expect(creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" })).toBeDisabled();
      await expect(creationRow(page, "templates").getByRole("button", { name: "Ensure templates" })).toBeDisabled();
      await expect(creationRow(page, "calendars").getByRole("button", { name: "Verify calendar access" })).toBeDisabled();
    } else if (missingType === "sheets.spreadsheet") {
      await expect(creationRow(page, "spreadsheets").getByRole("button", { name: "Ensure spreadsheets" })).toBeEnabled();
      await expect(creationRow(page, "templates").getByRole("button", { name: "Ensure templates" })).toBeEnabled();
      await expect(creationRow(page, "calendars").getByRole("button", { name: "Verify calendar access" })).toBeEnabled();
    }
    resources = structuredClone(completeRequiredResources);
    await triggerAutomaticWorkspaceRefresh(page);
    await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");
  }

  resources = completeRequiredResources.filter((resource) => resource.resourceType !== "drive.file");
  await triggerAutomaticWorkspaceRefresh(page);
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");
  await expect(stageToggle(page, 4)).toHaveAttribute("aria-expanded", "true");
  await setStageExpanded(page, 3, true);
  await expect(creationRow(page, "templates")).toHaveAttribute("data-workspace-creation-state", "DONE");
  await expect(creationRow(page, "templates")).toContainText("No templates are defined in this blueprint.");
  await expect(creationRow(page, "calendars").getByRole("button", { name: "Verify calendar access" })).toBeEnabled();
  resources = structuredClone(completeRequiredResources);
  await triggerAutomaticWorkspaceRefresh(page);
  await setStageExpanded(page, 3, true);
  await expect(creationRow(page, "calendars")).toHaveAttribute("data-workspace-creation-state", "VERIFY ONLY");
  await expect(creationRow(page, "calendars")).toContainText("No calendars are defined in this blueprint.");
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");
});

test.describe("FIX-18 Stage 3 status reconciliation", () => {
  test("locked wins when seeded children report complete before the Shared Drive is adopted", async ({ page }) => {
    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await mockWorkspaceResources(page, workspaceResources());
    await mockConnectionHealth(page, connectedHealth());
    await page.route("**/api/v1/google-workspace", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
    });
    await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
    });

    await page.goto("/settings?section=google-workspace#workspace-stage-3");
    await setStageExpanded(page, 3, true);

    await expect(creationCard(page).getByText("0 of 4 ready", { exact: true })).toBeVisible();
    await expect(creationCard(page).locator('[data-workspace-creation-state="DONE"]')).toHaveCount(0);

    for (const [key, state, buttonName, dependency] of [
      ["folder-tree", "AFTER DRIVE", "Ensure root folders", "Unlocks after Shared Drive."],
      ["spreadsheets", "AFTER FOLDERS", "Ensure spreadsheets", "Unlocks after Folder tree (from your blueprint)."],
      ["templates", "AFTER FOLDERS", "Ensure templates", "Unlocks after Folder tree (from your blueprint)."],
      ["calendars", "VERIFY ONLY", "Verify calendar access", "Unlocks after Templates."],
    ] as const) {
      const row = creationRow(page, key);
      await expect(row).toHaveAttribute("data-workspace-creation-state", state);
      await expect(row).not.toHaveClass(/creationRowComplete/);
      await expect(row.getByText("DONE", { exact: true })).toHaveCount(0);
      const control = row.getByRole("button", { name: buttonName });
      await expect(control).toBeDisabled();
      const descriptionId = await control.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText(dependency);
    }
  });
});

test.describe("SET-38 Stage 3 subsection disclosures", () => {
  test("waits for every subsection status before opening only the first incomplete subsection", async ({ page }) => {
    let releaseResources: (() => void) | undefined;
    let releaseBlueprint: (() => void) | undefined;
    const resourcesGate = new Promise<void>((resolve) => { releaseResources = resolve; });
    const blueprintGate = new Promise<void>((resolve) => { releaseBlueprint = resolve; });

    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
      await resourcesGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(workspaceResources()),
      });
    });
    await page.unroute("**/api/v1/integrations/google/setup/blueprint");
    await page.route("**/api/v1/integrations/google/setup/blueprint", async (route) => {
      await blueprintGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ blueprint: seedWorkspaceBlueprint(), version: 0, seeded: true }),
      });
    });
    await mockReadyWorkspaceForStageThree(page);

    await page.goto("/settings?section=google-workspace#workspace-stage-3");
    const creationToggle = stageThreeSubsectionToggle(page, "creation");
    const blueprintToggle = stageThreeSubsectionToggle(page, "blueprint");
    await expect(creationToggle).toHaveAttribute("aria-expanded", "false");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");
    await expect(stageThreeSubsection(page, "creation").getByText("Loading", { exact: true })).toBeVisible();
    await expect(stageThreeSubsection(page, "blueprint").getByText("Loading", { exact: true })).toBeVisible();

    releaseResources?.();
    await expect(stageThreeSubsection(page, "creation").getByText("0 of 4 ready", { exact: true })).toBeVisible();
    await expect(creationToggle).toHaveAttribute("aria-expanded", "false");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");

    releaseBlueprint?.();
    await expect(stageThreeSubsection(page, "blueprint").getByText("Seed defaults · version 0", { exact: true })).toBeVisible();
    await expect(creationToggle).toHaveAttribute("aria-expanded", "true");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");
  });

  test("preserves a manual subsection choice made before status requests settle", async ({ page }) => {
    let releaseResources: (() => void) | undefined;
    let releaseBlueprint: (() => void) | undefined;
    const resourcesGate = new Promise<void>((resolve) => { releaseResources = resolve; });
    const blueprintGate = new Promise<void>((resolve) => { releaseBlueprint = resolve; });

    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
      await resourcesGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(workspaceResources()),
      });
    });
    await page.unroute("**/api/v1/integrations/google/setup/blueprint");
    await page.route("**/api/v1/integrations/google/setup/blueprint", async (route) => {
      await blueprintGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ blueprint: seedWorkspaceBlueprint(), version: 0, seeded: true }),
      });
    });
    await mockReadyWorkspaceForStageThree(page);

    await page.goto("/settings?section=google-workspace#workspace-stage-3");
    const creationToggle = stageThreeSubsectionToggle(page, "creation");
    const blueprintToggle = stageThreeSubsectionToggle(page, "blueprint");
    await expect(stageThreeSubsection(page, "creation").getByText("Loading", { exact: true })).toBeVisible();
    await expect(stageThreeSubsection(page, "blueprint").getByText("Loading", { exact: true })).toBeVisible();
    await blueprintToggle.click();
    await expect(creationToggle).toHaveAttribute("aria-expanded", "false");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "true");

    releaseResources?.();
    releaseBlueprint?.();
    await expect(stageThreeSubsection(page, "creation").getByText("0 of 4 ready", { exact: true })).toBeVisible();
    await expect(stageThreeSubsection(page, "blueprint").getByText("Seed defaults · version 0", { exact: true })).toBeVisible();
    await expect(creationToggle).toHaveAttribute("aria-expanded", "false");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "true");
  });

  test("keeps all complete subsections collapsed with their status visible", async ({ page }) => {
    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await mockWorkspaceResources(page, completedWorkspaceResources());
    await mockReadyWorkspaceForStageThree(page);

    await page.goto("/settings?section=google-workspace#workspace-stage-3");
    await setStageExpanded(page, 3, true);

    await expect(stageThreeSubsectionToggle(page, "creation")).toHaveAttribute("aria-expanded", "false");
    await expect(stageThreeSubsectionToggle(page, "blueprint")).toHaveAttribute("aria-expanded", "false");
    await expect(stageThreeSubsection(page, "creation").getByText("4 of 4 ready", { exact: true })).toBeVisible();
    await expect(stageThreeSubsection(page, "blueprint").getByText("Seed defaults · version 0", { exact: true })).toBeVisible();
    await expect(page.locator("#workspace-stage-3-creation-content")).toBeHidden();
    await expect(page.locator("#workspace-stage-3-blueprint-content")).toBeHidden();
  });

  test("opens Blueprint when it is the first incomplete subsection and reports the failed status honestly", async ({ page }) => {
    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await mockWorkspaceResources(page, completedWorkspaceResources());
    await page.unroute("**/api/v1/integrations/google/setup/blueprint");
    await page.route("**/api/v1/integrations/google/setup/blueprint", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "FCI TEST blueprint unavailable" }),
      });
    });
    await mockReadyWorkspaceForStageThree(page);

    await page.goto("/settings?section=google-workspace#workspace-stage-3");
    await expect(stageThreeSubsection(page, "creation").getByText("4 of 4 ready", { exact: true })).toBeVisible();
    await expect(stageThreeSubsection(page, "blueprint").getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(stageThreeSubsectionToggle(page, "creation")).toHaveAttribute("aria-expanded", "false");
    await expect(stageThreeSubsectionToggle(page, "blueprint")).toHaveAttribute("aria-expanded", "true");
    await expect(stageThreeSubsection(page, "blueprint").getByRole("alert")).toContainText("FCI TEST blueprint unavailable");
  });

  test("gates the disclosure init on the latest resources request when an OAuth callback lands out of order", async ({ page }) => {
    // On a ?google=... callback the admin mount effect issues a non-forced
    // resources load while the callback effect issues a forced copy. The forced
    // (latest-started) request is authoritative. Resolve the two out of order:
    // the first (stale) request lands immediately reporting every subsection
    // complete, and the authoritative request lands last reporting Workspace
    // creation incomplete. The one-shot disclosure init must follow the
    // authoritative response — opening the first-incomplete subsection — and must
    // not lock onto the stale completion that resolved first.
    let resourcesRequestCount = 0;
    await page.unroute("**/api/v1/integrations/google/setup/resources");
    await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
      resourcesRequestCount += 1;
      if (resourcesRequestCount === 1) {
        // Stale mount load: resolves first, reports creation already complete.
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(completedWorkspaceResources()),
        });
        return;
      }
      // Authoritative forced callback load: resolves last with creation incomplete.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(workspaceResources()),
      });
    });
    await mockReadyWorkspaceForStageThree(page);

    await page.goto("/settings?section=google-workspace&google=connected#workspace-stage-3");

    const creationToggle = stageThreeSubsectionToggle(page, "creation");
    const blueprintToggle = stageThreeSubsectionToggle(page, "blueprint");

    // The authoritative response reports Workspace creation incomplete…
    await expect(stageThreeSubsection(page, "creation").getByText("0 of 4 ready", { exact: true })).toBeVisible();
    await expect(stageThreeSubsection(page, "blueprint").getByText("Seed defaults · version 0", { exact: true })).toBeVisible();
    // …so the first-incomplete subsection (creation) opens — not the stale-complete
    // result that resolved first, which would have left every subsection collapsed.
    await expect(creationToggle).toHaveAttribute("aria-expanded", "true");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#workspace-stage-3-creation-content")).toBeVisible();
    await expect(page.locator("#workspace-stage-3-blueprint-content")).toBeHidden();
    // Both racing loads (mount + forced callback) reached the resources endpoint.
    expect(resourcesRequestCount).toBeGreaterThanOrEqual(2);
  });

  test("reports a failed Blueprint refresh as unavailable while retaining the stale draft for recovery", async ({ page }) => {
    let blueprintGetCount = 0;
    await page.unroute("**/api/v1/integrations/google/setup/blueprint");
    await page.route("**/api/v1/integrations/google/setup/blueprint", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      blueprintGetCount += 1;
      if (blueprintGetCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ blueprint: seedWorkspaceBlueprint(), version: 0, seeded: true }),
        });
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "FCI TEST blueprint refresh unavailable" }),
      });
    });
    const simulationHealth: ConnectionHealthPayload = {
      ...connectedHealth(),
      runtimeMode: "simulation",
      simulation: true,
      connection: { ...connectedHealth().connection, account: "Local Workspace simulation", grantedServices: null },
    };
    await mockConnectionHealth(page, simulationHealth);
    await page.route("**/api/v1/google-workspace", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(readiness({ runtimeMode: "simulation", simulation: true })),
      });
    });
    await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
    });
    await mockStageFourVerificationStatus(page);
    await page.route("**/api/v1/integrations/google/simulation/reset", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ reset: true, messages: 2, events: 0 }),
      });
    });

    await page.goto("/settings?section=google-workspace#workspace-stage-3");
    const blueprintSubsection = stageThreeSubsection(page, "blueprint");
    const blueprintToggle = stageThreeSubsectionToggle(page, "blueprint");
    await expect(blueprintSubsection.getByText("Seed defaults · version 0", { exact: true })).toBeVisible();
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");

    await setStageExpanded(page, 2, true);
    await setupStage(page, 2).getByRole("button", { name: "Reset simulation data", exact: true }).click();
    await setStageExpanded(page, 3, true);
    await expect(blueprintSubsection.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");

    await blueprintToggle.click();
    await expect(blueprintSubsection.getByRole("alert")).toContainText("FCI TEST blueprint refresh unavailable");
    await expect(blueprintSubsection.getByLabel("Business display name")).toHaveValue(seedWorkspaceBlueprint().business.displayName);
  });

  test("supports independent keyboard toggles, focus recovery, and session-only manual overrides", async ({ page }) => {
    await mockReadyWorkspaceForStageThree(page);
    await page.goto("/settings?section=google-workspace#workspace-stage-3");

    const creationToggle = stageThreeSubsectionToggle(page, "creation");
    const blueprintToggle = stageThreeSubsectionToggle(page, "blueprint");
    await expect(creationToggle).toHaveAttribute("aria-expanded", "true");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");
    await expect(stageThreeSubsection(page, "creation").getByRole("heading", { level: 3, name: "Workspace creation", exact: true })).toBeVisible();
    await expect(stageThreeSubsection(page, "blueprint").getByRole("heading", { level: 3, name: "Blueprint", exact: true })).toBeVisible();

    await creationToggle.focus();
    await page.keyboard.press("Enter");
    await expect(creationToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#workspace-stage-3-creation-content")).toBeHidden();

    await blueprintToggle.focus();
    await page.keyboard.press("Space");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#workspace-stage-3-blueprint-content")).toBeVisible();
    await expect(blueprintToggle).toHaveAttribute("aria-controls", "workspace-stage-3-blueprint-content");

    const blueprintName = stageThreeSubsection(page, "blueprint").getByRole("textbox", { name: "Business display name" });
    await blueprintName.focus();
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[data-stage-three-subsection="blueprint"] button[aria-controls="workspace-stage-3-blueprint-content"]')?.click();
    });
    await expect(blueprintToggle).toBeFocused();
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Space");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "true");
    await triggerAutomaticWorkspaceRefresh(page);
    await expect(stageThreeSubsection(page, "creation").getByText("0 of 4 ready", { exact: true })).toBeVisible();
    await expect(creationToggle).toHaveAttribute("aria-expanded", "false");
    await expect(blueprintToggle).toHaveAttribute("aria-expanded", "true");
  });

  test("has no serious or critical accessibility violations at desktop and 390px", async ({ page }) => {
    await mockReadyWorkspaceForStageThree(page);

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/settings?section=google-workspace#workspace-stage-3");
      await setStageThreeSubsectionExpanded(page, "creation", true);
      await setStageThreeSubsectionExpanded(page, "blueprint", true);

      const results = await new AxeBuilder({ page })
        .include('[data-workspace-stage="3"]')
        .analyze();
      const seriousOrCritical = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
      expect(seriousOrCritical, `${viewport.width}px Stage 3 axe violations`).toEqual([]);
      expect(await setupStage(page, 3).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  });
});

test("stale complete registry rows name Connect as the actual unmet dependency", async ({ page }) => {
  const completeResources = workspaceResources().resources.map((resource) => {
    if (resource.resourceType === "drive.shared-drive") {
      return { ...resource, source: "app" as const, origin: "adopted" as const, state: "Adopted" as const, externalId: resource.externalId ?? "drive-id" };
    }
    if (resource.resourceType === "drive.folder" || resource.resourceType === "sheets.spreadsheet" || resource.resourceType === "drive.file") {
      return { ...resource, source: "app" as const, origin: "created" as const, state: "Created" as const, externalId: resource.externalId ?? `${resource.key}-id` };
    }
    return resource;
  });
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, workspaceResources({
    connectReady: true,
    resources: completeResources,
    identity: {
      connectionAccount: null,
      intakeMailboxMatches: true,
      allowedDomains: ["cherryhillfci.com"],
      mode: "workspace",
    },
  }));
  await mockConnectionHealth(page, {
    ...connectedHealth(),
    connection: {
      ...connectedHealth().connection,
      connected: false,
      status: "not-connected",
      account: null,
      grantedServices: null,
      services: { drive: false, gmail: false, calendar: false, sheets: false },
    },
  });
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readiness({
        connectionStatus: "not-connected",
        connectionAccount: null,
        driveConnected: false,
        gmailConnected: false,
        calendarConnected: false,
        sheetsConnected: false,
      })),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageThreeSubsectionExpanded(page, "creation", true);
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("WAITING ON STAGE 2");
  for (const [key, buttonName] of [
    ["shared-drive", "Verify and adopt"],
    ["folder-tree", "Ensure root folders"],
    ["spreadsheets", "Ensure spreadsheets"],
    ["templates", "Ensure templates"],
    ["calendars", "Verify calendar access"],
  ] as const) {
    const control = creationRow(page, key).getByRole("button", { name: buttonName });
    await expect(control).toBeDisabled();
    const descriptionId = await control.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText("Unlocks after Connect.");
  }
});

test("service-level Drive and Calendar locks name degraded dependencies after Stage 2 is complete", async ({ page }) => {
  const completeResources = workspaceResources().resources.map((resource) => {
    if (resource.resourceType === "drive.shared-drive") {
      return { ...resource, source: "app" as const, origin: "adopted" as const, state: "Adopted" as const, externalId: resource.externalId ?? "drive-id" };
    }
    if (resource.resourceType === "drive.folder" || resource.resourceType === "sheets.spreadsheet" || resource.resourceType === "drive.file") {
      return { ...resource, source: "app" as const, origin: "created" as const, state: "Created" as const, externalId: resource.externalId ?? `${resource.key}-id` };
    }
    return resource;
  });
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, workspaceResources({ resources: completeResources }));
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readiness({
        storageConfigured: false,
        driveConnected: false,
        calendarConnected: false,
      })),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await expect(setupStage(page, 2).locator(".workspace-stage-chip")).toHaveText("DONE");
  await setStageThreeSubsectionExpanded(page, "creation", true);
  await expect(setupStage(page, 3).locator(".workspace-stage-chip")).toHaveText("DONE");

  const sharedDriveRow = creationRow(page, "shared-drive");
  const adoptButton = sharedDriveRow.getByRole("button", { name: "Verify and adopt" });
  await expect(adoptButton).toBeEnabled();
  await expect(adoptButton).not.toHaveAttribute("aria-describedby", /.+/);
  const verifyDriveButton = sharedDriveRow.getByRole("button", { name: "Verify Shared Drive" });
  await expect(verifyDriveButton).toBeDisabled();
  const driveDescriptionId = await verifyDriveButton.getAttribute("aria-describedby");
  expect(driveDescriptionId).toBeTruthy();
  await expect(page.locator(`[id="${driveDescriptionId}"]`)).toHaveText("Unlocks after Drive is connected and Workspace storage is configured.");
  await expect(sharedDriveRow.getByText("Unlocks after Connect.", { exact: true })).toHaveCount(0);

  const calendarRow = creationRow(page, "calendars");
  const verifyCalendarButton = calendarRow.getByRole("button", { name: "Verify calendar access" });
  await expect(verifyCalendarButton).toBeDisabled();
  const calendarDescriptionId = await verifyCalendarButton.getAttribute("aria-describedby");
  expect(calendarDescriptionId).toBeTruthy();
  await expect(page.locator(`[id="${calendarDescriptionId}"]`)).toHaveText("Unlocks after Calendar is enabled and connected.");
  await expect(calendarRow.getByText("Unlocks after Connect.", { exact: true })).toHaveCount(0);
});

test("first-load registry failure with no prior data hides Shared Drive adoption controls", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Registry unavailable for test" }) });
  });
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-3");
  await setStageExpanded(page, 3, true);
  const sharedDrive = creationRow(page, "shared-drive");
  await expect(sharedDrive).toHaveAttribute("data-workspace-creation-state", "UNAVAILABLE");
  await expect(sharedDrive.getByRole("button", { name: "Find and adopt", exact: true })).toHaveCount(0);
  await expect(sharedDrive.getByRole("button", { name: "Verify and adopt", exact: true })).toHaveCount(0);
  await expect(sharedDrive.getByText("Adoption controls become available when the resource registry returns the Shared Drive row.", { exact: true })).toBeVisible();
});

// Review defect: the resources GET and the settings GET were awaited in one Promise.all inside
// a single try/catch, so an unrelated settings failure rejected the pair and blanked the whole
// Stage 3 surface behind a resources error message. They are independent surfaces: the resource
// inventory owns the stage, the settings read owns only the mailbox selector.
test("a settings-read failure degrades only the intake mailbox selector, not the Stage 3 surface", async ({ page }) => {
  await mockReadyWorkspaceForStageThree(page);
  await page.route("**/api/v1/settings/workspace", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "FCI TEST settings unavailable" }),
    });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-3");
  await setStageExpanded(page, 3, true);
  await setStageThreeSubsectionExpanded(page, "creation", true);

  // Stage 3 renders from its own endpoint, which succeeded.
  const sharedDrive = creationRow(page, "shared-drive");
  await expect(sharedDrive.getByRole("heading", { level: 4, name: "Shared Drive", exact: true })).toBeVisible();
  await expect(sharedDrive.getByText("Adoption controls become available when the resource registry returns the Shared Drive row.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Workspace resource status could not be loaded. Retry before using this setup summary.", { exact: true })).toHaveCount(0);

  // Only the mailbox selector degrades, with its own error, its own retry, and saving blocked
  // so the unloaded empty selection cannot overwrite the stored mailbox.
  await setStageExpanded(page, 1, true);
  const runtimeConfiguration = setupStage(page, 1).locator(
    'section[aria-labelledby="workspace-runtime-configuration-heading"]',
  );
  await expect(runtimeConfiguration.getByRole("alert")).toContainText("The saved intake mailbox could not be loaded.");
  await expect(runtimeConfiguration.getByRole("button", { name: "Retry mailbox", exact: true })).toBeVisible();
  await expect(page.getByLabel("Gmail intake mailbox")).toBeDisabled();
  await expect(runtimeConfiguration.getByRole("button", { name: "Save mailbox", exact: true })).toBeDisabled();
});

test("a stalled settings read cannot keep the Stage 3 resource surface loading", async ({ page }) => {
  await mockReadyWorkspaceForStageThree(page);
  let releaseSettingsRead: (() => void) | null = null;
  await page.route("**/api/v1/settings/workspace", async (route) => {
    await new Promise<void>((resolve) => {
      releaseSettingsRead = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings: { intakeMailbox: "" }, intakeMailboxOptions: [] }),
    });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-3");
  await setStageExpanded(page, 3, true);
  await setStageThreeSubsectionExpanded(page, "creation", true);

  const sharedDrive = creationRow(page, "shared-drive");
  await expect(sharedDrive.getByRole("heading", { level: 4, name: "Shared Drive", exact: true })).toBeVisible();
  await expect(page.getByText("Workspace resource status could not be loaded. Retry before using this setup summary.", { exact: true })).toHaveCount(0);
  expect(releaseSettingsRead).not.toBeNull();
  releaseSettingsRead?.();
});

test("stale Shared Drive registry data keeps adopt locked while direct verification remains available", async ({ page }) => {
  let verifyRequest: { method: string; body: string | null } | null = null;
  let resourcesShouldFail = false;
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    if (resourcesShouldFail) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Registry unavailable for test" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workspaceResources()) });
  });
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });
  await page.route("**/api/v1/integrations/google/drive/verify", async (route) => {
    verifyRequest = { method: route.request().method(), body: route.request().postData() };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verified: true }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 3, true);
  await expect(creationRow(page, "shared-drive")).toHaveAttribute("data-workspace-creation-state", "FOUND — ADOPT");
  await expect(creationRow(page, "shared-drive").getByRole("button", { name: "Verify and adopt" })).toBeEnabled();
  resourcesShouldFail = true;
  await triggerAutomaticWorkspaceRefresh(page);
  await setStageExpanded(page, 3, true);
  await expect(creationCard(page).getByText("Workspace resource status could not be loaded. Retry before using this setup summary.", { exact: true })).toBeVisible();
  await expect(creationCard(page).getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(creationCard(page).getByText("0 of 4 ready", { exact: true })).toHaveCount(0);
  await expect(creationCard(page).getByText(/^No (?:folders|spreadsheets|templates|calendars) are defined in this blueprint\.$/)).toHaveCount(0);
  await expect(creationCard(page).getByText("Resource details are unavailable until the registry refresh succeeds.", { exact: true })).toHaveCount(4);
  await expect(creationRow(page, "shared-drive")).toHaveAttribute("data-workspace-creation-state", "UNAVAILABLE");
  await expect(creationRow(page, "shared-drive").getByText("UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(creationRow(page, "shared-drive").getByText("VERIFY", { exact: true })).toHaveCount(0);
  const adoptButton = creationRow(page, "shared-drive").getByRole("button", { name: "Verify and adopt" });
  await expect(adoptButton).toBeDisabled();
  const adoptDescriptionId = await adoptButton.getAttribute("aria-describedby");
  expect(adoptDescriptionId).toBeTruthy();
  await expect(page.locator(`[id="${adoptDescriptionId}"]`)).toHaveText("Unlocks after Workspace resource status is available.");
  for (const [key, buttonName] of [
    ["folder-tree", "Ensure root folders"],
    ["spreadsheets", "Ensure spreadsheets"],
    ["templates", "Ensure templates"],
    ["calendars", "Verify calendar access"],
  ] as const) {
    const control = creationRow(page, key).getByRole("button", { name: buttonName });
    await expect(control).toBeDisabled();
    const descriptionId = await control.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText("Unlocks after Workspace resource status is available.");
  }
  const verifyButton = creationRow(page, "shared-drive").getByRole("button", { name: "Verify Shared Drive" });
  await expect(verifyButton).toBeEnabled();
  await expect(verifyButton).not.toHaveAttribute("aria-describedby", /.+/);
  await verifyButton.click();
  expect(verifyRequest).toEqual({ method: "POST", body: null });
});

test("OAuth callback state is removed only after an automatic forced readiness refresh", async ({ page }) => {
  let readinessRequests = 0;
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    readinessRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace&google=connected");
  await expect(page.getByText("Google authorization completed. Current Workspace status is shown above.", { exact: true })).toBeVisible();
  await expect(page.getByText("Google was connected.", { exact: false })).toHaveCount(0);
  await expect.poll(() => readinessRequests).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/\/settings\?section=google-workspace$/);
});

test("administrator connection health expander preserves account, permissions, warnings, and keyboard access without duplicate status", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: e2eOrigin });
  const health: ConnectionHealthPayload = {
    runtimeMode: "workspace",
    simulation: false,
    enabledServices: ["drive", "gmail"],
    connection: {
      connected: false,
      status: "reauthorization-required",
      account: "de•••@connection-detail.example",
      services: { drive: false, gmail: false, calendar: false, sheets: false },
      grantedServices: { drive: true, gmail: false, calendar: true, sheets: false },
      requiresReauthorization: true,
    },
  };
  await mockConnectionHealth(page, health);
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readiness({
        connectionStatus: "reauthorization-required",
        connectionAccount: "summary-only@example.test",
        driveConnected: false,
        gmailConnected: false,
        calendarConnected: false,
        sheetsConnected: false,
        requiresReauthorization: true,
      })),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");

  const stageTwo = setupStage(page, 2);
  const card = stageTwo.locator("details.workspace-connection-health");
  const healthToggle = card.locator("summary");
  await expect(healthToggle.getByText("Connection health", { exact: true })).toBeVisible();
  await expect(healthToggle).toContainText("Account and recorded service permissions");
  await expect(card).not.toHaveAttribute("open", "");
  await expect(card.getByText(health.connection.account!, { exact: true })).toBeHidden();
  await expect(card.locator(".workspace-connection-service-table")).toBeHidden();

  await healthToggle.focus();
  await expect(healthToggle).toBeFocused();
  await healthToggle.press("Enter");
  await expect(card).toHaveAttribute("open", "");
  await expect(card).toContainText(health.connection.account!);
  await expect(card).not.toContainText("summary-only@example.test");
  await expect(healthToggle).not.toContainText(/Workspace|Reauthorization Required|Connected/);
  await expect(card.locator("dt")).toHaveCount(1);
  await expect(card.locator("dt")).toHaveText("Account");
  await expect(card.locator("dt")).not.toHaveText(/Mode|Status/);
  await expect(card.getByText("Reauthorization required:", { exact: true })).toBeVisible();
  await expect(card).toContainText("Disconnect this saved connection, then reconnect the exact approved account and approve every enabled service.");

  const expectedRows: Array<{ service: string; enabled: string; grant: string }> = [
    { service: "Shared Drive", enabled: "Enabled", grant: "Granted" },
    { service: "Gmail", enabled: "Enabled", grant: "Not granted" },
    { service: "Calendar", enabled: "Not enabled", grant: "Granted" },
    { service: "Sheets", enabled: "Not enabled", grant: "Not granted" },
  ];
  const rows = card.locator(".workspace-connection-service-table tbody tr");
  await expect(rows).toHaveCount(Object.keys(health.connection.grantedServices!).length);
  for (const expected of expectedRows) {
    const row = rows.filter({ hasText: expected.service });
    await expect(row.locator("td").nth(0)).toHaveText(expected.service);
    await expect(row.locator("td").nth(1)).toHaveText(expected.enabled);
    await expect(row.locator("td").nth(2)).toHaveText(expected.grant);
  }
  await expect(card).toContainText("It is not a live provider-health or freshness check.");
  await expect(stageTwo.getByRole("button", { name: "Disconnect Workspace" })).toBeVisible();
  await expect(stageTwo.getByRole("button", { name: "Reconnect Google Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Reconnect Google Workspace" })).toHaveCount(0);

  const stageThree = setupStage(page, 3);
  const resourcesCard = creationCard(page);
  await setStageExpanded(page, 3, true);
  await expect(resourcesCard).toBeVisible();
  await expect(stageTwo.locator("details.workspace-connection-health")).toHaveCount(1);
  await expect(stageTwo.getByRole("heading", { level: 3, name: "Company account authorization", exact: true })).toHaveCount(1);
  await expect(creationCard(page)).toHaveCount(1);
  await expect(stageThree.locator(".workspace-blueprint-card")).toHaveCount(1);
  await expect(stageThree.locator(".workspace-setup-step")).toHaveCount(0);
  await expect(resourcesCard).not.toContainText("op•••@cherryhillfci.com");
  await expect(resourcesCard).not.toContainText("operations@cherryhillfci.com");
  await expect(resourcesCard.locator("[data-workspace-creation-row]")).toHaveCount(5);
  await expect(resourcesCard.getByRole("button", { name: "Verify and adopt" })).toBeVisible();
  await expect(resourcesCard.getByRole("button", { name: "Verify and adopt" })).toBeDisabled();

  await setStageExpanded(page, 1, true);
  const stageOne = setupStage(page, 1);
  const tenantChecklist = stageOne.locator(".workspace-prerequisites");
  await expect(stageOne.locator(".workspace-env-note")).toHaveCount(1);
  await expect(stageOne.getByText("Drive authority:", { exact: true })).toBeVisible();
  await expect(stageOne.getByText("Sheets authority:", { exact: true })).toHaveCount(0);
  const runtimeConfiguration = stageOne.locator(
    'section[aria-labelledby="workspace-runtime-configuration-heading"]',
  );
  await expect(runtimeConfiguration).toHaveCount(1);
  await expect(runtimeConfiguration.getByRole("heading", { level: 4, name: "App-managed Workspace configuration" })).toBeVisible();
  await expect(runtimeConfiguration.getByText("Source: None", { exact: true })).toHaveCount(4);
  await expect(runtimeConfiguration.getByRole("button", { name: "Enable provisioning" })).toBeVisible();
  await expect(runtimeConfiguration.getByLabel("Client Directory spreadsheet ID")).toBeEnabled();
  await expect(runtimeConfiguration.getByLabel("Lead-form response spreadsheet ID")).toBeEnabled();
  await expect(runtimeConfiguration.getByRole("button", { name: "Verify and adopt" })).toHaveCount(2);
  await expect(runtimeConfiguration.getByRole("button", { name: "Verify and adopt" }).first()).toBeDisabled();
  await expect(runtimeConfiguration.getByRole("button", { name: "Verify and adopt" }).last()).toBeDisabled();
  for (const stageNumber of [2, 3, 4] as const) {
    await expect(setupStage(page, stageNumber).locator(".workspace-copy-helpers")).toHaveCount(0);
    await expect(setupStage(page, stageNumber).locator(".workspace-env-note")).toHaveCount(0);
  }
  await tenantChecklist.getByRole("button", { name: "Copy URI" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback");
  await tenantChecklist.getByRole("button", { name: "Copy missing-key template" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID=<field-schedule-calendar ID>");
  await tenantChecklist.getByRole("button", { name: "Copy command" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("openssl rand -base64 32");
});

test("administrator edits and saves a structured Workspace blueprint while system filing folders stay locked", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/blueprint");
  const blueprintApi = await mockWorkspaceBlueprint(page);
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageThreeSubsectionExpanded(page, "blueprint", true);
  await setStageExpanded(page, 2, true);

  const blueprintCard = page.locator(".workspace-blueprint-card");
  await expect(blueprintCard.getByRole("heading", { level: 3, name: "Blueprint" })).toBeVisible();
  await expect(creationCard(page)).toBeVisible();
  const connectionHealth = setupStage(page, 2).locator("details.workspace-connection-health");
  await expect(connectionHealth.locator("summary")).toBeVisible();
  await expect(connectionHealth).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(1);
  await expect(connectionHealth.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(0);
  await expect(blueprintCard.getByLabel("holidays calendar display name", { exact: true })).toHaveValue("FCI Holidays");

  const correspondence = blueprintCard.getByLabel("05_Correspondence folder name", { exact: true });
  await expect(correspondence).toBeDisabled();
  const correspondenceLock = blueprintCard.getByRole("button", { name: "05_Correspondence is locked", exact: true });
  await correspondenceLock.focus();
  await expect(correspondenceLock.locator("xpath=following-sibling::*[@role='tooltip']")).toContainText("renaming or removing it would break the filing contract", { ignoreCase: true });
  await expect(blueprintCard.getByLabel("client-directory spreadsheet role", { exact: true })).toBeDisabled();
  await expect(blueprintCard.getByLabel("client-directory spreadsheet role", { exact: true })).toHaveValue("system-mirror");

  await blueprintCard.getByLabel("01_Client Accounts folder name", { exact: true }).fill("01_Custom Clients");
  await blueprintCard.getByRole("button", { name: "Add template", exact: true }).click();
  await blueprintCard.getByLabel("new-template template name", { exact: true }).fill("Site Visit Packet");
  await blueprintCard.getByRole("button", { name: "Add spreadsheet", exact: true }).click();
  await expect(blueprintCard.getByLabel("new-spreadsheet spreadsheet role", { exact: true })).toHaveValue("reference");
  await blueprintCard.getByLabel("new-spreadsheet spreadsheet name", { exact: true }).fill("First-run Import");
  await blueprintCard.getByLabel("new-spreadsheet spreadsheet role", { exact: true }).selectOption("import");
  await expect(blueprintCard.getByRole("button", { name: "Save blueprint", exact: true })).toBeEnabled();
  let derivedResourcesReadsAfterSave = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/integrations/google/setup/resources") {
      derivedResourcesReadsAfterSave += 1;
    }
  });
  await blueprintCard.getByRole("button", { name: "Save blueprint", exact: true }).click();

  await expect(blueprintCard.getByText("Saved version 1", { exact: true })).toBeVisible();
  await expect(blueprintCard.getByText("All blueprint changes saved", { exact: true })).toBeVisible();
  await expect.poll(() => derivedResourcesReadsAfterSave).toBeGreaterThan(0);
  const reflected = await page.evaluate(async () => {
    const response = await fetch("/api/v1/integrations/google/setup/blueprint", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }) as { status: number; body: { blueprint: WorkspaceBlueprint; version: number } };
  expect(reflected.status).toBe(200);
  expect(reflected.body.version).toBe(1);
  expect(reflected.body.blueprint.drive.roots.find((folder) => folder.key === "client-accounts")?.name).toBe("01_Custom Clients");
  expect(reflected.body.blueprint.templates.at(-1)).toEqual(expect.objectContaining({ key: "new-template", name: "Site Visit Packet" }));
  expect(reflected.body.blueprint.spreadsheets.at(-1)).toEqual(expect.objectContaining({ key: "new-spreadsheet", name: "First-run Import", role: "import" }));
  expect(reflected.body.blueprint.drive.projectFolders.find((folder) => folder.key === "correspondence")?.name).toBe("05_Correspondence");
  expect(blueprintApi.current()).toEqual({ blueprint: reflected.body.blueprint, version: reflected.body.version });
});

test("a stale blueprint save preserves the local draft and requires loading the latest version", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/blueprint");
  const blueprintApi = await mockWorkspaceBlueprint(page);
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageThreeSubsectionExpanded(page, "blueprint", true);
  const blueprintCard = page.locator(".workspace-blueprint-card");
  const clientFolder = blueprintCard.locator(".workspace-blueprint-folder-row").filter({ hasText: "client-accounts" }).getByRole("textbox");
  await clientFolder.fill("01_Local Draft");

  const externallySaved = structuredClone(seedWorkspaceBlueprint()) as WorkspaceBlueprint;
  const externalClientFolder = externallySaved.drive.roots.find((folder) => folder.key === "client-accounts");
  if (!externalClientFolder) throw new Error("Seed blueprint is missing client-accounts.");
  externalClientFolder.name = "01_External Version";
  blueprintApi.replace(externallySaved, 1);

  await blueprintCard.getByRole("button", { name: "Save blueprint", exact: true }).click();
  const conflict = blueprintCard.getByRole("alert");
  await expect(conflict).toContainText("changed after this editor loaded", { ignoreCase: true });
  await expect(clientFolder).toHaveValue("01_Local Draft");
  await expect(blueprintCard.getByRole("button", { name: "Save blueprint", exact: true })).toBeDisabled();

  await clientFolder.fill("01_Local Draft Revised");
  await expect(conflict).toBeVisible();
  await expect(blueprintCard.getByRole("button", { name: "Save blueprint", exact: true })).toBeDisabled();
  await conflict.getByRole("button", { name: "Load latest (v1)", exact: true }).click();

  await expect(blueprintCard.getByLabel("01_External Version folder name", { exact: true })).toHaveValue("01_External Version");
  await expect(blueprintCard.getByText("Saved version 1", { exact: true })).toBeVisible();
  await expect(blueprintCard.getByText("All blueprint changes saved", { exact: true })).toBeVisible();
  await expect(blueprintCard.getByRole("alert")).toHaveCount(0);
});

test("blueprint save failures preserve the draft for retry and discard clears non-conflict errors", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/blueprint");
  const blueprintApi = await mockWorkspaceBlueprint(page);
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 2, true);
  await setStageThreeSubsectionExpanded(page, "blueprint", true);
  const blueprintCard = page.locator(".workspace-blueprint-card");
  const clientFolder = blueprintCard.locator(".workspace-blueprint-folder-row").filter({ hasText: "client-accounts" }).getByRole("textbox");
  await clientFolder.fill("01_Retry Clients");
  blueprintApi.failNextSave(503, "Temporary save failure.");
  await blueprintCard.getByRole("button", { name: "Save blueprint", exact: true }).click();

  await expect(blueprintCard.getByRole("alert")).toContainText("Temporary save failure.");
  await expect(clientFolder).toHaveValue("01_Retry Clients");
  await blueprintCard.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(blueprintCard.getByText("Saved version 1", { exact: true })).toBeVisible();

  await clientFolder.fill("01_Throwaway Draft");
  blueprintApi.failNextSave(503, "Another temporary failure.");
  await blueprintCard.getByRole("button", { name: "Save blueprint", exact: true }).click();
  await expect(blueprintCard.getByRole("alert")).toContainText("Another temporary failure.");
  await blueprintCard.getByRole("button", { name: "Discard changes", exact: true }).click();

  await expect(clientFolder).toHaveValue("01_Retry Clients");
  await expect(blueprintCard.getByRole("alert")).toHaveCount(0);
  await expect(blueprintCard.getByText("All blueprint changes saved", { exact: true })).toBeVisible();
  expect(blueprintApi.current().version).toBe(1);
});

test("simulation reset reloads the seed blueprint after deleting the saved simulation row", async ({ page }) => {
  const customized = structuredClone(seedWorkspaceBlueprint()) as WorkspaceBlueprint;
  const clientFolder = customized.drive.roots.find((folder) => folder.key === "client-accounts");
  if (!clientFolder) throw new Error("Seed blueprint is missing client-accounts.");
  clientFolder.name = "01_Custom Simulation Clients";

  await page.unroute("**/api/v1/integrations/google/setup/blueprint");
  const blueprintApi = await mockWorkspaceBlueprint(page, customized, 4);
  const simulationHealth: ConnectionHealthPayload = {
    ...connectedHealth(),
    runtimeMode: "simulation",
    simulation: true,
    connection: { ...connectedHealth().connection, account: "Local Workspace simulation", grantedServices: null },
  };
  await mockConnectionHealth(page, simulationHealth);
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness({ runtimeMode: "simulation", simulation: true })) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });
  await page.route("**/api/v1/integrations/google/simulation/reset", async (route) => {
    blueprintApi.replace(seedWorkspaceBlueprint(), 0);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reset: true, messages: 2, events: 0 }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 2, true);
  await setStageThreeSubsectionExpanded(page, "blueprint", true);
  const blueprintCard = page.locator(".workspace-blueprint-card");
  await expect(blueprintCard.getByLabel("01_Custom Simulation Clients folder name", { exact: true })).toBeVisible();
  const stageTwo = setupStage(page, 2);
  await expect(stageTwo.getByText("Simulation runs locally, and nothing is sent to Google. Reset restores the isolated sample Gmail, Calendar, Drive, and Sheets state.", { exact: true })).toBeVisible();
  await stageTwo.getByRole("button", { name: "Reset simulation data", exact: true }).click();

  await setStageExpanded(page, 3, true);
  await expect(blueprintCard.getByLabel("01_Client Accounts folder name", { exact: true })).toBeVisible();
  await expect(blueprintCard.getByText("Seed defaults · version 0", { exact: true })).toBeVisible();
  await expect(blueprintCard.getByText("All blueprint changes saved", { exact: true })).toBeVisible();
});

test("copy helpers do not claim configuration is complete when readiness is unavailable", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, workspaceResources({
    resources: workspaceResources().resources.map((resource) => ({
      ...resource,
      externalId: resource.externalId ?? `${resource.key}-id`,
      source: resource.source === "none" ? "env" : resource.source,
      state: resource.state === "Not configured" ? "Found" : resource.state,
    })),
  }));
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 1, true);

  const banner = page.locator(".workspace-status-banner");
  await expect(banner.locator(".workspace-status-mode")).toHaveText("UNAVAILABLE");
  await expect(banner.locator(".workspace-status-mode")).not.toHaveText(/SIMULATION|WORKSPACE/);
  await expect(banner.locator(".workspace-status-mode")).toHaveClass(/statusModeNeutral/);
  await expect(banner.locator(".workspace-status-progress")).toContainText("Current stage unavailable");
  await expect(banner.locator(".workspace-status-progress")).not.toContainText(/Stage [1-4] of 4/);
  await expectNeutralStageChips(page, "UNAVAILABLE");
  const tenantChecklist = page.locator(".workspace-prerequisites");
  await expect(tenantChecklist.getByText("Missing-key status is unavailable. Retry the readiness and Resources checks before copying configuration.", { exact: true })).toBeVisible();
  await expect(tenantChecklist.getByText("No hosted configuration keys are currently missing.", { exact: true })).toHaveCount(0);
  await expect(tenantChecklist.getByRole("button", { name: "Copy missing-key template" })).toHaveCount(0);
});

test("the status banner stays neutral when the Sheets status source errors", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page);
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
  });

  await page.goto("/settings?section=google-workspace");

  const banner = page.locator(".workspace-status-banner");
  await expect(banner.locator(".workspace-status-mode")).toHaveText("UNAVAILABLE");
  await expect(banner.locator(".workspace-status-mode")).not.toHaveText(/SIMULATION|WORKSPACE/);
  await expect(banner.locator(".workspace-status-mode")).toHaveClass(/statusModeNeutral/);
  await expect(banner.locator(".workspace-status-progress")).toContainText("Current stage unavailable");
  await expect(banner.locator(".workspace-status-progress")).not.toContainText(/Stage [1-4] of 4/);
  await expectNeutralStageChips(page, "UNAVAILABLE");
  await setStageExpanded(page, 4, true);
  await expect(verificationRow(page, "sheets")).toHaveAttribute("data-stage-four-state", "UNAVAILABLE");
  await expect(verificationRow(page, "sheets").getByText("UNAVAILABLE", { exact: true })).toBeVisible();
});

test("simulation labels every OAuth permission not applicable instead of claiming a grant", async ({ page }) => {
  const health: ConnectionHealthPayload = {
    runtimeMode: "simulation",
    simulation: true,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      connected: true,
      status: "connected",
      account: "Local Workspace simulation",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: null,
      requiresReauthorization: false,
    },
  };
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, workspaceResources({
    connectReady: true,
    simulation: true,
    resources: workspaceResources().resources.map((resource) => ({ ...resource, state: "Simulated" })),
    identity: {
      connectionAccount: "Local Workspace simulation",
      intakeMailboxMatches: true,
      allowedDomains: [],
      mode: "simulation",
    },
  }));
  await mockConnectionHealth(page, health);
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness({ runtimeMode: "simulation", simulation: true })) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 2, true);

  const banner = page.locator(".workspace-status-banner");
  await expect(banner.locator(".workspace-status-mode")).toHaveText("SIMULATION");
  await setStageExpanded(page, 3, true);
  await expect(setupStage(page, 3).getByText("Simulated", { exact: true })).toHaveCount(0);

  const stageTwo = setupStage(page, 2);
  await expect(stageTwo.getByText("Simulation runs locally, and nothing is sent to Google. Reset restores the isolated sample Gmail, Calendar, Drive, and Sheets state.", { exact: true })).toBeVisible();
  await expect(stageTwo.getByRole("button", { name: "Reset simulation data", exact: true })).toBeVisible();
  const card = stageTwo.locator("details.workspace-connection-health");
  const healthToggle = card.locator("summary");
  await expect(healthToggle).toBeVisible();
  await expect(card).not.toHaveAttribute("open", "");
  await expect(card.getByText("Local Workspace simulation", { exact: true })).toBeHidden();
  await healthToggle.focus();
  await healthToggle.press("Enter");
  await expect(card).toHaveAttribute("open", "");
  await expect(card).toContainText("Local Workspace simulation");
  await expect(card.locator(".workspace-connection-service-table tbody tr")).toHaveCount(4);
  await expect(card.getByText("Not applicable — simulated", { exact: true })).toHaveCount(4);
  await expect(card.getByText("Granted", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("Stage 3 maps raw simulation resource states to provenance-backed operational labels", async ({ page }) => {
  const simulationHealth: ConnectionHealthPayload = {
    runtimeMode: "simulation",
    simulation: true,
    enabledServices: ["drive", "gmail", "calendar", "sheets"],
    connection: {
      connected: true,
      status: "connected",
      account: "Local Workspace simulation",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      grantedServices: null,
      requiresReauthorization: false,
    },
  };
  const folderCase = (
    key: string,
    label: string,
    source: "app" | "env" | "none",
    origin: "created" | "adopted" | "env-adopted" | undefined,
    externalId: string | undefined,
  ): WorkspaceResourcesPayload["resources"][number] => ({
    key,
    resourceType: "drive.folder",
    label,
    name: label,
    blueprintName: label,
    management: "owner",
    parentKey: null,
    ...(externalId ? { externalId } : {}),
    source,
    ...(origin ? { origin } : {}),
    state: "Simulated",
  });
  const matrix = [
    { resource: folderCase("matrix-none", "No registry identity", "none", undefined, undefined), expected: "Not configured" },
    { resource: folderCase("matrix-missing-id", "Missing external ID", "app", "created", undefined), expected: "Not configured" },
    { resource: folderCase("matrix-created", "App-created folder", "app", "created", "created-id"), expected: "Created" },
    { resource: folderCase("matrix-adopted", "App-adopted folder", "app", "adopted", "adopted-id"), expected: "Adopted" },
    { resource: folderCase("matrix-env-adopted", "Environment-adopted folder", "app", "env-adopted", "env-adopted-id"), expected: "Adopted" },
    { resource: folderCase("matrix-app-unknown", "App folder without provenance", "app", undefined, "app-id"), expected: "Found" },
    { resource: folderCase("matrix-env", "Environment folder", "env", undefined, "environment-id"), expected: "Found" },
  ] as const;
  const sharedDrive = {
    ...workspaceResources().resources.find((resource) => resource.resourceType === "drive.shared-drive")!,
    source: "app" as const,
    origin: "adopted" as const,
    state: "Simulated" as const,
  };
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await mockWorkspaceResources(page, workspaceResources({
    resources: [sharedDrive, ...matrix.map(({ resource }) => resource)],
    simulation: true,
    identity: {
      connectionAccount: "Local Workspace simulation",
      intakeMailboxMatches: true,
      allowedDomains: [],
      mode: "simulation",
    },
  }));
  await mockConnectionHealth(page, simulationHealth);
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness({ runtimeMode: "simulation", simulation: true })) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-3");
  await setStageExpanded(page, 3, true);
  await expect(page.locator(".workspace-status-mode")).toHaveText("SIMULATION");
  const details = creationRow(page, "folder-tree").locator("details");
  await details.locator("summary").click();
  for (const { resource, expected } of matrix) {
    const row = details.locator("li").filter({ has: page.getByText(resource.label, { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator("[data-resource-operational-state]")).toHaveAttribute("data-resource-operational-state", expected);
    await expect(row.locator("[data-resource-operational-state]")).toHaveText(expected);
  }
  await expect(setupStage(page, 3).getByText("Simulated", { exact: true })).toHaveCount(0);
});

test("simulation reset removes the registry-backed resource and refreshes the creation list", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.goto("/settings?section=google-workspace");
  await setStageExpanded(page, 2, true);
  await setStageExpanded(page, 3, true);

  const spreadsheetDetails = creationRow(page, "spreadsheets").locator("details");
  await spreadsheetDetails.locator("summary").click();
  const directoryRow = spreadsheetDetails.locator("li").filter({ hasText: "Client directory spreadsheet" });
  // Unconditional again: this test used to skip its own precondition on retry
  // (`if (testInfo.retry === 0)`) because its first attempt destroyed the very
  // state the precondition reads. Teardown recovery repairs that instead, so the
  // precondition is real on every attempt.
  await expect(directoryRow).toContainText("App-managed");
  await expect(directoryRow).toContainText("Created");
  await expect(directoryRow.getByText("Simulated", { exact: true })).toHaveCount(0);

  const stageTwo = setupStage(page, 2);
  await expect(stageTwo.getByText("Simulation runs locally, and nothing is sent to Google. Reset restores the isolated sample Gmail, Calendar, Drive, and Sheets state.", { exact: true })).toBeVisible();
  // Marked BEFORE the click: this is the REAL reset endpoint and it wipes the
  // shared registry every later spec reads, so recovery must run even if the
  // click or an assertion below never returns.
  markResetAttempted();
  await stageTwo.getByRole("button", { name: "Reset simulation data" }).click();
  await setStageExpanded(page, 3, true);
  await expect(directoryRow).toContainText("Not configured");
  await expect(directoryRow).not.toContainText("App-managed");
  await expect(directoryRow.getByText("Simulated", { exact: true })).toHaveCount(0);
});

test("simulation creation journey adopts Drive, ensures roots, spreadsheets, and templates, then renames an owner folder", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.unroute("**/api/v1/integrations/google/setup/blueprint");
  const blueprint = structuredClone(seedWorkspaceBlueprint()) as WorkspaceBlueprint;
  blueprint.drive.roots.push({ key: "primary", name: "03_Primary Archive", management: "owner", children: [] });
  blueprint.spreadsheets.push(
    { key: "first-run-import", name: "First-run Import", targetFolderKey: "company-admin", management: "owner", role: "import" },
    { key: "project-ledger", name: "Project Ledger", targetFolderKey: "company-admin", management: "owner", role: "reference" },
  );
  const blueprintApi = await mockWorkspaceBlueprint(page, blueprint, 1);
  const folderResources: WorkspaceResourcesPayload["resources"] = [];
  const appendFolders = (
    folders: WorkspaceBlueprint["drive"]["roots"],
    parentKey: string | null,
    parentPath: string,
  ) => {
    for (const folder of folders) {
      const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      folderResources.push({
        key: folder.key,
        resourceType: "drive.folder",
        label: parentKey ? "Workspace subfolder" : "Root folder",
        name: folder.name,
        blueprintName: path,
        management: folder.management,
        parentKey,
        source: "none",
        state: "Simulated",
      });
      appendFolders(folder.children, folder.key, path);
    }
  };
  appendFolders(blueprint.drive.roots, null, "");
  const spreadsheetResources: WorkspaceResourcesPayload["resources"] = blueprint.spreadsheets.map((spreadsheet) => ({
    key: spreadsheet.key,
    resourceType: "sheets.spreadsheet",
    label: spreadsheet.role === "system-mirror" ? "Client directory spreadsheet" : spreadsheet.role === "import" ? "Import spreadsheet" : "Reference spreadsheet",
    name: spreadsheet.name,
    blueprintName: spreadsheet.name,
    management: spreadsheet.management,
    role: spreadsheet.role,
    parentKey: spreadsheet.targetFolderKey,
    source: "none",
    state: "Simulated",
  }));
  const templateResources: WorkspaceResourcesPayload["resources"] = blueprint.templates.map((template) => ({
    key: template.key,
    resourceType: "drive.file",
    label: template.kind === "sheet"
      ? "Spreadsheet template"
      : template.kind === "slides"
        ? "Presentation template"
        : "Document template",
    name: template.name,
    blueprintName: template.name,
    management: template.management,
    parentKey: "templates",
    source: "none",
    state: "Simulated",
  }));
  let resources: WorkspaceResourcesPayload["resources"] = [{
    key: "primary",
    resourceType: "drive.shared-drive",
    label: "Shared Drive",
    name: blueprint.drive.sharedDriveName,
    blueprintName: blueprint.drive.sharedDriveName,
    management: "owner",
    parentKey: null,
    source: "none",
    state: "Simulated",
  }, ...spreadsheetResources, ...templateResources, ...folderResources];
  const payload = (): WorkspaceResourcesPayload => ({
    resources,
    connectReady: true,
    simulation: true,
    identity: {
      connectionAccount: "Local Workspace simulation",
      intakeMailboxMatches: true,
      allowedDomains: [],
      mode: "simulation",
    },
  });
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload()) });
  });
  await page.route("**/api/v1/integrations/google/drive/shared-drive/adopt", async (route) => {
    resources = resources.map((resource) => resource.resourceType === "drive.shared-drive" ? {
      ...resource,
      externalId: "workspace-simulation-shared-drive",
      source: "app",
      origin: "adopted",
      restrictions: {
        adminManagedRestrictions: true,
        copyRequiresWriterPermission: true,
        domainUsersOnly: true,
        driveMembersOnly: true,
        sharingFoldersRequiresOrganizerPermission: true,
      },
    } : resource);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ adopted: true, verified: true, simulated: true, origin: "adopted" }),
    });
  });
  await page.route("**/api/v1/integrations/google/drive/folders/ensure-roots", async (route) => {
    resources = resources.map((resource) => resource.resourceType === "drive.folder" ? {
      ...resource,
      externalId: `workspace-simulation-folder-${resource.key}`,
      source: "app",
      origin: "created",
    } : resource);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ensured: true, simulated: true, counts: { found: 0, created: folderResources.length, adopted: 0 } }),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/ensure", async (route) => {
    resources = resources.map((resource) => resource.resourceType === "sheets.spreadsheet" ? {
      ...resource,
      externalId: resource.key === "client-directory" ? "workspace-simulation-directory-sheet" : `workspace-simulation-spreadsheet-${resource.key}`,
      url: `/settings?section=google-workspace&workspace-simulation=spreadsheet-${resource.key}`,
      source: "app",
      origin: "created",
    } : resource);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ensured: true, simulated: true, counts: { found: 0, created: spreadsheetResources.length, adopted: 0 } }),
    });
  });
  await page.route("**/api/v1/integrations/google/drive/templates/ensure", async (route) => {
    resources = resources.map((resource) => resource.resourceType === "drive.file" ? {
      ...resource,
      externalId: `workspace-simulation-template-${resource.key}`,
      url: `/settings?section=google-workspace&workspace-simulation=template-${resource.key}`,
      source: "app",
      origin: "created",
    } : resource);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ensured: true, simulated: true, counts: { found: 0, created: templateResources.length, adopted: 0 } }),
    });
  });
  await page.route("**/api/v1/integrations/google/drive/folders/rename", async (route) => {
    const body = route.request().postDataJSON() as { key: string; name: string };
    const updated = structuredClone(blueprintApi.current().blueprint) as WorkspaceBlueprint;
    const folder = updated.drive.roots.find((candidate) => candidate.key === body.key);
    if (!folder) throw new Error(`Missing test folder ${body.key}`);
    folder.name = body.name;
    blueprintApi.replace(updated, blueprintApi.current().version + 1);
    resources = resources.map((resource) => resource.resourceType === "drive.folder" && resource.key === body.key ? {
      ...resource,
      name: body.name,
      blueprintName: body.name,
    } : resource);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ renamed: true, simulated: true, key: body.key, folder: { id: `workspace-simulation-folder-${body.key}`, name: body.name } }),
    });
  });
  const health: ConnectionHealthPayload = {
    ...connectedHealth(),
    runtimeMode: "simulation",
    simulation: true,
    connection: { ...connectedHealth().connection, account: "Local Workspace simulation", grantedServices: null },
  };
  await mockConnectionHealth(page, health);
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness({ runtimeMode: "simulation", simulation: true })) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace");
  const resourcesCard = creationCard(page);
  await expect(resourcesCard.getByRole("button", { name: "Find and adopt" })).toHaveCount(1);
  await resourcesCard.getByRole("button", { name: "Find and adopt" }).click();
  await expect(resourcesCard.getByText("External sharing restricted to the Workspace domain", { exact: true })).toBeVisible();
  await expect(resourcesCard.getByRole("button", { name: "Ensure root folders" })).toBeEnabled();

  await resourcesCard.getByRole("button", { name: "Ensure root folders" }).click();
  await resourcesCard.getByRole("button", { name: "Ensure spreadsheets" }).first().click();
  await resourcesCard.getByRole("button", { name: "Ensure templates" }).first().click();
  await setStageExpanded(page, 3, true);
  const spreadsheetDetails = creationRow(page, "spreadsheets").locator("details");
  await spreadsheetDetails.locator("summary").click();
  const importRow = spreadsheetDetails.locator("li").filter({ hasText: "First-run Import" });
  const referenceRow = spreadsheetDetails.locator("li").filter({ hasText: "Project Ledger" });
  await expect(importRow).toContainText("App-managed");
  await expect(referenceRow).toContainText("App-managed");
  await expect(importRow.getByRole("link", { name: "Open" })).toBeVisible();
  await expect(referenceRow.getByRole("link", { name: "Open" })).toBeVisible();
  const templateDetails = creationRow(page, "templates").locator("details");
  await templateDetails.locator("summary").click();
  const estimateTemplateRow = templateDetails.locator("li").filter({ hasText: "Estimate Proposal" });
  const budgetTemplateRow = templateDetails.locator("li").filter({ hasText: "Project Budget" });
  await expect(estimateTemplateRow).toContainText("App-managed");
  await expect(budgetTemplateRow).toContainText("App-managed");
  await expect(estimateTemplateRow.getByRole("link", { name: "Open" })).toBeVisible();
  await expect(budgetTemplateRow.getByRole("link", { name: "Open" })).toBeVisible();
  await setStageExpanded(page, 4, true);
  const folderDetails = upkeepRow(page, "renames").locator("details");
  await folderDetails.locator("summary").click();
  const clientRow = folderDetails.locator("li").filter({ hasText: "01_Client Accounts" });
  await expect(clientRow.getByRole("button", { name: "Rename" })).toBeVisible();
  const collidingFolderRow = folderDetails.locator("li").filter({ hasText: "03_Primary Archive" });
  await expect(collidingFolderRow.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(collidingFolderRow.getByRole("button", { name: /adopt/i })).toHaveCount(0);

  await clientRow.getByRole("button", { name: "Rename" }).click();
  await clientRow.getByRole("textbox", { name: "New name for 01_Client Accounts" }).fill("01_Custom Clients");
  await clientRow.getByRole("button", { name: "Save name" }).click();
  await expect(folderDetails.locator("li").filter({ hasText: "01_Custom Clients" })).toBeVisible();
  await setStageThreeSubsectionExpanded(page, "blueprint", true);
  await expect(page.locator(".workspace-blueprint-card").getByLabel("01_Custom Clients folder name", { exact: true })).toBeVisible();
});

test("HINT-02-A blueprint naming hints keep audited copy, anchors, and keyboard dismissal", async ({ page }) => {
  await mockWorkspaceBlueprint(page);
  await mockWorkspaceResources(page, workspaceResources());
  await mockConnectionHealth(page, connectedHealth());
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness()) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: unsyncedMirror() }) });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-3");
  await setStageThreeSubsectionExpanded(page, "blueprint", true);
  const editor = page.locator(".workspace-blueprint-card");
  const expected = [
    {
      label: "About client folder pattern",
      text: "A naming template. The tokens listed below are replaced with real client values when the folder is later created.",
    },
    {
      label: "About project folder pattern",
      text: "A naming template. The required tokens below are replaced with real project values when setup later creates the folder.",
    },
  ] as const;
  const descriptionIds: string[] = [];

  await expect(
    editor.getByRole("button", { name: expected[0].label, exact: true }),
  ).toHaveAccessibleDescription(expected[0].text);

  for (const hint of expected) {
    const trigger = editor.getByRole("button", { name: hint.label, exact: true });
    const descriptionId = await trigger.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    descriptionIds.push(descriptionId!);
    const tooltip = page.locator(`[id="${descriptionId}"]`);
    await expect(tooltip).toHaveAttribute("role", "tooltip");
    await expect(tooltip).toHaveText(hint.text);
    await expect(tooltip).toBeHidden();
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }

  expect(new Set(descriptionIds).size).toBe(descriptionIds.length);
  await expect(editor.getByRole("textbox", { name: "Client folder pattern", exact: true })).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Project folder pattern", exact: true })).toBeVisible();
});
