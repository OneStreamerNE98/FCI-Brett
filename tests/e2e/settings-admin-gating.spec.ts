import { expect, test, type Page } from "@playwright/test";

async function readIdentity(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/settings/me", { headers: { Accept: "application/json" } });
    return { status: response.status, body: await response.json() as { isAdmin?: boolean } };
  });
}

test("Administrator identity keeps protected Settings actions available", async ({ page }) => {
  await page.goto("/settings?section=calendar");
  await expect(page.getByRole("heading", { level: 2, name: "Calendar & appointments" })).toBeVisible();

  const identity = await readIdentity(page);
  expect(identity).toEqual({ status: 200, body: expect.objectContaining({ isAdmin: true }) });
  await expect(page.getByRole("button", { name: "Save calendar plan" })).toBeEnabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(0);

  await page.locator(".settings-nav").getByRole("button", { name: "Google Workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reset simulation data" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Check readiness" })).toBeEnabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(0);
});

test("Office identity sees every protected Settings action disabled and explained", async ({ page }) => {
  let connectionDetailGets = 0;
  let resourceGets = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/integrations/google/connection") connectionDetailGets += 1;
    if (request.method() === "GET" && url.pathname === "/api/v1/integrations/google/setup/resources") resourceGets += 1;
  });
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/settings?section=calendar");
  await expect(page.getByRole("heading", { level: 2, name: "Calendar & appointments" })).toBeVisible();

  const identity = await readIdentity(page);
  expect(identity).toEqual({ status: 200, body: expect.objectContaining({ isAdmin: false }) });
  await expect(page.getByRole("button", { name: "Save calendar plan" })).toBeDisabled();
  await expect(page.locator(".administrator-action-note")).toContainText(["Administrator action"]);
  await expect(page.getByRole("button", { name: "Google connection" })).toBeEnabled();

  await page.locator(".settings-nav").getByRole("button", { name: "Google Workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check readiness" })).toBeEnabled();
  await expect(page.locator(".workspace-connection-health")).toHaveCount(0);
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(page.getByRole("button", { name: "Check readiness" })).toBeEnabled();
  expect(connectionDetailGets).toBe(0);
  expect(resourceGets).toBe(0);
  for (const action of [
    "Reset simulation data",
    "Verify Shared Drive",
    /FCI labels$/,
    "View inbox",
    "Add sample email",
    "View upcoming events",
    "Create test hold",
    "Sync now",
  ]) {
    await expect(page.getByRole("button", { name: action })).toBeDisabled();
  }
  await expect(page.locator(".administrator-action-note")).toHaveCount(8);

  await page.locator(".settings-nav").getByRole("button", { name: "Client Directory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(1);

  await page.locator(".settings-nav").getByRole("button", { name: "Workflow & notifications", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save defaults" })).toBeDisabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(1);

  await page.locator(".settings-nav").getByRole("button", { name: "My account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save my preferences" })).toBeEnabled();
  await expect(page.locator(".administrator-action-note")).toHaveCount(0);
});
