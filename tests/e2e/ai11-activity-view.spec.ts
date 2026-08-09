import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const labels = [
  { slug: "lead", description: "L".repeat(300), retired: false },
  { slug: "project-update", description: "Information or a requested change concerning existing project work.", retired: false },
  { slug: "schedule", description: "A request or change involving an appointment, installation, or project timing.", retired: false },
  { slug: "warranty", description: "A callback, repair, service, or warranty concern.", retired: false },
  { slug: "historic_custom", description: "A saved category used by an earlier review.", retired: true },
];

const populatedActivity = {
  labels,
  counts: labels.map(({ slug }) => ({
    slug,
    acceptedCount: slug === "schedule" ? 1 : 0,
    dismissedCount: slug === "lead" || slug === "schedule" ? 1 : 0,
  })),
  rows: [
    {
      id: "activity-accepted",
      subject: "FCI TEST — DO NOT USE schedule request",
      sender: "Taylor Example <taylor@example.test>",
      receivedAt: Date.UTC(2026, 7, 8, 13, 0, 0),
      outcome: "accepted",
      reviewedBy: "owner@cherryhillfci.com",
      reviewedAt: Date.UTC(2026, 7, 8, 14, 0, 0),
      acceptedIntent: "schedule",
      acceptedIntentAvailable: true,
      labelDefinitionVersion: "catalog-current-test",
      labelSetState: "current",
      attributionState: "recorded",
      analysis: {
        state: "available",
        intents: ["lead", "schedule"],
        confidence: "high",
        rationale: "R".repeat(200),
      },
    },
    {
      id: "activity-degraded",
      subject: "FCI TEST — DO NOT USE older review",
      sender: null,
      receivedAt: null,
      outcome: "dismissed",
      reviewedBy: null,
      reviewedAt: null,
      acceptedIntent: null,
      acceptedIntentAvailable: true,
      labelDefinitionVersion: "catalog-earlier-test",
      labelSetState: "earlier",
      attributionState: "not-recorded",
      analysis: {
        state: "degraded",
        message: "Some saved classification details are unavailable.",
      },
    },
  ],
  totalCount: 2,
  pageLimit: 100,
};

const emptyActivity = {
  labels,
  counts: labels.map(({ slug }) => ({ slug, acceptedCount: 0, dismissedCount: 0 })),
  rows: [],
  totalCount: 0,
  pageLimit: 100,
};

test("AI review activity is non-vacuous, honest, responsive, and accessible", async ({ page }) => {
  let activityPayload: Record<string, unknown> = populatedActivity;
  let activityReads = 0;
  await page.route("**/api/v1/assistant/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        provider: "openai",
        keyState: "Configured",
        model: "gpt-test",
        modelSource: "app",
        savedModel: "gpt-test",
        features: {
          orgQa: true,
          triage: true,
          inboxAnalysis: true,
          replyDrafts: true,
          taskExtraction: true,
        },
      }),
    });
  });
  await page.route("**/api/v1/inbox-analysis/labels", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        labels: labels.map((label, index) => ({
          ...label,
          createdAt: index,
          updatedAt: index,
        })),
        maximumLabels: 20,
        maximumRows: 100,
      }),
    });
  });
  await page.route("**/api/v1/inbox-analysis/activity", async (route) => {
    activityReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(activityPayload),
    });
  });

  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto("/settings?section=ai-assistant");
  const activity = page.locator("[aria-labelledby='assistant-activity-title']");
  await expect(activity.getByRole("heading", { level: 3, name: "Review activity" })).toBeVisible();
  await expect(activity.getByText("FCI TEST — DO NOT USE schedule request")).toBeVisible();
  await expect(activity.getByText("Reviewed by owner@cherryhillfci.com", { exact: true })).toBeVisible();
  await expect(activity.getByText("Accepted category:").locator(".."))
    .toContainText("appointment, installation, or project timing");
  await expect(activity.getByText("Some saved classification details are unavailable.", { exact: false })).toBeVisible();
  await expect(activity.getByText("not recorded", { exact: true })).toBeVisible();
  await expect(activity.getByText("Classified using the current saved label set.")).toBeVisible();
  await expect(activity.getByText("Classified using an earlier saved label set.")).toBeVisible();
  await expect(activity.getByText("Showing 2 of 2 outcomes, newest first.")).toBeVisible();
  expect(activityReads).toBeGreaterThan(0);

  for (const viewport of [{ width: 1280, height: 960 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const results = await new AxeBuilder({ page })
      .include("[aria-labelledby='assistant-activity-title']")
      .analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }

  activityPayload = emptyActivity;
  await page.reload();
  await expect(page.locator("[aria-labelledby='assistant-activity-title']")
    .getByText("No review activity yet", { exact: true })).toBeVisible();
  await expect(page.getByText("Showing 0 of 0 outcomes, newest first.")).toBeVisible();
  expect(activityReads).toBeGreaterThan(1);
});
