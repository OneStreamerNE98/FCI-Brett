import { expect, test, type Page } from "@playwright/test";

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

test("invalid query state canonicalizes safely and unknown routes return a real 404", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.goto("/projects?status=not-a-status");
  await expect(page).toHaveURL("http://localhost:4173/projects");
  await waitForHydratedApp(page);
  await expect(page.getByRole("button", { name: /Active/ })).toHaveAttribute("aria-pressed", "true");
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
