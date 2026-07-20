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
