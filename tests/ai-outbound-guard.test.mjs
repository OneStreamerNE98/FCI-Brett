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
    "app/api/v1/assistant/config/route.ts",
    "app/api/v1/assistant/extract-tasks/route.ts",
    "app/api/v1/assistant/triage/route.ts",
    "app/api/v1/assistant/reply-draft/route.ts",
    "app/domain/assistant-config.ts",
    "app/lib/assistant-config-sites.ts",
    "app/ports/assistant-provider.ts",
  ];
  // Only the two Gmail-reading routes (triage, reply-draft) may import the Gmail
  // client for read-only summary/context lookups; every other guarded file — all
  // application modules included — must stay clear of google-gmail entirely.
  const gmailReaderRoutes = new Set([
    "app/api/v1/assistant/triage/route.ts",
    "app/api/v1/assistant/reply-draft/route.ts",
  ]);
  const sources = await Promise.all(guardedFiles.map(read));
  const combined = sources.join("\n");
  const guardedWithoutGmailReaders = sources
    .filter((_source, index) => !gmailReaderRoutes.has(guardedFiles[index]))
    .join("\n");

  assert.doesNotMatch(combined, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
  assert.doesNotMatch(guardedWithoutGmailReaders, /from\s+["'][^"']*(?:google-gmail|google-chat)/i);
  assert.doesNotMatch(combined, /from\s+["'][^"']*google-chat/i);
  assert.doesNotMatch(combined, /\.\s*(?:send|createDraft|createMessage)\s*\(/i);
  assert.doesNotMatch(combined, /\bfetch\s*\(/);

  const tools = await read("app/application/assistant/tools.ts");
  assert.match(tools, /"search_records"/);
  assert.match(tools, /"today"/);
  assert.doesNotMatch(tools, /name:\s*["'](?:send|write|create|update|delete)/i);

  const route = await read("app/api/v1/assistant/route.ts");
  assert.match(route, /import \{ noStoreJson as noStore, noStoreResponse \} from "\.\.\/\.\.\/\.\.\/lib\/no-store-json"/);
  assert.doesNotMatch(route, /function noStore(?:Response)?\(/);
  assert.match(route, /if \(originError\) return noStoreResponse\(originError\)/);
  assert.match(route, /if \("response" in auth\) return noStoreResponse\(auth\.response\)/);
  assert.doesNotMatch(route, /NextResponse\.json/);

  const taskExtractionRoute = await read(
    "app/api/v1/assistant/extract-tasks/route.ts",
  );
  const triageRoute = await read("app/api/v1/assistant/triage/route.ts");
  assert.match(
    triageRoute,
    /import \{ validateGmailMessageId \} from ["'][^"']*lib\/google-gmail["']/,
  );
  assert.match(taskExtractionRoute, /import \{ noStoreJson as noStore, noStoreResponse \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/no-store-json"/);
  assert.doesNotMatch(taskExtractionRoute, /function noStore(?:Response)?\(/);
  assert.match(
    taskExtractionRoute,
    /if \(originError\) return noStoreResponse\(originError\)/,
  );
  assert.match(
    taskExtractionRoute,
    /if \("response" in auth\) return noStoreResponse\(auth\.response\)/,
  );
  assert.doesNotMatch(taskExtractionRoute, /NextResponse\.json/);

  const noStoreHelper = await read("app/lib/no-store-json.ts");
  assert.match(noStoreHelper, /NextResponse\.json\(/);
  assert.match(noStoreHelper, /response\.headers\.set\("Cache-Control", "no-store"\)/);
  assert.doesNotMatch(
    taskExtractionRoute,
    /\bcreateTask\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/,
  );
  assert.match(triageRoute, /client\.getMessageSummary\(messageId\)/);
  assert.doesNotMatch(
    triageRoute,
    /\b(?:applyFiledLabel|createReplyDraft|sendTestMessage|getMessageArchive|modify|send)\s*\(/,
  );
  assert.doesNotMatch(triageRoute, /\bfetch\s*\(/);

  // AI-06 reply drafting reuses the exact same read-only Gmail boundary: it may
  // read the reply context and a bounded body, and nothing else. Any draft/send
  // path (the only Gmail write stays the separate save-draft route) is denied.
  const replyDraftRoute = await read("app/api/v1/assistant/reply-draft/route.ts");
  const replyDraftApplication = await read("app/application/assistant/reply-draft.ts");
  assert.match(
    replyDraftRoute,
    /import \{ validateGmailMessageId \} from ["'][^"']*lib\/google-gmail["']/,
  );
  assert.match(
    replyDraftRoute,
    /import \{ noStoreJson, noStoreResponse \} from ["'][^"']*lib\/no-store-json["']/,
  );
  assert.doesNotMatch(replyDraftRoute, /NextResponse\.json/);
  assert.match(replyDraftRoute, /if \(originError\) return noStoreResponse\(originError\)/);
  assert.match(replyDraftRoute, /if \("response" in auth\) return noStoreResponse\(auth\.response\)/);
  // Single-client-call accounting: exactly the two allowed read-only methods.
  assert.match(replyDraftRoute, /client\.getReplyContext\(messageId\)/);
  assert.match(replyDraftRoute, /client\.getMessageBodyText\(messageId\)/);
  assert.equal(replyDraftRoute.match(/client\.[A-Za-z]+/gu)?.length, 2);
  // Deny + count: neither the route nor its application module may reach a Gmail
  // mutation, draft, archive fetch, label, or send.
  assert.doesNotMatch(
    `${replyDraftRoute}\n${replyDraftApplication}`,
    /\b(?:applyFiledLabel|createReplyDraft|sendTestMessage|getMessageArchive|modify|send)\s*\(/u,
  );
  assert.doesNotMatch(replyDraftRoute, /\bfetch\s*\(/);
  assert.doesNotMatch(replyDraftApplication, /\bfetch\s*\(/);
  assert.doesNotMatch(replyDraftApplication, /from\s+["'][^"']*google-gmail/i);
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
