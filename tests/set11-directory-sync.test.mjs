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

test("SET-11 status revalidates automatically without triggering a sync", async () => {
  const [directoryController, panel, route] = await Promise.all([
    read("app/application/use-directory-data.ts"),
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/api/v1/integrations/google/sheets/status/route.ts"),
  ]);

  // SET-42 retires the pure status button. The mounted directory reader now
  // includes the no-store route in the shared lifecycle census.
  assert.match(directoryController, /const DIRECTORY_GET_URLS = \[[\s\S]*"\/api\/v1\/integrations\/google\/sheets\/status"/);
  assert.match(directoryController, /useCachedGetSubscription\(DIRECTORY_GET_URLS, \(\) => refreshDirectoryData\(true\)\)/);

  // The client path that reads mirror status is now refreshDirectoryData. The
  // SET-11 guarantee is unchanged and is asserted against that path directly,
  // not merely inferred from a URL appearing in a list: reading the recorded
  // mirror state can never write. Nothing in this reader may reach the sync
  // endpoint or issue a non-GET request.
  const statusRead = section(
    directoryController,
    "const refreshDirectoryData = useCallback(",
    "}, [onTerminalFailure, userEmail, userName]);",
    "directory status read",
  );
  assert.match(statusRead, /cachedGetJson<Record<string, unknown>>\(path, \{ force \}\)/);
  assert.match(statusRead, /getJson\("\/api\/v1\/integrations\/google\/sheets\/status"\)/);
  assert.match(statusRead, /setSheetMirror\(/);
  assert.doesNotMatch(statusRead, /onSync|\/sync|method: "POST"/);
  assert.doesNotMatch(statusRead, /\bfetch\(/);

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
    read("docs/guides/settings-guide.md"),
  ]);

  assert.match(panel, /const CLIENT_DIRECTORY_SHEET_KEY = EFFECTIVE_WORKSPACE_RESOURCE_SPECS\.clientDirectorySheet\.envVar/);
  assert.match(panel, /href="\/settings\?section=google-workspace#workspace-stage-3"/);
  assert.match(panel, /Set up the Client Directory spreadsheet in Workspace Stage 3/);
  assert.doesNotMatch(panel, /process\.env|env\[[^\]]+\]/);

  assert.match(guide, /recorded\s+mirror\s+status\s+revalidates\s+automatically\s+when\s+the\s+page\s+opens,\s+regains\s+focus,\s+becomes\s+visible,\s+or\s+is\s+reached\s+through\s+navigation;\s+that\s+status\s+read\s+never\s+runs\s+a\s+sync/);
  assert.match(guide, /formats\s+the\s+recorded\s+`lastSyncedAt`\s+as\s+a\s+readable\s+local\s+date\s+and\s+time\s+while\s+showing\s+`lastError`\s+exactly\s+as\s+the\s+mirror\s+status\s+returned\s+it/);
  assert.match(guide, /`GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID`\s+remains\s+a\s+bootstrap\s+fallback/);
  assert.match(guide, /Google\s+Workspace\s+→\s+Stage\s+3/);
});
