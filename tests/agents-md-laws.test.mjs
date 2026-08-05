// Pins the operative clause of every standing law in AGENTS.md.
//
// Before this suite, ZERO tests referenced AGENTS.md, so any law in it — including
// line 104's own claim that the status-line grammar "is mechanically enforced" —
// could be deleted in a one-line diff with CI fully green.
//
// Every pin is wrap-insensitive by construction: `\s+` between every word, `u` flag,
// built by phrase(). Literal-space pins are wrap-SENSITIVE and turn an innocent
// markdown reflow red; FIX-20 (PR #312, commit 83839e6) converted four suites away
// from them. Never hand-write a literal space inside a pin here, and never use
// String.includes() on a multi-word phrase — that is the same defect wearing a
// different hat.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

function read(path) {
  return readFileSync(`${root}${path}`, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A prose phrase as a wrap-insensitive pin: any whitespace run matches any other. */
function phrase(text) {
  return new RegExp(text.trim().split(/\s+/u).map(escapeRegex).join("\\s+"), "u");
}

const LAWS = [
  {
    name: "verification block",
    clauses: [
      "Verification is a CI run id, not a number you typed",
      'Never write "pre-existing" in a PR body',
      "Reporting a genuinely red `main` is never held against the PR that reports it",
      "green CI cannot detect a change that deletes its own detector",
      "appends a new block and leaves the author's block unedited",
      "Nothing in this law authorizes editing another agent's pull request body",
    ],
    mechanisms: [
      "### Verification",
      "**Run:**",
      "**Main:**",
      "**Not mine:**",
      "**Coverage:**",
      "gh run view <id> --log",
      "not ok [0-9]",
      "--json headSha",
      "blocked: <exact blocker>",
    ],
  },
  {
    name: "reviewed-head containment",
    clauses: [
      "The reviewed head must still be an ancestor",
      "this law adds a duty and never a cure",
      "Fast-forward pushes stay legal and are expected",
      "the whole table, not a grep",
      "Green CI is not evidence that nothing was lost",
    ],
    mechanisms: [
      "git merge-base --is-ancestor",
      "git range-diff --no-patch",
      "APPROVED-HEAD",
      "blocked: <exact blocker>",
    ],
  },
];

function assertLawIntact(agents, law) {
  for (const clause of law.clauses) {
    assert.match(agents, phrase(clause), `AGENTS.md lost the ${law.name} law clause: ${clause}`);
  }
  for (const mechanism of law.mechanisms) {
    // phrase(), not includes(): a multi-word command straddling a line wrap is the
    // exact wrap-sensitivity FIX-20 removed from four suites.
    assert.match(
      agents,
      phrase(mechanism),
      `AGENTS.md lost the ${law.name} law mechanism: ${mechanism}`,
    );
  }
}

test("AGENTS.md carries the verification-block and head-containment laws", () => {
  const agents = read("AGENTS.md");
  for (const law of LAWS) assertLawIntact(agents, law);
});

test("law pins survive a markdown reflow", () => {
  const reflowed = read("AGENTS.md").replace(/\s+/gu, " ");
  for (const law of LAWS) {
    for (const clause of law.clauses) {
      assert.match(reflowed, phrase(clause), `the pin for "${clause}" is wrap-sensitive`);
    }
  }
});

test("law pins reject a stripped copy", () => {
  const agents = read("AGENTS.md");

  for (const law of LAWS) {
    let stripped = agents;
    for (const clause of law.clauses) stripped = stripped.replace(phrase(clause), "");
    for (const mechanism of law.mechanisms) {
      stripped = stripped.replace(new RegExp(phrase(mechanism).source, "gu"), "");
    }
    assert.throws(
      () => assertLawIntact(stripped, law),
      new RegExp(`AGENTS\\.md lost the ${escapeRegex(law.name)} law`, "u"),
      `the ${law.name} matcher accepts a copy with the law removed`,
    );
  }
});
