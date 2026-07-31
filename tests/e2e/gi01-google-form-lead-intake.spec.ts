import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const ADMIN_EMAIL = "owner@cherryhillfci.com";
const REVIEW_ID = "gi01-review-e2e";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  });
}

function review() {
  return {
    id: REVIEW_ID,
    sourceRow: 2,
    submittedAt: "2026-07-31T13:00:00Z",
    state: "ready",
    status: "needs-review",
    proposal: {
      company: "FCI TEST — DO NOT USE — GI-01 Form Lead",
      contactName: "FCI TEST — DO NOT USE — GI-01 Form Lead",
      contactEmail: "gi01-form@example.test",
      contactPhone: null,
      projectName: "Luxury vinyl plank flooring — Lobby and two offices",
      source: "Google Form",
      stage: "New inquiry",
      site: "101 Simulation Way, Cherry Hill, NJ",
      estimatedValue: null,
      nextAction: "Follow up using preferred contact: gi01-form@example.test",
      nextActionAt: null,
      rooms: "Lobby and two offices",
      flooringType: "Luxury vinyl plank",
      preferredContact: "gi01-form@example.test",
    },
    reasons: [],
    createdAt: Date.UTC(2026, 6, 31, 13),
    updatedAt: Date.UTC(2026, 6, 31, 13),
  };
}

function intake(queue: readonly ReturnType<typeof review>[]) {
  return {
    configured: true,
    invalidConfiguration: false,
    configurationName: "GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID",
    simulation: true,
    actorEmail: ADMIN_EMAIL,
    rowLimit: 25,
    watermark: {
      lastProcessedRow: 2,
      lastProcessedAt: Date.UTC(2026, 6, 31, 13),
    },
    queue,
  };
}

async function routeMirror(page: Page) {
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => fulfillJson(route, {
    mirror: {
      configured: true,
      enabled: true,
      connected: true,
      spreadsheetUrl: null,
      spreadsheetName: "Simulated Client Directory",
      clients: { status: "synced", lastSyncedAt: null, lastError: null },
      projects: { status: "synced", lastSyncedAt: null, lastError: null },
      lastSyncedAt: null,
      reason: null,
      source: "none",
    },
  }));
}

test("GI-01 simulation requires human completion and preserves retry-only retirement after a thrown PATCH", async ({ page }) => {
  let queue = [review()];
  let checkCalls = 0;
  let leadPosts = 0;
  let retireCalls = 0;
  const leadBodies: unknown[] = [];
  const retireBodies: unknown[] = [];

  await routeMirror(page);
  await page.route("**/api/v1/integrations/google/forms/leads", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await fulfillJson(route, intake(queue));
      return;
    }
    if (method === "POST") {
      checkCalls += 1;
      await fulfillJson(route, {
        processed: 0,
        inserted: 0,
        message: "No new form responses were found.",
        watermark: intake(queue).watermark,
        queue,
      });
      return;
    }
    retireCalls += 1;
    retireBodies.push(route.request().postDataJSON());
    if (retireCalls === 1) {
      await route.abort("connectionfailed");
      return;
    }
    queue = [];
    await fulfillJson(route, { outcome: "accepted" });
  });
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    leadPosts += 1;
    leadBodies.push(route.request().postDataJSON());
    await fulfillJson(route, {
      lead: { id: LEAD_ID, leadNumber: "LEAD-260731-001" },
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Google Forms responses" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("New lead review queue")).toHaveCount(0);
  await expect(panel.getByLabel("Estimated value")).toHaveValue("");
  await expect(panel.getByLabel("Estimated value")).toHaveAttribute("placeholder", "Required before create");

  await panel.getByRole("button", { name: "Check for new form responses" }).click();
  await expect(panel.getByText("No new form responses were found.", { exact: true })).toBeVisible();
  expect(checkCalls).toBe(1);

  await panel.getByLabel("Estimated value").fill("125000");
  await panel.getByRole("button", { name: "Create lead" }).click();

  await expect(panel.getByRole("alert").filter({
    hasText: "Lead LEAD-260731-001 was created, but the queue update failed.",
  })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Retry retire review" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  expect(leadPosts).toBe(1);
  expect(retireCalls).toBe(1);
  expect(leadBodies).toEqual([expect.objectContaining({
    source: "Google Form",
    stage: "New inquiry",
    estimatedValue: 125000,
    ownerEmail: ADMIN_EMAIL,
  })]);

  await panel.getByRole("button", { name: "Retry retire review" }).click();
  await expect(panel.getByRole("button", { name: "Retry retire review" })).toHaveCount(0);
  await expect(panel.getByText("No form responses need review", { exact: true })).toBeVisible();
  expect(leadPosts).toBe(1);
  expect(retireCalls).toBe(2);
  expect(retireBodies).toEqual([
    { id: REVIEW_ID, outcome: "accepted", leadId: LEAD_ID },
    { id: REVIEW_ID, outcome: "accepted", leadId: LEAD_ID },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});
