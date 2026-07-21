import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const chatWebhookUrl = /https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^\s"'<>?]+\/messages\?(?=[^\s"'<>]*\bkey=[^&\s"'<>]+)(?=[^\s"'<>]*\btoken=[^&\s"'<>]+)[^\s"'<>]+/iu;

test("recognizes a Chat webhook regardless of key/token query order", () => {
  const endpoint = ["https://chat.googleapis.com", "v1", "spaces", "FCI_TEST", "messages"].join("/");
  assert.match(`${endpoint}?key=FCI_TEST_KEY&token=FCI_TEST_TOKEN`, chatWebhookUrl);
  assert.match(`${endpoint}?token=FCI_TEST_TOKEN&key=FCI_TEST_KEY`, chatWebhookUrl);
});

test("keeps Google Chat webhook URLs out of every repository text file", async () => {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: new URL(".", root), encoding: "utf8" },
  ).split(/\r?\n/u).filter(Boolean);

  const violations = [];
  for (const path of files) {
    const contents = await readFile(new URL(path.replaceAll("\\", "/"), root));
    if (contents.includes(0)) continue;
    let source;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      continue;
    }
    if (chatWebhookUrl.test(source)) violations.push(path);
  }
  assert.deepEqual(violations, [], `Chat webhook URLs found in: ${violations.join(", ")}`);
});

test("documents only blank Google Chat webhook secret placeholders", async () => {
  const example = await readFile(new URL(".env.example", root), "utf8");
  for (const name of [
    "GOOGLE_CHAT_SALES_WEBHOOK_URL",
    "GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL",
    "GOOGLE_CHAT_FIELD_WEBHOOK_URL",
    "GOOGLE_CHAT_SERVICE_WEBHOOK_URL",
  ]) {
    assert.match(example, new RegExp(`^${name}=$`, "mu"));
  }
  assert.match(example, /^GOOGLE_CHAT_NOTIFICATIONS_ENABLED=false$/mu);
  assert.doesNotMatch(example, /^GOOGLE_CHAT_[A-Z_]+_WEBHOOK_URL=\S+/mu);
});
