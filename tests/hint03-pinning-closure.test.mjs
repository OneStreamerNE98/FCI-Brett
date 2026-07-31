import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formsAuditHintBudget = 20;
const grandfatheredWorkspaceSetupHintCount = 21;
const shippedHints = [
  ["app/settings/components/WorkspaceBlueprintEditor.tsx", "CLIENT_FOLDER_PATTERN_HINT", "A naming template. The tokens listed below are replaced with real client values when the folder is later created."],
  ["app/settings/components/WorkspaceBlueprintEditor.tsx", "PROJECT_FOLDER_PATTERN_HINT", "A naming template. The required tokens below are replaced with real project values when setup later creates the folder."],
  ["app/settings/components/InboxRulesPanel.tsx", "RULE_MATCH_HINT", "Describe the email in plain words. This is saved as a review-first note; automatic matching is not applied yet."],
  ["app/settings/components/InboxRulesPanel.tsx", "RULE_ACTION_HINT", "Suggest proposes a project, Send to review holds it for a person, Ignore skips it. Filing always needs approval."],
  ["app/settings/components/WorkspaceDefaultsPanel.tsx", "APPOINTMENT_REMINDER_HINT", "How many hours ahead a reminder is planned to go out. Saved now; reminder sending is not built yet."],
  ["app/settings/components/WorkspaceDefaultsPanel.tsx", "CLIENT_REMINDER_HINT", "Hours before a client appointment a reminder is planned to send. Saved as a default; sending is not built yet."],
  ["app/settings/components/WorkspaceDefaultsPanel.tsx", "CREW_REMINDER_HINT", "Hours before a scheduled field day a crew reminder is planned to send. Saved as a default; sending is not built yet."],
  ["app/FloorOpsApp.tsx", "LEAD_ESTIMATED_VALUE_HINT", "Your rough estimate of the job's size before it's quoted. Feeds pipeline totals; it is not a committed contract amount."],
  ["app/FloorOpsApp.tsx", "CLIENT_STATUS_HINT", "Active is a current working account, Prospect is not yet won, Inactive is dormant or closed."],
  ["app/FloorOpsApp.tsx", "PROJECT_STATUS_HINT", "Planning is pre-work, Mobilizing is readying crews and materials, Installation is the active install, Closeout is punch list and wrap-up."],
  ["app/FloorOpsApp.tsx", "PROJECT_FLOORING_CATEGORY_HINT", "The main material for this job. Use Specialty for niche products and Mixed when no single category dominates."],
  ["app/FloorOpsApp.tsx", "PROJECT_ESTIMATED_VALUE_HINT", "Expected job value before booking. If a contract value is later recorded, reporting prefers that figure."],
];

test("HINT-03 closes the forms-audit catalog at 12 of 20 with every shipped copy pinned", async () => {
  const [audit, ledger] = await Promise.all([
    read("docs/infohint-audit-2026-07-24.md"),
    read("docs/agent-plan-architecture-workspace-and-setup.md"),
  ]);
  const sources = new Map(
    await Promise.all([...new Set(shippedHints.map(([file]) => file))].map(async (file) => [file, await read(file)])),
  );

  assert.equal(shippedHints.length, 12);
  assert.ok(shippedHints.length <= formsAuditHintBudget);
  for (const [file, constant, text] of shippedHints) {
    assert.match(
      sources.get(file),
      new RegExp(`const ${constant} = "${escapeRegExp(text)}";`, "u"),
      `${constant} must remain byte-identical to the approved audit copy`,
    );
    assert.equal(
      audit.split(text).length - 1,
      1,
      `${constant} must have exactly one authoritative audit-table entry`,
    );
  }

  assert.match(audit, /\*\*12\/20\*\*/u);
  assert.match(audit, /\*\*21\*\* Google Workspace setup-flow hints[\s\S]*grandfathered and excluded/u);
  assert.match(ledger, /forms-audit initiative uses \*\*12\/20\*\* hints/u);
  assert.match(ledger, new RegExp(`The ${grandfatheredWorkspaceSetupHintCount} pre-existing Google\\s+Workspace setup-flow hints are grandfathered`, "u"));
  assert.doesNotMatch(audit, /BOTH bind to `settings\.appointmentReminderHours`/u);
});

test("HINT-03 keeps one accessible-description assertion per shipped surface family", async () => {
  const [settingsSpec, modalSpec, workspaceSpec] = await Promise.all([
    read("tests/e2e/hint02a-info-hints.spec.ts"),
    read("tests/e2e/hint02b-floorops-modal-hints.spec.ts"),
    read("tests/e2e/workspace-setup-stepper.spec.ts"),
  ]);

  assert.match(settingsSpec, /About appointment reminder hours[\s\S]{0,180}toHaveAccessibleDescription\(appointmentHint\)/u);
  assert.match(settingsSpec, /About when this matches[\s\S]{0,180}toHaveAccessibleDescription\(matchHint\)/u);
  assert.match(modalSpec, /Lead value help[\s\S]{0,180}toHaveAccessibleDescription\(leadEstimatedValueHint\)/u);
  assert.match(workspaceSpec, /expected\[0\]\.label[\s\S]{0,180}toHaveAccessibleDescription\(expected\[0\]\.text\)/u);
  assert.match(
    workspaceSpec,
    /describedIds\.length - formsAuditBlueprintHints - postAuditOperationsHealthHints\)\.toBe\(21\)/u,
  );
});
