import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  normalizeStoredFilingRule,
  validateFilingRuleCreate,
  validateFilingRulePatch,
} from "../app/domain/filing-rule.ts";
import { leadResponse, validateLeadValues } from "../app/domain/lead.ts";
import { parseBoundedJsonObject } from "../app/lib/api-json-body.ts";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path) => readFile(new URL(path, root), "utf8");
const noStoreRepairedRoutes = [
  "app/api/v1/clients/route.ts",
  "app/api/v1/dashboard/route.ts",
  "app/api/v1/filing-rules/route.ts",
  "app/api/v1/filing-rules/[ruleId]/route.ts",
  "app/api/v1/google-workspace/route.ts",
  "app/api/v1/integrations/google/connection/route.ts",
  "app/api/v1/leads/[leadId]/route.ts",
  "app/api/v1/uploads/route.ts",
];
const jsonOptions = {
  maximumBytes: 32,
  invalidMessage: "Invalid JSON.",
  tooLargeMessage: "Too large.",
};

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await routeFiles(path));
    else if (entry.name === "route.ts") files.push(path);
  }
  return files;
}

function routeHandlerSource(source, method) {
  const handlerPattern = new RegExp(
    `^export\\s+(?:(?:async\\s+)?function\\s+${method}\\b|const\\s+${method}\\s*=)`,
    "mu",
  );
  const start = source.search(handlerPattern);
  if (start < 0) return null;
  const next = source.slice(start + 1).search(
    /^export\s+(?:(?:async\s+)?function\s+[A-Z]+\b|const\s+[A-Z]+\s*=)/mu,
  );
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

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
    "app/api/v1/filing-rules/route.ts",
    "app/api/v1/google-workspace/route.ts",
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /parseBoundedJsonObject\(request,/);
    assert.match(source, /if \(!parsed\.ok\) return (?:NextResponse\.json|noStore)/);
  }
});

test("every development POST route checks same origin before authorization", async () => {
  const apiRoot = join(rootPath, "app", "api", "v1");
  const files = await routeFiles(apiRoot);
  const postRoutes = [];
  const violations = [];

  for (const path of files) {
    const source = await readFile(path, "utf8");
    const handler = routeHandlerSource(source, "POST");
    if (!handler) continue;
    const label = relative(rootPath, path).replaceAll("\\", "/");
    postRoutes.push(label);
    const originIndex = handler.indexOf("const originError = requireSameOrigin(request)");
    const denialIndex = handler.search(
      /if \(originError\) return (?:originError|noStoreResponse\(originError\))/,
    );
    const authorizationIndex = handler.indexOf("requireOfficeUser(request");
    if (
      originIndex < 0
      || denialIndex < originIndex
      || authorizationIndex < denialIndex
    ) {
      violations.push(label);
    }
  }

  assert.ok(postRoutes.length > 0, "expected at least one development POST route");
  assert.deepEqual(violations, []);
});

test("every authenticated development data route declares no-store caching", async () => {
  const apiRoot = join(rootPath, "app", "api", "v1");
  const files = await routeFiles(apiRoot);
  const authenticatedRoutes = [];
  const violations = [];
  const noStore = /["']Cache-Control["']\s*[:,]\s*["']no-store["']/u;

  for (const path of files) {
    const source = await readFile(path, "utf8");
    if (!source.includes("requireOfficeUser")) continue;
    const label = relative(rootPath, path).replaceAll("\\", "/");
    authenticatedRoutes.push(label);
    if (!noStore.test(source)) violations.push(label);
  }

  assert.ok(authenticatedRoutes.length > 0, "expected authenticated development data routes");
  assert.deepEqual(violations, []);
});

test("the eight repaired data routes route every local JSON response through no-store", async () => {
  for (const path of noStoreRepairedRoutes) {
    const source = await read(path);
    const firstHandler = source.search(/^export\s+(?:(?:async\s+)?function|const)\s+/mu);
    assert.ok(firstHandler >= 0, `${path} must export at least one route handler`);
    const handlers = source.slice(firstHandler);
    assert.match(handlers, /\bnoStore\(/u, path);
    assert.doesNotMatch(handlers, /\bNextResponse\.json\(/u, path);
  }
});

test("remaining client, project, filing-rule, and settings writes use their bounded parser caps", async () => {
  const routes = [
    ["app/api/v1/assistant/route.ts", /maximumBytes: 9_000/],
    ["app/api/v1/assistant/config/route.ts", /MAX_ASSISTANT_CONFIG_BODY_BYTES = 8_000/],
    ["app/api/v1/clients/route.ts", /MAX_CLIENT_BODY_BYTES = 64_000/],
    ["app/api/v1/projects/route.ts", /MAX_PROJECT_BODY_BYTES = 64_000/],
    ["app/api/v1/filing-rules/[ruleId]/route.ts", /MAX_RULE_BODY_BYTES = 8_000/],
    ["app/api/v1/projects/[projectId]/meetings/route.ts", /maximumBytes: 180_000/],
    ["app/api/v1/settings/me/route.ts", /MAX_ACCOUNT_PREFERENCES_BODY_BYTES = 8_000/],
    ["app/api/v1/settings/workspace/route.ts", /MAX_WORKSPACE_SETTINGS_BODY_BYTES = 8_000/],
  ];

  for (const [path, cap] of routes) {
    const source = await read(path);
    assert.match(source, cap, path);
    assert.match(source, /parseBoundedJsonObject\(request,/, path);
    assert.match(source, /if \(!parsed\.ok\) return (?:NextResponse\.json|noStore|json)/, path);
    assert.doesNotMatch(source, /request\.json\(\)/, path);
  }
});
