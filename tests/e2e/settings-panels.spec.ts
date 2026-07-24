import { expect, test } from "@playwright/test";

const settingsSections = [
  { path: "/settings", navigation: "My settings", heading: "My settings" },
  { path: "/settings?section=google-workspace", navigation: "Google Workspace", heading: "Google Workspace" },
  { path: "/settings?section=calendar", navigation: "Calendar & appointments", heading: "Calendar & appointments" },
  { path: "/settings?section=inbox-rules", navigation: "Inbox & file rules", heading: "Inbox & file rules" },
  { path: "/settings?section=client-directory", navigation: "Client Directory", heading: "Client Directory & Project Register" },
  { path: "/settings?section=workflow-notifications", navigation: "Workflow & notifications", heading: "Workflow & notifications" },
  { path: "/settings?section=data-security", navigation: "Data & security", heading: "Data & security" },
  { path: "/settings?section=testing-launch", navigation: "Testing & launch", heading: "Test & launch checklist" },
] as const;

for (const section of settingsSections) {
  test(`${section.navigation} renders at desktop and phone widths`, async ({ page }) => {
    const browserIssues: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserIssues.push(`console.error: ${message.text()}`);
    });
    page.on("pageerror", (error) => browserIssues.push(`pageerror: ${error.stack ?? error.message}`));

    if (section.navigation === "Testing & launch") {
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
