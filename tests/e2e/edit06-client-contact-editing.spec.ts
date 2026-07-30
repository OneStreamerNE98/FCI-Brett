import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const origin = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const execFileAsync = promisify(execFile);

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

async function clearEdit06Records() {
  await executeLocalD1(
    "DELETE FROM activity_events WHERE record_id IN (SELECT id FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-06%');"
    + " DELETE FROM contacts WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-06%');"
    + " DELETE FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — EDIT-06%';",
  );
}

async function createClient(
  request: APIRequestContext,
  suffix: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request.post("/api/v1/clients", {
    headers: { Origin: origin },
    data: {
      name: `FCI TEST — DO NOT USE — EDIT-06 ${suffix}`,
      industry: "Healthcare",
      status: "active",
      primaryContact: {
        name: "Original Contact",
        email: "original-contact@example.test",
        phone: "555-0100",
        role: "Facilities manager",
      },
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; clientCode: string }>;
}

async function clientRow(request: APIRequestContext, id: string) {
  const response = await request.get("/api/v1/clients");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { clients: Array<Record<string, unknown>> };
  return payload.clients.find((client) => client.id === id);
}

async function expectAccessible(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

test.beforeEach(async () => {
  await clearEdit06Records();
});

test.afterEach(async () => {
  await clearEdit06Records();
});

test("client create and both editors round-trip every reachable field at desktop and phone widths", async ({ page }) => {
  const suffix = String(Date.now());
  const originalName = `FCI TEST — DO NOT USE — EDIT-06 created ${suffix}`;
  const updatedName = `FCI TEST — DO NOT USE — EDIT-06 updated ${suffix}`;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/clients");
  await expect(page.getByRole("button", { name: /Open client E2E Regression Client/ })).toBeVisible();
  await page.getByRole("button", { name: "Add client" }).click();
  const create = page.getByRole("dialog", { name: "Add a client" });
  await expect(create).toBeVisible();
  await create.getByLabel("Client business name").fill(originalName);
  await create.getByLabel("Primary contact").fill("Create Contact");
  await create.getByLabel("Work email").fill("create-contact@example.test");
  await create.getByLabel(/Contact phone/).fill("555-0106");
  await create.getByLabel("Contact role").fill("Purchasing manager");
  await create.getByLabel("Industry").selectOption({ label: "Retail" });
  await create.getByLabel("Client status").selectOption("archived");
  await create.getByRole("button", { name: "Add client" }).click();
  await expect(create).toBeHidden();

  const rowButton = page.getByRole("button", { name: new RegExp(originalName) });
  await expect(rowButton).toBeVisible();
  const listed = await page.request.get("/api/v1/clients");
  const rows = (await listed.json() as { clients: Array<Record<string, unknown>> }).clients;
  const created = rows.find((row) => row.name === originalName);
  expect(created).toEqual(expect.objectContaining({
    status: "archived",
    industry: "Retail",
    primary_contact_name: "Create Contact",
    primary_contact_email: "create-contact@example.test",
    primary_contact_phone: "555-0106",
    primary_contact_role: "Purchasing manager",
    version: "1",
    primary_contact_version: "1",
  }));

  await rowButton.click();
  let drawer = page.getByRole("dialog", { name: `${originalName} client account` });
  await expect(drawer.getByText("Purchasing manager", { exact: true })).toBeVisible();
  await expect(drawer.getByText("555-0106", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Edit client" }).click();
  let clientEditor = page.getByRole("dialog", { name: new RegExp("Edit .* client") });
  await expect(clientEditor.getByLabel("Client status")).toHaveValue("archived");
  await expectAccessible(page, ".client-edit-modal");
  await clientEditor.getByLabel("Client business name").fill(updatedName);
  await clientEditor.getByLabel("Industry").selectOption({ label: "Residential" });
  await clientEditor.getByLabel("Client status").selectOption("active");
  await clientEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(clientEditor).toBeHidden();

  drawer = page.getByRole("dialog", { name: `${updatedName} client account` });
  await expect(drawer).toContainText("Residential");
  await expect(drawer).toContainText("Active");
  await drawer.getByRole("button", { name: "Edit primary contact" }).click();
  const contactEditor = page.getByRole("dialog", { name: /Edit primary contact for/ });
  await contactEditor.getByLabel("Primary contact").fill("Updated Contact");
  await contactEditor.getByLabel(/Work email/).fill("updated-contact@example.test");
  await contactEditor.getByLabel(/Contact phone/).fill("555-0196");
  await contactEditor.getByLabel("Contact role").fill("Operations director");
  await contactEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(contactEditor).toBeHidden();

  await drawer.getByRole("button", { name: "Edit client" }).click();
  clientEditor = page.getByRole("dialog", { name: new RegExp("Edit .* client") });
  await clientEditor.getByLabel("Industry").selectOption("");
  await clientEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(clientEditor).toBeHidden();
  await expect(drawer.getByText("Unspecified", { exact: true })).toBeVisible();

  expect(await clientRow(page.request, String(created?.id))).toEqual(expect.objectContaining({
    name: updatedName,
    status: "active",
    industry: null,
    primary_contact_name: "Updated Contact",
    primary_contact_email: "updated-contact@example.test",
    primary_contact_phone: "555-0196",
    primary_contact_role: "Operations director",
    version: "3",
    primary_contact_version: "2",
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.getByRole("button", { name: "Edit primary contact" }).click();
  clientEditor = page.getByRole("dialog", { name: /Edit primary contact for/ });
  await expect(clientEditor).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, ".contact-edit-modal");
});

test("stale client and contact drafts show scoped saved values and require explicit re-apply", async ({ page }) => {
  const suffix = String(Date.now());
  const created = await createClient(page.request, `conflict ${suffix}`);
  const originalName = `FCI TEST — DO NOT USE — EDIT-06 conflict ${suffix}`;
  const peerName = `FCI TEST — DO NOT USE — EDIT-06 peer ${suffix}`;
  const reappliedName = `FCI TEST — DO NOT USE — EDIT-06 reapplied ${suffix}`;

  await page.goto("/clients");
  await page.getByRole("button", { name: new RegExp(originalName) }).click();
  let drawer = page.getByRole("dialog", { name: `${originalName} client account` });
  await drawer.getByRole("button", { name: "Edit client" }).click();
  let editor = page.getByRole("dialog", { name: `Edit ${created.clientCode} client` });
  await editor.getByLabel("Client business name").fill(reappliedName);

  const peer = await page.request.patch(`/api/v1/clients/${created.id}`, {
    headers: { Origin: origin },
    data: { name: peerName, version: "1" },
  });
  expect(peer.status()).toBe(200);
  const clientRequest = page.waitForRequest((request) =>
    request.method() === "PATCH"
    && new URL(request.url()).pathname === `/api/v1/clients/${created.id}`
  );
  await editor.getByRole("button", { name: "Save changes" }).click();
  expect((await clientRequest).postDataJSON()).toEqual({ name: reappliedName, version: "1" });
  await expect(editor.getByRole("alert")).toContainText("changed while you were editing");
  await expect(editor.getByLabel("Client business name")).toHaveValue(reappliedName);
  await expect(editor.getByText(`Saved value: ${peerName}`, { exact: true })).toBeVisible();
  await expect(editor.getByText(/Saved value:/)).toHaveCount(1);
  await editor.getByRole("button", { name: "Re-apply changes" }).click();
  await expect(editor).toBeHidden();

  drawer = page.getByRole("dialog", { name: `${reappliedName} client account` });
  const current = await clientRow(page.request, created.id);
  const contactId = String(current?.primary_contact_id);
  await drawer.getByRole("button", { name: "Edit primary contact" }).click();
  editor = page.getByRole("dialog", { name: `Edit primary contact for ${created.clientCode}` });
  await editor.getByLabel("Primary contact").fill("Reapplied Contact");
  const peerContact = await page.request.patch(`/api/v1/contacts/${contactId}`, {
    headers: { Origin: origin },
    data: { name: "Peer Contact", version: "1" },
  });
  expect(peerContact.status()).toBe(200);
  const contactRequest = page.waitForRequest((request) =>
    request.method() === "PATCH"
    && new URL(request.url()).pathname === `/api/v1/contacts/${contactId}`
  );
  await editor.getByRole("button", { name: "Save changes" }).click();
  expect((await contactRequest).postDataJSON()).toEqual({ name: "Reapplied Contact", version: "1" });
  await expect(editor.getByRole("alert")).toContainText("changed while you were editing");
  await expect(editor.getByLabel("Primary contact")).toHaveValue("Reapplied Contact");
  await expect(editor.getByText("Saved value: Peer Contact", { exact: true })).toBeVisible();
  await expect(editor.getByText(/Saved value:/)).toHaveCount(1);
  await editor.getByRole("button", { name: "Re-apply changes" }).click();
  await expect(editor).toBeHidden();

  expect(await clientRow(page.request, created.id)).toEqual(expect.objectContaining({
    name: reappliedName,
    primary_contact_name: "Reapplied Contact",
    version: "3",
    primary_contact_version: "3",
  }));
});

test("a duplicate client rename stays typed and never enters the CAS re-apply path", async ({ page }) => {
  const suffix = String(Date.now());
  const first = await createClient(page.request, `duplicate first ${suffix}`);
  const firstName = `FCI TEST — DO NOT USE — EDIT-06 duplicate first ${suffix}`;
  const duplicateName = `FCI TEST — DO NOT USE — EDIT-06 duplicate second ${suffix}`;
  await createClient(page.request, `duplicate second ${suffix}`);

  await page.goto("/clients");
  await page.getByRole("button", { name: new RegExp(firstName) }).click();
  const drawer = page.getByRole("dialog", { name: `${firstName} client account` });
  await drawer.getByRole("button", { name: "Edit client" }).click();
  const editor = page.getByRole("dialog", { name: `Edit ${first.clientCode} client` });
  await editor.getByLabel("Client business name").fill(duplicateName);
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByRole("alert")).toHaveText("A client with this business name already exists.");
  await expect(editor.getByRole("button", { name: "Re-apply changes" })).toHaveCount(0);
  await expect(editor.getByText(/Saved value:/)).toHaveCount(0);
  expect(await clientRow(page.request, first.id)).toEqual(expect.objectContaining({
    name: firstName,
    version: "1",
  }));
});
