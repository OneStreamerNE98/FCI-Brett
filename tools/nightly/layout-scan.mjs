/**
 * Nightly-review layout scanner.
 *
 * Standalone on purpose: it is NOT part of `npm run test:e2e`, because a nightly scan
 * gathers evidence rather than asserting a contract, and a scan finding must never turn
 * CI red. Deliberately kept out of `tests/e2e/` so the Playwright config cannot pick it up.
 *
 * Usage — the server must already be running (`npm run e2e:server`):
 *   node tools/nightly/layout-scan.mjs --widths 768,834,1024 --out work/nightly/scan.json
 *
 * Probes implement WCAG 2.2 SC 2.5.8 (Target Size, Minimum) as the violation threshold:
 * a target under 24x24 CSS px fails UNLESS a 24px-diameter circle centred on it does not
 * intersect the circle of any other target — the spacing exception. Night 1 established
 * that reading and also established that label-wrapped inputs are false positives, because
 * the label is the real target; that allowlist is implemented here rather than rediscovered.
 */

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ORIGIN = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const USER = process.env.FCI_LOCAL_DEV_USER_EMAIL ?? "e2e-admin@example.test";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const WIDTHS = String(arg("widths", "768,834,1024,600,720,900"))
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const OUT = String(arg("out", "work/nightly/layout-scan.json"));
const HEIGHT = Number(arg("height", "1000"));

const SETTINGS_SECTIONS = [
  "google-workspace",
  "calendar",
  "inbox-rules",
  "client-directory",
  "workflow-notifications",
  "data-security",
  "testing-launch",
];

const ROUTES = [
  { id: "overview", path: "/" },
  { id: "leads", path: "/leads" },
  { id: "clients", path: "/clients" },
  { id: "projects", path: "/projects" },
  { id: "schedule", path: "/schedule" },
  { id: "inbox", path: "/inbox" },
  { id: "assistant", path: "/assistant" },
  { id: "reports", path: "/reports" },
  { id: "settings-my", path: "/settings" },
  ...SETTINGS_SECTIONS.map((section) => ({
    id: `settings-${section}`,
    path: `/settings?section=${section}`,
  })),
  { id: "management-access", path: "/management/access" },
];

/** Runs in the page. Returns raw probe hits; adjudication happens outside. */
const PROBE = () => {
  const MIN = 24;
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const describe = (element) => {
    const parts = [element.tagName.toLowerCase()];
    if (element.id) parts.push(`#${element.id}`);
    const className = typeof element.className === "string" ? element.className.trim() : "";
    if (className) parts.push(`.${className.split(/\s+/).slice(0, 2).join(".")}`);
    const label = (element.getAttribute("aria-label")
      || element.textContent
      || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return `${parts.join("")}${label ? ` :: ${label}` : ""}`;
  };

  const interactive = [...document.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])',
  )].filter(isVisible);

  // Night 1's recorded false positive: an input wrapped in a label whose own box already
  // meets the minimum. The label is the target a user hits, so the input is not a failure.
  const labelWrapped = (element) => {
    const label = element.closest("label");
    if (!label) return false;
    const rect = label.getBoundingClientRect();
    return rect.width >= MIN && rect.height >= MIN;
  };

  const targets = interactive.map((element) => ({
    element,
    rect: element.getBoundingClientRect(),
    exemptLabelWrapped: labelWrapped(element),
  }));

  const undersized = targets.filter(({ rect, exemptLabelWrapped }) =>
    !exemptLabelWrapped && (rect.width < MIN || rect.height < MIN));

  // SC 2.5.8 spacing exception: an undersized target passes when a 24px circle centred on
  // it intersects no other target's circle. Only report the ones that genuinely fail.
  const centre = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  const spacingFailures = undersized.filter(({ rect }) => {
    const a = centre(rect);
    return targets.some(({ rect: other }) => {
      if (other === rect) return false;
      const b = centre(other);
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      return distance > 0 && distance < MIN;
    });
  });

  const overlaps = [];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i].rect;
      const b = targets[j].rect;
      if (targets[i].element.contains(targets[j].element)) continue;
      if (targets[j].element.contains(targets[i].element)) continue;
      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapWidth > 1 && overlapHeight > 1) {
        overlaps.push({
          a: describe(targets[i].element),
          b: describe(targets[j].element),
          area: Math.round(overlapWidth * overlapHeight),
        });
      }
    }
  }

  const viewportWidth = document.documentElement.clientWidth;
  const overflowing = [...document.querySelectorAll("body *")]
    .filter(isVisible)
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.right > viewportWidth + 1 && rect.width > 4)
    .slice(0, 40)
    .map(({ element, rect }) => ({
      target: describe(element),
      overhang: Math.round(rect.right - viewportWidth),
    }));

  return {
    pageOverflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: viewportWidth,
      overflows: document.documentElement.scrollWidth > viewportWidth + 1,
    },
    interactiveCount: targets.length,
    undersized: undersized.slice(0, 40).map(({ element, rect }) => ({
      target: describe(element),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })),
    undersizedTotal: undersized.length,
    spacingFailures: spacingFailures.slice(0, 40).map(({ element, rect }) => ({
      target: describe(element),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })),
    spacingFailureTotal: spacingFailures.length,
    overlaps: overlaps.slice(0, 20),
    overlapTotal: overlaps.length,
    overflowing,
    overflowingTotal: overflowing.length,
  };
};

const browser = await chromium.launch();
const context = await browser.newContext({
  extraHTTPHeaders: {
    "oai-authenticated-user-email": USER,
    "oai-authenticated-user-full-name": encodeURIComponent("Nightly Scanner"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  },
});
const page = await context.newPage();

const results = [];
let vacuous = 0;

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: HEIGHT });
  for (const route of ROUTES) {
    const url = `${ORIGIN}${route.path}`;
    let record = { route: route.id, path: route.path, width };
    try {
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(250);
      // Vacuity guard. Night 1's first full pass returned zero findings because every page
      // was a Vite error overlay; it was caught only by eyeballing screenshots. Detect it
      // here so a silent all-clear can never be mistaken for a clean result again.
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
      // Detect the Vite error overlay by its DOM element, not by matching its text. A
      // text match on "vite" flagged every People & Access page-view on the first run
      // because the page contains the word "Invite" — a scanner that cries wolf is worse
      // than no scanner, since the whole point of this guard is that a silent all-clear
      // cannot be trusted. Word-bounded text markers remain as a secondary signal.
      const overlay = await page.locator("vite-error-overlay").count().catch(() => 0);
      const looksBroken = overlay > 0
        || /\bfailed to fetch\b|\bcannot find module\b|\binternal server error\b|\bunhandled runtime\b/i
          .test(body)
        || body.trim().length < 40;
      if (looksBroken) vacuous += 1;
      record = {
        ...record,
        status: response?.status() ?? null,
        vacuous: looksBroken,
        bodyHead: looksBroken ? body.replace(/\s+/g, " ").slice(0, 200) : undefined,
        ...(await page.evaluate(PROBE)),
      };
    } catch (error) {
      vacuous += 1;
      record = { ...record, error: String(error).slice(0, 200), vacuous: true };
    }
    results.push(record);
    process.stdout.write(`${route.id}@${width} `);
  }
}

await browser.close();

const summary = {
  origin: ORIGIN,
  widths: WIDTHS,
  routes: ROUTES.length,
  pageViews: results.length,
  vacuousPageViews: vacuous,
  totals: {
    pageOverflow: results.filter((r) => r.pageOverflow?.overflows).length,
    spacingFailures: results.reduce((sum, r) => sum + (r.spacingFailureTotal ?? 0), 0),
    overlaps: results.reduce((sum, r) => sum + (r.overlapTotal ?? 0), 0),
    overflowingElements: results.reduce((sum, r) => sum + (r.overflowingTotal ?? 0), 0),
  },
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ summary, results }, null, 2));

console.log(`\n\n${JSON.stringify(summary, null, 2)}`);
if (vacuous > 0) {
  console.log(`\nWARNING: ${vacuous}/${results.length} page-views look vacuous. Findings from this run are NOT trustworthy until the server state is fixed.`);
}
