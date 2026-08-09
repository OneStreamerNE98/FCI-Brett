import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [inbox, settings, guide, workspaceRoute] = await Promise.all([
  readFile(new URL("../app/inbox/components/InboxView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/settings/components/GoogleWorkspacePanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../docs/guides/settings-guide.md", import.meta.url), "utf8"),
  readFile(new URL("../app/api/v1/google-workspace/route.ts", import.meta.url), "utf8"),
]);

test("WS-20 inbox selects human mailbox addresses and scopes every Gmail-derived action", () => {
  assert.match(
    inbox,
    /cachedGetJson<GmailMailboxConnectionsPayload>\(GOOGLE_CONNECTION_URL/u,
    "the admin mailbox list must use the shared cached GET transport",
  );
  assert.match(inbox, />\s*Connected mailbox\s*<select/u);
  assert.match(inbox, /mailboxConnections\.map\(\(mailbox\).*mailbox\.email/su);
  assert.doesNotMatch(inbox, /mailbox\.connectionKey|mailbox\.connection_key/u);

  for (const endpoint of [
    "/api/v1/inbox-analysis",
    "/api/v1/assistant/triage",
    "/api/v1/integrations/google/gmail/labels/prepare",
    "/api/v1/integrations/google/gmail/messages/",
  ]) {
    assert.match(
      inbox,
      new RegExp(`mailboxScopedUrl\\([^)]*${endpoint.replaceAll("/", "\\/")}`),
      `${endpoint} must carry the selected human mailbox address`,
    );
  }
  assert.match(inbox, /new URLSearchParams\(\{ label: bucket, mailbox \}\)/u);
  assert.match(
    inbox,
    /inboxReviewIntent:\s*proposal\.kind,\s*inboxReviewMailbox:\s*selectedMailboxEmail,/u,
    "typed schedule and warranty accepts must carry the selected human mailbox address",
  );
  assert.match(inbox, /mailboxGenerationRef\.current \+= 1/u);
  assert.match(inbox, /messageRequestIdRef\.current \+= 1/u);
  assert.match(inbox, /function runRetryForMailbox\(mailbox: string, action: \(\) => void\)/u);
  assert.match(inbox, /selectedMailboxEmailRef\.current !== mailbox/u);
  assert.doesNotMatch(inbox, /setInterval\s*\(|setTimeout\s*\(/u);
});

test("WS-20 Settings attaches globally and disconnects only the named mailbox", () => {
  assert.match(settings, /"Attach mailbox"/u);
  assert.match(settings, /aria-label=\{`Disconnect \$\{mailbox\.email\}`\}/u);
  assert.match(settings, /body: JSON\.stringify\(\{ mailbox \}\)/u);
  assert.match(settings, /Other attached mailboxes remain available/u);
  assert.match(settings, />\s*Mailbox for Gmail verification\s*<select/u);
  assert.match(settings, /mailbox\.services\[service\.key\] === true/u);
  assert.match(settings, /function runRetryForGmailMailbox\(mailbox: string, action: \(\) => void\)/u);
  assert.match(settings, /gmailVerificationGeneration === gmailMailboxGenerationRef\.current/u);
  assert.match(settings, /gmailVerificationMailbox === selectedGmailMailboxRef\.current/u);
  assert.match(settings, /setGmailWorking\(false\)/u);
  assert.doesNotMatch(settings, /mailbox\.connectionKey|mailbox\.connection_key/u);
  assert.doesNotMatch(settings, /setInterval\s*\(|setTimeout\s*\(/u);
  assert.doesNotMatch(
    workspaceRoute,
    /connectionKey:\s*google\.connectionKey/u,
    "the settings payload must not expose the stable persistence slug",
  );
});

test("WS-20 guide records separate consent and the full gmail.modify consequence", () => {
  assert.match(guide, /Every attachment is a separate ordinary Google OAuth consent/u);
  assert.match(guide, /`gmail\.modify`/u);
  assert.match(guide, /allows the app to read,\s*modify, send, and delete mail/u);
  assert.match(guide, /Other attached mailboxes stay connected/u);
  assert.match(guide, /Inbox picker remains Administrator-only/u);
});
