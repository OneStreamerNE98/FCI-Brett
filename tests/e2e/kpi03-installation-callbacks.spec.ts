import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const origin = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const officeHeaders = {
  Origin: origin,
  "oai-authenticated-user-email": "e2e-office@example.test",
  "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

type BrowserIssue = { kind: "console.error" | "pageerror"; detail: string };

function monitorBrowserHealth(page: Page) {
  const issues: BrowserIssue[] = [];
  page.on("console", (message) => {
    const detail = message.text();
    const localVinextFontWarning = detail.startsWith("Not allowed to load local resource: file:///") && detail.includes("/.vinext/fonts/");
    if (message.type() === "error" && !localVinextFontWarning) issues.push({ kind: "console.error", detail });
  });
  page.on("pageerror", (error) => issues.push({ kind: "pageerror", detail: error.stack ?? error.message }));
  return issues;
}

async function expectAccessible(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

function drawerStat(drawer: Locator, label: string) {
  return drawer.locator(".drawer-stats > div").filter({ hasText: label });
}

async function createProjectForOperations(page: Page) {
  const name = `FCI TEST — DO NOT USE — KPI-03 operations ${Date.now()}`;
  const response = await page.request.post("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      clientId: "e2e-client-001",
      name,
      status: "planning",
      site: "FCI TEST — DO NOT USE — KPI-03 site",
      estimatedValue: null,
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json() as { id?: unknown; projectNumber?: unknown };
  expect(typeof payload.id).toBe("string");
  expect(typeof payload.projectNumber).toBe("string");
  return { id: String(payload.id), projectNumber: String(payload.projectNumber), name };
}

test("project-operations API rejects invalid, reversed, missing-project, and unauthorized writes", async ({ page }) => {
  const invalid = await page.request.patch("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      action: "record-follow-up-result",
      projectId: "e2e-project-001",
      hadCallback: "yes",
      callbackNote: null,
    },
  });
  expect(invalid.status()).toBe(400);
  await expect(invalid.json()).resolves.toEqual({ error: "hadCallback must be true or false" });

  const reversed = await page.request.patch("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      action: "record-installation-dates",
      projectId: "e2e-project-001",
      installationStartedAt: Date.UTC(2026, 6, 15, 12),
      installationCompletedAt: Date.UTC(2026, 6, 14, 12),
    },
  });
  expect(reversed.status()).toBe(400);
  await expect(reversed.json()).resolves.toEqual({ error: "installation completion must be on or after installation start" });

  const missing = await page.request.patch("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      action: "record-follow-up-result",
      projectId: "missing-e2e-project",
      hadCallback: false,
      callbackNote: null,
    },
  });
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({ error: "project not found" });

  const malformedAdmin = await page.request.patch("/api/v1/projects", {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: "{",
  });
  expect(malformedAdmin.status()).toBe(400);
  await expect(malformedAdmin.json()).resolves.toEqual({ error: "Project action must be valid JSON." });

  const malformedOffice = await page.request.patch("/api/v1/projects", {
    headers: { ...officeHeaders, "Content-Type": "application/json" },
    data: "{",
  });
  expect(malformedOffice.status()).toBe(403);
  await expect(malformedOffice.json()).resolves.toEqual({ error: "An FCI administrator must complete this action." });
});

test("admin records installation dates and a follow-up result through accessible responsive overlays", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  const project = await createProjectForOperations(page);
  const callbackNote = "FCI TEST — DO NOT USE — Callback resolved during follow-up";

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  const row = page.getByRole("button", { name: new RegExp(project.name) });
  await expect(row).toBeVisible();
  await row.click();

  const drawer = page.getByRole("dialog", { name: `${project.projectNumber} ${project.name}` });
  const closeDrawer = drawer.getByRole("button", { name: "Close project" });
  await expect(drawer).toBeVisible();
  await expect(closeDrawer).toBeFocused();
  await expect(drawerStat(drawer, "Installation started").getByText("Not yet recorded", { exact: true })).toBeVisible();
  await expect(drawerStat(drawer, "Installation completed").getByText("Not yet recorded", { exact: true })).toBeVisible();
  await expect(drawerStat(drawer, "Post-installation callback").getByText("No recorded callback", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Default No can include an uncaptured legacy result.", { exact: true })).toBeVisible();
  await expectAccessible(page, ".project-drawer");

  const installationTrigger = drawer.getByRole("button", { name: "Record installation dates" });
  await installationTrigger.click();
  let installationModal = page.getByRole("dialog", { name: `Record installation dates for ${project.projectNumber}` });
  await expect(installationModal.getByLabel("Installation started")).toBeFocused();
  await expectAccessible(page, ".project-operation-modal");
  await page.keyboard.press("Escape");
  await expect(installationModal).toHaveCount(0);
  await expect(installationTrigger).toBeFocused();

  await installationTrigger.click();
  installationModal = page.getByRole("dialog", { name: `Record installation dates for ${project.projectNumber}` });
  const installationSubmit = installationModal.getByRole("button", { name: "Record installation dates" });
  await expect(installationModal.getByLabel("Installation started")).toBeFocused();
  await installationSubmit.focus();
  await expect(installationSubmit).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(installationModal.getByRole("button", { name: "Close" })).toBeFocused();
  await installationModal.getByLabel("Installation started").fill("2026-07-10");
  await installationModal.getByLabel("Installation completed").fill("2026-07-14");
  await installationSubmit.click();
  await expect(installationModal).toHaveCount(0);
  await expect(installationTrigger).toBeFocused();
  await expect(page.getByText(`Installation dates recorded for ${project.projectNumber}`, { exact: true })).toBeVisible();
  await expect(drawerStat(drawer, "Installation started").getByText("Jul 10, 2026", { exact: true })).toBeVisible();
  await expect(drawerStat(drawer, "Installation completed").getByText("Jul 14, 2026", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".project-drawer");

  const followUpTrigger = drawer.getByRole("button", { name: "Record follow-up result" });
  await followUpTrigger.click();
  const followUpModal = page.getByRole("dialog", { name: `Record follow-up result for ${project.projectNumber}` });
  await expect(followUpModal.getByLabel("Post-installation callback")).toBeFocused();
  await expectAccessible(page, ".project-operation-modal");
  await followUpModal.getByLabel("Post-installation callback").selectOption("yes");
  await followUpModal.getByLabel(/Callback note/).fill(`  ${callbackNote}  `);
  await followUpModal.getByRole("button", { name: "Record follow-up result" }).click();
  await expect(followUpModal).toHaveCount(0);
  await expect(followUpTrigger).toBeFocused();
  await expect(page.getByText(`Follow-up result recorded for ${project.projectNumber}`, { exact: true })).toBeVisible();
  await expect(drawerStat(drawer, "Post-installation callback").getByText("Yes recorded", { exact: true })).toBeVisible();
  await expect(drawerStat(drawer, "Post-installation callback").getByText(callbackNote, { exact: true })).toBeVisible();
  await expectAccessible(page, ".project-drawer");

  const list = await page.request.get("/api/v1/projects");
  expect(list.ok()).toBe(true);
  const payload = await list.json() as { projects?: Array<Record<string, unknown>> };
  expect(payload.projects?.find((item) => item.id === project.id)).toEqual(expect.objectContaining({
    installation_started_at: Date.UTC(2026, 6, 10, 12),
    installation_completed_at: Date.UTC(2026, 6, 14, 12),
    had_callback: 1,
    callback_note: callbackNote,
  }));

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(issues, issues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});

test("Office sees project outcomes but no administrator recording controls", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/projects");

  const row = page.getByRole("button", { name: /E2E Mobile Metadata Project/ });
  await expect(row).toBeVisible();
  await row.click();
  const drawer = page.getByRole("dialog", { name: /E2E Mobile Metadata Project/ });
  const operations = drawer.locator(".project-operation-actions");
  await expect(operations.getByText("Only an administrator can record installation dates and callback results.", { exact: true })).toBeVisible();
  await expect(operations.getByRole("button", { name: "Record installation dates" })).toHaveCount(0);
  await expect(operations.getByRole("button", { name: "Record follow-up result" })).toHaveCount(0);
  await expect(drawerStat(drawer, "Post-installation callback").getByText("No recorded callback", { exact: true })).toBeVisible();
  await expectAccessible(page, ".project-drawer");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".project-drawer");
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  expect(issues, issues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});
