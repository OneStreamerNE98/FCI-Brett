import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hints = [
  {
    modal: "LeadModal",
    constant: "LEAD_ESTIMATED_VALUE_HINT",
    label: "Lead value help",
    text: "Your rough estimate of the job's size before it's quoted. Feeds pipeline totals; it is not a committed contract amount.",
    anchor: "auto",
    fieldId: "lead-estimated-value",
  },
  {
    modal: "ClientModal",
    constant: "CLIENT_STATUS_HINT",
    label: "Client lifecycle help",
    text: "Active is a current working account, Prospect is not yet won, Inactive is dormant or closed.",
    anchor: "right",
    fieldId: "new-client-status",
  },
  {
    modal: "NewProjectModal",
    constant: "PROJECT_STATUS_HINT",
    label: "Project phase help",
    text: "Planning is pre-work, Mobilizing is readying crews and materials, Installation is the active install, Closeout is punch list and wrap-up.",
    anchor: "auto",
    fieldId: "new-project-status",
  },
  {
    modal: "NewProjectModal",
    constant: "PROJECT_FLOORING_CATEGORY_HINT",
    label: "Flooring selection help",
    text: "The main material for this job. Use Specialty for niche products and Mixed when no single category dominates.",
    anchor: "auto",
    fieldId: "new-project-flooring-category",
  },
  {
    modal: "NewProjectModal",
    constant: "PROJECT_ESTIMATED_VALUE_HINT",
    label: "Project value help",
    text: "Expected job value before booking. If a contract value is later recorded, reporting prefers that figure.",
    anchor: "right",
    fieldId: "new-project-estimated-value",
  },
];

function sourceSection(source, startName, endName) {
  const start = source.indexOf(`function ${startName}(`);
  const end = source.indexOf(`function ${endName}(`, start + 1);
  assert.notEqual(start, -1, `${startName} must remain present`);
  assert.notEqual(end, -1, `${endName} must remain present after ${startName}`);
  return source.slice(start, end);
}

test("HINT-02-B mounts only the five recommended modal hints with verbatim audited copy", async () => {
  const [leadSource, clientSource, projectSource] = await Promise.all([
    read("app/leads/components/LeadModal.tsx"),
    read("app/clients/components/ClientModals.tsx"),
    read("app/projects/components/ProjectModals.tsx"),
  ]);
  const source = `${leadSource}\n${clientSource}\n${projectSource}`;
  const sections = new Map([
    ["LeadModal", leadSource],
    ["ClientModal", sourceSection(clientSource, "ClientModal", "ClientEditModal")],
    ["NewProjectModal", sourceSection(projectSource, "NewProjectModal", "ProjectEditModal")],
  ]);
  const previousFormsAuditHintCount = 7;
  const formsAuditHintBudget = 20;

  assert.equal(hints.length, 5);
  assert.equal(previousFormsAuditHintCount + hints.length, 12);
  assert.ok(
    previousFormsAuditHintCount + hints.length <= formsAuditHintBudget,
    "the forms-audit initiative budget must stay at or below 20 new hints",
  );
  for (const modalSource of [leadSource, clientSource, projectSource]) {
    assert.match(modalSource, /import \{ WorkspaceInfoHint \} from "[^"']*components\/WorkspaceInfoHint";/u);
  }

  for (const hint of hints) {
    assert.match(
      source,
      new RegExp(`const ${hint.constant} = "${escapeRegExp(hint.text)}";`, "u"),
      `${hint.constant} must keep the audit-table copy byte-identical`,
    );

    const section = sections.get(hint.modal);
    assert.ok(section);
    assert.match(
      section,
      new RegExp(
        `<WorkspaceInfoHint\\s+label="${escapeRegExp(hint.label)}"\\s+text=\\{${hint.constant}\\}\\s+anchor="${hint.anchor}"\\s*\\/>`,
        "u",
      ),
      `${hint.label} must keep its audited anchor`,
    );
    assert.match(
      section,
      new RegExp(`<label htmlFor="${hint.fieldId}">[\\s\\S]{0,500}<(?:input|select) id="${hint.fieldId}"`, "u"),
      `${hint.label} must remain associated with its form control`,
    );
  }

  assert.equal(sections.get("LeadModal").match(/<WorkspaceInfoHint\b/gu)?.length, 1);
  assert.equal(sections.get("ClientModal").match(/<WorkspaceInfoHint\b/gu)?.length, 1);
  assert.equal(sections.get("NewProjectModal").match(/<WorkspaceInfoHint\b/gu)?.length, 3);
});

test("optional, rejected, and label-fix rows remain outside HINT-02-B", async () => {
  const [leadModal, clientSource, projectSource] = await Promise.all([
    read("app/leads/components/LeadModal.tsx"),
    read("app/clients/components/ClientModals.tsx"),
    read("app/projects/components/ProjectModals.tsx"),
  ]);
  const clientModal = sourceSection(clientSource, "ClientModal", "ClientEditModal");
  const newProjectModal = sourceSection(projectSource, "NewProjectModal", "ProjectEditModal");
  const followUpResultModal = projectSource.slice(projectSource.indexOf("export function FollowUpResultModal"));

  assert.doesNotMatch(leadModal, /About lead source|About next action/u);
  assert.doesNotMatch(clientModal, /About industry/u);
  assert.doesNotMatch(newProjectModal, /About square feet|About contract value/u);
  assert.doesNotMatch(followUpResultModal, /<WorkspaceInfoHint\b/u);
});

test("modal hint layout and panel-scoped Escape guard remain wired", async () => {
  const [styles, overlay] = await Promise.all([
    read("app/globals.css"),
    read("app/components/AccessibleOverlay.tsx"),
  ]);

  assert.match(styles, /\.modal-hinted-field\{min-width:0;margin-bottom:14px\}/u);
  assert.match(styles, /\.modal-hint-label-row\{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:var\(--space-2\)\}/u);
  assert.match(styles, /\.modal-hint-label-row>label\{min-width:0;margin-bottom:0\}/u);
  assert.match(styles, /@media \(min-width:561px\)\{\.modal-hint-form-row>label\{padding-top:var\(--space-4\)\}\}/u);
  assert.match(
    overlay,
    /if \(event\.key === "Escape"\) \{\s*if \(panel\.querySelector\("\.info-hint\.open"\)\) return;\s*const eventTarget = event\.target instanceof HTMLElement \? event\.target : null;[\s\S]{0,240}if \(eventTarget\?\.matches\('\[role="combobox"\]\[aria-expanded="true"\]'\)\) return;\s*event\.preventDefault\(\);/u,
  );
});
