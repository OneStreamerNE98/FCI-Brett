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
  // SET-42 invalidates the read-only queue projection after the ordinary task
  // route retires the review; it still must not write through that queue route.
  assert.doesNotMatch(taskAccept, /fetch\([^)]*\/api\/v1\/inbox-analysis/u);
  assert.match(taskAccept, /invalidateInboxAnalysisReadCaches\(\{ notify: false \}\)/u);
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

test("every typed accept records why the row left the queue, not just that it left", async () => {
  // Found by independent audit (PR #256): AI-11(a) retires schedule and warranty accepts
  // as "accepted" through the task route's atomic retirement, but the lead accept went
  // through the PATCH, which hardcoded "dismissed". That made a lead accepted via
  // Create lead indistinguishable from a manual Mark reviewed, so the AI-11(d) activity
  // view and its per-label accept/dismiss counts would misreport every lead accept.
  // Worse than uniform: leads read as dismissals while tasks read as accepts.
  const [route, view, port, d1, postgres] = await Promise.all([
    read("app/api/v1/inbox-analysis/route.ts"),
    read("app/inbox/components/InboxView.tsx"),
    read("app/ports/mail-item-repository.ts"),
    read("app/adapters/d1/mail-item-repository.ts"),
    read("app/adapters/postgres/mail-item-repository.ts"),
  ]);

  // The outcome is server-validated to exactly two values and defaults to dismissed.
  assert.match(route, /outcome !== "accepted" && outcome !== "dismissed"/u);
  assert.match(route, /body\.outcome === undefined \? "dismissed" : body\.outcome/u);
  assert.match(route, /status: update\.outcome/u);

  // The lead accept sends "accepted"; a hand dismissal stays "dismissed".
  assert.match(view, /outcome: reason === "lead-created" \? "accepted" : "dismissed"/u);

  // Found by adversarial audit of this very fix: the RECOVERY path was still wrong. When a
  // lead is created but its retirement PATCH fails, the banner sends the user to Mark
  // reviewed — and Create lead is gone by then, because leadCreatedRowIds is append-only.
  // Passing the default "manual" there writes "dismissed" for a row that HAS a lead, which
  // is the exact misreporting this whole change exists to prevent, and it is irreversible:
  // both adapters guard `status = 'needs-review'`, so the row is terminal after one write.
  assert.match(
    view,
    /markReviewed\(\s*row,\s*leadCreatedRowIds\.has\(row\.id\) \? "lead-created" : "manual",?\s*\)/u,
    "the Mark reviewed control must retire a lead-created row as lead-created, not manual",
  );

  // The port narrows the outcome below MailItemStatus so the sweep-only terminal
  // states cannot be reached through a human retirement path.
  assert.match(port, /MailItemReviewOutcome = "accepted" \| "dismissed"/u);

  // Both adapters BIND the status rather than interpolating it, and both re-guard it.
  for (const [name, source] of [["d1", d1], ["postgres", postgres]]) {
    assert.match(
      source,
      /outcome !== "accepted" && outcome !== "dismissed"\) return false/u,
      `${name} adapter must re-guard the outcome`,
    );
    assert.doesNotMatch(
      source,
      /SET status = '(accepted|dismissed)'/u,
      `${name} adapter must not hardcode a retirement status`,
    );
  }
});
