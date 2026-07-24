import { expect, test } from "@playwright/test";

const ACCESS_ROUTE = "**/api/v1/settings/development-access";

test("SET-36 renders configured development identifiers exactly for an Administrator", async ({ page }) => {
  await page.route(ACCESS_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        officeEmails: ["Owner@Example.TEST", "office@example.test"],
        officeDomains: ["Example.COM", "@Partner.Test"],
        adminEmails: ["Owner@Example.TEST", "backup-admin@example.test"],
      }),
    });
  });

  await page.goto("/settings?section=data-security");

  await expect(page.getByRole("heading", { level: 2, name: "Who has access" })).toBeVisible();
  const identifiers = page.getByRole("list", { name: "Configured development access identifiers" });
  await expect(identifiers.getByRole("listitem")).toHaveCount(3);
  await expect(identifiers.getByRole("listitem").nth(0)).toContainText("Owner@Example.TEST, office@example.test");
  await expect(identifiers.getByRole("listitem").nth(1)).toContainText("Example.COM, @Partner.Test");
  await expect(identifiers.getByRole("listitem").nth(2)).toContainText("Owner@Example.TEST, backup-admin@example.test");
  await expect(page.getByText("Maintain these identifiers in hosting configuration. When live Google login is activated, manage people and roles in People & Access.")).toBeVisible();
  await expect(page.getByText("Office access is not configured — the app denies everyone")).toHaveCount(0);
});

test("SET-36 renders the exact fail-closed empty state when both office allowlists are empty", async ({ page }) => {
  await page.route(ACCESS_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        officeEmails: [],
        officeDomains: [],
        adminEmails: ["local-admin@example.test"],
      }),
    });
  });

  await page.goto("/settings?section=data-security");

  await expect(page.getByText("Office access is not configured — the app denies everyone", { exact: true })).toBeVisible();
  await expect(page.getByText("local-admin@example.test", { exact: true })).toBeVisible();
});

test("SET-36 never renders or requests the card for a non-Administrator", async ({ page }) => {
  let accessRequests = 0;
  await page.route(ACCESS_ROUTE, async (route) => {
    accessRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        officeEmails: ["should-never-render@example.test"],
        officeDomains: [],
        adminEmails: [],
      }),
    });
  });
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });

  await page.goto("/settings?section=data-security");

  await expect(page.getByRole("heading", { level: 2, name: "My settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Who has access" })).toHaveCount(0);
  await expect(page.getByText("should-never-render@example.test", { exact: true })).toHaveCount(0);
  expect(accessRequests).toBe(0);
});
