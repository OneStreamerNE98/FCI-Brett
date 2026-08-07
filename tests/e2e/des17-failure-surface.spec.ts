import { expect, test } from "@playwright/test";

test("a deliberate descendant render failure shows recovery instead of a blank page", async ({ page }) => {
  test.skip(
    process.env.FCI_E2E_EXTERNAL_SERVER === "true",
    "The render-failure fixture is served only by the isolated local Vite runtime.",
  );
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Search workspace" })).toBeVisible();

  await page.evaluate(async () => {
    const fixturePath = "/tests/e2e/fixtures/des17-boundary-probe.tsx";
    const fixture = await import(/* @vite-ignore */ fixturePath) as {
      mountDes17BoundaryProbe: () => void;
    };
    fixture.mountDes17BoundaryProbe();
  });

  const recovery = page.locator('[data-des17-boundary-probe="true"]');
  await expect(recovery.getByRole("heading", { name: "This page could not be displayed" })).toBeVisible();
  await expect(recovery).toContainText("check its current status before repeating it.");
  await recovery.getByRole("button", { name: "Reload page" }).click();
  await expect(page.getByRole("combobox", { name: "Search workspace" })).toBeVisible();
  await expect(page.locator('[data-des17-boundary-probe="true"]')).toHaveCount(0);
});

test("an already-active empty project filter offers creation instead of a no-op filter action", async ({ page }) => {
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as { projects: Array<Record<string, unknown>> };
    await route.fulfill({
      response,
      json: { projects: payload.projects.map((project) => ({ ...project, status: "completed" })) },
    });
  });

  await page.goto("/projects");
  const emptyState = page.locator(".projects-table .empty-table");
  await expect(emptyState).toContainText("No active projects yet.");
  await expect(emptyState.getByRole("button", { name: "Show active projects" })).toHaveCount(0);
  await emptyState.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "Create a project" })).toBeVisible();
});
