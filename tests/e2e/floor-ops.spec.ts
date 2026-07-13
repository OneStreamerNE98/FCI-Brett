import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const projectNumber = "CF-2026-E2E00001";
const projectName = "E2E Mobile Metadata Project";
const projectSite = "201 E2E Test Ave, Cherry Hill, NJ";

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
  await expect(page.getByRole("img", { name: "Floor Coverings International" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await waitForLiveRecords(page);
  await expect(page.getByRole("button", { name: new RegExp(projectName) })).toBeVisible();
  await expectNoSeriousAxeViolations(page, ".page-wrap");
  expectHealthyBrowser(issues);
});

test("mobile navigation traps focus and restores the menu trigger on every close path", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForLiveRecords(page);

  const trigger = page.getByRole("button", { name: "Open navigation" });
  const navigation = page.locator("#application-navigation");
  const main = page.getByRole("main");

  await trigger.click();
  const close = page.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeFocused();
  await expect(navigation).toHaveAttribute("role", "dialog");
  await expect(main).toHaveAttribute("inert", "");
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
  await expect(navigation.getByRole("button", { name: "Overview · Working" })).toContainText("Working");
  await expect(navigation.getByRole("button", { name: "Projects · In development" })).toContainText("In development");

  await page.getByRole("button", { name: "Scheduling setup" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Schedule & crews" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scheduling is not available yet" })).toBeVisible();
  await expect(page.locator(".page-heading .feature-state")).toHaveText("Planned");
  await expect(page.getByRole("button", { name: /publish|assign/i })).toHaveCount(0);

  await navigation.getByRole("button", { name: "Projects · In development" }).click();
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
  await page.getByRole("button", { name: "Projects · In development" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  const row = page.getByRole("button", { name: new RegExp(projectName) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Not scheduled", { exact: true })).toBeVisible();
  await expect(row.getByText(projectSite, { exact: true })).toBeVisible();
  await expect(row.locator(".project-row-value")).toContainText("$125,000");
});
