import { expect, test, type Locator, type Page } from "@playwright/test";

const appointmentHint = "How many hours ahead a reminder is planned to go out. Saved now; reminder sending is not built yet.";
const clientHint = "Hours before a client appointment a reminder is planned to send. Saved as a default; sending is not built yet.";
const crewHint = "Hours before a scheduled field day a crew reminder is planned to send. Saved as a default; sending is not built yet.";
const matchHint = "Describe the email in plain words. This is saved as a review-first note; automatic matching is not applied yet.";
const actionHint = "Suggest proposes a project, Send to review holds it for a person, Ignore skips it. Filing always needs approval.";

const workspaceSettings = {
  timezone: "America/New_York",
  appointmentCalendarName: "FCI • Client Appointments",
  fieldCalendarName: "FCI • Field Schedule",
  calendarSetupMode: "create-shared",
  appointmentCalendarId: "",
  fieldCalendarId: "",
  calendarEditPolicy: "app-authoritative",
  appointmentReminderHours: 24,
  clientReminderHours: 36,
  crewReminderHours: 18,
  inboxReviewMode: "review-first",
  officeNotificationEmail: "",
};

async function expectAuditedHint(trigger: Locator, page: Page, text: string) {
  await expect(trigger).toHaveCount(1);
  const descriptionId = await trigger.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  const tooltip = page.locator(`[id="${descriptionId}"]`);
  await expect(tooltip).toHaveAttribute("role", "tooltip");
  await expect(tooltip).toHaveText(text);
  await expect(tooltip).toBeHidden();

  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  return { descriptionId: descriptionId!, tooltip };
}

async function mockWorkspaceDefaults(page: Page) {
  await page.route("**/api/v1/settings/workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings: workspaceSettings, updatedAt: null }),
    });
  });
  await page.route("**/api/v1/google-workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          calendarConnected: false,
          calendarEnabled: false,
          connectionStatus: "disconnected",
        },
      }),
    });
  });
}

test("the three independently persisted reminder fields expose audited keyboard hints", async ({ page }) => {
  await mockWorkspaceDefaults(page);
  await page.goto("/settings?section=calendar");

  const appointment = await expectAuditedHint(
    page.getByRole("button", { name: "About appointment reminder hours", exact: true }),
    page,
    appointmentHint,
  );
  await expect(page.getByRole("spinbutton", { name: "Appointment reminder hours" })).toHaveValue("24");

  await page.locator(".settings-nav").getByRole("button", { name: "Workflow & notifications", exact: true }).click();
  const client = await expectAuditedHint(
    page.getByRole("button", { name: "About client reminder hours", exact: true }),
    page,
    clientHint,
  );
  const crew = await expectAuditedHint(
    page.getByRole("button", { name: "About crew reminder hours", exact: true }),
    page,
    crewHint,
  );
  await expect(page.getByRole("spinbutton", { name: "Client reminder hours" })).toHaveValue("36");
  await expect(page.getByRole("spinbutton", { name: "Crew reminder hours" })).toHaveValue("18");

  expect(new Set([appointment.descriptionId, client.descriptionId, crew.descriptionId]).size).toBe(3);
  const mountedDescriptionIds = await page.locator(".settings-form-panel .info-hint-trigger").evaluateAll((triggers) => (
    triggers.map((trigger) => trigger.getAttribute("aria-describedby"))
  ));
  expect(mountedDescriptionIds).toHaveLength(2);
  expect(mountedDescriptionIds.every(Boolean)).toBe(true);
  expect(new Set(mountedDescriptionIds).size).toBe(mountedDescriptionIds.length);
});

test.describe("RuleModal audited hints at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("focus and Escape dismiss each hint before the modal, with unique contained tooltips", async ({ page }) => {
    await page.goto("/settings?section=inbox-rules");
    await expect(page.getByText("Loading live records", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "Live records could not be loaded" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add rule", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add an email filing rule", exact: true });
    await expect(dialog).toBeVisible();

    const match = await expectAuditedHint(
      dialog.getByRole("button", { name: "About when this matches", exact: true }),
      page,
      matchHint,
    );
    await expect(dialog).toBeVisible();
    const action = await expectAuditedHint(
      dialog.getByRole("button", { name: "About rule action", exact: true }),
      page,
      actionHint,
    );
    await expect(dialog).toBeVisible();
    expect(match.descriptionId).not.toBe(action.descriptionId);

    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    for (const [label, text] of [
      ["About when this matches", matchHint],
      ["About rule action", actionHint],
    ] as const) {
      const trigger = dialog.getByRole("button", { name: label, exact: true });
      const descriptionId = await trigger.getAttribute("aria-describedby");
      await trigger.focus();
      const tooltip = page.locator(`[id="${descriptionId}"]`);
      await expect(tooltip).toHaveText(text);
      await expect(tooltip).toBeVisible();
      const tooltipBox = await tooltip.boundingBox();
      expect(tooltipBox).not.toBeNull();
      expect((tooltipBox?.x ?? -1) + 0.5).toBeGreaterThanOrEqual(dialogBox?.x ?? 0);
      expect((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)).toBeLessThanOrEqual(
        (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) + 0.5,
      );
      expect(tooltipBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)).toBeLessThanOrEqual(390);
      await page.keyboard.press("Escape");
      await expect(tooltip).toBeHidden();
      await expect(dialog).toBeVisible();
    }

    await dialog.getByRole("textbox", { name: "Rule name" }).focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
