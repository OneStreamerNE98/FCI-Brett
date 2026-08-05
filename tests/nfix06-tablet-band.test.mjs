import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const globals = readFileSync(resolve(repositoryRoot, "app/globals.css"), "utf8");
const pageLayoutSpec = readFileSync(resolve(repositoryRoot, "tests/e2e/page-layouts.spec.ts"), "utf8");

function mediaRules(source, query) {
  const marker = `@media (${query})`;
  const start = source.lastIndexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `unterminated ${marker}`);
  const rules = new Map();
  const body = source.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of match[1].split(",")) {
      rules.set(selector.trim().replace(/\s+/g, " "), match[2]);
    }
  }
  return { body, rules };
}

test("NFIX-06 gives the Inbox toolbar and search their own rows through the tablet band", () => {
  const { rules } = mediaRules(globals, "min-width:821px) and (max-width:1100px");
  assert.match(rules.get(".inbox-layout") ?? "", /grid-template-columns:1fr/);
  assert.match(rules.get(".live-inbox-toolbar") ?? "", /flex-direction:column/);
  assert.match(rules.get(".live-inbox-toolbar") ?? "", /align-items:stretch/);
  assert.match(rules.get(".live-inbox-toolbar>div:first-child") ?? "", /flex-wrap:wrap/);
  assert.match(rules.get(".live-inbox-toolbar input") ?? "", /width:min\(100%,320px\)/);
  assert.match(rules.get(".gmail-search-help") ?? "", /width:100%/);
  assert.match(rules.get(".gmail-search-help") ?? "", /max-width:none/);
});

test("NFIX-06 promotes Projects rows through the measured 960px edge", () => {
  const { body, rules } = mediaRules(globals, "min-width:821px) and (max-width:960px");
  assert.match(rules.get(".projects-table-head") ?? "", /display:none/);
  assert.match(
    rules.get(".projects-table-row") ?? "",
    /grid-template-columns:minmax\(0,1fr\) auto 18px/,
  );
  assert.match(rules.get(".project-row-identity") ?? "", /min-width:0/);
  assert.match(rules.get(".project-row-details") ?? "", /grid-column:1\/4/);
  assert.match(rules.get(".project-row-details") ?? "", /grid-template-columns:minmax\(110px,auto\) minmax\(0,1fr\)/);
  assert.match(rules.get(".project-row-details small") ?? "", /overflow-wrap:anywhere/);
  assert.match(rules.get(".project-row-value") ?? "", /grid-column:1\/4/);
  assert.match(rules.get(".project-row-value") ?? "", /display:flex!important/);
  assert.doesNotMatch(body, /\.board/);
  assert.match(globals, /@media \(max-width:820px\)\{[\s\S]*?\.board\{overflow-x:auto;display:flex\}/);
});

test("NFIX-06 contains the Testing & launch setup action inside its tablet card", () => {
  // Its own 900 bound on purpose: the card right edge is a constant x=896, so 821-900
  // covers the whole failing range. Projects needs 960; this does not.
  const { rules } = mediaRules(globals, "min-width:821px) and (max-width:900px");
  assert.match(rules.get(".test-launch .settings-heading") ?? "", /display:grid/);
  assert.match(rules.get(".test-launch .settings-heading") ?? "", /gap:var\(--space-3\)/);
  assert.match(rules.get(".test-launch .settings-heading>.primary-button") ?? "", /width:100%/);
});

test("NFIX-06 leaves both page-layout golden constants byte-identical", () => {
  assert.match(
    pageLayoutSpec,
    /const OVERVIEW_LEGACY_SECTIONS_SHA256 = "4b2d9803d4d5d6e7d8fc7544ab7f862d87a076f4bfa0412ba498c66e8a12dd12";/,
  );
  assert.match(
    pageLayoutSpec,
    /const REPORTS_LEGACY_SECTIONS_SHA256 = "4ba01e91ed4a31e0b6da7a0a6ec2334894145cddaacf63bc99e24efd30b999b6";/,
  );
});
