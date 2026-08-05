import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const rootPath = fileURLToPath(root).replaceAll("\\", "/");

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
  // Census every fetch-shaped call site, including injected aliases such as
  // fetchImpl(...) — a bare \bfetch pattern is blind to them.
  const fetchCallSites = source.match(/\b\w*[Ff]etch\w*\s*\(/g) ?? [];
  const responsesHosts = source.match(/https:\/\/api\.openai\.com\/v1\/responses/g) ?? [];
  const modelLookupHosts = source.match(/https:\/\/api\.openai\.com\/v1\/models\//g) ?? [];

  assert.equal(
    fetchCallSites.length,
    2,
    "the OpenAI adapter must keep exactly two reviewed fetch call sites, both reviewed here",
  );
  assert.equal(
    responsesHosts.length,
    1,
    "the only allowed OpenAI adapter endpoints are the exact Responses API host (POST) and the exact model-lookup host (GET)",
  );
  assert.equal(
    modelLookupHosts.length,
    1,
    "the only allowed OpenAI adapter endpoints are the exact Responses API host (POST) and the exact model-lookup host (GET)",
  );
  assert.match(
    source,
    /this\.\#fetch\("https:\/\/api\.openai\.com\/v1\/responses",\s*\{\s*method: "POST"/,
  );
  assert.match(
    source,
    /fetchImpl\(\s*`https:\/\/api\.openai\.com\/v1\/models\/\$\{encodeURIComponent\(model\)\}`,\s*\{\s*method: "GET"/,
  );
  const withoutReviewedHosts = source
    .replaceAll("https://api.openai.com/v1/responses", "")
    .replaceAll("https://api.openai.com/v1/models/", "");
  assert.doesNotMatch(
    withoutReviewedHosts,
    /https:\/\//,
    "no other https:// host string may exist in the OpenAI adapter",
  );
}

function sourcePath(file) {
  return fileURLToPath(file).replaceAll("\\", "/").slice(rootPath.length);
}

function assertAssistantOutboundBoundary(source, label) {
  assert.doesNotMatch(
    source,
    /\b(?:sendTestMessage|createReplyDraft|applyFiledLabel|prepareFciLabels)\s*\(/u,
    `${label} must not call a Gmail mutation`,
  );
  assert.doesNotMatch(
    source,
    /from\s+["'][^"']*google-chat|GOOGLE_CHAT_|googleChat|webhook/iu,
    `${label} must not call or configure Google Chat delivery`,
  );
  assert.doesNotMatch(
    source,
    /(?:messages\/send|messages\/[^"'`\s]+\/modify|["']drafts["'])/u,
    `${label} must not embed a Gmail write endpoint`,
  );
  assert.doesNotMatch(
    source,
    /\bfetch\s*\(/u,
    `${label} must not add an unreviewed outbound fetch`,
  );
}

function assertReviewedGmailClientCalls(source, allowedMethods, label) {
  const actual = [...source.matchAll(/\bclient\.([A-Za-z][A-Za-z0-9]*)\s*\(/gu)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(
    actual,
    [...allowedMethods].sort(),
    `${label} may use only its reviewed read-only Gmail client methods`,
  );
}

function assertNoStoreRoute(source, label) {
  const sourceFile = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(
    sourceFile.parseDiagnostics.length,
    0,
    `${label} must remain parseable TypeScript`,
  );
  const noStoreHelpers = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.endsWith("no-store-json")
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      noStoreHelpers.add(binding.name.text);
    }
  }
  assert.ok(
    noStoreHelpers.size > 0,
    `${label} must import the shared no-store response helper`,
  );
  const handlerNames = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
  const handlers = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement)
    && statement.name
    && handlerNames.has(statement.name.text)
    && statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
  assert.ok(handlers.length > 0, `${label} must expose a reviewed route handler`);
  for (const handler of handlers) {
    const invalidReturns = [];
    const visit = (node) => {
      if (node !== handler && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node)) {
        let expression = node.expression;
        if (expression && ts.isAwaitExpression(expression)) {
          expression = expression.expression;
        }
        if (
          !expression
          || !ts.isCallExpression(expression)
          || !ts.isIdentifier(expression.expression)
          || !noStoreHelpers.has(expression.expression.text)
        ) {
          invalidReturns.push(sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(handler);
    assert.deepEqual(
      invalidReturns,
      [],
      `${label} ${handler.name.text} must return through a shared no-store helper`,
    );
  }
  assert.doesNotMatch(
    source,
    /\bNextResponse\b|Response\.json\s*\(|new\s+Response\s*\(/u,
    `${label} must not bypass the shared no-store response helper`,
  );
  assert.doesNotMatch(
    source,
    /return\s+(?:auth\.response|originError|rateLimitResponse|gmailErrorResponse\s*\()/u,
    `${label} must wrap delegated responses with noStoreResponse`,
  );
}

function sectionFromHeading(markdown, heading, nextHeadingPattern = /^## /mu) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading}`);
  const tail = markdown.slice(start + heading.length);
  const next = nextHeadingPattern.exec(tail);
  return markdown.slice(
    start,
    next ? start + heading.length + next.index : markdown.length,
  );
}

function assertTierTwoGates(markdown) {
  for (let index = 1; index <= 6; index += 1) {
    const heading = `- **AI-T2-${index} ·`;
    const start = markdown.indexOf(heading);
    assert.notEqual(start, -1, `missing AI-T2-${index}`);
    const next = markdown.indexOf("- **AI-T2-", start + heading.length);
    const item = markdown.slice(start, next === -1 ? markdown.length : next);
    assert.match(item, /\*\*Current source:\*\*/u, `AI-T2-${index} lacks current source truth`);
    assert.match(item, /\*\*Gate:\*\*/u, `AI-T2-${index} lacks an explicit gate`);
  }
}

function assertResidualRegister(markdown) {
  for (let index = 1; index <= 14; index += 1) {
    const residualId = `AI-R${String(index).padStart(2, "0")}`;
    assert.equal(
      markdown.split(residualId).length - 1,
      1,
      `${residualId} must appear exactly once in the reconciled account`,
    );
  }
}

test("every assistant route is no-store and the AI boundary has no outbound messaging path", async () => {
  const applicationFiles = (await readdir(new URL("app/application/assistant/", root)))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `app/application/assistant/${name}`);
  const assistantRouteFiles = (await nestedTypeScriptFiles(
    new URL("app/api/v1/assistant/", root),
  )).filter((file) => file.pathname.endsWith("/route.ts"));
  const routeSources = await Promise.all(assistantRouteFiles.map(async (file) => ({
    path: sourcePath(file),
    source: await readFile(file, "utf8"),
  })));
  assert.ok(routeSources.length > 0, "the assistant route tree must not be empty");
  const routeSourceByPath = new Map(routeSources.map((entry) => [entry.path, entry.source]));

  const guardedFiles = [
    ...applicationFiles,
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
  const routePaths = routeSources.map(({ path }) => path);
  const allGuardedPaths = [...guardedFiles, ...routePaths];
  const allGuardedSources = [
    ...sources,
    ...routeSources.map(({ source }) => source),
  ];
  const combined = allGuardedSources.join("\n");
  const guardedWithoutGmailReaders = allGuardedSources
    .filter((_source, index) => !gmailReaderRoutes.has(allGuardedPaths[index]))
    .join("\n");

  for (const { path, source } of routeSources) {
    assertNoStoreRoute(source, path);
    assertAssistantOutboundBoundary(source, path);
  }
  assertReviewedGmailClientCalls(
    routeSourceByPath.get("app/api/v1/assistant/triage/route.ts") ?? "",
    ["getMessageSummary"],
    "app/api/v1/assistant/triage/route.ts",
  );
  assertReviewedGmailClientCalls(
    routeSourceByPath.get("app/api/v1/assistant/reply-draft/route.ts") ?? "",
    ["getMessageBodyText", "getMessageSummary", "getReplyContext"],
    "app/api/v1/assistant/reply-draft/route.ts",
  );
  for (const { path, source } of routeSources) {
    if (gmailReaderRoutes.has(path)) continue;
    assertReviewedGmailClientCalls(source, [], path);
  }

  assertAssistantOutboundBoundary(combined, "the assistant source boundary");
  assert.throws(
    () => assertAssistantOutboundBoundary(
      `${combined}\nclient.sendTestMessage({ recipient: "test@example.test" });`,
      "synthetic assistant mutation",
    ),
    /must not call a Gmail mutation/u,
  );
  assert.throws(
    () => assertReviewedGmailClientCalls(
      `${routeSourceByPath.get("app/api/v1/assistant/triage/route.ts")}\nclient.writeMessage();`,
      ["getMessageSummary"],
      "synthetic assistant Gmail client",
    ),
    /reviewed read-only Gmail client methods/u,
  );
  assert.throws(
    () => assertNoStoreRoute(
      (routeSourceByPath.get("app/api/v1/assistant/today/route.ts") ?? "")
        .replace(
          "return noStoreJson(today);",
          "return new globalThis.Response(JSON.stringify(today));",
        ),
      "synthetic assistant route",
    ),
    /must return through a shared no-store helper/u,
  );

  assert.doesNotMatch(combined, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
  assert.doesNotMatch(guardedWithoutGmailReaders, /from\s+["'][^"']*(?:google-gmail|google-chat)/i);
  assert.doesNotMatch(combined, /from\s+["'][^"']*google-chat/i);
  assert.doesNotMatch(combined, /\.\s*(?:send|createDraft|createMessage)\s*\(/i);

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
  // Single-client-call accounting: exactly the three allowed read-only methods.
  // getMessageSummary is the same read-only metadata call AI-05 triage already
  // makes, and it is what feeds the shared filing-rules evaluator here.
  assert.match(replyDraftRoute, /client\.getReplyContext\(messageId\)/);
  assert.match(replyDraftRoute, /client\.getMessageBodyText\(messageId\)/);
  assert.match(replyDraftRoute, /client\.getMessageSummary\(messageId\)/);
  assert.equal(replyDraftRoute.match(/client\.[A-Za-z]+/gu)?.length, 3);
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

test("the OpenAI adapter has exactly two reviewed outbound call sites (Responses POST, model-lookup GET)", async () => {
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
    /exactly two reviewed fetch call sites/,
  );
  assert.throws(
    () => assertOpenAIAdapterBoundary(
      `${source}\nfetchImpl("https://api.openai.com/v1/models/gpt-x");`,
    ),
    /exactly two reviewed fetch call sites/,
  );
  assert.throws(
    () => assertOpenAIAdapterBoundary(
      `${source}\nconst rogue = "https://rogue.example.test/v1/exfiltrate";`,
    ),
    /no other https:\/\/ host string/,
  );
});

test("the Worker remains fetch-only with no scheduled AI handler", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /const worker = \{\s*async fetch\(/);
  assert.doesNotMatch(worker, /\bscheduled\s*[:(]/);
});

test("AI-09 documentation has one source-verified account, explicit Tier-2 gates, and one residual register", async () => {
  const [spec, guide, meetings, plan, rateLimitGuide] = await Promise.all([
    read("docs/ai-assistant-spec.md"),
    read("docs/settings-guide.md"),
    read("docs/meeting-notes-and-otter.md"),
    read("docs/agent-plan-architecture-workspace-and-setup.md"),
    read("docs/request-rate-limiting.md"),
  ]);

  const tierTwo = sectionFromHeading(
    spec,
    "## 8. Tier 2 — production-gated designs (build at launch, not before)",
  );
  assertTierTwoGates(tierTwo);
  assert.throws(
    () => assertTierTwoGates(tierTwo.replace("**Gate:**", "**Deferred:**")),
    /AI-T2-1 lacks an explicit gate/u,
  );

  const headingMatch = spec.match(/## 11\. Reconciled residual register \(source-verified \w+ \d{1,2}, \d{4}\)/);
  assert.ok(headingMatch, "missing ## 11 heading");
  const residuals = sectionFromHeading(
    spec,
    headingMatch[0],
    /$(?![\s\S])/u,
  );
  assertResidualRegister(residuals);
  assert.throws(
    () => assertResidualRegister(`${residuals}\nAI-R01`),
    /AI-R01 must appear exactly once/u,
  );

  assert.match(spec, /first-party Ask form (?:always supplies a project|is\s+selected-project only)/u);
  assert.match(spec, /route does not compose `drive_search`/u);
  assert.match(spec, /three\s+message\/draft mutations/u);
  assert.match(spec, /Stage 4 can provision missing FCI labels/u);

  assert.match(guide, /The \*\*AI Assistant\*\* page opens on \*\*Today\*\*/u);
  assert.match(guide, /current route has not composed the\s+optional `drive_search`\s+service/u);
  assert.match(guide, /\*\*Phone call\*\*/u);
  assert.doesNotMatch(guide, /there is no separate "phone call" choice/u);
  assert.match(meetings, /Assistant\s+and\s+automation\s+boundary\s+\(reconciled\s+\w+\s+\d{1,2},\s+\d{4}\)/u);
  assert.match(meetings, /proposals are not task\s+rows until an office user presses \*\*Accept\*\*/u);

  for (let index = 1; index <= 10; index += 1) {
    const id = `AI-${String(index).padStart(2, "0")}`;
    const packet = sectionFromHeading(plan, `### ${id} ·`, /^### /mu);
    assert.match(packet, /\*\*Status:\*\* Complete — PR #/u, `${id} must remain Complete`);
  }
  // AI-10 joined the loop on July 30, 2026, when its last sub-PR (f) merged —
  // the re-point this pin's own note prescribed. AI-11 is the packet that is now
  // filed but unmerged; it carries no status line at all, so there is nothing
  // premature to guard. Extend the loop again when AI-11 legitimately merges.
  const ai11 = sectionFromHeading(plan, "### AI-11 ·", /^### /mu);
  assert.doesNotMatch(ai11, /\*\*Status:\*\* Complete/u);
  assert.match(
    rateLimitGuide,
    /\/assistant\/triage`, `\/assistant\/reply-draft`/u,
  );
});
