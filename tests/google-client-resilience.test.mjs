import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-google-client-resilience", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24772 } },
});
const [
  { GoogleDriveClient },
  { GoogleSheetsClient },
  { GoogleGmailClient },
  { GoogleCalendarClient },
  { exchangeGoogleAuthorizationCode },
] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-drive.ts"),
  vite.ssrLoadModule("/app/lib/google-sheets.ts"),
  vite.ssrLoadModule("/app/lib/google-gmail.ts"),
  vite.ssrLoadModule("/app/lib/google-calendar-client.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth.ts"),
]);

after(async () => {
  await vite.close();
});

const driveConfig = {
  drive: { mode: "shared-drive", rootFolderId: "shared-drive-root" },
};
const calendarConfig = {
  enabledServices: ["calendar"],
  clientAppointmentsCalendarId: "appointments@group.calendar.google.com",
  oauthReady: true,
};

test("Google data clients and OAuth do not bypass the shared bounded fetcher", async () => {
  const sourceFiles = [
    "google-drive.ts",
    "google-sheets.ts",
    "google-gmail.ts",
    "google-calendar-client.ts",
    "google-oauth.ts",
  ];
  for (const fileName of sourceFiles) {
    const source = await readFile(new URL(`../app/lib/${fileName}`, import.meta.url), "utf8");
    assert.match(source, /fetchGoogleProvider/u, `${fileName} must use the shared bounded fetcher`);
    assert.doesNotMatch(
      source,
      /await\s+(?:this\.(?:fetcher|dependencies\.fetch)|dependencies\.fetch|fetcher)\s*\(/u,
      `${fileName} must not issue an unbounded Google fetch`,
    );
  }
});

function fastTimeoutResilience(timeoutRequests) {
  return {
    timeoutSignal(milliseconds) {
      timeoutRequests.push(milliseconds);
      return AbortSignal.timeout(5);
    },
  };
}

function hungFetch(calls) {
  return async (_input, init = {}) => {
    calls.push(init);
    assert.ok(init.signal, "every Google provider fetch must carry an AbortSignal");
    return new Promise((_resolve, reject) => {
      const rejectForAbort = () => reject(init.signal.reason ?? new Error("aborted"));
      if (init.signal.aborted) rejectForAbort();
      else init.signal.addEventListener("abort", rejectForAbort, { once: true });
    });
  };
}

async function assertBoundedGoogleFailure({
  expectedCode,
  operation,
}) {
  const calls = [];
  const timeoutRequests = [];
  const fetcher = hungFetch(calls);
  const resilience = fastTimeoutResilience(timeoutRequests);
  await assert.rejects(
    operation(fetcher, resilience),
    (error) => error?.code === expectedCode,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(timeoutRequests, [20_000]);
}

test("Drive, Sheets, Gmail, Calendar, and OAuth token calls all fail within the shared provider timeout", async () => {
  await assertBoundedGoogleFailure({
    expectedCode: "drive_unavailable",
    operation: (fetcher, resilience) =>
      new GoogleDriveClient("test-token", driveConfig, fetcher, resilience)
        .getSharedDrive("shared-drive-root"),
  });
  await assertBoundedGoogleFailure({
    expectedCode: "sheets_unavailable",
    operation: (fetcher, resilience) =>
      new GoogleSheetsClient("test-token", "sheet-id", fetcher, resilience)
        .metadata(),
  });
  await assertBoundedGoogleFailure({
    expectedCode: "gmail_unavailable",
    operation: (fetcher, resilience) =>
      new GoogleGmailClient("test-token", fetcher, resilience)
        .listLabels(),
  });
  await assertBoundedGoogleFailure({
    expectedCode: "calendar_unavailable",
    operation: (fetcher, resilience) =>
      new GoogleCalendarClient("test-token", calendarConfig, {
        fetch: fetcher,
        now: () => new Date("2026-07-24T12:00:00.000Z"),
        resilience,
      }).listUpcomingEvents(),
  });
  await assertBoundedGoogleFailure({
    expectedCode: "token_service_unavailable",
    operation: (fetcher, resilience) =>
      exchangeGoogleAuthorizationCode({
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://app.example.test/oauth/callback",
      }, "authorization-code", "pkce-verifier", fetcher, resilience),
  });
});

test("an opted-in idempotent Sheets read gets exactly one bounded jittered retry", async () => {
  const timeoutRequests = [];
  const sleeps = [];
  let calls = 0;
  const fetcher = async (_input, init = {}) => {
    calls += 1;
    assert.ok(init.signal);
    if (calls === 1) return Response.json({ error: "busy" }, { status: 503 });
    return Response.json({ sheets: [] });
  };
  const client = new GoogleSheetsClient("test-token", "sheet-id", fetcher, {
    timeoutSignal(milliseconds) {
      timeoutRequests.push(milliseconds);
      return new AbortController().signal;
    },
    random: () => 0.5,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });

  assert.deepEqual(await client.metadata(), { sheets: [] });
  assert.equal(calls, 2);
  assert.deepEqual(timeoutRequests, [20_000]);
  assert.deepEqual(sleeps, [187]);
});

test("a successful idempotent Google read stays single-attempt with no backoff", async () => {
  const sleeps = [];
  let calls = 0;
  const client = new GoogleSheetsClient(
    "test-token",
    "sheet-id",
    async () => {
      calls += 1;
      return Response.json({ sheets: [] });
    },
    {
      timeoutSignal: () => new AbortController().signal,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  );

  assert.deepEqual(await client.metadata(), { sheets: [] });
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("Sheets grid reads reject effective cell errors instead of coercing them into identity text", async () => {
  const client = new GoogleSheetsClient(
    "test-token",
    "sheet-id",
    async () => Response.json({
      sheets: [{
        data: [{
          startRow: 1,
          rowData: [{
            values: [{
              formattedValue: "#REF!",
              effectiveValue: { errorValue: { type: "REF" } },
            }],
          }],
        }],
      }],
    }),
    { timeoutSignal: () => new AbortController().signal },
  );

  await assert.rejects(
    client.gridValues("A2:F2"),
    (error) => error?.code === "sheets_response_invalid" && error?.status === 503,
  );
});

test("Sheets grid reads reject array-shaped row data instead of inventing blank submissions", async () => {
  const client = new GoogleSheetsClient(
    "test-token",
    "sheet-id",
    async () => Response.json({
      sheets: [{ data: [{ startRow: 1, rowData: [[]] }] }],
    }),
    { timeoutSignal: () => new AbortController().signal },
  );

  await assert.rejects(
    client.gridValues("A2:F2"),
    (error) => error?.code === "sheets_response_invalid" && error?.status === 503,
  );
});

test("Sheets grid reads reject visible cell text without an effective identity value", async () => {
  const client = new GoogleSheetsClient(
    "test-token",
    "sheet-id",
    async () => Response.json({
      sheets: [{
        data: [{
          startRow: 1,
          rowData: [{ values: [{ formattedValue: "Alice" }] }],
        }],
      }],
    }),
    { timeoutSignal: () => new AbortController().signal },
  );

  await assert.rejects(
    client.gridValues("A2:F2"),
    (error) => error?.code === "sheets_response_invalid" && error?.status === 503,
  );
});

test("non-idempotent Sheets append is never retried after an ambiguous 503", async () => {
  const sleeps = [];
  let calls = 0;
  const client = new GoogleSheetsClient(
    "test-token",
    "sheet-id",
    async () => {
      calls += 1;
      return Response.json({ error: "ambiguous provider failure" }, { status: 503 });
    },
    {
      timeoutSignal: () => new AbortController().signal,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  );

  await assert.rejects(
    client.append("'Client Directory'!A:K", [["client-1"]]),
    (error) => error?.code === "sheets_request_failed",
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("non-idempotent Gmail draft creation is never retried after an ambiguous 503", async () => {
  const sleeps = [];
  let calls = 0;
  const client = new GoogleGmailClient(
    "test-token",
    async () => {
      calls += 1;
      return Response.json({ error: "ambiguous provider failure" }, { status: 503 });
    },
    {
      timeoutSignal: () => new AbortController().signal,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  );

  await assert.rejects(
    client.createReplyDraft({
      messageId: "gmail-message-1",
      threadId: "gmail-thread-1",
      recipient: "client@example.test",
      subject: "Re: Project",
      inReplyTo: null,
      references: null,
      body: "Draft body",
    }),
    (error) => error?.code === "gmail_request_failed",
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("Calendar preserves a 429 after the one idempotent retry", async () => {
  const sleeps = [];
  let calls = 0;
  const client = new GoogleCalendarClient("test-token", calendarConfig, {
    fetch: async () => {
      calls += 1;
      return Response.json({ error: "rate limited" }, { status: 429 });
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    resilience: {
      timeoutSignal: () => new AbortController().signal,
      random: () => 0,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  });

  await assert.rejects(
    client.listUpcomingEvents(),
    (error) => error?.code === "calendar_rate_limited" && error?.status === 429,
  );
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [125]);
});
