import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("assistant only promotes an explicitly primary contact", async () => {
  const source = await read("app/api/v1/assistant/route.ts");

  assert.match(source, /const primaryContact = firstContact\?\.is_primary \? firstContact : null/);
  assert.match(source, /but none is marked as the primary contact/);
  assert.match(source, /Mark one saved client contact as primary/);
  assert.doesNotMatch(source, /primaryContact: contacts\.results\[0\] \?\? null/);
});

test("upload rejects malformed and oversized declared bodies before parsing multipart data", async () => {
  const source = await read("app/api/v1/uploads/route.ts");
  const lengthCheck = source.indexOf('request.headers.get("content-length")');
  const formParse = source.indexOf("await request.formData()");

  assert.ok(lengthCheck >= 0, "content-length validation should be present");
  assert.ok(formParse > lengthCheck, "content-length must be checked before multipart parsing");
  assert.match(source, /const MAX_FILE_BYTES = 20 \* 1024 \* 1024/);
  assert.match(source, /const MAX_MULTIPART_BYTES = 22 \* 1024 \* 1024/);
  assert.match(source, /if \(!\/\^\\d\+\$\/\.test\(contentLengthHeader\)\)/);
  assert.match(source, /if \(!Number\.isSafeInteger\(declaredLength\)\)/);
  assert.match(source, /declaredLength > MAX_MULTIPART_BYTES/);
  assert.match(source, /new R2ObjectStorage/);
  assert.match(source, /sha256:\s*`sha256:/);
  assert.match(source, /file\.name\.replace\(\/\[\^a-zA-Z0-9\._-\]\/g, "-"\)/);
  assert.doesNotMatch(source, /env\.FILES\.put/);
});

test("the source-only GCS adapter is not composed into fail-closed Cloud Run provider routes", async () => {
  const [adapter, router, composition] = await Promise.all([
    read("app/adapters/gcs/object-storage.ts"),
    read("app/platform/google-cloud/employee-request-router.ts"),
    read("app/platform/google-cloud/production-composition.ts"),
  ]);

  assert.match(adapter, /ifGenerationMatch:\s*0/);
  assert.match(adapter, /GCS_SHA256_METADATA_KEY/);
  assert.doesNotMatch(router, /adapters\/gcs\/object-storage|GcsObjectStorage/);
  assert.doesNotMatch(composition, /adapters\/gcs\/object-storage|GcsObjectStorage/);
});
