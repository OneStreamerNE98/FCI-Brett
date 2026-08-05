import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), "utf8")).replaceAll("\r\n", "\n");

test("SET-11 status revalidates automatically without triggering a sync", async () => {
  const [app, panel, route] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/api/v1/integrations/google/sheets/status/route.ts"),
  ]);

  // SET-42 retires the pure status button. The mounted directory reader now
  // includes the no-store route in the shared lifecycle census.
  assert.match(app, /const DIRECTORY_GET_URLS = \[[\s\S]*"\/api\/v1\/integrations\/google\/sheets\/status"/);
  assert.match(app, /useCachedGetSubscription\(DIRECTORY_GET_URLS, \(\) => refreshDirectoryData\(true\)\)/);
  assert.doesNotMatch(panel, /refreshStatus|Refresh status|setRefreshSnapshot/);
  assert.match(panel, /<AdministratorActionButton[\s\S]+isAdmin=\{isAdmin\}[\s\S]+Sync now/);
  assert.match(route, /export async function GET/);
  assert.match(route, /requireOfficeUser\(request\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/);
});

test("SET-11 renders recorded sync timestamps readably and errors verbatim through the shared status mapper", async () => {
  const panel = await read("app/settings/components/DirectorySyncPanel.tsx");

  assert.match(panel, /function syncTime[\s\S]+return value === null \|\| value === undefined \? "Not yet synced" : new Date\(value\)\.toLocaleString\(\)/);
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

  assert.match(panel, /const CLIENT_DIRECTORY_SHEET_KEY = EFFECTIVE_WORKSPACE_RESOURCE_SPECS\.clientDirectorySheet\.envVar/);
  assert.match(panel, /href="\/settings\?section=google-workspace#workspace-stage-3"/);
  assert.match(panel, /Set up the Client Directory spreadsheet in Workspace Stage 3/);
  assert.doesNotMatch(panel, /process\.env|env\[[^\]]+\]/);

  assert.match(guide, /recorded mirror status revalidates automatically when the page opens, regains focus, becomes visible, or is reached through navigation; that status read never runs a sync/);
  assert.match(guide, /formats the recorded `lastSyncedAt` as a readable local date and time while showing `lastError` exactly as the mirror status returned it/);
  assert.match(guide, /`GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID` remains a bootstrap fallback/);
  assert.match(guide, /Google Workspace → Stage 3/);
});
