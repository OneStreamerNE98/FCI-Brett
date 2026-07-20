import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const projectNumber = "CF-2026-E2E00001";
const projectName = "E2E Mobile Metadata Project";
const projectSite = "201 E2E Test Ave, Cherry Hill, NJ";
const leadCompany = "FCI TEST — DO NOT USE — Lead Drawer Client";

async function ensureLeadDrawerRecord(page: Page) {
  const existingResponse = await page.request.get("/api/v1/leads");
  expect(existingResponse.ok()).toBe(true);
  const existingPayload = await existingResponse.json() as { leads?: Array<{ id: string; company?: string; stage?: string; status?: string }> };
  const existingLead = existingPayload.leads?.find((lead) => lead.company === leadCompany);
  if (existingLead) {
    if (existingLead.stage !== "New inquiry" || existingLead.status !== "active") {
      const resetResponse = await page.request.patch(`/api/v1/leads/${encodeURIComponent(existingLead.id)}`, {
        headers: { Origin: "http://localhost:4173" },
        data: { stage: "New inquiry", status: "active" },
      });
      expect(resetResponse.ok()).toBe(true);
    }
    return;
  }

  const createdResponse = await page.request.post("/api/v1/leads", {
    headers: { Origin: "http://localhost:4173" },
    data: {
      company: leadCompany,
      contactName: "FCI TEST — DO NOT USE — Lead Contact",
      projectName: "FCI TEST — DO NOT USE — Lead Drawer Opportunity",
      source: "Website",
      stage: "New inquiry",
      site: "301 FCI TEST Ave, Cherry Hill, NJ",
      estimatedValue: 25000,
      nextAction: "Review the read-only lead details",
      status: "active",
    },
  });
  expect(createdResponse.status()).toBe(201);
}

type BrowserIssue = { kind: "console.error" | "pageerror"; detail: string };

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

async function waitForLiveRecords(page: Page) {
  await expect(page.getByText("Here’s the latest from your operations workspace.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);
}

async function expectNoSeriousAxeViolations(page: Page, include: string) {
  const builder = new AxeBuilder({ page }).disableRules(["color-contrast"]);
  builder.include(include);
  const results = await builder.analyze();
  const violations = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test("has a clear page identity, meaningful live render, and healthy browser console", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle("FCI Operations | Development");
  await expect(page).toHaveURL("http://localhost:4173/");
  const fullLogo = page.getByRole("img", { name: "Floor Coverings International" });
  await expect(fullLogo).toBeVisible();
  await expect(fullLogo).toHaveAttribute("src", "/fci-logo-enhanced-master.png");
  expect(await fullLogo.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 1254, height: 1254 });
  await expect(page.locator('link[rel="shortcut icon"]')).toHaveAttribute("href", /\/fci-app-icon-master\.png$/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /\/fci-app-icon-master\.png$/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/fci-app-icon-master\.png$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await waitForLiveRecords(page);
  await expect(page.getByRole("button", { name: new RegExp(projectName) })).toBeVisible();
  await expectNoSeriousAxeViolations(page, ".page-wrap");
  expectHealthyBrowser(issues);
});

test("desktop sidebar collapse control stays fully clickable and expands again", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitForLiveRecords(page);

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  const sidebar = page.locator("#application-navigation");
  const fullLogo = sidebar.locator(".brand-full");
  const compactLogo = sidebar.locator(".brand-compact img");
  const expand = page.getByRole("button", { name: "Expand navigation" });
  await expect(expand).toBeVisible();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(78);
  await expect(fullLogo).toBeHidden();
  await expect(compactLogo).toBeVisible();
  await expect(compactLogo).toHaveAttribute("src", "/fci-app-icon-master.png");
  expect(await compactLogo.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 1254, height: 1254 });

  const box = await expand.boundingBox();
  if (!box) throw new Error("Expand navigation control has no rendered bounds");
  const rightEdge = { x: box.x + box.width - 1, y: box.y + box.height / 2 };
  const rightEdgeHitsControl = await page.evaluate(({ x, y }) => {
    const control = document.querySelector<HTMLButtonElement>(".sidebar-collapse");
    const hit = document.elementFromPoint(x, y);
    return Boolean(control && hit && (hit === control || control.contains(hit)));
  }, rightEdge);

  expect(rightEdgeHitsControl).toBe(true);
  await page.mouse.click(rightEdge.x, rightEdge.y);
  await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeVisible();
  await expect(page.locator(".app-shell")).not.toHaveClass(/sidebar-is-collapsed/);
  await expect(fullLogo).toBeVisible();
  await expect(compactLogo).toBeHidden();
  expectHealthyBrowser(issues);
});

test("mobile navigation traps focus and restores the menu trigger on every close path", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitForLiveRecords(page);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.setViewportSize({ width: 390, height: 844 });

  const trigger = page.getByRole("button", { name: "Open navigation" });
  const navigation = page.locator("#application-navigation");
  const main = page.getByRole("main");

  await trigger.click();
  const close = page.getByRole("button", { name: "Close navigation" });
  const fullLogo = navigation.locator(".brand-full");
  const compactLogo = navigation.locator(".brand-compact img");
  await expect(close).toBeFocused();
  await expect(navigation).toHaveAttribute("role", "dialog");
  await expect.poll(async () => (await navigation.boundingBox())?.width).toBe(246);
  await expect(main).toHaveAttribute("inert", "");
  await expect(fullLogo).toBeVisible();
  await expect(compactLogo).toBeHidden();
  const [navigationBox, logoBox, closeBox] = await Promise.all([navigation.boundingBox(), fullLogo.boundingBox(), close.boundingBox()]);
  if (!navigationBox || !logoBox || !closeBox) throw new Error("Mobile navigation logo or close control has no rendered bounds");
  expect(logoBox.x).toBeGreaterThanOrEqual(navigationBox.x);
  expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(navigationBox.x + navigationBox.width);
  expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(closeBox.x);
  await expectNoSeriousAxeViolations(page, "#application-navigation");

  await page.keyboard.press("Shift+Tab");
  expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await navigation.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(navigation).toHaveAttribute("aria-hidden", "true");
  await expect(navigation).toHaveAttribute("inert", "");
  await expect(main).not.toHaveAttribute("inert");

  await trigger.click();
  await close.click();
  await expect(trigger).toBeFocused();
});

test("mobile navigation keeps management labels and compact status on one line without horizontal scrolling", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await waitForLiveRecords(page);

    await page.getByRole("button", { name: "Open navigation" }).click();
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    const managementLinks = [
      { link: navigation.getByRole("link", { name: "Reports · Working" }), compactState: "Working" },
      { link: navigation.getByRole("link", { name: "Settings · In development" }), compactState: "Dev" },
      { link: navigation.getByRole("link", { name: "People & Access · In development" }), compactState: "Dev" },
    ];

    await expect(navigation).toBeVisible();
    const navigationWidth = await navigation.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(navigationWidth.scrollWidth).toBeLessThanOrEqual(navigationWidth.clientWidth);

    for (const { link, compactState } of managementLinks) {
      await expect(link).toBeVisible();
      const stateBadge = link.locator(".feature-state");
      await expect(stateBadge).toBeVisible();
      const renderedCompactState = await stateBadge.evaluate((element) => (
        window.getComputedStyle(element, "::after").content.replaceAll('"', "")
      ));
      expect(renderedCompactState).toBe(compactState);
      const labelLayout = await link.locator(".nav-label").evaluate((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        return {
          clientWidth: element.clientWidth,
          height: bounds.height,
          scrollWidth: element.scrollWidth,
          textWidth: textRange.getBoundingClientRect().width,
          whiteSpace: style.whiteSpace,
        };
      });
      expect(labelLayout.whiteSpace).toBe("nowrap");
      expect(labelLayout.scrollWidth).toBeLessThanOrEqual(labelLayout.clientWidth);
      expect(labelLayout.textWidth).toBeLessThanOrEqual(labelLayout.clientWidth);
      expect(labelLayout.height).toBeLessThan(24);
    }

    await page.getByRole("button", { name: "Close navigation" }).click();
  }
});

test("global search supports the keyboard and returns focus after opening a project", async ({ page }) => {
  await page.goto("/");
  await waitForLiveRecords(page);

  const search = page.getByRole("combobox", { name: "Search workspace" });
  await search.fill(projectNumber);
  await search.press("Enter");

  const listbox = page.getByRole("listbox", { name: "Workspace search results" });
  const projectOption = listbox.getByRole("option", { name: new RegExp(projectNumber) });
  await expect(listbox).toBeVisible();
  await expect(projectOption).toHaveAttribute("aria-selected", "true");
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("aria-activedescendant", "workspace-search-option-0");

  await search.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(search).toBeFocused();

  await search.press("Enter");
  await expect(projectOption).toBeVisible();
  await search.press("Enter");

  const drawer = page.getByRole("dialog", { name: new RegExp(`${projectNumber} ${projectName}`) });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: projectName })).toBeVisible();
  await drawer.getByRole("button", { name: "Close project" }).click();
  await expect(search).toBeFocused();
});

test("feature labels distinguish working, in-development, setup-required, and planned experiences", async ({ page }) => {
  await page.goto("/");
  await waitForLiveRecords(page);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(page.getByRole("status", { name: "Development environment; test data only" })).toContainText("Development environment · Test data only");
  await expect(navigation.getByRole("link", { name: "Overview · Working" })).toContainText("Working");
  await expect(navigation.getByRole("link", { name: "Projects · In development" })).toContainText("In development");

  await page.getByRole("button", { name: "View scheduling status" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Schedule & crews" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What the scheduling workspace will include" })).toBeVisible();
  await expect(page.locator(".page-heading .feature-state")).toHaveText("Planned");
  await expect(page.getByRole("button", { name: /publish|assign/i })).toHaveCount(0);

  await navigation.getByRole("link", { name: "Projects · In development" }).click();
  const row = page.getByRole("button", { name: new RegExp(projectName) });
  await row.click();
  const drawer = page.getByRole("dialog", { name: new RegExp(projectNumber) });
  const plan = drawer.locator(".project-capability-plan");
  await expect(plan.getByRole("heading", { name: "Planned project capabilities" })).toBeVisible();
  await expect(plan.getByText("Planned", { exact: true })).toBeVisible();
  await expect(plan.getByRole("button")).toHaveCount(0);
  await expect(drawer.locator(".planned-project-updates")).toContainText("Planned");
});

test("390px project rows preserve schedule, site, and value metadata", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForLiveRecords(page);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Projects · In development" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  const row = page.getByRole("button", { name: new RegExp(projectName) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Not scheduled", { exact: true })).toBeVisible();
  await expect(row.getByText(projectSite, { exact: true })).toBeVisible();
  await expect(row.locator(".project-row-value")).toContainText("$125,000");
});

test("overview keeps lead next actions visible at tablet and mobile widths", async ({ page }) => {
  await ensureLeadDrawerRecord(page);

  for (const viewport of [
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".pipeline-row .next-cell").first()).toBeVisible();
  }
});

test("lead details open separately from stage advancement and restore focus", async ({ page }) => {
  await ensureLeadDrawerRecord(page);
  await page.goto("/leads");
  await expect(page.getByRole("heading", { level: 1, name: "Leads & opportunities" })).toBeVisible();

  const card = page.locator(".lead-card").filter({ hasText: leadCompany });
  const detailsTrigger = card.getByRole("button", { name: `View details for ${leadCompany}`, exact: true });
  const cardAdvance = card.getByRole("button", { name: `Advance ${leadCompany} from New inquiry` });
  await expect(detailsTrigger).toBeVisible();
  await expect(detailsTrigger).toContainText("View details");
  await expect(cardAdvance).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);

  await detailsTrigger.click();
  const drawer = page.getByRole("dialog", { name: new RegExp(leadCompany) });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 2, name: leadCompany })).toBeVisible();
  await expect(drawer.getByText("This drawer is read-only.", { exact: false })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Advance stage" })).toBeVisible();

  await drawer.getByRole("button", { name: "Close lead details" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(detailsTrigger).toBeFocused();
});

test("clients can be filtered by code and show a clear no-match state", async ({ page }) => {
  await page.goto("/clients");
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();

  const filter = page.getByRole("textbox", { name: "Find a client" });
  const clientRow = page.getByRole("button", { name: /E2E Regression Client/ });
  await expect(filter).toBeVisible();
  await expect(clientRow).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);

  await filter.fill("no-such-e2e-client");
  await expect(clientRow).toHaveCount(0);
  await expect(page.getByText("No clients match “no-such-e2e-client”.", { exact: true })).toBeVisible();

  await filter.fill("E2E-CLIENT");
  await expect(clientRow).toBeVisible();
  await expect(page.locator(".client-directory-toolbar")).toContainText(/1 of \d+ clients/);
});

test("inbox keeps one primary load action and exposes semantic status details", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { level: 1, name: "Gmail project inbox" })).toBeVisible();

  const loadMessages = page.getByRole("button", { name: "Load messages", exact: true });
  await expect(loadMessages).toHaveCount(1);
  await expect(loadMessages).toHaveClass(/primary-button/);
  await expect(page.locator(".inbox-empty").getByRole("button", { name: "Load messages", exact: true })).toHaveCount(0);

  const summary = page.locator(".inbox-summary");
  await expect(summary.getByRole("heading", { level: 2, name: "Inbox status" })).toBeVisible();
  const statusList = summary.locator("dl.inbox-status-list");
  await expect(statusList.locator("dt")).toHaveText(["Provider", "Message limit", "Filing protection"]);
  await expect(statusList.locator("dd")).toHaveCount(3);
});

test("assistant exposes one visible project context and one suggested-question family", async ({ page }) => {
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { level: 1, name: "Ask FCI Assistant" })).toBeVisible();

  const projectContext = page.getByRole("combobox", { name: "Project context" });
  await expect(projectContext).toHaveCount(1);
  await expect(projectContext).toBeVisible();
  await expect(projectContext.locator("option").filter({ hasText: projectName })).toHaveCount(1);
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);

  const suggestedQuestions = [
    "What is the current project status?",
    "Who is the primary contact?",
    "How many email archives are linked?",
    "What evidence has not been captured yet?",
  ];
  const questionPanel = page.locator(".recent-questions");
  await expect(questionPanel.getByRole("heading", { level: 3, name: "Suggested questions" })).toHaveCount(1);
  await expect(questionPanel.getByRole("button")).toHaveCount(suggestedQuestions.length);
  for (const question of suggestedQuestions) {
    await expect(page.getByRole("button", { name: new RegExp(question.replace(/[?]/g, "\\?")) })).toHaveCount(1);
  }
  await expect(page.locator(".assistant-main").getByRole("button", { name: /current project status|primary contact|email archives|evidence has not/i })).toHaveCount(0);
});

test("reports explain active project coverage and expose semantic lifecycle drill-through", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();

  await expect(page.getByText("Current", { exact: true })).toHaveCount(0);
  const activeProjects = page.locator(".metrics-grid > .metric-card").filter({ hasText: "Active projects" });
  await expect(activeProjects).toHaveCount(1);
  await expect(activeProjects).toContainText(/\d+ of \d+ project records active/);
  await expect(page.getByRole("link", { name: /View Mobilizing projects/ })).toHaveAttribute("href", "/projects?status=mobilizing");
  await expect(page.locator(".bar-chart [role=img]")).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);
});
