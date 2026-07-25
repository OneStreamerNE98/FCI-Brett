import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), "utf8")).replaceAll("\r\n", "\n");

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${label} start marker must remain present`);
  assert.notEqual(endIndex, -1, `${label} end marker must remain present`);
  return source.slice(startIndex, endIndex);
}

test("SET-11 refresh re-reads the no-store status route and cannot trigger a sync", async () => {
  const [panel, route] = await Promise.all([
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/api/v1/integrations/google/sheets/status/route.ts"),
  ]);

  assert.match(panel, /const SHEET_STATUS_PATH = "\/api\/v1\/integrations\/google\/sheets\/status"/);
  const refresh = section(panel, "async function refreshStatus()", "\n\n  const ready", "refresh status");
  assert.match(refresh, /fetch\(SHEET_STATUS_PATH/);
  assert.match(refresh, /method: "GET"/);
  assert.match(refresh, /cache: "no-store"/);
  assert.match(refresh, /setRefreshSnapshot\(\{ base: mirror, mirror: body\.mirror \}\)/);
  assert.doesNotMatch(refresh, /onSync|\/sync|method: "POST"/);

  assert.match(panel, /\{refreshing \? "Refreshing…" : "Refresh status"\}/);
  assert.match(panel, /<AdministratorActionButton[\s\S]+isAdmin=\{isAdmin\}[\s\S]+Sync now/);
  assert.match(route, /export async function GET/);
  assert.match(route, /requireOfficeUser\(request\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/);
});

test("SET-11 renders recorded sync timestamps and errors verbatim through the shared status mapper", async () => {
  const panel = await read("app/settings/components/DirectorySyncPanel.tsx");

  assert.match(panel, /function syncTime[\s\S]+return value === null \|\| value === undefined \? "Not yet synced" : String\(value\)/);
  assert.doesNotMatch(panel, /new Date|toLocaleString|formatSyncTime/);
  assert.match(panel, /sheetMirrorStatusLabel\(mirror, entity\)/);
  assert.match(panel, /Last synced: \{syncTime\(entityStatus\?\.lastSyncedAt\)\}/);
  assert.match(panel, /Last error: \{entityStatus\.lastError\}/);
  assert.doesNotMatch(panel, /entityStatus\.status\}/);
});

test("SET-11 unconfigured guidance names only the fallback key and deep-links to Workspace Stage 3", async () => {
  const [panel, guide] = await Promise.all([
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("docs/settings-guide.md"),
  ]);

  assert.match(panel, /const CLIENT_DIRECTORY_SHEET_KEY = "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID"/);
  assert.match(panel, /href="\/settings\?section=google-workspace#workspace-stage-3"/);
  assert.match(panel, /Set up the Client Directory spreadsheet in Workspace Stage 3/);
  assert.doesNotMatch(panel, /process\.env|env\[[^\]]+\]/);

  assert.match(guide, /\*\*Refresh status\*\* checks the latest recorded mirror state without running a sync/);
  assert.match(guide, /`GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID` remains the fallback configuration name/);
  assert.match(guide, /Google Workspace → Stage 3/);
});
