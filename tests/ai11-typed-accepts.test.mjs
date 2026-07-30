import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function TypeScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await TypeScriptFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(child);
  }
  return files;
}

test("AI-11(a) keeps every queue intent human-approved through an ordinary route", async () => {
  const inbox = await read("app/inbox/components/InboxView.tsx");

  assert.match(inbox, />\s*Create lead\s*<\/button>/u);
  assert.match(inbox, />\s*Review project update\s*<\/button>/u);
  assert.match(inbox, />\s*Create schedule task\s*<\/button>/u);
  assert.match(inbox, />\s*Create warranty callback task\s*<\/button>/u);

  const projectAcceptStart = inbox.indexOf("function acceptProjectUpdate(");
  const taskAcceptStart = inbox.indexOf("async function createTaskFromProposal(");
  const triageAcceptStart = inbox.indexOf("function acceptTriageSuggestion(", projectAcceptStart);
  assert.ok(projectAcceptStart >= 0 && taskAcceptStart > projectAcceptStart);
  assert.ok(triageAcceptStart > taskAcceptStart);
  const projectAccept = inbox.slice(projectAcceptStart, taskAcceptStart);
  const taskAccept = inbox.slice(taskAcceptStart, triageAcceptStart);

  assert.match(projectAccept, /acceptTriageSuggestion\(message,/u);
  assert.match(projectAccept, /openFilingReview\(message\)/u);
  assert.match(
    inbox,
    /\/api\/v1\/integrations\/google\/gmail\/messages\/\$\{encodeURIComponent\(filingMessage\.id\)\}\/file/u,
  );
  assert.doesNotMatch(projectAccept, /fetch\(/u);

  assert.match(taskAccept, /fetch\("\/api\/v1\/tasks", \{/u);
  assert.match(taskAccept, /source:\s*"email"/u);
  assert.match(taskAccept, /sourceRef:\s*proposal\.row\.analysis\.gmailMessageId/u);
  assert.match(taskAccept, /inboxReviewId:\s*proposal\.row\.id/u);
  assert.match(taskAccept, /inboxReviewIntent:\s*proposal\.kind/u);
  assert.doesNotMatch(taskAccept, /\/api\/v1\/inbox-analysis/u);
  assert.doesNotMatch(taskAccept, /method:\s*"PATCH"/u);

  assert.match(inbox, /Nothing is created until you submit this form\./u);
});

test("AI-11(a) adds no component module and leaves the assistant application tree write-free", async () => {
  const inboxComponents = (
    await readdir(new URL("app/inbox/components/", root))
  ).filter((name) => name.endsWith(".tsx")).sort();
  const assistantComponents = (
    await readdir(new URL("app/assistant/components/", root))
  ).filter((name) => name.endsWith(".tsx")).sort();

  assert.deepEqual(inboxComponents, ["GmailReplyModal.tsx", "InboxView.tsx"]);
  assert.deepEqual(assistantComponents, [
    "AssistantHelpPanel.tsx",
    "AssistantView.tsx",
    "TaskManagementPanel.tsx",
    "TodayPanel.tsx",
  ]);

  const assistantFiles = await TypeScriptFiles(
    new URL("app/application/assistant/", root),
  );
  const assistantSource = (
    await Promise.all(assistantFiles.map((file) => readFile(file, "utf8")))
  ).join("\n");
  assert.doesNotMatch(
    assistantSource,
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/u,
  );
});
