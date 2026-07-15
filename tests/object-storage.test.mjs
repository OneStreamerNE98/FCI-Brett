import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MemoryObjectStorage } from "../app/adapters/memory/object-storage.ts";
import {
  OBJECT_STORAGE_LIMITS,
  ObjectStorageValidationError,
} from "../app/ports/object-storage.ts";

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function* body(...chunks) {
  for (const chunk of chunks) yield chunk;
}

async function readAll(chunks) {
  const values = [];
  for await (const chunk of chunks) values.push(...chunk);
  return Uint8Array.from(values);
}

function input(key, bytes, overrides = {}) {
  return {
    key,
    contentType: "application/octet-stream",
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    chunks: body(bytes),
    ...overrides,
  };
}

function validationCode(code) {
  return (error) => {
    assert.ok(error instanceof ObjectStorageValidationError);
    assert.equal(error.code, code);
    return true;
  };
}

test("stores once and requires the exact opaque generation for metadata and reads", async () => {
  const storage = new MemoryObjectStorage({
    createGeneration: () => "opaque-generation_1",
    now: () => 1_783_939_200_000,
  });
  const first = Uint8Array.from([1, 2]);
  const second = Uint8Array.from([3, 4, 5]);
  const bytes = Uint8Array.from([...first, ...second]);
  const result = await storage.putIfAbsent({
    ...input("quarantine/11111111-1111-4111-8111-111111111111", bytes),
    chunks: body(first, second),
  });

  assert.deepEqual(result, {
    outcome: "stored",
    object: {
      key: "quarantine/11111111-1111-4111-8111-111111111111",
      generation: "opaque-generation_1",
      contentType: "application/octet-stream",
      byteSize: 5,
      sha256: sha256(bytes),
      createdAt: 1_783_939_200_000,
    },
  });
  assert.equal(await storage.head({ key: result.object.key, generation: "wrong-generation" }), null);
  assert.equal(await storage.openRead({ key: result.object.key, generation: "wrong-generation" }), null);
  assert.deepEqual(
    await storage.head({ key: result.object.key, generation: result.object.generation }),
    result.object,
  );

  const opened = await storage.openRead({ key: result.object.key, generation: result.object.generation });
  assert.ok(opened);
  assert.deepEqual(await readAll(opened.chunks), bytes);
});

test("putIfAbsent does not overwrite or consume a losing body, including concurrent writers", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstStarted;
  const firstStartedPromise = new Promise((resolve) => { firstStarted = resolve; });
  let losingBodyReads = 0;
  const storage = new MemoryObjectStorage({ createGeneration: () => "generation-winner", now: () => 10 });
  const winnerBytes = Uint8Array.from([10, 11]);

  async function* delayedWinner() {
    firstStarted();
    await firstGate;
    yield winnerBytes;
  }
  async function* losingBody() {
    losingBodyReads += 1;
    yield Uint8Array.from([99]);
  }

  const winningWrite = storage.putIfAbsent({
    ...input("objects/concurrent", winnerBytes),
    chunks: delayedWinner(),
  });
  await firstStartedPromise;
  const losingWrite = storage.putIfAbsent({
    ...input("objects/concurrent", Uint8Array.from([99])),
    chunks: losingBody(),
  });
  releaseFirst();

  const [winner, loser] = await Promise.all([winningWrite, losingWrite]);
  assert.equal(winner.outcome, "stored");
  assert.equal(loser.outcome, "already-exists");
  assert.deepEqual(loser.object, winner.object);
  assert.equal(losingBodyReads, 0);

  const opened = await storage.openRead({ key: winner.object.key, generation: winner.object.generation });
  assert.deepEqual(await readAll(opened.chunks), winnerBytes);
});

test("read chunks are defensive copies", async () => {
  const bytes = Uint8Array.from([7, 8, 9]);
  const storage = new MemoryObjectStorage({ createGeneration: () => "generation-copy", now: () => 20 });
  const stored = await storage.putIfAbsent(input("objects/copy", bytes));
  const locator = { key: stored.object.key, generation: stored.object.generation };
  const firstRead = await storage.openRead(locator);
  const firstBytes = await readAll(firstRead.chunks);
  firstBytes[0] = 255;
  const secondRead = await storage.openRead(locator);
  assert.deepEqual(await readAll(secondRead.chunks), bytes);
});

test("rejects unsafe or unbounded metadata before reading a body", async () => {
  const bytes = Uint8Array.from([1]);
  const cases = [
    [input("", bytes), "invalid-key"],
    [input("/absolute", bytes), "invalid-key"],
    [input("objects/../escape", bytes), "invalid-key"],
    [input("objects\\escape", bytes), "invalid-key"],
    [input(`objects/${"a".repeat(OBJECT_STORAGE_LIMITS.maxKeyBytes)}`, bytes), "invalid-key"],
    [input("objects/type", bytes, { contentType: "text/plain\nunsafe" }), "invalid-content-type"],
    [input("objects/negative", bytes, { byteSize: -1 }), "invalid-byte-size"],
    [input("objects/large", bytes, { byteSize: OBJECT_STORAGE_LIMITS.maxObjectBytes + 1 }), "invalid-byte-size"],
    [input("objects/hash", bytes, { sha256: `sha256:${"A".repeat(64)}` }), "invalid-sha256"],
    [{ ...input("objects/extra", bytes), publicUrl: "https://example.test/object" }, "invalid-input"],
    [{ ...input("objects/body", bytes), chunks: [bytes] }, "invalid-body"],
  ];

  for (const [candidate, code] of cases) {
    let bodyReads = 0;
    if (candidate.chunks?.[Symbol.asyncIterator]) {
      candidate.chunks = (async function* () {
        bodyReads += 1;
        yield bytes;
      })();
    }
    const storage = new MemoryObjectStorage();
    await assert.rejects(storage.putIfAbsent(candidate), validationCode(code));
    assert.equal(bodyReads, 0);
  }
});

test("compound storage inputs reject accessors and hidden properties without invoking them", async () => {
  const bytes = Uint8Array.from([1]);
  let getterCalls = 0;
  const writeWithGetter = input("objects/getter", bytes);
  Object.defineProperty(writeWithGetter, "key", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "objects/getter";
    },
  });
  const locatorWithGetter = { key: "objects/getter", generation: "generation-1" };
  Object.defineProperty(locatorWithGetter, "generation", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "generation-1";
    },
  });
  const writeWithHiddenProperty = input("objects/hidden", bytes);
  Object.defineProperty(writeWithHiddenProperty, "publicUrl", {
    enumerable: false,
    value: "https://example.test/unsafe",
  });
  const locatorWithSymbol = { key: "objects/symbol", generation: "generation-1" };
  locatorWithSymbol[Symbol("extra")] = true;

  const storage = new MemoryObjectStorage();
  await assert.rejects(storage.putIfAbsent(writeWithGetter), validationCode("invalid-input"));
  await assert.rejects(storage.putIfAbsent(writeWithHiddenProperty), validationCode("invalid-input"));
  await assert.rejects(storage.head(locatorWithGetter), validationCode("invalid-input"));
  await assert.rejects(storage.head(locatorWithSymbol), validationCode("invalid-input"));
  assert.equal(getterCalls, 0);
});

test("rejects invalid streams atomically and permits a clean retry", async () => {
  const storage = new MemoryObjectStorage({ createGeneration: () => "generation-retry", now: () => 30 });
  const bytes = Uint8Array.from([1, 2, 3]);
  const failures = [
    [input("objects/retry", bytes, { byteSize: 4 }), "body-size-mismatch"],
    [input("objects/retry", bytes, { byteSize: 2 }), "body-size-mismatch"],
    [input("objects/retry", bytes, { sha256: `sha256:${"0".repeat(64)}` }), "body-checksum-mismatch"],
    [input("objects/retry", bytes, { chunks: body("not-bytes") }), "invalid-body"],
    [input("objects/retry", bytes, { chunks: body(new Uint8Array()) }), "invalid-body"],
  ];

  for (const [candidate, code] of failures) {
    await assert.rejects(storage.putIfAbsent(candidate), validationCode(code));
  }
  const stored = await storage.putIfAbsent(input("objects/retry", bytes));
  assert.equal(stored.outcome, "stored");
});

test("bounds stream chunk count and validates generated and supplied generations", async () => {
  const bytes = new Uint8Array(OBJECT_STORAGE_LIMITS.maxStreamChunks + 1).fill(1);
  const storage = new MemoryObjectStorage({ createGeneration: () => "generation-bounded", now: () => 40 });
  async function* tooManyChunks() {
    for (let index = 0; index < bytes.byteLength; index += 1) yield bytes.subarray(index, index + 1);
  }
  await assert.rejects(
    storage.putIfAbsent({ ...input("objects/too-many-chunks", bytes), chunks: tooManyChunks() }),
    validationCode("invalid-body"),
  );
  await assert.rejects(
    storage.head({ key: "objects/valid", generation: "../unsafe" }),
    validationCode("invalid-generation"),
  );

  let bodyReads = 0;
  const invalidFactoryStorage = new MemoryObjectStorage({
    createGeneration: () => "unsafe/generation",
    now: () => 40,
  });
  await assert.rejects(
    invalidFactoryStorage.putIfAbsent({
      ...input("objects/invalid-generation", Uint8Array.from([1])),
      chunks: (async function* () {
        bodyReads += 1;
        yield Uint8Array.from([1]);
      })(),
    }),
    validationCode("invalid-generation"),
  );
  assert.equal(bodyReads, 0);
});

test("public surface exposes no overwrite, list, delete, or URL escape hatch", () => {
  const storage = new MemoryObjectStorage();
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(storage)).sort(),
    ["constructor", "head", "openRead", "putIfAbsent"],
  );
  for (const forbidden of ["put", "overwrite", "list", "delete", "publicUrl", "signedUrl"]) {
    assert.equal(forbidden in storage, false);
  }
});
