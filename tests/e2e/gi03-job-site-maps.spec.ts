import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const CSP = "frame-src 'self' https://www.google.com";
const projectName = "E2E Mobile Metadata Project";
const projectNumber = "CF-2026-E2E00001";
const projectAddress = "201 E2E Test Ave, Cherry Hill, NJ";
const clientName = "E2E Regression Client";
const clientAddress = "301 FCI Client Site Rd, Cherry Hill, NJ";
const noAddressClientName = "FCI TEST — DO NOT USE — GI-03 no-address client";

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

function expectedDirectionsUrl(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

test("project and client drawers render simulation and no-address map states with pinned CSP", async ({ page }) => {
  const issues = monitorBrowserHealth(page);
  const embedRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://www.google.com/maps/embed/v1/")) embedRequests.push(request.url());
  });

  const projectResponse = await page.goto("/projects");
  expect(projectResponse?.headers()["content-security-policy"]).toBe(CSP);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: `Open project ${projectNumber}: ${projectName}`, exact: true }).click();

  const projectDrawer = page.getByRole("dialog", { name: `${projectNumber} ${projectName}`, exact: true });
  const projectMap = projectDrawer.getByRole("region", { name: `Job-site map and directions for ${projectNumber} ${projectName}` });
  await expect(projectMap).toHaveAttribute("data-map-state", "simulation");
  await expect(projectMap.getByText("Satellite preview placeholder", { exact: true })).toBeVisible();
  await expect(projectMap.locator("iframe")).toHaveCount(0);
  await expect(projectMap.getByRole("link", { name: `Open directions to ${projectNumber} ${projectName} in Google Maps` })).toHaveAttribute("href", expectedDirectionsUrl(projectAddress));
  await expectAccessible(page, ".job-site-map-card");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(projectMap).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".project-drawer");
  await page.keyboard.press("Escape");
  await expect(projectDrawer).toHaveCount(0);

  await page.route("**/api/v1/clients", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as { clients?: Array<Record<string, unknown>> };
    const clients = (payload.clients ?? []).map((client) => client.id === "e2e-client-001"
      ? { ...client, site_address: clientAddress }
      : client);
    clients.push({
      id: "fci-test-gi03-no-address-client",
      client_code: "GI03-NOADDRESS",
      name: noAddressClientName,
      status: "active",
      industry: "Commercial",
      primary_contact_name: "FCI TEST Contact",
      primary_contact_email: "gi03-no-address@example.test",
      project_count: 0,
    });
    await route.fulfill({ response, json: { clients } });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  const clientResponse = await page.goto("/clients");
  expect(clientResponse?.headers()["content-security-policy"]).toBe(CSP);
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  await page.getByRole("button", { name: `Open client ${clientName}, E2E-CLIENT`, exact: true }).click();

  const clientDrawer = page.getByRole("dialog", { name: `${clientName} client account`, exact: true });
  const clientMap = clientDrawer.getByRole("region", { name: `Job-site map and directions for E2E-CLIENT ${clientName}` });
  await expect(clientMap).toHaveAttribute("data-map-state", "simulation");
  await expect(clientMap.locator("iframe")).toHaveCount(0);
  await expect(clientMap.getByRole("link", { name: `Open directions to E2E-CLIENT ${clientName} in Google Maps` })).toHaveAttribute("href", expectedDirectionsUrl(clientAddress));
  await expectAccessible(page, ".job-site-map-card");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: `Open client ${noAddressClientName}, GI03-NOADDRESS`, exact: true }).click();
  const noAddressDrawer = page.getByRole("dialog", { name: `${noAddressClientName} client account`, exact: true });
  const noAddressMap = noAddressDrawer.getByRole("region", { name: `Job-site map and directions for GI03-NOADDRESS ${noAddressClientName}` });
  await expect(noAddressMap).toHaveAttribute("data-map-state", "no-address");
  await expect(noAddressMap.getByText("No job-site address is stored", { exact: true })).toBeVisible();
  await expect(noAddressMap.locator("iframe")).toHaveCount(0);
  await expect(noAddressMap.getByRole("link")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(noAddressMap).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".client-drawer");
  expect(embedRequests).toEqual([]);
  expect(issues, issues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
});

test("Sites exposes no Maps tile proxy route", async ({ request }) => {
  const response = await request.get("/api/v1/maps/tiles?z=1&x=1&y=1");
  expect(response.status()).toBe(404);
});
