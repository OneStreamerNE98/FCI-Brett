import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type BrowserIssue = { kind: "console.error" | "pageerror"; detail: string };

const leads = [
  { id: "kpi-lead-won-website", leadNumber: "L-2026-KPI00001", company: "FCI TEST — DO NOT USE — Website win", contactName: "Test Contact", projectName: "Website project", source: "Website", stage: "Decision", site: "Cherry Hill, NJ", estimatedValue: 10_000, nextAction: "Converted", status: "converted", createdAt: Date.parse("2026-07-01T13:00:00Z"), updatedAt: Date.parse("2026-07-10T13:00:00Z") },
  { id: "kpi-lead-lost-website", leadNumber: "L-2026-KPI00002", company: "FCI TEST — DO NOT USE — Website loss", contactName: "Test Contact", projectName: "Lost project", source: "Website", stage: "Decision", site: "Cherry Hill, NJ", estimatedValue: 7_500, nextAction: "Closed", status: "lost", createdAt: Date.parse("2026-07-02T13:00:00Z"), updatedAt: Date.parse("2026-07-12T13:00:00Z") },
  { id: "kpi-lead-won-referral", leadNumber: "L-2026-KPI00003", company: "FCI TEST — DO NOT USE — Referral win", contactName: "Test Contact", projectName: "Referral project", source: "Referral", stage: "Decision", site: "Cherry Hill, NJ", estimatedValue: 20_000, nextAction: "Converted", status: "converted", createdAt: Date.parse("2026-07-15T13:00:00Z"), updatedAt: Date.parse("2026-07-20T13:00:00Z") },
  { id: "kpi-lead-won-repeat", leadNumber: "L-2026-KPI00004", company: "FCI TEST — DO NOT USE — Repeat win", contactName: "Test Contact", projectName: "Repeat project", source: "Repeat client", stage: "Decision", site: "Cherry Hill, NJ", estimatedValue: 5_000, nextAction: "Converted", status: "converted", createdAt: Date.parse("2026-08-01T13:00:00Z"), updatedAt: Date.parse("2026-08-05T13:00:00Z") },
];

const projects = [
  { id: "kpi-project-planning", project_number: "CF-2026-KPI00001", client_id: "e2e-client-001", client_name: "E2E Regression Client", name: "FCI TEST — DO NOT USE — Planning", status: "planning", site: "Cherry Hill, NJ", project_manager_id: "e2e-admin@example.test", estimated_value: 100_000, flooring_category: "hardwood", square_feet: 4_000, contract_value: 120_000, created_at: Date.parse("2026-07-01T13:00:00Z"), updated_at: Date.parse("2026-07-10T13:00:00Z") },
  { id: "kpi-project-installation", project_number: "CF-2026-KPI00002", client_id: "e2e-client-001", client_name: "E2E Regression Client", name: "FCI TEST — DO NOT USE — Installation", status: "installation", site: "Cherry Hill, NJ", project_manager_id: "e2e-admin@example.test", estimated_value: 50_000, flooring_category: "carpet", square_feet: 1_500, contract_value: 45_000, created_at: Date.parse("2026-07-02T13:00:00Z"), updated_at: Date.parse("2026-07-11T13:00:00Z") },
  { id: "kpi-project-completed-july", project_number: "CF-2026-KPI00003", client_id: "e2e-client-001", client_name: "E2E Regression Client", name: "FCI TEST — DO NOT USE — Completed July", status: "completed", site: "Cherry Hill, NJ", project_manager_id: "e2e-admin@example.test", estimated_value: 25_000, flooring_category: "hardwood", square_feet: 1_000, contract_value: 30_000, created_at: Date.parse("2026-06-01T13:00:00Z"), updated_at: Date.parse("2026-07-15T13:00:00Z") },
  { id: "kpi-project-completed-august", project_number: "CF-2026-KPI00004", client_id: "e2e-client-001", client_name: "E2E Regression Client", name: "FCI TEST — DO NOT USE — Completed August", status: "completed", site: "Cherry Hill, NJ", project_manager_id: "e2e-admin@example.test", estimated_value: 30_000, flooring_category: null, square_feet: null, contract_value: null, created_at: Date.parse("2026-08-01T13:00:00Z"), updated_at: Date.parse("2026-08-15T13:00:00Z") },
];

function monitorBrowserHealth(page: Page) {
  const issues: BrowserIssue[] = [];
  page.on("console", (message) => {
    const detail = message.text();
    // Vinext emits absolute Windows next/font URLs in local development CSS.
    // Keep every application error while excluding only that framework warning.
    const localVinextFontWarning = detail.startsWith("Not allowed to load local resource: file:///") && detail.includes("/.vinext/fonts/");
    if (message.type() === "error" && !localVinextFontWarning) issues.push({ kind: "console.error", detail });
  });
  page.on("pageerror", (error) => issues.push({ kind: "pageerror", detail: error.stack ?? error.message }));
  return issues;
}

async function mockKpiRecords(page: Page, isAdmin: boolean, projectRows = projects) {
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads }) });
    else await route.continue();
  });
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: projectRows.map((project) => ({ ...project, contract_value: isAdmin ? project.contract_value : null })) }) });
    else await route.continue();
  });
  await page.route("**/api/v1/dashboard", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: Date.now(),
        metrics: { activeLeads: 0, estimatedPipelineValue: 0, activeProjects: 2, clientCount: 1, meetingCount: 0, filedEmailCount: 0 },
        projectsByStatus: [{ status: "planning", count: 1 }, { status: "installation", count: 1 }, { status: "completed", count: 2 }],
        recentActivity: [],
        readiness: { scheduleDataAvailable: false, reportsUseLiveProjectLeadTotals: true },
      }),
    });
  });
  await page.route("**/api/v1/settings/me", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preferences: { displayTimezone: "America/New_York" }, isAdmin }) });
    else await route.continue();
  });
}

async function openKpiReport(page: Page) {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 2, name: "Business KPIs" })).toBeVisible();
  await page.getByLabel("Reporting month").fill("2026-07");
  await expect(page.getByText("Loading current records", { exact: true })).toHaveCount(0);
}

test("flooring KPIs render Tier-1 and booking-input formulas, month changes, drill-throughs, and accessible responsive layout", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await mockKpiRecords(page, true);
  await openKpiReport(page);

  const panel = page.locator(".business-kpis");
  await expect(panel.getByText("75%", { exact: true })).toBeVisible();
  await expect(panel.getByText("$165,000", { exact: true })).toBeVisible();
  await expect(panel.getByText("$56,250", { exact: true })).toBeVisible();
  await expect(panel.getByText("6 days", { exact: true })).toBeVisible();
  await expect(panel.getByText("2 jobs", { exact: true })).toBeVisible();
  await expect(panel.getByText("$150,000", { exact: false })).toBeVisible();
  await expect(panel.locator(".business-kpi-card").filter({ hasText: "Jobs completed · July 2026" }).getByText("1", { exact: true })).toBeVisible();
  await expect(panel.locator(".business-kpi-card").filter({ hasText: "Product mix · July 2026" }).getByText("2 categories", { exact: true })).toBeVisible();
  await expect(panel.getByText("$30.00/sq ft", { exact: true })).toBeVisible();
  await expect(panel.getByText("105%", { exact: true })).toBeVisible();

  const sourceTable = panel.getByRole("table").first();
  await expect(sourceTable.getByRole("row", { name: /Website\s+1\s+2\s+50%/ })).toBeVisible();
  await expect(sourceTable.getByRole("row", { name: /Referral\s+1\s+1\s+100%/ })).toBeVisible();
  const productMixTable = panel.getByRole("table").nth(1);
  await expect(productMixTable.getByRole("row", { name: /Hardwood\s+1\s+72\.7%/ })).toBeVisible();
  await expect(productMixTable.getByRole("row", { name: /Carpet\s+1\s+27\.3%/ })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Review lead outcomes" })).toHaveAttribute("href", "/leads");
  await expect(panel.getByRole("link", { name: "View active projects" })).toHaveAttribute("href", "/projects");

  await page.getByLabel("Reporting month").fill("2026-08");
  await expect(panel.getByText("$30,000", { exact: true })).toBeVisible();
  await expect(panel.getByText("Not yet captured", { exact: true })).toHaveCount(3);
  await expect(panel.getByText("Jobs completed · August 2026")).toBeVisible();
  await expect(panel.locator(".business-kpi-card").filter({ hasText: "Jobs completed · August 2026" }).getByText("1", { exact: true })).toBeVisible();

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(panel).toBeVisible();
    const results = await new AxeBuilder({ page }).include(".business-kpis").analyze();
    expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }

  expect(issues, issues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});

test("Office users receive counts and categories but no flooring dollar values", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await mockKpiRecords(page, false);
  await openKpiReport(page);

  const panel = page.locator(".business-kpis");
  await expect(panel.getByText("75%", { exact: true })).toBeVisible();
  await expect(panel.getByText("2 jobs", { exact: true })).toBeVisible();
  await expect(panel.getByText("2 categories", { exact: true })).toBeVisible();
  await expect(panel.getByText("Administrator only", { exact: true })).toHaveCount(6);
  await expect(panel.getByText("Dollar value available to administrators only", { exact: true })).toHaveCount(5);
  await expect(panel).not.toContainText("$165,000");
  await expect(panel).not.toContainText("$150,000");
  await expect(panel).not.toContainText("$56,250");
  await expect(page.locator(".page-wrap")).not.toContainText("$");
});

test("booking-input KPIs show honest empty states for legacy null projects", async ({ page }) => {
  await mockKpiRecords(page, true, projects.map((project) => ({ ...project, flooring_category: null, square_feet: null, contract_value: null })));
  await openKpiReport(page);

  const panel = page.locator(".business-kpis");
  await expect(panel.getByText("Not yet captured", { exact: true })).toHaveCount(3);
  await expect(panel.getByText("Not yet captured — no booked projects carry a flooring category for this month.", { exact: true })).toBeVisible();
  await expect(panel).not.toContainText("NaN");
  await expect(panel).not.toContainText("Infinity");
});
