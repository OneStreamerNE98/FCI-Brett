import { expect, test, type Page } from "@playwright/test";

const defaults = {
  leads: { view: "board", sortKey: "client", sortDirection: "ascending" },
  clients: { sortKey: "client", sortDirection: "ascending" },
  projects: { sortKey: "project", sortDirection: "ascending" },
} as const;

async function resetRecordListPreferences(page: Page) {
  const result = await page.evaluate(async (recordListPreferences) => {
    const response = await fetch("/api/v1/settings/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordListPreferences }),
    });
    return { ok: response.ok, body: await response.text() };
  }, defaults);
  expect(result.ok, result.body).toBe(true);
}

test("DES-15 keeps the Leads board default, compact controls, and per-user view at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [{
      id: "fci-test-des15-lead",
      leadNumber: "FCI-TEST-DES15",
      company: "FCI TEST — DO NOT USE — DES-15 lead",
      contactName: "FCI TEST — DO NOT USE — Contact",
      projectName: "Record-list verification",
      source: "Website",
      stage: "New inquiry",
      site: "101 FCI TEST Ave, Cherry Hill, NJ",
      estimatedValue: 42000,
      nextAction: "Verify the persisted list view",
      status: "active",
    }] }) });
  });
  await page.goto("/leads");
  await resetRecordListPreferences(page);
  await page.reload();

  await expect(page.locator(".board")).toBeVisible();
  await expect(page.getByLabel("Lead view").getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".leads-list-toolbar .record-list-mobile-sort")).toBeVisible();
  await page.getByLabel("Lead view").getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("list", { name: "Active leads" })).toBeVisible();
  await expect(page.locator(".pipeline-head").first()).toBeHidden();

  await page.reload();
  await expect(page.getByLabel("Lead view").getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  const search = page.getByRole("textbox", { name: "Find a lead" });
  await search.fill("DES-15 no matching lead");
  await expect(page.getByRole("heading", { name: /No active leads match/u })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("list", { name: "Active leads" })).toBeVisible();
});

test("DES-15 exposes sortable Client headers and live search at 834px", async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1000 });
  await page.goto("/clients");
  await resetRecordListPreferences(page);
  await page.reload();

  const clientHeader = page.getByRole("columnheader", { name: /Client/u }).first();
  await expect(clientHeader).toBeVisible();
  await expect(clientHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(clientHeader.getByRole("button")).toBeEnabled();
  await clientHeader.getByRole("button").click();
  await expect(clientHeader).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator(".client-directory-toolbar .record-list-mobile-sort")).toBeHidden();

  await page.getByRole("textbox", { name: "Find a client" }).fill("DES-15 no matching client");
  await expect(page.locator(".client-directory .empty-table")).toContainText("No clients match");
});

test("DES-15 exposes sortable Project headers and live search at 1280px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/projects");
  await resetRecordListPreferences(page);
  await page.reload();

  const valueHeader = page.getByRole("columnheader", { name: /Value/u });
  await expect(valueHeader).toBeVisible();
  await expect(valueHeader).toHaveAttribute("aria-sort", "none");
  await expect(valueHeader.getByRole("button")).toBeEnabled();
  await valueHeader.getByRole("button").click();
  await expect(valueHeader).toHaveAttribute("aria-sort", "ascending");

  await page.getByRole("textbox", { name: "Find a project" }).fill("DES-15 no matching project");
  await expect(page.locator(".projects-table .empty-table")).toContainText("No projects match");
});
