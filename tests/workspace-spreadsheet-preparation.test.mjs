import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-spreadsheet-preparation", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24741 } },
});
const sheetsModule = await vite.ssrLoadModule("/app/lib/google-sheets.ts");
const {
  GOOGLE_IMPORT_CLIENTS_TAB,
  GOOGLE_IMPORT_PROJECTS_TAB,
  GoogleSheetsClient,
  prepareGoogleDirectorySpreadsheet,
  prepareGoogleImportSpreadsheet,
} = sheetsModule;

after(async () => {
  await vite.close();
});

function preparationFetcher(initialTabs = []) {
  const tabs = new Map(initialTabs.map((title, index) => [title, index + 1]));
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });

    if (url.pathname.endsWith("/workspace-sheet") && method === "GET") {
      return Response.json({ sheets: [...tabs].map(([title, sheetId]) => ({ properties: { title, sheetId } })) });
    }
    if (url.pathname.endsWith("/workspace-sheet:batchUpdate") && method === "POST") {
      for (const request of body.requests ?? []) {
        const title = request.addSheet?.properties?.title;
        if (title && !tabs.has(title)) tabs.set(title, tabs.size + 1);
      }
      return Response.json({ replies: [] });
    }
    if (url.pathname.includes("/workspace-sheet/values/") && method === "GET") return Response.json({ values: [] });
    if (url.pathname.endsWith("/workspace-sheet/values:batchUpdate") && method === "POST") return Response.json({ totalUpdatedRows: 2 });
    throw new Error(`Unexpected Sheets request: ${method} ${url}`);
  };
  return { calls, fetcher, tabs };
}

test("directory preparation creates mirror tabs and headers without syncing rows", async () => {
  const fixture = preparationFetcher();
  const client = new GoogleSheetsClient("test-token", "workspace-sheet", fixture.fetcher);

  await prepareGoogleDirectorySpreadsheet(client);

  assert.deepEqual([...fixture.tabs.keys()], ["Client Directory", "Project Register"]);
  const addTabs = fixture.calls.find((call) => call.url.pathname.endsWith(":batchUpdate") && call.body.requests?.some((request) => request.addSheet));
  assert.deepEqual(addTabs.body.requests.map((request) => request.addSheet.properties.title), ["Client Directory", "Project Register"]);
  const headerWrite = fixture.calls.find((call) => call.url.pathname.endsWith("/values:batchUpdate"));
  assert.deepEqual(headerWrite.body.data.map((item) => item.range), ["'Client Directory'!A1:K1", "'Project Register'!A1:L1"]);
  assert.equal(fixture.calls.some((call) => /A2|append|clear/u.test(call.url.pathname + call.url.search)), false);
});

test("import preparation creates only the clearly marked entity tabs and is idempotent", async () => {
  const fixture = preparationFetcher();
  const client = new GoogleSheetsClient("test-token", "workspace-sheet", fixture.fetcher);

  await prepareGoogleImportSpreadsheet(client);
  const callsAfterFirst = fixture.calls.length;
  await prepareGoogleImportSpreadsheet(client);

  assert.deepEqual([...fixture.tabs.keys()], [GOOGLE_IMPORT_CLIENTS_TAB, GOOGLE_IMPORT_PROJECTS_TAB]);
  const writes = fixture.calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.requests.map((request) => request.addSheet.properties.title), ["Clients Import", "Projects Import"]);
  assert.equal(fixture.calls.slice(callsAfterFirst).length, 1);
});
