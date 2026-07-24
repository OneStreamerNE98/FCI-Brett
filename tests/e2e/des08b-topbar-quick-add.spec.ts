import { expect, test } from "@playwright/test";

test("Overview removes the topbar quick-add while Leads keeps lead creation", async ({ page }) => {
  await page.goto("/");
  const topbar = page.locator("header.topbar");
  await expect(topbar).toBeVisible();
  await expect(topbar.getByRole("button", { name: "Add lead" })).toHaveCount(0);

  await page.goto("/leads");
  await expect(page.getByRole("heading", { level: 1, name: "Leads & opportunities" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add lead" })).toBeVisible();
});
