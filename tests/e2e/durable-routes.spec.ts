import { expect, test, type Page } from "@playwright/test";

type BrowserIssue = { kind: "console.error" | "pageerror"; detail: string };

const customStageLeadCompany = "FCI TEST — DO NOT USE — Zero-value custom stage";
const standardStageLeadCompany = "FCI TEST — DO NOT USE — Standard report stage";
const reportLeadFixtures = [
  {
    id: "reports-custom-stage-lead",
    leadNumber: "FCI-TEST-REPORTS-CUSTOM",
    company: customStageLeadCompany,
    contactName: "FCI TEST — DO NOT USE — Report Contact",
    projectName: "FCI TEST — DO NOT USE — Report Opportunity",
    source: "Referral",
    stage: "Awaiting samples",
    site: "401 FCI TEST Ave, Cherry Hill, NJ",
    estimatedValue: 0,
    nextAction: "Review the custom stage",
    status: "active",
  },
  {
    id: "reports-standard-stage-lead",
    leadNumber: "FCI-TEST-REPORTS-STANDARD",
    company: standardStageLeadCompany,
    contactName: "FCI TEST — DO NOT USE — Standard Report Contact",
    projectName: "FCI TEST — DO NOT USE — Standard Report Opportunity",
    source: "Website",
    stage: "New inquiry",
    site: "402 FCI TEST Ave, Cherry Hill, NJ",
    estimatedValue: 25000,
    nextAction: "Keep this record outside the Other stages result",
    status: "active",
  },
] as const;

async function mockReportLeads(page: Page) {
  await page.route("**/api/v1/leads", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ leads: reportLeadFixtures }),
    });
  });
}

function monitorBrowserHealth(page: Page) {
  const issues: BrowserIssue[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") issues.push({ kind: "console.error", detail: message.text() });
  });
  page.on("pageerror", (error) => issues.push({ kind: "pageerror", detail: error.stack ?? error.message }));
  return issues;
}

function expectHealthyBrowser(issues: BrowserIssue[]) {
  expect(issues, issues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
}

async function waitForHydratedApp(page: Page) {
  await expect(page.getByText("Loading live records", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);
}

const primaryRoutes = [
  { path: "/", view: "Overview", heading: /Good (morning|afternoon|evening),/ },
  { path: "/leads", view: "Leads", heading: "Leads & opportunities" },
  { path: "/clients", view: "Clients", heading: "Clients" },
  { path: "/projects", view: "Projects", heading: "Projects" },
  { path: "/schedule", view: "Schedule", heading: "Schedule & crews" },
  { path: "/inbox", view: "Inbox", heading: "Gmail project inbox" },
  { path: "/assistant", view: "AI Assistant", heading: "Ask FCI Assistant" },
  { path: "/reports", view: "Reports", heading: "Reports" },
  { path: "/settings", view: "Settings", heading: "Settings" },
] as const;

test("all primary views support direct entry and current-link semantics", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  for (const route of primaryRoutes) {
    const response = await page.goto(route.path);
    expect(response?.ok(), route.path).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    if (route.view !== "Schedule") {
      await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: new RegExp(`^${route.view} ·`) })).toHaveAttribute("aria-current", "page");
    }
    await expect(page.locator("vite-error-overlay, nextjs-portal")).toHaveCount(0);
  }
  expectHealthyBrowser(issues);
});

test("real navigation links preserve Back and Forward history", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.goto("/");
  await waitForHydratedApp(page);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const projects = navigation.getByRole("link", { name: "Projects · In development" });
  const settings = navigation.getByRole("link", { name: "Settings · In development" });
  await expect(projects).toHaveAttribute("href", "/projects");
  await projects.click();
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await settings.click();
  await expect(page).toHaveURL("http://localhost:4173/settings");
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:4173/");
  await page.goForward();
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await page.goForward();
  await expect(page).toHaveURL("http://localhost:4173/settings");
  expectHealthyBrowser(issues);
});

test("project, Settings, and Inbox selections are bookmarkable and history-aware", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.goto("/projects");
  await waitForHydratedApp(page);
  await page.getByRole("button", { name: /Archived/ }).click();
  await expect(page).toHaveURL("http://localhost:4173/projects?status=archived");
  await expect(page.getByRole("button", { name: /Archived/ })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: /Archived/ })).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await expect(page.getByRole("button", { name: /Active/ })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/settings?section=calendar");
  await waitForHydratedApp(page);
  await expect(page.getByRole("button", { name: "Calendar & appointments" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Inbox & file rules" }).click();
  await expect(page).toHaveURL("http://localhost:4173/settings?section=inbox-rules");
  await expect(page.getByRole("heading", { level: 2, name: "Inbox & file rules" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:4173/settings?section=calendar");

  await page.goto("/inbox?bucket=needs-review");
  await waitForHydratedApp(page);
  const mailbox = page.locator(".live-inbox-toolbar select");
  await expect(mailbox).toHaveValue("needs-review");
  await mailbox.selectOption("filed");
  await expect(page).toHaveURL("http://localhost:4173/inbox?bucket=filed");
  await page.reload();
  await expect(page.locator(".live-inbox-toolbar select")).toHaveValue("filed");
  expectHealthyBrowser(issues);
});

test("Reports chart rows drill through to exact bookmarkable filters and preserve Back focus", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await mockReportLeads(page);
  await page.goto("/reports");
  await waitForHydratedApp(page);

  const mobilizingLink = page.getByRole("link", { name: /View Mobilizing projects/ });
  await expect(mobilizingLink).toHaveAttribute("href", "/projects?status=mobilizing");
  await expect(mobilizingLink).not.toHaveAttribute("target", "_blank");
  await mobilizingLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("http://localhost:4173/projects?status=mobilizing");
  const projectFilter = page.locator(".active-route-filter").filter({ hasText: "Filtered to Mobilizing" });
  await expect(projectFilter).toBeVisible();
  await expect(projectFilter).toBeFocused();
  const projectStatuses = await page.locator(".projects-table-row .project-row-status").allTextContents();
  expect(projectStatuses.length).toBeGreaterThan(0);
  expect(new Set(projectStatuses.map((status) => status.trim()))).toEqual(new Set(["Mobilizing"]));
  await page.reload();
  await expect(page.locator(".active-route-filter")).toContainText("Filtered to Mobilizing");
  await expect(page.locator(".active-route-filter")).not.toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:4173/reports");
  await expect(page.getByRole("link", { name: /View Mobilizing projects/ })).toBeFocused();

  const otherStagesLink = page.getByRole("link", { name: /View Other stages leads/ });
  await expect(otherStagesLink).toHaveAttribute("href", "/leads?stage=other");
  await expect(otherStagesLink).toContainText("$0");
  await otherStagesLink.click();
  await expect(page).toHaveURL("http://localhost:4173/leads?stage=other");
  const leadFilter = page.locator(".active-route-filter").filter({ hasText: "Filtered to Other stages" });
  await expect(leadFilter).toBeVisible();
  await expect(leadFilter).toBeFocused();
  await expect(page.getByText(customStageLeadCompany, { exact: true })).toBeVisible();
  await expect(page.getByText(standardStageLeadCompany, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `View details for ${customStageLeadCompany}` })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Inactive leads" })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".active-route-filter")).toContainText("Filtered to Other stages");
  await expect(page.locator(".active-route-filter")).not.toBeFocused();
  await page.getByRole("link", { name: "Clear filter" }).click();
  await expect(page).toHaveURL("http://localhost:4173/leads");
  await expect(page.locator(".active-route-filter")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reports");
  await waitForHydratedApp(page);
  const mobileOtherStagesLink = page.getByRole("link", { name: /View Other stages leads/ });
  await expect(mobileOtherStagesLink).not.toBeFocused();
  const mobileTarget = await mobileOtherStagesLink.boundingBox();
  expect(mobileTarget?.height ?? 0).toBeGreaterThanOrEqual(44);
  const overflowsViewport = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowsViewport).toBe(false);
  expectHealthyBrowser(issues);
});

test("Reports keeps zero-record and unsupported lifecycle rows static", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.route("**/api/v1/leads", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        leads: [{
          id: "reports-static-lead",
          leadNumber: "FCI-TEST-REPORTS-STATIC",
          company: "FCI TEST — DO NOT USE — Static report lead",
          contactName: "FCI TEST — DO NOT USE — Report Contact",
          projectName: "FCI TEST — DO NOT USE — Report Opportunity",
          source: "Website",
          stage: "New inquiry",
          site: "403 FCI TEST Ave, Cherry Hill, NJ",
          estimatedValue: 1000,
          nextAction: "Verify static report rows",
          status: "active",
        }],
      }),
    });
  });
  await page.route("**/api/v1/dashboard", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: Date.now(),
        metrics: { activeLeads: 1, estimatedPipelineValue: 1000, activeProjects: 1, clientCount: 1, meetingCount: 0, filedEmailCount: 0 },
        projectsByStatus: [{ status: "mobilizing", count: 1 }, { status: "paused", count: 2 }],
        recentActivity: [],
        readiness: { scheduleDataAvailable: false, reportsUseLiveProjectLeadTotals: true },
      }),
    });
  });

  await page.goto("/reports");
  await waitForHydratedApp(page);

  const proposalRow = page.locator(".report-chart").filter({ hasText: "Pipeline by stage" }).locator(".bar-chart-row").filter({ hasText: "Proposal" });
  await expect(proposalRow).toBeVisible();
  await expect(proposalRow).not.toHaveAttribute("href", /.+/);
  await expect(page.getByRole("link", { name: /View Proposal leads/ })).toHaveCount(0);

  const unsupportedStatusRow = page.locator(".report-chart").filter({ hasText: "Projects by status" }).locator(".bar-chart-row").filter({ hasText: "Paused" });
  await expect(unsupportedStatusRow).toBeVisible();
  await expect(unsupportedStatusRow).not.toHaveAttribute("href", /.+/);
  await expect(page.getByRole("link", { name: /View Paused projects/ })).toHaveCount(0);

  await page.evaluate(() => {
    window.history.replaceState({ ...(window.history.state ?? {}), fciReportsReturnFocusId: "report-lead-other" }, "", window.location.href);
  });
  await page.reload();
  await waitForHydratedApp(page);
  await expect.poll(() => page.evaluate(() => !("fciReportsReturnFocusId" in (window.history.state ?? {})))).toBe(true);
  expectHealthyBrowser(issues);
});

test("invalid query state canonicalizes safely and unknown routes return a real 404", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.goto("/projects?status=not-a-status");
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await waitForHydratedApp(page);
  await expect(page.getByRole("button", { name: /Active/ })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/projects?status=planning&status=closeout");
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await page.goto("/leads?stage=outdated-stage");
  await expect(page).toHaveURL("http://localhost:4173/leads");
  await page.goto("/leads?stage=proposal&stage=decision");
  await expect(page).toHaveURL("http://localhost:4173/leads");
  await page.goto("/reports?stage=proposal&status=planning");
  await expect(page).toHaveURL("http://localhost:4173/reports");
  expectHealthyBrowser(issues);
  issues.length = 0;

  const response = await page.goto("/not-an-fci-route");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to overview" })).toHaveAttribute("href", "/");
  await expect(page.locator("vite-error-overlay, nextjs-portal")).toHaveCount(0);
  const unexpectedIssues = issues.filter((issue) => issue.kind !== "console.error" || !issue.detail.includes("404 (Not Found)"));
  expectHealthyBrowser(unexpectedIssues);
});

test("an outside identity is denied on a direct route before operational APIs load", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  let operationalFetches = 0;
  await page.route(/\/api\/v1\/(leads|clients|projects|dashboard)/, async (route) => {
    operationalFetches += 1;
    await route.continue();
  });
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "outsider@example.net",
    "oai-authenticated-user-full-name": encodeURIComponent("Outside User"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });

  const response = await page.goto("/projects");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "Access not authorized" })).toBeVisible();
  expect(operationalFetches).toBe(0);
  expectHealthyBrowser(issues);
});

test("mobile link navigation closes the drawer and preserves the destination", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForHydratedApp(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Projects · In development" }).click();
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.locator("#application-navigation")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("main")).not.toHaveAttribute("inert");
  await page.reload();
  await expect(page).toHaveURL("http://localhost:4173/projects");
  expectHealthyBrowser(issues);
});
