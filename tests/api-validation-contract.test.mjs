import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("client creation validates JSON field types before normalization", async () => {
  const route = await read("app/api/v1/clients/route.ts");

  assert.match(route, /typeof record\[field\] !== "string"/);
  assert.match(route, /typeof record\.primaryContact !== "object"/);
  assert.match(route, /typeof primaryContact\[field\] !== "string"/);
  assert.match(route, /Client details must be valid JSON/);
});

test("duplicate client protection is atomic and leaves no dependent records", async () => {
  const route = await read("app/api/v1/clients/route.ts");

  assert.match(route, /INSERT INTO clients[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM clients WHERE LOWER\(name\) = LOWER\(\?\)/);
  assert.match(route, /INSERT INTO activity_events[\s\S]*WHERE EXISTS \(SELECT 1 FROM clients WHERE id = \?\)/);
  assert.match(route, /INSERT INTO contacts[\s\S]*WHERE EXISTS \(SELECT 1 FROM clients WHERE id = \?\)/);
  assert.match(route, /results\[0\]\.meta\.changes !== 1/);
  assert.match(route, /status: 409/);
});

test("project creation validates string and numeric JSON fields before use", async () => {
  const route = await read("app/api/v1/projects/route.ts");

  assert.match(route, /\["clientId", "name", "status", "site", "projectManager"\]/);
  assert.match(route, /typeof record\[field\] !== "string"/);
  assert.match(route, /typeof record\.estimatedValue !== "number"/);
  assert.match(route, /Number\.isSafeInteger\(body\.estimatedValue\)/);
  assert.match(route, /Project details must be valid JSON/);
});
