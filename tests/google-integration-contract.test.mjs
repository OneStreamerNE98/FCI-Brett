import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("uses method-specific Shared Drive query options", async () => {
  const drive = await read("app/lib/google-drive.ts");
  const listHelper = drive.match(/private addListOptions[\s\S]*?\n  \}/u)?.[0] ?? "";
  const fileHelper = drive.match(/private addFileOptions[\s\S]*?\n  \}/u)?.[0] ?? "";

  for (const option of ["supportsAllDrives", "includeItemsFromAllDrives", "corpora", "driveId"]) {
    assert.match(listHelper, new RegExp(option));
  }
  assert.match(fileHelper, /supportsAllDrives/);
  assert.doesNotMatch(fileHelper, /includeItemsFromAllDrives|corpora|driveId/);
  assert.match(drive, /getFolder[\s\S]*?addFileOptions/u);
  assert.match(drive, /childFolders[\s\S]*?addListOptions/u);
  assert.match(drive, /createFolder[\s\S]*?addFileOptions/u);
  assert.match(drive, /findManagedFile[\s\S]*?addListOptions/u);
});

test("keeps test-send internal while allowing a validated original reply sender", async () => {
  const [gmail, replyRoute, sendRoute] = await Promise.all([
    read("app/lib/google-gmail.ts"),
    read("app/api/v1/integrations/google/gmail/messages/[messageId]/reply-draft/route.ts"),
    read("app/api/v1/integrations/google/gmail/send-test/route.ts"),
  ]);

  assert.match(gmail, /export function validateReplyRecipient/);
  assert.match(gmail, /invalid_reply_recipient/);
  assert.match(replyRoute, /validateReplyRecipient\(reply\.recipient\)/);
  assert.doesNotMatch(replyRoute, /validateWorkspaceRecipient/);
  assert.match(sendRoute, /validateWorkspaceRecipient\(input\.to, config\)/);
});
