import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { sheetMirrorStatusLabel } from "../app/lib/sheet-mirror-status.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function mirror(clientsStatus, projectsStatus = clientsStatus, reason = null) {
  return {
    configured: true,
    enabled: true,
    connected: true,
    spreadsheetUrl: null,
    spreadsheetName: "Client Directory",
    clients: { status: clientsStatus, lastSyncedAt: null, lastError: null },
    projects: { status: projectsStatus, lastSyncedAt: null, lastError: null },
    lastSyncedAt: null,
    reason,
    source: "app",
  };
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${label} start marker must remain present`);
  assert.notEqual(endIndex, -1, `${label} end marker must remain present`);
  return source.slice(startIndex, endIndex);
}

async function readTypeScriptSources(directory, relativeDirectory = "app") {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      sources.push(...await readTypeScriptSources(entryUrl, relativePath));
    } else if (/\.tsx?$/.test(entry.name)) {
      sources.push({ path: relativePath, source: await readFile(entryUrl, "utf8") });
    }
  }
  return sources;
}

test("maps every sheet-mirror state to the exact polished label catalog", () => {
  const scenarios = [
    [null, undefined, "Checking sync"],
    [mirror("syncing", "not-synced"), undefined, "Syncing"],
    [mirror("synced", "synced", "Reconnect Google."), undefined, "Needs attention"],
    [mirror("synced", "failed"), undefined, "Needs attention"],
    [mirror("synced"), undefined, "Synced"],
    [mirror("idle", "pending"), undefined, "Not synced"],
  ];

  assert.deepEqual(
    scenarios.map(([value, entity]) => sheetMirrorStatusLabel(value, entity)),
    ["Checking sync", "Syncing", "Needs attention", "Needs attention", "Synced", "Not synced"],
  );

  const labels = new Set(["Checking sync", "Syncing", "Needs attention", "Synced", "Not synced"]);
  for (const rawStatus of ["syncing", "pending", "idle", "checking", "failed", "synced", "not-synced"]) {
    const label = sheetMirrorStatusLabel(mirror(rawStatus), "clients");
    assert.ok(labels.has(label), `${rawStatus} must map to the polished label catalog`);
    assert.notEqual(label, rawStatus, `${rawStatus} must never leak as display copy`);
  }

  const mixedMirror = mirror("synced", "failed");
  assert.equal(sheetMirrorStatusLabel(mixedMirror, "clients"), "Synced");
  assert.equal(sheetMirrorStatusLabel(mixedMirror, "projects"), "Needs attention");
});

test("routes all three sheet-mirror UI surfaces through the shared mapper", async () => {
  const [app, directory, workspace] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
  ]);

  for (const [path, source] of [
    ["FloorOpsApp.tsx", app],
    ["DirectorySyncPanel.tsx", directory],
    ["GoogleWorkspacePanel.tsx", workspace],
  ]) {
    assert.match(source, /from "(?:\.\.\/)*\.\.\/lib\/sheet-mirror-status"|from "\.\/lib\/sheet-mirror-status"/, `${path} must import the shared contract`);
  }

  const clientsView = section(app, "function ClientsView", "function ProjectsView", "Clients view");
  assert.match(clientsView, /const syncLabel = sheetMirrorStatusLabel\(sheetMirror\)/);
  assert.equal(clientsView.match(/sheetMirrorStatusLabel\(/g)?.length, 1);
  assert.match(clientsView, /<span className=\{`directory-status \$\{syncStateClass\}`\}>[\s\S]*?\{syncLabel\}<\/span>/);

  const directorySummary = section(directory, '<div className="directory-sync-summary">', "{(mirror?.clients.lastError", "Directory summary");
  assert.equal(directorySummary.match(/sheetMirrorStatusLabel\(/g)?.length, 2);
  assert.equal(directorySummary.match(/<strong>/g)?.length, 2);
  assert.match(directorySummary, /<strong>\{sheetMirrorStatusLabel\(mirror, "clients"\)\}<\/strong>/);
  assert.match(directorySummary, /<strong>\{sheetMirrorStatusLabel\(mirror, "projects"\)\}<\/strong>/);

  const workspaceSummary = section(workspace, '<div className="workspace-sheet-summary">', "{(sheetsStatusError", "Workspace Sheets summary");
  assert.equal(workspaceSummary.match(/sheetMirrorStatusLabel\(/g)?.length, 2);
  assert.equal(workspaceSummary.match(/<strong>/g)?.length, 2);
  assert.match(workspaceSummary, /<strong>\{sheetMirrorStatusLabel\(sheetMirror, "clients"\)\}<\/strong>/);
  assert.match(workspaceSummary, /<strong>\{sheetMirrorStatusLabel\(sheetMirror, "projects"\)\}<\/strong>/);

  for (const [label, source] of [
    ["Clients view", clientsView],
    ["Directory summary", directorySummary],
    ["Workspace Sheets summary", workspaceSummary],
  ]) {
    assert.doesNotMatch(source, /\.(?:clients|projects)\.status|\b(?:clientsStatus|projectsStatus)\b/, `${label} must not render a raw enum path or alias`);
  }
});

test("declares one exported SheetMirrorStatus type for every consumer", async () => {
  const sources = await readTypeScriptSources(new URL("app/", root));
  const declarations = sources.flatMap(({ path, source }) => (
    [...source.matchAll(/^\s*(?:export\s+)?(?:type|interface)\s+SheetMirrorStatus\b/gm)]
      .map((match) => ({ path, declaration: match[0] }))
  ));

  assert.deepEqual(declarations, [
    { path: "app/lib/sheet-mirror-status.ts", declaration: "export type SheetMirrorStatus" },
  ]);

  for (const path of [
    "app/FloorOpsApp.tsx",
    "app/lib/google-sheets.ts",
    "app/settings/components/DirectorySyncPanel.tsx",
    "app/settings/components/GoogleWorkspacePanel.tsx",
  ]) {
    const source = await read(path);
    assert.match(source, /import(?:\s+type)?\s+\{[^}]*SheetMirrorStatus[^}]*\} from "[^"]*sheet-mirror-status"/, `${path} must import the shared type`);
  }

  const producer = await read("app/lib/google-sheets.ts");
  assert.match(producer, /Promise<SheetMirrorStatus>/);
  assert.doesNotMatch(producer, /(?:type\s+GoogleSheetMirrorStatus|Promise<GoogleSheetMirrorStatus>)/);
});
