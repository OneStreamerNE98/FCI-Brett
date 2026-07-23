import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function nestedTypeScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await nestedTypeScriptFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(child);
  }
  return files;
}

function assertOpenAIAdapterBoundary(source) {
  const fetchCallSites = source.match(/(?:\bfetch|#fetch)\s*\(/g) ?? [];
  const exactHosts = source.match(/https:\/\/api\.openai\.com\/v1\/responses/g) ?? [];

  assert.equal(
    fetchCallSites.length,
    1,
    "the OpenAI adapter must keep exactly one reviewed fetch call site",
  );
  assert.equal(
    exactHosts.length,
    1,
    "the only allowed OpenAI adapter endpoint is the exact Responses API host",
  );
  assert.match(
    source,
    /this\.\#fetch\("https:\/\/api\.openai\.com\/v1\/responses",\s*\{/,
  );
}

test("AI-03 exposes only read-only tools and no outbound messaging path", async () => {
  const applicationFiles = (await readdir(new URL("app/application/assistant/", root)))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `app/application/assistant/${name}`);
  const guardedFiles = [
    ...applicationFiles,
    "app/api/v1/assistant/route.ts",
    "app/ports/assistant-provider.ts",
  ];
  const sources = await Promise.all(guardedFiles.map(read));
  const combined = sources.join("\n");

  assert.doesNotMatch(combined, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
  assert.doesNotMatch(combined, /from\s+["'][^"']*(?:google-gmail|google-chat)/i);
  assert.doesNotMatch(combined, /\.\s*(?:send|createDraft|createMessage)\s*\(/i);
  assert.doesNotMatch(combined, /\bfetch\s*\(/);

  const tools = await read("app/application/assistant/tools.ts");
  assert.match(tools, /"search_records"/);
  assert.match(tools, /"today"/);
  assert.doesNotMatch(tools, /name:\s*["'](?:send|write|create|update|delete)/i);

  const route = await read("app/api/v1/assistant/route.ts");
  assert.match(route, /function noStore\(/);
  assert.match(route, /function noStoreResponse\(/);
  assert.match(route, /response\.headers\.set\("Cache-Control", "no-store"\)/);
  assert.match(route, /if \(originError\) return noStoreResponse\(originError\)/);
  assert.match(route, /if \("response" in auth\) return noStoreResponse\(auth\.response\)/);
  assert.equal(
    route.match(/NextResponse\.json/g)?.length,
    1,
    "route-owned JSON responses must all pass through noStore",
  );
});

test("the OpenAI adapter has one exact Responses API outbound call site", async () => {
  const adapterFiles = await nestedTypeScriptFiles(
    new URL("app/adapters/openai/", root),
  );
  assert.ok(adapterFiles.length > 0, "the reviewed OpenAI adapter source must exist");
  const source = (await Promise.all(
    adapterFiles.map((file) => readFile(file, "utf8")),
  )).join("\n");
  assertOpenAIAdapterBoundary(source);
  assert.throws(
    () => assertOpenAIAdapterBoundary(
      source.replace("https://api.openai.com/v1/responses", "https://example.test/v1/responses"),
    ),
    /exact Responses API host/,
  );
  assert.throws(
    () => assertOpenAIAdapterBoundary(
      `${source}\nfetch("https://api.openai.com/v1/responses");`,
    ),
    /exactly one reviewed fetch call site/,
  );
});

test("the Worker remains fetch-only with no scheduled AI handler", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /const worker = \{\s*async fetch\(/);
  assert.doesNotMatch(worker, /\bscheduled\s*[:(]/);
});
