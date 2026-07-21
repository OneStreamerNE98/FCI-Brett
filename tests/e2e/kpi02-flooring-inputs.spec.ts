import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = "http://localhost:4173";
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
    // Vinext emits absolute Windows next/font URLs in local development CSS.
    // Keep every application error while excluding only that framework warning.
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

test("project API validates and round-trips nullable booking inputs without leaking contract value to Office users", async ({ page }) => {
  const clientResponse = await page.request.get("/api/v1/clients");
  expect(clientResponse.ok()).toBe(true);
  const clientPayload = await clientResponse.json() as { clients?: Array<{ id: string }> };
  const clientId = clientPayload.clients?.find((client) => client.id === "e2e-client-001")?.id;
  expect(clientId).toBe("e2e-client-001");

  for (const [field, value, message] of [
    ["flooringCategory", "vinyl", "flooring category is invalid"],
    ["squareFeet", 0, "square feet must be a positive whole number"],
    ["contractValue", 1.5, "contract value must be a non-negative whole number"],
  ] as const) {
    const response = await page.request.post("/api/v1/projects", {
      headers: { Origin: origin },
      data: { clientId, name: "FCI TEST — DO NOT USE — Rejected KPI-02 input", [field]: value },
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
  }

  const projectName = `FCI TEST — DO NOT USE — KPI-02 API ${Date.now()}`;
  const createdResponse = await page.request.post("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      clientId,
      name: projectName,
      status: "planning",
      site: "KPI-02 API test site",
      estimatedValue: 81_000,
      flooringCategory: "tile-stone",
      squareFeet: 3_000,
      contractValue: 84_000,
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { id?: string };
  expect(created.id).toBeTruthy();

  const adminList = await page.request.get("/api/v1/projects");
  expect(adminList.headers()["cache-control"]).toBe("no-store");
  const adminPayload = await adminList.json() as { projects?: Array<Record<string, unknown>> };
  expect(adminPayload.projects?.find((project) => project.id === created.id)).toEqual(expect.objectContaining({
    client_id: "e2e-client-001",
    name: projectName,
    flooring_category: "tile-stone",
    square_feet: 3_000,
    contract_value: 84_000,
  }));

  const officeList = await page.request.get("/api/v1/projects", { headers: officeHeaders });
  expect(officeList.ok()).toBe(true);
  expect(officeList.headers()["cache-control"]).toBe("no-store");
  const officePayload = await officeList.json() as { projects?: Array<Record<string, unknown>> };
  expect(officePayload.projects?.find((project) => project.id === created.id)).toEqual(expect.objectContaining({
    client_id: "e2e-client-001",
    flooring_category: "tile-stone",
    square_feet: 3_000,
    contract_value: null,
  }));

  const forbiddenContract = await page.request.post("/api/v1/projects", {
    headers: officeHeaders,
    data: { clientId, name: "FCI TEST — DO NOT USE — Office contract rejection", contractValue: 1 },
  });
  expect(forbiddenContract.status()).toBe(403);
  await expect(forbiddenContract.json()).resolves.toEqual({ error: "An FCI administrator must record contract value." });
});

test("admin can capture booking inputs in the project modal and review them in the responsive drawer", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  const projectName = `FCI TEST — DO NOT USE — KPI-02 modal ${Date.now()}`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E Mobile Metadata Project/ })).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  const modal = page.getByRole("dialog", { name: "Create a project" });
  await modal.getByLabel("Client").selectOption("e2e-client-001");
  await expect(modal.getByLabel("Client")).toHaveValue("e2e-client-001");
  await expect(modal.getByLabel(/Flooring category/)).toHaveValue("");
  await expect(modal.getByLabel(/Square feet/)).toHaveAttribute("min", "1");
  await expect(modal.getByLabel(/Contract value/)).toBeEnabled();
  await expectAccessible(page, ".modal");

  await modal.getByLabel("Project name").fill(projectName);
  await modal.getByLabel("Site").fill("FCI TEST — DO NOT USE — KPI-02 modal site");
  await modal.getByLabel(/Estimated value/).fill("96000");
  await modal.getByLabel(/Flooring category/).selectOption("luxury-vinyl");
  await modal.getByLabel(/Square feet/).fill("3200");
  await modal.getByLabel(/Contract value/).fill("104000");
  await modal.getByRole("button", { name: "Create project" }).click();

  const row = page.getByRole("button", { name: new RegExp(projectName) });
  await expect(row).toBeVisible();
  await row.click();
  const drawer = page.getByRole("dialog", { name: new RegExp(projectName) });
  await expect(drawer).toContainText("Luxury Vinyl");
  await expect(drawer).toContainText("3,200");
  await expect(drawer).toContainText("$104,000");
  await expectAccessible(page, ".project-drawer");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".project-drawer");
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();

  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "Create a project" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".modal");
  await page.keyboard.press("Escape");

  expect(issues, issues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});

test("Office project UI keeps contract value unavailable while category and square feet remain readable", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/projects");
  await expect(page.getByRole("button", { name: /E2E Mobile Metadata Project/ })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  const modal = page.getByRole("dialog", { name: "Create a project" });
  await expect(modal.getByLabel(/Flooring category/)).toBeEnabled();
  await expect(modal.getByLabel(/Square feet/)).toBeEnabled();
  await expect(modal.getByLabel(/Contract value/)).toBeDisabled();
  await expect(modal.getByText("An administrator can record the sold price at booking.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const seededRow = page.getByRole("button", { name: /E2E Mobile Metadata Project/ });
  await seededRow.click();
  const drawer = page.getByRole("dialog", { name: /E2E Mobile Metadata Project/ });
  await expect(drawer.getByText("Luxury Vinyl", { exact: true })).toBeVisible();
  await expect(drawer.getByText("5,000", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Administrator only", { exact: true })).toBeVisible();
  await expect(drawer).not.toContainText("$132,500");
  await expectAccessible(page, ".project-drawer");
});
