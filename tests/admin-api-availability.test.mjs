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
  let responseFactory = async () => {
    throw new Error("unsupported development API must not be fetched");
  };
  globalThis.fetch = async (...arguments_) => {
    fetchCalls += 1;
    return responseFactory(...arguments_);
  };
  try {
    const access = await vite.ssrLoadModule("/app/lib/admin-access-client.ts");
    const audit = await vite.ssrLoadModule("/app/lib/admin-audit-client.ts");
    const cache = await vite.ssrLoadModule("/app/lib/client-get-cache.ts");
    const auditInput = {
      limit: 25,
      from: null,
      before: new Date(0).toISOString(),
      result: "all",
      category: "all",
      cursor: null,
    };
    await assert.rejects(
      access.readAdminAccessOverview(false),
      (error) => error instanceof access.AdminAccessClientError
        && error.status === 0
        && error.code === "secure_session_not_ready",
    );
    await assert.rejects(
      audit.readAdminAuditActivity(auditInput, false),
      (error) => error instanceof audit.AdminAuditClientError
        && error.status === 0
        && error.code === "secure_session_not_ready",
    );
    assert.equal(fetchCalls, 0);

    for (const [label, work, ErrorType] of [
      ["access", () => access.readAdminAccessOverview(true), access.AdminAccessClientError],
      ["audit", () => audit.readAdminAuditActivity(auditInput, true), audit.AdminAuditClientError],
    ]) {
      cache.clearCachedGets();
      responseFactory = async () => new Response("not-json", { status: 200 });
      await assert.rejects(
        work(),
        (error) => error instanceof ErrorType
          && error.status === 200
          && error.code === "invalid_server_response",
        `${label} must preserve its typed contract for malformed success bodies`,
      );

      cache.clearCachedGets();
      responseFactory = async () => new Response("not-json", { status: 503 });
      await assert.rejects(
        work(),
        (error) => error instanceof ErrorType
          && error.status === 503
          && error.code === "invalid_server_response",
        `${label} must preserve its typed contract for malformed error bodies`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});
