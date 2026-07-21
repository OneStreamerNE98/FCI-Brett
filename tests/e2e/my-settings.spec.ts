import { expect, test } from "@playwright/test";

const defaultNotificationPreferences = {
  "lead.created": false,
  "gmail.filing_review_needed": false,
  "calendar.schedule_changed": false,
  "project.warranty_follow_up_due": false,
};

type StoredPreferences = {
  displayTimezone: string;
  replySignature: string;
  notificationPreferences: typeof defaultNotificationPreferences;
};

async function readStoredPreferences(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/settings/me", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Could not read My settings (${response.status}).`);
    const payload = await response.json() as { preferences: StoredPreferences };
    return payload.preferences;
  });
}

async function restoreStoredPreferences(page: import("@playwright/test").Page, preferences: StoredPreferences) {
  await page.evaluate(async (nextPreferences) => {
    const response = await fetch("/api/v1/settings/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextPreferences),
    });
    if (!response.ok) throw new Error(`Could not restore My settings (${response.status}).`);
  }, preferences);
}

test("simulation user edits, persists, and reloads a personal preference without activating planned consumers", async ({ page }) => {
  test.skip(process.env.FCI_E2E_EXTERNAL_SERVER === "true", "Persistence requires the isolated local simulation database.");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 2, name: "My settings" })).toBeVisible();
  const originalPreferences = await readStoredPreferences(page);

  try {
    const timezone = page.getByLabel("My display timezone");
    const signature = page.getByLabel("Default reply signature");
    const newLeads = page.getByRole("checkbox", { name: /New leads/u });
    const plannedRows = page.locator('[data-preference-consumer="planned"]');

    await timezone.selectOption("America/Chicago");
    await signature.fill("SET-28 simulation signature");
    await newLeads.setChecked(true);

    await expect(plannedRows).toHaveCount(4);
    await expect(plannedRows.locator(".feature-state-planned")).toHaveCount(4);
    await expect(plannedRows).toContainText(["Planned", "Planned", "Planned", "Planned"]);

    await page.getByRole("button", { name: "Save my settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "My settings are saved" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "My settings" })).toBeVisible();
    await expect(page.getByLabel("My display timezone")).toHaveValue("America/Chicago");
    await expect(page.getByLabel("Default reply signature")).toHaveValue("SET-28 simulation signature");
    await expect(page.getByRole("checkbox", { name: /New leads/u })).toBeChecked();
    await expect(page.locator('[data-preference-consumer="planned"]')).toHaveCount(4);
    await expect(page.locator('[data-preference-consumer="planned"] .feature-state-planned')).toHaveCount(4);
  } finally {
    await restoreStoredPreferences(page, originalPreferences);
  }
});

test("planned notification rendering is invariant across every saved boolean value", async ({ page }) => {
  let notificationPreferences = { ...defaultNotificationPreferences };
  await page.route("**/api/v1/settings/me", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as StoredPreferences;
      notificationPreferences = body.notificationPreferences;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preferences: {
          displayTimezone: "America/New_York",
          replySignature: "",
          notificationPreferences,
        },
        updatedAt: null,
        isAdmin: true,
      }),
    });
  });

  await page.goto("/settings");
  const rows = page.locator('[data-preference-consumer="planned"]');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator(".feature-state-planned")).toHaveCount(4);

  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await page.getByRole("button", { name: "Save my settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "My settings are saved" })).toBeVisible();

  await expect(rows).toHaveCount(4);
  await expect(rows.locator(".feature-state-planned")).toHaveCount(4);
  await expect(rows).toContainText(["Planned", "Planned", "Planned", "Planned"]);
});
