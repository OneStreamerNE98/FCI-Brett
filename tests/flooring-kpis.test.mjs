import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateFlooringKpis,
  FLOORING_KPI_CATEGORIES,
  FLOORING_KPI_TIME_ZONE,
  monthKeyForTimestamp,
} from "../app/features/reports/flooring-kpis.ts";
import { FLOORING_CATEGORIES } from "../app/domain/project-creation.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("the reports category allowlist stays identical to the domain capture allowlist", () => {
  assert.deepEqual([...FLOORING_KPI_CATEGORIES], [...FLOORING_CATEGORIES]);
});

test("pins every Tier-1 and KPI-02 flooring formula to current lead and project fields", () => {
  const leads = [
    { status: "converted", source: "Website", estimatedValue: 10_000, createdAt: Date.parse("2026-07-01T13:00:00Z"), updatedAt: Date.parse("2026-07-11T13:00:00Z") },
    { status: "lost", source: "Website", estimatedValue: 5_000, createdAt: Date.parse("2026-07-02T13:00:00Z"), updatedAt: Date.parse("2026-07-12T13:00:00Z") },
    { status: "converted", source: "Referral", estimatedValue: 20_000, createdAt: Date.parse("2026-07-21T01:00:00Z"), updatedAt: Date.parse("2026-08-01T01:00:00Z") },
    { status: "converted", source: "Website", estimatedValue: 0, createdAt: Date.parse("2026-08-01T12:00:00Z"), updatedAt: Date.parse("2026-08-05T12:00:00Z") },
    { status: "active", source: "Referral", estimatedValue: 99_000, createdAt: Date.parse("2026-07-01T12:00:00Z"), updatedAt: Date.parse("2026-07-20T12:00:00Z") },
  ];
  const projects = [
    { status: "planning", estimatedValue: 100_000, flooringCategory: "hardwood", squareFeet: 4_000, contractValue: 120_000, createdAt: Date.parse("2026-07-01T13:00:00Z"), updatedAt: 2 },
    { status: "mobilizing", estimatedValue: null, flooringCategory: "carpet", squareFeet: 2_000, contractValue: 60_000, createdAt: Date.parse("2026-07-02T13:00:00Z"), updatedAt: 2 },
    { status: "installation", estimatedValue: 0, flooringCategory: "hardwood", squareFeet: 500, contractValue: 0, createdAt: Date.parse("2026-07-03T13:00:00Z"), updatedAt: 2 },
    { status: "closeout", estimatedValue: 50_000, flooringCategory: "tile-stone", squareFeet: 1_000, contractValue: null, createdAt: Date.parse("2026-06-15T13:00:00Z"), updatedAt: 2 },
    { status: "completed", estimatedValue: 20_000, flooringCategory: "luxury-vinyl", squareFeet: 1_000, contractValue: 30_000, createdAt: Date.parse("2026-07-04T13:00:00Z"), updatedAt: Date.parse("2026-07-15T12:00:00Z") },
    { status: "completed", estimatedValue: 25_000, flooringCategory: null, squareFeet: null, contractValue: null, createdAt: Date.parse("2026-07-05T13:00:00Z"), updatedAt: Date.parse("2026-08-01T01:00:00Z") },
    { status: "cancelled", estimatedValue: 40_000, flooringCategory: null, squareFeet: null, contractValue: null, createdAt: Date.parse("2026-07-06T13:00:00Z"), updatedAt: 2 },
  ];

  const result = calculateFlooringKpis(leads, projects, "2026-07");

  assert.equal(result.winRate, 0.75);
  assert.equal(result.wonLeads, 3);
  assert.equal(result.decidedLeads, 4);
  assert.deepEqual(result.winRateBySource, [
    { source: "Referral", won: 1, decided: 1, rate: 1 },
    { source: "Website", won: 2, decided: 3, rate: 2 / 3 },
  ]);
  assert.equal(result.bookedJobCount, 6);
  assert.equal(result.bookedValue, 275_000);
  assert.equal(result.averageJobValue, 325_000 / 7);
  assert.equal(result.averageJobValueCount, 7);
  assert.equal(result.averageSalesCycleDays, 25 / 3);
  assert.equal(result.salesCycleLeadCount, 3);
  assert.equal(result.backlogCount, 4);
  assert.equal(result.backlogValue, 150_000);
  assert.equal(result.backlogValueCount, 3);
  assert.equal(result.jobsCompleted, 2);
  assert.deepEqual(result.productMix, [
    { category: "hardwood", jobCount: 2, valuedJobCount: 2, valueShare: 4 / 7 },
    { category: "carpet", jobCount: 1, valuedJobCount: 1, valueShare: 2 / 7 },
    { category: "luxury-vinyl", jobCount: 1, valuedJobCount: 1, valueShare: 1 / 7 },
  ]);
  assert.equal(result.flooringCategoryCaptureCount, 4);
  assert.equal(result.revenuePerSquareFoot, 22.5);
  assert.equal(result.revenuePerSquareFootJobCount, 4);
  assert.equal(result.squareFeetCaptureCount, 4);
  // 1.35 = mean(120000/100000, 30000/20000); the aggregate 150000/120000 = 1.25
  // would fail, keeping the mean-of-ratios formula falsifiable in this suite.
  assert.equal(result.estimateAccuracy, 1.35);
  assert.equal(result.estimateAccuracyJobCount, 2);
  assert.equal(result.contractValueCaptureCount, 4);
});

test("uses the Cherry Hill business month at UTC boundaries", () => {
  assert.equal(FLOORING_KPI_TIME_ZONE, "America/New_York");
  assert.equal(monthKeyForTimestamp(Date.parse("2026-08-01T01:00:00Z")), "2026-07");
  assert.equal(monthKeyForTimestamp(Date.parse("2026-08-01T04:00:00Z")), "2026-08");
});

test("returns honest empty states instead of invalid math", () => {
  const result = calculateFlooringKpis(
    [{ status: "active", source: "Website", estimatedValue: 5_000, createdAt: 10, updatedAt: 20 }],
    [{ status: "planning", estimatedValue: null, flooringCategory: null, squareFeet: null, contractValue: null, createdAt: 10, updatedAt: 20 }],
    "2026-07",
  );

  assert.equal(result.winRate, null);
  assert.deepEqual(result.winRateBySource, []);
  assert.equal(result.bookedValue, 0);
  assert.equal(result.averageJobValue, null);
  assert.equal(result.averageSalesCycleDays, null);
  assert.equal(result.backlogCount, 1);
  assert.equal(result.backlogValue, null);
  assert.equal(result.jobsCompleted, 0);
  assert.deepEqual(result.productMix, []);
  assert.equal(result.flooringCategoryCaptureCount, 0);
  assert.equal(result.revenuePerSquareFoot, null);
  assert.equal(result.squareFeetCaptureCount, 0);
  assert.equal(result.estimateAccuracy, null);
  assert.equal(result.contractValueCaptureCount, 0);
  assert.throws(() => calculateFlooringKpis([], [], "July 2026"), /YYYY-MM/);
});

test("pins the financial gate, definitions document, drill-through, and A7 exception", async () => {
  const [app, panel, definitions, designLedger, executionLedger] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/features/reports/BusinessKpisPanel.tsx"),
    read("docs/flooring-kpis.md"),
    read("docs/design-critique-fix-plan.md"),
    read("docs/agent-plan-architecture-workspace-and-setup.md"),
  ]);

  assert.match(app, /<ReportsView[^>]+isAdmin=\{isAdmin\}/);
  assert.match(app, /<BusinessKpisPanel[^>]+isAdmin=\{isAdmin\}/);
  assert.match(app, /isAdmin \? money\(metrics\?\.estimatedPipelineValue/);
  assert.match(app, /isAdmin \? money\(item\.value\) : String\(item\.count\)/);
  assert.match(panel, /!isAdmin \? FINANCIAL_RESTRICTION_LABEL/);
  assert.match(panel, /tierTwoFinancialValue/);
  assert.match(panel, /Not yet captured/);
  assert.match(panel, /operationsHref\("Leads"\)/);
  assert.match(panel, /operationsHref\("Projects", \{ projectStatus: "Active" \}\)/);
  assert.match(definitions, /converted.*converted, lost/si);
  assert.match(definitions, /A denominator of zero.*em dash/si);
  assert.match(definitions, /Project\/install cycle time/);
  assert.match(definitions, /contractValue.*estimatedValue/si);
  assert.match(definitions, /Revenue per square foot[\s\S]*arithmetic mean/);
  assert.match(designLedger, /LeadStatusPanel.*intentionally remain a static list/);
  assert.match(executionLedger, /KPI-01[\s\S]+Complete — PR #41, July 19, 2026/);
  assert.match(executionLedger, /FloorOpsApp single-file queue[\s\S]+now KPI-02 → KPI-03/);
  assert.match(executionLedger, /KPI-02[\s\S]+In review — draft PR #52 from `codex\/kpi02-flooring-inputs`, July 20, 2026\. Source-only and not merged or deployed\./);
});
