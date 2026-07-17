import { expect, test } from "@playwright/test";

async function openReadyApp(page: import("@playwright/test").Page, url = "/") {
  await page.goto(url);
  await expect(page.getByText("Here’s the latest from your operations workspace.", { exact: true })).toBeVisible();
}

test("notifications use typed persistent errors and disclosure popovers dismiss safely", async ({ page }) => {
  await openReadyApp(page);
  await page.route("**/api/v1/search?*", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Search is temporarily unavailable." }) });
  });

  const search = page.getByRole("combobox", { name: "Search workspace" });
  await search.fill("forced error");
  await search.press("Enter");
  const errorNotice = page.getByRole("alert").filter({ hasText: "Search is temporarily unavailable." });
  await expect(errorNotice).toHaveClass(/toast-error/);
  await expect(errorNotice.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.waitForTimeout(3_500);
  await expect(errorNotice).toBeVisible();
  await errorNotice.getByRole("button", { name: "Dismiss notification" }).click();

  await search.fill("x");
  await search.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Enter at least two characters" })).toHaveClass(/toast-warning/);

  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.locator("#notifications-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#notifications-popover")).toHaveCount(0);

  await page.getByTitle("Workspace actions").click();
  await expect(page.locator("#workspace-actions-popover")).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(page.locator("#workspace-actions-popover")).toHaveCount(0);

  await page.getByRole("button", { name: /account actions/i }).click();
  await expect(page.locator("#account-actions-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#account-actions-popover")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("settings never expose editable defaults after a failed load and support retry", async ({ page }) => {
  let failAccountSettings = true;
  let failWorkspaceSettings = true;
  await page.route("**/api/v1/settings/me", async (route) => {
    if (route.request().method() === "GET" && failAccountSettings) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Account settings unavailable" }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/settings/workspace", async (route) => {
    if (route.request().method() === "GET" && failWorkspaceSettings) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Workspace settings unavailable" }) });
      return;
    }
    await route.continue();
  });

  await openReadyApp(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings · In development" }).click();
  const accountError = page.getByRole("alert").filter({ hasText: "Saved settings could not be loaded" });
  await expect(accountError).toBeVisible();
  await expect(page.getByRole("button", { name: "Save my preferences" })).toHaveCount(0);

  failAccountSettings = false;
  await accountError.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Save my preferences" })).toBeEnabled();

  await page.getByRole("button", { name: "Calendar & appointments" }).click();
  const workspaceError = page.getByRole("alert").filter({ hasText: "Saved settings could not be loaded" });
  await expect(workspaceError).toBeVisible();
  await expect(page.getByRole("button", { name: "Save calendar plan" })).toHaveCount(0);

  failWorkspaceSettings = false;
  await workspaceError.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Save calendar plan" })).toBeEnabled();
});

test("Google OAuth query results are consumed in an effect without dropping other parameters", async ({ page }) => {
  await page.goto("/settings?section=google-workspace&google=connected&keep=1");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google Workspace", exact: true })).toHaveAttribute("aria-current", "page");

  await expect.poll(() => new URL(page.url()).searchParams.has("google")).toBe(false);
  expect(new URL(page.url()).searchParams.get("keep")).toBe("1");
  expect(new URL(page.url()).searchParams.get("section")).toBe("google-workspace");
});
