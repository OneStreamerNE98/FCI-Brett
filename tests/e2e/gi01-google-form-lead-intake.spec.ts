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

function review(sourceRow = 2) {
  return {
    id: sourceRow === 2 ? REVIEW_ID : `gi01-review-e2e-${sourceRow}`,
    sourceRow,
    submittedAt: "2026-07-31T13:00:00Z",
    state: "ready",
    status: "needs-review",
    proposal: {
      company: `FCI TEST — DO NOT USE — GI-01 Form Lead ${sourceRow}`,
      contactName: `FCI TEST — DO NOT USE — GI-01 Form Lead ${sourceRow}`,
      contactEmail: `gi01-form-${sourceRow}@example.test`,
      contactPhone: null,
      projectName: "Luxury vinyl plank flooring — Lobby and two offices",
      source: "Google Form",
      stage: "New inquiry",
      site: `${sourceRow} Simulation Way, Cherry Hill, NJ`,
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

test("GI-01 simulation requires human completion and accepts a review through one lead POST", async ({ page }) => {
  let queue = [review()];
  let checkCalls = 0;
  let getCalls = 0;
  let leadPosts = 0;
  let reviewPatches = 0;
  const leadBodies: unknown[] = [];
  const idempotencyKeys: Array<string | null> = [];

  await routeMirror(page);
  await page.route("**/api/v1/integrations/google/forms/leads", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      getCalls += 1;
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
    reviewPatches += 1;
    await fulfillJson(route, { error: "Acceptance must use the lead route." }, 400);
  });
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    leadPosts += 1;
    leadBodies.push(route.request().postDataJSON());
    idempotencyKeys.push(route.request().headers()["idempotency-key"] ?? null);
    queue = [];
    await fulfillJson(route, {
      lead: { id: LEAD_ID, leadNumber: "LEAD-260731-001" },
      formLeadReview: { id: REVIEW_ID, status: "accepted" },
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Google Forms responses" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("New lead review queue")).toHaveCount(0);
  await expect(panel.getByLabel("Estimated value")).toHaveValue("");
  await expect(panel.getByLabel("Estimated value")).toHaveAttribute("placeholder", "Required before create");
  await expect(panel.getByLabel("Source")).toHaveValue("Google Form");
  await expect(panel.getByLabel("Source")).toHaveAttribute("readonly", "");
  await expect(panel.getByText("FCI TEST — DO NOT USE", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Check for new form responses" }).click();
  await expect(panel.getByText("No new form responses were found.", { exact: true })).toBeVisible();
  expect(checkCalls).toBe(1);

  const getCallsBeforeAccept = getCalls;
  await panel.getByLabel("Estimated value").fill("125000");
  await panel.getByRole("button", { name: "Create lead" }).click();

  await expect(panel.getByText("No form responses need review", { exact: true })).toBeVisible();
  expect(leadPosts).toBe(1);
  expect(getCalls).toBe(getCallsBeforeAccept + 1);
  expect(reviewPatches).toBe(0);
  expect(idempotencyKeys).toEqual([REVIEW_ID]);
  expect(leadBodies).toEqual([expect.objectContaining({
    source: "Google Form",
    stage: "New inquiry",
    estimatedValue: 125000,
    ownerEmail: ADMIN_EMAIL,
    formLeadReviewId: REVIEW_ID,
  })]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("GI-01 retries only the queue read after a created lead's refresh fails", async ({ page }) => {
  let queue = [review()];
  let getCalls = 0;
  let leadPosts = 0;

  await routeMirror(page);
  await page.route("**/api/v1/integrations/google/forms/leads", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    getCalls += 1;
    if (getCalls === 2) {
      await fulfillJson(route, { error: "Temporary queue read failure." }, 503);
      return;
    }
    await fulfillJson(route, intake(queue));
  });
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    leadPosts += 1;
    queue = [];
    await fulfillJson(route, {
      lead: { id: LEAD_ID, leadNumber: "LEAD-260731-001" },
      formLeadReview: { id: REVIEW_ID, status: "accepted" },
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Google Forms responses" });
  const row = panel.locator("article").filter({ hasText: "Response Sheet row 2" });
  await row.getByLabel("Estimated value").fill("125000");
  await row.getByRole("button", { name: "Create lead" }).click();

  await expect(row.getByText("Lead LEAD-260731-001 and its review were saved", {
    exact: false,
  })).toBeVisible();
  await expect(row.getByRole("button", { name: "Retry queue refresh" })).toBeVisible();
  await expect(row.getByText("reload before reviewing another response", {
    exact: false,
  })).toHaveCount(0);
  expect(leadPosts).toBe(1);
  expect(getCalls).toBe(2);

  await row.getByRole("button", { name: "Retry queue refresh" }).click();
  await expect(panel.getByText("No form responses need review", { exact: true })).toBeVisible();
  expect(getCalls).toBe(3);
  expect(leadPosts).toBe(1);
});

test("GI-01 response loss after commit retires the review without a duplicate retry", async ({ page }) => {
  let queue = [review()];
  let leadPosts = 0;
  let reviewPatches = 0;

  await routeMirror(page);
  await page.route("**/api/v1/integrations/google/forms/leads", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, intake(queue));
      return;
    }
    if (route.request().method() === "PATCH") {
      reviewPatches += 1;
      await fulfillJson(route, { error: "Acceptance must use the lead route." }, 400);
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    leadPosts += 1;
    queue = [];
    await route.abort("connectionfailed");
  });

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Google Forms responses" });
  const row = panel.locator("article").filter({ hasText: "Response Sheet row 2" });
  await panel.getByLabel("Estimated value").fill("125000");
  await row.getByRole("button", { name: "Create lead" }).click();

  await expect(row.getByRole("alert")).toContainText(
    "The lead result could not be confirmed. Reload the queue before trying again.",
  );
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Create lead" })).toBeDisabled();
  await expect(row.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  expect(leadPosts).toBe(1);
  expect(reviewPatches).toBe(0);

  await page.reload();
  await expect(panel.getByText("No form responses need review", { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(leadPosts).toBe(1);
  expect(reviewPatches).toBe(0);
});

test("GI-01 rejects mismatched acceptance evidence without refetching or retiring the visible row", async ({ page }) => {
  let getCalls = 0;
  let leadPosts = 0;

  await routeMirror(page);
  await page.route("**/api/v1/integrations/google/forms/leads", async (route) => {
    if (route.request().method() === "GET") {
      getCalls += 1;
      await fulfillJson(route, intake([review()]));
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    leadPosts += 1;
    await fulfillJson(route, {
      lead: { id: LEAD_ID, leadNumber: "LEAD-260731-001" },
      formLeadReview: { id: "a-different-review", status: "accepted" },
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Google Forms responses" });
  const row = panel.locator("article").filter({ hasText: "Response Sheet row 2" });
  await panel.getByLabel("Estimated value").fill("125000");
  await row.getByRole("button", { name: "Create lead" }).click();

  await expect(row.getByRole("alert")).toContainText(
    "The lead result could not be confirmed. Reload the queue before trying again.",
  );
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Create lead" })).toBeDisabled();
  await expect(row.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  expect(getCalls).toBe(1);
  expect(leadPosts).toBe(1);
});

test("GI-01 retirement refetches the capped queue so the next server row appears", async ({ page }) => {
  const firstPage = Array.from({ length: 50 }, (_, index) => review(index + 2));
  const nextPage = [review(52)];
  let getCalls = 0;
  let retireCalls = 0;

  await routeMirror(page);
  await page.route("**/api/v1/integrations/google/forms/leads", async (route) => {
    if (route.request().method() === "GET") {
      getCalls += 1;
      await fulfillJson(route, intake(getCalls === 1 ? firstPage : nextPage));
      return;
    }
    if (route.request().method() === "PATCH") {
      retireCalls += 1;
      await fulfillJson(route, { outcome: "dismissed" });
      return;
    }
    await route.fallback();
  });

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Google Forms responses" });
  await expect(panel.getByText(/Response Sheet row 2(?:\s|·)/u)).toBeVisible();
  await panel.locator("article").filter({ hasText: /Response Sheet row 2\s*·/u })
    .getByRole("button", { name: "Dismiss" }).click();

  await expect(panel.getByText(/Response Sheet row 52(?:\s|·)/u)).toBeVisible();
  await expect(panel.getByText(/Response Sheet row 2(?:\s|·)/u)).toHaveCount(0);
  await expect(panel.getByText("No form responses need review", { exact: true })).toHaveCount(0);
  expect(getCalls).toBe(2);
  expect(retireCalls).toBe(1);
});

test("GI-01 keeps a retired row visible when the queue refresh fails", async ({ page }) => {
  let getCalls = 0;

  await routeMirror(page);
  await page.route("**/api/v1/integrations/google/forms/leads", async (route) => {
    if (route.request().method() === "GET") {
      getCalls += 1;
      if (getCalls === 1) {
        await fulfillJson(route, intake([review()]));
      } else {
        await fulfillJson(route, { error: "Temporary queue read failure." }, 503);
      }
      return;
    }
    if (route.request().method() === "PATCH") {
      await fulfillJson(route, { outcome: "dismissed" });
      return;
    }
    await route.fallback();
  });

  await page.goto("/settings?section=client-directory");
  const panel = page.getByRole("region", { name: "Google Forms responses" });
  const row = panel.locator("article").filter({ hasText: "Response Sheet row 2" });
  await row.getByRole("button", { name: "Dismiss" }).click();

  await expect(panel.getByText(
    /The review was saved, but the queue could not be refreshed\./u,
  ).first()).toBeVisible();
  await expect(row).toBeVisible();
  await expect(panel.getByText("No form responses need review", { exact: true })).toHaveCount(0);
  expect(getCalls).toBe(2);
});
