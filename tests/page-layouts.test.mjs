import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_LAYOUT_SECTION_CATALOG,
  defaultPageLayout,
  defaultPageLayouts,
  isDefaultPageLayout,
  isPageLayoutCatalogEntryVisible,
  normalizePageLayoutsForRead,
  normalizePageLayoutsForWrite,
  parseStoredPageLayouts,
} from "../app/lib/page-layouts.ts";

const overviewKeys = ["metrics", "lead-pipeline", "scheduling", "active-projects", "gmail-project-inbox"];
const reportKeys = ["summary-metrics", "business-kpis", "pipeline-by-stage", "projects-by-status", "future-reports"];

function validLayouts() {
  return {
    overview: { order: [...overviewKeys], hidden: [] },
    reports: { order: [...reportKeys], hidden: [] },
  };
}

test("pins one closed panel-level catalog and excludes financial child cards", () => {
  assert.deepEqual(PAGE_LAYOUT_SECTION_CATALOG.overview.map(({ key }) => key), overviewKeys);
  assert.deepEqual(PAGE_LAYOUT_SECTION_CATALOG.reports.map(({ key }) => key), reportKeys);
  const serializedCatalog = JSON.stringify(PAGE_LAYOUT_SECTION_CATALOG);
  for (const childCard of ["Pipeline value", "Booked value", "Average job value", "Revenue per sq ft", "Estimate accuracy"]) {
    assert.doesNotMatch(serializedCatalog, new RegExp(childCard, "iu"));
  }
  assert.deepEqual(defaultPageLayouts(false), validLayouts());
  assert.equal(isPageLayoutCatalogEntryVisible({ key: "admin-panel", label: "Admin panel", access: "administrator" }, false), false);
  assert.equal(isPageLayoutCatalogEntryVisible({ key: "admin-panel", label: "Admin panel", access: "administrator" }, true), true);
});

test("widens each saved page independently while preserving valid order and hidden choices", () => {
  const normalized = normalizePageLayoutsForRead({
    overview: {
      order: ["scheduling", "stale-overview", "metrics", "scheduling"],
      hidden: ["gmail-project-inbox", "stale-overview", "gmail-project-inbox"],
    },
    reports: "corrupt-page-only",
    stalePage: { order: ["invented"] },
  }, false);

  assert.deepEqual(normalized.overview, {
    order: ["scheduling", "metrics", "lead-pipeline", "active-projects", "gmail-project-inbox"],
    hidden: ["gmail-project-inbox"],
  });
  assert.deepEqual(normalized.reports, defaultPageLayout("reports", false));
  assert.equal(isDefaultPageLayout(normalized.overview, "overview", false), false);
  assert.equal(isDefaultPageLayout(normalized.reports, "reports", false), true);
});

test("strict writes reject unknown, duplicate, extra, and malformed keys without rejecting missing future defaults", () => {
  const missingKnownKeys = validLayouts();
  missingKnownKeys.overview.order = ["scheduling", "metrics"];
  missingKnownKeys.overview.hidden = ["active-projects"];
  assert.deepEqual(normalizePageLayoutsForWrite(missingKnownKeys, false)?.overview, {
    order: ["scheduling", "metrics", "lead-pipeline", "active-projects", "gmail-project-inbox"],
    hidden: ["active-projects"],
  });

  const cases = [
    { ...validLayouts(), inventedPage: { order: [], hidden: [] } },
    { ...validLayouts(), overview: { ...validLayouts().overview, extra: true } },
    { ...validLayouts(), overview: { order: ["metrics", "invented"], hidden: [] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: ["invented"] } },
    { ...validLayouts(), overview: { order: ["metrics", "metrics"], hidden: [] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: ["scheduling", "scheduling"] } },
    { ...validLayouts(), overview: { order: "metrics", hidden: [] } },
    { overview: validLayouts().overview },
  ];
  for (const value of cases) assert.equal(normalizePageLayoutsForWrite(value, false), null);
});

test("stored parsing falls back safely without resetting a valid sibling page", () => {
  assert.deepEqual(parseStoredPageLayouts("not-json", false), validLayouts());
  assert.deepEqual(parseStoredPageLayouts(null, false), validLayouts());
  const parsed = parseStoredPageLayouts(JSON.stringify({
    overview: { order: ["active-projects", "metrics"], hidden: ["lead-pipeline"] },
    reports: { order: null, hidden: ["future-reports"] },
  }), false);
  assert.deepEqual(parsed.overview, {
    order: ["active-projects", "metrics", "lead-pipeline", "scheduling", "gmail-project-inbox"],
    hidden: ["lead-pipeline"],
  });
  assert.deepEqual(parsed.reports, { order: reportKeys, hidden: ["future-reports"] });
});
