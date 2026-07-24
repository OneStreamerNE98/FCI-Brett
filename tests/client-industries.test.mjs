import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_INDUSTRY_OPTIONS,
  clientIndustryReportState,
  summarizeClientsByIndustry,
} from "../app/lib/client-industries.ts";

test("keeps every existing client industry option and adds Residential", () => {
  assert.deepEqual(CLIENT_INDUSTRY_OPTIONS, [
    "General contractor",
    "Healthcare",
    "Retail",
    "Hospitality",
    "Property management",
    "Other commercial",
    "Residential",
  ]);
});

test("summarizes live clients into deterministic industry rows", () => {
  assert.deepEqual(summarizeClientsByIndustry([
    { industry: "Residential" },
    { industry: " residential " },
    { industry: "Healthcare" },
    { industry: "Retail" },
    { industry: "healthcare" },
    { industry: "Custom specialty" },
    { industry: "" },
  ]), [
    { industry: "Healthcare", count: 2 },
    { industry: "Residential", count: 2 },
    { industry: "Custom specialty", count: 1 },
    { industry: "Retail", count: 1 },
    { industry: "Unspecified", count: 1 },
  ]);
});

test("keeps loading and failed client records noncommittal, including when stale rows exist", () => {
  const staleClients = [
    { industry: "Residential" },
    { industry: "Healthcare" },
  ];
  assert.deepEqual(clientIndustryReportState(staleClients, "loading"), {
    subtitle: "Checking live records",
    rows: [],
    emptyMessage: null,
  });
  assert.deepEqual(clientIndustryReportState(staleClients, "error"), {
    subtitle: "Unavailable",
    rows: [],
    emptyMessage: "Client industry data is unavailable until live records load.",
  });
  assert.deepEqual(clientIndustryReportState([], "ready"), {
    subtitle: "0 client accounts",
    rows: [],
    emptyMessage: "No client industry data is available yet.",
  });
});
