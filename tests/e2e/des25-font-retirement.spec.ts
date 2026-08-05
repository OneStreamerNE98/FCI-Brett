import { expect, test } from "@playwright/test";

test("DES-25 uses the system type stack without requesting webfonts", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font" || /(?:\.woff2?|\/fonts\/)/iu.test(request.url())) {
      fontRequests.push(request.url());
    }
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 834, height: 1112 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/settings?section=data-security");
    const loading = page.locator(".phone-install-loading");
    if (await loading.count()) await expect(loading).toBeHidden();

    const panel = page.getByRole("region", {
      name: "Use FCI Operations like a phone app",
      exact: true,
    });
    await expect(panel).toBeVisible();
    const styles = await panel.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        backgroundColor: computed.backgroundColor,
        borderRadius: computed.borderRadius,
        fontFamily: computed.fontFamily,
      };
    });
    expect(styles.backgroundColor).toBe("rgb(250, 250, 250)");
    expect(styles.borderRadius).toBe("10px");
    expect(styles.fontFamily).toContain("-apple-system");
    expect(styles.fontFamily).not.toMatch(/DM Sans|Manrope/iu);

    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  }

  expect(fontRequests).toEqual([]);
});
