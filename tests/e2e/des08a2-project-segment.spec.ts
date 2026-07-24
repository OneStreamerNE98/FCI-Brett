import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";

const origin = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const execFileAsync = promisify(execFile);

async function expectAccessible(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

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

async function clearSegmentTestRecords() {
  await executeLocalD1(
    "DELETE FROM activity_events WHERE record_id IN (SELECT id FROM projects WHERE name LIKE 'FCI TEST — DO NOT USE — %segment%');"
    + " DELETE FROM projects WHERE name LIKE 'FCI TEST — DO NOT USE — %segment%';"
    + " DELETE FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — Residential segment %';",
  );
}

test.beforeEach(async () => {
  await clearSegmentTestRecords();
});

test.afterEach(async () => {
  await clearSegmentTestRecords();
});

test("D1 defaults, overrides, and widens the closed project segment across reloads", async ({ page }) => {
  const suffix = Date.now();
  const clientName = `FCI TEST — DO NOT USE — Residential segment ${suffix}`;
  const defaultedProjectName = `FCI TEST — DO NOT USE — Default segment ${suffix}`;
  const overriddenProjectName = `FCI TEST — DO NOT USE — Override segment ${suffix}`;

  const seededProjectsResponse = await page.request.get("/api/v1/projects");
  expect(seededProjectsResponse.ok()).toBe(true);
  const seededProjects = await seededProjectsResponse.json() as { projects: Array<Record<string, unknown>> };
  expect(seededProjects.projects.find(({ id }) => id === "e2e-project-001")).toEqual(expect.objectContaining({
    segment: "commercial",
  }));
  expect(seededProjects.projects.find(({ id }) => id === "e2e-project-001")).not.toHaveProperty("client_industry");

  const rejected = await page.request.post("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      clientId: "e2e-client-001",
      name: `FCI TEST — DO NOT USE — Rejected segment ${suffix}`,
      segment: "mixed",
    },
  });
  expect(rejected.status()).toBe(400);
  await expect(rejected.json()).resolves.toEqual({ error: "project segment is invalid" });

  const clientResponse = await page.request.post("/api/v1/clients", {
    headers: { Origin: origin },
    data: { name: clientName, industry: "Residential" },
  });
  expect(clientResponse.status()).toBe(201);
  const client = await clientResponse.json() as { id: string };

  const defaultedResponse = await page.request.post("/api/v1/projects", {
    headers: { Origin: origin },
    data: { clientId: client.id, name: defaultedProjectName, site: "FCI TEST — DO NOT USE — Residential default" },
  });
  expect(defaultedResponse.status()).toBe(201);
  const defaulted = await defaultedResponse.json() as { id: string };

  const overriddenResponse = await page.request.post("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      clientId: client.id,
      name: overriddenProjectName,
      site: "FCI TEST — DO NOT USE — Commercial override",
      segment: "commercial",
    },
  });
  expect(overriddenResponse.status()).toBe(201);
  const overridden = await overriddenResponse.json() as { id: string };

  let projectsResponse = await page.request.get("/api/v1/projects");
  let projects = (await projectsResponse.json() as { projects: Array<Record<string, unknown>> }).projects;
  expect(projects.find(({ id }) => id === defaulted.id)).toEqual(expect.objectContaining({
    name: defaultedProjectName,
    segment: "residential",
  }));
  expect(projects.find(({ id }) => id === overridden.id)).toEqual(expect.objectContaining({
    name: overriddenProjectName,
    segment: "commercial",
  }));

  // Reproduce a pre-0019 nullable row against the real local D1 database. The
  // public read must widen it from the Residential client instead of emitting
  // null or inventing an Unspecified segment.
  expect(defaulted.id).toMatch(/^[0-9a-f-]{36}$/u);
  await executeLocalD1(`UPDATE projects SET segment = NULL WHERE id = '${defaulted.id}'`);
  projectsResponse = await page.request.get("/api/v1/projects");
  projects = (await projectsResponse.json() as { projects: Array<Record<string, unknown>> }).projects;
  expect(projects.find(({ id }) => id === defaulted.id)).toEqual(expect.objectContaining({
    segment: "residential",
  }));

  await page.goto("/projects");
  await expect(page.getByRole("button", { name: new RegExp(defaultedProjectName) })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(defaultedProjectName) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(defaultedProjectName) }).click();
  await expect(page.getByRole("dialog", { name: new RegExp(defaultedProjectName) }).getByText("Residential", { exact: true })).toBeVisible();
});

test("the optional one-tap segment selector is responsive and persists its explicit choice", async ({ page }) => {
  const projectName = `FCI TEST — DO NOT USE — Segment modal ${Date.now()}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E Mobile Metadata Project/u })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();

  let modal = page.getByRole("dialog", { name: "Create a project" });
  await expect(modal).toBeVisible();
  const commercial = modal.getByLabel("Commercial", { exact: true });
  const residential = modal.getByLabel("Residential", { exact: true });
  await expect(commercial).not.toBeChecked();
  await expect(residential).not.toBeChecked();
  await residential.check();
  await expect(residential).toBeChecked();
  await expect(commercial).not.toBeChecked();
  await expectAccessible(page, ".modal");
  await expectNoHorizontalOverflow(page);

  await modal.getByLabel("Project name").fill(projectName);
  await modal.getByLabel("Site").fill("FCI TEST — DO NOT USE — Segment modal site");
  if (process.env.FCI_CAPTURE_DES08A2 === "true") {
    await page.screenshot({
      path: "docs/design-evidence/2026-07-24/des-08a2-project-segment-1280.png",
    });
  }
  await modal.getByRole("button", { name: "Create project" }).click();

  const row = page.getByRole("button", { name: new RegExp(projectName) });
  await expect(row).toBeVisible();
  await row.click();
  let drawer = page.getByRole("dialog", { name: new RegExp(projectName) });
  await expect(drawer.getByText("Residential", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(row).toBeVisible();
  await row.click();
  drawer = page.getByRole("dialog", { name: new RegExp(projectName) });
  await expect(drawer.getByText("Residential", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "New project" }).click();
  modal = page.getByRole("dialog", { name: "Create a project" });
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel("Commercial", { exact: true })).not.toBeChecked();
  await expect(modal.getByLabel("Residential", { exact: true })).not.toBeChecked();
  await expectAccessible(page, ".modal");
  await expectNoHorizontalOverflow(page);
  if (process.env.FCI_CAPTURE_DES08A2 === "true") {
    await page.screenshot({
      path: "docs/design-evidence/2026-07-24/des-08a2-project-segment-390.png",
    });
  }
});
