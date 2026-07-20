import { createHash } from "node:crypto";

import {
  OBJECT_STORAGE_LIMITS,
  ObjectStorageValidationError,
  type PutObjectIfAbsent,
} from "../ports/object-storage.ts";

/**
 * Validate a declared object body before any provider write begins.
 *
 * The current storage boundary caps objects at 32 MiB, so buffering here keeps
 * invalid size/checksum input atomic across providers instead of leaving a
 * partially accepted object behind.
 */
export async function collectValidatedObjectBody(input: PutObjectIfAbsent): Promise<Uint8Array> {
  const bytes = new Uint8Array(input.byteSize);
  const hash = createHash("sha256");
  let offset = 0;
  let chunkCount = 0;

  for await (const chunk of input.chunks) {
    chunkCount += 1;
    if (chunkCount > OBJECT_STORAGE_LIMITS.maxStreamChunks) {
      throw new ObjectStorageValidationError("invalid-body", "Object body contains too many chunks");
    }
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
      throw new ObjectStorageValidationError("invalid-body", "Object body chunks must be nonempty Uint8Array values");
    }
    if (offset + chunk.byteLength > input.byteSize) {
      throw new ObjectStorageValidationError("body-size-mismatch", "Object body exceeds its declared byte size");
    }
    bytes.set(chunk, offset);
    hash.update(chunk);
    offset += chunk.byteLength;
  }

  if (offset !== input.byteSize) {
    throw new ObjectStorageValidationError("body-size-mismatch", "Object body does not match its declared byte size");
  }
  const actualSha256 = `sha256:${hash.digest("hex")}`;
  if (actualSha256 !== input.sha256) {
    throw new ObjectStorageValidationError("body-checksum-mismatch", "Object body does not match its declared SHA-256");
  }
  return bytes;
}
