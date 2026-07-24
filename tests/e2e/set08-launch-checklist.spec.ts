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
      body: JSON.stringify({
        connected: true,
        workspace: {
          connectionStatus: "connected",
          calendarEnabled: true,
          calendarConnected: true,
        },
      }),
    });
  });
  await page.route("**/api/v1/integrations/google/sheets/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        mirror: {
          configured: true,
          enabled: true,
          connected: true,
          clients: { status: "synced" },
          projects: { status: "synced" },
        },
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

  return { state, mutationBodies };
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

test("SET-08 renders the non-admin checklist projection read-only without mutation traffic", async ({ page }) => {
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
