import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  classifyActionGroupLayout,
  collectLayoutFacts,
  findClippingEscapes,
  findLabelDrift,
  findScrollOwnerViolations,
  findUnauthorizedWraps,
  findUnsanctionedActionGroups,
} from "../helpers/dynamic-state-guard";

// DES-19 — the dynamic-state guard running on the two states the August 4
// responsive-layout audit photographed, across the audit's viewport matrix.
//
// Calibration, disclosed in the PR body: the audit's P1 (Overview-edit section
// controls wrapping ragged at 1280) and P2 (drawer + edit modal both owning a
// scrollbar) are LIVE violations whose fixes belong to the DES-21 migration and
// the DES-24 overlay packet. So on the two real states this spec enforces the
// classes that hold today — clipping escapes, action-group shape, and label
// stability — and pins the wrap and scroll-owner classes to the exact known
// P1/P2 violation set (KNOWN_LIVE_VIOLATIONS): any new violation fails CI, and
// the fixing packet zeroes the baseline. Every class is proven to FAIL on a
// deliberately broken variant in tests/des19-dynamic-state-guard.test.mjs, so
// the guard cannot silently pass everywhere. On the primitives fixture all
// five classes are enforced: the primitives are built to satisfy them.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 834, height: 1112 },
  { width: 1181, height: 820 },
  { width: 1280, height: 900 },
] as const;

const PAGE_SCROLLERS = [".sidebar", ".main-nav", ".tabs", ".board", ".operations-data-table-frame", ".business-kpi-table-wrap"];
const OVERLAY_SCROLLERS = [".drawer-body", ".client-drawer-body", ".modal", ".project-drawer > nav"];
const LABEL_SELECTOR = "button, a[href], [role='button']";

// Orchestrator review (PR #349, Finding 1): the deferral of the audit's P1/P2
// fixes to DES-21/DES-24 is approved, but purely informational reporting leaves
// no CI signal if those states regress further. So the guard pins the EXACT
// known-violation set per state, class, and viewport: a NEW wrap or scroll-owner
// violation fails CI immediately, and when DES-21/DES-24 fix a known one this
// baseline must be zeroed in the same PR — the pin failing is the prompt.
// Keyed `${state}:${assertionClass}:${viewportWidth}`; entries are sorted
// `assertion|message`. Keys absent from the record assert an EMPTY violation
// set — only states with known live violations need an entry.
// Project numbers in drawer-edit messages are normalized to <project> before
// comparison because the test creates its project fresh each run.
const KNOWN_LIVE_VIOLATIONS: Readonly<Record<string, readonly string[]>> = {
  // The audit's P2: the drawer behind the edit modal still owns a scrollable
  // region at every viewport; at 390 and 1181 the modal itself overflows too.
  // DES-24 scope; zero these entries in that PR.
  "drawer-edit:scroll-owner:390": [
    "one-scroll-owner|<project> FCI TEST — DO NOT USE — DES-19 project is not the top overlay but still owns a scrollable region",
    "one-scroll-owner|2 overlays own scrollable regions at once: <project> FCI TEST — DO NOT USE — DES-19 project, Edit <project>",
  ],
  "drawer-edit:scroll-owner:820": [
    "one-scroll-owner|<project> FCI TEST — DO NOT USE — DES-19 project is not the top overlay but still owns a scrollable region",
  ],
  "drawer-edit:scroll-owner:834": [
    "one-scroll-owner|<project> FCI TEST — DO NOT USE — DES-19 project is not the top overlay but still owns a scrollable region",
  ],
  "drawer-edit:scroll-owner:1181": [
    "one-scroll-owner|<project> FCI TEST — DO NOT USE — DES-19 project is not the top overlay but still owns a scrollable region",
    "one-scroll-owner|2 overlays own scrollable regions at once: <project> FCI TEST — DO NOT USE — DES-19 project, Edit <project>",
  ],
  "drawer-edit:scroll-owner:1280": [
    "one-scroll-owner|<project> FCI TEST — DO NOT USE — DES-19 project is not the top overlay but still owns a scrollable region",
  ],
};

function violationKeys(violations: ReadonlyArray<{ assertion: string; message: string }>): string[] {
  return violations.map((violation) => `${violation.assertion}|${violation.message}`).sort();
}

async function expectBaselineViolations(
  testInfo: TestInfo,
  attachmentName: string,
  baselineKey: string,
  violations: ReadonlyArray<{ assertion: string; message: string }>,
) {
  await attachCalibration(testInfo, attachmentName, violations);
  if (process.env.DES19_DUMP_BASELINE === "1") {
    console.log(`DES19-BASELINE ${baselineKey} ${JSON.stringify(violationKeys(violations))}`);
    return;
  }
  expect(
    violationKeys(violations),
    `${baselineKey} drifted from the pinned P1/P2 baseline — a new entry is a new defect; a missing entry means DES-21/DES-24 landed and the baseline must be zeroed in the same PR`,
  ).toEqual([...(KNOWN_LIVE_VIOLATIONS[baselineKey] ?? [])].sort());
}

const legacyRecordFixtures = {
  leads: { leads: [] },
  clients: {
    clients: [{
      id: "e2e-client-001",
      client_code: "E2E-CLIENT",
      name: "E2E Regression Client",
      status: "active",
      industry: "Commercial",
      primary_contact_name: "E2E Primary Contact",
      primary_contact_email: "contact@example.test",
    }],
  },
  projects: {
    projects: [{
      id: "e2e-project-001",
      project_number: "CF-2026-E2E00001",
      client_id: "e2e-client-001",
      client_name: "E2E Regression Client",
      name: "E2E DES-19 Guard Project",
      status: "mobilizing",
      site: "201 E2E Test Ave, Cherry Hill, NJ",
      project_manager_id: "e2e-admin@example.test",
      estimated_value: 125_000,
      flooring_category: "luxury-vinyl",
      square_feet: 5_000,
      contract_value: 132_500,
      installation_started_at: null,
      installation_completed_at: null,
      had_callback: 0,
      callback_note: null,
      created_at: 1_783_900_800_000,
      updated_at: 1_783_900_800_000,
    }],
  },
  dashboard: {
    generatedAt: 1_783_900_800_000,
    metrics: { activeLeads: 0, estimatedPipelineValue: 0, activeProjects: 1, clientCount: 1, meetingCount: 0, filedEmailCount: 0 },
    projectsByStatus: [{ status: "mobilizing", count: 1 }],
    recentActivity: [],
    readiness: { scheduleDataAvailable: false, reportsUseLiveProjectLeadTotals: true },
  },
} as const;

async function mockLegacySectionRecords(page: Page) {
  for (const [resource, body] of Object.entries(legacyRecordFixtures)) {
    await page.route(`**/api/v1/${resource}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
  }
}

async function waitForLiveRecords(page: Page) {
  await expect(page.getByText("Loading live records", { exact: true })).toHaveCount(0);
}

async function collect(page: Page, allowedScrollerSelectors: string[], scopeSelector = "body") {
  return page.evaluate(collectLayoutFacts, { scopeSelector, allowedScrollerSelectors, labelSelector: LABEL_SELECTOR });
}

async function recordScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path });
}

async function attachCalibration(testInfo: TestInfo, name: string, violations: ReadonlyArray<{ assertion: string; message: string }>) {
  await testInfo.attach(name, {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
}

test("Overview edit state holds the calibrated guard classes across the audit viewport matrix", async ({ page }, testInfo) => {
  test.skip(process.env.FCI_E2E_EXTERNAL_SERVER === "true", "The guard matrix requires the isolated local simulation database.");
  for (const viewport of VIEWPORTS) {
    await test.step(`Overview edit at ${viewport.width}px`, async () => {
      await page.setViewportSize(viewport);
      await mockLegacySectionRecords(page);
      await page.goto("/");
      const editLayout = page.getByRole("button", { name: "Edit Overview layout" });
      await expect(editLayout).toBeEnabled();
      await waitForLiveRecords(page);

      const before = await collect(page, PAGE_SCROLLERS);
      await editLayout.click();
      const editor = page.getByRole("region", { name: "Overview layout editor" });
      await expect(editor).toBeVisible();
      const after = await collect(page, PAGE_SCROLLERS);

      // Enforced today.
      expect(findClippingEscapes(after.elements), `${viewport.width}px clipping escapes`).toEqual([]);
      expect(findUnsanctionedActionGroups(after.actionGroups), `${viewport.width}px action groups`).toEqual([]);
      expect(findLabelDrift(before.labels, after.labels, ["Edit Overview layout"]), `${viewport.width}px label drift`).toEqual([]);

      // Baseline-pinned until DES-21/DES-24 fix the audited live violations.
      await expectBaselineViolations(testInfo, `wrap-${viewport.width}`, `overview-edit:wrap:${viewport.width}`, findUnauthorizedWraps(after.elements));
      await expectBaselineViolations(testInfo, `scroll-owner-${viewport.width}`, `overview-edit:scroll-owner:${viewport.width}`, findScrollOwnerViolations(after.overlays));
      await recordScreenshot(page, testInfo, `overview-edit-${viewport.width}`);
    });
  }
});

const origin = process.env.FCI_E2E_ORIGIN ?? "http://localhost:4173";
const execFileAsync = promisify(execFile);

async function executeLocalD1(sql: string) {
  const wrangler = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  await execFileAsync(process.execPath, [
    wrangler,
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    "wrangler.local.jsonc",
    "--command",
    sql,
  ], { cwd: process.cwd() });
}

async function clearDes19Records() {
  await executeLocalD1(
    "DELETE FROM activity_events WHERE record_id IN (SELECT id FROM projects WHERE name LIKE 'FCI TEST — DO NOT USE — DES-19%');"
    + " DELETE FROM projects WHERE name LIKE 'FCI TEST — DO NOT USE — DES-19%';"
    + " DELETE FROM activity_events WHERE record_id IN (SELECT id FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — DES-19%');"
    + " DELETE FROM contacts WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — DES-19%');"
    + " DELETE FROM clients WHERE name LIKE 'FCI TEST — DO NOT USE — DES-19%';",
  );
}

test("project drawer edit state holds the calibrated guard classes across the audit viewport matrix", async ({ page }, testInfo) => {
  test.skip(process.env.FCI_E2E_EXTERNAL_SERVER === "true", "The guard matrix requires the isolated local simulation database.");
  await clearDes19Records();
  try {
    const clientResponse = await page.request.post("/api/v1/clients", {
      headers: { Origin: origin },
      data: { name: "FCI TEST — DO NOT USE — DES-19 client", industry: "Commercial" },
    });
    expect(clientResponse.status()).toBe(201);
    const client = await clientResponse.json() as { id: string };
    const projectResponse = await page.request.post("/api/v1/projects", {
      headers: { Origin: origin },
      data: {
        clientId: client.id,
        name: "FCI TEST — DO NOT USE — DES-19 project",
        status: "planning",
        site: "FCI TEST — DO NOT USE — DES-19 site",
        estimatedValue: 125_000,
        flooringCategory: "tile-stone",
        squareFeet: 2_500,
        contractValue: 130_000,
        segment: "commercial",
      },
    });
    expect(projectResponse.status()).toBe(201);
    const project = await projectResponse.json() as { projectNumber: string };

    for (const viewport of VIEWPORTS) {
      await test.step(`drawer edit at ${viewport.width}px`, async () => {
        await page.setViewportSize(viewport);
        await page.goto("/projects");
        await page.getByRole("button", { name: /FCI TEST — DO NOT USE — DES-19 project/u }).click();
        const drawer = page.getByRole("dialog", { name: new RegExp(project.projectNumber, "u") });
        await expect(drawer).toBeVisible();

        const before = await collect(page, [...PAGE_SCROLLERS, ...OVERLAY_SCROLLERS]);
        await drawer.getByRole("button", { name: "Edit project" }).click();
        const editor = page.getByRole("dialog", { name: `Edit ${project.projectNumber}` });
        await expect(editor).toBeVisible();
        const after = await collect(page, [...PAGE_SCROLLERS, ...OVERLAY_SCROLLERS]);

        // Enforced today.
        expect(findClippingEscapes(after.elements), `${viewport.width}px clipping escapes`).toEqual([]);
        expect(findUnsanctionedActionGroups(after.actionGroups), `${viewport.width}px action groups`).toEqual([]);
        expect(findLabelDrift(before.labels, after.labels, ["Edit project"]), `${viewport.width}px label drift`).toEqual([]);

        // Baseline-pinned: the audit photographed this exact stack owning two
        // scrollable regions (P2). The fix is DES-24 scope; the pin fails CI on
        // any drift in either direction until then. The project number is
        // generated per run, so messages are normalized before comparison.
        const normalizeProjectNumber = (violations: ReadonlyArray<{ assertion: string; message: string }>) => violations.map((violation) => ({
          assertion: violation.assertion,
          message: violation.message.split(project.projectNumber).join("<project>"),
        }));
        await expectBaselineViolations(testInfo, `wrap-${viewport.width}`, `drawer-edit:wrap:${viewport.width}`, normalizeProjectNumber(findUnauthorizedWraps(after.elements)));
        await expectBaselineViolations(testInfo, `scroll-owner-${viewport.width}`, `drawer-edit:scroll-owner:${viewport.width}`, normalizeProjectNumber(findScrollOwnerViolations(after.overlays)));
        await recordScreenshot(page, testInfo, `drawer-edit-${viewport.width}`);

        await page.keyboard.press("Escape");
        await expect(editor).toBeHidden();
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
      });
    }
  } finally {
    await clearDes19Records().catch(() => undefined);
  }
});

test("responsive primitives fixture satisfies all five guard classes at every container width", async ({ page }, testInfo) => {
  // The primitives ship unused by pinned pages until DES-21, so the browser
  // verification mounts their markup contract directly: the rp stylesheet plus
  // the :root token block extracted from globals.css.
  const primitivesCss = await readFile(join(process.cwd(), "app", "responsive-primitives.css"), "utf8");
  const globalsCss = await readFile(join(process.cwd(), "app", "globals.css"), "utf8");
  const tokenBlock = globalsCss.match(/:root\s*\{[\s\S]*?\}/u)?.[0];
  expect(tokenBlock, "could not extract the :root token block from globals.css").toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(`
    <div id="fixture" style="width: 1200px; margin: 0 auto;">
      <header class="rp-page-header">
        <div class="rp-page-header-inner">
          <div class="rp-page-header-title">
            <p class="rp-eyebrow">Overview</p>
            <h1 data-no-wrap="">An intentionally long pipeline title that must ellipsize rather than wrap onto a second line</h1>
          </div>
          <div class="rp-action-group" data-action-group="" data-density="standard">
            <div class="rp-action-group-inner" role="group" aria-label="Section actions">
              <button type="button">Full width</button>
              <button type="button">Move up</button>
              <button type="button">Move down</button>
              <button type="button">Hide</button>
            </div>
          </div>
        </div>
      </header>
      <footer class="rp-modal-footer" data-density="standard">
        <div class="rp-modal-footer-inner">
          <button type="button" id="cancel">Cancel</button>
          <button type="button" id="primary">Save changes</button>
        </div>
      </footer>
      <div class="rp-disclosure-header">
        <div class="rp-disclosure-header-inner">
          <button type="button" class="rp-disclosure-trigger" aria-expanded="false" data-no-wrap="">
            <svg class="rp-disclosure-chevron" data-expanded="false" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" fill="none" stroke-width="2"/></svg>
            <span>Advanced options</span>
          </button>
        </div>
      </div>
    </div>
  `);
  await page.addStyleTag({ content: `${tokenBlock}\n${primitivesCss}` });

  async function fixtureWidth(width: number) {
    await page.evaluate((nextWidth) => {
      document.getElementById("fixture")!.style.width = `${nextWidth}px`;
    }, width);
  }

  // Wide container: a single shared-baseline row, 44px targets, no wrap.
  await fixtureWidth(1200);
  let facts = await collect(page, [], "#fixture");
  expect(findClippingEscapes(facts.elements)).toEqual([]);
  expect(findUnsanctionedActionGroups(facts.actionGroups)).toEqual([]);
  expect(findUnauthorizedWraps(facts.elements)).toEqual([]);
  expect(findScrollOwnerViolations(facts.overlays)).toEqual([]);
  expect(classifyActionGroupLayout(facts.actionGroups[0]!.rects).layout).toBe("row");
  for (const controlRect of facts.actionGroups[0]!.rects) {
    expect(controlRect.height).toBeGreaterThanOrEqual(44);
  }
  const title = facts.elements.find((element) => element.noWrap && element.id.includes("pipeline title"));
  expect(title, "the data-no-wrap title must be collected").toBeTruthy();
  expect(title!.lines).toBe(1);
  await recordScreenshot(page, testInfo, "primitives-wide");

  // Label stability across a disclosure toggle: the invoked control may
  // change state, but no label may drift.
  const disclosure = page.getByRole("button", { name: /Advanced options/u });
  const labelsBefore = (await collect(page, [], "#fixture")).labels;
  await disclosure.click();
  await page.evaluate(() => {
    document.querySelector(".rp-disclosure-chevron")!.setAttribute("data-expanded", "true");
  });
  const labelsAfter = (await collect(page, [], "#fixture")).labels;
  expect(findLabelDrift(labelsBefore, labelsAfter, ["Advanced options"])).toEqual([]);
  const chevronTransform = await page.evaluate(() => getComputedStyle(document.querySelector(".rp-disclosure-chevron")!).transform);
  expect(chevronTransform).not.toBe("none");

  // Mid container: the sanctioned two-per-row grid.
  await fixtureWidth(460);
  facts = await collect(page, [], "#fixture");
  expect(findUnsanctionedActionGroups(facts.actionGroups)).toEqual([]);
  expect(findUnauthorizedWraps(facts.elements)).toEqual([]);
  expect(classifyActionGroupLayout(facts.actionGroups[0]!.rects).layout).toBe("grid");
  await recordScreenshot(page, testInfo, "primitives-grid");

  // Narrow container: the full-width stack; the modal footer stacks with the
  // primary action on top while DOM (tab) order is unchanged.
  await fixtureWidth(260);
  facts = await collect(page, [], "#fixture");
  expect(findUnsanctionedActionGroups(facts.actionGroups)).toEqual([]);
  expect(findUnauthorizedWraps(facts.elements)).toEqual([]);
  expect(classifyActionGroupLayout(facts.actionGroups[0]!.rects).layout).toBe("stack");

  const cancel = await page.locator("#cancel").boundingBox();
  const primary = await page.locator("#primary").boundingBox();
  expect(primary!.y + primary!.height).toBeLessThanOrEqual(cancel!.y + 1);
  const domOrder = await page.evaluate(() => [...document.querySelectorAll(".rp-modal-footer-inner button")].map((button) => button.id));
  expect(domOrder).toEqual(["cancel", "primary"]);
  await recordScreenshot(page, testInfo, "primitives-stack");
});
