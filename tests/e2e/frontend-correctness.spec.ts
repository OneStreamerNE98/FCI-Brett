import { expect, test } from "@playwright/test";

async function openReadyApp(page: import("@playwright/test").Page, url = "/") {
  await page.goto(url);
  await expect(page.getByText("Here’s the latest from your operations workspace.", { exact: true })).toBeVisible();
}

/**
 * Counts reads of one mocked endpoint so a test can heal it only once the client has stopped
 * reading it.
 *
 * Settings panels have two legitimate recovery paths: the explicit Retry button, and SET-42's
 * background revalidation, which re-reads every subscribed URL after a navigation and keeps
 * looping while mounted readers churn. Healing the endpoint while one of those background reads
 * is still pending lets it succeed on its own, which correctly flips the panel to "ready" and
 * unmounts the error notice — detaching the Retry button out from under an in-flight click.
 * Waiting for the read pipeline to go quiet first leaves the explicit retry as the only thing
 * that can recover the panel, which is exactly what these tests mean to prove.
 */
function trackReads() {
  let inFlight = 0;
  let lastSettledAt = 0;
  return {
    begin() {
      inFlight += 1;
    },
    settle() {
      inFlight -= 1;
      lastSettledAt = Date.now();
    },
    async waitUntilQuiet(page: import("@playwright/test").Page, quietMs = 600) {
      // Best-effort broadening: a background revalidation of the panel's *other* read
      // (/api/v1/google-workspace) notifies the same panel, which then re-reads its settings
      // URL. Bounded and non-fatal — the per-endpoint check below is the actual gate.
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await expect
        .poll(() => (inFlight === 0 && lastSettledAt > 0 ? Date.now() - lastSettledAt : 0), {
          timeout: 15_000,
          message: "settings reads never went quiet before the endpoint was healed",
        })
        .toBeGreaterThan(quietMs);
    },
  };
}

test("notifications use typed persistent errors and navigation disclosure popovers dismiss safely", async ({ page }) => {
  await openReadyApp(page);
  await page.clock.install();
  await page.route("**/api/v1/search?*", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Search is temporarily unavailable." }) });
  });

  const search = page.getByRole("combobox", { name: "Search workspace" });
  await search.fill("forced error");
  await search.press("Enter");
  const errorNotice = page.getByRole("alert").filter({ hasText: "Workspace search could not be completed." });
  await expect(errorNotice).toHaveClass(/toast-error/);
  await expect(errorNotice).not.toContainText("Search is temporarily unavailable.");
  await expect(errorNotice.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(errorNotice).toBeVisible();
  await errorNotice.getByRole("button", { name: "Dismiss notification" }).click();

  await search.fill("x");
  await search.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Enter at least two characters" })).toHaveClass(/toast-warning/);

  const workspaceNavigationTrigger = page.getByRole("button", { name: "Workspace navigation" });
  await expect(workspaceNavigationTrigger).toHaveAttribute("title", "Workspace navigation");
  await workspaceNavigationTrigger.click();
  const workspaceNavigation = page.locator("#notifications-popover");
  await expect(workspaceNavigation).toBeVisible();
  await expect(workspaceNavigation.getByText("Workspace navigation", { exact: true })).toBeVisible();
  await expect(workspaceNavigation.getByRole("button", { name: "Open the Gmail project inbox" })).toBeVisible();
  await expect(workspaceNavigation.getByRole("button", { name: "View scheduling status" })).toHaveCount(0);
  await expect(workspaceNavigation.getByText("Notifications", { exact: true })).toHaveCount(0);
  await expect(workspaceNavigation.getByText("Schedule alerts will appear after scheduling is connected", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(workspaceNavigation).toHaveCount(0);

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
  const accountReads = trackReads();
  const workspaceReads = trackReads();
  await page.route("**/api/v1/settings/me", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    accountReads.begin();
    try {
      if (failAccountSettings) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Account settings unavailable" }) });
        return;
      }
      await route.continue();
    } finally {
      accountReads.settle();
    }
  });
  await page.route("**/api/v1/settings/workspace", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    workspaceReads.begin();
    try {
      if (failWorkspaceSettings) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Workspace settings unavailable" }) });
        return;
      }
      await route.continue();
    } finally {
      workspaceReads.settle();
    }
  });

  await openReadyApp(page);
  await page.getByRole("button", { name: /account actions/i }).click();
  await page.locator("#account-actions-popover").getByRole("button", { name: "My settings", exact: true }).click();
  const accountError = page.getByRole("alert").filter({ hasText: "Saved settings could not be loaded" });
  await expect(accountError).toBeVisible();
  await expect(page.getByRole("button", { name: "Save my settings" })).toHaveCount(0);

  await accountReads.waitUntilQuiet(page);
  failAccountSettings = false;
  await accountError.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Save my settings" })).toBeEnabled();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "People & Access", exact: true })).toBeVisible();
  await page.getByTitle("Workspace actions").click();
  await expect(page.locator("#workspace-actions-popover").getByRole("button", { name: "Google Workspace" })).toBeVisible();
  await page.getByTitle("Workspace actions").click();

  await page.getByRole("button", { name: "Calendar & appointments" }).click();
  const workspaceError = page.getByRole("alert").filter({ hasText: "Saved settings could not be loaded" });
  await expect(workspaceError).toBeVisible();
  await expect(page.getByRole("button", { name: "Save calendar plan" })).toHaveCount(0);

  await workspaceReads.waitUntilQuiet(page);
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
