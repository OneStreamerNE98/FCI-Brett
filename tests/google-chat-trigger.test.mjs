import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("successful lead creation schedules the isolated Chat notifier without awaiting it", async () => {
  const source = await readFile(new URL("app/api/v1/leads/route.ts", root), "utf8");
  const failureBranch = source.indexOf("if (!result.ok)");
  const notification = source.indexOf("queueGoogleChatNotification(");
  const response = source.indexOf("return NextResponse.json(", notification);

  assert.match(source, /import \{ queueGoogleChatNotification \} from "\.\.\/\.\.\/\.\.\/lib\/google-chat-notifier-sites"/);
  assert.ok(failureBranch >= 0 && notification > failureBranch && response > notification);
  assert.doesNotMatch(source, /await\s+queueGoogleChatNotification/);

  const invocation = source.slice(notification, response);
  assert.match(invocation, /eventType: "lead\.created"/);
  assert.match(invocation, /entityId: result\.value\.id/);
  assert.match(invocation, /leadNumber: result\.value\.leadNumber/);
  assert.match(invocation, /company: result\.value\.company/);
  assert.match(invocation, /projectName: result\.value\.projectName/);
  assert.match(invocation, /auth\.user\.email/);
  assert.match(invocation, /request\.nextUrl\.origin/);
  assert.doesNotMatch(invocation, /contact(?:Email|Phone|Name)|address|estimatedValue/i);
});

test("successful assigned-task creation schedules task.assigned only after persistence", async () => {
  const source = await readFile(new URL("app/api/v1/tasks/route.ts", root), "utf8");
  const failureBranch = source.indexOf("if (!result.ok)");
  const assignedGuard = source.indexOf("if (result.value.assigneeEmail)");
  const notification = source.indexOf("queueGoogleChatNotification(", assignedGuard);
  const response = source.indexOf("return json({ task: result.value }", notification);

  assert.match(source, /import \{ queueGoogleChatNotification \} from "\.\.\/\.\.\/\.\.\/lib\/google-chat-notifier-sites"/);
  assert.ok(
    failureBranch >= 0
      && assignedGuard > failureBranch
      && notification > assignedGuard
      && response > notification,
  );
  assert.doesNotMatch(source.slice(assignedGuard, response), /await\s+queueGoogleChatNotification/);

  const invocation = source.slice(notification, response);
  assert.match(invocation, /eventType: "task\.assigned"/);
  assert.match(invocation, /entityId: result\.value\.id/);
  assert.match(invocation, /taskTitle: result\.value\.title/);
  assert.match(invocation, /assigneeEmail: result\.value\.assigneeEmail/);
  assert.match(invocation, /result\.value\.dueDate/);
  assert.match(invocation, /auth\.user\.email/);
  assert.match(invocation, /request\.nextUrl\.origin/);
});

test("an inbox sweep schedules one coalesced filing-review event without awaiting it", async () => {
  const source = await readFile(
    new URL("app/api/v1/inbox-analysis/route.ts", root),
    "utf8",
  );
  const persistence = source.indexOf("const saved = await saveAnalysis(");
  const arrivalGuard = source.indexOf("if (saved.enteredReview)", persistence);
  const accumulate = source.indexOf("needsReviewArrivals.push({", arrivalGuard);
  const workerJoin = source.indexOf("await Promise.all(workers);", accumulate);
  const callback = source.indexOf("input.onNeedsReviewBatch({", workerJoin);
  const notification = source.indexOf("queueGoogleChatNotification(", callback);

  assert.match(
    source,
    /import \{ queueGoogleChatNotification \} from "\.\.\/\.\.\/\.\.\/lib\/google-chat-notifier-sites"/u,
  );
  // The emit must sit after the worker join, which is what makes one sweep
  // cost one card instead of one per analyzed message.
  assert.ok(
    persistence >= 0
      && arrivalGuard > persistence
      && accumulate > arrivalGuard
      && workerJoin > accumulate
      && callback > workerJoin
      && notification > callback,
  );
  assert.equal(
    source.indexOf("input.onNeedsReviewBatch({", persistence),
    callback,
    "the sweep body may emit the batch only after joining its workers",
  );
  assert.doesNotMatch(
    source.slice(workerJoin, notification + 500),
    /await\s+queueGoogleChatNotification/u,
  );
  const invocation = source.slice(notification, notification + 500);
  assert.match(invocation, /eventType: "gmail\.filing_review_needed"/u);
  assert.match(invocation, /entityId: notification\.gmailMessageId/u);
  assert.match(invocation, /subject: notification\.subject/u);
  assert.match(invocation, /auth\.user\.email/u);
  assert.match(invocation, /request\.nextUrl\.origin/u);
});
