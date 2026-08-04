import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const globalsPath = resolve(repositoryRoot, "app/globals.css");
const assistantReviewPath = resolve(repositoryRoot, "app/assistant/components/AssistantTaskReview.module.css");
const defaultsPath = resolve(repositoryRoot, "app/settings/components/WorkspaceDefaultsPanel.module.css");
const resourcesPath = resolve(repositoryRoot, "app/settings/components/WorkspaceDriveResourceActions.module.css");
const domainChecklistPath = resolve(
  repositoryRoot,
  "app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.module.css",
);

const globals = readFileSync(globalsPath, "utf8");
const floorOpsApp = readFileSync(resolve(repositoryRoot, "app/FloorOpsApp.tsx"), "utf8");
const assistantReviewStyles = readFileSync(assistantReviewPath, "utf8");
const defaultsStyles = readFileSync(defaultsPath, "utf8");
const resourceStyles = readFileSync(resourcesPath, "utf8");
const domainChecklistStyles = readFileSync(domainChecklistPath, "utf8");
const pageLayoutSpec = readFileSync(resolve(repositoryRoot, "tests/e2e/page-layouts.spec.ts"), "utf8");

const ACTION = "Raise: a visible phone action should meet the 44px HIG tier.";
const FORM = "Raise: a phone form field needs a 44px touch and focus target.";
const NAVIGATION = "Raise: a phone navigation or drill-through target needs the 44px tier.";
const DISMISSAL = "Raise: dismissal and recovery controls must remain easy to hit.";
const WORKSPACE = "Raise: a Workspace setup action or disclosure is a primary phone workflow.";
const EXISTING_TARGET = "Raise: this family already used the 44px target law and remains pinned there.";

const G = "app/globals.css\t";
const A = "app/assistant/components/AssistantTaskReview.module.css\t";
const R = "app/settings/components/WorkspaceDriveResourceActions.module.css\t";

// This literal map is the reviewable phone-density contract. A new --control-* family
// fails the census until its selector and an explicit rationale are added here.
const RAISED_BELOW_44_FAMILIES = new Map([
  [`${A}.controls > button`, ACTION],
  [`${A}.controls select`, FORM],
  [`${G}.access-management-actions button`, ACTION],
  [`${G}.access-management-activity-filters select`, FORM],
  [`${G}.access-management-activity-footer .soft-button`, ACTION],
  [`${G}.access-management-back`, NAVIGATION],
  [`${G}.access-management-dialog input`, FORM],
  [`${G}.access-management-dialog select`, FORM],
  [`${G}.access-management-dialog textarea`, FORM],
  [`${G}.access-management-filter-actions .soft-button`, ACTION],
  [`${G}.access-management-header-action>.soft-button`, ACTION],
  [`${G}.access-management-header>.primary-button`, ACTION],
  [`${G}.access-management-invitations .soft-button`, ACTION],
  [`${G}.access-management-page .text-button`, ACTION],
  [`${G}.access-management-tabs button`, NAVIGATION],
  [`${G}.active-route-filter .soft-button`, NAVIGATION],
  [`${G}.ai-answer button`, ACTION],
  [`${G}.ask-box select`, FORM],
  [`${G}.ask-box>div button`, ACTION],
  [`${G}.assistant-project-scope select`, FORM],
  [`${G}.business-kpi-link`, NAVIGATION],
  [`${G}.business-kpis-header input`, FORM],
  [`${G}.client-directory-toolbar input`, FORM],
  [`${G}.client-project-section header button`, ACTION],
  [`${G}.directory-sync-actions .soft-button`, ACTION],
  [`${G}.gmail-message-actions .primary-button`, ACTION],
  [`${G}.gmail-message-actions .soft-button`, ACTION],
  [`${G}.icon-button`, EXISTING_TARGET],
  [`${G}.icon-text-button`, ACTION],
  [`${G}.inbox-connection .soft-button`, ACTION],
  [`${G}.inbox-cta`, ACTION],
  [`${G}.inbox-empty .primary-button`, ACTION],
  [`${G}.inbox-panel .inbox-cta`, ACTION],
  [`${G}.inbox-safety button`, ACTION],
  [`${G}.inbox-state-actions .soft-button`, ACTION],
  [`${G}.info-hint-trigger`, EXISTING_TARGET],
  [`${G}.integration-row>button`, ACTION],
  [`${G}.job-site-map-card>footer>a`, NAVIGATION],
  [`${G}.lead-card footer button`, ACTION],
  [`${G}.lead-detail-button`, ACTION],
  [`${G}.live-inbox-toolbar .workspace-actions .primary-button`, ACTION],
  [`${G}.live-inbox-toolbar .workspace-actions .soft-button`, ACTION],
  [`${G}.live-inbox-toolbar input`, FORM],
  [`${G}.live-inbox-toolbar select`, FORM],
  [`${G}.live-message-row .message-actions .primary-button`, ACTION],
  [`${G}.live-message-row .message-actions .soft-button`, ACTION],
  [`${G}.main-nav>a`, NAVIGATION],
  [`${G}.meeting-source-link`, NAVIGATION],
  [`${G}.modal>header button`, DISMISSAL],
  [`${G}.page-heading .primary-button`, ACTION],
  [`${G}.page-heading .soft-button`, ACTION],
  [`${G}.panel-header button`, NAVIGATION],
  [`${G}.primary-button`, ACTION],
  [`${G}.project-drawer>header button`, DISMISSAL],
  [`${G}.rule-inline-actions .soft-button`, ACTION],
  [`${G}.schedule-alert button`, ACTION],
  [`${G}.search`, FORM],
  [`${G}.search input`, FORM],
  [`${G}.settings-form-panel input`, FORM],
  [`${G}.settings-form-panel select`, FORM],
  [`${G}.settings-form-panel textarea`, FORM],
  [`${G}.settings-nav button`, NAVIGATION],
  [`${G}.sidebar-popover a`, NAVIGATION],
  [`${G}.sidebar-popover button`, NAVIGATION],
  [`${G}.soft-button`, ACTION],
  [`${G}.tabs button`, NAVIGATION],
  [`${G}.test-service-card .workspace-actions .primary-button`, WORKSPACE],
  [`${G}.test-service-card .workspace-actions .soft-button`, WORKSPACE],
  [`${G}.test-service-list .soft-button`, WORKSPACE],
  [`${G}.title-actions .primary-button`, ACTION],
  [`${G}.title-actions .soft-button`, ACTION],
  [`${G}.toast button`, DISMISSAL],
  [`${G}.toast>.toast-dismiss`, DISMISSAL],
  [`${G}.toast>button`, DISMISSAL],
  [`${G}.workspace-actions .soft-button`, WORKSPACE],
  [`${G}.workspace-blueprint-add`, WORKSPACE],
  [`${G}.workspace-blueprint-editor input`, FORM],
  [`${G}.workspace-blueprint-editor select`, FORM],
  [`${G}.workspace-blueprint-lock`, WORKSPACE],
  [`${G}.workspace-blueprint-remove`, WORKSPACE],
  [`${G}.workspace-blueprint-row-actions .soft-button`, WORKSPACE],
  [`${G}.workspace-connection-health-error .soft-button`, WORKSPACE],
  [`${G}.workspace-copy-helpers article>.soft-button`, WORKSPACE],
  [`${G}.workspace-copy-value .soft-button`, WORKSPACE],
  [`${G}.workspace-runtime-configuration article>.soft-button`, WORKSPACE],
  [`${R}.actionButtons :global(.primary-button)`, WORKSPACE],
  [`${R}.actionButtons :global(.soft-button)`, WORKSPACE],
  [`${R}.driveCandidates select`, FORM],
  [`${R}.renameForm input`, FORM],
  [`${R}.resourceDetails > summary`, WORKSPACE],
]);

const KEPT_BELOW_44_FAMILIES = new Map([
  [`${G}.attention-strip button`, "Keep: the control is intentionally absent at <=560px."],
  [
    `${G}.message-actions button`,
    "Keep: this legacy generic row is hidden on phones; visible live-message variants are raised explicitly.",
  ],
  [`${G}.search-shortcut`, "Keep: the keyboard shortcut is hidden at <=820px and has no phone target."],
]);

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
      const normalized = selector.trim().replace(/\s+/g, " ");
      rules.set(normalized, `${rules.get(normalized) ?? ""}\n${match[2]}`);
    }
  }
  return rules;
}

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

function below44Families() {
  const families = new Set();
  for (const path of cssFiles(resolve(repositoryRoot, "app"))) {
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*var\(--control-(?:compact|standard|page)\)[^{}]*)\}/g)) {
      for (const selector of match[1].split(",")) {
        const normalized = selector.trim().replace(/\s+/g, " ");
        if (!normalized || normalized.startsWith("@")) continue;
        families.add(`${relative(repositoryRoot, path).replaceAll("\\", "/")}\t${normalized}`);
      }
    }
  }
  return [...families].sort();
}

test("NFIX-04 wraps long readiness identifiers and stacks every Settings heading on phones", () => {
  assert.match(
    globals,
    /\.settings-security-list strong\{overflow-wrap:anywhere;word-break:break-word\}/,
  );
  const phone = mediaRules(globals, "max-width:560px");
  assert.match(phone.get(".settings-heading") ?? "", /display:grid/);
  assert.match(phone.get(".settings-heading") ?? "", /gap:12px/);
  assert.match(phone.get(".settings-heading>.soft-button") ?? "", /width:100%/);
});

test("FIX-17 keeps page-title actions horizontal and unscheduled project status on one line", () => {
  assert.match(globals, /\.title-actions\{flex-wrap:nowrap\}/);
  assert.doesNotMatch(globals, /\.title-actions\{[^}]*flex-wrap:wrap/);
  assert.match(
    globals,
    /\.project-row-details>\.is-unscheduled\{[^}]*white-space:nowrap[^}]*\}/,
  );
  assert.match(
    floorOpsApp,
    /className=\{project\.date\.toLowerCase\(\) === "not scheduled" \? "is-unscheduled" : ""\}/,
  );

  assert.match(globals, /\.title-actions\{width:100%\}/);
  assert.match(
    globals,
    /\.title-actions>\.primary-button,.title-actions>\.soft-button\{flex:1\}/,
  );
});

test("NFIX-04 pins a complete, explicit raise-or-keep census for every below-44 family", () => {
  assert.match(globals, /--control-compact:34px/);
  assert.match(globals, /--control-standard:40px/);
  assert.match(globals, /--control-page:42px/);
  assert.match(globals, /--target-min:44px/);

  const classified = [...RAISED_BELOW_44_FAMILIES.keys(), ...KEPT_BELOW_44_FAMILIES.keys()].sort();
  assert.equal(new Set(classified).size, classified.length, "a below-44 family cannot be both raised and kept");
  assert.deepEqual(below44Families(), classified);
  for (const [family, rationale] of [...RAISED_BELOW_44_FAMILIES, ...KEPT_BELOW_44_FAMILIES]) {
    assert.ok(rationale.length > 20, `${family} needs a reviewable rationale`);
  }

  const globalPhone = mediaRules(globals, "max-width:560px");
  const assistantPhone = mediaRules(assistantReviewStyles, "max-width: 620px");
  const resourcePhone = mediaRules(resourceStyles, "max-width: 560px");
  for (const family of RAISED_BELOW_44_FAMILIES.keys()) {
    const [path, selector] = family.split("\t");
    const rules = path === "app/globals.css"
      ? globalPhone
      : path === "app/assistant/components/AssistantTaskReview.module.css"
        ? assistantPhone
        : resourcePhone;
    assert.match(
      rules.get(selector) ?? "",
      /min-height:\s*(?:var\(--target-min\)|44px)/,
      `${family} must have an effective phone-scoped 44px minimum`,
    );
  }

  assert.match(
    globalPhone.get(".gmail-message-actions .primary-button") ?? "",
    /min-height:var\(--target-min\)!important/,
  );
  assert.match(
    globalPhone.get(".gmail-message-actions .soft-button") ?? "",
    /min-height:var\(--target-min\)!important/,
  );
  assert.match(globalPhone.get(".toast>.toast-dismiss") ?? "", /width:var\(--target-min\)/);
  assert.match(
    mediaRules(domainChecklistStyles, "max-width: 560px").get(".link") ?? "",
    /min-height:\s*var\(--target-min\)/,
    "the domain-checklist module must not override the raised .soft-button family back to 30px",
  );

  assert.match(globals, /\.attention-strip button\{display:none\}/);
  assert.match(globals, /\.message-actions\{display:none\}/);
  assert.match(globals, /\.search kbd,.search-shortcut\{display:none\}/);
});

test("NFIX-04 keeps the three named control gaps at eight pixels or more", () => {
  assert.match(resourceStyles, /\.actionButtons\s*\{[^}]*gap:\s*8px/s);
  assert.match(defaultsStyles, /\.plannedField\s*\{[^}]*gap:\s*8px/s);
  assert.match(defaultsStyles, /\.plannedFieldHeader\s*\{[^}]*gap:\s*8px/s);
  assert.match(defaultsStyles, /\.plannedFieldLabel\s*\{[^}]*gap:\s*8px/s);
});

test("NFIX-04 leaves both exhausted page-layout golden hashes byte-identical", () => {
  assert.match(
    pageLayoutSpec,
    /const OVERVIEW_LEGACY_SECTIONS_SHA256 = "4b2d9803d4d5d6e7d8fc7544ab7f862d87a076f4bfa0412ba498c66e8a12dd12";/,
  );
  assert.match(
    pageLayoutSpec,
    /const REPORTS_LEGACY_SECTIONS_SHA256 = "4ba01e91ed4a31e0b6da7a0a6ec2334894145cddaacf63bc99e24efd30b999b6";/,
  );
});
