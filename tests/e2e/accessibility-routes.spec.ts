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
  "/management/access",
] as const;

for (const route of operationsRoutes) {
  test(`${route} has no serious or critical accessibility violations at desktop and 390px`, async ({ page }) => {
    for (const viewport of [
      { label: "desktop", width: 1280, height: 720 },
      { label: "390px", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );

      expect(violations, `${route} at ${viewport.label}\n${JSON.stringify(violations, null, 2)}`).toEqual([]);
    }
  });
}
