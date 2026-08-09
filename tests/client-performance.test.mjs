import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cachedGetJson,
  clearCachedGets,
  invalidateCachedGet,
  invalidateCachedGetPrefix,
  invalidateTaskReadCaches,
  revalidateSubscribedCachedGets,
  subscribeCachedGet,
} from "../app/lib/client-get-cache.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function sourceSection(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${label} start marker must remain present`);
  assert.notEqual(endIndex, -1, `${label} end marker must remain present`);
  assert.ok(endIndex > startIndex, `${label} markers must remain ordered`);
  return source.slice(startIndex, endIndex);
}

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

test("serves an expired value immediately while one background request revalidates it", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let finishRevalidation;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({ request: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Promise((resolve) => {
        finishRevalidation = () => resolve(new Response(JSON.stringify({ request: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      });
    };

    assert.deepEqual(await cachedGetJson("/api/test-stale", { ttlMs: 0 }), { request: 1 });
    assert.deepEqual(await cachedGetJson("/api/test-stale", { ttlMs: 0 }), { request: 1 });
    assert.deepEqual(await cachedGetJson("/api/test-stale", { ttlMs: 0 }), { request: 1 });
    assert.equal(requests, 2, "concurrent stale reads must share one background request");

    finishRevalidation();
    assert.deepEqual(
      await cachedGetJson("/api/test-stale", { force: true, ttlMs: 60_000 }),
      { request: 2 },
    );
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("focus/navigation revalidation targets mounted readers and remains single-flight", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let finishRevalidation;
  let notifications = 0;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({ request: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Promise((resolve) => {
        finishRevalidation = () => resolve(new Response(JSON.stringify({ request: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      });
    };

    await cachedGetJson("/api/test-active-reader");
    const unsubscribe = subscribeCachedGet("/api/test-active-reader", () => {
      notifications += 1;
    });
    const first = revalidateSubscribedCachedGets();
    const second = revalidateSubscribedCachedGets();
    assert.equal(requests, 2, "concurrent navigation triggers must join one request");
    finishRevalidation();
    await Promise.all([first, second]);
    assert.equal(notifications, 1);
    unsubscribe();

    await revalidateSubscribedCachedGets();
    assert.equal(requests, 2, "unmounted readers must not be revalidated");
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("a lifecycle subscriber consumes the refreshed cache without forcing a second GET", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let observed = null;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ request: requests }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await cachedGetJson("/api/test-subscriber");
    const observedFreshValue = new Promise((resolve) => {
      const unsubscribe = subscribeCachedGet("/api/test-subscriber", () => {
        void cachedGetJson("/api/test-subscriber").then((value) => {
          observed = value;
          unsubscribe();
          resolve();
        });
      });
    });
    await revalidateSubscribedCachedGets();
    await observedFreshValue;

    assert.equal(requests, 2, "the subscription callback must not force a third request");
    assert.deepEqual(observed, { request: 2 });
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("an initial fill settles through its initiating reader and only revalidation notifies", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let notifications = 0;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ request: requests }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const unsubscribe = subscribeCachedGet("/api/test-initial-settlement", () => {
      notifications += 1;
    });

    await cachedGetJson("/api/test-initial-settlement");
    assert.equal(notifications, 0, "an initial reader must not supersede itself through its subscription");
    await cachedGetJson("/api/test-initial-settlement", { force: true });
    assert.equal(requests, 2);
    assert.equal(notifications, 1, "a replacement value must notify mounted readers");
    unsubscribe();
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("a quiet mutation invalidation delivers the first lifecycle revalidation", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let notifications = 0;
  let observed = null;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ request: requests }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await cachedGetJson("/api/test-quiet-invalidation");
    const refreshed = new Promise((resolve) => {
      const unsubscribe = subscribeCachedGet("/api/test-quiet-invalidation", () => {
        notifications += 1;
        void cachedGetJson("/api/test-quiet-invalidation").then((value) => {
          observed = value;
          unsubscribe();
          resolve();
        });
      });
    });

    invalidateCachedGet("/api/test-quiet-invalidation", { notify: false });
    assert.equal(notifications, 0, "the local mutation response remains authoritative until lifecycle revalidation");
    await revalidateSubscribedCachedGets();
    await refreshed;

    assert.equal(requests, 2);
    assert.equal(notifications, 1, "the first lifecycle read must reach the mounted subscriber");
    assert.deepEqual(observed, { request: 2 });
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("a subscriber mounted during a slow lifecycle sweep receives one trailing census", async () => {
  const originalFetch = globalThis.fetch;
  const requests = new Map();
  let finishFirstRevalidation;

  try {
    clearCachedGets();
    globalThis.fetch = async (input) => {
      const url = String(input);
      const count = (requests.get(url) ?? 0) + 1;
      requests.set(url, count);
      if (url === "/api/test-route-a" && count === 2) {
        return new Promise((resolve) => {
          finishFirstRevalidation = () => resolve(new Response(JSON.stringify({ count }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        });
      }
      return new Response(JSON.stringify({ count }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await cachedGetJson("/api/test-route-a");
    await cachedGetJson("/api/test-route-b");
    const unsubscribeA = subscribeCachedGet("/api/test-route-a", () => {});
    const sweep = revalidateSubscribedCachedGets();
    const sameSweep = revalidateSubscribedCachedGets();
    unsubscribeA();
    const unsubscribeB = subscribeCachedGet("/api/test-route-b", () => {});
    finishFirstRevalidation();
    await Promise.all([sweep, sameSweep]);

    assert.equal(requests.get("/api/test-route-a"), 2, "the departed route is not fetched again by the trailing census");
    assert.equal(requests.get("/api/test-route-b"), 2, "the destination subscriber is included exactly once");
    unsubscribeB();
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("task invalidation clears every query plus the Today projection without touching unrelated data", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  try {
    clearCachedGets();
    globalThis.fetch = async (url) => {
      requests += 1;
      return new Response(JSON.stringify({ url: String(url), request: requests }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const urls = ["/api/v1/tasks?status=open", "/api/v1/tasks/task-200", "/api/v1/assistant/today"];
    await Promise.all(urls.map((url) => cachedGetJson(url)));
    await cachedGetJson("/api/v1/projects");
    invalidateTaskReadCaches();
    const values = await Promise.all(urls.map((url) => cachedGetJson(url)));
    assert.equal(requests, 7, "task queries and Today refetch while the unrelated cache remains intact");
    assert.deepEqual(values.map((value) => value.url), urls);
    await cachedGetJson("/api/v1/projects");
    assert.equal(requests, 7);
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("sliding-window cache replacement evicts obsolete query keys without notifying readers", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let notifications = 0;

  try {
    clearCachedGets();
    globalThis.fetch = async (url) => {
      requests += 1;
      return new Response(JSON.stringify({ url: String(url), request: requests }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const oldWindow = "/api/v1/admin/audit?from=1&before=2";
    const currentWindow = "/api/v1/admin/audit?from=3&before=4";
    await cachedGetJson(oldWindow);
    await cachedGetJson(currentWindow);
    const unsubscribe = subscribeCachedGet(oldWindow, () => { notifications += 1; });

    invalidateCachedGetPrefix("/api/v1/admin/audit?", { notify: false });
    assert.equal(notifications, 0, "sliding-window eviction must not recursively reload the retired key");
    await cachedGetJson(oldWindow);
    assert.equal(requests, 3, "the retired window was evicted instead of accumulating in cache");
    unsubscribe();
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("authorization denials evict stale privileged data and notify without retrying", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let deny = false;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      requests += 1;
      return deny
        ? new Response(JSON.stringify({ error: "employee_session_required" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({ data: { privileged: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    };

    await cachedGetJson("/api/v1/admin/access");
    deny = true;
    const observedDenial = new Promise((resolve) => {
      const unsubscribe = subscribeCachedGet("/api/v1/admin/access", () => {
        void cachedGetJson("/api/v1/admin/access").catch((error) => {
          unsubscribe();
          resolve(error);
        });
      });
    });
    await revalidateSubscribedCachedGets();
    const denial = await observedDenial;

    assert.equal(denial.status, 401);
    assert.equal(requests, 2, "the denial notification must consume terminal cache state");
    await assert.rejects(
      cachedGetJson("/api/v1/admin/access"),
      (error) => error.status === 401,
      "a remount must see the denial instead of stale privileged data",
    );
    assert.equal(requests, 2, "a remount must not start a denial retry loop");
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

test("keeps the bounded initial-load and rendering optimizations in place", async () => {
  const [app, directoryController, recordDisplay, css, dataSecurity, myAccount, googleWorkspace] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/application/use-directory-data.ts"),
    read("app/lib/record-display.ts"),
    read("app/globals.css"),
    read("app/settings/components/DataSecurityPanel.tsx"),
    read("app/settings/components/MySettingsPanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
  ]);
  const settingsSources = `${myAccount}\n${googleWorkspace}`;
  const rootComponent = sourceSection(
    app,
    "export function FloorOpsApp",
    "function LiveDataBanner",
    "FloorOpsApp root component",
  );
  const overviewComponent = sourceSection(
    app,
    "function Overview",
    "function ReportBarRow",
    "Overview component",
  );

  assert.match(recordDisplay, /import \{ formatUsd \} from "\.\/format-usd"/);
  assert.match(recordDisplay, /return formatUsd\(value\)/);
  assert.doesNotMatch(`${app}\n${recordDisplay}`, /const currencyFormatter = new Intl\.NumberFormat/);
  assert.match(dataSecurity, /const PhoneInstallPanel = dynamic\(/);
  assert.match(dataSecurity, /import\("\.\.\/\.\.\/PhoneInstallPanel"\)/);
  assert.doesNotMatch(dataSecurity, /import \{ PhoneInstallPanel \} from/);
  assert.match(directoryController, /void refreshDirectoryData\(\);\s*\}, \[refreshDirectoryData\]\)/);
  assert.doesNotMatch(directoryController, /setTimeout\(\(\) => \{ void refreshDirectoryData/);
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
