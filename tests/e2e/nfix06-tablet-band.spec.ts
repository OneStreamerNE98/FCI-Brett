import { expect, test } from "@playwright/test";

/**
 * NFIX-06 renders the tablet band. Its unit suite asserts the CSS text the packet wrote,
 * which an audit correctly called out as circular: nothing exercised the band in a browser,
 * so an off-by-one in the media query passed every check. That is exactly what happened —
 * the first bound was 900 while the defect runs to 942, and no test could see it.
 *
 * These cases render /projects at the boundaries the geometry predicts and assert the value
 * is inside the clipping box, not merely inside the viewport. Measuring against the viewport
 * is what produced the wrong bound in the first place.
 */

const PANEL = ".projects-table";
const VALUE = "strong.project-row-value";

async function valueWithinPanel(page: import("@playwright/test").Page) {
  return page.evaluate(({ panelSelector, valueSelector }) => {
    const panel = document.querySelector(panelSelector);
    const value = document.querySelector(valueSelector);
    if (!panel || !value) return null;
    const p = panel.getBoundingClientRect();
    const v = value.getBoundingClientRect();
    return {
      valueRight: Math.round(v.right),
      panelRight: Math.round(p.right),
      clippedBy: Math.round(v.right - p.right),
      scrollable: panel.scrollWidth > panel.clientWidth + 1,
      text: (value.textContent ?? "").trim(),
    };
  }, { panelSelector: PANEL, valueSelector: VALUE });
}

// 901 and 942 sit inside the gap the original 900 bound left broken; 960 is the last width
// the stacked layout is needed at; 961 is the first width the desktop grid fits on its own.
for (const width of [834, 901, 942, 960, 961, 1024]) {
  test(`NFIX-06 keeps the project value inside its clipping box at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.locator(VALUE).first()).toBeAttached();

    const measured = await valueWithinPanel(page);
    expect(measured, `no project row rendered at ${width}px`).not.toBeNull();

    // The panel does not scroll (overflow-x: hidden), so anything past its right edge is
    // unreachable rather than merely off-screen. clippedBy must not be positive.
    expect(
      measured!.clippedBy,
      `value right ${measured!.valueRight} exceeds panel right ${measured!.panelRight} at ${width}px — clipped and unreachable`,
    ).toBeLessThanOrEqual(0);

    // Non-empty, not a currency match. An earlier draft asserted toContain("$") and passed
    // locally while failing in CI, because that pins SEED DATA rather than layout — the
    // seeded project's value is not guaranteed to be dollar-formatted in every environment.
    // This spec is about the clipping box; the cell's contents are the fixture's business.
    expect(measured!.text.length, `value cell rendered empty at ${width}px`).toBeGreaterThan(0);
  });
}
