import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const NOW = Date.UTC(2026, 6, 16, 14, 0, 0);
const THIRTY_DAYS = 30 * 24 * 60 * 60_000;
const SEVEN_DAYS = 7 * 24 * 60 * 60_000;
const browserIssues = new WeakMap<Page, string[]>();
const expectedBrowserIssues = new WeakMap<Page, string[]>();

type AuditEvent = Readonly<{
  actorLabel: string;
  actionLabel: string;
  targetLabel: string;
  result: "succeeded" | "failed" | "denied";
  reason: string | null;
  occurredAt: number;
}>;

type AuditPage = Readonly<{
  events: readonly AuditEvent[];
  nextCursor: string | null;
  generatedAt: number;
}>;

const firstEvent: AuditEvent = Object.freeze({
  actorLabel: "Admin CRM",
  actionLabel: "Invitation created",
  targetLabel: "pending.person@cherryhillfci.com",
  result: "succeeded",
  reason: "New office hire",
  occurredAt: NOW,
});

const secondEvent: AuditEvent = Object.freeze({
  actorLabel: "Brett",
  actionLabel: "Workspace action denied",
  targetLabel: "Calendar event",
  result: "denied",
  reason: null,
  occurredAt: NOW - 60_000,
});

test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  browserIssues.set(page, issues);
  expectedBrowserIssues.set(page, []);
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.stack ?? error.message}`));
});

test.afterEach(async ({ page }) => {
  await page.waitForTimeout(0);
  const issues = browserIssues.get(page) ?? [];
  expect(issues, issues.join("\n\n")).toEqual(expectedBrowserIssues.get(page) ?? []);
});

function accessOverview() {
  return {
    summary: { activePeopleCount: 2, activeAdministratorCount: 2, pendingInvitationCount: 0 },
    roles: [
      { key: "administrator", displayName: "Administrator", description: "Company-wide administration." },
      { key: "office_operations", displayName: "Office Operations", description: "Company-wide nonfinancial operations." },
      { key: "project_manager", displayName: "Project Manager", description: "Assigned-project nonfinancial operations." },
    ],
    people: [
      { id: "11111111-1111-4111-8111-111111111111", displayName: "E2E Admin", email: "e2e-admin@example.test", role: "administrator", status: "active", projectIds: [], lastSignedInAt: NOW, version: "1" },
      { id: "22222222-2222-4222-8222-222222222222", displayName: "FCI TEST — DO NOT USE Backup Admin", email: "backup.admin@cherryhillfci.com", role: "administrator", status: "active", projectIds: [], lastSignedInAt: NOW, version: "1" },
    ],
    invitations: [],
    projects: [],
    generatedAt: NOW,
  };
}

function auditPage(
  events: readonly AuditEvent[],
  nextCursor: string | null = null,
): AuditPage {
  return { events, nextCursor, generatedAt: NOW + 1_000 };
}

async function fulfillAudit(route: Route, page: AuditPage, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(status === 200 ? { data: page } : { error: "audit_unavailable" }),
  });
}

async function installAdminApis(
  page: Page,
  auditHandler: (route: Route, url: URL, requestIndex: number) => Promise<void>,
) {
  const auditRequests: URL[] = [];
  await page.route("**/api/v1/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/admin/access") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: accessOverview() }),
      });
      return;
    }
    if (url.pathname === "/api/v1/admin/audit") {
      auditRequests.push(url);
      await auditHandler(route, url, auditRequests.length - 1);
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
  });
  return auditRequests;
}

async function openActivity(page: Page) {
  const response = await page.goto("/management/access");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Activity" })).toBeVisible();
}

function expectCanonicalWindow(url: URL, duration: number) {
  const from = url.searchParams.get("from");
  const before = url.searchParams.get("before");
  expect(from).not.toBeNull();
  expect(before).not.toBeNull();
  expect(new Date(from!).toISOString()).toBe(from);
  expect(new Date(before!).toISOString()).toBe(before);
  expect(Date.parse(before!) - Date.parse(from!)).toBe(duration);
}

test("Activity is a lazy minimized view with a bounded default request", async ({ page }) => {
  const requests = await installAdminApis(page, (route) => fulfillAudit(
    route,
    auditPage([firstEvent, secondEvent]),
  ));

  await page.goto("/management/access");
  await expect(page.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await expect(page.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Activity" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("table", { name: "Security activity" })).toContainText("Invitation created");
  await expect(page.getByRole("table", { name: "Security activity" })).toContainText("No reason recorded");
  await expect(page.getByRole("columnheader")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Invite person" })).toHaveCount(0);
  await expect(page.getByText("authorization.user_access_changed")).toHaveCount(0);
  await expect(page.getByText("request-credential-that-must-not-render")).toHaveCount(0);

  expect(requests).toHaveLength(1);
  expect([...requests[0]!.searchParams.keys()].sort()).toEqual(["before", "from", "limit"]);
  expect(requests[0]!.searchParams.get("limit")).toBe("25");
  expectCanonicalWindow(requests[0]!, THIRTY_DAYS);
});

test("actor labels accept the 320-character projection boundary and reject longer values", async ({ page }) => {
  const maximumActor = "A".repeat(320);
  const oversizedActor = "B".repeat(321);
  const requests = await installAdminApis(page, (route, _url, index) => {
    if (index === 0) {
      return fulfillAudit(route, auditPage([{ ...firstEvent, actorLabel: maximumActor }], "old-page-two"));
    }
    if (index === 1) {
      return fulfillAudit(route, auditPage([{ ...firstEvent, actorLabel: oversizedActor }]));
    }
    return fulfillAudit(route, auditPage([secondEvent]));
  });
  await openActivity(page);

  await expect(page.getByRole("table", { name: "Security activity" })).toContainText(maximumActor);
  await page.getByLabel("Date").selectOption("7d");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("alert")).toContainText("Security activity could not be loaded");
  await expect(page.getByRole("table", { name: "Security activity" })).toContainText(maximumActor);
  await expect(page.getByText(oversizedActor)).toHaveCount(0);

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("table", { name: "Security activity" })).toContainText("Brett");
  expect(requests).toHaveLength(3);
  expect(requests[2]!.searchParams.get("cursor")).toBe("old-page-two");
  expect(requests[2]!.searchParams.get("from")).toBe(requests[0]!.searchParams.get("from"));
  expect(requests[2]!.searchParams.get("before")).toBe(requests[0]!.searchParams.get("before"));
});

test("fixed filters apply once, use a stable window, and clear to the safe default", async ({ page }) => {
  const requests = await installAdminApis(page, async (route, url) => {
    const filtered = url.searchParams.get("result") === "denied";
    await fulfillAudit(route, auditPage(filtered ? [] : [firstEvent]));
  });
  await openActivity(page);

  await page.getByLabel("Date").selectOption("7d");
  await page.getByLabel("Result").selectOption("denied");
  await page.getByLabel("Action").selectOption("workspace");
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page.getByText("No activity matches these filters")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeFocused();
  expect(requests).toHaveLength(2);
  expect(requests[1]!.searchParams.get("result")).toBe("denied");
  expect(requests[1]!.searchParams.get("category")).toBe("workspace");
  expectCanonicalWindow(requests[1]!, SEVEN_DAYS);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("table", { name: "Security activity" })).toContainText("Invitation created");
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeFocused();
  await expect(page.getByLabel("Date")).toHaveValue("30d");
  await expect(page.getByLabel("Result")).toHaveValue("all");
  await expect(page.getByLabel("Action")).toHaveValue("all");
  expect([...requests[2]!.searchParams.keys()].sort()).toEqual(["before", "from", "limit"]);
});

test("Load more preserves existing rows after failure and retries the same cursor window", async ({ page }) => {
  expectedBrowserIssues.get(page)?.push(
    "console.error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  );
  const requests = await installAdminApis(page, async (route, _url, index) => {
    if (index === 0) {
      await fulfillAudit(route, auditPage([firstEvent], "opaque-page-two"));
    } else if (index === 1) {
      await fulfillAudit(route, auditPage([]), 500);
    } else {
      await fulfillAudit(route, auditPage([secondEvent]));
    }
  });
  await openActivity(page);

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("alert")).toContainText("records already shown were kept");
  await expect(page.getByRole("table", { name: "Security activity" })).toContainText("Invitation created");
  await page.getByRole("alert").getByRole("button", { name: "Retry" }).click();

  const table = page.getByRole("table", { name: "Security activity" });
  await expect(table).toContainText("Invitation created");
  await expect(table).toContainText("Workspace action denied");
  await expect(page.getByText("All matching activity is shown.")).toBeVisible();
  expect(requests[1]!.searchParams.get("cursor")).toBe("opaque-page-two");
  expect(requests[2]!.searchParams.get("cursor")).toBe("opaque-page-two");
  expect(requests[1]!.searchParams.get("from")).toBe(requests[2]!.searchParams.get("from"));
  expect(requests[1]!.searchParams.get("before")).toBe(requests[2]!.searchParams.get("before"));
});

test("period and all-history empty states remain accurate", async ({ page }) => {
  await installAdminApis(page, (route) => fulfillAudit(route, auditPage([])));
  await openActivity(page);

  await expect(page.getByText("No activity in this period")).toBeVisible();
  await expect(page.getByText("No activity has been recorded yet")).toHaveCount(0);
  await page.getByLabel("Date").selectOption("all");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No activity has been recorded yet")).toBeVisible();
});

test("initial errors retry independently and expired sessions clear the whole screen", async ({ page }) => {
  expectedBrowserIssues.get(page)?.push(
    "console.error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  );
  let attempts = 0;
  await installAdminApis(page, async (route) => {
    attempts += 1;
    if (attempts === 1) await fulfillAudit(route, auditPage([]), 500);
    else await fulfillAudit(route, auditPage([firstEvent]));
  });
  const response = await page.goto("/management/access");
  expect(response?.ok()).toBe(true);
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity is unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("table", { name: "Security activity" })).toContainText("Invitation created");
  await page.getByRole("tab", { name: "People" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "People" })).toBeVisible();

  await page.unroute("**/api/v1/admin/**");
  expectedBrowserIssues.get(page)?.push(
    "console.error: Failed to load resource: the server responded with a status of 401 (Unauthorized)",
  );
  await page.route("**/api/v1/admin/access", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: accessOverview() }),
  }));
  await page.route("**/api/v1/admin/audit**", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "authentication_required" }),
  }));
  await page.reload();
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("tabs, responsive cards, and the minimized Activity panel remain accessible", async ({ page }) => {
  await installAdminApis(page, (route) => fulfillAudit(route, auditPage([firstEvent, secondEvent])));
  await openActivity(page);

  const activityTab = page.getByRole("tab", { name: "Activity" });
  await activityTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "People" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(activityTab).toBeFocused();
  await expect(page.getByRole("heading", { level: 2, name: "Activity" })).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 640, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("table", { name: "Security activity" })).toBeVisible();
  }

  const results = await new AxeBuilder({ page }).include(".access-management-page").analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
});

test("non-Administrators and outside-domain identities are denied before Activity fetches", async ({ page }) => {
  let auditFetches = 0;
  await page.route("**/api/v1/admin/audit**", async (route) => {
    auditFetches += 1;
    await fulfillAudit(route, auditPage([firstEvent]));
  });

  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office or Project Manager"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/management/access");
  await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
  expect(auditFetches).toBe(0);

  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "outsider@example.net",
    "oai-authenticated-user-full-name": encodeURIComponent("Outside User"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/management/access");
  await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
  expect(auditFetches).toBe(0);
});
