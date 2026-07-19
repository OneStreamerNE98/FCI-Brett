import { Storage, type StorageOptions } from "@google-cloud/storage";

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

const GCS_SHA256_METADATA_KEY = "fciSha256";
const GCS_BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

type GcsFileMetadataLike = Readonly<{
  name?: unknown;
  generation?: unknown;
  contentType?: unknown;
  size?: unknown;
  timeCreated?: unknown;
  metadata?: unknown;
}>;

type GcsFileLike = {
  metadata?: GcsFileMetadataLike;
  getMetadata(): Promise<readonly [GcsFileMetadataLike, ...unknown[]]>;
  save(
    data: Uint8Array,
    options: Readonly<{
      resumable: false;
      validation: "crc32c";
      preconditionOpts: Readonly<{ ifGenerationMatch: 0 }>;
      metadata: Readonly<{
        contentType: string;
        metadata: Readonly<Record<string, string>>;
      }>;
    }>,
  ): Promise<void>;
  createReadStream(options?: Readonly<{ validation: true }>): AsyncIterable<unknown>;
};

type GcsBucketLike = Readonly<{
  file(key: string, options?: Readonly<{ generation?: string }>): GcsFileLike;
}>;

export type GcsStorageLike = Readonly<{
  bucket(bucketName: string): GcsBucketLike;
}>;

export type GcsObjectStorageOptions = Readonly<{
  bucketName: string;
  /** Inject a client in tests/composition; otherwise Application Default Credentials are used. */
  storage?: GcsStorageLike;
  /** Non-secret client configuration used only when storage is not injected. */
  storageOptions?: StorageOptions;
  customMetadata?: Readonly<Record<string, string>>;
}>;

function invalidProviderMetadata(message: string): never {
  throw new ObjectStorageValidationError("invalid-input", message);
}

function validatedBucketName(value: unknown): string {
  if (typeof value !== "string" || !GCS_BUCKET_PATTERN.test(value)) {
    return invalidProviderMetadata("GCS object storage requires a valid injected bucket name");
  }
  return value;
}

function snapshotCustomMetadata(value: Readonly<Record<string, string>> | undefined) {
  if (value === undefined) return Object.freeze(Object.create(null)) as Readonly<Record<string, string>>;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidProviderMetadata("GCS custom metadata must be a plain string map");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidProviderMetadata("GCS custom metadata must be a plain string map");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const metadata: Record<string, string> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key === GCS_SHA256_METADATA_KEY) {
      return invalidProviderMetadata("GCS custom metadata contains a reserved or invalid key");
    }
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return invalidProviderMetadata("GCS custom metadata values must be enumerable strings");
    }
    metadata[key] = descriptor.value;
  }
  return Object.freeze(metadata);
}

function providerErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function isProviderStatus(error: unknown, status: number): boolean {
  return providerErrorCode(error) === String(status);
}

function byteSizeFromGcs(value: unknown): number {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return objectStorageByteSize(Number(value));
  }
  return objectStorageByteSize(value);
}

function createdAtFromGcs(value: unknown): number {
  if (typeof value !== "string") return invalidProviderMetadata("GCS object creation time is invalid");
  const createdAt = Date.parse(value);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    return invalidProviderMetadata("GCS object creation time is invalid");
  }
  return createdAt;
}

function sha256FromGcs(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidProviderMetadata("GCS object is missing its canonical SHA-256 metadata");
  }
  const sha256 = (value as Record<string, unknown>)[GCS_SHA256_METADATA_KEY];
  return objectStorageSha256(sha256);
}

function metadataFromGcs(value: GcsFileMetadataLike, expectedKey: string): StoredObjectMetadata {
  const key = objectStorageKey(value.name);
  if (key !== expectedKey) return invalidProviderMetadata("GCS returned metadata for the wrong object key");
  return Object.freeze({
    key,
    generation: objectStorageGeneration(
      typeof value.generation === "number" ? String(value.generation) : value.generation,
    ),
    contentType: objectStorageContentType(value.contentType),
    byteSize: byteSizeFromGcs(value.size),
    sha256: sha256FromGcs(value.metadata),
    createdAt: createdAtFromGcs(value.timeCreated),
  });
}

async function* readGcsChunks(stream: AsyncIterable<unknown>): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) {
      throw new ObjectStorageValidationError("invalid-body", "GCS returned a non-byte object chunk");
    }
    if (chunk.byteLength > 0) yield Uint8Array.from(chunk);
  }
}

/** Google Cloud Storage adapter. It is source-only until production file routes are composed. */
export class GcsObjectStorage implements ObjectStorage {
  readonly #bucket: GcsBucketLike;
  readonly #customMetadata: Readonly<Record<string, string>>;
  readonly #pending = new Map<string, Promise<PutObjectIfAbsentResult>>();

  constructor(options: GcsObjectStorageOptions) {
    if (options === null || typeof options !== "object") {
      invalidProviderMetadata("GCS object storage requires injected configuration");
    }
    if (options.storage && options.storageOptions) {
      invalidProviderMetadata("Inject either a GCS client or client options, not both");
    }
    const storage: GcsStorageLike = options.storage ?? new Storage(options.storageOptions);
    this.#bucket = storage.bucket(validatedBucketName(options.bucketName));
    this.#customMetadata = snapshotCustomMetadata(options.customMetadata);
  }

  async #current(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const [metadata] = await this.#bucket.file(key).getMetadata();
      return metadataFromGcs(metadata, key);
    } catch (error) {
      if (isProviderStatus(error, 404)) return null;
      throw error;
    }
  }

  async putIfAbsent(value: PutObjectIfAbsent): Promise<PutObjectIfAbsentResult> {
    const input = putObjectIfAbsentInput(value);
    const existing = await this.#current(input.key);
    if (existing) return Object.freeze({ outcome: "already-exists", object: existing });

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
    const file = this.#bucket.file(input.key);
    try {
      await file.save(bytes, {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: input.contentType,
          metadata: Object.freeze({ ...this.#customMetadata, [GCS_SHA256_METADATA_KEY]: input.sha256 }),
        },
      });
    } catch (error) {
      if (!isProviderStatus(error, 412)) throw error;
      const winner = await this.#current(input.key);
      if (!winner) return invalidProviderMetadata("GCS rejected a conditional write without returning the winning object");
      return Object.freeze({ outcome: "already-exists", object: winner });
    }

    const metadata = file.metadata ?? (await file.getMetadata())[0];
    return Object.freeze({ outcome: "stored", object: metadataFromGcs(metadata, input.key) });
  }

  async head(value: ObjectStorageLocator): Promise<StoredObjectMetadata | null> {
    const locator = objectStorageLocator(value);
    try {
      const [metadata] = await this.#bucket.file(locator.key, { generation: locator.generation }).getMetadata();
      const object = metadataFromGcs(metadata, locator.key);
      return object.generation === locator.generation ? object : null;
    } catch (error) {
      if (isProviderStatus(error, 404)) return null;
      throw error;
    }
  }

  async openRead(value: ObjectStorageLocator): Promise<OpenObjectRead | null> {
    const locator = objectStorageLocator(value);
    const file = this.#bucket.file(locator.key, { generation: locator.generation });
    let object: StoredObjectMetadata;
    try {
      const [metadata] = await file.getMetadata();
      object = metadataFromGcs(metadata, locator.key);
    } catch (error) {
      if (isProviderStatus(error, 404)) return null;
      throw error;
    }
    if (object.generation !== locator.generation) return null;
    return Object.freeze({ object, chunks: readGcsChunks(file.createReadStream({ validation: true })) });
  }
}
