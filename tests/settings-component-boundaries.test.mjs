import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { SETTINGS_SECTIONS } from "../app/lib/operations-routes.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const expectedComponents = new Map([
  ["ChatNotificationSettingsCard.tsx", ["ChatNotificationSettingsCard"]],
  ["DataSecurityPanel.tsx", ["DataSecurityPanel"]],
  ["DirectorySyncPanel.tsx", ["DirectorySyncPanel"]],
  ["GoogleWorkspacePanel.tsx", ["GoogleWorkspacePanel", "GmailFilingModal"]],
  ["InboxRulesPanel.tsx", ["InboxRulesPanel", "RuleModal"]],
  ["MyAccountPanel.tsx", ["MyAccountPanel"]],
  ["SettingsDataNotice.tsx", ["SettingsDataNotice"]],
  ["TestingLaunchPanel.tsx", ["TestingLaunchPanel"]],
  ["WorkspaceDefaultsPanel.tsx", ["WorkspaceDefaultsPanel"]],
]);

test("keeps the nine Settings component modules explicit and outside FloorOpsApp", async () => {
  const directoryUrl = new URL("app/settings/components/", root);
  const files = (await readdir(directoryUrl)).filter((file) => file.endsWith(".tsx")).sort();
  assert.deepEqual(files, [...expectedComponents.keys()].sort());

  const app = await read("app/FloorOpsApp.tsx");
  for (const [file, exports] of expectedComponents) {
    const source = await read(`app/settings/components/${file}`);
    for (const exportedName of exports) {
      assert.match(source, new RegExp(`export function ${exportedName}\\b`), `${file} must export ${exportedName}`);
      assert.doesNotMatch(app, new RegExp(`function ${exportedName}\\b`), `${exportedName} must not be defined in FloorOpsApp`);
    }
  }
});

test("keeps SettingsView as an eight-section dispatcher without panel behavior", async () => {
  const app = await read("app/FloorOpsApp.tsx");
  const settingsView = app.slice(app.indexOf("function SettingsView"), app.indexOf("function GmailReplyModal"));
  assert.ok(settingsView.startsWith("function SettingsView"));
  assert.deepEqual(
    [...settingsView.matchAll(/section === "([^"]+)"/g)].map((match) => match[1]),
    [...SETTINGS_SECTIONS],
  );

  const branches = [
    ["My account", "MyAccountPanel"],
    ["Google Workspace", "GoogleWorkspacePanel"],
    ["Calendar & appointments", "WorkspaceDefaultsPanel"],
    ["Inbox & file rules", "InboxRulesPanel"],
    ["Client Directory", "DirectorySyncPanel"],
    ["Workflow & notifications", "WorkspaceDefaultsPanel"],
    ["Data & security", "DataSecurityPanel"],
    ["Testing & launch", "TestingLaunchPanel"],
  ];

  for (const [section, component] of branches) {
    assert.match(
      settingsView,
      new RegExp(`section === "${section.replace(/[&]/g, "\\&")}" && <${component}\\b`),
      `${section} must dispatch to ${component}`,
    );
  }

  assert.match(settingsView, /section === "Calendar & appointments" && <WorkspaceDefaultsPanel mode="calendar"/);
  assert.match(settingsView, /section === "Workflow & notifications" && <WorkspaceDefaultsPanel mode="workflow"/);
  assert.doesNotMatch(settingsView, /\b(?:useState|useEffect|useCallback|cachedGetJson)\b|fetch\s*\(|<form\b|<table\b|OperationsDataTable/);
});
