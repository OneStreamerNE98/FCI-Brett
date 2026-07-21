import { expect, test, type Page } from "@playwright/test";
import { seedWorkspaceBlueprint, type WorkspaceBlueprint } from "../../app/lib/workspace-blueprint";

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
    resourceType?: "drive.shared-drive" | "drive.folder" | "drive.file" | "sheets.spreadsheet" | "calendar.calendar";
    label: string;
    name?: string;
    blueprintName: string;
    management?: "owner" | "system";
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
      { key: "primary", resourceType: "drive.shared-drive", label: "Shared Drive", name: "FCI Operations", blueprintName: "FCI Operations", management: "owner", parentKey: null, externalId: "drive-id", source: "env", state: "Found" },
      { key: "client-directory", resourceType: "sheets.spreadsheet", label: "Client directory spreadsheet", name: "FCI Operations Directory", blueprintName: "FCI Operations Directory", management: "system", parentKey: "company-admin", externalId: "sheet-id", source: "app", origin: "created", state: "Created" },
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

function step(page: Page, heading: string) {
  return page.locator(".workspace-setup-step").filter({ has: page.getByRole("heading", { level: 3, name: heading, exact: true }) });
}

function tenantChecklistRow(page: Page, title: string) {
  return page.locator(".workspace-prerequisites li").filter({ has: page.getByText(title, { exact: true }) });
}

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
  await expect(tenantChecklistRow(page, "Company domain")).toContainText("Setup required");
  await expect(tenantChecklistRow(page, "Operations account")).toContainText("Setup required");
  await expect(tenantChecklistRow(page, "Workspace APIs")).toContainText("Manual check");
  await expect(tenantChecklistRow(page, "OAuth web client")).toContainText("Setup required");
  await expect(tenantChecklistRow(page, "Hosted secrets")).toContainText("Setup required");
  await expect(tenantChecklistRow(page, "Role-aligned Google Groups")).toContainText("Manual check");
  await expect(card.getByRole("link")).toHaveCount(6);
  await expect(card.getByRole("table", { name: "Hosted Workspace configuration" })).toBeVisible();
  await expect(card.getByRole("heading", { level: 4, name: "Copy-exact setup helpers" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 4, name: "Copy-exact setup helpers" })).toHaveCount(1);
  await expect(card.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Collapse" })).toHaveCount(0);

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
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(tenantChecklistRow(page, "Company domain")).toContainText("Configuration present");
  await expect(tenantChecklistRow(page, "Operations account")).toContainText("Configuration present");
  await expect(tenantChecklistRow(page, "OAuth web client")).toContainText("Partially configured");
  await expect(tenantChecklistRow(page, "Hosted secrets")).toContainText("Partially configured");

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
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(tenantChecklistRow(page, "Operations account")).toContainText("Ready to connect");
  await expect(tenantChecklistRow(page, "OAuth web client")).toContainText("Ready to connect");
  await expect(tenantChecklistRow(page, "Hosted secrets")).toContainText("Secrets present");
  await expect(card.getByText("All required hosted values are present.", { exact: true })).toBeVisible();
  await expect(card.getByText("Restricted", { exact: true })).toBeVisible();

  resourcesShouldFail = true;
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(card.getByText("Not verified", { exact: true })).toBeVisible();
  await expect(card.getByText("Restricted", { exact: true })).toHaveCount(0);
  resourcesShouldFail = false;

  currentReadiness = readiness();
  currentResources = workspaceResources({ resources: appManagedResources });
  currentHealth = connectedHealth();
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(tenantChecklistRow(page, "Operations account")).toContainText("Account matched");
  await expect(tenantChecklistRow(page, "OAuth web client")).toContainText("Connected");
  await expect(card.getByRole("button", { name: "Collapse" })).toBeVisible();
  await card.getByRole("button", { name: "Collapse" }).click();
  await expect(card.getByRole("listitem")).toHaveCount(0);
  await card.getByRole("button", { name: "Expand" }).click();
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
  await expect(resourcesCard.getByRole("button", { name: "Verify and adopt" })).toBeVisible();
  await expect(resourcesCard.getByRole("button", { name: "Adopt first" })).toBeDisabled();

  const tenantChecklist = page.locator(".workspace-prerequisites");
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

  const blueprintCard = page.locator(".workspace-blueprint-card");
  await expect(blueprintCard.getByRole("heading", { level: 3, name: "Blueprint" })).toBeVisible();
  await expect(page.locator(".workspace-resources-card")).toBeVisible();
  await expect(page.locator(".workspace-connection-health")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect Workspace" })).toHaveCount(1);
  await expect(blueprintCard.getByLabel("holidays calendar display name", { exact: true })).toHaveValue("FCI Holidays");

  const correspondence = blueprintCard.getByLabel("05_Correspondence folder name", { exact: true });
  await expect(correspondence).toBeDisabled();
  const correspondenceLock = blueprintCard.getByRole("button", { name: "05_Correspondence is locked", exact: true });
  await correspondenceLock.focus();
  await expect(correspondenceLock.locator("xpath=following-sibling::*[@role='tooltip']")).toContainText("renaming or removing it would break the filing contract", { ignoreCase: true });

  await blueprintCard.getByLabel("01_Client Accounts folder name", { exact: true }).fill("01_Custom Clients");
  await blueprintCard.getByRole("button", { name: "Add template", exact: true }).click();
  await blueprintCard.getByLabel("new-template template name", { exact: true }).fill("Site Visit Packet");
  await expect(blueprintCard.getByRole("button", { name: "Save blueprint", exact: true })).toBeEnabled();
  await blueprintCard.getByRole("button", { name: "Save blueprint", exact: true }).click();

  await expect(blueprintCard.getByText("Saved version 1", { exact: true })).toBeVisible();
  await expect(blueprintCard.getByText("All blueprint changes saved", { exact: true })).toBeVisible();
  const reflected = await page.evaluate(async () => {
    const response = await fetch("/api/v1/integrations/google/setup/blueprint", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  }) as { status: number; body: { blueprint: WorkspaceBlueprint; version: number } };
  expect(reflected.status).toBe(200);
  expect(reflected.body.version).toBe(1);
  expect(reflected.body.blueprint.drive.roots.find((folder) => folder.key === "client-accounts")?.name).toBe("01_Custom Clients");
  expect(reflected.body.blueprint.templates.at(-1)).toEqual(expect.objectContaining({ key: "new-template", name: "Site Visit Packet" }));
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
  const blueprintCard = page.locator(".workspace-blueprint-card");
  await expect(blueprintCard.getByLabel("01_Custom Simulation Clients folder name", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset simulation data", exact: true }).click();

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

  const tenantChecklist = page.locator(".workspace-prerequisites");
  await expect(tenantChecklist.getByText("Missing-key status is unavailable. Retry the readiness and Resources checks before copying configuration.", { exact: true })).toBeVisible();
  await expect(tenantChecklist.getByText("No hosted configuration keys are currently missing.", { exact: true })).toHaveCount(0);
  await expect(tenantChecklist.getByRole("button", { name: "Copy missing-key template" })).toHaveCount(0);
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

test("simulation Resources journey adopts the Shared Drive, ensures blueprint roots, and renames an owner folder", async ({ page }) => {
  await page.unroute("**/api/v1/integrations/google/setup/resources");
  await page.unroute("**/api/v1/integrations/google/setup/blueprint");
  const blueprint = structuredClone(seedWorkspaceBlueprint()) as WorkspaceBlueprint;
  blueprint.drive.roots.push({ key: "primary", name: "03_Primary Archive", management: "owner", children: [] });
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
  }, ...folderResources];
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
  const resourcesCard = page.locator(".workspace-resources-card");
  await expect(resourcesCard.getByRole("button", { name: "Find and adopt" })).toHaveCount(1);
  await resourcesCard.getByRole("button", { name: "Find and adopt" }).click();
  await expect(resourcesCard.getByText("External sharing restricted to the Workspace domain", { exact: true })).toBeVisible();
  await expect(resourcesCard.getByRole("button", { name: "Ensure root folders" })).toBeEnabled();

  await resourcesCard.getByRole("button", { name: "Ensure root folders" }).click();
  const clientRow = resourcesCard.locator(".workspace-resource-table tbody tr").filter({ hasText: "01_Client Accounts" });
  await expect(clientRow.getByRole("button", { name: "Rename" })).toBeVisible();
  const collidingFolderRow = resourcesCard.locator(".workspace-resource-table tbody tr").filter({ hasText: "03_Primary Archive" });
  await expect(collidingFolderRow.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(collidingFolderRow.getByRole("button", { name: /adopt/i })).toHaveCount(0);

  await clientRow.getByRole("button", { name: "Rename" }).click();
  await clientRow.getByRole("textbox", { name: "New name for 01_Client Accounts" }).fill("01_Custom Clients");
  await clientRow.getByRole("button", { name: "Save name" }).click();
  await expect(resourcesCard.locator(".workspace-resource-table tbody tr").filter({ hasText: "01_Custom Clients" })).toBeVisible();
  await expect(page.locator(".workspace-blueprint-card").getByLabel("01_Custom Clients folder name", { exact: true })).toBeVisible();
});
