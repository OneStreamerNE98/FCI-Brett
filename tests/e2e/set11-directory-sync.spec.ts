import { expect, test, type Page } from "@playwright/test";

type Mirror = Readonly<{
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  clients: Readonly<{ status: string; lastSyncedAt: number | null; lastError: string | null }>;
  projects: Readonly<{ status: string; lastSyncedAt: number | null; lastError: string | null }>;
  lastSyncedAt: number | null;
  reason: string | null;
  source: "app" | "env" | "none";
}>;

async function routeMirrorSequence(page: Page, mirrors: readonly Mirror[]) {
  let statusReads = 0;
  let syncWrites = 0;
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    const mirror = mirrors[Math.min(statusReads, mirrors.length - 1)];
    statusReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({ mirror }),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/sync", async (route) => {
    syncWrites += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mirror: mirrors.at(-1) }),
    });
  });
  return {
    statusReads: () => statusReads,
    syncWrites: () => syncWrites,
  };
}

test("SET-11 revalidates mirror status on focus without syncing, formats timestamps, and keeps errors verbatim", async ({ page }) => {
  const firstSyncedAt = 1_721_111_111_111;
  const refreshedSyncedAt = 1_722_222_222_222;
  const recordedError = "Recorded client mirror failure: row <7> & retry manually.";
  const calls = await routeMirrorSequence(page, [
    {
      configured: true,
      enabled: true,
      connected: true,
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fci-test-directory",
      spreadsheetName: "FCI TEST — DO NOT USE",
      clients: { status: "synced", lastSyncedAt: firstSyncedAt, lastError: null },
      projects: { status: "synced", lastSyncedAt: firstSyncedAt, lastError: null },
      lastSyncedAt: firstSyncedAt,
      reason: null,
      source: "app",
    },
    {
      configured: true,
      enabled: true,
      connected: true,
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fci-test-directory",
      spreadsheetName: "FCI TEST — DO NOT USE",
      clients: { status: "failed", lastSyncedAt: refreshedSyncedAt, lastError: recordedError },
      projects: { status: "syncing", lastSyncedAt: refreshedSyncedAt, lastError: null },
      lastSyncedAt: refreshedSyncedAt,
      reason: null,
      source: "app",
    },
  ]);

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Client Directory & Project Register" });
  await expect(panel).toBeVisible();
  const firstSyncedLabel = await page.evaluate((value) => new Date(value).toLocaleString(), firstSyncedAt);
  await expect(panel.getByText(`Last synced: ${firstSyncedLabel}`, { exact: true })).toHaveCount(2);
  await expect(panel.getByText(`Last synced: ${firstSyncedAt}`, { exact: true })).toHaveCount(0);
  const readsBeforeRefresh = calls.statusReads();

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect.poll(calls.statusReads).toBe(readsBeforeRefresh + 1);
  const refreshedSyncedLabel = await page.evaluate((value) => new Date(value).toLocaleString(), refreshedSyncedAt);
  await expect(panel.getByText(`Last synced: ${refreshedSyncedLabel}`, { exact: true })).toHaveCount(2);
  await expect(panel.getByText(`Last synced: ${refreshedSyncedAt}`, { exact: true })).toHaveCount(0);
  await expect(panel.getByText(`Last error: ${recordedError}`, { exact: true })).toBeVisible();
  await expect(panel.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(panel.getByText("Syncing", { exact: true })).toBeVisible();
  expect(calls.syncWrites()).toBe(0);
});

test("SET-11 unconfigured state names the fallback key and links to Workspace Stage 3", async ({ page }) => {
  await routeMirrorSequence(page, [{
    configured: false,
    enabled: false,
    connected: false,
    spreadsheetUrl: null,
    spreadsheetName: null,
    clients: { status: "not-synced", lastSyncedAt: null, lastError: null },
    projects: { status: "not-synced", lastSyncedAt: null, lastError: null },
    lastSyncedAt: null,
    reason: "Spreadsheet is not configured.",
    source: "none",
  }]);

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Client Directory & Project Register" });
  await expect(panel.getByText("GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open Google Workspace setup" })).toHaveAttribute(
    "href",
    "/settings?section=google-workspace#workspace-stage-3",
  );
  await expect(panel.getByRole("button", { name: "Sync now" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Refresh status" })).toHaveCount(0);
});
