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

async function clearEdit04Records() {
  await executeLocalD1(
    "DELETE FROM activity_events WHERE record_id IN (SELECT id FROM leads WHERE company LIKE 'FCI TEST — DO NOT USE — EDIT-04%');"
    + " DELETE FROM leads WHERE company LIKE 'FCI TEST — DO NOT USE — EDIT-04%';",
  );
}

async function createLead(
  request: APIRequestContext,
  suffix: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request.post("/api/v1/leads", {
    headers: { Origin: origin },
    data: {
      company: `FCI TEST — DO NOT USE — EDIT-04 ${suffix}`,
      contactName: "Original Contact",
      contactEmail: "client-contact@example.test",
      contactPhone: "555-0100",
      projectName: "Original opportunity",
      source: "Referral",
      stage: "New inquiry",
      site: "Original lead site",
      estimatedValue: 125_000,
      nextAction: "Original next action",
      nextActionAt: "2026-07-30T13:00:00.000Z",
      ownerEmail: "e2e-admin@example.test",
      status: "active",
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { lead: { id: string; leadNumber: string; version: string } }).lead;
}

async function findLead(request: APIRequestContext, id: string, headers?: Record<string, string>) {
  const response = await request.get("/api/v1/leads", { headers });
  expect(response.status()).toBe(200);
  const payload = await response.json() as { leads: Array<Record<string, unknown>> };
  return payload.leads.find((lead) => lead.id === id);
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).include(".lead-edit-modal").analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

test.beforeEach(async () => {
  await clearEdit04Records();
});

test.afterEach(async () => {
  await clearEdit04Records();
});

test("admin edits all 13 lead fields through the reusable prefilled modal", async ({ page }) => {
  const suffix = String(Date.now());
  const created = await createLead(page.request, `admin ${suffix}`);
  const originalCompany = `FCI TEST — DO NOT USE — EDIT-04 admin ${suffix}`;
  const updatedCompany = `FCI TEST — DO NOT USE — EDIT-04 updated ${suffix}`;
  let dashboardRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/dashboard") dashboardRequests += 1;
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/leads");
  await page.getByRole("button", { name: `View details for ${originalCompany}` }).click();
  let drawer = page.getByRole("dialog", { name: new RegExp(created.leadNumber) });
  await drawer.getByRole("button", { name: "Edit lead" }).click();
  let editor = page.getByRole("dialog", { name: `Edit ${created.leadNumber}` });

  await expect(editor.getByLabel("Client company")).toHaveValue(originalCompany);
  await expect(editor.getByLabel("Primary contact")).toHaveValue("Original Contact");
  await expect(editor.getByLabel(/Contact email/)).toHaveValue("client-contact@example.test");
  await expect(editor.getByLabel(/Contact phone/)).toHaveValue("555-0100");
  await expect(editor.getByLabel("Project / opportunity")).toHaveValue("Original opportunity");
  await expect(editor.getByLabel("Lead source")).toHaveValue("Referral");
  await expect(editor.getByLabel("Stage")).toHaveValue("New inquiry");
  await expect(editor.getByLabel("Project site")).toHaveValue("Original lead site");
  await expect(editor.getByLabel("Estimated value")).toHaveValue("125000");
  await expect(editor.getByRole("textbox", { name: "Next action", exact: true })).toHaveValue("Original next action");
  await expect(editor.getByLabel(/Next action date/)).not.toHaveValue("");
  await expect(editor.getByLabel("Lead owner email")).toHaveValue("e2e-admin@example.test");
  await expect(editor.getByLabel("Lead status")).toHaveValue("active");
  await expectAccessible(page);

  await editor.getByLabel("Client company").fill(updatedCompany);
  await editor.getByLabel("Primary contact").fill("Updated Contact");
  await editor.getByLabel(/Contact email/).fill("updated-client@example.test");
  await editor.getByLabel(/Contact phone/).fill("555-0199");
  await editor.getByLabel("Project / opportunity").fill("Updated opportunity");
  await editor.getByLabel("Lead source").selectOption({ label: "Website" });
  await editor.getByLabel("Stage").selectOption({ label: "Proposal" });
  await editor.getByLabel("Project site").fill("Updated lead site");
  await editor.getByLabel("Estimated value").fill("180000");
  await editor.getByRole("textbox", { name: "Next action", exact: true }).fill("Send the updated proposal");
  await editor.getByLabel(/Next action date/).fill("2026-08-01T09:30");
  await editor.getByLabel("Lead owner email").fill("e2e-office@example.test");
  await editor.getByLabel("Lead status").selectOption("converted");
  const dashboardRequestsBeforeSave = dashboardRequests;
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toBeHidden();
  await expect.poll(() => dashboardRequests).toBeGreaterThan(dashboardRequestsBeforeSave);

  const saved = await findLead(page.request, created.id);
  expect(saved).toEqual(expect.objectContaining({
    company: updatedCompany,
    contactName: "Updated Contact",
    contactEmail: "updated-client@example.test",
    contactPhone: "555-0199",
    projectName: "Updated opportunity",
    source: "Website",
    stage: "Proposal",
    site: "Updated lead site",
    estimatedValue: 180_000,
    nextAction: "Send the updated proposal",
    nextActionAt: new Date("2026-08-01T09:30").toISOString(),
    ownerEmail: "e2e-office@example.test",
    status: "converted",
    version: "2",
  }));

  drawer = page.getByRole("dialog", { name: new RegExp(`${created.leadNumber} ${updatedCompany}`) });
  await drawer.getByRole("button", { name: "Edit lead" }).click();
  editor = page.getByRole("dialog", { name: `Edit ${created.leadNumber}` });
  await expect(editor.getByLabel("Client company")).toHaveValue(updatedCompany);
  await expect(editor.getByLabel("Lead status")).toHaveValue("converted");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(editor).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page);
  await editor.getByRole("button", { name: "Cancel" }).click();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Search workspace" })).toBeFocused();
});

test("a stale lead draft keeps its values until explicit re-apply", async ({ page }) => {
  const suffix = String(Date.now());
  const created = await createLead(page.request, `conflict ${suffix}`);
  const originalCompany = `FCI TEST — DO NOT USE — EDIT-04 conflict ${suffix}`;
  const peerCompany = `FCI TEST — DO NOT USE — EDIT-04 peer ${suffix}`;
  const reappliedCompany = `FCI TEST — DO NOT USE — EDIT-04 reapplied ${suffix}`;

  await page.goto("/leads");
  await page.getByRole("button", { name: `View details for ${originalCompany}` }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(created.leadNumber) });
  await drawer.getByRole("button", { name: "Edit lead" }).click();
  const editor = page.getByRole("dialog", { name: `Edit ${created.leadNumber}` });
  await editor.getByLabel("Client company").fill(reappliedCompany);

  const peer = await page.request.patch(`/api/v1/leads/${created.id}`, {
    headers: { Origin: origin },
    data: { company: peerCompany, version: "1" },
  });
  expect(peer.status()).toBe(200);

  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByRole("alert")).toContainText("changed while you were editing");
  await expect(editor.getByLabel("Client company")).toHaveValue(reappliedCompany);
  await expect(editor.getByText(`Saved value: ${peerCompany}`, { exact: true })).toBeVisible();
  await expect(editor.getByText(/Saved value:/)).toHaveCount(1);
  await expect(editor.getByRole("button", { name: "Re-apply changes" })).toBeVisible();
  expect(await findLead(page.request, created.id)).toEqual(expect.objectContaining({
    company: peerCompany,
    version: "2",
  }));

  await editor.getByRole("button", { name: "Re-apply changes" }).click();
  await expect(editor).toBeHidden();
  expect(await findLead(page.request, created.id)).toEqual(expect.objectContaining({
    company: reappliedCompany,
    version: "3",
  }));
});

test("office users edit descriptive lead fields while estimated value stays read-only", async ({ page }) => {
  const suffix = String(Date.now());
  const originalNextActionAt = "2026-07-30T13:00:37.500Z";
  const created = await createLead(page.request, `office ${suffix}`, {
    nextActionAt: originalNextActionAt,
  });
  const originalCompany = `FCI TEST — DO NOT USE — EDIT-04 office ${suffix}`;
  const updatedCompany = `FCI TEST — DO NOT USE — EDIT-04 office updated ${suffix}`;
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/leads");
  await page.getByRole("button", { name: `View details for ${originalCompany}` }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(created.leadNumber) });
  await drawer.getByRole("button", { name: "Edit lead" }).click();
  const editor = page.getByRole("dialog", { name: `Edit ${created.leadNumber}` });
  await expect(editor.getByLabel("Estimated value")).toBeDisabled();
  await expect(editor.getByText("Estimated value is read-only here. An administrator can edit it.")).toBeVisible();

  const forbidden = await page.request.patch(`/api/v1/leads/${created.id}`, {
    headers: officeHeaders,
    data: { estimatedValue: 1, version: "1" },
  });
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toEqual({
    error: "An FCI administrator must update lead estimated value.",
  });

  await editor.getByLabel("Client company").fill(updatedCompany);
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toBeHidden();
  expect(await findLead(page.request, created.id, officeHeaders)).toEqual(expect.objectContaining({
    company: updatedCompany,
    estimatedValue: 125_000,
    nextActionAt: originalNextActionAt,
    version: "2",
  }));
});
