import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const OFFICE_ID = "33333333-3333-4333-8333-333333333333";
const PM_ID = "44444444-4444-4444-8444-444444444444";
const INVITATION_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_A = "66666666-6666-4666-8666-666666666666";
const PROJECT_B = "77777777-7777-4777-8777-777777777777";
const NOW = Date.UTC(2026, 6, 16, 14, 0, 0);
const browserIssues = new WeakMap<Page, string[]>();
const expectedBrowserIssues = new WeakMap<Page, string[]>();

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
    summary: { activePeopleCount: 4, activeAdministratorCount: 2, pendingInvitationCount: 1 },
    roles: [
      { key: "administrator", displayName: "Administrator", description: "Company-wide administration." },
      { key: "office_operations", displayName: "Office Operations", description: "Company-wide nonfinancial operations." },
      { key: "project_manager", displayName: "Project Manager", description: "Assigned-project nonfinancial operations." },
    ],
    people: [
      { id: ADMIN_ID, displayName: "E2E Admin", email: "e2e-admin@example.test", role: "administrator", status: "active", projectIds: [], lastSignedInAt: NOW, version: "1" },
      { id: SECOND_ADMIN_ID, displayName: "FCI TEST — DO NOT USE Backup Admin", email: "backup.admin@cherryhillfci.com", role: "administrator", status: "active", projectIds: [], lastSignedInAt: NOW - 60_000, version: "1" },
      { id: OFFICE_ID, displayName: "FCI TEST — DO NOT USE Office", email: "office.person@cherryhillfci.com", role: "office_operations", status: "active", projectIds: [], lastSignedInAt: null, version: "3" },
      { id: PM_ID, displayName: "FCI TEST — DO NOT USE Project Manager", email: "pm.person@cherryhillfci.com", role: "project_manager", status: "active", projectIds: [PROJECT_A], lastSignedInAt: NOW - 120_000, version: "4" },
    ],
    invitations: [{ id: INVITATION_ID, email: "pending.person@cherryhillfci.com", role: "office_operations", status: "pending", projectIds: [], createdAt: NOW - 60_000, expiresAt: NOW + 7 * 24 * 60 * 60_000, version: "2" }],
    projects: [
      { id: PROJECT_A, projectNumber: "CF-2026-E2E00001", name: "FCI TEST — DO NOT USE Project A", status: "planning" },
      { id: PROJECT_B, projectNumber: "CF-2026-E2E00002", name: "FCI TEST — DO NOT USE Project B", status: "installation" },
    ],
    generatedAt: NOW,
  };
}

type RecordedMutation = {
  path: string;
  body: unknown;
  csrf: string | null;
};

async function installAccessApi(page: Page, options: {
  overview?: ReturnType<typeof accessOverview>;
  mutationFailure?: { path: RegExp; status: number; error: string };
  csrf?: boolean;
} = {}) {
  let overview = structuredClone(options.overview ?? accessOverview());
  const mutations: RecordedMutation[] = [];
  let reads = 0;

  if (options.csrf !== false) {
    await page.addInitScript(() => {
      (window as Window & { __FCI_E2E_ADMIN_CSRF_TOKEN__?: string })
        .__FCI_E2E_ADMIN_CSRF_TOKEN__ = "FCI_E2E_ADMIN_CSRF_CREDENTIAL_0000000000000000";
    });
  }

  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/admin/access") {
      reads += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: overview }) });
      return;
    }

    const body = request.postDataJSON();
    mutations.push({ path: url.pathname, body, csrf: request.headers()["x-fci-csrf-token"] ?? null });
    if (options.mutationFailure?.path.test(url.pathname)) {
      await route.fulfill({
        status: options.mutationFailure.status,
        contentType: "application/json",
        body: JSON.stringify({ error: options.mutationFailure.error }),
      });
      return;
    }
    if (url.pathname.endsWith("/revoke")) {
      overview = {
        ...overview,
        summary: {
          ...overview.summary,
          pendingInvitationCount: Math.max(0, overview.summary.pendingInvitationCount - 1),
        },
        invitations: overview.invitations.filter(({ id }) => id !== INVITATION_ID),
      };
    }
    if (url.pathname.endsWith("/disable")) {
      overview = {
        ...overview,
        summary: {
          ...overview.summary,
          activePeopleCount: Math.max(0, overview.summary.activePeopleCount - 1),
        },
        people: overview.people.map((person) => person.id === PM_ID
          ? { ...person, status: "disabled" }
          : person),
      };
    }
    await route.fulfill({ status: url.pathname === "/api/v1/admin/invitations" ? 201 : 200, contentType: "application/json", body: JSON.stringify({ data: { id: "99999999-9999-4999-8999-999999999999", version: "9", invitationCredential: "not-visible-after-response" } }) });
  });

  return { mutations, get reads() { return reads; } };
}

async function openAccessPage(page: Page) {
  const response = await page.goto("/management/access");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "People & Access" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
}

test("direct route renders the compact access page and survives link navigation, refresh, Back, and Forward", async ({ page }) => {
  const api = await installAccessApi(page);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "People & Access · In development" }).click();
  await expect(page).toHaveURL("http://localhost:4173/management/access");
  await expect(page.getByRole("heading", { level: 1, name: "People & Access" })).toBeVisible();
  await expect(page.getByText("4", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("table")).toContainText("office.person@cherryhillfci.com");
  await expect(page.getByRole("heading", { name: "Pending invitations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What each role can do" })).toBeVisible();
  await expect(page.locator(".access-management-role-guide")).toContainText("Office Operations");
  await expect(page.getByText(/Pricing, revenue, margins, project creation and assignment/)).toBeVisible();
  await expect(page.getByText("access_admin.read")).toHaveCount(0);
  await expect(page.locator("vite-error-overlay, nextjs-portal")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "People & Access" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:4173/");
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "People & Access" })).toBeVisible();
  expect(api.reads).toBeGreaterThanOrEqual(1);
});

test("all five workflows send the fixed endpoint and body contracts", async ({ page }) => {
  const api = await installAccessApi(page);
  await openAccessPage(page);

  await page.getByRole("button", { name: "Invite person" }).click();
  const invite = page.getByRole("dialog", { name: "Invite person" });
  await expect(invite.getByLabel("Exact company email")).toBeFocused();
  await expect(invite.getByRole("group", { name: "Assigned projects" })).toHaveCount(0);
  await invite.getByLabel("Exact company email").fill("new.pm@cherryhillfci.com");
  await invite.getByLabel("Role").selectOption("project_manager");
  await invite.getByLabel(/CF-2026-E2E00002/).check();
  await invite.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation created");
  await expect(page.getByText("not-visible-after-response")).toHaveCount(0);

  await page.getByRole("button", { name: "Revoke" }).click();
  const revoke = page.getByRole("dialog", { name: "Revoke invitation" });
  await revoke.getByLabel("Reason").fill("Position was not approved");
  await revoke.getByRole("button", { name: "Revoke invitation" }).click();
  await expect(page.getByRole("heading", { name: "Pending invitations" })).toBeFocused();

  const officeRow = page.getByRole("row").filter({ hasText: "office.person@cherryhillfci.com" });
  await officeRow.getByRole("button", { name: "Edit access" }).click();
  const edit = page.getByRole("dialog", { name: /Edit FCI TEST — DO NOT USE Office/ });
  await edit.getByLabel("Role").selectOption("project_manager");
  await edit.getByLabel(/CF-2026-E2E00001/).check();
  await expect(edit.getByText(/Current: Office Operations · All company projects/)).toBeVisible();
  await expect(edit.getByText(/Proposed: Project Manager · CF-2026-E2E00001/)).toBeVisible();
  await expect(edit.getByText(/1 project added · 0 removed/)).toBeVisible();
  await edit.getByLabel("Reason").fill("Now manages Project A");
  await edit.getByRole("button", { name: "Save access" }).click();

  await officeRow.getByRole("button", { name: "Sign out everywhere" }).click();
  const signOut = page.getByRole("dialog", { name: "Sign out everywhere" });
  await signOut.getByLabel("Reason").fill("Security review");
  await signOut.getByRole("button", { name: "Sign out everywhere" }).click();

  const pmRow = page.getByRole("row").filter({ hasText: "pm.person@cherryhillfci.com" });
  await pmRow.getByRole("button", { name: "Disable access" }).click();
  const disable = page.getByRole("dialog", { name: "Disable access" });
  await disable.getByLabel("Reason").fill("Employment ended");
  await disable.getByRole("button", { name: "Disable access" }).click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeFocused();

  expect(api.mutations.map(({ path }) => path)).toEqual([
    "/api/v1/admin/invitations",
    `/api/v1/admin/invitations/${INVITATION_ID}/revoke`,
    `/api/v1/admin/users/${OFFICE_ID}/access`,
    `/api/v1/admin/users/${OFFICE_ID}/sign-out`,
    `/api/v1/admin/users/${PM_ID}/disable`,
  ]);
  expect(api.mutations.map(({ body }) => body)).toEqual([
    { email: "new.pm@cherryhillfci.com", role: "project_manager", projectIds: [PROJECT_B] },
    { expectedVersion: "2", reason: "Position was not approved" },
    { expectedVersion: "3", role: "project_manager", projectIds: [PROJECT_A], reason: "Now manages Project A" },
    { expectedVersion: "3", reason: "Security review" },
    { expectedVersion: "4", reason: "Employment ended" },
  ]);
  expect(api.mutations.every(({ csrf }) => csrf === "FCI_E2E_ADMIN_CSRF_CREDENTIAL_0000000000000000")).toBe(true);
});

test("stale access refreshes safely and final-Administrator denial stays explicit", async ({ page }) => {
  expectedBrowserIssues.get(page)?.push(
    "console.error: Failed to load resource: the server responded with a status of 409 (Conflict)",
    "console.error: Failed to load resource: the server responded with a status of 409 (Conflict)",
  );
  const staleApi = await installAccessApi(page, {
    mutationFailure: { path: new RegExp(`/users/${OFFICE_ID}/access$`), status: 409, error: "access_state_stale" },
  });
  await openAccessPage(page);
  const officeRow = page.getByRole("row").filter({ hasText: "office.person@cherryhillfci.com" });
  await officeRow.getByRole("button", { name: "Edit access" }).click();
  const edit = page.getByRole("dialog", { name: /Edit FCI TEST — DO NOT USE Office/ });
  await edit.getByLabel("Reason").fill("No-op review");
  await expect(edit.getByText("No access change selected.")).toBeVisible();
  await expect(edit.getByRole("button", { name: "Save access" })).toBeDisabled();
  expect(staleApi.mutations).toHaveLength(0);
  await edit.getByLabel("Role").selectOption("project_manager");
  await edit.getByLabel(/CF-2026-E2E00001/).check();
  await edit.getByLabel("Reason").fill("Routine review");
  await edit.getByRole("button", { name: "Save access" }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Someone else changed this access record");
  expect(staleApi.reads).toBeGreaterThanOrEqual(2);

  await page.unroute("**/api/v1/admin/**");
  await installAccessApi(page, {
    mutationFailure: { path: new RegExp(`/users/${ADMIN_ID}/access$`), status: 409, error: "final_active_administrator" },
  });
  const adminRow = page.getByRole("row").filter({ hasText: "e2e-admin@example.test" });
  await adminRow.getByRole("button", { name: "Edit access" }).click();
  const adminEdit = page.getByRole("dialog", { name: "Edit E2E Admin" });
  await adminEdit.getByLabel("Role").selectOption("office_operations");
  await adminEdit.getByLabel("Reason").fill("Incorrect demotion test");
  await adminEdit.getByRole("button", { name: "Save access" }).click();
  await expect(adminEdit.getByRole("alert")).toContainText("final active Administrator");
  await expect(adminEdit).toBeVisible();
});

test("dialogs restore focus and mobile, tablet, and 200%-equivalent layouts do not overflow", async ({ page }) => {
  await installAccessApi(page);
  await openAccessPage(page);
  const trigger = page.getByRole("button", { name: "Invite person" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Invite person" });
  await expect(dialog.getByLabel("Exact company email")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 640, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "People & Access" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  const results = await new AxeBuilder({ page }).include(".access-management-page").analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
});

test("the source-only route is visibly read-only until its secure session bootstrap is composed", async ({ page }) => {
  const api = await installAccessApi(page, { csrf: false });
  const response = await page.goto("/management/access");
  expect(response?.ok()).toBe(true);

  await expect(page.locator(".access-management-state-info")).toContainText("No retry is needed until secure sign-in is connected");
  await expect(page.locator([
    ".access-management-header-action button:not(:disabled)",
    ".access-management-actions button:not(:disabled)",
    ".access-management-invitations button:not(:disabled)",
  ].join(","))).toHaveCount(0);
  expect(api.reads).toBe(0);
  expect(api.mutations).toEqual([]);
});

test("project scope stays compact and the 50-project boundary remains explicit", async ({ page }) => {
  const projects = Array.from({ length: 51 }, (_, index) => ({
    id: `88888888-8888-4888-8888-${String(index + 1).padStart(12, "0")}`,
    projectNumber: `CF-2026-${String(index + 1).padStart(8, "0")}`,
    name: `FCI TEST — DO NOT USE Project ${index + 1}`,
    status: "planning",
  }));
  const overview = accessOverview();
  overview.projects = projects;
  overview.people = overview.people.map((person) => person.id === PM_ID
    ? { ...person, projectIds: projects.slice(0, 50).map(({ id }) => id) }
    : person);
  await installAccessApi(page, { overview });
  await openAccessPage(page);

  const pmRow = page.getByRole("row").filter({ hasText: "pm.person@cherryhillfci.com" });
  await expect(pmRow).toContainText("+48 more");
  await pmRow.getByRole("button", { name: "Edit access" }).click();
  const edit = page.getByRole("dialog", { name: /Edit FCI TEST — DO NOT USE Project Manager/ });
  await expect(edit.getByText("50 of 50 selected.", { exact: false })).toBeVisible();
  const unchecked = edit.getByLabel(/CF-2026-00000051/);
  await expect(unchecked).toBeDisabled();
  await edit.getByLabel(/CF-2026-00000001/).uncheck();
  await expect(unchecked).toBeEnabled();
  await expect(edit.getByText(/0 projects added · 1 removed/)).toBeVisible();
  await expect(edit.getByRole("button", { name: "Save access" })).toBeEnabled();
});

test("an empty project catalog explains why Project Manager access cannot be submitted", async ({ page }) => {
  const overview = accessOverview();
  overview.people = overview.people.filter(({ id }) => id !== PM_ID);
  overview.projects = [];
  overview.summary.activePeopleCount -= 1;
  await installAccessApi(page, { overview });
  await openAccessPage(page);

  await page.getByRole("button", { name: "Invite person" }).click();
  const invite = page.getByRole("dialog", { name: "Invite person" });
  await invite.getByLabel("Role").selectOption("project_manager");
  await expect(invite.getByText("No assignable projects are available.", { exact: false })).toBeVisible();
  await expect(invite.getByRole("button", { name: "Create invitation" })).toBeDisabled();
});

test("Office and outside-domain direct routes deny before the client projection fetch", async ({ page }) => {
  let fetches = 0;
  await page.route("**/api/v1/admin/access", async (route) => {
    fetches += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: accessOverview() }) });
  });

  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/management/access");
  await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
  expect(fetches).toBe(0);

  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "outsider@example.net",
    "oai-authenticated-user-full-name": encodeURIComponent("Outside User"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/management/access");
  await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
  expect(fetches).toBe(0);
});

test("an expired production session clears the access screen", async ({ page }) => {
  expectedBrowserIssues.get(page)?.push(
    "console.error: Failed to load resource: the server responded with a status of 401 (Unauthorized)",
  );
  await page.addInitScript(() => {
    (window as Window & { __FCI_E2E_ADMIN_CSRF_TOKEN__?: string })
      .__FCI_E2E_ADMIN_CSRF_TOKEN__ = "FCI_E2E_ADMIN_CSRF_CREDENTIAL_0000000000000000";
  });
  await page.route("**/api/v1/admin/access", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "authentication_required" }),
  }));
  const response = await page.goto("/management/access");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Your secure session has ended" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite person" })).toBeDisabled();
});
