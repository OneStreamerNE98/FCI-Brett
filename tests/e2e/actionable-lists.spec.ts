import { expect, test, type Page } from "@playwright/test";

const leadCompany = "FCI TEST — DO NOT USE — Actionable lead";
const leadProject = "Actionable list verification";
const leadButtonName = `Open lead details for ${leadCompany}: ${leadProject}`;
const clientName = "E2E Regression Client";
const clientButtonName = `Open client ${clientName}, E2E-CLIENT`;
const projectName = "E2E Mobile Metadata Project";
const projectNumber = "CF-2026-E2E00001";
const projectButtonName = `Open project ${projectNumber}: ${projectName}`;

const leadFixture = {
  id: "fci-test-actionable-lead",
  leadNumber: "FCI-TEST-ACTIONABLE-LEAD",
  company: leadCompany,
  contactName: "FCI TEST — DO NOT USE — Contact",
  projectName: leadProject,
  source: "Website",
  stage: "New inquiry",
  site: "101 FCI TEST Ave, Cherry Hill, NJ",
  estimatedValue: 42000,
  nextAction: "Confirm the accessible list review",
  status: "active",
};

async function mockOverviewLead(page: Page, leads = [leadFixture]) {
  await page.route("**/api/v1/leads", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads }) });
      return;
    }
    await route.continue();
  });
}

function monitorBrowserHealth(page: Page) {
  const issues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.stack ?? error.message}`));
  return issues;
}

async function expectNativeActionableList(page: Page, listName: string, buttonName: string) {
  const list = page.getByRole("list", { name: listName });
  const button = list.getByRole("button", { name: buttonName, exact: true });
  await expect(list).toBeVisible();
  await expect(button).toBeVisible();
  const structure = await list.evaluate((element) => ({
    tagName: element.tagName,
    role: element.getAttribute("role"),
    childTags: Array.from(element.children).map((child) => child.tagName),
    directButtonTags: Array.from(element.children).map((child) => child.firstElementChild?.tagName ?? null),
    listItemCount: element.querySelectorAll(":scope > li").length,
    buttonCount: element.querySelectorAll(":scope > li > button").length,
    tableLikeCount: element.querySelectorAll("table,[role='table'],[role='row']").length,
    blockInsideButtonCount: element.querySelectorAll("button div").length,
  }));
  expect(structure.tagName).toBe("UL");
  expect(structure.role).toBe("list");
  expect(new Set(structure.childTags)).toEqual(new Set(["LI"]));
  expect(new Set(structure.directButtonTags)).toEqual(new Set(["BUTTON"]));
  expect(structure.listItemCount).toBeGreaterThan(0);
  expect(structure.buttonCount).toBe(structure.listItemCount);
  expect(structure.tableLikeCount).toBe(0);
  expect(structure.blockInsideButtonCount).toBe(0);
  return button;
}

test("Overview, Clients, and Projects share native actionable-list semantics and restore row focus", async ({ page }) => {
  const browserIssues = monitorBrowserHealth(page);
  await mockOverviewLead(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const leadButton = await expectNativeActionableList(page, "Lead pipeline records", leadButtonName);
  await expect(leadButton).toHaveAccessibleDescription("Stage New inquiry. Estimated value $42,000. Next action Confirm the accessible list review.");
  await leadButton.focus();
  await page.keyboard.press("Enter");
  const leadDrawer = page.getByRole("dialog", { name: `${leadFixture.leadNumber} ${leadCompany}`, exact: true });
  await expect(leadDrawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(leadDrawer).toHaveCount(0);
  await expect(leadButton).toBeFocused();

  await page.goto("/clients");
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  const clientButton = await expectNativeActionableList(page, "Client directory", clientButtonName);
  await expect(clientButton).toHaveAccessibleDescription("Industry Commercial. Primary contact E2E Primary Contact, contact@example.test. 1 project.");
  await clientButton.focus();
  await page.keyboard.press("Space");
  const clientDrawer = page.getByRole("dialog", { name: `${clientName} client account`, exact: true });
  await expect(clientDrawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(clientDrawer).toHaveCount(0);
  await expect(clientButton).toBeFocused();

  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  const projectButton = await expectNativeActionableList(page, "Projects", projectButtonName);
  await expect(projectButton).toHaveAccessibleDescription("Client E2E Regression Client. Status Mobilizing. Schedule Not scheduled. Site 201 E2E Test Ave, Cherry Hill, NJ. Estimated value $125,000.");
  await projectButton.focus();
  await page.keyboard.press("Enter");
  const projectDrawer = page.getByRole("dialog", { name: `${projectNumber} ${projectName}`, exact: true });
  await expect(projectDrawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(projectDrawer).toHaveCount(0);
  await expect(projectButton).toBeFocused();

  expect(browserIssues, browserIssues.join("\n\n")).toEqual([]);
});

test("actionable rows preserve decision-useful metadata without responsive overflow", async ({ page }) => {
  const browserIssues = monitorBrowserHealth(page);
  await mockOverviewLead(page);

  const surfaces = [
    {
      path: "/",
      listName: "Lead pipeline records",
      buttonName: leadButtonName,
      fields: [
        { selector: ".client-cell", text: [leadCompany, leadProject] },
        { selector: ".status", text: ["New inquiry"] },
        { selector: ".value-cell", text: ["$42,000"] },
        { selector: ".next-cell", text: ["Confirm the accessible list review"] },
      ],
    },
    {
      path: "/clients",
      listName: "Client directory",
      buttonName: clientButtonName,
      fields: [
        { selector: ".client-identity", text: [clientName, "E2E-CLIENT · Commercial"] },
        { selector: ".client-primary-contact", text: ["E2E Primary Contact", "contact@example.test"] },
        { selector: ".client-project-count", text: ["1", "project"] },
      ],
    },
    {
      path: "/projects",
      listName: "Projects",
      buttonName: projectButtonName,
      fields: [
        { selector: ".project-row-identity", text: [projectName, `${projectNumber} · ${clientName}`] },
        { selector: ".project-row-status", text: ["Mobilizing"] },
        { selector: ".project-row-details", text: ["Not scheduled", "201 E2E Test Ave, Cherry Hill, NJ"] },
        { selector: ".project-row-value", text: ["$125,000"] },
      ],
    },
  ] as const;

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const surface of surfaces) {
      await page.goto(surface.path);
      const button = await expectNativeActionableList(page, surface.listName, surface.buttonName);
      for (const field of surface.fields) {
        const metadata = button.locator(field.selector);
        await expect(metadata).toBeVisible();
        for (const text of field.text) await expect(metadata).toContainText(text);
      }
      const bounds = await button.boundingBox();
      expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? viewport.width) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }

  expect(browserIssues, browserIssues.join("\n\n")).toEqual([]);
});

test("empty record responses keep messages outside empty actionable lists", async ({ page }) => {
  for (const resource of ["leads", "clients", "projects"] as const) {
    await page.route(`**/api/v1/${resource}`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ [resource]: [] }) });
        return;
      }
      await route.continue();
    });
  }

  await page.goto("/");
  await expect(page.getByText("No active leads yet. Add the first opportunity to begin the live pipeline.", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Lead pipeline records" })).toHaveCount(0);

  await page.goto("/clients");
  await expect(page.getByText("No clients yet. Add the first client to create the live directory.", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Client directory" }).getByRole("button")).toHaveCount(0);

  await page.goto("/projects");
  await expect(page.getByText("No active projects yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Projects" }).getByRole("button")).toHaveCount(0);
});
