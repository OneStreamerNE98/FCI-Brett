import { expect, test, type Page } from "@playwright/test";

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
    label: string;
    blueprintName: string;
    externalId?: string;
    source: "app" | "env" | "none";
    origin?: "created" | "adopted" | "env-adopted";
    url?: string;
    updatedAt?: number;
    state: "Found" | "Created" | "Adopted" | "Not configured" | "Simulated";
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

const missingInvariant = "Google Workspace intake mailbox matching the single approved connection account";

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

function workspaceResources(overrides: Partial<WorkspaceResourcesPayload> = {}): WorkspaceResourcesPayload {
  return {
    resources: [
      { key: "primary", label: "Shared Drive", blueprintName: "FCI Operations", externalId: "drive-id", source: "env", state: "Found" },
      { key: "client-directory", label: "Client directory spreadsheet", blueprintName: "FCI Operations Directory", externalId: "sheet-id", source: "app", origin: "created", state: "Created" },
      { key: "client-appointments", label: "Client appointments calendar", blueprintName: "FCI • Client Appointments", externalId: "appointments-id", source: "env", state: "Found" },
      { key: "field-schedule", label: "Field schedule calendar", blueprintName: "FCI • Field Schedule", source: "none", state: "Not configured" },
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

test.beforeEach(async ({ page }) => {
  await mockWorkspaceResources(page);
});

function step(page: Page, heading: string) {
  return page.locator(".workspace-setup-step").filter({ has: page.getByRole("heading", { level: 3, name: heading, exact: true }) });
}

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
    envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS",
    secret: false,
  }];
  let mirror = unsyncedMirror();

  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(workspaceResources({ connectReady: currentReadiness.credentialsPresent })),
    });
  });

  await mockConnectionHealth(page, connectedHealth());

  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentReadiness) });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror }) });
  });
  await page.route("**/api/v1/integrations/google/drive/verify", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verified: true }) });
  });
  await page.route("**/api/v1/integrations/google/gmail/labels/prepare", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prepared: true }) });
  });
  await page.route("**/api/v1/integrations/google/calendar/events", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) });
  });
  await page.route("**/api/v1/integrations/google/sheets/sync", async (route) => {
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
  await expect(page.getByRole("table", { name: "Hosted Workspace configuration" })).toBeVisible();
  await expect(page.getByText(missingInvariant, { exact: true })).toBeVisible();
  await expect(step(page, "Connect Google Workspace").locator(".workspace-step-status")).toHaveText("Blocked by prerequisites");
  await expect(step(page, "Verify the Shared Drive").locator(".workspace-step-status")).toHaveText("Blocked by previous step");
  await expect(page.getByRole("button", { name: "Verify Shared Drive" })).toBeDisabled();

  currentReadiness = readiness();
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(step(page, "Connect Google Workspace").locator(".workspace-step-status")).toHaveText("Complete");
  await expect(step(page, "Verify the Shared Drive").locator(".workspace-step-status")).toHaveText("Ready");
  await expect(page.getByRole("table", { name: "Hosted Workspace configuration" })).toHaveCount(0);

  await page.getByRole("button", { name: "Verify Shared Drive" }).click();
  await expect(step(page, "Verify the Shared Drive").locator(".workspace-step-status")).toHaveText("Complete");
  await expect(step(page, "Prepare Gmail").locator(".workspace-step-status")).toHaveText("Ready");

  await page.getByRole("button", { name: "Prepare FCI labels" }).click();
  await expect(step(page, "Prepare Gmail").locator(".workspace-step-status")).toHaveText("Complete");
  await expect(step(page, "Verify Calendar").locator(".workspace-step-status")).toHaveText("Ready");

  await page.getByRole("button", { name: "View upcoming events" }).click();
  await expect(step(page, "Verify Calendar").locator(".workspace-step-status")).toHaveText("Complete");
  await expect(step(page, "Sync the Sheets mirror").locator(".workspace-step-status")).toHaveText("Ready");

  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(step(page, "Sync the Sheets mirror").locator(".workspace-step-status")).toHaveText("Complete");
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
  await expect(page.getByText("Google was connected. Workspace readiness refreshed automatically.", { exact: true })).toBeVisible();
  await expect.poll(() => readinessRequests).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/\/settings\?section=google-workspace$/);
});

test("administrator connection health exhaustively maps account, mode, status, enabled services, and recorded grants", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:4173" });
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

  const card = page.locator(".workspace-connection-health");
  await expect(card.getByRole("heading", { level: 3, name: "Connection health" })).toBeVisible();
  await expect(card).toContainText(health.connection.account!);
  await expect(card).not.toContainText("summary-only@example.test");
  const summary = card.locator(".workspace-connection-health-summary");
  await expect(summary).toContainText("Workspace");
  await expect(summary).toContainText("Reauthorization Required");
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
  await expect(page.locator(".workspace-connection-card-actions").getByRole("button", { name: "Disconnect Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reconnect Google Workspace" })).toBeVisible();

  const setupSteps = page.locator("ol.workspace-setup-steps");
  const resourcesCard = page.locator(".workspace-resources-card");
  await expect(resourcesCard).toBeVisible();
  await expect(setupSteps).toBeVisible();
  expect(await resourcesCard.evaluate((resources) => {
    const steps = document.querySelector("ol.workspace-setup-steps");
    const health = document.querySelector(".workspace-connection-health");
    return Boolean(
      steps
      && health
      && resources.parentElement === steps.parentElement
      && health.parentElement === steps.parentElement
      && (steps.compareDocumentPosition(resources) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
  })).toBe(true);
  await expect(resourcesCard).toContainText("op•••@cherryhillfci.com");
  await expect(resourcesCard).not.toContainText("operations@cherryhillfci.com");
  await expect(resourcesCard.locator(".workspace-resource-table tbody tr")).toHaveCount(4);
  await expect(resourcesCard.locator(".workspace-resource-table button")).toHaveCount(0);

  await resourcesCard.getByRole("button", { name: "Copy URI" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback");
  await resourcesCard.getByRole("button", { name: "Copy missing-key template" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID=<field-schedule-calendar ID>");
  await resourcesCard.getByRole("button", { name: "Copy command" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("openssl rand -base64 32");
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

  const resourcesCard = page.locator(".workspace-resources-card");
  await expect(resourcesCard.getByText("Missing-key status is unavailable. Retry the readiness and Resources checks before copying configuration.", { exact: true })).toBeVisible();
  await expect(resourcesCard.getByText("No hosted configuration keys are currently missing.", { exact: true })).toHaveCount(0);
  await expect(resourcesCard.getByRole("button", { name: "Copy missing-key template" })).toHaveCount(0);
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

  const card = page.locator(".workspace-connection-health");
  await expect(card.getByText("Simulated", { exact: true }).first()).toBeVisible();
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

test("simulation reset removes the registry-backed resource and refreshes the Resources card", async ({ page }, testInfo) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.goto("/settings?section=google-workspace");

  const resourcesCard = page.locator(".workspace-resources-card");
  const directoryRow = resourcesCard.locator(".workspace-resource-table tbody tr").filter({ hasText: "Client directory spreadsheet" });
  if (testInfo.retry === 0) await expect(directoryRow).toContainText("App-managed");
  await expect(directoryRow).toContainText("Simulated");

  await page.getByRole("button", { name: "Reset simulation data" }).click();
  await expect(directoryRow).toContainText("—");
  await expect(directoryRow).not.toContainText("App-managed");
  await expect(directoryRow).toContainText("Simulated");
});
