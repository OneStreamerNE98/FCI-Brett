import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { seedWorkspaceBlueprint } from "../app/lib/workspace-blueprint.ts";
import {
  WORKSPACE_TEMPLATE_SEED_KEYS,
  WORKSPACE_TEMPLATE_TOKEN_LEGEND,
  renderWorkspaceTemplate,
} from "../app/lib/workspace-templates.ts";

const EXPECTED_KEYS = [
  "estimate-proposal",
  "installation-work-order",
  "change-order",
  "pre-install-checklist",
  "project-budget",
];
const EXPECTED_TOKENS = ["{{client_name}}", "{{site_address}}", "{{total}}"];

function renderedTokens(body) {
  return [...new Set(body.match(/\{\{[a-z_]+\}\}/gu) ?? [])].sort();
}

test("pins the five seed slugs and the documented closed merge-token legend", () => {
  assert.deepEqual([...WORKSPACE_TEMPLATE_SEED_KEYS], EXPECTED_KEYS);
  assert.deepEqual(WORKSPACE_TEMPLATE_TOKEN_LEGEND.map(({ token }) => token), EXPECTED_TOKENS);
  assert.equal(Object.isFrozen(WORKSPACE_TEMPLATE_SEED_KEYS), true);
  assert.equal(Object.isFrozen(WORKSPACE_TEMPLATE_TOKEN_LEGEND), true);
  assert.ok(WORKSPACE_TEMPLATE_TOKEN_LEGEND.every(Object.isFrozen));

  const seed = seedWorkspaceBlueprint();
  assert.deepEqual(seed.templates.map(({ key }) => key), EXPECTED_KEYS);
});

test("renders the four seed Docs as HTML and the budget as CSV for Drive conversion", () => {
  const seed = seedWorkspaceBlueprint();
  const businessName = "FCI TEST — DO NOT USE Template Company";

  for (const template of seed.templates) {
    const rendered = renderWorkspaceTemplate(template, businessName);
    assert.equal(new TextDecoder().decode(rendered.bytes), rendered.body);
    assert.match(rendered.body, new RegExp(businessName, "u"));
    assert.deepEqual(renderedTokens(rendered.body), [...EXPECTED_TOKENS].sort());

    if (template.kind === "doc") {
      assert.equal(rendered.metadataMimeType, "application/vnd.google-apps.document");
      assert.equal(rendered.mediaMimeType, "text/html");
      assert.match(rendered.body, /^<!doctype html>/u);
      assert.match(rendered.body, new RegExp(`<h1>${template.name}</h1>`, "u"));
    } else {
      assert.equal(rendered.metadataMimeType, "application/vnd.google-apps.spreadsheet");
      assert.equal(rendered.mediaMimeType, "text/csv");
      assert.match(rendered.body, /"Budget category","Planned amount","Notes"/u);
      assert.ok(rendered.body.endsWith("\r\n"));
    }
  }
});

test("owner-added templates receive minimal titled shells for their selected kind", () => {
  const businessName = "FCI TEST — DO NOT USE Owner Shells";
  const doc = renderWorkspaceTemplate({
    key: "site-walk",
    name: "Site Walk Notes",
    kind: "doc",
    targetFolderKey: "templates",
    management: "owner",
  }, businessName);
  const sheet = renderWorkspaceTemplate({
    key: "project-ledger",
    name: "Project Details Ledger",
    kind: "sheet",
    targetFolderKey: "templates",
    management: "owner",
  }, businessName);

  assert.match(doc.body, /<h1>Site Walk Notes<\/h1>/u);
  assert.match(doc.body, /Owner-authored template/u);
  assert.doesNotMatch(doc.body, /Flooring proposal|Field checklist|Revised total/u);
  assert.match(sheet.body, /"FCI TEST — DO NOT USE Owner Shells","Project Details Ledger",""/u);
  assert.match(sheet.body, /"Owner-authored template"/u);
  assert.doesNotMatch(sheet.body, /Budget category/u);
  assert.deepEqual(renderedTokens(doc.body), [...EXPECTED_TOKENS].sort());
  assert.deepEqual(renderedTokens(sheet.body), [...EXPECTED_TOKENS].sort());
});

test("escaping keeps owner text inert in HTML and CSV shells", () => {
  const doc = renderWorkspaceTemplate({
    key: "owner-doc",
    name: "Walkthrough <Draft>",
    kind: "doc",
    targetFolderKey: "templates",
    management: "owner",
  }, "FCI & Partners");
  const sheet = renderWorkspaceTemplate({
    key: "owner-sheet",
    name: "=IMPORTDATA(\"example\")",
    kind: "sheet",
    targetFolderKey: "templates",
    management: "owner",
  }, "@External Formula");

  assert.match(doc.body, /FCI &amp; Partners/u);
  assert.match(doc.body, /Walkthrough &lt;Draft&gt;/u);
  assert.doesNotMatch(doc.body, /<Draft>/u);
  assert.match(sheet.body, /^"'@External Formula","'=IMPORTDATA\(""example""\)",""/u);
});

test("template rendering has no environment or secret input path", async () => {
  const source = await readFile(new URL("../app/lib/workspace-templates.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|cloudflare:workers|getCloudflareContext/u);

  for (const template of seedWorkspaceBlueprint().templates) {
    const { body } = renderWorkspaceTemplate(template, "FCI TEST — DO NOT USE Safe Content");
    assert.doesNotMatch(body, /GOOGLE_[A-Z0-9_]+|FCI_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY)/u);
  }
});
