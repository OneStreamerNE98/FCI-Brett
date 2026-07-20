import {
  ObjectStorageValidationError,
  objectStorageByteSize,
  objectStorageContentType,
  objectStorageGeneration,
  objectStorageKey,
  objectStorageLocator,
  objectStorageSha256,
  putObjectIfAbsentInput,
  type ObjectStorage,
  type ObjectStorageLocator,
  type OpenObjectRead,
  type PutObjectIfAbsent,
  type PutObjectIfAbsentResult,
  type StoredObjectMetadata,
} from "../../ports/object-storage.ts";
import { collectValidatedObjectBody } from "../object-storage-body.ts";

type R2ConditionalLike = Readonly<{
  etagMatches?: string;
  etagDoesNotMatch?: string;
}>;

type R2StoredObjectLike = Readonly<{
  key: string;
  version: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: Readonly<{ contentType?: string }>;
  customMetadata?: Readonly<Record<string, string>>;
  checksums?: Readonly<{ sha256?: ArrayBuffer }>;
}>;

type R2BodyObjectLike = R2StoredObjectLike & Readonly<{
  body?: ReadableStream<Uint8Array>;
}>;

export type R2BucketLike = Readonly<{
  head(key: string): Promise<R2StoredObjectLike | null>;
  get(
    key: string,
    options?: Readonly<{ onlyIf?: R2ConditionalLike }>,
  ): Promise<R2BodyObjectLike | R2StoredObjectLike | null>;
  put(
    key: string,
    value: ArrayBufferView,
    options?: Readonly<{
      onlyIf?: R2ConditionalLike;
      httpMetadata?: Readonly<{ contentType?: string }>;
      customMetadata?: Readonly<Record<string, string>>;
      sha256?: ArrayBuffer;
    }>,
  ): Promise<R2StoredObjectLike | null>;
}>;

export type R2ObjectStorageOptions = Readonly<{
  bucket: R2BucketLike;
  /** Provider-only metadata retained by the existing development upload route. */
  customMetadata?: Readonly<Record<string, string>>;
}>;

function invalidProviderMetadata(message: string): never {
  throw new ObjectStorageValidationError("invalid-input", message);
}

function snapshotCustomMetadata(value: Readonly<Record<string, string>> | undefined) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidProviderMetadata("R2 custom metadata must be a plain string map");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidProviderMetadata("R2 custom metadata must be a plain string map");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const metadata: Record<string, string> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return invalidProviderMetadata("R2 custom metadata keys must be strings");
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return invalidProviderMetadata("R2 custom metadata values must be enumerable strings");
    }
    metadata[key] = descriptor.value;
  }
  return Object.freeze(metadata);
}

function sha256Bytes(value: string): ArrayBuffer {
  const canonical = objectStorageSha256(value).slice("sha256:".length);
  const bytes = new Uint8Array(32);
  for (let offset = 0; offset < bytes.byteLength; offset += 1) {
    bytes[offset] = Number.parseInt(canonical.slice(offset * 2, offset * 2 + 2), 16);
  }
  return bytes.buffer;
}

function sha256FromR2(value: unknown): string {
  if (!(value instanceof ArrayBuffer) || value.byteLength !== 32) {
    return invalidProviderMetadata("R2 object is missing its canonical SHA-256 checksum");
  }
  const hex = Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return objectStorageSha256(`sha256:${hex}`);
}

function createdAtFromR2(value: unknown): number {
  if (!(value instanceof Date)) return invalidProviderMetadata("R2 object upload time is invalid");
  const createdAt = value.getTime();
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    return invalidProviderMetadata("R2 object upload time is invalid");
  }
  return createdAt;
}

function metadataFromR2(value: R2StoredObjectLike, expectedKey: string): StoredObjectMetadata {
  const key = objectStorageKey(value.key);
  if (key !== expectedKey) return invalidProviderMetadata("R2 returned metadata for the wrong object key");
  return Object.freeze({
    key,
    generation: objectStorageGeneration(value.version),
    contentType: objectStorageContentType(value.httpMetadata?.contentType),
    byteSize: objectStorageByteSize(value.size),
    sha256: sha256FromR2(value.checksums?.sha256),
    createdAt: createdAtFromR2(value.uploaded),
  });
}

function requiredEtag(value: R2StoredObjectLike): string {
  if (typeof value.etag !== "string" || value.etag.length === 0) {
    return invalidProviderMetadata("R2 object ETag is invalid");
  }
  return value.etag;
}

async function* readR2Chunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      if (!(result.value instanceof Uint8Array)) {
        throw new ObjectStorageValidationError("invalid-body", "R2 returned a non-byte object chunk");
      }
      if (result.value.byteLength > 0) yield result.value.slice();
    }
  } finally {
    reader.releaseLock();
  }
}

/** Cloudflare R2 adapter for the private, create-only object-storage contract. */
export class R2ObjectStorage implements ObjectStorage {
  readonly #bucket: R2BucketLike;
  readonly #customMetadata: Readonly<Record<string, string>> | undefined;
  readonly #pending = new Map<string, Promise<PutObjectIfAbsentResult>>();

  constructor(options: R2ObjectStorageOptions) {
    if (options === null || typeof options !== "object" || !options.bucket) {
      invalidProviderMetadata("R2 object storage requires an injected bucket binding");
    }
    this.#bucket = options.bucket;
    this.#customMetadata = snapshotCustomMetadata(options.customMetadata);
  }

  async putIfAbsent(value: PutObjectIfAbsent): Promise<PutObjectIfAbsentResult> {
    const input = putObjectIfAbsentInput(value);
    const existing = await this.#bucket.head(input.key);
    if (existing) {
      return Object.freeze({ outcome: "already-exists", object: metadataFromR2(existing, input.key) });
    }

    const pending = this.#pending.get(input.key);
    if (pending) {
      const result = await pending;
      return Object.freeze({ outcome: "already-exists", object: result.object });
    }

    const write = this.#store(input);
    this.#pending.set(input.key, write);
    try {
      return await write;
    } finally {
      if (this.#pending.get(input.key) === write) this.#pending.delete(input.key);
    }
  }

  async #store(input: PutObjectIfAbsent): Promise<PutObjectIfAbsentResult> {
    const bytes = await collectValidatedObjectBody(input);
    const stored = await this.#bucket.put(input.key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: input.contentType },
      ...(this.#customMetadata ? { customMetadata: this.#customMetadata } : {}),
      sha256: sha256Bytes(input.sha256),
    });
    if (stored) {
      return Object.freeze({ outcome: "stored", object: metadataFromR2(stored, input.key) });
    }

    const winner = await this.#bucket.head(input.key);
    if (!winner) return invalidProviderMetadata("R2 rejected a conditional write without returning the winning object");
    return Object.freeze({ outcome: "already-exists", object: metadataFromR2(winner, input.key) });
  }

  async head(value: ObjectStorageLocator): Promise<StoredObjectMetadata | null> {
    const locator = objectStorageLocator(value);
    const object = await this.#bucket.head(locator.key);
    if (!object || object.version !== locator.generation) return null;
    return metadataFromR2(object, locator.key);
  }

  async openRead(value: ObjectStorageLocator): Promise<OpenObjectRead | null> {
    const locator = objectStorageLocator(value);
    const headed = await this.#bucket.head(locator.key);
    if (!headed || headed.version !== locator.generation) return null;
    const object = await this.#bucket.get(locator.key, { onlyIf: { etagMatches: requiredEtag(headed) } });
    if (!object || object.version !== locator.generation || !("body" in object) || !object.body) return null;
    return Object.freeze({
      object: metadataFromR2(object, locator.key),
      chunks: readR2Chunks(object.body),
    });
  }
}
