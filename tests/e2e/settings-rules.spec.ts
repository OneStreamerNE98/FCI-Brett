import { expect, test } from "@playwright/test";

const ruleName = "FCI TEST — DO NOT USE — Review project number";
const ruleFixture = {
  id: "fci-test-rule",
  name: ruleName,
  enabled: true,
  priority: 8,
  matchSummary: "Subject contains an exact project number",
  action: "review",
  targetCategory: "99_Unsorted Intake",
  approvalRequired: true,
};

test("Inbox rules use a responsive semantic table and retain keyboard actions", async ({ page }) => {
  const browserIssues: string[] = [];
  let patchBody: unknown;
  let deleteRequests = 0;

  page.on("console", (message) => {
    if (message.type() === "error") browserIssues.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserIssues.push(`pageerror: ${error.stack ?? error.message}`));

  await page.route("**/api/v1/filing-rules**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/v1/filing-rules" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [ruleFixture] }) });
      return;
    }
    if (pathname === "/api/v1/filing-rules/fci-test-rule" && request.method() === "PATCH") {
      patchBody = request.postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (pathname === "/api/v1/filing-rules/fci-test-rule" && request.method() === "DELETE") {
      deleteRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }

    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/settings?section=inbox-rules");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  const table = page.getByRole("table", { name: "Inbox & file rules" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["Priority", "Rule", "When it matches", "Action", "Destination"]);

  const row = table.locator("tbody tr").filter({ hasText: ruleName });
  await expect(row).toContainText("Subject contains an exact project number");
  await expect(row).toContainText("Needs review");
  await expect(row).toContainText("99_Unsorted Intake");

  const pauseButton = row.getByRole("button", { name: "Pause" });
  await pauseButton.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => patchBody).toEqual({ enabled: false });
  await expect(row).toContainText("Paused · approval required");
  await expect(row.getByRole("button", { name: "Enable" })).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(async () => {
    const content = await row.getByRole("cell").first().evaluate((cell) => getComputedStyle(cell, "::before").content);
    return content.replace(/^['"]|['"]$/g, "");
  }).toBe("Priority");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".main-area")).toHaveCSS("margin-left", "0px");
  await expect(row).toBeVisible();
  const mobileCells = await row.getByRole("cell").evaluateAll((cells) => cells.map((cell) => {
    const bounds = cell.getBoundingClientRect();
    return {
      dataLabel: cell.getAttribute("data-label"),
      mobileLabel: getComputedStyle(cell, "::before").content,
      left: bounds.left,
      right: bounds.right,
    };
  }));
  expect(mobileCells.map(({ dataLabel }) => dataLabel)).toEqual(["Priority", "Rule", "When it matches", "Action", "Destination"]);
  for (const cell of mobileCells) {
    expect(cell.mobileLabel.replace(/^['"]|['"]$/g, "")).toBe(cell.dataLabel);
    expect(cell.left).toBeGreaterThanOrEqual(0);
    expect(cell.right).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const deleteButton = row.getByRole("button", { name: `Delete ${ruleName}` });
  await deleteButton.focus();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.keyboard.press("Enter");
  await expect.poll(() => deleteRequests).toBe(1);
  await expect(row).toHaveCount(0);
  expect(browserIssues, browserIssues.join("\n\n")).toEqual([]);
});
