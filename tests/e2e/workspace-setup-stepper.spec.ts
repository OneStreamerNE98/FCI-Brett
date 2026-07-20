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

async function mockConnectionHealth(page: Page, payload: ConnectionHealthPayload) {
  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      return;
    }
    await route.continue();
  });
}

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
  await expect(card.getByRole("heading", { level: 4, name: "Connection health" })).toBeVisible();
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
  await expect(card.getByRole("button", { name: "Disconnect Workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reconnect Google Workspace" })).toBeVisible();
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
