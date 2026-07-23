import { expect, test, type Page } from "@playwright/test";
import { seedWorkspaceBlueprint } from "../../app/lib/workspace-blueprint";

async function readIdentity(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/settings/me", { headers: { Accept: "application/json" } });
    return { status: response.status, body: await response.json() as { isAdmin?: boolean } };
  });
}

async function mockIdentityForExternalServer(page: Page, isAdmin: boolean) {
  if (process.env.FCI_E2E_EXTERNAL_SERVER !== "true") return;
  await page.route("**/api/v1/settings/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preferences: {
          displayTimezone: "America/New_York",
          replySignature: "",
          notificationPreferences: {
            "lead.created": false,
            "gmail.filing_review_needed": false,
            "calendar.schedule_changed": false,
            "project.warranty_follow_up_due": false,
          },
        },
        updatedAt: null,
        isAdmin,
      }),
    });
  });
  await page.route("**/api/v1/settings/workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        settings: {
          timezone: "America/New_York",
          appointmentCalendarName: "FCI • Client Appointments",
          fieldCalendarName: "FCI • Field Schedule",
          calendarSetupMode: "create-shared",
          appointmentCalendarId: "",
          fieldCalendarId: "",
          calendarEditPolicy: "app-authoritative",
          appointmentReminderHours: 24,
          crewReminderHours: 24,
          inboxReviewMode: "review-first",
          officeNotificationEmail: "",
        },
        updatedAt: null,
      }),
    });
  });
}

async function expectConservativeSettingsPresentation(page: Page) {
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByRole("heading", { level: 2, name: "My settings" })).toBeVisible();

  const mainNavigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(mainNavigation.getByRole("link", { name: "People & Access · In development" })).toHaveCount(0);
  const settingsNavigation = page.locator(".settings-nav");
  await expect(settingsNavigation.getByRole("button")).toHaveCount(1);
  await expect(settingsNavigation.getByRole("button", { name: "My settings", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(settingsNavigation.getByText("Workspace & company setup", { exact: true })).toHaveCount(0);
  await expect(page.locator(".workspace-status-banner, .workspace-setup-stage, .workspace-prerequisites, .workspace-connection-health, .workspace-blueprint-card, .administrator-action-note")).toHaveCount(0);

  await page.locator(".workspace-card").click();
  const workspaceMenu = page.locator("#workspace-actions-popover");
  await expect(workspaceMenu.getByRole("button", { name: "Client Directory" })).toBeVisible();
  for (const adminDestination of ["Directory sync", "Google Workspace", "Testing & launch"]) {
    await expect(workspaceMenu.getByRole("button", { name: adminDestination, exact: true })).toHaveCount(0);
  }
  await page.locator(".workspace-card").click();
  await page.getByRole("button", { name: /account actions/i }).click();
  const accountMenu = page.locator("#account-actions-popover");
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole("button", { name: "Google connection" })).toHaveCount(0);
}

test("Administrator identity keeps protected Settings actions available", async ({ page }) => {
  await mockIdentityForExternalServer(page, true);
  await page.route("**/api/v1/integrations/google/setup/blueprint", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ blueprint: seedWorkspaceBlueprint(), version: 0, seeded: true }) });
  });
  const initialIdentityRead = page.waitForResponse((response) => (
    response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/v1/settings/me"
  ));
  await page.goto("/settings?section=calendar");
  await initialIdentityRead;
  await expect(page.getByRole("heading", { level: 2, name: "Calendar & appointments" })).toBeVisible();

  const identity = await readIdentity(page);
  expect(identity).toEqual({ status: 200, body: expect.objectContaining({ isAdmin: true }) });
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "People & Access · In development" })).toBeVisible();
  const accountActions = page.locator(".profile");
  await accountActions.click();
  await expect(page.locator("#account-actions-popover").getByRole("button", { name: "Google connection" })).toBeVisible();
  await accountActions.click();
  await page.locator(".workspace-card").click();
  const workspaceMenu = page.locator("#workspace-actions-popover");
  await expect(workspaceMenu.getByRole("button", { name: "Client Directory" })).toBeVisible();
  await expect(workspaceMenu.getByRole("button", { name: "Directory sync" })).toBeVisible();
  await expect(workspaceMenu.getByRole("button", { name: "Google Workspace" })).toBeVisible();
  await expect(workspaceMenu.getByRole("button", { name: "Testing & launch" })).toBeVisible();
  await page.locator(".workspace-card").click();
  await expect(page.locator(".settings-nav").getByText("Workspace & company setup", { exact: true })).toBeVisible();
  await expect(page.locator(".settings-nav").getByRole("button")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Save calendar plan" })).toBeEnabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(0);

  await page.locator(".settings-nav").getByRole("button", { name: "Google Workspace", exact: true }).click();
  await expect(page.locator(".workspace-status-copy > strong")).not.toHaveText("Checking current status…");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const stageTwoToggle = page.locator('.workspace-setup-stage[data-workspace-stage="2"] .workspace-stage-toggle');
  if (await stageTwoToggle.getAttribute("aria-expanded") !== "true") await stageTwoToggle.click();
  await expect(stageTwoToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Reset simulation data" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Check readiness" })).toBeEnabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(0);
});

test("Office identity sees My settings only and never renders company or Administrator cards", async ({ page }) => {
  await mockIdentityForExternalServer(page, false);
  let connectionDetailGets = 0;
  let resourceGets = 0;
  let blueprintGets = 0;
  let workspaceSettingsGets = 0;
  let workspaceReadinessGets = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/integrations/google/connection") connectionDetailGets += 1;
    if (request.method() === "GET" && url.pathname === "/api/v1/integrations/google/setup/resources") resourceGets += 1;
    if (request.method() === "GET" && url.pathname === "/api/v1/integrations/google/setup/blueprint") blueprintGets += 1;
    if (request.method() === "GET" && url.pathname === "/api/v1/settings/workspace") workspaceSettingsGets += 1;
    if (request.method() === "GET" && url.pathname === "/api/v1/google-workspace") workspaceReadinessGets += 1;
  });
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/settings?section=calendar");
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByRole("heading", { level: 2, name: "My settings" })).toBeVisible();

  const identity = await readIdentity(page);
  expect(identity).toEqual({ status: 200, body: expect.objectContaining({ isAdmin: false }) });
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "People & Access · In development" })).toHaveCount(0);
  const navigation = page.locator(".settings-nav");
  await expect(navigation.getByRole("button")).toHaveCount(1);
  await expect(navigation.getByRole("button", { name: "My settings", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByText("Workspace & company setup", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-settings-audience="personal"]')).toBeVisible();
  await expect(page.locator('[data-session-profile="true"]')).toContainText("E2E Office");
  await expect(page.locator('[data-session-profile="true"]')).toContainText("e2e-office@example.test");
  await expect(page.locator('[data-preference-consumer="planned"]')).toHaveCount(4);
  await expect(page.locator('[data-preference-consumer="planned"] .feature-state-planned')).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Save my settings" })).toBeEnabled();
  for (const heading of ["Google Workspace", "Calendar & appointments", "Workflow & notifications", "Data & security", "Test & launch checklist"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
  }
  await expect(page.locator(".workspace-status-banner, .workspace-setup-stage, .workspace-prerequisites, .workspace-connection-health, .workspace-blueprint-card, .administrator-action-note")).toHaveCount(0);
  await page.locator(".workspace-card").click();
  const workspaceMenu = page.locator("#workspace-actions-popover");
  await expect(workspaceMenu.getByRole("button", { name: "Client Directory" })).toBeVisible();
  for (const adminDestination of ["Directory sync", "Google Workspace", "Testing & launch"]) {
    await expect(workspaceMenu.getByRole("button", { name: adminDestination, exact: true })).toHaveCount(0);
  }
  await page.locator(".workspace-card").click();
  await page.getByRole("button", { name: /account actions/i }).click();
  const accountMenu = page.locator("#account-actions-popover");
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole("button", { name: "Google connection" })).toHaveCount(0);
  expect(connectionDetailGets).toBe(0);
  expect(resourceGets).toBe(0);
  expect(blueprintGets).toBe(0);
  expect(workspaceSettingsGets).toBe(0);
  expect(workspaceReadinessGets).toBe(0);
});

test("a failed settings identity read removes Administrator affordances from shell and content together", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-admin@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Admin"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.route("**/api/v1/settings/me", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "temporary" }),
    });
  });

  await page.goto("/settings?section=calendar");
  await expectConservativeSettingsPresentation(page);
});

test("a malformed settings identity payload also fails closed", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-admin@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Admin"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.route("**/api/v1/settings/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preferences: { displayTimezone: "America/New_York", pageLayouts: {} },
        isAdmin: "true",
      }),
    });
  });

  await page.goto("/settings?section=calendar");
  await expectConservativeSettingsPresentation(page);
});
