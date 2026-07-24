import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const normalized = (value) => value.replace(/\s+/gu, " ").trim();

const SETTINGS_COPY = {
  title: "AI assistant",
  toggles: [
    "Organization-wide answers",
    "Inbox filing suggestions",
    "Reply drafting",
    "Task extraction from meetings",
  ],
  footer: "The assistant reads saved records and drafts text. It never sends email, never files messages, and never creates records without your confirmation.",
  missing: "Add OPENAI_API_KEY to the hosting environment to enable AI features. Everything else keeps working without it.",
};

const HELP_COPY = {
  title: "What you can ask",
  intro: "Answers come only from saved records and Drive files. Every answer cites its sources. The assistant never sends anything.",
  examples: [
    "Which projects have open callbacks?",
    "What did we decide in the last Hendricks meeting?",
    "What tasks are overdue?",
    "Show installation dates for active commercial projects.",
    "Find the change order document for project 2026-014.",
  ],
  limits: "Email bodies live in Drive as filed copies — file an email first if you want it searchable. Phone calls are saved as meetings.",
};

test("pins the AI-08 settings and help copy to the canonical section-9 contract", async () => {
  const [spec, card, help] = await Promise.all([
    read("docs/ai-assistant-spec.md"),
    read("app/settings/components/AiAssistantSettingsCard.tsx"),
    read("app/assistant/components/AssistantHelpPanel.tsx"),
  ]);
  const canonicalSection = spec.slice(
    spec.indexOf("## 9. Settings & help copy (canonical)"),
    spec.indexOf("## 10. Test & pin inventory"),
  );
  assert.ok(canonicalSection.startsWith("## 9. Settings & help copy (canonical)"));

  for (const text of [
    SETTINGS_COPY.title,
    ...SETTINGS_COPY.toggles,
    SETTINGS_COPY.footer,
    SETTINGS_COPY.missing,
    HELP_COPY.title,
    HELP_COPY.intro,
    ...HELP_COPY.examples,
    HELP_COPY.limits,
  ]) {
    assert.ok(
      normalized(canonicalSection).includes(normalized(text)),
      `section 9 must retain the canonical copy: ${text}`,
    );
  }

  for (const text of [
    SETTINGS_COPY.title,
    ...SETTINGS_COPY.toggles,
    SETTINGS_COPY.footer,
    SETTINGS_COPY.missing,
  ]) {
    assert.ok(card.includes(text), `AI settings card must render the exact copy: ${text}`);
  }
  for (const text of [
    HELP_COPY.title,
    HELP_COPY.intro,
    ...HELP_COPY.examples,
    HELP_COPY.limits,
  ]) {
    assert.ok(help.includes(text), `Assistant help must render the exact copy: ${text}`);
  }

  assert.match(card, /<dt>Provider<\/dt><dd>OpenAI<\/dd>/u);
  assert.match(card, /<dt>API key<\/dt>/u);
  assert.match(card, /<dt>Model<\/dt>/u);
  assert.match(card, /keyState: "Configured" \| "Missing"/u);
  assert.match(card, /\{ key: "orgQa", label: "Organization-wide answers", state: "In development" \}/u);
  for (const key of ["triage", "replyDrafts", "taskExtraction"]) {
    assert.match(
      card,
      new RegExp(`\\{ key: "${key}", label: "[^"]+", state: "Planned" \\}`, "u"),
      `${key} must stay visibly Planned until its later consumer ships`,
    );
  }
});

test("keeps the AI card in the zero-queue workflow stack and office read-only My settings surface", async () => {
  const [defaults, personal, routes, navigation] = await Promise.all([
    read("app/settings/components/WorkspaceDefaultsPanel.tsx"),
    read("app/settings/components/MySettingsPanel.tsx"),
    read("app/lib/operations-routes.ts"),
    read("app/settings/components/SettingsAudienceNavigation.tsx"),
  ]);

  assert.match(
    defaults,
    /\{children\}\s*<AiAssistantSettingsCard notify=\{notify\} isAdmin=\{isAdmin\} \/>\s*<ChatNotificationSettingsCard notify=\{notify\} isAdmin=\{isAdmin\} \/>/u,
    "the AI card must stay between the workflow child and Chat without creating another queue",
  );
  assert.match(
    personal,
    /return isAdmin\s*\? personalSettings\s*:\s*<div className="settings-panel-stack">\s*\{personalSettings\}\s*<AiAssistantSettingsCard notify=\{notify\} isAdmin=\{false\} \/>/u,
    "office users must receive the same AI card as a read-only My settings child",
  );

  const catalogMatch = routes.match(/export const SETTINGS_SECTIONS = \[([\s\S]*?)\] as const;/u);
  assert.ok(catalogMatch, "Settings must retain an explicit closed section catalog");
  const catalog = [...catalogMatch[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(catalog, [
    "My settings",
    "Google Workspace",
    "Calendar & appointments",
    "Inbox & file rules",
    "Client Directory",
    "Workflow & notifications",
    "Data & security",
    "Testing & launch",
  ]);
  assert.doesNotMatch(navigation, /AI assistant/iu, "AI-08 must not add a Settings section");
});

test("uses native disclosure semantics and keeps help isolated to the Assistant view", async () => {
  const [help, app, card] = await Promise.all([
    read("app/assistant/components/AssistantHelpPanel.tsx"),
    read("app/FloorOpsApp.tsx"),
    read("app/settings/components/AiAssistantSettingsCard.tsx"),
  ]);
  const assistantView = app.slice(
    app.indexOf("function AssistantView"),
    app.indexOf("function ReportBarRow"),
  );

  assert.match(help, /<details>/u);
  assert.match(help, /<summary>/u);
  assert.doesNotMatch(help, /\b(?:useState|onClick|role="button")\b/u);
  assert.equal(help.match(/<li key=\{question\}>/gu)?.length, 1);
  assert.match(assistantView, /<AssistantHelpPanel \/>/u);
  assert.equal(app.match(/<AssistantHelpPanel \/>/gu)?.length, 1);

  assert.match(card, /\{isAdmin \? <form onSubmit=\{save\}>/u);
  assert.match(card, /className=\{styles\.readOnlyFeatures\} aria-label="AI feature states"/u);
  assert.match(card, /<strong>\{features\[key\] \? "On" : "Off"\}<\/strong>/u);
  assert.match(card, /if \(!config \|\| !features \|\| !isAdmin/u);
});
