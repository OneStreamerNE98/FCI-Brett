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
  GOOGLE_IMPORT_CLIENT_HEADERS,
  GOOGLE_IMPORT_CLIENTS_TAB,
  GOOGLE_IMPORT_PROJECT_HEADERS,
  GOOGLE_IMPORT_PROJECTS_TAB,
  GoogleSheetsClient,
  prepareGoogleDirectorySpreadsheet,
  prepareGoogleImportSpreadsheet,
} = sheetsModule;

after(async () => {
  await vite.close();
});

function preparationFetcher({
  initialTabs = [],
  initialHeaders = {},
  initiallyFrozen = [],
  initialColumnCounts = {},
} = {}) {
  const tabs = new Map(initialTabs.map((title, index) => [title, {
    sheetId: index + 1,
    rowCount: 1000,
    columnCount: initialColumnCounts[title] ?? 20,
    frozenRowCount: initiallyFrozen.includes(title) ? 1 : 0,
  }]));
  const headers = new Map(
    Object.entries(initialHeaders).map(([title, values]) => [title, [...values]]),
  );
  const calls = [];
  const titleFromRange = (sheetRange) => (
    sheetRange.match(/^'((?:''|[^'])+)'!/u)?.[1]?.replace(/''/gu, "'") ?? ""
  );
  const columnNumber = (label) => [...label].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });

    if (url.pathname.endsWith("/workspace-sheet") && method === "GET") {
      return Response.json({
        sheets: [...tabs].map(([title, properties]) => ({
          properties: {
            title,
            sheetId: properties.sheetId,
            gridProperties: {
              rowCount: properties.rowCount,
              columnCount: properties.columnCount,
              frozenRowCount: properties.frozenRowCount,
            },
          },
        })),
      });
    }
    if (url.pathname.endsWith("/workspace-sheet:batchUpdate") && method === "POST") {
      for (const request of body.requests ?? []) {
        const added = request.addSheet?.properties;
        if (added?.title && !tabs.has(added.title)) {
          tabs.set(added.title, {
            sheetId: tabs.size + 1,
            rowCount: added.gridProperties?.rowCount ?? 1000,
            columnCount: added.gridProperties?.columnCount ?? 20,
            frozenRowCount: added.gridProperties?.frozenRowCount ?? 0,
          });
        }
        const updated = request.updateSheetProperties?.properties;
        if (updated?.sheetId) {
          const entry = [...tabs].find(([, properties]) => properties.sheetId === updated.sheetId);
          if (entry && updated.gridProperties?.frozenRowCount !== undefined) {
            entry[1].frozenRowCount = updated.gridProperties.frozenRowCount;
          }
        }
      }
      return Response.json({ replies: [] });
    }
    if (url.pathname.includes("/workspace-sheet/values/") && method === "GET") {
      const sheetRange = decodeURIComponent(url.pathname.split("/values/")[1]);
      const title = titleFromRange(sheetRange);
      const requestedEnd = sheetRange.match(/!A1:([A-Z]+)1$/u)?.[1];
      const tab = tabs.get(title);
      if (!tab || !requestedEnd) {
        throw new Error(`Unexpected header read range: ${sheetRange}`);
      }
      const requestedWidth = columnNumber(requestedEnd);
      if (requestedWidth > tab.columnCount) {
        throw new Error(
          `Out-of-grid header read ${sheetRange}: ${requestedWidth} > ${tab.columnCount}`,
        );
      }
      const header = headers.get(title);
      return Response.json({
        values: header ? [header.slice(0, requestedWidth)] : [],
      });
    }
    if (url.pathname.endsWith("/workspace-sheet/values:batchUpdate") && method === "POST") {
      for (const update of body.data ?? []) {
        const title = titleFromRange(update.range);
        if (title && update.values?.[0]) headers.set(title, [...update.values[0]]);
      }
      return Response.json({ totalUpdatedRows: body.data?.length ?? 0 });
    }
    throw new Error(`Unexpected Sheets request: ${method} ${url}`);
  };
  return { calls, fetcher, headers, tabs };
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
  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes[0].body.requests.map((request) => request.addSheet.properties),
    [
      {
        title: GOOGLE_IMPORT_CLIENTS_TAB,
        gridProperties: { rowCount: 1000, columnCount: GOOGLE_IMPORT_CLIENT_HEADERS.length },
      },
      {
        title: GOOGLE_IMPORT_PROJECTS_TAB,
        gridProperties: { rowCount: 1000, columnCount: GOOGLE_IMPORT_PROJECT_HEADERS.length },
      },
    ],
  );
  assert.deepEqual(writes[1].body.data, [
    {
      range: "'Clients Import'!A1:H1",
      values: [[...GOOGLE_IMPORT_CLIENT_HEADERS]],
    },
    {
      range: "'Projects Import'!A1:K1",
      values: [[...GOOGLE_IMPORT_PROJECT_HEADERS]],
    },
  ]);
  assert.deepEqual(
    writes[2].body.requests.map((request) => request.updateSheetProperties),
    [
      {
        properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
      {
        properties: { sheetId: 2, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    ],
  );
  assert.deepEqual(fixture.headers.get(GOOGLE_IMPORT_CLIENTS_TAB), [...GOOGLE_IMPORT_CLIENT_HEADERS]);
  assert.deepEqual(fixture.headers.get(GOOGLE_IMPORT_PROJECTS_TAB), [...GOOGLE_IMPORT_PROJECT_HEADERS]);
  assert.deepEqual(
    [...fixture.tabs.values()].map(({ frozenRowCount }) => frozenRowCount),
    [1, 1],
  );
  assert.equal(fixture.calls.slice(callsAfterFirst).length, 3);
  assert.equal(fixture.calls.slice(callsAfterFirst).every((call) => call.method === "GET"), true);
  assert.deepEqual(
    fixture.calls
      .filter((call) => call.url.pathname.includes("/values/"))
      .map((call) => decodeURIComponent(call.url.pathname.split("/values/")[1])),
    [
      "'Clients Import'!A1:H1",
      "'Projects Import'!A1:K1",
      "'Clients Import'!A1:H1",
      "'Projects Import'!A1:K1",
    ],
  );
});

test("import preparation accepts only exact closed headers and leaves a prepared sheet unchanged", async () => {
  const fixture = preparationFetcher({
    initialTabs: [GOOGLE_IMPORT_CLIENTS_TAB, GOOGLE_IMPORT_PROJECTS_TAB],
    initialHeaders: {
      [GOOGLE_IMPORT_CLIENTS_TAB]: [...GOOGLE_IMPORT_CLIENT_HEADERS],
      [GOOGLE_IMPORT_PROJECTS_TAB]: [...GOOGLE_IMPORT_PROJECT_HEADERS],
    },
    initiallyFrozen: [GOOGLE_IMPORT_CLIENTS_TAB, GOOGLE_IMPORT_PROJECTS_TAB],
  });
  const client = new GoogleSheetsClient("test-token", "workspace-sheet", fixture.fetcher);

  await prepareGoogleImportSpreadsheet(client);

  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.calls.every((call) => call.method === "GET"), true);
});

test("import preparation rejects changed and extra headers on both closed schemas", async (t) => {
  const schemas = [
    [GOOGLE_IMPORT_CLIENTS_TAB, GOOGLE_IMPORT_CLIENT_HEADERS],
    [GOOGLE_IMPORT_PROJECTS_TAB, GOOGLE_IMPORT_PROJECT_HEADERS],
  ];
  for (const [title, expected] of schemas) {
    for (const mutation of ["changed", "extra"]) {
      await t.test(`${title}: ${mutation} header`, async () => {
        const mutated = mutation === "extra"
          ? [...expected, "Unexpected"]
          : expected.map((header, index) => index === 1 ? `${header} changed` : header);
        const otherTitle = title === GOOGLE_IMPORT_CLIENTS_TAB
          ? GOOGLE_IMPORT_PROJECTS_TAB
          : GOOGLE_IMPORT_CLIENTS_TAB;
        const otherHeaders = title === GOOGLE_IMPORT_CLIENTS_TAB
          ? GOOGLE_IMPORT_PROJECT_HEADERS
          : GOOGLE_IMPORT_CLIENT_HEADERS;
        const fixture = preparationFetcher({
          initialTabs: [GOOGLE_IMPORT_CLIENTS_TAB, GOOGLE_IMPORT_PROJECTS_TAB],
          initialHeaders: {
            [title]: mutated,
            [otherTitle]: [...otherHeaders],
          },
          initialColumnCounts: {
            [title]: mutated.length,
            [otherTitle]: otherHeaders.length,
          },
        });
        const client = new GoogleSheetsClient(
          "test-token",
          "workspace-sheet",
          fixture.fetcher,
        );

        await assert.rejects(
          prepareGoogleImportSpreadsheet(client),
          (error) => (
            error?.code === "import_sheet_schema_mismatch"
            && error?.status === 409
            && error.message.includes(`${title} tab headers`)
          ),
        );
        assert.equal(
          fixture.calls.filter((call) => call.method !== "GET").length,
          0,
        );
      });
    }
  }
});

test("Sheets client errors describe the requested Workspace spreadsheet generically", async () => {
  for (const [status, code] of [[403, "sheets_permission_denied"], [404, "sheets_not_found"]]) {
    const client = new GoogleSheetsClient(
      "test-token",
      "workspace-sheet",
      async () => Response.json({ error: "fixture" }, { status }),
    );
    await assert.rejects(
      client.values("'Clients Import'!A1:Z1"),
      (error) => (
        error?.code === code
        && /Workspace spreadsheet/u.test(error.message)
        && !/Client Directory/u.test(error.message)
      ),
    );
  }
});
