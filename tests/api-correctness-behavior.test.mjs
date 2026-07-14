import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeStoredFilingRule,
  validateFilingRuleCreate,
  validateFilingRulePatch,
} from "../app/domain/filing-rule.ts";
import { leadResponse, validateLeadValues } from "../app/domain/lead.ts";
import { parseBoundedJsonObject } from "../app/lib/api-json-body.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const jsonOptions = {
  maximumBytes: 32,
  invalidMessage: "Invalid JSON.",
  tooLargeMessage: "Too large.",
};

test("bounded JSON parsing accepts objects and rejects malformed, non-object, and oversized bodies", async () => {
  const valid = await parseBoundedJsonObject(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ name: "FCI TEST" }),
  }), jsonOptions);
  assert.deepEqual(valid, { ok: true, body: { name: "FCI TEST" } });

  for (const body of ["{", "[]", "null", "true"]) {
    const result = await parseBoundedJsonObject(new Request("https://example.test", { method: "POST", body }), jsonOptions);
    assert.deepEqual(result, { ok: false, error: "Invalid JSON.", status: 400 });
  }

  const streamedOversize = await parseBoundedJsonObject(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(40) }),
  }), jsonOptions);
  assert.deepEqual(streamedOversize, { ok: false, error: "Too large.", status: 413 });

  const declaredOversize = await parseBoundedJsonObject(new Request("https://example.test", {
    method: "POST",
    body: "{}",
    headers: { "content-length": "33" },
  }), jsonOptions);
  assert.deepEqual(declaredOversize, { ok: false, error: "Too large.", status: 413 });
});

test("filing-rule validation applies the PATCH limits and enums to creation", () => {
  const input = {
    name: "  Exact project number  ",
    enabled: false,
    priority: "12",
    matchSummary: "  Project number is present  ",
    action: "review",
    targetCategory: "  99_Unsorted Intake  ",
    approvalRequired: false,
  };
  const created = validateFilingRuleCreate(input);
  assert.deepEqual(created, {
    ok: true,
    values: {
      name: "Exact project number",
      enabled: false,
      priority: 12,
      matchSummary: "Project number is present",
      action: "review",
      targetCategory: "99_Unsorted Intake",
      approvalRequired: false,
    },
  });

  const invalidInputs = [
    { ...input, name: "x".repeat(121) },
    { ...input, matchSummary: "x".repeat(601) },
    { ...input, targetCategory: "x".repeat(161) },
    { ...input, priority: 0 },
    { ...input, priority: 1_000 },
    { ...input, action: "send" },
    { ...input, enabled: "false" },
    { ...input, approvalRequired: 0 },
  ];
  for (const invalid of invalidInputs) assert.equal(validateFilingRuleCreate(invalid).ok, false);

  assert.deepEqual(validateFilingRulePatch({ priority: "7", action: "ignore" }), {
    ok: true,
    values: { priority: 7, action: "ignore" },
  });
  assert.equal(validateFilingRulePatch({ priority: 1_000 }).ok, false);
  assert.equal(validateFilingRulePatch({ action: "send" }).ok, false);
});

test("stored filing rules expose camelCase overrides before merging with built-ins", () => {
  const stored = normalizeStoredFilingRule({
    id: "rule-1",
    name: "Exact project number",
    enabled: 0,
    priority: 20,
    match_summary: "Stored matching criteria",
    action: "review",
    target_category: "99_Unsorted Intake",
    approval_required: 0,
  });
  const merged = {
    name: "Exact project number",
    enabled: true,
    priority: 1,
    matchSummary: "Default matching criteria",
    action: "suggest",
    targetCategory: "Default destination",
    approvalRequired: true,
    ...stored,
  };

  assert.equal(merged.matchSummary, "Stored matching criteria");
  assert.equal(merged.targetCategory, "99_Unsorted Intake");
  assert.equal(merged.approvalRequired, false);
  assert.equal(merged.enabled, false);
  assert.equal("match_summary" in stored, false);
  assert.equal("target_category" in stored, false);
  assert.equal("approval_required" in stored, false);
});

test("lead domain behavior remains available without exporting helpers from a route", async () => {
  const values = validateLeadValues({
    company: "FCI TEST — DO NOT USE",
    contactName: "Test Contact",
    contactEmail: "TEST@EXAMPLE.COM",
    contactPhone: "555-0100",
    projectName: "Test Project",
    source: "Referral",
    stage: "New",
    site: "Test site",
    estimatedValue: 1_000,
    nextAction: "Call",
    nextActionAt: null,
    ownerEmail: "OWNER@CHERRYHILLFCI.COM",
    status: "active",
  });
  assert.equal(values?.contactEmail, "test@example.com");
  assert.equal(values?.ownerEmail, "owner@cherryhillfci.com");

  const response = leadResponse({
    id: "lead-1",
    lead_number: "L-2026-TEST",
    company: "FCI TEST — DO NOT USE",
    contact_name: "Test Contact",
    contact_email: null,
    contact_phone: null,
    project_name: "Test Project",
    source: "Referral",
    stage: "New",
    site: "Test site",
    estimated_value: 1_000,
    next_action: "Call",
    next_action_at: 1_800_000_000_000,
    owner_email: "owner@cherryhillfci.com",
    status: "active",
    created_by: "owner@cherryhillfci.com",
    created_at: 1,
    updated_at: 2,
  });
  assert.equal(response.leadNumber, "L-2026-TEST");
  assert.equal(response.nextActionAt, new Date(1_800_000_000_000).toISOString());

  const [collectionRoute, itemRoute] = await Promise.all([
    read("app/api/v1/leads/route.ts"),
    read("app/api/v1/leads/[leadId]/route.ts"),
  ]);
  const exports = [...collectionRoute.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+(\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(exports, ["GET", "POST"]);
  assert.doesNotMatch(itemRoute, /from "\.\.\/route"/);
});

test("affected POST routes are wired to the shared bounded parser", async () => {
  const paths = [
    "app/api/v1/records/route.ts",
    "app/api/v1/filing-rules/route.ts",
    "app/api/v1/google-workspace/route.ts",
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /parseBoundedJsonObject\(request,/);
    assert.match(source, /if \(!parsed\.ok\) return NextResponse\.json/);
  }
});
