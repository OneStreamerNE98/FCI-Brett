import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function simulationReadiness() {
  return {
    credentialsPresent: true,
    missing: [],
    missingDetails: [],
    workspace: {
      runtimeMode: "simulation",
      simulation: true,
      storageName: "FCI Operations (local simulation)",
      storageConfigured: true,
      connectionStatus: "connected",
      connectionAccount: "Local Workspace simulation",
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
  };
}

function simulationConnection() {
  return {
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
}

function completedResources() {
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
        externalId: "workspace-simulation",
        source: "app",
        origin: "adopted",
        state: "Simulated",
      },
      {
        key: "client-accounts",
        resourceType: "drive.folder",
        label: "Root folder",
        name: "01_Client Accounts",
        blueprintName: "01_Client Accounts",
        management: "owner",
        parentKey: null,
        externalId: "folder-client-accounts",
        source: "app",
        origin: "created",
        state: "Simulated",
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
        externalId: "sheet-client-directory",
        source: "app",
        origin: "created",
        state: "Simulated",
      },
      {
        key: "estimate-proposal",
        resourceType: "drive.file",
        label: "Document template",
        name: "Estimate Proposal",
        blueprintName: "Estimate Proposal",
        management: "owner",
        parentKey: "templates",
        externalId: "template-estimate",
        source: "app",
        origin: "created",
        state: "Simulated",
      },
    ],
    connectReady: true,
    simulation: true,
    identity: {
      connectionAccount: "Local Workspace simulation",
      intakeMailboxMatches: true,
      allowedDomains: ["cherryhillfci.com"],
      mode: "simulation",
    },
  };
}

async function installWorkspaceFrameMocks(page: Page) {
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(simulationReadiness()),
    });
  });
  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(simulationConnection()),
    });
  });
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(completedResources()),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mirror: {
          configured: true,
          enabled: true,
          connected: true,
          spreadsheetUrl: null,
          spreadsheetName: null,
          clients: { status: "not-synced", lastSyncedAt: null, lastError: null },
          projects: { status: "not-synced", lastSyncedAt: null, lastError: null },
          lastSyncedAt: null,
          reason: null,
          source: "app",
        },
      }),
    });
  });
  await page.route("**/api/v1/integrations/google/gmail/messages?label=needs-review&verification=status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [], labelReady: true, testEmailPassed: true }),
    });
  });
  await page.route("**/api/v1/integrations/google/calendar/events?verification=status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [], verificationPassed: true }),
    });
  });
}

async function expandStage(page: Page, number: 3 | 4) {
  await expect(page.locator(".workspace-status-copy > strong")).not.toHaveText("Checking current status…");
  const toggle = page.locator(`[data-workspace-stage="${number}"] .workspace-stage-toggle`);
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function resetAndProvisionSimulationWorkspace(page: Page) {
  await page.evaluate(async () => {
    const post = async (url: string) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
      }
    };
    await post("/api/v1/integrations/google/simulation/reset");
    await post("/api/v1/integrations/google/drive/shared-drive/adopt");
    await post("/api/v1/integrations/google/drive/folders/ensure-roots");
    await post("/api/v1/integrations/google/sheets/ensure");
    await post("/api/v1/integrations/google/drive/templates/ensure");
  });
}

test("review-first reconcile creates a newly defined folder and never deletes a removed one", async ({ page }) => {
  await installWorkspaceFrameMocks(page);
  const providerMutationRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/v1/integrations/google/")
      && request.method() !== "GET"
    ) {
      providerMutationRequests.push({ method: request.method(), url: request.url() });
    }
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-3");
  try {
    await resetAndProvisionSimulationWorkspace(page);
    await page.reload();
    await expandStage(page, 3);
    const blueprintDisclosure = page.locator('[data-stage-three-subsection="blueprint"]');
    const blueprintToggle = blueprintDisclosure.getByRole("button", {
      name: /^(?:Expand|Collapse) Blueprint$/u,
    });
    if (await blueprintToggle.getAttribute("aria-expanded") !== "true") await blueprintToggle.click();

    const roots = blueprintDisclosure.getByRole("group", { name: "Shared Drive roots", exact: true });
    await roots.getByRole("button", { name: "Add folder", exact: true }).click();
    await roots.getByLabel("New folder folder name", { exact: true }).fill("FCI TEST Reconcile Folder");
    await blueprintDisclosure.getByRole("button", { name: "Save blueprint", exact: true }).click();
    await expect(blueprintDisclosure.getByText("All blueprint changes saved", { exact: true })).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "workspace-stage-4";
    });
    await expandStage(page, 4);
    const driftCard = page.locator('[data-stage-four-upkeep="drift"]');
    await driftCard.getByRole("button", { name: "Check for drift", exact: true }).click();
    const missing = driftCard.locator('[data-workspace-reconcile-row][data-workspace-reconcile-state="missing"]');
    await expect(missing).toContainText("FCI TEST Reconcile Folder");
    await missing.getByRole("button", { name: "Create from blueprint", exact: true }).click();
    await expect(page.locator(".toast.toast-success")).toContainText(
      "FCI TEST Reconcile Folder was reviewed and the matching setup ensure action completed.",
    );
    await expect(driftCard.getByText("Blueprint and Google resources are in sync.", { exact: true })).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "workspace-stage-3";
    });
    await expandStage(page, 3);
    if (await blueprintToggle.getAttribute("aria-expanded") !== "true") await blueprintToggle.click();
    await blueprintDisclosure.getByRole("button", {
      name: "Remove FCI TEST Reconcile Folder folder",
      exact: true,
    }).click();
    await blueprintDisclosure.getByRole("button", { name: "Save blueprint", exact: true }).click();
    await expect(blueprintDisclosure.getByText("All blueprint changes saved", { exact: true })).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "workspace-stage-4";
    });
    await expandStage(page, 4);
    await driftCard.getByRole("button", { name: "Check again", exact: true }).click();
    const unmanaged = driftCard.locator('[data-workspace-reconcile-row][data-workspace-reconcile-state="unmanaged"]');
    await expect(unmanaged).toContainText("FCI TEST Reconcile Folder");
    await expect(unmanaged).toContainText("Informational only — nothing will be deleted.");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileGeometry = await driftCard.evaluate((card) => {
      const action = card.querySelector("button");
      return {
        cardContained: card.scrollWidth <= card.clientWidth,
        documentContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        actionHeight: action?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(mobileGeometry.cardContained).toBe(true);
    expect(mobileGeometry.documentContained).toBe(true);
    expect(mobileGeometry.actionHeight).toBeGreaterThanOrEqual(44);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-stage-four-upkeep="drift"]')
      .analyze();
    expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    expect(providerMutationRequests.some(({ method, url }) => (
      method === "DELETE"
      || /(?:\/delete|:delete)(?:[/?]|$)/u.test(url)
    ))).toBe(false);
  } finally {
    await resetAndProvisionSimulationWorkspace(page);
  }
});

test("renamed rows expose the owner/system action matrix and send the exact reviewed Drive identity", async ({ page }) => {
  await installWorkspaceFrameMocks(page);
  let reconcileCalls = 0;
  let renameBody: unknown = null;
  await page.route("**/api/v1/integrations/google/setup/reconcile", async (route) => {
    reconcileCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reconcileCalls === 1
        ? {
          reconciled: true,
          simulated: true,
          blueprintVersion: 7,
          checkedAt: Date.now(),
          counts: { missing: 0, renamed: 2, unmanaged: 0, inSync: 0 },
          drift: [
            {
              id: "renamed-owner-folder",
              state: "renamed",
              resourceType: "drive.folder",
              key: "projects",
              label: "Root folder",
              management: "owner",
              expectedName: "02_Projects",
              actualName: "Projects from Drive",
              externalId: "projects-folder",
              url: "https://drive.google.test/projects-folder",
              detail: "Google uses “Projects from Drive”; the blueprint expects “02_Projects”.",
              actions: ["rename-drive", "adopt-blueprint-name"],
            },
            {
              id: "renamed-system-folder",
              state: "renamed",
              resourceType: "drive.folder",
              key: "unsorted-intake",
              label: "Root folder",
              management: "system",
              expectedName: "99_Unsorted Intake",
              actualName: "Manual intake name",
              externalId: "intake-folder",
              url: "https://drive.google.test/intake-folder",
              detail: "Google uses “Manual intake name”; the blueprint expects “99_Unsorted Intake”.",
              actions: ["rename-drive"],
            },
          ],
        }
        : {
          reconciled: true,
          simulated: true,
          blueprintVersion: 7,
          checkedAt: Date.now(),
          counts: { missing: 0, renamed: 0, unmanaged: 0, inSync: 2 },
          drift: [],
        }),
    });
  });
  await page.route("**/api/v1/integrations/google/drive/folders/rename", async (route) => {
    renameBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ renamed: true }),
    });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  await expandStage(page, 4);
  const driftCard = page.locator('[data-stage-four-upkeep="drift"]');
  await driftCard.getByRole("button", { name: "Check for drift", exact: true }).click();
  const ownerRow = driftCard.locator('[data-workspace-reconcile-row="renamed-owner-folder"]');
  const systemRow = driftCard.locator('[data-workspace-reconcile-row="renamed-system-folder"]');
  await expect(ownerRow.getByRole("button", { name: "Rename in Drive", exact: true })).toBeVisible();
  await expect(ownerRow.getByRole("button", { name: "Use Drive name in blueprint", exact: true })).toBeVisible();
  await expect(systemRow.getByRole("button", { name: "Rename in Drive", exact: true })).toBeVisible();
  await expect(systemRow.getByRole("button", { name: "Use Drive name in blueprint", exact: true })).toHaveCount(0);

  await systemRow.getByRole("button", { name: "Rename in Drive", exact: true }).click();
  await expect(driftCard.getByText("Blueprint and Google resources are in sync.", { exact: true })).toBeVisible();
  expect(renameBody).toEqual({
    key: "unsorted-intake",
    mode: "reconcile-drive-name",
    expectedVersion: 7,
    externalId: "intake-folder",
    actualName: "Manual intake name",
  });
});

test("reconcile failures state the no-mutation guarantee once and never contradict a completed repair", async ({ page }) => {
  await installWorkspaceFrameMocks(page);
  let reconcileCall = 0;
  await page.route("**/api/v1/integrations/google/setup/reconcile", async (route) => {
    reconcileCall += 1;
    if (reconcileCall !== 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Workspace drift could not be checked. No Google resource was changed.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reconciled: true,
        simulated: true,
        blueprintVersion: 1,
        checkedAt: Date.now(),
        counts: { missing: 1, renamed: 0, unmanaged: 0, inSync: 0 },
        drift: [{
          id: "missing-drive-folder-fci-test-reconcile",
          state: "missing",
          resourceType: "drive.folder",
          key: "fci-test-reconcile",
          label: "Root folder",
          management: "owner",
          expectedName: "FCI TEST Reconcile Folder",
          actualName: null,
          externalId: null,
          url: null,
          detail: "The blueprint resource is not present in Google.",
          actions: ["ensure-folders"],
        }],
      }),
    });
  });
  await page.route("**/api/v1/integrations/google/drive/folders/ensure-roots", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ensured: true,
        reconciled: true,
        resourceKey: "fci-test-reconcile",
        version: 1,
      }),
    });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  await expandStage(page, 4);
  const drift = page.locator('[data-stage-four-upkeep="drift"]');
  await drift.getByRole("button", { name: "Check for drift", exact: true }).click();
  await expect(drift.getByRole("alert")).toHaveText(
    "Workspace drift could not be checked. No Google resource was changed.",
  );

  await drift.getByRole("button", { name: "Check for drift", exact: true }).click();
  await drift.getByRole("button", { name: "Create from blueprint", exact: true }).click();
  await expect(drift.getByRole("alert")).toHaveText(
    "The action completed, but Workspace drift could not be refreshed: Workspace drift could not be checked.",
  );
  await expect(drift.getByRole("alert")).not.toContainText("No Google resource was changed.");
});

test("registered Calendar drift stays unavailable when the live connection cannot read Calendar", async ({ page }) => {
  await installWorkspaceFrameMocks(page);
  const account = "operations@cherryhillfci.com";
  const readiness = simulationReadiness();
  readiness.workspace = {
    ...readiness.workspace,
    runtimeMode: "workspace",
    simulation: false,
    connectionAccount: account,
    calendarConnected: false,
    calendarEnabled: false,
    enabledServices: ["drive", "gmail", "sheets"],
  };
  const connection = simulationConnection();
  connection.runtimeMode = "workspace";
  connection.simulation = false;
  connection.enabledServices = ["drive", "gmail", "sheets"];
  connection.connection.account = account;
  connection.connection.services.calendar = false;
  const resources = completedResources();
  resources.simulation = false;
  resources.identity.connectionAccount = account;
  resources.identity.mode = "workspace";
  resources.resources = resources.resources.map((resource) => ({
    ...resource,
    state: resource.resourceType === "drive.shared-drive" ? "Adopted" : "Created",
  }));
  resources.resources.push({
    key: "client-appointments",
    resourceType: "calendar.calendar",
    label: "Workspace calendar",
    name: "FCI Client Appointments",
    blueprintName: "FCI Client Appointments",
    management: "system",
    parentKey: null,
    externalId: "appointments@example.com",
    source: "app",
    origin: "created",
    state: "Created",
  });

  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readiness) });
  });
  await page.route("**/api/v1/integrations/google/connection", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(connection) });
  });
  await page.route("**/api/v1/integrations/google/setup/resources", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resources) });
  });

  await page.goto("/settings?section=google-workspace#workspace-stage-4");
  await expandStage(page, 4);
  const drift = page.locator('[data-stage-four-upkeep="drift"]');
  await expect(drift).toContainText("UNAVAILABLE");
  await expect(drift.getByRole("button", { name: "Check for drift", exact: true })).toBeDisabled();
  await expect(drift.getByRole("button", { name: "Check for drift", exact: true }))
    .toHaveAttribute("aria-describedby", "workspace-reconcile-unavailable-description");
  await expect(drift).toContainText(
    "Calendar is registered but unavailable to this connection. Enable Calendar before checking all registered Workspace resources.",
  );
});
