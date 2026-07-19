import { expect, test } from "@playwright/test";

const settingsSections = [
  { path: "/settings", navigation: "My account", heading: "My account" },
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
