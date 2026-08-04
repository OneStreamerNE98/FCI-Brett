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
import { pathToFileURL } from "node:url";

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
// Chunk size for the health-checked scan loop below. Six page-views per chunk keeps the
// between-chunk probe frequent enough that a dying server truncates within seconds of
// dying, without measurably slowing a healthy run.
const CHUNK = Math.max(1, Number(arg("chunk", "6")));

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

/**
 * The vacuity decision, extracted as a pure function so it can be unit-tested without a
 * browser. A page-view is vacuous — its zero-findings result must NOT be trusted — when:
 *   - a Vite error overlay element is present (Night 1's original blind spot: a full pass
 *     of error overlays read as a clean all-clear);
 *   - the body text carries a word-bounded infrastructure-failure marker;
 *   - the body text carries an auth-wall marker. August 3's blind spot: 102 page-views of
 *     an "Access not authorized" page reported clean, because this guard checked only for
 *     error overlays and empty bodies;
 *   - fewer than 3 interactive controls rendered. Every real page in this app has many;
 *     an auth wall, crash page, or half-rendered shell has approximately none. The floor
 *     catches broken states whose wording no text match anticipates;
 *   - the body text is shorter than 40 characters.
 */
export function looksVacuous({ bodyText, controlCount, overlayCount }) {
  const body = String(bodyText ?? "");
  return (overlayCount ?? 0) > 0
    || /\bfailed to fetch\b|\bcannot find module\b|\binternal server error\b|\bunhandled runtime\b/i
      .test(body)
    || /\baccess not authorized\b|\bnot authorized\b|\bsigned out\b/i.test(body)
    || (controlCount ?? 0) < 3
    || body.trim().length < 40;
}

/**
 * True when a per-page failure message means the server or browser connection is gone,
 * as opposed to a page-level problem (timeout, DNS, script error). The between-chunk
 * health probe can never observe a death during the FINAL chunk — there is no next chunk
 * — so the per-page catch consults this to raise the abort flag; without it, a run whose
 * tail died inside the last chunk would exit 0 and read exactly like a clean scan.
 */
export function isConnectionFailure(message) {
  return /net::ERR_CONNECTION_REFUSED|ECONNREFUSED|Target closed|browser has been closed|socket hang up/i
    .test(String(message ?? ""));
}

/** Runs in the page. Returns raw probe hits; adjudication happens outside. */
const PROBE = () => {
  const MIN = 24;
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
      return false;
    }
    // Chromium renders a closed <details> with content-visibility on ::details-content,
    // NOT display:none — descendants keep their full-size layout rects while painting
    // nothing and hit-testing to nothing. Every such ghost box sailed through the checks
    // above and reported "overlaps" with the on-screen controls near the collapsed
    // disclosure: the August 3 Rename/Open-buttons-overlap-the-next-row finding is exactly
    // this artefact (every intersection returns elementFromPoint null), and the surface
    // lays out correctly when the details is genuinely open. Only the summary row of a
    // closed details is actually on screen.
    const closedDetails = element.closest("details:not([open])");
    if (closedDetails) {
      const summary = closedDetails.querySelector(":scope > summary");
      if (!summary || !summary.contains(element)) return false;
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

  // Overlap phantom class: the sidebar nav is overflow:auto and taller than its box, so
  // its scrolled-away links report viewport rects that collide with controls rendered
  // elsewhere — four phantom hits on the first run, every one disproved by
  // elementFromPoint. What is suppressed is exactly the elements scrolled out of their
  // own scroll root's visible box; an element still visible inside its scroller remains
  // an overlap candidate, so a REAL cross-context collision (a sidebar painting over
  // main-content controls) stays reportable. (An earlier pair-identity comparison of
  // scroll roots suppressed every cross-context pair, visible or not, which made that
  // whole defect class structurally unreportable.) Honest caveat: the scroll root is
  // found through the DOM parent chain, so a position:fixed element is tested against
  // its DOM ancestor's scroller box even though it does not actually scroll with it.
  const scrollRootOf = (node) => {
    for (let anc = node.parentElement; anc && anc !== document.body; anc = anc.parentElement) {
      const cs = getComputedStyle(anc);
      if (/(auto|scroll|hidden)/.test(cs.overflowY + " " + cs.overflowX)) return anc;
    }
    return null;
  };
  // Membership test: excluded from overlap candidacy iff the rect fails to intersect its
  // scroll root's client rect (viewport coordinates, 1px tolerance). No enclosing
  // scroller means only the viewport clips the element, which the probe measures
  // separately.
  const withinScrollRoot = (node, rect) => {
    const root = scrollRootOf(node);
    if (!root) return true;
    const box = root.getBoundingClientRect();
    return rect.right > box.left + 1 && rect.left < box.right - 1
      && rect.bottom > box.top + 1 && rect.top < box.bottom - 1;
  };
  // Overhang past the viewport edge is only a DEFECT when nothing can bring it into view.
  // Inside a horizontal scroller it is intentional — the leads board scrolls sideways by
  // design — so only unreachable overhang counts.
  const reachableHorizontally = (node) => {
    for (let anc = node.parentElement; anc && anc !== document.body; anc = anc.parentElement) {
      const cs = getComputedStyle(anc);
      if (/(auto|scroll)/.test(cs.overflowX) && anc.scrollWidth > anc.clientWidth + 1) return true;
    }
    return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
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

  const overlapCandidates = targets.filter(({ element, rect }) => withinScrollRoot(element, rect));
  const overlaps = [];
  for (let i = 0; i < overlapCandidates.length; i += 1) {
    for (let j = i + 1; j < overlapCandidates.length; j += 1) {
      const a = overlapCandidates[i].rect;
      const b = overlapCandidates[j].rect;
      if (overlapCandidates[i].element.contains(overlapCandidates[j].element)) continue;
      if (overlapCandidates[j].element.contains(overlapCandidates[i].element)) continue;
      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapWidth > 1 && overlapHeight > 1) {
        overlaps.push({
          a: describe(overlapCandidates[i].element),
          b: describe(overlapCandidates[j].element),
          area: Math.round(overlapWidth * overlapHeight),
        });
      }
    }
  }

  const viewportWidth = document.documentElement.clientWidth;
  const overflowing = [...document.querySelectorAll("body *")]
    .filter(isVisible)
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ element, rect }) => rect.right > viewportWidth + 1 && rect.width > 4
      && !reachableHorizontally(element))
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

// The seeded dev server dies under sustained scanning — three times on August 3 alone —
// and a scan whose tail silently never ran reads exactly like a clean scan. Between
// chunks, prove the server is still answering; a dead server must truncate LOUDLY.
async function probeOnce(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${ORIGIN}/`, {
      signal: controller.signal,
      headers: { "oai-authenticated-user-email": USER },
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// A single 5s probe cannot tell a slow server from a dead one — the per-page budget is
// 30s, so one transient stall would falsely abort a whole run. A first failure earns one
// retry at a 20s budget; only two consecutive failures declare the server dead.
async function serverStillAlive() {
  if (await probeOnce(5_000)) return true;
  return probeOnce(20_000);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "oai-authenticated-user-email": USER,
      "oai-authenticated-user-full-name": encodeURIComponent("Nightly Scanner"),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });
  const page = await context.newPage();

  const pageViews = WIDTHS.flatMap((width) => ROUTES.map((route) => ({ route, width })));
  const results = [];
  let vacuous = 0;
  let scanAborted = false;

  for (let start = 0; start < pageViews.length; start += CHUNK) {
    if (start > 0 && !(await serverStillAlive())) {
      scanAborted = true;
      for (const { route, width } of pageViews.slice(start)) {
        vacuous += 1;
        results.push({
          route: route.id,
          path: route.path,
          width,
          vacuous: true,
          error: "server-died",
        });
      }
      break;
    }
    for (const { route, width } of pageViews.slice(start, start + CHUNK)) {
      await page.setViewportSize({ width, height: HEIGHT });
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
        const controlCount = await page
          .locator('button, a[href], input:not([type="hidden"]), select, textarea')
          .count()
          .catch(() => 0);
        const looksBroken = looksVacuous({
          bodyText: body,
          controlCount,
          overlayCount: overlay,
        });
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
        // A connection-class failure means the server or browser is gone, not that this
        // one page broke. The between-chunk probe cannot see a death inside the final
        // chunk, so the abort flag must also be raised from here.
        if (isConnectionFailure(String(error))) scanAborted = true;
        record = { ...record, error: String(error).slice(0, 200), vacuous: true };
      }
      results.push(record);
      process.stdout.write(`${route.id}@${width} `);
    }
  }

  // Belt for the final chunk: no between-chunk probe ever runs after the last chunk, so
  // if any page-view errored, prove the server outlived the run before trusting it.
  if (!scanAborted && results.some((r) => r.error) && !(await serverStillAlive())) {
    scanAborted = true;
  }

  await browser.close();

  const summary = {
    origin: ORIGIN,
    widths: WIDTHS,
    routes: ROUTES.length,
    pageViews: results.length,
    vacuousPageViews: vacuous,
    scanAborted,
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
  if (scanAborted) {
    console.error(`\nSCAN ABORTED: the server stopped answering mid-scan. Every unvisited page-view is recorded as vacuous ("server-died"). This run proves NOTHING about the pages it never reached — restart the server and re-run.`);
    process.exitCode = 1;
  }
}

// Only run the scan when executed directly (`node tools/nightly/layout-scan.mjs`). The
// guard exists so unit tests can import looksVacuous without launching a browser.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
