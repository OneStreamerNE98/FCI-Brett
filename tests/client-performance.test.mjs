import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cachedGetJson,
  clearCachedGets,
  invalidateCachedGet,
} from "../app/lib/client-get-cache.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("deduplicates in-flight client GETs, reuses fresh data, and invalidates explicitly", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ request: requests }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const [first, second] = await Promise.all([
      cachedGetJson("/api/test-cache"),
      cachedGetJson("/api/test-cache"),
    ]);
    const cached = await cachedGetJson("/api/test-cache");

    assert.equal(requests, 1);
    assert.deepEqual(first, { request: 1 });
    assert.deepEqual(second, first);
    assert.deepEqual(cached, first);

    invalidateCachedGet("/api/test-cache");
    assert.deepEqual(await cachedGetJson("/api/test-cache"), { request: 2 });
    assert.equal(requests, 2);
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("does not retain failed client GETs", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(requests === 1 ? "unavailable" : JSON.stringify({ ready: true }), {
        status: requests === 1 ? 503 : 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await assert.rejects(cachedGetJson("/api/test-retry"), /failed \(503\)/);
    assert.deepEqual(await cachedGetJson("/api/test-retry"), { ready: true });
    assert.equal(requests, 2);
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("keeps the bounded initial-load and rendering optimizations in place", async () => {
  const [app, css, dataSecurity, myAccount, googleWorkspace] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/globals.css"),
    read("app/settings/components/DataSecurityPanel.tsx"),
    read("app/settings/components/MyAccountPanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
  ]);
  const settingsSources = `${myAccount}\n${googleWorkspace}`;
  const rootComponent = app.slice(
    app.indexOf("export function FloorOpsApp"),
    app.indexOf("function LiveDataBanner"),
  );
  const overviewComponent = app.slice(
    app.indexOf("function Overview"),
    app.indexOf("function LeadsView"),
  );

  assert.match(app, /const currencyFormatter = new Intl\.NumberFormat/);
  assert.match(dataSecurity, /const PhoneInstallPanel = dynamic\(/);
  assert.match(dataSecurity, /import\("\.\.\/\.\.\/PhoneInstallPanel"\)/);
  assert.doesNotMatch(dataSecurity, /import \{ PhoneInstallPanel \} from/);
  assert.match(rootComponent, /void refreshDirectoryData\(\);\s*\}, \[refreshDirectoryData\]\)/);
  assert.doesNotMatch(rootComponent, /setTimeout\(\(\) => \{ void refreshDirectoryData/);
  assert.doesNotMatch(rootComponent, /currentTime|setCurrentTime/);
  assert.match(overviewComponent, /setInterval\(\(\) => setCurrentTime\(Date\.now\(\)\), 60_000\)/);
  assert.match(app, /for \(const project of projectItems\)/);
  assert.doesNotMatch(app, /clients\.map\(\(client\) => \[client\.id, projectItems\.filter/);
  assert.match(settingsSources, /cachedGetJson[^\n]+\("\/api\/v1\/settings\/me"/);
  assert.match(settingsSources, /cachedGetJson[^\n]+\("\/api\/v1\/google-workspace"/);
  assert.match(settingsSources, /invalidateCachedGet\("\/api\/v1\/settings\/me"\)/);
  assert.match(css, /\.operations-actionable-row,\.pipeline-row,[^\n]+\{content-visibility:auto\}/);
  assert.match(css, /contain-intrinsic-size:auto 68px/);
});
