export const OBJECT_STORAGE_LIMITS = Object.freeze({
  maxKeyBytes: 512,
  maxGenerationBytes: 128,
  maxContentTypeBytes: 255,
  maxObjectBytes: 32 * 1024 * 1024,
  maxStreamChunks: 4_096,
  readChunkBytes: 64 * 1024,
});

export type ObjectStorageValidationCode =
  | "invalid-input"
  | "invalid-key"
  | "invalid-generation"
  | "invalid-content-type"
  | "invalid-byte-size"
  | "invalid-sha256"
  | "invalid-body"
  | "body-size-mismatch"
  | "body-checksum-mismatch";

export class ObjectStorageValidationError extends Error {
  readonly code: ObjectStorageValidationCode;

  constructor(code: ObjectStorageValidationCode, message: string) {
    super(message);
    this.name = "ObjectStorageValidationError";
    this.code = code;
  }
}

export type ObjectStorageLocator = Readonly<{
  key: string;
  /** Provider-issued opaque value. Callers must compare it exactly, never parse it. */
  generation: string;
}>;

export type StoredObjectMetadata = ObjectStorageLocator & Readonly<{
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: number;
}>;

export type PutObjectIfAbsent = Readonly<{
  key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  chunks: AsyncIterable<Uint8Array>;
}>;

export type PutObjectIfAbsentResult =
  | Readonly<{ outcome: "stored"; object: StoredObjectMetadata }>
  | Readonly<{ outcome: "already-exists"; object: StoredObjectMetadata }>;

export type OpenObjectRead = Readonly<{
  object: StoredObjectMetadata;
  chunks: AsyncIterable<Uint8Array>;
}>;

/**
 * Minimal private-object boundary. It deliberately has no overwrite, list,
 * delete, public-URL, or signed-URL operation.
 */
export interface ObjectStorage {
  putIfAbsent(input: PutObjectIfAbsent): Promise<PutObjectIfAbsentResult>;
  head(locator: ObjectStorageLocator): Promise<StoredObjectMetadata | null>;
  openRead(locator: ObjectStorageLocator): Promise<OpenObjectRead | null>;
}

const OBJECT_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GENERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function exactDataProperties(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  const sortedExpected = [...expected].sort();
  if (
    actual.some((key) => typeof key !== "string") ||
    actual.length !== sortedExpected.length ||
    !(actual as string[]).sort().every((key, index) => key === sortedExpected[index])
  ) {
    return null;
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

export function objectStorageKey(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || byteLength(value) > OBJECT_STORAGE_LIMITS.maxKeyBytes) {
    throw new ObjectStorageValidationError("invalid-key", "Object key must be a bounded nonempty string");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" || segment === "." || segment === ".." || !OBJECT_KEY_SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new ObjectStorageValidationError("invalid-key", "Object key must contain only safe opaque path segments");
  }
  return value;
}

export function objectStorageGeneration(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    byteLength(value) > OBJECT_STORAGE_LIMITS.maxGenerationBytes ||
    !GENERATION_PATTERN.test(value)
  ) {
    throw new ObjectStorageValidationError(
      "invalid-generation",
      "Object generation must be a bounded opaque provider value",
    );
  }
  return value;
}

export function objectStorageContentType(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    byteLength(value) > OBJECT_STORAGE_LIMITS.maxContentTypeBytes ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ObjectStorageValidationError(
      "invalid-content-type",
      "Object content type must be bounded printable text",
    );
  }
  return value;
}

export function objectStorageByteSize(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > OBJECT_STORAGE_LIMITS.maxObjectBytes
  ) {
    throw new ObjectStorageValidationError(
      "invalid-byte-size",
      `Object byte size must be an integer from 0 to ${OBJECT_STORAGE_LIMITS.maxObjectBytes}`,
    );
  }
  return value;
}

export function objectStorageSha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ObjectStorageValidationError("invalid-sha256", "Object SHA-256 must use canonical lowercase form");
  }
  return value;
}

export function objectStorageLocator(value: unknown): ObjectStorageLocator {
  const fields = exactDataProperties(value, ["generation", "key"]);
  if (!fields) {
    throw new ObjectStorageValidationError("invalid-input", "Object locator must contain only key and generation");
  }
  return Object.freeze({
    key: objectStorageKey(fields.key),
    generation: objectStorageGeneration(fields.generation),
  });
}

export function putObjectIfAbsentInput(value: unknown): PutObjectIfAbsent {
  const fields = exactDataProperties(
    value,
    ["byteSize", "chunks", "contentType", "key", "sha256"],
  );
  if (!fields) {
    throw new ObjectStorageValidationError(
      "invalid-input",
      "Object write must contain only key, contentType, byteSize, sha256, and chunks",
    );
  }
  const chunks = fields.chunks;
  if (
    chunks === null ||
    (typeof chunks !== "object" && typeof chunks !== "function") ||
    typeof (chunks as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function"
  ) {
    throw new ObjectStorageValidationError("invalid-body", "Object body must be an AsyncIterable of bytes");
  }
  return Object.freeze({
    key: objectStorageKey(fields.key),
    contentType: objectStorageContentType(fields.contentType),
    byteSize: objectStorageByteSize(fields.byteSize),
    sha256: objectStorageSha256(fields.sha256),
    chunks: chunks as AsyncIterable<Uint8Array>,
  });
}
