import { expect, test, type Page } from "@playwright/test";

async function mockSettingsFeatureState(page: Page, ready: boolean) {
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        workspace: {
          connectionStatus: ready ? "connected" : "disconnected",
          calendarEnabled: ready,
          calendarConnected: ready,
          calendars: {
            clientAppointments: { configured: ready, source: ready ? "app" : "none", externalId: ready ? "appointments@example.test" : null },
            fieldSchedule: { configured: ready, source: ready ? "app" : "none", externalId: ready ? "schedule@example.test" : null },
          },
        },
      }),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        mirror: {
          configured: ready,
          enabled: ready,
          connected: ready,
        },
      }),
    });
  });
}

const settingsSections = [
  { path: "/settings", navigation: "My settings", heading: "My settings" },
  { path: "/settings?section=google-workspace", navigation: "Google Workspace", heading: "Google Workspace" },
  { path: "/settings?section=calendar", navigation: "Calendar & appointments", heading: "Calendar & appointments" },
  { path: "/settings?section=inbox-rules", navigation: "Inbox & file rules", heading: "Inbox & file rules" },
  { path: "/settings?section=client-directory", navigation: "Client Directory & Project Register", heading: "Client Directory & Project Register" },
  { path: "/settings?section=workflow-notifications", navigation: "Workflow & notifications", heading: "Workflow & notifications" },
  { path: "/settings?section=ai-assistant", navigation: "AI assistant", heading: "AI assistant" },
  { path: "/settings?section=data-security", navigation: "Data & security", heading: "Data & security" },
  { path: "/settings?section=testing-launch", navigation: "Test & launch checklist", heading: "Test & launch checklist" },
] as const;

for (const section of settingsSections) {
  test(`${section.navigation} renders at desktop and phone widths`, async ({ page }) => {
    const browserIssues: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserIssues.push(`console.error: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserIssues.push(`pageerror: ${error.stack ?? error.message}`));

    if (section.navigation === "Test & launch checklist") {
      await page.route("**/api/v1/settings/employee-login-readiness", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({
            employeeLogin: {
              configuration: {
                state: "unconfigured",
                configuredCount: 0,
                totalCount: 4,
                requirements: [
                  { name: "FCI_EMPLOYEE_OIDC_CLIENT_ID", configured: false },
                  { name: "FCI_EMPLOYEE_OIDC_CLIENT_SECRET or FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE", configured: false },
                  { name: "FCI_EMPLOYEE_OIDC_REDIRECT_URI", configured: false },
                  { name: "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN", configured: false },
                ],
              },
              activationGate: {
                state: "owner-approval-required",
                active: false,
              },
            },
          }),
        });
      });
      await page.route("**/api/v1/admin/access", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({
            data: {
              summary: {
                activePeopleCount: 0,
                activeAdministratorCount: 0,
                pendingInvitationCount: 0,
              },
            },
          }),
        });
      });
    }

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(section.path);
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: section.heading, exact: true })).toBeVisible();
      await expect(page.locator(".settings-nav").getByRole("button", { name: section.navigation, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".settings-data-notice.loading, .phone-install-loading")).toHaveCount(0);
      if (viewport.width === 390) await expect(page.locator(".main-area")).toHaveCSS("margin-left", "0px");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${section.path} must not overflow at ${viewport.width}px`).toBe(true);
    }

    expect(browserIssues, browserIssues.join("\n\n")).toEqual([]);
  });
}

test("SET-07 computes only endpoint-backed states and keeps build badges out of the Settings nav", async ({ page }) => {
  await mockSettingsFeatureState(page, false);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/settings");

  const expectedStates = new Map([
    ["My settings", "Working"],
    ["Google Workspace", "In development"],
    ["Calendar & appointments", "Setup required"],
    ["Inbox & file rules", "In development"],
    ["Client Directory & Project Register", "Setup required"],
    ["Workflow & notifications", "In development"],
    ["AI assistant", "In development"],
    ["Data & security", "Planned"],
    ["Test & launch checklist", "In development"],
  ] as const);
  const navigation = page.locator(".settings-nav");
  await expect(navigation.getByRole("button")).toHaveCount(expectedStates.size);
  for (const [label, state] of expectedStates) {
    const button = navigation.getByRole("button", { name: label, exact: true });
    await expect(button).toHaveAttribute("data-settings-feature-state", state);
  }
  // DES-16: build status is not user-facing. The computed state stays a data attribute; the
  // administrator nav must never render a FeatureStateBadge, compact or otherwise.
  await expect(navigation.locator(".feature-state")).toHaveCount(0);
  for (const buildWord of ["Working", "Dev", "Setup", "Planned"]) {
    await expect(navigation.getByText(buildWord, { exact: true })).toHaveCount(0);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(navigation).toBeVisible();
  await expect(navigation.locator(".feature-state")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const readyPage = await page.context().newPage();
  await mockSettingsFeatureState(readyPage, true);
  await readyPage.setViewportSize({ width: 1280, height: 720 });
  await readyPage.goto("/settings");
  const readyNavigation = readyPage.locator(".settings-nav");
  await expect(readyNavigation.getByRole("button", { name: "Calendar & appointments", exact: true }))
    .toHaveAttribute("data-settings-feature-state", "Working");
  await expect(readyNavigation.getByRole("button", { name: "Client Directory & Project Register", exact: true }))
    .toHaveAttribute("data-settings-feature-state", "Working");
  await expect(readyNavigation.getByRole("button", { name: "Data & security", exact: true }))
    .toHaveAttribute("data-settings-feature-state", "Planned");
  await readyPage.close();
});

test("SET-07 reads the Sheet mirror once per admin Settings load", async ({ page }) => {
  // Regression pin: the nav derives Client Directory readiness from the mirror the app shell
  // already loaded. When it fetched sheets/status itself, admin Settings issued two reads —
  // the shell's raw fetch cannot dedupe against client-get-cache — which desynchronised every
  // spec that mocks this endpoint as an ordered sequence (fix15 N7-7, SET-11).
  let mirrorReads = 0;
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    mirrorReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        mirror: {
          configured: true,
          enabled: true,
          connected: true,
          spreadsheetUrl: null,
          spreadsheetName: "FCI TEST — DO NOT USE",
          clients: { status: "synced", lastSyncedAt: 1, lastError: null },
          projects: { status: "synced", lastSyncedAt: 1, lastError: null },
          lastSyncedAt: 1,
          reason: null,
          source: "app",
        },
      }),
    });
  });

  await page.goto("/settings?section=client-directory");
  // Wait for the read to have been consumed by both the panel and the nav row before counting.
  await expect(page.getByRole("region", { name: "Client Directory & Project Register" })).toBeVisible();
  await expect(page.locator(".settings-nav").getByRole("button", { name: "Client Directory & Project Register", exact: true }))
    .toHaveAttribute("data-settings-feature-state", "Working");
  expect(mirrorReads).toBe(1);
});
