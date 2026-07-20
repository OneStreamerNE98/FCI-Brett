import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer as createViteServer } from "vite";

test("development admin clients fail locally before unsupported Sites API fetches", async () => {
  const vite = await createViteServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    cacheDir: "work/vite-tests/admin-api-availability",
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: { port: 24719 } },
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unsupported development API must not be fetched");
  };
  try {
    const access = await vite.ssrLoadModule("/app/lib/admin-access-client.ts");
    const audit = await vite.ssrLoadModule("/app/lib/admin-audit-client.ts");
    await assert.rejects(
      access.readAdminAccessOverview(false),
      (error) => error instanceof access.AdminAccessClientError
        && error.status === 0
        && error.code === "secure_session_not_ready",
    );
    await assert.rejects(
      audit.readAdminAuditActivity({
        limit: 25,
        from: null,
        before: new Date(0).toISOString(),
        result: "all",
        category: "all",
        cursor: null,
      }, false),
      (error) => error instanceof audit.AdminAuditClientError
        && error.status === 0
        && error.code === "secure_session_not_ready",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});
