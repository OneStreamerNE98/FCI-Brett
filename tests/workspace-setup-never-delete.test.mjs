import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);

const REQUIRED_SETUP_PROVIDER_CAPABILITIES = Object.freeze({
  "app/api/v1/integrations/google/drive/shared-drive/adopt/route.ts": Object.freeze([
    "client.getSharedDrive(",
    "client.findSharedDriveByName(",
  ]),
  "app/api/v1/integrations/google/drive/verify/route.ts": Object.freeze([
    "drive.verifyRootFolder(",
  ]),
  "app/api/v1/integrations/google/drive/folders/ensure-roots/route.ts": Object.freeze([
    "drive.ensureBlueprintFolder(",
  ]),
  "app/api/v1/integrations/google/sheets/ensure/route.ts": Object.freeze([
    "drive.ensureBlueprintSpreadsheet(",
    "prepareGoogleDirectorySpreadsheet(",
    "prepareGoogleImportSpreadsheet(",
  ]),
  "app/api/v1/integrations/google/drive/templates/ensure/route.ts": Object.freeze([
    "drive.ensureBlueprintFolder(",
    "drive.findOrUploadManagedFile(",
  ]),
  "app/api/v1/integrations/google/drive/folders/rename/route.ts": Object.freeze([
    "drive.renameFolder(",
  ]),
  "app/api/v1/integrations/google/setup/reconcile/route.ts": Object.freeze([
    "discoverWorkspaceReconcileActual(",
  ]),
});

const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-setup-never-delete", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
const [
  { GoogleDriveClient },
  { GoogleCalendarClient },
  { GoogleGmailClient },
  { GoogleSheetsClient, prepareGoogleDirectorySpreadsheet, prepareGoogleImportSpreadsheet },
] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-drive.ts"),
  vite.ssrLoadModule("/app/lib/google-calendar-client.ts"),
  vite.ssrLoadModule("/app/lib/google-gmail.ts"),
  vite.ssrLoadModule("/app/lib/google-sheets.ts"),
]);

after(async () => {
  await vite.close();
});

const DESTRUCTIVE_SOURCE_RULES = Object.freeze([
  Object.freeze({
    label: "an outbound HTTP DELETE",
    pattern: /\bmethod\s*:\s*["'`]DELETE["'`]/giu,
  }),
  Object.freeze({
    label: "a Google delete or batchDelete endpoint",
    pattern: /["'`][^"'`\r\n]*(?::delete\b|\/(?:batch)?delete\b|batchDelete\b)[^"'`\r\n]*["'`]/giu,
  }),
  Object.freeze({
    label: "a Drive trash mutation",
    pattern: /\btrashed\s*:\s*true\b/giu,
  }),
  Object.freeze({
    label: "a Drive parent-removal mutation",
    pattern: /\bremoveParents\b/giu,
  }),
  Object.freeze({
    label: "a Sheets delete request",
    pattern: /\bdelete[A-Z][A-Za-z0-9]*\s*:/gu,
  }),
]);

async function source(relativePath) {
  return readFile(new URL(relativePath, rootUrl), "utf8");
}

async function discoverTypeScriptFiles(relativeDirectory) {
  const directoryUrl = new URL(`${relativeDirectory}/`, rootUrl);
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await discoverTypeScriptFiles(relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }
  return files;
}

async function loadSetupProviderCensus() {
  const integrationModules = await discoverTypeScriptFiles("app/api/v1/integrations/google");
  const providerModules = (await discoverTypeScriptFiles("app/lib"))
    .filter((relativePath) => (
      /\/google-[^/]+\.ts$/u.test(relativePath)
      || /\/(?:google-)?workspace-reconcile(?:-simulation)?\.ts$/u.test(relativePath)
    ));
  const sources = new Map();
  for (const relativePath of [...integrationModules, ...providerModules].sort()) {
    sources.set(relativePath, await source(relativePath));
  }
  return { integrationModules, providerModules, sources };
}

function assertCompleteSetupProviderCensus(census) {
  assert.ok(census.integrationModules.length > 0, "the Google integration module discovery cannot be empty");
  assert.ok(census.providerModules.length > 0, "the Google provider-module discovery cannot be empty");
  assert.deepEqual(
    [...census.sources.keys()].sort(),
    [...new Set([...census.integrationModules, ...census.providerModules])].sort(),
    "every discovered Google integration module and provider module must be scanned",
  );
  assert.deepEqual(
    census.integrationModules.filter((relativePath) => (
      /\b(?:globalThis\.)?fetch\s*\(/u.test(census.sources.get(relativePath) ?? "")
    )),
    [],
    "integration routes and helpers must keep every provider fetch in the exhaustively scanned Google client modules",
  );
  for (const [relativePath, capabilities] of Object.entries(REQUIRED_SETUP_PROVIDER_CAPABILITIES)) {
    const value = census.sources.get(relativePath);
    assert.equal(typeof value, "string", `${relativePath} must remain inside the discovered provider surface`);
    for (const capability of capabilities) {
      assert.equal(
        value.includes(capability),
        true,
        `${relativePath} must retain its censused setup capability ${capability}`,
      );
    }
  }
}

function destructiveSourceFindings(sourceByPath) {
  const findings = [];
  for (const [relativePath, value] of sourceByPath) {
    for (const rule of DESTRUCTIVE_SOURCE_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of value.matchAll(rule.pattern)) {
        findings.push(`${relativePath}: ${rule.label}: ${match[0]}`);
      }
    }
  }
  return findings;
}

function parseRecordedBody(body) {
  if (body === undefined || body === null || body === "") return null;
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function recordedBodyHasDeletion(value) {
  if (Array.isArray(value)) return value.some(recordedBodyHasDeletion);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => (
    (key === "trashed" && nested === true)
    || key === "removeParents"
    || /^delete[A-Z]/u.test(key)
    || recordedBodyHasDeletion(nested)
  ));
}

function assertRecordedSetupCallsNeverDelete(calls) {
  for (const call of calls) {
    const method = String(call.init?.method ?? "GET").toUpperCase();
    const url = String(call.input);
    assert.notEqual(method, "DELETE", `setup issued DELETE ${url}`);
    assert.doesNotMatch(
      url,
      /(?::delete\b|\/(?:batch)?delete\b|batchDelete\b)/iu,
      `setup called a Google delete endpoint: ${url}`,
    );
    assert.equal(
      recordedBodyHasDeletion(parseRecordedBody(call.init?.body)),
      false,
      `setup sent a destructive Google request body to ${url}`,
    );
  }
}

test("SET-18 discovers the complete Google integration route and provider-module surface", async () => {
  const census = await loadSetupProviderCensus();
  assertCompleteSetupProviderCensus(census);

  const [firstIntegrationModule] = census.integrationModules;
  const missingIntegrationModule = {
    ...census,
    sources: new Map(
      [...census.sources].filter(([relativePath]) => relativePath !== firstIntegrationModule),
    ),
  };
  assert.throws(
    () => assertCompleteSetupProviderCensus(missingIntegrationModule),
    /every discovered Google integration module/u,
    "removing one integration helper or route from the discovered source map must fail",
  );

  const missingModule = {
    ...census,
    sources: new Map(
      [...census.sources].filter(([relativePath]) => relativePath !== census.providerModules[0]),
    ),
  };
  assert.throws(
    () => assertCompleteSetupProviderCensus(missingModule),
    /every discovered Google integration module/u,
    "removing one provider module from the discovered source map must fail",
  );
});

test("the complete Google setup provider source surface contains no deletion operation", async () => {
  const census = await loadSetupProviderCensus();
  assertCompleteSetupProviderCensus(census);
  assert.deepEqual(destructiveSourceFindings(census.sources), []);
});

test("the setup no-delete source guard rejects every forbidden mutation shape", () => {
  const mutations = Object.freeze([
    'await fetch(url, { method: "DELETE" });',
    'await fetch(`${DRIVE_API}/files/${fileId}:delete`);',
    'await fetch(`${SHEETS_API}/spreadsheets/${id}:batchDelete`);',
    "body: JSON.stringify({ trashed: true })",
    "parameters.set('removeParents', parentId);",
    "requests: [{ deleteSheet: { sheetId: 123 } }]",
  ]);
  for (const mutation of mutations) {
    const findings = destructiveSourceFindings(new Map([["synthetic-setup-module.ts", mutation]]));
    assert.equal(findings.length, 1, `the planted deletion must fail the source guard: ${mutation}`);
  }
});

test("actual setup provider clients record only bounded non-delete calls", async () => {
  const calls = [];
  const folderMime = "application/vnd.google-apps.folder";
  const sheetMime = "application/vnd.google-apps.spreadsheet";
  const documentMime = "application/vnd.google-apps.document";
  let folderName = "01_Provider Drift";
  const driveItems = () => ({
    "workspace-root": {
      id: "workspace-root",
      name: "FCI Operations",
      mimeType: folderMime,
      parents: [],
      trashed: false,
      webViewLink: "https://drive.google.test/workspace-root",
      appProperties: {},
    },
    "folder-client-accounts": {
      id: "folder-client-accounts",
      name: folderName,
      mimeType: folderMime,
      parents: ["workspace-root"],
      trashed: false,
      webViewLink: "https://drive.google.test/folder-client-accounts",
      appProperties: { fciRootKey: "client-accounts" },
    },
    "sheet-client-directory": {
      id: "sheet-client-directory",
      name: "FCI Operations Directory",
      mimeType: sheetMime,
      parents: ["workspace-root"],
      trashed: false,
      webViewLink: "https://drive.google.test/sheet-client-directory",
      appProperties: { fciResourceKind: "client-directory" },
    },
    "template-estimate": {
      id: "template-estimate",
      name: "Estimate Proposal",
      mimeType: documentMime,
      parents: ["workspace-root"],
      trashed: false,
      webViewLink: "https://drive.google.test/template-estimate",
      appProperties: { fciTemplateKey: "estimate-proposal" },
    },
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ input: String(input), init: { ...init } });
    const method = String(init.method ?? "GET").toUpperCase();

    if (url.origin === "https://www.googleapis.com" && url.pathname === "/drive/v3/drives/shared-drive") {
      return Response.json({
        id: "shared-drive",
        name: "FCI Operations",
        restrictions: { domainUsersOnly: true, driveMembersOnly: true },
      });
    }
    if (url.origin === "https://www.googleapis.com" && url.pathname === "/drive/v3/drives") {
      return Response.json({
        drives: [{
          id: "shared-drive",
          name: "FCI Operations",
          restrictions: { domainUsersOnly: true, driveMembersOnly: true },
        }],
      });
    }
    if (url.origin === "https://www.googleapis.com" && url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const items = driveItems();
      if (query.includes("fciRootKey") && query.includes("client-accounts")) {
        return Response.json({ files: [items["folder-client-accounts"]] });
      }
      if (query.includes("fciWorkspaceFolder")) return Response.json({ files: [] });
      if (query.includes("fciResourceKind") && query.includes("client-directory")) {
        return Response.json({ files: [items["sheet-client-directory"]] });
      }
      if (query.includes("fciTemplateKey") && query.includes("estimate-proposal")) {
        return Response.json({ files: [items["template-estimate"]] });
      }
      if (query.includes("'workspace-root' in parents")) {
        return Response.json({
          files: [
            items["folder-client-accounts"],
            items["sheet-client-directory"],
            items["template-estimate"],
          ],
        });
      }
      return Response.json({ files: [] });
    }
    const driveFileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/u)?.[1];
    if (url.origin === "https://www.googleapis.com" && driveFileId) {
      const decoded = decodeURIComponent(driveFileId);
      const item = driveItems()[decoded];
      assert.ok(item, `unexpected Drive fixture id ${decoded}`);
      if (method === "PATCH") {
        folderName = JSON.parse(String(init.body)).name;
        return Response.json({ ...item, name: folderName });
      }
      return Response.json(item);
    }
    if (url.origin === "https://sheets.googleapis.com") {
      if (method === "GET" && !url.pathname.includes("/values/")) {
        return Response.json({
          sheets: [
            { properties: { sheetId: 1, title: "Client Directory", gridProperties: { rowCount: 1000, columnCount: 11 } } },
            { properties: { sheetId: 2, title: "Project Register", gridProperties: { rowCount: 1000, columnCount: 12 } } },
            { properties: { sheetId: 3, title: "Clients Import", gridProperties: { rowCount: 1000, columnCount: 8 } } },
            { properties: { sheetId: 4, title: "Projects Import", gridProperties: { rowCount: 1000, columnCount: 11 } } },
          ],
        });
      }
      if (method === "GET") return Response.json({ values: [] });
      return Response.json({ replies: [], totalUpdatedRows: 2 });
    }
    if (url.origin === "https://gmail.googleapis.com") {
      if (url.pathname === "/gmail/v1/users/me/labels" && method === "GET") {
        return Response.json({ labels: [] });
      }
      if (url.pathname === "/gmail/v1/users/me/labels" && method === "POST") {
        const label = JSON.parse(String(init.body));
        return Response.json({ id: `label-${label.name}`, name: label.name, type: "user" });
      }
      if (url.pathname === "/gmail/v1/users/me/messages/send" && method === "POST") {
        return Response.json({ id: "sent-test-message", threadId: "sent-test-thread", labelIds: ["SENT"] });
      }
    }
    if (
      url.origin === "https://www.googleapis.com"
      && url.pathname.includes("/calendar/v3/calendars/")
      && url.pathname.endsWith("/events")
    ) {
      if (method === "GET" && url.searchParams.get("fields")?.includes("summary")) {
        return Response.json({
          summary: "FCI Appointments",
          timeZone: "America/New_York",
          items: [],
        });
      }
      if (method === "GET") return Response.json({ items: [] });
      return Response.json({
        id: "test-hold",
        summary: "FCI Operations — Workspace test appointment",
        status: "confirmed",
        htmlLink: "https://calendar.google.test/test-hold",
        start: { dateTime: "2026-07-25T14:00:00.000Z" },
        end: { dateTime: "2026-07-25T14:30:00.000Z" },
      });
    }
    if (url.origin === "https://www.googleapis.com" && url.pathname.includes("/calendar/v3/calendars/")) {
      return Response.json({
        id: "appointments@example.com",
        summary: "FCI Appointments",
        timeZone: "America/New_York",
      });
    }
    throw new Error(`Unexpected recorded setup provider call: ${method} ${url}`);
  };

  const drive = new GoogleDriveClient("test-token", {
    enabledServices: ["drive"],
    oauthReady: true,
    drive: { mode: "shared-drive", rootFolderId: "workspace-root" },
  }, fetcher);
  await drive.getSharedDrive("shared-drive");
  await drive.findSharedDriveByName("FCI Operations");
  await drive.verifyRootFolder();
  await drive.ensureBlueprintFolder({
    parentId: "workspace-root",
    key: "client-accounts",
    name: "01_Client Accounts",
  });
  await drive.ensureBlueprintSpreadsheet({
    parentId: "workspace-root",
    key: "client-directory",
    name: "FCI Operations Directory",
  });
  await drive.findOrUploadManagedFile({
    parentId: "workspace-root",
    appProperties: { fciTemplateKey: "estimate-proposal" },
    name: "Estimate Proposal",
    mimeType: documentMime,
    bytes: new Uint8Array([1]),
  });
  await drive.renameFolder("folder-client-accounts", "01_Client Accounts");
  await drive.listSetupChildren("workspace-root");
  await drive.findSetupItemsByIdentity("fciRootKey", "client-accounts");
  await drive.getSetupItem("sheet-client-directory");

  const sheets = new GoogleSheetsClient("test-token", "sheet-client-directory", fetcher);
  await prepareGoogleDirectorySpreadsheet(sheets);
  await prepareGoogleImportSpreadsheet(sheets);
  const gmail = new GoogleGmailClient("test-token", fetcher);
  await gmail.prepareFciLabels();
  await gmail.sendTestMessage({
    recipient: "admincrm@cherryhillfci.com",
    subject: "FCI TEST setup verification",
    body: "FCI TEST — DO NOT USE",
  });
  const calendar = new GoogleCalendarClient("test-token", {
    enabledServices: ["calendar"],
    clientAppointmentsCalendarId: "appointments@example.com",
    oauthReady: true,
  }, {
    fetch: fetcher,
    now: () => new Date("2026-07-25T12:00:00.000Z"),
  });
  await calendar.getCalendarMetadata("appointments@example.com");
  await calendar.listUpcomingEvents();
  await calendar.createTestHold(new Date("2026-07-25T14:00:00.000Z"));

  assert.ok(calls.length > 25, "the recorder must observe the real setup client surface");
  assert.ok(calls.some(({ init }) => init.method === "PATCH"), "the recorder must include provider rename mutation");
  assert.ok(calls.some(({ input }) => input.startsWith("https://sheets.googleapis.com/")), "the recorder must include Sheets setup calls");
  assert.ok(calls.some(({ input }) => input.startsWith("https://gmail.googleapis.com/")), "the recorder must include Gmail setup calls");
  assert.ok(calls.some(({ input }) => input.includes("/calendar/v3/")), "the recorder must include Calendar setup calls");
  assertRecordedSetupCallsNeverDelete(calls);
});

test("recorded setup provider calls reject destructive methods, endpoints, and nested request bodies", () => {
  const safeCalls = Object.freeze([
    Object.freeze({
      input: "https://www.googleapis.com/drive/v3/files?q=trashed%20%3D%20false",
      init: Object.freeze({ method: "GET" }),
    }),
    Object.freeze({
      input: "https://www.googleapis.com/drive/v3/files/folder-id",
      init: Object.freeze({
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed from the reviewed blueprint" }),
      }),
    }),
    Object.freeze({
      input: "https://sheets.googleapis.com/v4/spreadsheets/sheet-id:batchUpdate",
      init: Object.freeze({
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "Clients" } } }] }),
      }),
    }),
  ]);
  assert.doesNotThrow(() => assertRecordedSetupCallsNeverDelete(safeCalls));

  const mutations = Object.freeze([
    Object.freeze({ input: "https://www.googleapis.com/drive/v3/files/id", init: { method: "DELETE" } }),
    Object.freeze({ input: "https://www.googleapis.com/drive/v3/files/id:delete", init: { method: "POST" } }),
    Object.freeze({
      input: "https://www.googleapis.com/drive/v3/files/id",
      init: { method: "PATCH", body: JSON.stringify({ trashed: true }) },
    }),
    Object.freeze({
      input: "https://www.googleapis.com/drive/v3/files/id",
      init: { method: "PATCH", body: JSON.stringify({ removeParents: "managed-root" }) },
    }),
    Object.freeze({
      input: "https://sheets.googleapis.com/v4/spreadsheets/id:batchUpdate",
      init: { method: "POST", body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: 123 } }] }) },
    }),
  ]);
  for (const mutation of mutations) {
    assert.throws(
      () => assertRecordedSetupCallsNeverDelete([mutation]),
      /setup (?:issued|called|sent)/u,
      `the planted recorded call must fail the no-delete assertion: ${JSON.stringify(mutation)}`,
    );
  }
});
