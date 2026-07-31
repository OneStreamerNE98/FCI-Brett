import { expect, test } from "@playwright/test";

const configuredCommit = process.env.FCI_BUILD_COMMIT_SHA?.trim();
const configuredBuildTime = process.env.FCI_BUILD_TIMESTAMP?.trim();

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("SET-39 renders the build identity honestly and copies configured deployment details", async ({ page }) => {
  await page.goto("/settings?section=data-security");

  const buildCard = page.getByRole("region", { name: "Build information" });
  await expect(buildCard).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Build information" })).toHaveCount(1);

  if (!configuredCommit && !configuredBuildTime) {
    await expect(buildCard.getByText("Build identifier unavailable", { exact: true })).toBeVisible();
    await expect(buildCard.getByRole("button", { name: "Copy build details" })).toHaveCount(0);
    await expect(buildCard.locator("code")).toHaveCount(0);
    return;
  }

  expect(configuredCommit, "the build commit and timestamp must be supplied together").toBeTruthy();
  expect(configuredBuildTime, "the build commit and timestamp must be supplied together").toBeTruthy();
  const shortCommit = configuredCommit!.toLowerCase().slice(0, 7);

  await expect(buildCard.locator("code")).toHaveText(shortCommit);
  await expect(buildCard.locator("time")).toHaveText(configuredBuildTime!);

  await buildCard.getByRole("button", { name: "Copy build details" }).click();
  await expect(buildCard.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(buildCard.getByRole("status")).toHaveText("Build information copied.");
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/gu, "\n")).toBe(
    `Commit: ${shortCommit}\nBuild time: ${configuredBuildTime}`,
  );
});
