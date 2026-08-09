import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appPath = new URL("../app/FloorOpsApp.tsx", import.meta.url);
const directoryControllerPath = new URL("../app/application/use-directory-data.ts", import.meta.url);
const projectMeetingsPath = new URL("../app/projects/components/ProjectMeetings.tsx", import.meta.url);
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

test("DES-17 preserves FIX-15 follow-up feedback in a bounded notification queue", async () => {
  const app = await source(appPath);
  const notifications = await source(new URL("../app/components/AppNotifications.tsx", import.meta.url));

  assert.doesNotMatch(app, /SUCCESS_INFO_SUPPRESSION_MS|SUPPRESSIBLE_FOLLOW_UP_INFO|activeToastRef/u);
  assert.match(app, /const \{ notifications, notify, dismissNotification \} = useNotificationQueue\(\);/u);
  assert.match(app, /<AppNotifications notifications=\{notifications\} onDismiss=\{dismissNotification\} \/>/u);
  assert.match(notifications, /const MAX_NOTIFICATION_QUEUE = 4;/u);
  assert.match(notifications, /if \(next\.length > MAX_NOTIFICATION_QUEUE\)/u);
  assert.match(notifications, /oldestOrdinaryIndex < 0 && notification\.kind !== "error"/u);
  assert.match(notifications, /kind !== "error" && notificationQueueRef\.current\.some/u);
  assert.doesNotMatch(notifications, /setNotificationQueue\(\(current\)/u);
  assert.match(notifications, /notifications\.map\(\(notification\) => <div/u);
});

test("DES-17 keeps independent lifetimes for rapid success and info notifications", async () => {
  const notifications = await source(new URL("../app/components/AppNotifications.tsx", import.meta.url));
  assert.match(notifications, /if \(notification\.kind === "warning"\) return 8_000;/u);
  assert.match(notifications, /if \(notification\.kind === "info"\) return 5_000;/u);
  assert.match(notifications, /return 3_200;/u);
  assert.match(notifications, /new Map<number, number>\(\)/u);
  assert.match(notifications, /window\.setTimeout\(\(\) => dismissNotification\(notification\.id\), duration\)/u);
  assert.doesNotMatch(notifications, /Workspace readiness refreshed|Loaded \\d\+ messages/u);
});

test("N7-7 fences every directory refresh outcome without merging AI-04 dashboard arbitration", async () => {
  const directoryController = await source(directoryControllerPath);
  const refresh = sliceBetween(directoryController, "const refreshDirectoryData = useCallback", "const refreshDashboardSnapshot = useCallback");
  const loading = sliceBetween(refresh, "// Requests start synchronously", "return directoryRequests.then");
  const core = sliceBetween(refresh, "return directoryRequests.then", "void optionalRequests.then");
  const optional = sliceBetween(refresh, "void optionalRequests.then", "}).catch((error) => {");
  const failure = sliceBetween(refresh, "}).catch((error) => {", "}, [onTerminalFailure, userEmail, userName]);");
  const fence = "if (directoryLoadId !== directoryLoadIdRef.current) return;";

  assert.match(directoryController, /const directoryLoadIdRef = useRef\(0\);/u);
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
  assert.match(directoryController, /const refreshDashboardSnapshot = useCallback[\s\S]+const loadId = \+\+dashboardRefreshLoadIdRef\.current;[\s\S]+if \(loadId > dashboardAppliedLoadIdRef\.current\)/u);
});

test("N7-8 inserts saved meetings using the server's meetingAt then createdAt descending order", async () => {
  const app = await source(projectMeetingsPath);
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
