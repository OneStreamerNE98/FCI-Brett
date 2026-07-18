import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const operationsRoutes = [
  "/",
  "/leads",
  "/clients",
  "/projects",
  "/inbox",
  "/assistant",
  "/reports",
  "/settings",
  "/management/access",
] as const;

for (const route of operationsRoutes) {
  test(`${route} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
}
