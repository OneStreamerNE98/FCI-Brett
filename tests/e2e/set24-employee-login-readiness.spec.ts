import { expect, test, type Page } from "@playwright/test";

const REQUIREMENT_NAMES = [
  "FCI_EMPLOYEE_OIDC_CLIENT_ID",
  "FCI_EMPLOYEE_OIDC_CLIENT_SECRET or FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE",
  "FCI_EMPLOYEE_OIDC_REDIRECT_URI",
  "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN",
] as const;

type ConfigurationState = "unconfigured" | "partial" | "ready";

async function mockReadiness(
  page: Page,
  input: Readonly<{
    state: ConfigurationState;
    configured: readonly boolean[];
    pendingInvitationCount: number;
  }>,
) {
  await page.route("**/api/v1/settings/employee-login-readiness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        employeeLogin: {
          configuration: {
            state: input.state,
            configuredCount: input.configured.filter(Boolean).length,
            totalCount: REQUIREMENT_NAMES.length,
            requirements: REQUIREMENT_NAMES.map((name, index) => ({
              name,
              configured: input.configured[index],
            })),
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
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        data: {
          summary: {
            activePeopleCount: 2,
            activeAdministratorCount: 2,
            pendingInvitationCount: input.pendingInvitationCount,
          },
        },
      }),
    });
  });
}

for (const scenario of [
  {
    name: "unconfigured",
    state: "unconfigured" as const,
    configured: [false, false, false, false],
    pendingInvitationCount: 0,
    headline: "Employee login is not configured",
    chip: "Setup required",
    present: 0,
    missing: 4,
    invitationCopy: "0 open invitations",
  },
  {
    name: "partial",
    state: "partial" as const,
    configured: [true, false, true, false],
    pendingInvitationCount: 1,
    headline: "2 of 4 login requirements are present",
    chip: "Setup required",
    present: 2,
    missing: 2,
    invitationCopy: "1 open invitation",
  },
  {
    name: "ready",
    state: "ready" as const,
    configured: [true, true, true, true],
    pendingInvitationCount: 3,
    headline: "Employee-login configuration is present",
    chip: "Configuration ready",
    present: 4,
    missing: 0,
    invitationCopy: "3 open invitations",
  },
] as const) {
  test(`SET-24 renders the ${scenario.name} employee-login state without configuration values`, async ({ page }) => {
    await mockReadiness(page, scenario);
    await page.goto("/settings?section=testing-launch");

    const card = page.getByRole("region", { name: "Employee-login readiness" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("status")).toContainText(scenario.headline);
    await expect(card.getByText(scenario.chip, { exact: true })).toBeVisible();
    await expect(card.getByText("Present", { exact: true })).toHaveCount(scenario.present);
    await expect(card.getByText("Missing", { exact: true })).toHaveCount(scenario.missing);
    await expect(card.getByText(scenario.invitationCopy, { exact: true })).toBeVisible();
    await expect(card.getByText(/Not activated — owner approval/u)).toBeVisible();
    for (const name of REQUIREMENT_NAMES) {
      await expect(card.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(card).not.toContainText("employee-login.apps.googleusercontent.com");
    await expect(card).not.toContainText("test-only-oidc-client-secret");
    await expect(card).not.toContainText("/api/v1/session/google/callback");

    await expect(page.getByRole("region", { name: "What each role can do" })).toContainText("Field link");
    await expect(page.getByRole("region", { name: "Employee session limits" })).toContainText("30-minute idle limit");
    await expect(page.getByRole("region", { name: "Employee session limits" })).toContainText("8-hour absolute limit");
  });
}

test("SET-24 keeps readiness and invitation failures neutral instead of fabricating setup state", async ({ page }) => {
  await page.route("**/api/v1/settings/employee-login-readiness", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "temporary" }),
    });
  });
  await page.route("**/api/v1/admin/access", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "feature_unavailable" }),
    });
  });
  await page.goto("/settings?section=testing-launch");

  const card = page.getByRole("region", { name: "Employee-login readiness" });
  await expect(card.getByRole("status")).toContainText("Employee-login configuration is unavailable");
  await expect(card.getByText("Unavailable", { exact: true })).toHaveCount(5);
  await expect(card.getByText("Setup required", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Missing", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Unavailable until the secure People & Access projection is active.", { exact: true })).toBeVisible();
  await expect(card.getByText("0 open invitations", { exact: true })).toHaveCount(0);
});

test("SET-24 endpoint and card remain absent for an Office user", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  const endpoint = await page.request.get("/api/v1/settings/employee-login-readiness", {
    headers: { "oai-authenticated-user-email": "e2e-office@example.test" },
  });
  expect(endpoint.status()).toBe(403);
  expect(endpoint.headers()["cache-control"]).toBe("no-store");

  await page.goto("/settings?section=testing-launch");
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByRole("heading", { level: 2, name: "My settings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Employee-login readiness" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "What each role can do" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Employee session limits" })).toHaveCount(0);
});
