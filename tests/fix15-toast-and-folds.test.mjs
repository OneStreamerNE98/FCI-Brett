import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appPath = new URL("../app/FloorOpsApp.tsx", import.meta.url);
const goldenPath = new URL("./e2e/page-layouts.spec.ts", import.meta.url);

async function source(path) {
  return readFile(path, "utf8");
}

function sliceBetween(value, start, end) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `expected source slice ${start} … ${end}`);
  return value.slice(startIndex, endIndex);
}

function assertOrdered(block, earlier, later, message) {
  const earlierIndex = block.indexOf(earlier);
  const laterIndex = block.indexOf(later);
  assert.ok(earlierIndex >= 0, `expected ${earlier}`);
  assert.ok(laterIndex >= 0, `expected ${later}`);
  assert.ok(earlierIndex < laterIndex, message);
}

test("FIX-15 keeps a fresh success toast ahead of immediate informational follow-ups", async () => {
  const app = await source(appPath);
  const notify = sliceBetween(app, "const notify = useCallback<Notify>", "useEffect(() => () => {");

  assert.match(app, /const SUCCESS_INFO_SUPPRESSION_MS = 2_000;/u);
  assert.match(app, /const activeToastRef = useRef<\{ kind: NotificationKind; shownAt: number \} \| null>\(null\);/u);
  assert.match(notify, /kind === "info"[\s\S]+activeToast\?\.kind === "success"[\s\S]+shownAt - activeToast\.shownAt < SUCCESS_INFO_SUPPRESSION_MS[\s\S]+return;/u);
  assert.ok(
    notify.indexOf('if (kind === "info"') < notify.indexOf("window.clearTimeout(toastTimerRef.current)"),
    "suppressed INFO notifications must not clear the success toast's intended timer",
  );
  assert.match(notify, /activeToastRef\.current = nextActiveToast;[\s\S]+setToast\(\{ message, kind, action \}\);/u);
  assert.match(notify, /if \(activeToastRef\.current !== nextActiveToast\) return;[\s\S]+activeToastRef\.current = null;[\s\S]+setToast\(null\);/u);
});

test("FIX-15 scopes success-window suppression to the two reload follow-up notices", async () => {
  const app = await source(appPath);
  const notify = sliceBetween(app, "const notify = useCallback<Notify>", "useEffect(() => () => {");

  // The allowlist exists and gates the suppression early return.
  assert.match(app, /const SUPPRESSIBLE_FOLLOW_UP_INFO: RegExp\[\] = \[/u);
  assertOrdered(
    notify,
    "shownAt - activeToast.shownAt < SUCCESS_INFO_SUPPRESSION_MS",
    "SUPPRESSIBLE_FOLLOW_UP_INFO.some((pattern) => pattern.test(message))",
    "the early return must also require the info message to match the follow-up allowlist",
  );
  assertOrdered(
    notify,
    "SUPPRESSIBLE_FOLLOW_UP_INFO.some((pattern) => pattern.test(message))",
    "return;",
    "the allowlist gate must sit inside the suppression early return",
  );

  // Behavioral pin: reconstruct the allowlist from source and confirm it swallows the two real
  // post-success reload notices but never an arbitrary info message.
  const allowlistBlock = sliceBetween(app, "const SUPPRESSIBLE_FOLLOW_UP_INFO: RegExp[] = [", "];");
  const patterns = [...allowlistBlock.matchAll(/\/(\^[\s\S]*?\$)\/([a-z]*)/gu)].map(
    ([, body, flags]) => new RegExp(body, flags),
  );
  assert.equal(patterns.length, 2, "expected exactly two follow-up reload patterns");

  const matchesAllowlist = (message) => patterns.some((pattern) => pattern.test(message));
  assert.ok(
    matchesAllowlist("Workspace readiness refreshed. Current status is shown above."),
    "the workspace-readiness refresh notice must stay suppressible",
  );
  assert.ok(
    matchesAllowlist("Loaded 1 message from Inbox."),
    "the singular inbox reload notice must stay suppressible",
  );
  assert.ok(
    matchesAllowlist("Loaded 12 messages from FCI/Needs Review."),
    "the plural inbox reload notice must stay suppressible",
  );
  assert.equal(
    matchesAllowlist("Steel City Flooring is already at the final pipeline stage"),
    false,
    "an arbitrary info message must never be swallowed by success-window suppression",
  );
});

test("N7-7 fences every directory refresh outcome without merging AI-04 dashboard arbitration", async () => {
  const app = await source(appPath);
  const refresh = sliceBetween(app, "const refreshDirectoryData = useCallback", "const refreshDashboardSnapshot = useCallback");
  const loading = sliceBetween(refresh, "// Requests start synchronously", "return directoryRequests.then");
  const core = sliceBetween(refresh, "return directoryRequests.then", "void optionalRequests.then");
  const optional = sliceBetween(refresh, "void optionalRequests.then", "}).catch((error) => {");
  const failure = sliceBetween(refresh, "}).catch((error) => {", "}, [userEmail, userName]);");
  const fence = "if (directoryLoadId !== directoryLoadIdRef.current) return;";

  assert.match(app, /const directoryLoadIdRef = useRef\(0\);/u);
  assert.match(refresh, /const directoryLoadId = \+\+directoryLoadIdRef\.current;/u);
  assert.equal(
    (refresh.match(/if \(directoryLoadId !== directoryLoadIdRef\.current\) return;/gu) ?? []).length,
    4,
    "loading, core success, optional success, and error paths must all carry the generation fence",
  );
  for (const setter of ['setLiveDataState("loading")', 'setLiveDataError("")']) {
    assertOrdered(loading, fence, setter, `loading fence must precede ${setter}`);
  }
  for (const setter of [
    "setLeads(",
    "setClients(",
    "setProjectItems(",
    "setDashboard(",
    'setLiveDataState("ready")',
  ]) {
    assertOrdered(core, fence, setter, `core fence must precede ${setter}`);
  }
  for (const setter of ["setFilingRules(", "setSheetMirror("]) {
    assertOrdered(optional, fence, setter, `optional fence must precede ${setter}`);
  }
  for (const setter of ['setLiveDataState("error")', "setLiveDataError("]) {
    assertOrdered(failure, fence, setter, `error fence must precede ${setter}`);
  }
  assert.match(refresh, /const dashboardLoadId = \+\+dashboardRefreshLoadIdRef\.current;/u);
  assert.match(refresh, /if \(dashboardLoadId > dashboardAppliedLoadIdRef\.current\)/u);
  assert.match(app, /const refreshDashboardSnapshot = useCallback[\s\S]+const loadId = \+\+dashboardRefreshLoadIdRef\.current;[\s\S]+if \(loadId > dashboardAppliedLoadIdRef\.current\)/u);
});

test("N7-8 inserts saved meetings using the server's meetingAt then createdAt descending order", async () => {
  const app = await source(appPath);
  const comparator = sliceBetween(app, "function compareProjectMeetingsDescending", "async function fetchProjectMeetings");
  const savedMeeting = sliceBetween(app, "function savedMeeting(meeting: ProjectMeeting)", "return <section className=\"project-meetings\">");

  assert.match(comparator, /Date\.parse\(left\.meetingAt\)/u);
  assert.match(comparator, /Date\.parse\(right\.meetingAt\)/u);
  assert.match(comparator, /return rightSortValue - leftSortValue;/u);
  assert.match(comparator, /return right\.createdAt - left\.createdAt;/u);
  assert.match(savedMeeting, /\.sort\(compareProjectMeetingsDescending\)/u);
  assert.match(savedMeeting, /onMeetingRecorded\(\);/u);
});

test("FIX-15 leaves both exhausted page-layout golden hashes byte-identical", async () => {
  const sourceText = await source(goldenPath);
  assert.match(sourceText, /const OVERVIEW_LEGACY_SECTIONS_SHA256 = "4b2d9803d4d5d6e7d8fc7544ab7f862d87a076f4bfa0412ba498c66e8a12dd12";/u);
  assert.match(sourceText, /const REPORTS_LEGACY_SECTIONS_SHA256 = "4ba01e91ed4a31e0b6da7a0a6ec2334894145cddaacf63bc99e24efd30b999b6";/u);
});
