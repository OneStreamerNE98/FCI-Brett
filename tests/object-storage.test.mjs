import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { Storage } from "@google-cloud/storage";

import { GcsObjectStorage } from "../app/adapters/gcs/object-storage.ts";
import { MemoryObjectStorage } from "../app/adapters/memory/object-storage.ts";
import { R2ObjectStorage } from "../app/adapters/r2/object-storage.ts";
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

function copiedArrayBuffer(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(bytes).buffer;
}

class FakeR2Bucket {
  objects = new Map();
  lastPut = null;
  nextVersion = 1;

  cloneMetadata(entry) {
    return {
      key: entry.key,
      version: entry.version,
      size: entry.size,
      etag: entry.etag,
      uploaded: new Date(entry.uploaded),
      httpMetadata: { ...entry.httpMetadata },
      customMetadata: { ...entry.customMetadata },
      checksums: { sha256: entry.checksums.sha256.slice(0) },
    };
  }

  async head(key) {
    const entry = this.objects.get(key);
    return entry ? this.cloneMetadata(entry) : null;
  }

  async put(key, value, options = {}) {
    this.lastPut = { key, options };
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) return null;
    const bytes = Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    const digest = options.sha256 ? copiedArrayBuffer(options.sha256) : new ArrayBuffer(0);
    const entry = {
      key,
      version: `fake-r2-generation-${this.nextVersion++}`,
      size: bytes.byteLength,
      etag: createHash("sha256").update(bytes).digest("hex"),
      uploaded: new Date(1_783_939_200_000 + this.nextVersion),
      httpMetadata: { ...(options.httpMetadata ?? {}) },
      customMetadata: { ...(options.customMetadata ?? {}) },
      checksums: { sha256: digest },
      bytes,
    };
    this.objects.set(key, entry);
    return this.cloneMetadata(entry);
  }

  async get(key, options = {}) {
    const entry = this.objects.get(key);
    if (!entry) return null;
    const metadata = this.cloneMetadata(entry);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== entry.etag) return metadata;
    return {
      ...metadata,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(entry.bytes.slice());
          controller.close();
        },
      }),
    };
  }
}

const gcsBucketName = process.env.TEST_GCS_OBJECT_STORAGE_BUCKET?.trim() ?? "";
const gcsGateOpen =
  process.env.TEST_GCS_OBJECT_STORAGE_ACK === "FCI TEST — DO NOT USE" &&
  gcsBucketName.length > 0;

const storageContracts = [
  {
    name: "memory",
    async createHarness() {
      return { storage: new MemoryObjectStorage() };
    },
  },
  {
    name: "fake R2",
    async createHarness() {
      return { storage: new R2ObjectStorage({ bucket: new FakeR2Bucket() }) };
    },
  },
  {
    name: "gated GCS",
    skip: gcsGateOpen
      ? undefined
      : "TEST_GCS_OBJECT_STORAGE_BUCKET and the exact FCI test-only acknowledgment are not configured",
    async createHarness() {
      const client = new Storage();
      const keys = new Set();
      return {
        storage: new GcsObjectStorage({ bucketName: gcsBucketName, storage: client }),
        key(label) {
          const key = `fci-test/object-storage-contract/${randomUUID()}/${label}`;
          keys.add(key);
          return key;
        },
        async cleanup() {
          await Promise.all(
            [...keys].map((key) => client.bucket(gcsBucketName).file(key).delete({ ignoreNotFound: true })),
          );
        },
      };
    },
  },
];

for (const contract of storageContracts) {
  test(`object-storage contract (${contract.name}) stores once and fences reads by generation`, {
    skip: contract.skip,
  }, async (t) => {
    const harness = await contract.createHarness();
    if (harness.cleanup) t.after(harness.cleanup);
    const key = harness.key?.("stores-once") ?? `contract/${randomUUID()}/stores-once`;
    const bytes = Uint8Array.from([10, 20, 30, 40]);
    const stored = await harness.storage.putIfAbsent(input(key, bytes));
    assert.equal(stored.outcome, "stored");
    assert.equal(stored.object.key, key);
    assert.equal(stored.object.byteSize, bytes.byteLength);
    assert.equal(stored.object.sha256, sha256(bytes));
    assert.ok(Number.isSafeInteger(stored.object.createdAt));

    let losingBodyReads = 0;
    const duplicate = await harness.storage.putIfAbsent({
      ...input(key, Uint8Array.from([99])),
      chunks: (async function* () {
        losingBodyReads += 1;
        yield Uint8Array.from([99]);
      })(),
    });
    assert.equal(duplicate.outcome, "already-exists");
    assert.deepEqual(duplicate.object, stored.object);
    assert.equal(losingBodyReads, 0);

    assert.equal(await harness.storage.head({ key, generation: "1" }), null);
    assert.deepEqual(await harness.storage.head({ key, generation: stored.object.generation }), stored.object);
    const opened = await harness.storage.openRead({ key, generation: stored.object.generation });
    assert.ok(opened);
    assert.deepEqual(await readAll(opened.chunks), bytes);
  });

  test(`object-storage contract (${contract.name}) coalesces same-process concurrent creates`, {
    skip: contract.skip,
  }, async (t) => {
    const harness = await contract.createHarness();
    if (harness.cleanup) t.after(harness.cleanup);
    const key = harness.key?.("concurrent") ?? `contract/${randomUUID()}/concurrent`;
    let releaseWinner;
    const winnerGate = new Promise((resolve) => { releaseWinner = resolve; });
    let winnerStarted;
    const winnerStartedPromise = new Promise((resolve) => { winnerStarted = resolve; });
    let losingBodyReads = 0;
    const winnerBytes = Uint8Array.from([1, 2, 3]);

    const winner = harness.storage.putIfAbsent({
      ...input(key, winnerBytes),
      chunks: (async function* () {
        winnerStarted();
        await winnerGate;
        yield winnerBytes;
      })(),
    });
    await winnerStartedPromise;
    const loser = harness.storage.putIfAbsent({
      ...input(key, Uint8Array.from([9])),
      chunks: (async function* () {
        losingBodyReads += 1;
        yield Uint8Array.from([9]);
      })(),
    });
    releaseWinner();
    const [winnerResult, loserResult] = await Promise.all([winner, loser]);
    assert.equal(winnerResult.outcome, "stored");
    assert.equal(loserResult.outcome, "already-exists");
    assert.deepEqual(loserResult.object, winnerResult.object);
    assert.equal(losingBodyReads, 0);
  });
}

test("R2 adapter preserves development upload metadata and provider integrity guards", async () => {
  const bucket = new FakeR2Bucket();
  const storage = new R2ObjectStorage({
    bucket,
    customMetadata: { originalName: "FCI TEST — DO NOT USE.pdf", uploadedBy: "tester@example.test" },
  });
  const bytes = Uint8Array.from([1, 2, 3]);
  await storage.putIfAbsent(input("uploads/metadata", bytes, { contentType: "application/pdf" }));

  assert.deepEqual(bucket.lastPut.options.onlyIf, { etagDoesNotMatch: "*" });
  assert.deepEqual(bucket.lastPut.options.httpMetadata, { contentType: "application/pdf" });
  assert.deepEqual({ ...bucket.lastPut.options.customMetadata }, {
    originalName: "FCI TEST — DO NOT USE.pdf",
    uploadedBy: "tester@example.test",
  });
  assert.equal(Buffer.from(bucket.lastPut.options.sha256).toString("hex"), sha256(bytes).slice("sha256:".length));
});

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
  const storages = [
    new MemoryObjectStorage(),
    new R2ObjectStorage({ bucket: new FakeR2Bucket() }),
    new GcsObjectStorage({
      bucketName: "fci-test-bucket",
      storage: { bucket: () => ({ file: () => { throw new Error("not called"); } }) },
    }),
  ];
  for (const storage of storages) {
    assert.deepEqual(
      Object.getOwnPropertyNames(Object.getPrototypeOf(storage)).sort(),
      ["constructor", "head", "openRead", "putIfAbsent"],
    );
    for (const forbidden of ["put", "overwrite", "list", "delete", "publicUrl", "signedUrl"]) {
      assert.equal(forbidden in storage, false);
    }
  }
});
