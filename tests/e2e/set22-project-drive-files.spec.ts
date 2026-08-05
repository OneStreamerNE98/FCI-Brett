import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const ORIGIN = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const ADMIN_EMAIL = "e2e-admin@example.test";
const OFFICE_EMAIL = "e2e-office@example.test";
const PROJECT_ID = "e2e-project-001";
const PROJECT_NUMBER = "CF-2026-E2E00001";
const PROJECT_NAME = "E2E Mobile Metadata Project";
const SHEET_NAME = "FCI TEST — DO NOT USE — SET-22 Budget";
const TEMPLATE_NAME = "FCI TEST — DO NOT USE — SET-22 Estimate";

const adminHeaders = {
  Origin: ORIGIN,
  "oai-authenticated-user-email": ADMIN_EMAIL,
  "oai-authenticated-user-full-name": encodeURIComponent("E2E Admin"),
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

type BrowserIssue = Readonly<{ kind: "console.error" | "pageerror"; detail: string }>;

function monitorBrowserHealth(page: Page) {
  const issues: BrowserIssue[] = [];
  page.on("console", (message) => {
    const detail = message.text();
    if (message.type() === "error") {
      issues.push({ kind: "console.error", detail });
    }
  });
  page.on("pageerror", (error) => issues.push({ kind: "pageerror", detail: error.stack ?? error.message }));
  return issues;
}

async function expectSuccessfulSetupResponse(response: APIResponse, path: string) {
  if (response.ok()) return;
  throw new Error(`${path} failed with ${response.status()}: ${await response.text()}`);
}

async function adminPost(page: Page, path: string) {
  const response = await page.request.post(path, { headers: adminHeaders, data: {} });
  await expectSuccessfulSetupResponse(response, path);
  return response;
}

async function resetAndPrepareProjectFileSimulation(page: Page) {
  await adminPost(page, "/api/v1/integrations/google/simulation/reset");
  await adminPost(page, "/api/v1/integrations/google/drive/shared-drive/adopt");
  await adminPost(page, "/api/v1/integrations/google/drive/folders/ensure-roots");
  await adminPost(page, "/api/v1/integrations/google/drive/templates/ensure");
}

async function restoreSimulationBaseline(page: Page) {
  await adminPost(page, "/api/v1/integrations/google/simulation/reset");
  await adminPost(page, "/api/v1/integrations/google/drive/shared-drive/adopt");
  await adminPost(page, "/api/v1/integrations/google/drive/folders/ensure-roots");
  await adminPost(page, "/api/v1/integrations/google/sheets/ensure");
}

async function useOfficeIdentity(page: Page) {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": OFFICE_EMAIL,
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
}

async function openSeededProject(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  const projectRow = page.getByRole("button", { name: new RegExp(PROJECT_NAME, "u") });
  await expect(projectRow).toBeVisible();
  await projectRow.click();
  const drawer = page.getByRole("dialog", { name: `${PROJECT_NUMBER} ${PROJECT_NAME}`, exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}

function isProjectFileResponse(response: { url: () => string; request: () => { method: () => string } }) {
  return response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/v1/projects/${PROJECT_ID}/drive/files`;
}

test("provisions a project, then an Office user creates a blank Sheet and a template copy", async ({ page }) => {
  test.skip(
    process.env.FCI_E2E_EXTERNAL_SERVER === "true",
    "The end-to-end provisioning sequence requires the isolated local Workspace simulation database.",
  );

  const browserIssues = monitorBrowserHealth(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await resetAndPrepareProjectFileSimulation(page);
  let primaryError: unknown;

  try {
    await page.goto("/projects");
    let drawer = await openSeededProject(page);
    await drawer.getByRole("button", { name: "Files", exact: true }).click();

    // The catalog is a real office-safe GET. Reset guarantees this project starts
    // without a mapping, so the UI must explain the provisioning dependency.
    await expect(drawer.getByRole("heading", { name: "Project files", exact: true })).toBeVisible();
    await expect(drawer.getByText("Drive folder required", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "New document", exact: true })).toBeDisabled();

    const provisionResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/projects/${PROJECT_ID}/drive`
    ));
    await drawer.getByRole("button", { name: "Create Drive folder", exact: true }).click();
    const provisionResponse = await provisionResponsePromise;
    expect(provisionResponse.status()).toBe(201);
    expect(await provisionResponse.json()).toEqual(expect.objectContaining({
      created: true,
      simulated: true,
      driveFolderId: `sim-project-${PROJECT_ID}`,
    }));
    await expect(drawer.getByText("Created in this session", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "New document", exact: true })).toBeEnabled();

    // Folder provisioning is admin-only. Reload under a routine Office identity
    // before reading the catalog and creating either file.
    await drawer.getByRole("button", { name: "Close project", exact: true }).click();
    await useOfficeIdentity(page);
    await page.goto("/projects");
    drawer = await openSeededProject(page);
    await drawer.getByRole("button", { name: "Files", exact: true }).click();
    const newDocumentButton = drawer.getByRole("button", { name: "New document", exact: true });
    await expect(newDocumentButton).toBeEnabled();

    // Create a blank Sheet at the implicit project root.
    await newDocumentButton.click();
    let modal = page.getByRole("dialog", { name: `Create a project file in ${PROJECT_NUMBER}`, exact: true });
    const kindSelect = modal.getByLabel("Document type", { exact: true });
    await expect(kindSelect).toBeFocused();
    await kindSelect.selectOption("sheet");
    const startFrom = modal.getByLabel("Start from", { exact: true });
    await expect(startFrom).toHaveValue("");
    await expect(startFrom.locator("option:checked")).toHaveText("Blank Google Sheet");
    await expect(startFrom.locator("option")).toHaveCount(1);
    await expect(modal.getByLabel("Destination folder", { exact: true })).toHaveValue("");
    await modal.getByLabel("Document name", { exact: true }).fill(SHEET_NAME);

    const sheetResponsePromise = page.waitForResponse(isProjectFileResponse);
    await modal.getByRole("button", { name: "Create document", exact: true }).click();
    const sheetResponse = await sheetResponsePromise;
    expect(sheetResponse.status()).toBe(201);
    expect(sheetResponse.request().postDataJSON()).toEqual({ kind: "sheet", name: SHEET_NAME });
    await expect(modal.getByText("Simulation only — no Google file was created.", { exact: true })).toBeVisible();
    const sheetLink = modal.getByRole("link", { name: "View simulation", exact: true });
    await expect(sheetLink).toHaveAttribute("href", /workspace-simulation=project-file/u);
    await expect(sheetLink).toHaveAttribute("target", "_blank");
    await expect(sheetLink).toBeFocused();
    const sheetHref = await sheetLink.getAttribute("href");
    await modal.getByRole("button", { name: "Done", exact: true }).click();
    await expect(newDocumentButton).toBeFocused();

    // Copy the ensured Estimate Proposal template into a configured leaf folder.
    await newDocumentButton.click();
    modal = page.getByRole("dialog", { name: `Create a project file in ${PROJECT_NUMBER}`, exact: true });
    await modal.getByLabel("Start from", { exact: true }).selectOption("estimate-proposal");
    const destination = modal.getByLabel("Destination folder", { exact: true });
    expect(await destination.locator("option").count()).toBeGreaterThan(1);
    await destination.selectOption({ index: 1 });
    const selectedFolderKey = await destination.inputValue();
    expect(selectedFolderKey).not.toBe("");
    await modal.getByLabel("Document name", { exact: true }).fill(TEMPLATE_NAME);

    const templateResponsePromise = page.waitForResponse(isProjectFileResponse);
    await modal.getByRole("button", { name: "Create document", exact: true }).click();
    const templateResponse = await templateResponsePromise;
    expect(templateResponse.status()).toBe(201);
    expect(templateResponse.request().postDataJSON()).toEqual({
      kind: "doc",
      name: TEMPLATE_NAME,
      templateKey: "estimate-proposal",
      folderKey: selectedFolderKey,
    });
    await expect(modal.getByText("Simulation only — no Google file was created.", { exact: true })).toBeVisible();
    const templateLink = modal.getByRole("link", { name: "View simulation", exact: true });
    await expect(templateLink).toHaveAttribute("href", /workspace-simulation=project-file/u);
    await expect(templateLink).toBeFocused();
    const templateHref = await templateLink.getAttribute("href");
    await modal.getByRole("button", { name: "Done", exact: true }).click();
    await expect(newDocumentButton).toBeFocused();

    const sessionFiles = drawer.getByRole("heading", { name: "Created in this session", exact: true }).locator("../..");
    const sessionSheetLink = sessionFiles.getByRole("link").filter({ hasText: SHEET_NAME });
    const sessionTemplateLink = sessionFiles.getByRole("link").filter({ hasText: TEMPLATE_NAME });
    await expect(sessionSheetLink).toHaveAttribute("href", sheetHref!);
    await expect(sessionTemplateLink).toHaveAttribute("href", templateHref!);
    await expect(sessionFiles).toContainText("no Google file created");
    await expect(sessionFiles).toContainText("Use Open Drive folder below for the complete file list.");

    const accessibility = await new AxeBuilder({ page })
      .include(".project-drawer")
      .disableRules(["color-contrast"])
      .analyze();
    expect(
      accessibility.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical"),
      JSON.stringify(accessibility.violations, null, 2),
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(browserIssues, browserIssues.map((issue) => `${issue.kind}: ${issue.detail}`).join("\n\n")).toEqual([]);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await restoreSimulationBaseline(page);
    } catch (cleanupError) {
      if (primaryError === undefined) throw cleanupError;
    }
  }
});
