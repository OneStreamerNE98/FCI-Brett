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

test("SET-05 documentation makes environment Calendar IDs bootstrap-only", () => {
  for (const path of [
    "docs/google-workspace-rollout-guide.md",
    "docs/task-checklists/03-hosted-development-connection.md",
  ]) {
    const document = read(path);
    assert.match(document, /Calendar ID.+(?:bootstrap|first-boot) fallback/is, path);
    assert.match(document, /saved\s+(?:settings|values)\s+(?:are runtime-authoritative|win\s+at runtime)/iu, path);
  }
});
