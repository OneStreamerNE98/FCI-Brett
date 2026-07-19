import { randomUUID } from "node:crypto";

import {
  OBJECT_STORAGE_LIMITS,
  ObjectStorageValidationError,
  objectStorageGeneration,
  objectStorageLocator,
  putObjectIfAbsentInput,
  type ObjectStorage,
  type ObjectStorageLocator,
  type OpenObjectRead,
  type PutObjectIfAbsent,
  type PutObjectIfAbsentResult,
  type StoredObjectMetadata,
} from "../../ports/object-storage.ts";
import { collectValidatedObjectBody } from "../object-storage-body.ts";

type StoredEntry = Readonly<{
  object: StoredObjectMetadata;
  bytes: Uint8Array;
}>;

export type MemoryObjectStorageOptions = Readonly<{
  createGeneration?: () => string;
  now?: () => number;
}>;

function validatedCreatedAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ObjectStorageValidationError("invalid-input", "Object creation time must be a nonnegative epoch value");
  }
  return value;
}

async function createEntry(
  input: PutObjectIfAbsent,
  generation: string,
  createdAt: number,
): Promise<StoredEntry> {
  const bytes = await collectValidatedObjectBody(input);
  const object = Object.freeze({
    key: input.key,
    generation,
    contentType: input.contentType,
    byteSize: input.byteSize,
    sha256: input.sha256,
    createdAt,
  });
  return Object.freeze({ object, bytes });
}

async function* readChunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += OBJECT_STORAGE_LIMITS.readChunkBytes) {
    yield bytes.slice(offset, Math.min(offset + OBJECT_STORAGE_LIMITS.readChunkBytes, bytes.byteLength));
  }
}

/** Test/local adapter for the private, create-only object-storage contract. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, StoredEntry>();
  readonly #pending = new Map<string, Promise<StoredEntry>>();
  readonly #createGeneration: () => string;
  readonly #now: () => number;

  constructor(options: MemoryObjectStorageOptions = {}) {
    this.#createGeneration = options.createGeneration ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  async putIfAbsent(value: PutObjectIfAbsent): Promise<PutObjectIfAbsentResult> {
    const input = putObjectIfAbsentInput(value);
    const existing = this.#objects.get(input.key);
    if (existing) return Object.freeze({ outcome: "already-exists", object: existing.object });

    const pending = this.#pending.get(input.key);
    if (pending) {
      const object = (await pending).object;
      return Object.freeze({ outcome: "already-exists", object });
    }

    const generation = objectStorageGeneration(this.#createGeneration());
    const createdAt = validatedCreatedAt(this.#now());
    const write = createEntry(input, generation, createdAt);
    this.#pending.set(input.key, write);
    try {
      const entry = await write;
      this.#objects.set(input.key, entry);
      return Object.freeze({ outcome: "stored", object: entry.object });
    } finally {
      if (this.#pending.get(input.key) === write) this.#pending.delete(input.key);
    }
  }

  async head(value: ObjectStorageLocator): Promise<StoredObjectMetadata | null> {
    const locator = objectStorageLocator(value);
    const entry = this.#objects.get(locator.key);
    return entry?.object.generation === locator.generation ? entry.object : null;
  }

  async openRead(value: ObjectStorageLocator): Promise<OpenObjectRead | null> {
    const locator = objectStorageLocator(value);
    const entry = this.#objects.get(locator.key);
    if (!entry || entry.object.generation !== locator.generation) return null;
    return Object.freeze({ object: entry.object, chunks: readChunks(entry.bytes) });
  }
}
