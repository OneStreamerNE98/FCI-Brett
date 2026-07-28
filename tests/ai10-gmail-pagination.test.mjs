import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-ai10-gmail-pagination", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24754 } },
});

const {
  GoogleGmailClient,
  normalizeGmailPageToken,
} = await vite.ssrLoadModule("/app/lib/google-gmail.ts");

after(async () => {
  await vite.close();
});

const resilience = {
  timeoutSignal() {
    return new AbortController().signal;
  },
};

function metadata(id) {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds: ["INBOX"],
    snippet: `Summary ${id}`,
    payload: {
      headers: [
        { name: "From", value: `${id}@example.test` },
        { name: "To", value: "office@example.test" },
        { name: "Subject", value: `Subject ${id}` },
        { name: "Date", value: "Tue, 28 Jul 2026 12:00:00 +0000" },
      ],
    },
  };
}

test("sweep pagination accounts for every Gmail reference while ordinary lists retain fail-together behavior", async () => {
  const calls = [];
  const fetcher = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/messages")) {
      return Response.json({
        messages: [
          { id: "message-one", threadId: "thread-one" },
          { id: "message-two", threadId: "thread-two" },
          { id: "message-three", threadId: "thread-three" },
        ],
        nextPageToken: "next-page-token",
      });
    }
    const messageId = url.pathname.split("/").at(-1);
    return Response.json(
      messageId === "message-two"
        ? metadata("unexpected-message")
        : metadata(messageId),
    );
  };

  const ordinary = new GoogleGmailClient("ordinary-token", fetcher, resilience);
  await assert.rejects(
    () => ordinary.listMessages({ labelId: "INBOX" }),
    /unexpected message summary/u,
  );

  const ordinarySuccess = new GoogleGmailClient(
    "ordinary-success-token",
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages")) {
        return Response.json({
          messages: [{ id: "message-one", threadId: "thread-one" }],
          nextPageToken: "not-exposed-to-ordinary-callers",
        });
      }
      return Response.json(metadata("message-one"));
    },
    resilience,
  );
  const ordinaryMessages = await ordinarySuccess.listMessages({
    labelId: "INBOX",
  });
  assert.ok(Array.isArray(ordinaryMessages));
  assert.deepEqual(
    ordinaryMessages.map((message) => message.id),
    ["message-one"],
  );
  assert.equal(Object.hasOwn(ordinaryMessages, "nextPageToken"), false);

  calls.length = 0;
  const sweep = new GoogleGmailClient("sweep-token", fetcher, resilience);
  const page = await sweep.listMessages({
    labelId: "INBOX",
    pageToken: "current-page-token",
    mode: "sweep",
  });

  assert.deepEqual(page.messageIds, [
    "message-one",
    "message-two",
    "message-three",
  ]);
  assert.deepEqual(page.failedMessageIds, ["message-two"]);
  assert.deepEqual(
    page.messages.map((message) => message.id),
    ["message-one", "message-three"],
  );
  assert.equal(page.nextPageToken, "next-page-token");
  assert.equal(calls[0].searchParams.get("pageToken"), "current-page-token");
  assert.equal(calls[0].searchParams.get("maxResults"), "20");
  assert.equal(calls[0].searchParams.get("labelIds"), "INBOX");
});

test("analysis input uses one full-format read for a bounded body and List-Unsubscribe", async () => {
  const calls = [];
  const body = "FCI TEST analysis body";
  const fetcher = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json({
      id: "analysis-message",
      threadId: "analysis-thread",
      labelIds: ["INBOX"],
      snippet: "Bounded fallback",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "sender@example.test" },
          { name: "Subject", value: "Analysis fixture" },
          { name: "Date", value: "Tue, 28 Jul 2026 12:00:00 +0000" },
          {
            name: "List-Unsubscribe",
            value: "<mailto:unsubscribe@example.test>\u0000",
          },
        ],
        body: { data: Buffer.from(body).toString("base64url") },
      },
    });
  };
  const client = new GoogleGmailClient("analysis-token", fetcher, resilience);
  const input = await client.getMessageAnalysisInput("analysis-message");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("format"), "full");
  assert.equal(input.summary.id, "analysis-message");
  assert.equal(input.bodyText, body);
  assert.equal(
    input.listUnsubscribe,
    "<mailto:unsubscribe@example.test>",
  );
});

test("Gmail page tokens are opaque but bounded and control-free", () => {
  assert.equal(normalizeGmailPageToken(" page/token+= "), "page/token+=");
  assert.throws(
    () => normalizeGmailPageToken("bad\u0000token"),
    (error) => error?.code === "invalid_gmail_page_token" && error?.status === 400,
  );
  assert.throws(
    () => normalizeGmailPageToken("x".repeat(2_049)),
    (error) => error?.code === "invalid_gmail_page_token" && error?.status === 400,
  );
});
