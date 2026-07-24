import { expect, test } from "@playwright/test";

const plannedCopy = "Saved for the upcoming reminder worker — nothing sends yet";
const initialSettings = {
  timezone: "America/New_York",
  appointmentCalendarName: "FCI • Client Appointments",
  fieldCalendarName: "FCI • Field Schedule",
  calendarSetupMode: "create-shared" as const,
  appointmentCalendarId: "",
  fieldCalendarId: "",
  calendarEditPolicy: "app-authoritative" as const,
  appointmentReminderHours: 24,
  clientReminderHours: 24,
  crewReminderHours: 24,
  inboxReviewMode: "review-first" as const,
  officeNotificationEmail: "",
};

test("planned reminder defaults stay editable and appointment/client hours round-trip independently", async ({ page }) => {
  let savedSettings = { ...initialSettings };
  const patchBodies: Array<typeof initialSettings> = [];

  await page.route("**/api/v1/settings/workspace", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings: savedSettings, updatedAt: null }),
      });
      return;
    }
    if (route.request().method() === "PATCH") {
      savedSettings = { ...savedSettings, ...(route.request().postDataJSON() as typeof initialSettings) };
      patchBodies.push({ ...savedSettings });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings: savedSettings, updatedAt: 1_800_000_000_000 }),
      });
      return;
    }
    await route.continue();
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

  await page.goto("/settings?section=calendar");
  const appointmentHours = page.getByRole("spinbutton", { name: "Appointment reminder hours" });
  await expect(appointmentHours).toHaveValue("24");
  const appointmentField = page.locator('[data-setting-consumer="planned"]').filter({ has: appointmentHours });
  await expect(appointmentField.getByText("Planned", { exact: true })).toBeVisible();
  await expect(appointmentField.getByText(plannedCopy, { exact: true })).toBeVisible();
  await appointmentHours.fill("6");
  await page.getByRole("button", { name: "Save calendar plan" }).click();
  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies[0]).toMatchObject({
    appointmentReminderHours: 6,
    clientReminderHours: 24,
  });

  await page.locator(".settings-nav").getByRole("button", { name: "Workflow & notifications", exact: true }).click();
  const clientHours = page.getByRole("spinbutton", { name: "Client reminder hours" });
  const crewHours = page.getByRole("spinbutton", { name: "Crew reminder hours" });
  const officeEmail = page.getByRole("textbox", { name: "Office notification email" });
  await expect(clientHours).toHaveValue("24");
  await expect(page.locator('[data-setting-consumer="planned"]')).toHaveCount(3);
  await expect(page.getByText(plannedCopy, { exact: true })).toHaveCount(3);
  await clientHours.fill("36");
  await crewHours.fill("18");
  await officeEmail.fill("office@example.test");
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect.poll(() => patchBodies.length).toBe(2);
  expect(patchBodies[1]).toMatchObject({
    appointmentReminderHours: 6,
    clientReminderHours: 36,
    crewReminderHours: 18,
    officeNotificationEmail: "office@example.test",
  });

  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Client reminder hours" })).toHaveValue("36");
  await expect(page.getByRole("spinbutton", { name: "Crew reminder hours" })).toHaveValue("18");
  await expect(page.getByRole("textbox", { name: "Office notification email" })).toHaveValue("office@example.test");
  await page.locator(".settings-nav").getByRole("button", { name: "Calendar & appointments", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Appointment reminder hours" })).toHaveValue("6");
});
