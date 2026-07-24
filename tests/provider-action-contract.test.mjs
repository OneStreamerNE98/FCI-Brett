import assert from "node:assert/strict";
import test from "node:test";

import {
  isProviderActionQueued,
  normalizeProviderActionQueued,
  normalizeProviderActionSuccess,
  providerActionQueued,
  ProviderDegradedError,
} from "../app/platform/google-cloud/provider-action-contract.ts";

const PUBLIC_FILE = Object.freeze({
  id: "provider-file-1",
  name: "FCI TEST — DO NOT USE.pdf",
  mimeType: "application/pdf",
  byteSize: 1_024,
  webUrl: "https://drive.google.com/open?id=provider-file-1",
});

test("every provider success route accepts only its closed bounded public DTO", () => {
  const fixtures = new Map([
    ["files", { outcome: "listed", files: [PUBLIC_FILE] }],
    ["files_upload", { outcome: "uploaded", file: PUBLIC_FILE }],
    ["files_share", { outcome: "shared", fileId: "provider-file-1" }],
    ["gmail_file", { outcome: "filed", operationId: "gmail-filing-1" }],
    ["calendar_create", { outcome: "created", operationId: "calendar-event-1" }],
  ]);

  for (const [routeKind, fixture] of fixtures) {
    assert.deepEqual(normalizeProviderActionSuccess(routeKind, fixture), fixture);
    const secretBearing = { ...fixture, accessToken: "test-only-provider-secret" };
    assert.throws(
      () => normalizeProviderActionSuccess(routeKind, secretBearing),
      (error) => (
        error instanceof ProviderDegradedError
        && error.retryable === false
      ),
      routeKind,
    );
  }
  assert.throws(
    () => normalizeProviderActionSuccess("unknown-runtime-route", {
      outcome: "created",
      operationId: "must-not-be-returned",
    }),
    ProviderDegradedError,
  );
});

test("provider file DTOs reject nested expansion, unsafe URLs, and unbounded lists", () => {
  const cyclicFile = { ...PUBLIC_FILE };
  cyclicFile.self = cyclicFile;
  const accessorFile = { ...PUBLIC_FILE };
  Object.defineProperty(accessorFile, "name", {
    enumerable: true,
    get() {
      return "secret-bearing getter";
    },
  });
  for (const file of [
    { ...PUBLIC_FILE, refreshToken: "test-only-secret" },
    { ...PUBLIC_FILE, byteSize: -1 },
    { ...PUBLIC_FILE, byteSize: Number.NaN },
    { ...PUBLIC_FILE, byteSize: 1n },
    { ...PUBLIC_FILE, webUrl: "javascript:alert(1)" },
    { ...PUBLIC_FILE, name: "x".repeat(513) },
    cyclicFile,
    accessorFile,
  ]) {
    assert.throws(
      () => normalizeProviderActionSuccess("files", {
        outcome: "listed",
        files: [file],
      }),
      ProviderDegradedError,
    );
  }
  assert.throws(
    () => normalizeProviderActionSuccess("files", {
      outcome: "listed",
      files: Array.from({ length: 101 }, () => PUBLIC_FILE),
    }),
    ProviderDegradedError,
  );

  const proxySecret = "test-only-proxy-secret";
  const proxiedFile = new Proxy(PUBLIC_FILE, {
    get(target, property) {
      return property === "name"
        ? proxySecret
        : Reflect.get(target, property);
    },
  });
  const normalized = normalizeProviderActionSuccess("files", {
    outcome: "listed",
    files: [proxiedFile],
  });
  assert.equal(normalized.files[0].name, PUBLIC_FILE.name);
  assert.doesNotMatch(JSON.stringify(normalized), new RegExp(proxySecret));
});

test("queued provider acknowledgments normalize only bounded safe operation IDs", () => {
  assert.deepEqual(providerActionQueued("  operation-123  "), {
    outcome: "queued",
    operationId: "operation-123",
  });
  assert.equal(isProviderActionQueued({
    outcome: "queued",
    operationId: "operation-123",
  }), true);

  for (const operationId of [
    "",
    " ",
    "operation\n123",
    `x${"\u007f"}y`,
    "x".repeat(256),
  ]) {
    assert.throws(
      () => providerActionQueued(operationId),
      /1 to 255 safe characters/,
    );
    assert.equal(isProviderActionQueued({
      outcome: "queued",
      operationId,
    }), false);
  }
  assert.equal(isProviderActionQueued({
    outcome: "queued",
    operationId: " operation-123 ",
  }), false);
  const secretBearing = {
    outcome: "queued",
    operationId: "operation-123",
    refreshToken: "test-only-secret",
  };
  assert.equal(isProviderActionQueued(secretBearing), false);
  assert.equal(normalizeProviderActionQueued(secretBearing), null);

  const cyclic = { outcome: "queued", operationId: "operation-123" };
  cyclic.self = cyclic;
  assert.equal(normalizeProviderActionQueued(cyclic), null);

  const accessor = { outcome: "queued" };
  Object.defineProperty(accessor, "operationId", {
    enumerable: true,
    get() {
      throw new Error("test-only accessor secret");
    },
  });
  assert.equal(normalizeProviderActionQueued(accessor), null);
  assert.deepEqual(
    normalizeProviderActionQueued({
      outcome: "queued",
      operationId: "operation-123",
    }),
    { outcome: "queued", operationId: "operation-123" },
  );
  const proxiedQueued = new Proxy(
    { outcome: "queued", operationId: "operation-123" },
    {
      get(target, property) {
        return property === "operationId"
          ? "test-only-proxy-secret"
          : Reflect.get(target, property);
      },
    },
  );
  assert.deepEqual(
    normalizeProviderActionQueued(proxiedQueued),
    { outcome: "queued", operationId: "operation-123" },
  );
});

test("provider degradation requires exact retryability and a bounded retry delay", () => {
  const retryable = new ProviderDegradedError({
    retryable: true,
    retryAfterSeconds: 37,
  });
  assert.equal(retryable.retryable, true);
  assert.equal(retryable.retryAfterSeconds, 37);

  const terminal = new ProviderDegradedError({ retryable: false });
  assert.equal(terminal.retryable, false);
  assert.equal(terminal.retryAfterSeconds, null);

  assert.throws(
    () => new ProviderDegradedError({ retryable: "yes" }),
    /must be a boolean/,
  );
  for (const retryAfterSeconds of [0, 86_401, 1.5]) {
    assert.throws(
      () => new ProviderDegradedError({
        retryable: true,
        retryAfterSeconds,
      }),
      /integer from 1 to 86400 seconds/,
    );
  }
});
