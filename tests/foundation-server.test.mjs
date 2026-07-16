import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_RUN_LISTEN_HOST,
  createFoundationServer,
} from "../app/platform/google-cloud/foundation-server.ts";

function readiness(value = true) {
  return {
    checkCalls: 0,
    invalidateCalls: 0,
    async check() {
      this.checkCalls += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    invalidate() {
      this.invalidateCalls += 1;
    },
  };
}

async function startController(overrides = {}) {
  const probe = overrides.readiness ?? readiness(true);
  const closeCalls = [];
  const controller = createFoundationServer({
    readiness: probe,
    closeDatabase: overrides.closeDatabase ?? (async () => { closeCalls.push("database"); }),
    ...(overrides.applicationHandler
      ? { applicationHandler: overrides.applicationHandler }
      : {}),
    readinessTimeoutMs: overrides.readinessTimeoutMs ?? 100,
    shutdownTimeoutMs: overrides.shutdownTimeoutMs ?? 1_000,
  });
  const address = await controller.listen({ host: "127.0.0.1", port: 0 });
  return {
    controller,
    probe,
    closeCalls,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

test("uses the Cloud Run all-interface host by default", () => {
  assert.equal(CLOUD_RUN_LISTEN_HOST, "0.0.0.0");
});

test("keeps liveness process-only and fails every application path closed", async () => {
  const running = await startController();
  try {
    const health = await fetch(`${running.origin}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal(running.probe.checkCalls, 0);

    for (const path of ["/", "/api/v1/clients", "/signin-with-chatgpt", "/unknown?x=1"]) {
      const response = await fetch(running.origin + path);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "production_app_not_composed" });
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    const head = await fetch(`${running.origin}/healthz`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    await running.controller.shutdown();
  }
});

test("returns only generic readiness responses for success, failure, and timeout", async () => {
  const ready = await startController();
  try {
    const response = await fetch(`${ready.origin}/readyz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready" });
  } finally {
    await ready.controller.shutdown();
  }

  const failed = await startController({
    readiness: readiness(new Error("test-only-sensitive-detail=secret")),
  });
  try {
    const response = await fetch(`${failed.origin}/readyz`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { status: "unavailable" });
    assert.doesNotMatch(body, /secret/);
  } finally {
    await failed.controller.shutdown();
  }

  const never = {
    check: () => new Promise(() => {}),
    invalidate() {},
  };
  const timedOut = await startController({ readiness: never, readinessTimeoutMs: 20 });
  try {
    const startedAt = Date.now();
    const response = await fetch(`${timedOut.origin}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
    assert.ok(Date.now() - startedAt < 500, "readiness response must be bounded");
  } finally {
    await timedOut.controller.shutdown();
  }
});

test("routes non-health requests through an injected application handler", async () => {
  const calls = [];
  const running = await startController({
    applicationHandler(request, response) {
      calls.push(request.url);
      const payload = JSON.stringify({ status: "application" });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      response.end(payload);
    },
  });
  try {
    const application = await fetch(`${running.origin}/api/v1/projects`);
    assert.equal(application.status, 200);
    assert.deepEqual(await application.json(), { status: "application" });
    assert.deepEqual(calls, ["/api/v1/projects"]);

    const health = await fetch(`${running.origin}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(calls, ["/api/v1/projects"], "health must bypass application auth");

    running.controller.beginDraining();
    const draining = await fetch(`${running.origin}/api/v1/projects`);
    assert.equal(draining.status, 503);
    assert.deepEqual(await draining.json(), { error: "service_unavailable" });
    assert.deepEqual(calls, ["/api/v1/projects"]);
  } finally {
    await running.controller.shutdown();
  }
});

test("flips readiness before HTTP close and performs idempotent database cleanup", async () => {
  const running = await startController();
  running.controller.beginDraining();
  assert.equal(running.controller.isDraining, true);
  assert.equal(running.probe.invalidateCalls, 1);

  const response = await fetch(`${running.origin}/readyz`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
  assert.equal(running.probe.checkCalls, 0);

  const firstShutdown = running.controller.shutdown();
  const secondShutdown = running.controller.shutdown();
  assert.equal(firstShutdown, secondShutdown);
  await firstShutdown;
  assert.deepEqual(running.closeCalls, ["database"]);
  assert.equal(running.probe.invalidateCalls, 1);
});

test("bounds a stalled database close and invokes it only once", async () => {
  let closeCalls = 0;
  const controller = createFoundationServer({
    readiness: readiness(true),
    closeDatabase: async () => {
      closeCalls += 1;
      await new Promise(() => {});
    },
    shutdownTimeoutMs: 20,
  });

  const startedAt = Date.now();
  await assert.rejects(controller.shutdown(), /shutdown did not complete cleanly/);
  assert.ok(Date.now() - startedAt < 500, "shutdown must return within its hard bound");
  assert.equal(closeCalls, 1);
  await assert.rejects(controller.shutdown(), /shutdown did not complete cleanly/);
  assert.equal(closeCalls, 1);
});

test("rejects non-GET health methods without opening the application surface", async () => {
  const running = await startController();
  try {
    const response = await fetch(`${running.origin}/readyz`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  } finally {
    await running.controller.shutdown();
  }
});
