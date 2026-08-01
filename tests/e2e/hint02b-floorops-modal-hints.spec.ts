import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const leadEstimatedValueHint = "Your rough estimate of the job's size before it's quoted. Feeds pipeline totals; it is not a committed contract amount.";
const clientStatusHint = "Active is a current working account, Prospect is not yet won, Inactive is dormant or closed.";
const projectStatusHint = "Planning is pre-work, Mobilizing is readying crews and materials, Installation is the active install, Closeout is punch list and wrap-up.";
const projectFlooringCategoryHint = "The main material for this job. Use Specialty for niche products and Mixed when no single category dominates.";
const projectEstimatedValueHint = "Expected job value before booking. If a contract value is later recorded, reporting prefers that figure.";

type HintExpectation = Readonly<{
  label: string;
  text: string;
  resolvedAnchor: "left" | "right";
}>;

type ModalExpectation = Readonly<{
  path: string;
  pageHeading: string;
  openButton: string;
  dialogName: string;
  alignedControlPairs: readonly (readonly [string, string])[];
  hints: readonly HintExpectation[];
}>;

const auditedModals: readonly ModalExpectation[] = [
  {
    path: "/leads",
    pageHeading: "Leads & opportunities",
    openButton: "Add lead",
    dialogName: "Add a lead",
    alignedControlPairs: [['input[name="value"]', 'input[name="site"]']],
    hints: [
      { label: "Lead value help", text: leadEstimatedValueHint, resolvedAnchor: "left" },
    ],
  },
  {
    path: "/clients",
    pageHeading: "Clients",
    openButton: "Add client",
    dialogName: "Add a client",
    alignedControlPairs: [['select[name="industry"]', 'select[name="status"]']],
    hints: [
      { label: "Client lifecycle help", text: clientStatusHint, resolvedAnchor: "right" },
    ],
  },
  {
    path: "/projects",
    pageHeading: "Projects",
    openButton: "New project",
    dialogName: "Create a project",
    alignedControlPairs: [
      ['select[name="status"]', 'input[name="value"]'],
      ['select[name="flooringCategory"]', 'input[name="squareFeet"]'],
    ],
    hints: [
      { label: "Project phase help", text: projectStatusHint, resolvedAnchor: "left" },
      { label: "Flooring selection help", text: projectFlooringCategoryHint, resolvedAnchor: "left" },
      { label: "Project value help", text: projectEstimatedValueHint, resolvedAnchor: "right" },
    ],
  },
];

async function expectAuditedHint(
  trigger: Locator,
  dialog: Locator,
  page: Page,
  text: string,
) {
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

  const dialogBox = await dialog.boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox?.x ?? -1).toBeGreaterThanOrEqual((dialogBox?.x ?? 0) - 0.5);
  expect((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)).toBeLessThanOrEqual(
    (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) + 0.5,
  );
  expect(tooltipBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)).toBeLessThanOrEqual(390);

  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();
  return descriptionId!;
}

async function expectNoSeriousAxeViolations(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

async function openAuditedModal(page: Page, modalExpectation: ModalExpectation) {
  await page.goto(modalExpectation.path);
  await expect(page.getByRole("heading", { level: 1, name: modalExpectation.pageHeading })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Loading live records" })).toHaveCount(0);
  const openButton = page.getByRole("button", { name: modalExpectation.openButton, exact: true });
  await expect(openButton).toBeVisible();
  await expect(openButton).toBeEnabled();
  await openButton.click();

  const dialog = page.getByRole("dialog", { name: modalExpectation.dialogName, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("HINT-02-B FloorOps modal hints", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("at 390px the five audited hints keep exact copy, unique descriptions, focus/Escape behavior, containment, and axe coverage", async ({ page }) => {
    for (const modalExpectation of auditedModals) {
      const dialog = await openAuditedModal(page, modalExpectation);
      await expect(dialog.locator(".info-hint-trigger")).toHaveCount(modalExpectation.hints.length);
      if (modalExpectation.dialogName === "Add a lead") {
        await expect(
          dialog.getByRole("button", { name: "Lead value help", exact: true }),
        ).toHaveAccessibleDescription(leadEstimatedValueHint);
      }

      const descriptionIds = [];
      for (const hint of modalExpectation.hints) {
        descriptionIds.push(await expectAuditedHint(
          dialog.getByRole("button", { name: hint.label, exact: true }),
          dialog,
          page,
          hint.text,
        ));
      }
      expect(new Set(descriptionIds).size).toBe(descriptionIds.length);

      await expectNoSeriousAxeViolations(page, ".accessible-overlay-panel");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
  });

  test("at 390px a hover-opened lead hint consumes Escape before the modal closes", async ({ page }) => {
    const dialog = await openAuditedModal(page, auditedModals[0]);
    const clientCompany = dialog.getByRole("textbox", { name: "Client company", exact: true });
    const trigger = dialog.getByRole("button", { name: "Lead value help", exact: true });
    const descriptionId = await trigger.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    const tooltip = page.locator(`[id="${descriptionId}"]`);

    await clientCompany.focus();
    await expect(clientCompany).toBeFocused();
    await trigger.hover();
    await expect(tooltip).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(clientCompany).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("desktop auto anchors resolve left-column hints left and keep right-column hints right", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    for (const modalExpectation of auditedModals) {
      const dialog = await openAuditedModal(page, modalExpectation);
      for (const hint of modalExpectation.hints) {
        const trigger = dialog.getByRole("button", { name: hint.label, exact: true });
        const hintContainer = trigger.locator("..");
        await trigger.focus();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        if (hint.resolvedAnchor === "left") {
          await expect(hintContainer).toHaveClass(/info-hint-anchor-left/u);
        } else {
          await expect(hintContainer).not.toHaveClass(/info-hint-anchor-left/u);
        }
        await page.keyboard.press("Escape");
      }
      for (const [leftSelector, rightSelector] of modalExpectation.alignedControlPairs) {
        const [leftBox, rightBox] = await Promise.all([
          dialog.locator(leftSelector).boundingBox(),
          dialog.locator(rightSelector).boundingBox(),
        ]);
        expect(leftBox).not.toBeNull();
        expect(rightBox).not.toBeNull();
        expect(Math.abs((leftBox?.y ?? 0) - (rightBox?.y ?? 0))).toBeLessThanOrEqual(0.5);
      }

      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  });
});
