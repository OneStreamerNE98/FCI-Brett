import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("successful lead creation schedules the isolated Chat notifier without awaiting it", async () => {
  const source = await readFile(new URL("app/api/v1/leads/route.ts", root), "utf8");
  const failureBranch = source.indexOf("if (!result.ok)");
  const notification = source.indexOf("queueGoogleChatNotification(");
  const response = source.indexOf("return NextResponse.json({ lead: result.value }");

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
