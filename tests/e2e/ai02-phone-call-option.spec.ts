import { expect, test } from "@playwright/test";
import path from "node:path";

const projectName = "E2E Mobile Metadata Project";
const projectNumber = "CF-2026-E2E00001";
const projectButtonName = `Open project ${projectNumber}: ${projectName}`;
const evidenceDirectory = process.env.AI02C_EVIDENCE_DIR;

const expectedMeetingTypes = [
  { value: "client", label: "Client meeting" },
  { value: "site-walk", label: "Site walk" },
  { value: "internal", label: "Internal huddle" },
  { value: "pre-install", label: "Pre-install meeting" },
  { value: "closeout", label: "Closeout review" },
  { value: "phone-call", label: "Phone call" },
  { value: "other", label: "Other" },
];

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`Meeting type offers Phone call without changing the default at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/projects");
    await page.getByRole("button", { name: projectButtonName, exact: true }).click();

    const projectDrawer = page.getByRole("dialog", {
      name: `${projectNumber} ${projectName}`,
      exact: true,
    });
    await projectDrawer.getByRole("button", { name: "Meetings", exact: true }).click();
    await projectDrawer.getByRole("button", { name: "Add meeting", exact: true }).click();

    const meetingDialog = page.getByRole("dialog", {
      name: `Capture meeting notes for ${projectNumber}`,
      exact: true,
    });
    const meetingType = meetingDialog.getByRole("combobox", { name: "Meeting type", exact: true });
    await expect(meetingDialog).toBeVisible();
    await expect(meetingType).toHaveValue("client");
    await expect(meetingType.locator("option")).toHaveCount(expectedMeetingTypes.length);
    expect(await meetingType.locator("option").evaluateAll((options) => options.map((option) => ({
      value: (option as HTMLOptionElement).value,
      label: option.textContent,
    })))).toEqual(expectedMeetingTypes);

    await meetingType.selectOption("phone-call");
    await expect(meetingType).toHaveValue("phone-call");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (evidenceDirectory) {
      await page.screenshot({
        path: path.join(evidenceDirectory, `ai-02c-phone-call-${viewport.width}.png`),
      });
    }
  });
}
