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
