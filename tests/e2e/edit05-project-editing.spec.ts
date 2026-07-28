import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const origin = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const execFileAsync = promisify(execFile);
const officeHeaders = {
  Origin: origin,
  "oai-authenticated-user-email": "e2e-office@example.test",
  "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

async function executeLocalD1(sql: string) {
  const wrangler = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  await execFileAsync(process.execPath, [
    wrangler,
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    "wrangler.local.jsonc",
    "--command",
    sql,
  ], { cwd: process.cwd() });
}

async function clearEdit05Records() {
  await executeLocalD1(
    "DELETE FROM activity_events WHERE record_id IN (SELECT id FROM projects WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-05%');"
    + " DELETE FROM projects WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-05%';"
    + " DELETE FROM activity_events WHERE record_id IN (SELECT id FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-05%');"
    + " DELETE FROM contacts WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-05%');"
    + " DELETE FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-05%';",
  );
}

async function expectAccessible(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

async function createProject(
  request: APIRequestContext,
  suffix: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request.post("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      clientId: "e2e-client-001",
      name: `FCI TEST — DO NOT USE — EDIT-05 ${suffix}`,
      status: "planning",
      site: "FCI TEST — DO NOT USE — EDIT-05 original site",
      estimatedValue: 125_000,
      flooringCategory: "tile-stone",
      squareFeet: 2_500,
      contractValue: 130_000,
      segment: "commercial",
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; projectNumber: string; version?: string }>;
}

test.beforeEach(async () => {
  await clearEdit05Records();
});

test.afterEach(async () => {
  await clearEdit05Records();
});

test("admin edits all nine project fields and moves planning through installation to completed", async ({ page }) => {
  const suffix = String(Date.now());
  const targetClientName = `FCI TEST — DO NOT USE — EDIT-05 client ${suffix}`;
  const targetClientResponse = await page.request.post("/api/v1/clients", {
    headers: { Origin: origin },
    data: { name: targetClientName, industry: "Residential" },
  });
  expect(targetClientResponse.status()).toBe(201);
  const targetClient = await targetClientResponse.json() as { id: string };
  const created = await createProject(page.request, `admin ${suffix}`);
  expect(created).not.toHaveProperty("version");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects");
  const originalName = `FCI TEST — DO NOT USE — EDIT-05 admin ${suffix}`;
  const updatedName = `FCI TEST — DO NOT USE — EDIT-05 updated ${suffix}`;
  await page.getByRole("button", { name: new RegExp(originalName) }).click();
  let drawer = page.getByRole("dialog", { name: new RegExp(created.projectNumber) });
  await drawer.getByRole("button", { name: "Edit project" }).click();

  let editor = page.getByRole("dialog", { name: `Edit ${created.projectNumber}` });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Project name")).toHaveValue(originalName);
  await expect(editor.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await expectAccessible(page, ".project-edit-modal");

  await editor.getByRole("combobox", { name: /^Client$/ }).selectOption(targetClient.id);
  await editor.getByLabel("Project name").fill(updatedName);
  await editor.getByLabel(/Site/).fill("FCI TEST — DO NOT USE — EDIT-05 updated site");
  await editor.getByLabel("Status").selectOption("installation");
  await editor.getByLabel(/Estimated value/).fill("180000");
  await editor.getByLabel(/Flooring category/).selectOption("hardwood");
  await editor.getByLabel(/Square feet/).fill("4200");
  await editor.getByLabel(/Project segment/).selectOption("residential");
  await editor.getByLabel(/Contract value/).fill("185000");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toBeHidden();

  drawer = page.getByRole("dialog", { name: new RegExp(`${created.projectNumber} ${updatedName}`) });
  await expect(drawer).toContainText(targetClientName);
  await expect(drawer).toContainText("Installation");
  await expect(drawer).toContainText("$180,000");
  await expect(drawer).toContainText("$185,000");
  await expect(drawer).toContainText("Residential");
  await expect(drawer).toContainText("Hardwood");
  await expect(drawer).toContainText("4,200");

  let listed = await page.request.get("/api/v1/projects");
  let projects = (await listed.json() as { projects: Array<Record<string, unknown>> }).projects;
  expect(projects.find(({ id }) => id === created.id)).toEqual(expect.objectContaining({
    client_id: targetClient.id,
    name: updatedName,
    status: "installation",
    site: "FCI TEST — DO NOT USE — EDIT-05 updated site",
    estimated_value: 180_000,
    flooring_category: "hardwood",
    square_feet: 4_200,
    contract_value: 185_000,
    segment: "residential",
    version: "2",
  }));

  await drawer.getByRole("button", { name: "Edit project" }).click();
  editor = page.getByRole("dialog", { name: `Edit ${created.projectNumber}` });
  await editor.getByLabel("Status").selectOption("completed");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toBeHidden();
  await expect(drawer).toContainText("Completed");
  listed = await page.request.get("/api/v1/projects");
  projects = (await listed.json() as { projects: Array<Record<string, unknown>> }).projects;
  expect(projects.find(({ id }) => id === created.id)).toEqual(expect.objectContaining({
    status: "completed",
    version: "3",
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.getByRole("button", { name: "Edit project" }).click();
  editor = page.getByRole("dialog", { name: `Edit ${created.projectNumber}` });
  await expect(editor).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".project-edit-modal");
});

test("a stale project edit stays visible until the user explicitly re-applies it", async ({ page }) => {
  const suffix = String(Date.now());
  const created = await createProject(page.request, `conflict ${suffix}`);
  const originalName = `FCI TEST — DO NOT USE — EDIT-05 conflict ${suffix}`;
  const peerName = `FCI TEST — DO NOT USE — EDIT-05 peer ${suffix}`;
  const reappliedName = `FCI TEST — DO NOT USE — EDIT-05 reapplied ${suffix}`;

  await page.goto("/projects");
  await page.getByRole("button", { name: new RegExp(originalName) }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(created.projectNumber) });
  await drawer.getByRole("button", { name: "Edit project" }).click();
  const editor = page.getByRole("dialog", { name: `Edit ${created.projectNumber}` });
  await editor.getByLabel("Project name").fill(reappliedName);

  const peer = await page.request.patch(`/api/v1/projects/${created.id}`, {
    headers: { Origin: origin },
    data: { name: peerName, version: "1" },
  });
  expect(peer.status()).toBe(200);

  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByRole("alert")).toContainText("changed while you were editing");
  await expect(editor.getByLabel("Project name")).toHaveValue(reappliedName);
  await expect(editor.getByText(`Saved value: ${peerName}`, { exact: true })).toBeVisible();
  await expect(editor.getByText(/Saved value:/)).toHaveCount(1);
  await expect(editor.getByRole("button", { name: "Re-apply changes" })).toBeVisible();

  let listed = await page.request.get("/api/v1/projects");
  let projects = (await listed.json() as { projects: Array<Record<string, unknown>> }).projects;
  expect(projects.find(({ id }) => id === created.id)).toEqual(expect.objectContaining({
    name: peerName,
    site: "FCI TEST — DO NOT USE — EDIT-05 original site",
    version: "2",
  }));

  await editor.getByRole("button", { name: "Re-apply changes" }).click();
  await expect(editor).toBeHidden();
  listed = await page.request.get("/api/v1/projects");
  projects = (await listed.json() as { projects: Array<Record<string, unknown>> }).projects;
  expect(projects.find(({ id }) => id === created.id)).toEqual(expect.objectContaining({
    name: reappliedName,
    site: "FCI TEST — DO NOT USE — EDIT-05 original site",
    version: "3",
  }));
});

test("Office users edit descriptive fields while status and financial controls stay read-only", async ({ page }) => {
  const suffix = String(Date.now());
  const created = await createProject(page.request, `office ${suffix}`);
  const originalName = `FCI TEST — DO NOT USE — EDIT-05 office ${suffix}`;
  const updatedName = `FCI TEST — DO NOT USE — EDIT-05 office updated ${suffix}`;
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/projects");
  await page.getByRole("button", { name: new RegExp(originalName) }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(created.projectNumber) });
  await drawer.getByRole("button", { name: "Edit project" }).click();
  const editor = page.getByRole("dialog", { name: `Edit ${created.projectNumber}` });
  await expect(editor.locator('select[name="status"]')).toHaveCount(0);
  await expect(editor.locator('input[name="estimatedValue"]')).toHaveCount(0);
  await expect(editor.locator('input[name="contractValue"]')).toHaveCount(0);
  await expect(editor.getByText("Status", { exact: true })).toBeVisible();
  await expect(editor.getByText("Administrator only", { exact: true })).toBeVisible();
  await expectAccessible(page, ".project-edit-modal");

  for (const [field, value] of [
    ["status", "installation"],
    ["estimatedValue", 1],
    ["contractValue", 1],
  ] as const) {
    const forbidden = await page.request.patch(`/api/v1/projects/${created.id}`, {
      headers: officeHeaders,
      data: { [field]: value, version: "1" },
    });
    expect(forbidden.status(), field).toBe(403);
  }

  await editor.getByLabel("Project name").fill(updatedName);
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toBeHidden();
  const officeList = await page.request.get("/api/v1/projects", { headers: officeHeaders });
  const projects = (await officeList.json() as { projects: Array<Record<string, unknown>> }).projects;
  expect(projects.find(({ id }) => id === created.id)).toEqual(expect.objectContaining({
    name: updatedName,
    contract_value: null,
    version: "2",
  }));
});
