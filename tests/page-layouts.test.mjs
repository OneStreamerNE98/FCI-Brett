import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_LAYOUT_RESIZABLE_SECTIONS,
  PAGE_LAYOUT_SECTION_CATALOG,
  defaultPageLayout,
  defaultPageLayouts,
  isDefaultPageLayout,
  isPageLayoutCatalogEntryVisible,
  mergePageLayoutsForWrite,
  normalizePageLayoutsForRead,
  normalizePageLayoutsForWrite,
  parseStoredPageLayouts,
  resolveArrangedSpans,
} from "../app/lib/page-layouts.ts";

const overviewKeys = ["metrics", "todays-meetings", "lead-pipeline", "scheduling", "active-projects", "gmail-project-inbox"];
const reportKeys = ["summary-metrics", "business-kpis", "pipeline-by-stage", "projects-by-status", "clients-by-industry", "future-reports"];

function validLayouts() {
  return {
    overview: { order: [...overviewKeys], hidden: [], fullWidth: [] },
    reports: { order: [...reportKeys], hidden: [], fullWidth: [] },
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
  assert.deepEqual(PAGE_LAYOUT_RESIZABLE_SECTIONS, {
    overview: ["lead-pipeline", "scheduling", "active-projects", "gmail-project-inbox"],
    reports: ["pipeline-by-stage", "projects-by-status"],
  });
  assert.equal(isPageLayoutCatalogEntryVisible({ key: "admin-panel", label: "Admin panel", access: "administrator" }, false), false);
  assert.equal(isPageLayoutCatalogEntryVisible({ key: "admin-panel", label: "Admin panel", access: "administrator" }, true), true);
});

test("widens each saved page independently while preserving valid order, hidden, and curated span choices", () => {
  const normalized = normalizePageLayoutsForRead({
    overview: {
      order: ["scheduling", "stale-overview", "metrics", "scheduling"],
      hidden: ["gmail-project-inbox", "stale-overview", "gmail-project-inbox"],
      fullWidth: ["scheduling", "metrics", "stale-overview", "scheduling"],
    },
    reports: "corrupt-page-only",
    stalePage: { order: ["invented"] },
  }, false);

  assert.deepEqual(normalized.overview, {
    order: ["scheduling", "metrics", "todays-meetings", "lead-pipeline", "active-projects", "gmail-project-inbox"],
    hidden: ["gmail-project-inbox"],
    fullWidth: ["scheduling"],
  });
  assert.deepEqual(normalized.reports, defaultPageLayout("reports", false));
  assert.equal(isDefaultPageLayout(normalized.overview, "overview", false), false);
  assert.equal(isDefaultPageLayout(normalized.reports, "reports", false), true);
});

test("strict writes reject unknown, fixed-width, duplicate, extra, and malformed keys without rejecting missing future catalog defaults", () => {
  const missingKnownKeys = validLayouts();
  missingKnownKeys.overview.order = ["scheduling", "metrics"];
  missingKnownKeys.overview.hidden = ["active-projects"];
  missingKnownKeys.overview.fullWidth = ["active-projects"];
  assert.deepEqual(normalizePageLayoutsForWrite(missingKnownKeys, false)?.overview, {
    order: ["scheduling", "metrics", "todays-meetings", "lead-pipeline", "active-projects", "gmail-project-inbox"],
    hidden: ["active-projects"],
    fullWidth: ["active-projects"],
  });

  const cases = [
    { ...validLayouts(), inventedPage: { order: [], hidden: [], fullWidth: [] } },
    { ...validLayouts(), overview: { ...validLayouts().overview, extra: true } },
    { ...validLayouts(), overview: { order: ["metrics", "invented"], hidden: [], fullWidth: [] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: ["invented"], fullWidth: [] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: [], fullWidth: ["invented"] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: [], fullWidth: ["metrics"] } },
    { ...validLayouts(), overview: { order: ["metrics", "metrics"], hidden: [], fullWidth: [] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: ["scheduling", "scheduling"], fullWidth: [] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: [], fullWidth: ["scheduling", "scheduling"] } },
    { ...validLayouts(), overview: { order: overviewKeys, hidden: [] } },
    { ...validLayouts(), overview: { order: "metrics", hidden: [], fullWidth: [] } },
    { overview: validLayouts().overview },
  ];
  for (const value of cases) assert.equal(normalizePageLayoutsForWrite(value, false), null);
});

test("an office save preserves an actor-invisible administrator span choice", () => {
  const administratorKey = "lead-pipeline";
  const administratorEntry = PAGE_LAYOUT_SECTION_CATALOG.overview.find(({ key }) => key === administratorKey);
  assert.ok(administratorEntry);
  const originalAccess = administratorEntry.access;
  administratorEntry.access = "administrator";

  try {
    const stored = validLayouts();
    stored.overview.hidden.push(administratorKey);
    stored.overview.fullWidth.push(administratorKey);
    const submitted = normalizePageLayoutsForWrite(defaultPageLayouts(false), false);
    assert.ok(submitted);

    const merged = mergePageLayoutsForWrite(JSON.stringify(stored), submitted, false);
    assert.deepEqual(merged.overview, {
      order: [...overviewKeys.filter((key) => key !== administratorKey), administratorKey],
      hidden: [administratorKey],
      fullWidth: [administratorKey],
    });
  } finally {
    administratorEntry.access = originalAccess;
  }
});

test("stored parsing falls back safely without resetting a valid sibling page", () => {
  assert.deepEqual(parseStoredPageLayouts("not-json", false), validLayouts());
  assert.deepEqual(parseStoredPageLayouts(null, false), validLayouts());
  const parsed = parseStoredPageLayouts(JSON.stringify({
    overview: { order: ["active-projects", "metrics"], hidden: ["lead-pipeline"] },
    reports: { order: null, hidden: ["future-reports"] },
  }), false);
  assert.deepEqual(parsed.overview, {
    order: ["active-projects", "metrics", "todays-meetings", "lead-pipeline", "scheduling", "gmail-project-inbox"],
    hidden: ["lead-pipeline"],
    fullWidth: [],
  });
  assert.deepEqual(parsed.reports, { order: reportKeys, hidden: ["future-reports"], fullWidth: [] });
  assert.equal(isDefaultPageLayout(parseStoredPageLayouts(JSON.stringify({
    overview: { order: overviewKeys, hidden: [] },
    reports: { order: reportKeys, hidden: [] },
  }), false).overview, "overview", false), true);
});

// DES-08d: a pre-catalog-addition user keeps every saved choice and receives
// the new optional section at the end instead of having the layout reset.
test("widens an older saved Overview layout with Today's meetings without changing prior order or visibility", () => {
  const olderLayout = {
    overview: {
      order: ["active-projects", "metrics", "lead-pipeline", "scheduling", "gmail-project-inbox"],
      hidden: ["scheduling"],
      fullWidth: [],
    },
    reports: { order: [...reportKeys], hidden: ["future-reports"], fullWidth: [] },
  };
  assert.deepEqual(normalizePageLayoutsForRead(olderLayout, false), {
    overview: {
      order: ["active-projects", "metrics", "lead-pipeline", "scheduling", "gmail-project-inbox", "todays-meetings"],
      hidden: ["scheduling"],
      fullWidth: [],
    },
    reports: olderLayout.reports,
  });
});

// DES-08 a-T1: a pre-catalog-addition user keeps every saved Reports choice
// and receives Clients by industry at the end instead of having the layout reset.
test("widens an older saved Reports layout with Clients by industry without changing prior order or visibility", () => {
  const olderLayout = {
    overview: {
      order: [...overviewKeys],
      hidden: ["scheduling"],
      fullWidth: [],
    },
    reports: {
      order: ["projects-by-status", "summary-metrics", "business-kpis", "pipeline-by-stage", "future-reports"],
      hidden: ["future-reports"],
      fullWidth: [],
    },
  };
  assert.deepEqual(normalizePageLayoutsForRead(olderLayout, false), {
    overview: olderLayout.overview,
    reports: {
      order: ["projects-by-status", "summary-metrics", "business-kpis", "pipeline-by-stage", "future-reports", "clients-by-industry"],
      hidden: ["future-reports"],
      fullWidth: [],
    },
  });
});

test("span-only customization leaves the default branch while legacy layouts remain default", () => {
  const legacy = normalizePageLayoutsForRead({
    overview: { order: overviewKeys, hidden: [] },
    reports: { order: reportKeys, hidden: [] },
  }, false);
  assert.deepEqual(legacy.overview.fullWidth, []);
  assert.equal(isDefaultPageLayout(legacy.overview, "overview", false), true);

  const customized = structuredClone(legacy.overview);
  customized.fullWidth = ["lead-pipeline"];
  assert.equal(isDefaultPageLayout(customized, "overview", false), false);
});

test("resolves every arranged row as one full card or two half cards without changing DOM order", () => {
  assert.deepEqual(resolveArrangedSpans("overview", overviewKeys, []), [
    { key: "metrics", size: "full" },
    { key: "todays-meetings", size: "full" },
    { key: "lead-pipeline", size: "half" },
    { key: "scheduling", size: "half" },
    { key: "active-projects", size: "half" },
    { key: "gmail-project-inbox", size: "half" },
  ]);

  const keys = ["lead-pipeline", "metrics", "scheduling", "active-projects", "gmail-project-inbox"];
  const requestedFullWidth = ["active-projects"];
  const resolved = resolveArrangedSpans("overview", keys, requestedFullWidth);
  assert.deepEqual(resolved, [
    { key: "lead-pipeline", size: "full" },
    { key: "metrics", size: "full" },
    { key: "scheduling", size: "full" },
    { key: "active-projects", size: "full" },
    { key: "gmail-project-inbox", size: "full" },
  ]);
  assert.deepEqual(keys, ["lead-pipeline", "metrics", "scheduling", "active-projects", "gmail-project-inbox"]);
  assert.deepEqual(requestedFullWidth, ["active-projects"]);

  assert.deepEqual(resolveArrangedSpans("reports", ["pipeline-by-stage", "projects-by-status"], ["pipeline-by-stage"]), [
    { key: "pipeline-by-stage", size: "full" },
    { key: "projects-by-status", size: "full" },
  ]);

  for (const { keys: mixedKeys, fullWidth } of [
    { keys: ["lead-pipeline", "metrics", "scheduling"], fullWidth: [] },
    { keys: ["lead-pipeline", "scheduling", "metrics", "active-projects"], fullWidth: [] },
    { keys: ["metrics", "lead-pipeline", "scheduling", "active-projects"], fullWidth: [] },
    { keys: ["lead-pipeline", "scheduling", "active-projects", "gmail-project-inbox"], fullWidth: ["scheduling"] },
  ]) {
    const mixed = resolveArrangedSpans("overview", mixedKeys, fullWidth);
    assert.deepEqual(mixed.map(({ key }) => key), mixedKeys);
    for (let index = 0; index < mixed.length;) {
      if (mixed[index].size === "full") {
        index += 1;
        continue;
      }
      assert.equal(mixed[index + 1]?.size, "half", `half section ${mixed[index].key} must have an adjacent half`);
      index += 2;
    }
  }
});
