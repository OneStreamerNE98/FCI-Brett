import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_INDUSTRY_OPTIONS,
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
