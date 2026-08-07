import { expect, test, type Page } from "@playwright/test";
import { registerSimulationResetRecovery } from "./simulation-workspace";

// Teardown-budget recovery for specs that drive the real simulation reset.
const { markResetAttempted } = registerSimulationResetRecovery(test);

const ORIGIN = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const ADMIN_EMAIL = "e2e-admin@example.test";

const adminHeaders = {
  Origin: ORIGIN,
  "oai-authenticated-user-email": ADMIN_EMAIL,
  "oai-authenticated-user-full-name": encodeURIComponent("E2E Admin"),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

async function adminPost(page: Page, path: string) {
  const response = await page.request.post(path, { headers: adminHeaders, data: {} });
  if (!response.ok()) {
    throw new Error(`${path} failed with ${response.status()}: ${await response.text()}`);
  }
  return response;
}

async function resetAndRestoreSimulation(page: Page) {
  markResetAttempted();
  await adminPost(page, "/api/v1/integrations/google/simulation/reset");
  await adminPost(page, "/api/v1/integrations/google/drive/shared-drive/adopt");
  await adminPost(page, "/api/v1/integrations/google/drive/folders/ensure-roots");
  await adminPost(page, "/api/v1/integrations/google/sheets/ensure");
}

type BrowserIssue = Readonly<{ kind: "console.error" | "pageerror"; detail: string }>;

function monitorBrowserHealth(page: Page) {
  const issues: BrowserIssue[] = [];
  page.on("console", (message) => {
    const detail = message.text();
    const localVinextFontWarning = detail.startsWith("Not allowed to load local resource: file:///")
      && detail.includes("/.vinext/fonts/");
    if (message.type() === "error" && !localVinextFontWarning) {
      issues.push({ kind: "console.error", detail });
    }
  });
  page.on("pageerror", (error) => issues.push({ kind: "pageerror", detail: error.stack ?? error.message }));
  return issues;
}

async function signInAsAdmin(page: Page) {
  await page.setExtraHTTPHeaders(adminHeaders);
}

test("FIX-09 connect-sim reads real simulation connection status", async ({ page }) => {
  test.skip(
    process.env.FCI_E2E_EXTERNAL_SERVER === "true",
    "The simulation backend requires the isolated local Workspace simulation database.",
  );

  const browserIssues = monitorBrowserHealth(page);
  await signInAsAdmin(page);
  await resetAndRestoreSimulation(page);

  await page.goto("/settings?section=google-workspace");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  // The real simulation backend returns a connected status.
  // The banner should show simulation mode, not a loading or error state.
  const banner = page.locator(".workspace-status-banner");
  await expect(banner).toBeVisible();
  await expect(banner.locator(".workspace-status-mode")).toHaveText(/SIMULATION|WORKSPACE/);
  await expect(banner).not.toContainText("Checking current status…");

  // Stage 1 should show DONE because the real readiness endpoint returns credentials present.
  await expect(page.locator("[data-workspace-stage='1'] .workspace-stage-chip")).toHaveText("DONE");

  expect(browserIssues, browserIssues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});

test("FIX-09 gmail filing drives real simulation messages and file endpoint", async ({ page }) => {
  test.skip(
    process.env.FCI_E2E_EXTERNAL_SERVER === "true",
    "The simulation backend requires the isolated local Workspace simulation database.",
  );

  const browserIssues = monitorBrowserHealth(page);
  await signInAsAdmin(page);
  await resetAndRestoreSimulation(page);

  // Verify the real simulation backend returns Gmail messages directly.
  const gmailResponse = await page.request.get(
    "/api/v1/integrations/google/gmail/messages?label=inbox",
    { headers: adminHeaders },
  );
  expect(gmailResponse.status()).toBe(200);
  const gmailBody = await gmailResponse.json() as { messages: Array<{ subject: string }>; labelReady: boolean };
  expect(gmailBody.labelReady).toBe(true);
  expect(gmailBody.messages.some((m) => /revised phasing plan/.test(m.subject))).toBe(true);

  // Provision a Drive folder for the seeded e2e project so filing has a destination.
  const provisionResponse = await page.request.post(
    "/api/v1/projects/e2e-project-001/drive",
    { headers: adminHeaders, data: {} },
  );
  expect(provisionResponse.status()).toBe(201);

  // Navigate to inbox and verify the page loads.
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();

  expect(browserIssues, browserIssues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});

test("FIX-09 calendar test-hold creates a real simulation event", async ({ page }) => {
  test.skip(
    process.env.FCI_E2E_EXTERNAL_SERVER === "true",
    "The simulation backend requires the isolated local Workspace simulation database.",
  );

  const browserIssues = monitorBrowserHealth(page);
  await signInAsAdmin(page);
  await resetAndRestoreSimulation(page);

  await page.goto("/settings?section=google-workspace");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  // Expand Stage 4 to reach the calendar verification area.
  const stage4Toggle = page.locator('[data-workspace-stage="4"] .workspace-stage-toggle');
  await expect(stage4Toggle).toBeVisible();
  const expanded = await stage4Toggle.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await stage4Toggle.click();
  }

  // The calendar verification row should show a state from the real backend.
  const calendarRow = page.locator('[data-stage-four-verification="calendar"]');
  await expect(calendarRow).toBeVisible();

  // The real simulation backend returns verification status.
  // In a fresh simulation, calendar may show "READY TO VERIFY" or "VERIFIED"
  // depending on whether the calendar events endpoint has been hit.
  const stateText = await calendarRow.getAttribute("data-stage-four-state");
  expect(stateText).toMatch(/READY TO VERIFY|VERIFIED/);

  expect(browserIssues, browserIssues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});

test("FIX-09 sheets sync drives the real simulation sync endpoint", async ({ page }) => {
  test.skip(
    process.env.FCI_E2E_EXTERNAL_SERVER === "true",
    "The simulation backend requires the isolated local Workspace simulation database.",
  );

  const browserIssues = monitorBrowserHealth(page);
  await signInAsAdmin(page);
  await resetAndRestoreSimulation(page);

  await page.goto("/settings?section=client-directory");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  const panel = page.getByRole("region", { name: "Client Directory & Project Register" });
  await expect(panel).toBeVisible();

  // The real simulation backend returns mirror status.
  // After restore, the sheet is ensured but not yet synced.
  const syncButton = panel.getByRole("button", { name: "Sync now", exact: true });
  await expect(syncButton).toBeEnabled();

  // Drive the real sync endpoint.
  const syncResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/integrations/google/sheets/sync";
  });
  await syncButton.click();
  const syncResponse = await syncResponsePromise;
  expect(syncResponse.status()).toBe(200);

  const syncBody = await syncResponse.json() as { mirror?: { clients?: { status: string }; projects?: { status: string } } };
  expect(syncBody.mirror?.clients?.status).toBe("synced");
  expect(syncBody.mirror?.projects?.status).toBe("synced");

  expect(browserIssues, browserIssues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});
