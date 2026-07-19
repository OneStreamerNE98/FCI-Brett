import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateFlooringKpis,
  FLOORING_KPI_TIME_ZONE,
  monthKeyForTimestamp,
} from "../app/features/reports/flooring-kpis.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("pins every Tier-1 flooring KPI formula to current lead and project fields", () => {
  const leads = [
    { status: "converted", source: "Website", estimatedValue: 10_000, createdAt: Date.parse("2026-07-01T13:00:00Z"), updatedAt: Date.parse("2026-07-11T13:00:00Z") },
    { status: "lost", source: "Website", estimatedValue: 5_000, createdAt: Date.parse("2026-07-02T13:00:00Z"), updatedAt: Date.parse("2026-07-12T13:00:00Z") },
    { status: "converted", source: "Referral", estimatedValue: 20_000, createdAt: Date.parse("2026-07-21T01:00:00Z"), updatedAt: Date.parse("2026-08-01T01:00:00Z") },
    { status: "converted", source: "Website", estimatedValue: 0, createdAt: Date.parse("2026-08-01T12:00:00Z"), updatedAt: Date.parse("2026-08-05T12:00:00Z") },
    { status: "active", source: "Referral", estimatedValue: 99_000, createdAt: Date.parse("2026-07-01T12:00:00Z"), updatedAt: Date.parse("2026-07-20T12:00:00Z") },
  ];
  const projects = [
    { status: "planning", estimatedValue: 100_000, createdAt: 1, updatedAt: 2 },
    { status: "mobilizing", estimatedValue: null, createdAt: 1, updatedAt: 2 },
    { status: "installation", estimatedValue: 0, createdAt: 1, updatedAt: 2 },
    { status: "closeout", estimatedValue: 50_000, createdAt: 1, updatedAt: 2 },
    { status: "completed", estimatedValue: 25_000, createdAt: 1, updatedAt: Date.parse("2026-07-15T12:00:00Z") },
    { status: "completed", estimatedValue: 25_000, createdAt: 1, updatedAt: Date.parse("2026-08-01T01:00:00Z") },
    { status: "cancelled", estimatedValue: 40_000, createdAt: 1, updatedAt: 2 },
  ];

  const result = calculateFlooringKpis(leads, projects, "2026-07");

  assert.equal(result.winRate, 0.75);
  assert.equal(result.wonLeads, 3);
  assert.equal(result.decidedLeads, 4);
  assert.deepEqual(result.winRateBySource, [
    { source: "Referral", won: 1, decided: 1, rate: 1 },
    { source: "Website", won: 2, decided: 3, rate: 2 / 3 },
  ]);
  assert.equal(result.bookedLeadCount, 2);
  assert.equal(result.bookedValue, 30_000);
  assert.equal(result.averageConvertedLeadValue, 10_000);
  assert.equal(result.convertedLeadValueCount, 3);
  assert.equal(result.averageCreatedProjectValue, 40_000);
  assert.equal(result.createdProjectValueCount, 6);
  assert.equal(result.averageSalesCycleDays, 25 / 3);
  assert.equal(result.salesCycleLeadCount, 3);
  assert.equal(result.backlogCount, 4);
  assert.equal(result.backlogValue, 150_000);
  assert.equal(result.backlogValueCount, 3);
  assert.equal(result.jobsCompleted, 2);
});

test("uses the Cherry Hill business month at UTC boundaries", () => {
  assert.equal(FLOORING_KPI_TIME_ZONE, "America/New_York");
  assert.equal(monthKeyForTimestamp(Date.parse("2026-08-01T01:00:00Z")), "2026-07");
  assert.equal(monthKeyForTimestamp(Date.parse("2026-08-01T04:00:00Z")), "2026-08");
});

test("returns honest empty states instead of invalid math", () => {
  const result = calculateFlooringKpis(
    [{ status: "active", source: "Website", estimatedValue: 5_000, createdAt: 10, updatedAt: 20 }],
    [{ status: "planning", estimatedValue: null, createdAt: 10, updatedAt: 20 }],
    "2026-07",
  );

  assert.equal(result.winRate, null);
  assert.deepEqual(result.winRateBySource, []);
  assert.equal(result.bookedValue, 0);
  assert.equal(result.averageConvertedLeadValue, null);
  assert.equal(result.averageCreatedProjectValue, null);
  assert.equal(result.averageSalesCycleDays, null);
  assert.equal(result.backlogCount, 1);
  assert.equal(result.backlogValue, null);
  assert.equal(result.jobsCompleted, 0);
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
  assert.match(panel, /operationsHref\("Leads"\)/);
  assert.match(panel, /operationsHref\("Projects", \{ projectStatus: "Active" \}\)/);
  assert.match(definitions, /converted.*converted, lost/si);
  assert.match(definitions, /A denominator of zero.*em dash/si);
  assert.match(definitions, /Project\/install cycle time/);
  assert.match(designLedger, /LeadStatusPanel.*intentionally remain a static list/);
  assert.match(executionLedger, /KPI-01[\s\S]+In progress — `codex\/tier1-flooring-kpis`/);
});
