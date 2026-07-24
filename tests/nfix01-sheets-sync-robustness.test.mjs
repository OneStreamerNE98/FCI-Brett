import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-nfix01-sheets-sync", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24746 } },
});
const sheets = await vite.ssrLoadModule("/app/lib/google-sheets.ts");

after(async () => {
  await vite.close();
});

const CLIENT_HEADERS = [
  "Client Code", "Client / Company", "Status", "Primary Contact", "Email", "Phone",
  "Client Folder Link", "Active Project Count", "Account Notes", "Last Updated", "FCI Client ID",
];
const PROJECT_HEADERS = [
  "FCI Project ID", "Project Number", "Project Name", "Client Code", "Client / Company", "Status",
  "Project Manager", "Site", "Estimated Value", "Project Folder Link", "Created", "Last Updated",
];

function liveConfig(connectionKey = "google-workspace") {
  return {
    simulation: false,
    connectionKey,
    clientDirectorySheetId: "directory-sheet",
    clientDirectorySheetIdInvalid: false,
    sheetsEnabled: true,
  };
}

function simulationConfig() {
  return {
    simulation: true,
    connectionKey: "workspace-simulation",
    clientDirectorySheetId: null,
    clientDirectorySheetIdInvalid: false,
    sheetsEnabled: true,
  };
}

function clientRow() {
  return {
    id: "client-1",
    code: "FCI-001",
    name: "FCI TEST — DO NOT USE",
    status: "active",
    industry: null,
    primaryContact: null,
    email: null,
    phone: null,
    driveUrl: null,
    projectCount: 0,
    updatedAt: 1_790_000_000_000,
  };
}

function projectRow() {
  return {
    id: "project-1",
    number: "PRJ-001",
    name: "FCI TEST — DO NOT USE",
    clientId: "client-1",
    clientCode: "FCI-001",
    clientName: "FCI TEST — DO NOT USE",
    status: "active",
    projectManager: null,
    site: null,
    estimatedValue: null,
    driveUrl: null,
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_100_000,
  };
}

function persistence({
  clients = [],
  projects = [],
  states = [],
  failFirstSyncingWrite = false,
  failFailedWrite = false,
} = {}) {
  const writes = [];
  let syncingWriteFailed = false;
  return {
    writes,
    adapter: {
      async loadClientRows() { return clients; },
      async loadProjectRows() { return projects; },
      async updateSyncState(input) {
        writes.push(input);
        if (failFirstSyncingWrite && input.status === "syncing" && !syncingWriteFailed) {
          syncingWriteFailed = true;
          throw new Error("Injected initial sync-state write failure");
        }
        if (failFailedWrite && input.status === "failed") {
          throw new Error("Injected failed-state bookkeeping write failure");
        }
      },
      async getSyncStates() { return states; },
    },
  };
}

function connectionScopedLeases() {
  const held = new Map();
  const acquisitions = [];
  const completions = [];
  const failures = [];
  return {
    held,
    acquisitions,
    completions,
    failures,
    async acquireSyncLease(input) {
      acquisitions.push(input);
      if (held.has(input.connectionKey)) return null;
      const lease = {
        operationKey: `${input.connectionKey}:setup:sheets-directory-sync`,
        leaseExpiresAt: input.now + 5 * 60 * 1_000,
      };
      held.set(input.connectionKey, lease);
      return lease;
    },
    async completeSyncLease(lease) {
      assert.equal(held.get(lease.operationKey.split(":setup:")[0]), lease);
      held.delete(lease.operationKey.split(":setup:")[0]);
      completions.push(lease);
    },
    async failSyncLease(lease, errorCode) {
      assert.equal(held.get(lease.operationKey.split(":setup:")[0]), lease);
      held.delete(lease.operationKey.split(":setup:")[0]);
      failures.push({ lease, errorCode });
    },
  };
}

function sheetProvider({
  pauseFirstDirectoryRead = false,
  failProjectReplacement = false,
  initialProjectRows = [["legacy-project", "Legacy row remains visible"]],
} = {}) {
  let releaseFirstDirectoryRead;
  let markFirstDirectoryRead;
  const firstDirectoryRead = new Promise((resolve) => {
    markFirstDirectoryRead = resolve;
  });
  const releaseDirectoryRead = new Promise((resolve) => {
    releaseFirstDirectoryRead = resolve;
  });
  let directoryReads = 0;
  let appendCalls = 0;
  let clearCalls = 0;
  let atomicReplacementAttempts = 0;
  let replacementRange = null;
  let projectRows = structuredClone(initialProjectRows);

  return {
    firstDirectoryRead,
    releaseFirstDirectoryRead,
    snapshot: () => ({
      appendCalls,
      clearCalls,
      atomicReplacementAttempts,
      replacementRange,
      projectRows: structuredClone(projectRows),
    }),
    async fetch(input, init = {}) {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      const path = decodeURIComponent(url.pathname);
      const body = init.body ? JSON.parse(String(init.body)) : null;

      if (method === "GET" && path === "/v4/spreadsheets/directory-sheet") {
        return Response.json({
          sheets: [
            { properties: { sheetId: 1, title: "Client Directory", gridProperties: { rowCount: 1000, columnCount: 11 } } },
            { properties: { sheetId: 2, title: "Project Register", gridProperties: { rowCount: 1000, columnCount: 12 } } },
          ],
        });
      }
      if (method === "GET" && path.includes("/values/")) {
        if (path.endsWith("A1:K1")) return Response.json({ values: [CLIENT_HEADERS] });
        if (path.endsWith("A1:L1")) return Response.json({ values: [PROJECT_HEADERS] });
        if (path.endsWith("A1:K1000")) {
          directoryReads += 1;
          if (pauseFirstDirectoryRead && directoryReads === 1) {
            markFirstDirectoryRead();
            await releaseDirectoryRead;
          }
          return Response.json({ values: [CLIENT_HEADERS] });
        }
      }
      if (method === "POST" && path.endsWith(":batchUpdate")) {
        const replacement = body.requests?.find((request) => request.updateCells);
        if (!replacement) return Response.json({ replies: [] });
        atomicReplacementAttempts += 1;
        replacementRange = structuredClone(replacement.updateCells.range);
        if (failProjectReplacement) {
          return Response.json({ error: { message: "Injected atomic replacement failure" } }, { status: 503 });
        }
        projectRows = (replacement.updateCells.rows ?? []).map((row) => (
          row.values.map((value) => value.userEnteredValue?.stringValue ?? "")
        ));
        return Response.json({ replies: [{}] });
      }
      if (method === "POST" && path.endsWith(":append")) {
        appendCalls += 1;
        return Response.json({ updates: { updatedRows: body.values?.length ?? 0 } });
      }
      if (method === "POST" && path.endsWith(":clear")) {
        clearCalls += 1;
        projectRows = [];
        return Response.json({ clearedRange: "Project Register" });
      }
      if (method === "PUT" && path.includes("Project Register")) {
        if (failProjectReplacement) {
          return Response.json({ error: { message: "Injected replacement write failure" } }, { status: 503 });
        }
        projectRows = body.values ?? [];
        return Response.json({ updatedRows: projectRows.length });
      }
      if (method === "POST" && path.endsWith("/values:batchUpdate")) {
        return Response.json({ totalUpdatedRows: body.data?.length ?? 0 });
      }
      throw new Error(`Unexpected Sheets request: ${method} ${url}`);
    },
  };
}

function dependencies({ provider, store, leases, now = 1_790_000_200_000 }) {
  return {
    persistence: store.adapter,
    fetch: provider.fetch,
    now: () => now,
    async getAccessToken() { return "FCI_TEST_ACCESS_TOKEN"; },
    async writeIntegrationEvent() {},
    acquireSyncLease: leases.acquireSyncLease,
    completeSyncLease: leases.completeSyncLease,
    failSyncLease: leases.failSyncLease,
  };
}

test("two overlapping live directory syncs for one connection cannot double-append", async () => {
  const provider = sheetProvider({ pauseFirstDirectoryRead: true });
  const store = persistence({ clients: [clientRow()] });
  const leases = connectionScopedLeases();
  const deps = dependencies({ provider, store, leases });

  const first = sheets.syncGoogleDirectory(liveConfig(), "admin@example.test", deps);
  await provider.firstDirectoryRead;

  await assert.rejects(
    sheets.syncGoogleDirectory(liveConfig(), "admin@example.test", deps),
    (error) => error?.code === "sheets_sync_in_progress" && error?.status === 409,
  );

  provider.releaseFirstDirectoryRead();
  const result = await first;

  assert.equal(result.clients.inserted, 1);
  assert.equal(provider.snapshot().appendCalls, 1);
  assert.equal(leases.acquisitions.length, 2);
  assert.equal(leases.completions.length, 1);
  assert.equal(leases.failures.length, 0);
  assert.equal(leases.held.size, 0);
});

test("an injected Project Register replacement failure leaves the prior rows visible", async () => {
  const provider = sheetProvider({ failProjectReplacement: true });
  const before = provider.snapshot().projectRows;
  const store = persistence({ projects: [projectRow()] });
  const leases = connectionScopedLeases();

  await assert.rejects(
    sheets.syncGoogleDirectory(
      liveConfig(),
      "admin@example.test",
      dependencies({ provider, store, leases }),
    ),
    (error) => error?.code === "sheets_request_failed",
  );

  const after = provider.snapshot();
  assert.deepEqual(after.projectRows, before);
  assert.equal(after.clearCalls, 0);
  assert.equal(after.atomicReplacementAttempts, 1);
  assert.equal(leases.completions.length, 0);
  assert.deepEqual(leases.failures.map(({ errorCode }) => errorCode), ["sheets_request_failed"]);
});

test("the atomic Project Register replacement clears stale tail rows with an open-ended range", async () => {
  const provider = sheetProvider({
    initialProjectRows: [
      ["legacy-project-1", "First stale row"],
      ["legacy-project-2", "Second stale row"],
    ],
  });
  const store = persistence();
  const leases = connectionScopedLeases();

  await sheets.syncGoogleDirectory(
    liveConfig(),
    "admin@example.test",
    dependencies({ provider, store, leases }),
  );

  const after = provider.snapshot();
  assert.deepEqual(after.projectRows, []);
  assert.deepEqual(after.replacementRange, {
    sheetId: 2,
    startRowIndex: 1,
    startColumnIndex: 0,
    endColumnIndex: 12,
  });
  assert.equal(Object.hasOwn(after.replacementRange, "endRowIndex"), false);
  assert.equal(after.clearCalls, 0);
  assert.equal(after.atomicReplacementAttempts, 1);
});

test("an initial syncing-state write failure releases the acquired live lease", async () => {
  const provider = sheetProvider();
  const store = persistence({ failFirstSyncingWrite: true });
  const leases = connectionScopedLeases();

  await assert.rejects(
    sheets.syncGoogleDirectory(
      liveConfig(),
      "admin@example.test",
      dependencies({ provider, store, leases }),
    ),
    /Injected initial sync-state write failure/,
  );

  assert.equal(provider.snapshot().appendCalls, 0);
  assert.equal(leases.completions.length, 0);
  assert.deepEqual(leases.failures.map(({ errorCode }) => errorCode), ["sheets_sync_failed"]);
  assert.equal(leases.held.size, 0);
});

test("stale live syncing reads recover to pending while fresh and simulation states stay unchanged", async () => {
  const now = 1_790_001_000_000;
  const stale = now - 6 * 60 * 1_000;
  const fresh = now - 1_000;
  const state = (lastAttemptAt) => ({
    entity_type: "clients",
    status: "syncing",
    last_synced_at: null,
    last_error_code: null,
    last_error_message: null,
    last_attempt_at: lastAttemptAt,
  });
  const statusFor = (config, lastAttemptAt) => sheets.getGoogleSheetMirrorStatus(
    config,
    { services: { sheets: true } },
    {
      persistence: persistence({ states: [state(lastAttemptAt)] }).adapter,
      now: () => now,
    },
    "app",
  );

  const recovered = await statusFor(liveConfig(), stale);
  const active = await statusFor(liveConfig(), fresh);
  const simulation = await statusFor(simulationConfig(), stale);

  assert.equal(recovered.clients.status, "pending");
  assert.equal(active.clients.status, "syncing");
  assert.equal(simulation.clients.status, "syncing");
});

test("a transient lease release after a fully successful live sync stays successful and records no failure", async () => {
  const provider = sheetProvider();
  const store = persistence({ clients: [clientRow()], projects: [projectRow()] });
  const events = [];
  let completeAttempts = 0;
  const failures = [];
  const leases = {
    async acquireSyncLease(input) {
      return {
        operationKey: `${input.connectionKey}:setup:sheets-directory-sync`,
        leaseExpiresAt: input.now + 5 * 60 * 1_000,
      };
    },
    async completeSyncLease() {
      completeAttempts += 1;
      throw new Error("Injected transient lease release failure");
    },
    async failSyncLease(lease, errorCode) {
      failures.push({ lease, errorCode });
    },
  };
  const deps = {
    ...dependencies({ provider, store, leases }),
    async writeIntegrationEvent(_config, eventType, _actor, entityType, entityId, detail) {
      events.push({ eventType, entityType, entityId, detail });
    },
  };

  const result = await sheets.syncGoogleDirectory(liveConfig(), "admin@example.test", deps);

  // The sync itself fully succeeded, so the caller still receives a success result.
  assert.equal(result.clients.inserted, 1);
  assert.equal(result.projects.total, 1);
  assert.equal(result.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/directory-sheet/edit");
  // The lease release was attempted; its transient failure was swallowed, never routed to failSyncLease.
  assert.equal(completeAttempts, 1);
  assert.equal(failures.length, 0);
  // Both entity states settled on 'synced' and were never flipped to 'failed'.
  const finalStatus = new Map();
  for (const write of store.writes) finalStatus.set(write.entityType, write.status);
  assert.equal(finalStatus.get("clients"), "synced");
  assert.equal(finalStatus.get("projects"), "synced");
  assert.equal(store.writes.some((write) => write.status === "failed"), false);
  // No false directory-failed integration event was emitted for a genuinely successful sync.
  assert.equal(events.some((event) => event.eventType === "sheets.directory.failed"), false);
  assert.equal(events.some((event) => event.eventType === "sheets.directory.synced"), true);
});

test("a failed sync whose failure bookkeeping also throws still surfaces the original sync error", async () => {
  const provider = sheetProvider({ failProjectReplacement: true });
  const store = persistence({ projects: [projectRow()], failFailedWrite: true });
  const leases = connectionScopedLeases();

  await assert.rejects(
    sheets.syncGoogleDirectory(
      liveConfig(),
      "admin@example.test",
      dependencies({ provider, store, leases }),
    ),
    (error) => error?.code === "sheets_request_failed" && !/bookkeeping/.test(error?.message ?? ""),
  );

  // The lease is still released with the ORIGINAL sync error code despite the bookkeeping throw.
  assert.deepEqual(leases.failures.map(({ errorCode }) => errorCode), ["sheets_request_failed"]);
  assert.equal(leases.completions.length, 0);
  assert.equal(leases.held.size, 0);
});

test("a failed sync whose lease release also rejects still surfaces the original sync error", async () => {
  const provider = sheetProvider({ failProjectReplacement: true });
  const store = persistence({ projects: [projectRow()] });
  const leases = connectionScopedLeases();
  const originalFailSyncLease = leases.failSyncLease;
  let failSyncLeaseAttempts = 0;
  leases.failSyncLease = async (lease, errorCode, now) => {
    failSyncLeaseAttempts += 1;
    await originalFailSyncLease(lease, errorCode, now);
    throw new Error("lease bookkeeping unavailable");
  };

  await assert.rejects(
    sheets.syncGoogleDirectory(
      liveConfig(),
      "admin@example.test",
      dependencies({ provider, store, leases }),
    ),
    (error) => error?.code === "sheets_request_failed" && !/lease bookkeeping/.test(error?.message ?? ""),
  );

  // The release was attempted; its rejection was swallowed so the caller saw the sync error.
  assert.equal(failSyncLeaseAttempts, 1);
});
