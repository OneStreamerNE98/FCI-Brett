import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const origin = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const execFileAsync = promisify(execFile);
const recordPrefix = "FCI TEST — DO NOT USE — GI-04";
const standardizedAddress = "123 Test Street, Portland, ME 04101";

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

async function clearGi04Records() {
  await executeLocalD1(
    `DELETE FROM activity_events WHERE record_id IN (SELECT id FROM projects WHERE name LIKE '${recordPrefix}%');`
    + ` DELETE FROM activity_events WHERE record_id IN (SELECT id FROM clients WHERE name LIKE '${recordPrefix}%');`
    + ` DELETE FROM activity_events WHERE record_id IN (SELECT id FROM leads WHERE company LIKE '${recordPrefix}%');`
    + ` DELETE FROM projects WHERE name LIKE '${recordPrefix}%';`
    + ` DELETE FROM contacts WHERE client_id IN (SELECT id FROM clients WHERE name LIKE '${recordPrefix}%');`
    + ` DELETE FROM clients WHERE name LIKE '${recordPrefix}%';`
    + ` DELETE FROM leads WHERE company LIKE '${recordPrefix}%';`
    + ` DELETE FROM address_validation_reviews WHERE actor_id = 'e2e-admin@example.test' AND (input_address LIKE '123 Test Street GI-04%' OR input_address = '${standardizedAddress}');`,
  );
}

async function gotoLiveView(
  page: Page,
  path: "/leads" | "/clients" | "/projects",
  apiPath: "/api/v1/leads" | "/api/v1/clients" | "/api/v1/projects",
) {
  const liveResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === apiPath
    && response.request().method() === "GET"
  ));
  await page.goto(path);
  await liveResponse;
  await expect(page.getByText("Loading live records", { exact: true })).toHaveCount(0);
}

function addressField(dialog: Locator, entityKind: "lead" | "client" | "project") {
  return dialog.locator(`[data-address-validation-field="${entityKind}"]`);
}

function captureUnexpectedBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // vinext dev emits local-file font URLs on Windows; the same known
    // development-only warning is present throughout the existing e2e suite.
    if (text.includes("Not allowed to load local resource: file:///") && text.includes("/.vinext/fonts/")) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function reviewAndChooseStandardized(
  dialog: Locator,
  entityKind: "lead" | "client" | "project",
  inputLabel: string,
  typedAddress: string,
) {
  const field = addressField(dialog, entityKind);
  const input = field.getByRole("combobox", { name: inputLabel, exact: true });
  if (await input.inputValue() !== typedAddress) await input.fill(typedAddress);
  await Promise.all([
    dialog.page().waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v1/address-validation"
      && response.request().method() === "POST"
    )),
    field.getByRole("button", { name: "Review address" }).click(),
  ]);
  const review = field.locator("[data-address-review-verdict]");
  await expect(review).toBeVisible();
  await expect(review).toContainText(standardizedAddress);
  await expect(input).toHaveValue(typedAddress);
  await field.getByRole("button", { name: "Use standardized address" }).click();
  await expect(input).toHaveValue(typedAddress);
  await expect(field.getByText("Standardized address selected", { exact: true })).toBeVisible();
}

async function apiRows(
  request: APIRequestContext,
  path: "/api/v1/leads" | "/api/v1/clients" | "/api/v1/projects",
  key: "leads" | "clients" | "projects",
) {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  return (await response.json() as Record<string, Array<Record<string, unknown>>>)[key];
}

async function createEditFixtures(request: APIRequestContext, suffix: string) {
  const clientName = `${recordPrefix} edit client ${suffix}`;
  const clientResponse = await request.post("/api/v1/clients", {
    headers: { Origin: origin },
    data: {
      name: clientName,
      industry: "Commercial",
      status: "active",
      siteAddress: "Original client address",
      primaryContact: {
        name: "GI-04 Edit Contact",
        email: "gi04-edit@example.test",
        role: "Primary contact",
      },
    },
  });
  expect(clientResponse.status()).toBe(201);
  const client = await clientResponse.json() as { id: string; clientCode: string };

  const projectName = `${recordPrefix} edit project ${suffix}`;
  const projectResponse = await request.post("/api/v1/projects", {
    headers: { Origin: origin },
    data: {
      clientId: client.id,
      name: projectName,
      status: "planning",
      site: "Original project address",
      projectManagerId: "e2e-admin@example.test",
    },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json() as { id: string; projectNumber: string };

  const leadCompany = `${recordPrefix} edit lead ${suffix}`;
  const leadResponse = await request.post("/api/v1/leads", {
    headers: { Origin: origin },
    data: {
      company: leadCompany,
      contactName: "GI-04 Edit Lead",
      projectName: "GI-04 edit opportunity",
      source: "Referral",
      stage: "New inquiry",
      site: "Original lead address",
      estimatedValue: 25_000,
      nextAction: "Review the edit address",
      status: "active",
    },
  });
  expect(leadResponse.status()).toBe(201);
  const lead = (await leadResponse.json() as {
    lead: { id: string; leadNumber: string };
  }).lead;

  return {
    client: { ...client, name: clientName },
    project: { ...project, name: projectName },
    lead: { ...lead, company: leadCompany },
  };
}

test.beforeEach(clearGi04Records);
test.afterEach(clearGi04Records);

test("simulation reviews addresses on lead, client, and project create forms", async ({ page }) => {
  test.setTimeout(90_000);
  const browserErrors = captureUnexpectedBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const suffix = String(Date.now());
  const leadCompany = `${recordPrefix} create lead ${suffix}`;
  const clientName = `${recordPrefix} create client ${suffix}`;
  const projectName = `${recordPrefix} create project ${suffix}`;
  const reviewTokens: string[] = [];
  let leadCreatePosts = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/address-validation" && request.method() === "POST") {
      const body = request.postDataJSON() as { sessionToken?: unknown };
      if (typeof body.sessionToken === "string") reviewTokens.push(body.sessionToken);
    }
    if (pathname === "/api/v1/leads" && request.method() === "POST") leadCreatePosts += 1;
  });

  await gotoLiveView(page, "/leads", "/api/v1/leads");
  await page.getByRole("button", { name: "Add lead" }).click();
  const leadDialog = page.getByRole("dialog", { name: "Add a lead" });
  await leadDialog.getByLabel("Client company").fill(leadCompany);
  await leadDialog.getByLabel("Primary contact").fill("GI-04 Create Lead");
  await leadDialog.getByLabel("Project / opportunity").fill("GI-04 create opportunity");
  await leadDialog.getByLabel("Estimated value").fill("30000");
  await leadDialog.getByRole("textbox", { name: "Next action", exact: true }).fill("Confirm the reviewed address");
  const leadAddress = `123 Test Street GI-04 lead ${suffix}`;
  const leadField = addressField(leadDialog, "lead");
  const leadInput = leadField.getByRole("combobox", { name: "Project site", exact: true });
  await leadInput.fill(leadAddress);
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/address-validation"),
    leadField.getByRole("button", { name: "Review address" }).click(),
  ]);
  await expect(leadField.locator("[data-address-review-verdict]")).toContainText(standardizedAddress);
  await expect(leadInput).toHaveValue(leadAddress);
  await expect.poll(() => reviewTokens.length).toBe(1);

  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/address-validation"),
    leadField.getByRole("button", { name: "Review again" }).click(),
  ]);
  await expect.poll(() => reviewTokens.length).toBe(2);
  expect(reviewTokens[1]).not.toBe(reviewTokens[0]);

  await leadDialog.getByRole("button", { name: "Add to pipeline" }).click();
  await expect(leadDialog).toBeVisible();
  expect(leadCreatePosts).toBe(0);
  expect(await leadInput.evaluate((input: HTMLInputElement) => input.validationMessage)).toContain(
    "Choose the standardized suggestion",
  );
  await expect(leadInput).toBeFocused();
  await leadField.getByRole("button", { name: "Use standardized address" }).click();
  await expect(leadInput).toHaveValue(leadAddress);
  await leadDialog.getByRole("button", { name: "Add to pipeline" }).click();
  await expect(leadDialog).toBeHidden();

  const savedLead = (await apiRows(page.request, "/api/v1/leads", "leads"))
    .find((row) => row.company === leadCompany);
  expect(savedLead).toEqual(expect.objectContaining({
    site: standardizedAddress,
    latitude: 43.6591,
    longitude: -70.2568,
    addressValidationVerdict: "simulated",
  }));

  await gotoLiveView(page, "/clients", "/api/v1/clients");
  await page.getByRole("button", { name: "Add client" }).click();
  const clientDialog = page.getByRole("dialog", { name: "Add a client" });
  await clientDialog.getByLabel("Client business name").fill(clientName);
  await clientDialog.getByLabel("Primary contact").fill("GI-04 Create Contact");
  await clientDialog.getByLabel("Work email").fill("gi04-create@example.test");
  const clientField = addressField(clientDialog, "client");
  const clientInput = clientField.getByRole("combobox", { name: "Primary site address", exact: true });
  await clientInput.fill("123 Tes");
  const suggestion = clientField.getByRole("option", { name: standardizedAddress });
  await expect(suggestion).toBeVisible();
  await clientInput.press("Escape");
  await expect(suggestion).toBeHidden();
  await expect(clientInput).toBeFocused();
  await clientInput.fill("123 Test");
  await expect(suggestion).toBeVisible();
  await clientInput.press("ArrowDown");
  await expect(suggestion).toHaveAttribute("aria-selected", "true");
  await clientInput.press("Enter");
  await expect(suggestion).toBeHidden();
  await expect(clientInput).toBeFocused();
  await expect(clientInput).toHaveValue(standardizedAddress);
  await reviewAndChooseStandardized(
    clientDialog,
    "client",
    "Primary site address",
    standardizedAddress,
  );
  await clientDialog.getByRole("button", { name: "Add client" }).click();
  await expect(clientDialog).toBeHidden();

  const savedClient = (await apiRows(page.request, "/api/v1/clients", "clients"))
    .find((row) => row.name === clientName);
  expect(savedClient).toEqual(expect.objectContaining({
    site_address: standardizedAddress,
    latitude: 43.6591,
    longitude: -70.2568,
    address_validation_verdict: "simulated",
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLiveView(page, "/projects", "/api/v1/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const projectDialog = page.getByRole("dialog", { name: "Create a project" });
  await expect(projectDialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await projectDialog.getByLabel("Client").selectOption(String(savedClient?.id));
  await projectDialog.getByLabel("Project name").fill(projectName);
  await reviewAndChooseStandardized(
    projectDialog,
    "project",
    "Site",
    `123 Test Street GI-04 project ${suffix}`,
  );
  await projectDialog.getByRole("button", { name: "Create project" }).click();
  await expect(projectDialog).toBeHidden();

  const savedProject = (await apiRows(page.request, "/api/v1/projects", "projects"))
    .find((row) => row.name === projectName);
  expect(savedProject).toEqual(expect.objectContaining({
    site: standardizedAddress,
    latitude: 43.6591,
    longitude: -70.2568,
    address_validation_verdict: "simulated",
  }));
  expect(browserErrors).toEqual([]);
});

test("simulation reviews addresses on lead, client, and project edit forms", async ({ page }) => {
  test.setTimeout(90_000);
  const browserErrors = captureUnexpectedBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const suffix = String(Date.now());
  const fixture = await createEditFixtures(page.request, suffix);

  await gotoLiveView(page, "/leads", "/api/v1/leads");
  await page.getByRole("button", { name: `View details for ${fixture.lead.company}` }).click();
  const leadDrawer = page.getByRole("dialog", { name: new RegExp(fixture.lead.leadNumber) });
  await leadDrawer.getByRole("button", { name: "Edit lead" }).click();
  const leadEditor = page.getByRole("dialog", { name: `Edit ${fixture.lead.leadNumber}` });
  await reviewAndChooseStandardized(
    leadEditor,
    "lead",
    "Project site",
    `123 Test Street GI-04 lead edit ${suffix}`,
  );
  await leadEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(leadEditor).toBeHidden();
  expect((await apiRows(page.request, "/api/v1/leads", "leads"))
    .find((row) => row.id === fixture.lead.id)).toEqual(expect.objectContaining({
    site: standardizedAddress,
    addressValidationVerdict: "simulated",
  }));

  await gotoLiveView(page, "/clients", "/api/v1/clients");
  await page.getByRole("button", { name: new RegExp(fixture.client.name) }).click();
  const clientDrawer = page.getByRole("dialog", { name: `${fixture.client.name} client account` });
  await clientDrawer.getByRole("button", { name: "Edit client" }).click();
  const clientEditor = page.getByRole("dialog", { name: new RegExp(`Edit ${fixture.client.clientCode} client`) });
  await reviewAndChooseStandardized(
    clientEditor,
    "client",
    "Primary site address",
    `123 Test Street GI-04 client edit ${suffix}`,
  );
  await clientEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(clientEditor).toBeHidden();
  expect((await apiRows(page.request, "/api/v1/clients", "clients"))
    .find((row) => row.id === fixture.client.id)).toEqual(expect.objectContaining({
    site_address: standardizedAddress,
    address_validation_verdict: "simulated",
  }));

  await gotoLiveView(page, "/projects", "/api/v1/projects");
  await page.getByRole("button", { name: new RegExp(fixture.project.name) }).click();
  const projectDrawer = page.getByRole("dialog", {
    name: new RegExp(`${fixture.project.projectNumber} ${fixture.project.name}`),
  });
  await projectDrawer.getByRole("button", { name: "Edit project" }).click();
  const projectEditor = page.getByRole("dialog", { name: `Edit ${fixture.project.projectNumber}` });
  await reviewAndChooseStandardized(
    projectEditor,
    "project",
    "Site",
    `123 Test Street GI-04 project edit ${suffix}`,
  );
  await projectEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(projectEditor).toBeHidden();
  expect((await apiRows(page.request, "/api/v1/projects", "projects"))
    .find((row) => row.id === fixture.project.id)).toEqual(expect.objectContaining({
    site: standardizedAddress,
    address_validation_verdict: "simulated",
  }));
  expect(browserErrors).toEqual([]);
});
