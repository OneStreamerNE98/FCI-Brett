import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const rootUrl = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, rootUrl), "utf8");
}

function environmentName(source, declaration) {
  const match = new RegExp(`const ${declaration} = "([A-Z0-9_]+)";`, "u").exec(source);
  assert.ok(match, `missing ${declaration}`);
  return match[1];
}

test("DOC-06 derives both build-time names from the build contract", async () => {
  const [runbook, buildContract] = await Promise.all([
    read("docs/runbooks/deployment.md"),
    read("build/build-information.mjs"),
  ]);
  const commitName = environmentName(buildContract, "BUILD_COMMIT_ENVIRONMENT_NAME");
  const timestampName = environmentName(buildContract, "BUILD_TIMESTAMP_ENVIRONMENT_NAME");

  assert.ok(runbook.includes("`" + commitName + "`"));
  assert.ok(runbook.includes("`" + timestampName + "`"));
  assert.match(runbook, /all-or-nothing\s+pair/u);
  assert.match(runbook, /A\s+partial\s+pair\s+is\s+rejected\s+by\s+the\s+build/u);
  assert.match(runbook, /If\s+neither\s+value\s+is\s+supplied[\s\S]*Build\s+identifier\s+unavailable/u);
});

test("DOC-06 pins the manual deployment boundary and complete issue comment", async () => {
  const [runbook, workflow] = await Promise.all([
    read("docs/runbooks/deployment.md"),
    read(".github/workflows/cloud-run-image.yml"),
  ]);

  assert.match(runbook, /owner\s+asks\s+ChatGPT\s+to\s+deploy\s+the\s+private\s+Sites\s+app\s+from\s+GitHub/u);
  assert.match(runbook, /There\s+is\s+no\s+GitHub\s+Actions\s+deployment\s+pipeline/u);
  assert.match(runbook, /Merging\s+is\s+not\s+deploying/u);
  assert.match(workflow, /This\s+workflow\s+published\s+an\s+image\s+only\./u);
  assert.match(workflow, /It\s+did\s+not\s+apply\s+Terraform,\s+deploy\s+Cloud\s+Run,\s+or\s+execute\s+a\s+Job\./u);
  assert.match(runbook, /new\s+comment\s+on[\s\S]*GitHub\s+issue\s+#258/u);

  for (const label of ["Deployed", "Source", "Sites version", "Result", "Live URL", "Impact"]) {
    assert.match(runbook, new RegExp(`\\*\\*${label}:\\*\\*`, "u"));
  }
  for (const impact of ["Source files", "hosted configuration", "migrations", "live data"]) {
    assert.match(runbook, new RegExp(impact, "u"));
  }
});

test("DOC-06 is indexed, ledger-linked, screen-verified, and free of a live snapshot", async () => {
  const [runbook, index, ledger] = await Promise.all([
    read("docs/runbooks/deployment.md"),
    read("docs/README.md"),
    read("docs/ledger/agent-plan-architecture-workspace-and-setup.md"),
  ]);

  assert.match(index, /\[runbooks\/deployment\.md\]\(runbooks\/deployment\.md\)/u);
  assert.match(ledger, /\[`deployment runbook`\]\(\.\.\/runbooks\/deployment\.md\)/u);
  // RE-POINTED, deliberately. The original pinned the literal in-flight line
  // "**Status:** In progress — `codex/doc06-deployment-runbook`", which froze a transient
  // state as if it were permanent: the moment that branch merged, the only way to keep CI
  // green was to leave a merged packet marked In progress — and under the dispatch law an
  // In-progress packet is unavailable, so the pin was actively preventing its own packet
  // from ever being flipped. Pin the packet's identity and a legal status shape instead of
  // one specific transient value.
  assert.match(ledger, /### DOC-06 · Deployment procedure runbook \(small, no deps\)\r?\n\*\*Status:\*\* /u);
  const doc06Status = /### DOC-06 · Deployment procedure runbook \(small, no deps\)\r?\n\*\*Status:\*\* (.+)/u.exec(ledger)?.[1] ?? "";
  assert.match(
    doc06Status,
    /^(?:Complete — PR #\d+(?: \+ PR #\d+)*|In review — PR #\d+|In progress — `(?:codex|claude)\/[^`]+`|Blocked — .+|Resolved in PR #\d+)(?:[,.]|$)/u,
    `DOC-06 status must use a legal status-line form, got: ${doc06Status}`,
  );
  assert.match(runbook, /Settings\s+→\s+Data\s+&\s+security/u);
  assert.match(runbook, /issue\s+#258\s+deployment\s+record\s+is\s+the\s+only\s+remaining\s+source\s+of\s+truth/u);
  assert.doesNotMatch(runbook, /\b[0-9a-f]{40}\b/iu);
  assert.doesNotMatch(runbook, /\*\*Sites version:\*\*\s+\d+/u);
  assert.doesNotMatch(runbook, /\*\*Source:\*\*\s+`?origin\/main`?\s+at\s+`?[0-9a-f]{7,40}`?/iu);
});
