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

test("Administrator identity keeps protected Settings actions available", async ({ page }) => {
  await mockIdentityForExternalServer(page, true);
  await page.route("**/api/v1/integrations/google/setup/blueprint", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ blueprint: seedWorkspaceBlueprint(), version: 0, seeded: true }) });
  });
  await page.goto("/settings?section=calendar");
  await expect(page.getByRole("heading", { level: 2, name: "Calendar & appointments" })).toBeVisible();

  const identity = await readIdentity(page);
  expect(identity).toEqual({ status: 200, body: expect.objectContaining({ isAdmin: true }) });
  await expect(page.locator(".settings-nav").getByText("Workspace & company setup", { exact: true })).toBeVisible();
  await expect(page.locator(".settings-nav").getByRole("button")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Save calendar plan" })).toBeEnabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(0);

  await page.locator(".settings-nav").getByRole("button", { name: "Google Workspace", exact: true }).click();
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
  await expect(page.locator(".workspace-prerequisites, .workspace-connection-health, .workspace-blueprint-card, .administrator-action-note")).toHaveCount(0);
  await page.getByRole("button", { name: /account actions/i }).click();
  await expect(page.locator("#account-actions-popover").getByRole("button", { name: "Google connection" })).toHaveCount(0);
  expect(connectionDetailGets).toBe(0);
  expect(resourceGets).toBe(0);
  expect(blueprintGets).toBe(0);
  expect(workspaceSettingsGets).toBe(0);
  expect(workspaceReadinessGets).toBe(0);
});
