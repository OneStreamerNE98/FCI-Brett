import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("Calendar settings explain all three effective configuration sources", () => {
  const panel = read("app/settings/components/WorkspaceDefaultsPanel.tsx");
  assert.match(panel, /In use \(saved setting\)/u);
  assert.match(panel, /In use \(environment value — saving here will override it\)/u);
  assert.match(panel, /Not configured/u);
  assert.match(panel, /\/api\/v1\/integrations\/google\/calendar\/verify/u);
});

// RE-POINTED, deliberately, in this PR's own review pass. The original assertion pinned the
// phrase "the saved settings are runtime-authoritative" / "the saved values win at runtime".
// That claim is false whenever a calendar has been verified: adoption writes a
// `workspace_resources` row, and `resolveResource` consults the registry BEFORE the saved
// value (app/lib/workspace-effective-config.ts:119-131), so the saved field alone stops
// deciding what runtime uses. A pin that enforces an untrue sentence is worse than no pin —
// it makes the documentation defect permanent. Pin the precedence order instead, which is
// what an operator actually needs and what stays true.
test("SET-05 documentation makes environment Calendar IDs bootstrap-only", () => {
  for (const path of [
    "docs/guides/google-workspace-rollout-guide.md",
    "docs/task-checklists/03-hosted-development-connection.md",
  ]) {
    const document = read(path);
    assert.match(document, /Calendar ID.+(?:bootstrap|first-boot) fallback/is, path);
    // Saved beats environment...
    assert.match(document, /saved\s+(?:settings|values)\s+(?:override|beat)\s+the\s+environment/iu, path);
    // ...and a verified calendar beats saved. Both halves, or the order is not documented.
    assert.match(document, /verified calendar outranks the saved/iu, path);
  }
});

test("Calendar panel can distinguish an adopted calendar from the saved setting", () => {
  // `source` is "app" for BOTH an adopted registry row and the saved settings value
  // (workspace-effective-config.ts:140-149), so the panel cannot tell them apart from the
  // label alone — it rendered both as "In use (saved setting)" while only one was in force.
  // The resolved id is the only signal that distinguishes them; guard that it is still
  // returned and still compared, so the disclosure cannot regress to the friendly lie.
  const route = read("app/api/v1/google-workspace/route.ts");
  assert.match(route, /clientAppointmentsCalendar\.externalId\s*\?\?\s*null/u);
  assert.match(route, /fieldScheduleCalendar\.externalId\s*\?\?\s*null/u);

  const panel = read("app/settings/components/WorkspaceDefaultsPanel.tsx");
  assert.match(panel, /a verified calendar overrides the ID shown here/u);
  assert.match(panel, /effective\s*!==\s*typed\.trim\(\)/u);
});
