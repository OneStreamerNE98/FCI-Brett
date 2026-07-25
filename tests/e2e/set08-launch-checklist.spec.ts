import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = "e2e-admin@example.test";
const FIXED_CHECKED_AT = 1_722_000_000_000;
const ITEM_IDS = [
  "test-records-only",
  "records-survive-reload",
  "gmail-review-first",
  "assistant-citations-opened",
] as const;

type ItemId = typeof ITEM_IDS[number];
type Attestation = {
  checked: boolean;
  actorEmail: string | null;
  checkedAt: number | null;
};

type WorkspaceStatusFixture = {
  connected: boolean;
  workspace: {
    connectionStatus: string;
    calendarEnabled: boolean;
    calendarConnected: boolean;
  };
};

type MirrorStatusFixture = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  clients: { status: string };
  projects: { status: string };
};

function emptyChecklist(): Record<ItemId, Attestation> {
  return Object.fromEntries(ITEM_IDS.map((itemId) => [itemId, {
    checked: false,
    actorEmail: null,
    checkedAt: null,
  }])) as Record<ItemId, Attestation>;
}

async function mockLaunchSurface(page: Page, canAttest = true) {
  const state = emptyChecklist();
  const mutationBodies: unknown[] = [];
  const workspaceStatus: WorkspaceStatusFixture = {
    connected: true,
    workspace: {
      connectionStatus: "connected",
      calendarEnabled: true,
      calendarConnected: true,
    },
  };
  const mirrorStatus: MirrorStatusFixture = {
    configured: true,
    enabled: true,
    connected: true,
    clients: { status: "synced" },
    projects: { status: "synced" },
  };

  await page.route("**/api/v1/settings/launch-checklist", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        itemId: ItemId;
        checked: boolean;
      };
      mutationBodies.push(body);
      state[body.itemId] = body.checked
        ? {
            checked: true,
            actorEmail: ADMIN_EMAIL,
            checkedAt: FIXED_CHECKED_AT,
          }
        : {
            checked: false,
            actorEmail: null,
            checkedAt: null,
          };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        launchChecklist: state,
        canAttest,
        updatedAt: FIXED_CHECKED_AT,
      }),
    });
  });
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(workspaceStatus),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        mirror: mirrorStatus,
      }),
    });
  });
  await page.route("**/api/v1/settings/employee-login-readiness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        employeeLogin: {
          configuration: {
            state: "unconfigured",
            configuredCount: 0,
            totalCount: 4,
            requirements: [
              "FCI_EMPLOYEE_OIDC_CLIENT_ID",
              "FCI_EMPLOYEE_OIDC_CLIENT_SECRET or FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE",
              "FCI_EMPLOYEE_OIDC_REDIRECT_URI",
              "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN",
            ].map((name) => ({ name, configured: false })),
          },
          activationGate: {
            state: "owner-approval-required",
            active: false,
          },
        },
      }),
    });
  });
  await page.route("**/api/v1/admin/access", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          summary: {
            activePeopleCount: 1,
            activeAdministratorCount: 1,
            pendingInvitationCount: 0,
          },
        },
      }),
    });
  });

  return { state, mutationBodies, workspaceStatus, mirrorStatus };
}

test("SET-08 separates live verification from persisted Administrator attestations", async ({ page }) => {
  const { mutationBodies } = await mockLaunchSurface(page);
  await page.goto("/settings?section=testing-launch");

  const card = page.getByRole("region", { name: "Test & launch checklist" });
  await expect(card).toBeVisible();
  await expect(card.getByText("3 of 3 verified", { exact: true })).toBeVisible();
  await expect(card.locator('[data-checklist-kind="verified"]')).toHaveCount(3);
  await expect(card.locator('[data-checklist-kind="verified"] input')).toHaveCount(0);
  await expect(card.locator('[data-checklist-kind="attested"]')).toHaveCount(4);
  await expect(card.getByRole("checkbox")).toHaveCount(4);

  const testRecords = card.getByRole("checkbox", {
    name: /Only FCI TEST — DO NOT USE records were used/u,
  });
  await expect(testRecords).not.toBeChecked();
  // The controlled checkbox changes only after the server-confirmed response,
  // so click and then assert the persisted state instead of requiring an
  // immediate native check-state transition.
  await testRecords.click();
  await expect(testRecords).toBeChecked();
  await expect(card.getByText(new RegExp(`Checked by ${ADMIN_EMAIL} on`, "u"))).toBeVisible();
  expect(mutationBodies).toEqual([{
    itemId: "test-records-only",
    checked: true,
  }]);
  expect(mutationBodies[0]).not.toHaveProperty("actorEmail");
  expect(mutationBodies[0]).not.toHaveProperty("checkedAt");

  await page.reload();
  const reloaded = page.getByRole("region", { name: "Test & launch checklist" });
  await expect(reloaded.getByRole("checkbox", {
    name: /Only FCI TEST — DO NOT USE records were used/u,
  })).toBeChecked();
  await expect(reloaded.getByText(new RegExp(`Checked by ${ADMIN_EMAIL} on`, "u"))).toBeVisible();
  await expect(reloaded.getByText(
    "This is the development checklist. Production acceptance stays in checklist 05 and is not completed in this app.",
    { exact: true },
  )).toBeVisible();
});

test("SET-08 keeps failed live reads neutral instead of showing a VERIFIED state", async ({ page }) => {
  await mockLaunchSurface(page);
  await page.unroute("**/api/v1/google-workspace");
  await page.unroute("**/api/v1/integrations/google/sheets/status");
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.goto("/settings?section=testing-launch");

  const card = page.getByRole("region", { name: "Test & launch checklist" });
  await expect(card.getByText("0 of 3 verified", { exact: true })).toBeVisible();
  await expect(card.locator('[data-checklist-kind="verified"]').getByText("Unavailable", { exact: true })).toHaveCount(3);
  await expect(card.locator('[data-checklist-kind="verified"]').getByText("Verified", { exact: true })).toHaveCount(0);
});

test("SET-08 requires every partial Calendar and mirror readiness predicate", async ({ page }) => {
  const { workspaceStatus, mirrorStatus } = await mockLaunchSurface(page);
  const resetReadyStatus = () => {
    workspaceStatus.connected = true;
    workspaceStatus.workspace.connectionStatus = "connected";
    workspaceStatus.workspace.calendarEnabled = true;
    workspaceStatus.workspace.calendarConnected = true;
    mirrorStatus.configured = true;
    mirrorStatus.enabled = true;
    mirrorStatus.connected = true;
    mirrorStatus.clients.status = "synced";
    mirrorStatus.projects.status = "synced";
  };
  const scenarios: ReadonlyArray<{
    name: string;
    rowLabel: string;
    makePartial: () => void;
  }> = [
    {
      name: "Calendar enabled",
      rowLabel: "Calendar access verified",
      makePartial: () => { workspaceStatus.workspace.calendarEnabled = false; },
    },
    {
      name: "Calendar connected",
      rowLabel: "Calendar access verified",
      makePartial: () => { workspaceStatus.workspace.calendarConnected = false; },
    },
    {
      name: "Mirror configured",
      rowLabel: "Client Directory mirror synced",
      makePartial: () => { mirrorStatus.configured = false; },
    },
    {
      name: "Mirror enabled",
      rowLabel: "Client Directory mirror synced",
      makePartial: () => { mirrorStatus.enabled = false; },
    },
    {
      name: "Mirror connected",
      rowLabel: "Client Directory mirror synced",
      makePartial: () => { mirrorStatus.connected = false; },
    },
    {
      name: "Client mirror synced",
      rowLabel: "Client Directory mirror synced",
      makePartial: () => { mirrorStatus.clients.status = "pending"; },
    },
    {
      name: "Project mirror synced",
      rowLabel: "Client Directory mirror synced",
      makePartial: () => { mirrorStatus.projects.status = "pending"; },
    },
  ];

  for (const scenario of scenarios) {
    resetReadyStatus();
    scenario.makePartial();
    await page.goto("/settings?section=testing-launch");

    const card = page.getByRole("region", { name: "Test & launch checklist" });
    const row = card.locator('[data-checklist-kind="verified"]').filter({
      hasText: scenario.rowLabel,
    });
    await expect(row, scenario.name).toContainText("Needs verification");
    await expect(card.getByText("2 of 3 verified", { exact: true }), scenario.name).toBeVisible();
  }
});

test("SET-08 labels a simulated environment honestly instead of Verified", async ({ page }) => {
  await mockLaunchSurface(page);
  await page.unroute("**/api/v1/google-workspace");
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        workspace: {
          connectionStatus: "connected",
          calendarEnabled: true,
          calendarConnected: true,
          simulation: true,
        },
      }),
    });
  });
  await page.goto("/settings?section=testing-launch");

  const card = page.getByRole("region", { name: "Test & launch checklist" });
  await expect(card).toBeVisible();
  const verifiedRows = card.locator('[data-checklist-kind="verified"]');
  await expect(verifiedRows).toHaveCount(3);
  // All three live rows (workspace, calendar, and the app-global mirror) render
  // the honest Simulated state, never a real Google connection.
  await expect(verifiedRows.getByText("Simulated", { exact: true })).toHaveCount(3);
  await expect(card.getByText("Verified", { exact: true })).toHaveCount(0);
  await expect(card.getByText("3 of 3 verified", { exact: true })).toHaveCount(0);
  await expect(card.getByText(
    "Simulated environment — live verification runs against a real Workspace connection.",
    { exact: true },
  )).toBeVisible();
  // The persisted Administrator attestations are untouched by simulation mode.
  await expect(card.getByRole("checkbox")).toHaveCount(4);
});

test("SET-08 renders a canAttest:false response read-only without mutation traffic", async ({ page }) => {
  const { mutationBodies } = await mockLaunchSurface(page, false);
  await page.goto("/settings?section=testing-launch");

  const card = page.getByRole("region", { name: "Test & launch checklist" });
  await expect(card.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(card.locator('[data-checklist-kind="attested"]')).toHaveCount(4);
  await expect(card.getByRole("checkbox")).toHaveCount(4);
  for (const checkbox of await card.getByRole("checkbox").all()) {
    await expect(checkbox).toBeDisabled();
  }
  await expect(card.getByText("Not yet attested", { exact: true })).toHaveCount(4);
  expect(mutationBodies).toEqual([]);
});

test("FIX-17 keeps in-flight attestation reads indeterminate until server truth arrives", async ({ page }) => {
  await mockLaunchSurface(page);
  await page.unroute("**/api/v1/settings/launch-checklist");

  let releaseRead!: () => void;
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.route("**/api/v1/settings/launch-checklist", async (route) => {
    await readReleased;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        launchChecklist: emptyChecklist(),
        canAttest: true,
        updatedAt: FIXED_CHECKED_AT,
      }),
    });
  });

  await page.goto("/settings?section=testing-launch");
  const card = page.getByRole("region", { name: "Test & launch checklist" });
  const attestationRows = card.locator('[data-checklist-kind="attested"]');
  await expect(attestationRows).toHaveCount(4);
  await expect(attestationRows.getByText("Checking saved attestation", { exact: true })).toHaveCount(4);
  await expect(attestationRows.getByText("Checking", { exact: true })).toHaveCount(4);
  await expect(attestationRows.getByText("Not yet attested", { exact: true })).toHaveCount(0);
  await expect(attestationRows.getByText("Not attested", { exact: true })).toHaveCount(0);
  await expect.poll(() => attestationRows.locator('input[type="checkbox"]').evaluateAll(
    (inputs) => inputs.every((input) => (input as HTMLInputElement).indeterminate),
  )).toBe(true);

  releaseRead();
  await expect(attestationRows.getByText("Not yet attested", { exact: true })).toHaveCount(4);
  await expect(attestationRows.getByText("Not attested", { exact: true })).toHaveCount(4);
  await expect.poll(() => attestationRows.locator('input[type="checkbox"]').evaluateAll(
    (inputs) => inputs.every((input) => !(input as HTMLInputElement).indeterminate),
  )).toBe(true);
});

test("FIX-17 keeps failed attestation reads unavailable instead of fabricating negatives", async ({ page }) => {
  await mockLaunchSurface(page);
  await page.unroute("**/api/v1/settings/launch-checklist");
  await page.route("**/api/v1/settings/launch-checklist", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: "{}",
    });
  });

  await page.goto("/settings?section=testing-launch");
  const card = page.getByRole("region", { name: "Test & launch checklist" });
  const attestationRows = card.locator('[data-checklist-kind="attested"]');
  await expect(card.getByRole("alert")).toContainText("Saved attestations are unavailable. Nothing was changed.");
  await expect(attestationRows.getByText("Saved attestation unavailable", { exact: true })).toHaveCount(4);
  await expect(attestationRows.getByText("Unavailable", { exact: true })).toHaveCount(4);
  await expect(attestationRows.getByText("Not yet attested", { exact: true })).toHaveCount(0);
  await expect(attestationRows.getByText("Not attested", { exact: true })).toHaveCount(0);
  await expect.poll(() => attestationRows.locator('input[type="checkbox"]').evaluateAll(
    (inputs) => inputs.every((input) => (input as HTMLInputElement).indeterminate),
  )).toBe(true);
});
