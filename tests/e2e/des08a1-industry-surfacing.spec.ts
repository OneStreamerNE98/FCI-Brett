import { expect, test, type Page } from "@playwright/test";

const existingIndustryOptions = [
  "General contractor",
  "Healthcare",
  "Retail",
  "Hospitality",
  "Property management",
  "Other commercial",
] as const;

const clients = [
  {
    id: "des08a1-client-001",
    client_code: "RES-001",
    name: "FCI TEST — Residential One",
    status: "active",
    industry: "Residential",
    primary_contact_name: "Test Contact",
    primary_contact_email: "residential-one@example.test",
  },
  {
    id: "des08a1-client-002",
    client_code: "RES-002",
    name: "FCI TEST — Residential Two",
    status: "active",
    industry: "residential",
    primary_contact_name: "Test Contact",
    primary_contact_email: "residential-two@example.test",
  },
  {
    id: "des08a1-client-003",
    client_code: "HEALTH-001",
    name: "FCI TEST — Healthcare",
    status: "active",
    industry: "Healthcare",
    primary_contact_name: "Test Contact",
    primary_contact_email: "healthcare@example.test",
  },
];

const defaultPageLayouts = {
  overview: {
    order: ["metrics", "todays-meetings", "lead-pipeline", "scheduling", "active-projects", "gmail-project-inbox"],
    hidden: [],
  },
  reports: {
    order: ["summary-metrics", "business-kpis", "pipeline-by-stage", "projects-by-status", "clients-by-industry", "future-reports"],
    hidden: [],
  },
};

async function mockIndustryRecords(page: Page, clientRows = clients) {
  let pageLayouts = structuredClone(defaultPageLayouts);
  await page.route("**/api/v1/settings/me", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { pageLayouts?: typeof defaultPageLayouts };
      if (body.pageLayouts) pageLayouts = structuredClone(body.pageLayouts);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        isAdmin: true,
        preferences: {
          displayTimezone: "America/New_York",
          replySignature: "",
          notificationPreferences: {
            "lead.created": false,
            "gmail.filing_review_needed": false,
            "calendar.schedule_changed": false,
            "project.warranty_follow_up_due": false,
          },
          pageLayouts,
        },
      }),
    });
  });
  await page.route("**/api/v1/leads", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ leads: [] }),
  }));
  await page.route("**/api/v1/clients", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ clients: clientRows }),
  }));
  await page.route("**/api/v1/projects", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ projects: [] }),
  }));
  await page.route("**/api/v1/dashboard", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: Date.UTC(2026, 6, 24, 12),
      metrics: {
        activeLeads: 0,
        estimatedPipelineValue: 0,
        activeProjects: 0,
        clientCount: clientRows.length,
        meetingCount: 0,
        filedEmailCount: 0,
      },
      projectsByStatus: [],
      recentActivity: [],
      todayMeetings: { items: [], total: 0 },
      readiness: {
        scheduleDataAvailable: false,
        scheduleReason: "Scheduling is not available.",
        reportsUseLiveProjectLeadTotals: true,
      },
    }),
  }));
  await page.route("**/api/v1/filing-rules", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ rules: [] }),
  }));
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ mirror: null }),
  }));
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

test("Clients by industry shows live static counts and remains hideable across reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockIndustryRecords(page);
  await page.goto("/reports");

  const section = page.getByRole("heading", { name: "Clients by industry" }).locator("xpath=ancestor::section[1]");
  const rows = section.getByRole("list", { name: "Clients by industry" }).locator("li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Residential");
  await expect(rows.nth(0).locator("strong")).toHaveText("2");
  await expect(rows.nth(1)).toContainText("Healthcare");
  await expect(rows.nth(1).locator("strong")).toHaveText("1");
  await expect(section.getByRole("link")).toHaveCount(0);
  await expect(section.locator(".bar-chart-row.actionable")).toHaveCount(0);
  await expect(section.locator(".bar-chart-track > i").nth(0)).toHaveAttribute("style", "width: 100%;");
  await expect(section.locator(".bar-chart-track > i").nth(1)).toHaveAttribute("style", "width: 50%;");

  // DES-08's exhausted-golden law: the additive report remains outside every
  // legacy container hashed by page-layouts.spec.ts.
  await expect(section.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' metrics-grid ') or contains(concat(' ', normalize-space(@class), ' '), ' business-kpis ') or contains(concat(' ', normalize-space(@class), ' '), ' reports-grid ') or contains(concat(' ', normalize-space(@class), ' '), ' client-directory-banner ')]")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  if (process.env.FCI_CAPTURE_DES08A1 === "true") {
    await page.screenshot({
      path: "docs/design-evidence/2026-07-24/des-08a1-clients-by-industry-1280.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(section).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: "docs/design-evidence/2026-07-24/des-08a1-clients-by-industry-390.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await page.getByRole("button", { name: "Edit Reports layout" }).click();
  await page.getByRole("button", { name: "Hide Clients by industry" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(section).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Clients by industry" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Reports layout" }).click();
  await page.getByRole("button", { name: "Clients by industry", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Clients by industry" })).toBeVisible();
});

test("client industry presentation keeps the row chip and adds Residential to the existing options", async ({ page }) => {
  await mockIndustryRecords(page);
  await page.goto("/clients");

  await expect(page.getByText("RES-001 · Residential", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add client" }).click();
  const industry = page.getByLabel("Industry");
  await expect(industry.locator("option")).toHaveText([...existingIndustryOptions, "Residential"]);
  await industry.selectOption({ label: "Residential" });
  await expect(industry).toHaveValue("Residential");
});

test("Clients by industry has an honest empty state", async ({ page }) => {
  await mockIndustryRecords(page, []);
  await page.goto("/reports");

  const section = page.getByRole("heading", { name: "Clients by industry" }).locator("xpath=ancestor::section[1]");
  await expect(section.getByText("No client industry data is available yet.", { exact: true })).toBeVisible();
  await expect(section.getByRole("list", { name: "Clients by industry" })).toHaveCount(0);
});
