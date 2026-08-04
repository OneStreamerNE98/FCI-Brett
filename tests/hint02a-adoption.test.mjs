import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hints = [
  {
    file: "app/settings/components/WorkspaceBlueprintEditor.tsx",
    constant: "CLIENT_FOLDER_PATTERN_HINT",
    label: "About client folder pattern",
    text: "A naming template. The tokens listed below are replaced with real client values when the folder is later created.",
    anchor: "auto",
  },
  {
    file: "app/settings/components/WorkspaceBlueprintEditor.tsx",
    constant: "PROJECT_FOLDER_PATTERN_HINT",
    label: "About project folder pattern",
    text: "A naming template. The required tokens below are replaced with real project values when setup later creates the folder.",
    anchor: "right",
  },
  {
    file: "app/settings/components/InboxRulesPanel.tsx",
    constant: "RULE_MATCH_HINT",
    label: "About when this matches",
    text: "Describe the email in plain words. This is saved as a review-first note; automatic matching is not applied yet.",
    anchor: "auto",
  },
  {
    file: "app/settings/components/InboxRulesPanel.tsx",
    constant: "RULE_ACTION_HINT",
    label: "About rule action",
    text: "Suggest proposes a project, Send to review holds it for a person, Ignore skips it. Filing always needs approval.",
    anchor: "right",
  },
  {
    file: "app/settings/components/WorkspaceDefaultsPanel.tsx",
    constant: "APPOINTMENT_REMINDER_HINT",
    label: "Appointment reminder hours",
    text: "How many hours ahead a reminder is planned to go out. Saved now; reminder sending is not built yet.",
    anchor: "auto",
  },
  {
    file: "app/settings/components/WorkspaceDefaultsPanel.tsx",
    constant: "CLIENT_REMINDER_HINT",
    label: "Client reminder hours",
    text: "Hours before a client appointment a reminder is planned to send. Saved as a default; sending is not built yet.",
    anchor: "auto",
  },
  {
    file: "app/settings/components/WorkspaceDefaultsPanel.tsx",
    constant: "CREW_REMINDER_HINT",
    label: "Crew reminder hours",
    text: "Hours before a scheduled field day a crew reminder is planned to send. Saved as a default; sending is not built yet.",
    anchor: "right",
  },
];

test("HINT-02-A mounts only the seven recommended hints with verbatim audited copy", async () => {
  const sources = new Map(
    await Promise.all([...new Set(hints.map(({ file }) => file))].map(async (file) => [file, await read(file)])),
  );

  assert.equal(hints.length, 7);
  assert.ok(hints.length <= 20, "the forms-audit initiative budget must stay at or below 20 new hints");

  for (const hint of hints) {
    const source = sources.get(hint.file);
    assert.ok(source);
    assert.match(
      source,
      new RegExp(`const ${hint.constant} = "${escapeRegExp(hint.text)}";`, "u"),
      `${hint.constant} must keep the audit-table copy byte-identical`,
    );
  }

  const blueprint = sources.get("app/settings/components/WorkspaceBlueprintEditor.tsx");
  const rules = sources.get("app/settings/components/InboxRulesPanel.tsx");
  const defaults = sources.get("app/settings/components/WorkspaceDefaultsPanel.tsx");

  for (const source of [blueprint, rules, defaults]) {
    assert.match(source, /import \{ WorkspaceInfoHint \} from "\.\.\/\.\.\/components\/WorkspaceInfoHint";/u);
  }

  for (const hint of hints.slice(0, 4)) {
    const source = sources.get(hint.file);
    assert.match(
      source,
      new RegExp(
        `<WorkspaceInfoHint\\s+label="${escapeRegExp(hint.label)}"\\s+text=\\{${hint.constant}\\}\\s+anchor="${hint.anchor}"\\s*\\/>`,
        "u",
      ),
      `${hint.label} must keep its audited anchor`,
    );
  }

  assert.equal(blueprint.match(/<WorkspaceInfoHint\b/gu)?.length, 2);
  assert.equal(rules.match(/<WorkspaceInfoHint\b/gu)?.length, 2);
  assert.equal(defaults.match(/<WorkspaceInfoHint\b/gu)?.length, 1);
  assert.match(blueprint, /<label htmlFor="workspace-client-folder-pattern">Client folder pattern<\/label>[\s\S]{0,500}<input id="workspace-client-folder-pattern"/u);
  assert.match(blueprint, /<label htmlFor="workspace-project-folder-pattern">Project folder pattern<\/label>[\s\S]{0,500}<input id="workspace-project-folder-pattern"/u);
  assert.match(rules, /<label htmlFor="filing-rule-action">Action<\/label>[\s\S]{0,300}<select id="filing-rule-action"/u);
  assert.match(rules, /<label htmlFor="filing-rule-match-summary">When this matches<\/label>[\s\S]{0,300}<textarea id="filing-rule-match-summary"/u);

  for (const hint of hints.slice(4)) {
    assert.match(
      defaults,
      new RegExp(
        `<PlannedSettingField id="[^"]+" label="${escapeRegExp(hint.label)}" hint=\\{${hint.constant}\\} hintAnchor="${hint.anchor}">`,
        "u",
      ),
      `${hint.label} must keep its audited anchor`,
    );
  }
  assert.match(defaults, /<PlannedSettingField id="office-notification-email" label="Office notification email">/u);
});

test("an open panel-scoped hint consumes Escape before the overlay closes", async () => {
  const overlay = await read("app/components/AccessibleOverlay.tsx");
  assert.match(
    overlay,
    /if \(event\.key === "Escape"\) \{\s*if \(panel\.querySelector\("\.info-hint\.open"\)\) return;\s*const eventTarget = event\.target instanceof HTMLElement \? event\.target : null;[\s\S]{0,240}if \(eventTarget\?\.matches\('\[role="combobox"\]\[aria-expanded="true"\]'\)\) return;\s*event\.preventDefault\(\);/u,
  );
});
