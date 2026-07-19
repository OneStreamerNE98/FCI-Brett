import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const operationsRoutes = [
  "/",
  "/leads",
  "/leads?stage=new-inquiry",
  "/clients",
  "/projects",
  "/projects?status=mobilizing",
  "/schedule",
  "/inbox",
  "/assistant",
  "/reports",
  "/settings",
  "/settings?section=google-workspace",
  "/settings?section=inbox-rules",
  "/management/access",
] as const;

for (const route of operationsRoutes) {
  test(`${route} has no serious or critical accessibility violations at desktop and 390px`, async ({ page }) => {
    if (route === "/") {
      await page.route("**/api/v1/leads", async (requestRoute) => {
        if (requestRoute.request().method() === "GET") {
          await requestRoute.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              leads: [{
                id: "fci-test-accessibility-lead",
                leadNumber: "FCI-TEST-ACCESSIBILITY-LEAD",
                company: "FCI TEST — DO NOT USE — Accessibility lead",
                contactName: "FCI TEST — DO NOT USE — Contact",
                projectName: "Accessible pipeline row",
                source: "Website",
                stage: "New inquiry",
                site: "102 FCI TEST Ave, Cherry Hill, NJ",
                estimatedValue: 18000,
                nextAction: "Review keyboard behavior",
                status: "active",
              }],
            }),
          });
          return;
        }
        await requestRoute.continue();
      });
    }

    for (const viewport of [
      { label: "desktop", width: 1280, height: 720 },
      { label: "390px", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const actionableListName = route === "/"
        ? "Lead pipeline records"
        : route === "/clients"
          ? "Client directory"
          : route.startsWith("/projects")
            ? "Projects"
            : null;
      if (actionableListName) {
        const actionableList = page.getByRole("list", { name: actionableListName });
        await expect(actionableList).toBeVisible();
        await expect(actionableList.getByRole("listitem").first()).toBeVisible();
      }
      if (route === "/settings?section=inbox-rules") {
        const rulesTable = page.getByRole("table", { name: "Inbox & file rules" });
        await expect(rulesTable).toBeVisible();
        await expect(rulesTable.getByRole("button", { name: /^(Pause|Enable)$/ }).first()).toBeVisible();
      }

      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );

      expect(violations, `${route} at ${viewport.label}\n${JSON.stringify(violations, null, 2)}`).toEqual([]);
    }
  });
}
