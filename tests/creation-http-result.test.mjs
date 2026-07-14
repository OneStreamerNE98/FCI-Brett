import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24684 } },
});

const { clientCreationHttpResult, projectCreationHttpResult } = await vite.ssrLoadModule(
  "/app/lib/creation-http-result.ts",
);

after(async () => {
  await vite.close();
});

test("client creation HTTP results preserve every portable status and response body", () => {
  const failures = [
    ["forbidden", 403],
    ["invalid", 400],
    ["duplicate", 409],
    ["identifier-collision", 503],
    ["idempotency-conflict", 409],
    ["in-progress", 409],
  ];

  for (const [kind, status] of failures) {
    const message = `FCI TEST — DO NOT USE ${kind}`;
    assert.deepEqual(
      clientCreationHttpResult({ ok: false, kind, message }),
      { status, body: { error: message } },
    );
  }

  const value = {
    id: "client-1",
    clientCode: "CL-TEST0001",
    name: "FCI TEST — DO NOT USE",
    createdAt: 1,
    sheetSync: { status: "queued", message: "queued" },
  };
  assert.deepEqual(clientCreationHttpResult({ ok: true, value }), { status: 201, body: value });
});

test("project creation HTTP results preserve every portable status and response body", () => {
  const failures = [
    ["forbidden", 403],
    ["invalid", 400],
    ["project-manager-not-authorized", 400],
    ["client-not-found", 404],
    ["identifier-collision", 503],
    ["idempotency-conflict", 409],
    ["in-progress", 409],
  ];

  for (const [kind, status] of failures) {
    const message = `FCI TEST — DO NOT USE ${kind}`;
    assert.deepEqual(
      projectCreationHttpResult({ ok: false, kind, message }),
      { status, body: { error: message } },
    );
  }

  const value = {
    id: "project-1",
    projectNumber: "CF-2026-TEST0001",
    projectManagerId: "manager@example.test",
    createdAt: 1,
    sheetSync: { status: "queued", message: "queued" },
  };
  assert.deepEqual(projectCreationHttpResult({ ok: true, value }), { status: 201, body: value });
});
