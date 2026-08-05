import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const OFFICE_EMAIL = "ai04-office@example.test";
const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-ai04-today", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("fixtures/cloudflare-workers.mjs", import.meta.url),
      ),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24754 } },
});
const {
  assembleToday,
  TODAY_SECTION_LIMIT,
  TODAY_TOOL_EVIDENCE_LIMIT,
  todayEvidence,
} = await vite.ssrLoadModule("/app/application/assistant/today.ts");
const {
  calendarDateRange,
  localDayRolloverDelay,
} = await vite.ssrLoadModule("/app/application/today-project-meetings.ts");

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.database.first(this.sql, this.values);
  }

  async all() {
    return { results: this.database.all(this.sql, this.values) };
  }

  async run() {
    throw new Error("AI-04 reads are not allowed to mutate records.");
  }
}

class TodayDatabase {
  constructor() {
    this.queries = [];
    this.preferenceTimeZone = "America/New_York";
    this.tasks = [];
    this.meetings = [];
    this.leads = [];
    this.projects = [];
  }

  prepare(sql) {
    this.queries.push(sql);
    return new Statement(this, sql);
  }

  batch() {
    throw new Error("AI-04 reads are not allowed to batch mutations.");
  }

  first(sql, values) {
    if (sql.startsWith("SELECT user_email, display_timezone")) {
      return {
        user_email: values[0],
        display_timezone: this.preferenceTimeZone,
        reply_signature: "",
        notification_preferences_json: "{}",
        page_layouts_json: "{}",
        updated_at: 1,
      };
    }
    return null;
  }

  all(sql, values) {
    if (sql.includes("FROM tasks")) {
      const [day, limit] = values;
      const comparison = sql.includes("due_date < ?") ? "<" : "=";
      const rows = this.tasks
        .filter((task) => task.status === "open")
        .filter((task) => comparison === "<" ? task.due_date < day : task.due_date === day)
        .sort((left, right) => (
          left.due_date.localeCompare(right.due_date)
          || right.updated_at - left.updated_at
          || left.id.localeCompare(right.id)
        ));
      return rows.slice(0, limit).map((row) => ({ ...row, total: rows.length }));
    }
    if (sql.includes("FROM project_meetings m")) {
      const [start, end, limit] = values;
      const rows = this.meetings
        .filter((meeting) => meeting.meeting_at >= start && meeting.meeting_at < end)
        .sort((left, right) => (
          left.meeting_at - right.meeting_at
          || left.created_at - right.created_at
          || left.id.localeCompare(right.id)
        ));
      return rows.slice(0, limit).map((row) => ({ ...row, total: rows.length }));
    }
    if (sql.includes("FROM leads")) {
      const [now, limit] = values;
      const rows = this.leads
        .filter((lead) => lead.status.toLowerCase() === "active")
        .filter((lead) => lead.next_action_at !== null && lead.next_action_at < now)
        .sort((left, right) => (
          left.next_action_at - right.next_action_at
          || left.updated_at - right.updated_at
          || left.id.localeCompare(right.id)
        ));
      return rows.slice(0, limit).map((row) => ({ ...row, total: rows.length }));
    }
    if (sql.includes("FROM projects p")) {
      const [now, limit] = values;
      const rows = this.projects
        .filter((project) => project.status.toLowerCase() === "closeout")
        .filter((project) => project.installation_completed_at !== null)
        .filter((project) => project.installation_completed_at <= now)
        .filter((project) => !project.followUpRecorded)
        .sort((left, right) => (
          left.installation_completed_at - right.installation_completed_at
          || left.updated_at - right.updated_at
          || left.id.localeCompare(right.id)
        ));
      return rows.slice(0, limit).map((row) => ({ ...row, total: rows.length }));
    }
    return [];
  }
}

function task(id, dueDate, updatedAt = 1) {
  return {
    id,
    title: `Task ${id}`,
    due_date: dueDate,
    project_id: "project-1",
    lead_id: null,
    assignee_email: OFFICE_EMAIL,
    updated_at: updatedAt,
    status: "open",
  };
}

function fixtureDatabase() {
  const database = new TodayDatabase();
  database.tasks = [
    task("due-july-24", "2026-07-24", 2),
    task("due-july-25", "2026-07-25", 3),
  ];
  database.meetings = [{
    id: "meeting-before-midnight",
    project_id: "project-1",
    title: "Late site review",
    meeting_at: Date.UTC(2026, 6, 25, 3, 50),
    created_at: 1,
    project_number: "P-1",
    project_name: "Lobby",
  }, {
    id: "meeting-after-midnight",
    project_id: "project-2",
    title: "Early handoff",
    meeting_at: Date.UTC(2026, 6, 25, 4, 10),
    created_at: 2,
    project_number: "P-2",
    project_name: "Office",
  }];
  database.leads = [{
    id: "lead-1",
    lead_number: "L-1",
    company: "FCI TEST — DO NOT USE",
    next_action: "Call the estimator",
    next_action_at: 1,
    updated_at: 1,
    status: "active",
  }];
  database.projects = [{
    id: "closeout-unrecorded",
    project_number: "P-3",
    name: "Unrecorded follow-up",
    status: "closeout",
    installation_completed_at: 2,
    updated_at: 2,
    followUpRecorded: false,
  }, {
    id: "closeout-explicit-no",
    project_number: "P-4",
    name: "Explicit no callback",
    status: "closeout",
    installation_completed_at: 1,
    updated_at: 1,
    followUpRecorded: true,
  }];
  return database;
}

test("AI-04 changes Today membership across New York 11:59 pm and 12:01 am", async () => {
  const database = fixtureDatabase();
  const beforeMidnight = await assembleToday(database, {
    now: Date.UTC(2026, 6, 25, 3, 59),
    timeZone: "America/New_York",
  });
  assert.equal(beforeMidnight.day, "2026-07-24");
  assert.deepEqual(beforeMidnight.dueTodayTasks.items.map((item) => item.id), ["due-july-24"]);
  assert.deepEqual(beforeMidnight.overdueTasks.items.map((item) => item.id), []);
  assert.deepEqual(beforeMidnight.meetings.items.map((item) => item.id), ["meeting-before-midnight"]);

  const afterMidnight = await assembleToday(database, {
    now: Date.UTC(2026, 6, 25, 4, 1),
    timeZone: "America/New_York",
  });
  assert.equal(afterMidnight.day, "2026-07-25");
  assert.deepEqual(afterMidnight.dueTodayTasks.items.map((item) => item.id), ["due-july-25"]);
  assert.deepEqual(afterMidnight.overdueTasks.items.map((item) => item.id), ["due-july-24"]);
  assert.deepEqual(afterMidnight.meetings.items.map((item) => item.id), ["meeting-after-midnight"]);
  assert.deepEqual(afterMidnight.closeoutFollowUps.items.map((item) => item.id), ["closeout-unrecorded"]);
  assert.deepEqual(afterMidnight.inbox, {
    label: "Needs review",
    detail: "Open the inbox review queue",
    href: "/inbox?bucket=needs-review",
  });
  assert.equal(Object.hasOwn(afterMidnight.inbox, "count"), false);
});

test("AI-04 reads every category with deterministic bounds and uses activity as the closeout discriminator", async () => {
  const database = fixtureDatabase();
  database.tasks = [
    ...Array.from({ length: 15 }, (_, index) => task(
      `overdue-${String(index).padStart(2, "0")}`,
      "2026-07-20",
      index,
    )),
    ...Array.from({ length: 15 }, (_, index) => task(
      `due-${String(index).padStart(2, "0")}`,
      "2026-07-25",
      index,
    )),
  ];
  const today = await assembleToday(database, {
    now: Date.UTC(2026, 6, 25, 12),
    timeZone: "America/New_York",
  });
  assert.equal(TODAY_SECTION_LIMIT, 12);
  assert.equal(today.overdueTasks.items.length, 12);
  assert.equal(today.overdueTasks.total, 15);
  assert.equal(today.overdueTasks.items[0].id, "overdue-14");
  const taskQueries = database.queries.filter((sql) => sql.includes("FROM tasks"));
  assert.equal(taskQueries.length, 2);
  for (const sql of taskQueries) {
    assert.match(sql, /ORDER BY due_date ASC, updated_at DESC, id ASC\s+LIMIT \?/u);
    assert.match(sql, /COUNT\(\*\) OVER\(\) AS total/u);
  }
  const closeoutQuery = database.queries.find((sql) => sql.includes("FROM projects p"));
  assert.match(closeoutQuery, /NOT EXISTS[\s\S]*e\.action = 'Follow-up result recorded'/u);
  assert.doesNotMatch(closeoutQuery, /p\.had_callback|p\.callback_note/u);
  assert.equal(todayEvidence(today).length, TODAY_TOOL_EVIDENCE_LIMIT);
  assert.equal(TODAY_TOOL_EVIDENCE_LIMIT, 25);
});

test("AI-04 local-midnight refresh delay is DST-safe", () => {
  const springForward = Date.UTC(2026, 2, 8, 5);
  const fallBack = Date.UTC(2026, 10, 1, 4);
  assert.equal(calendarDateRange(springForward, "America/New_York").end - springForward, 23 * 60 * 60 * 1_000);
  assert.equal(localDayRolloverDelay(springForward, "America/New_York"), 23 * 60 * 60 * 1_000 + 250);
  assert.equal(calendarDateRange(fallBack, "America/New_York").end - fallBack, 25 * 60 * 60 * 1_000);
  assert.equal(localDayRolloverDelay(fallBack, "America/New_York"), 25 * 60 * 60 * 1_000 + 250);
});

test("AI-04 excludes future-dated closeout completions until the clock passes them", async () => {
  // The installation-dates validator accepts future timestamps, so a saved
  // closeout project can hold a completion that has not happened yet. Today's
  // follow-up queue must only surface installations completed at or before the
  // assembly's now, and must admit one the moment now advances past it.
  const database = new TodayDatabase();
  database.projects = [{
    id: "past-completion",
    project_number: "P-PAST",
    name: "Completed yesterday",
    status: "closeout",
    installation_completed_at: Date.UTC(2026, 6, 24, 12),
    updated_at: 1,
    followUpRecorded: false,
  }, {
    id: "future-completion",
    project_number: "P-FUTURE",
    name: "Completion is still scheduled",
    status: "closeout",
    installation_completed_at: Date.UTC(2026, 6, 26, 12),
    updated_at: 2,
    followUpRecorded: false,
  }];

  const beforeFutureCompletion = await assembleToday(database, {
    now: Date.UTC(2026, 6, 25, 12),
    timeZone: "America/New_York",
  });
  assert.deepEqual(
    beforeFutureCompletion.closeoutFollowUps.items.map((item) => item.id),
    ["past-completion"],
  );
  assert.equal(beforeFutureCompletion.closeoutFollowUps.total, 1);

  const afterFutureCompletion = await assembleToday(database, {
    now: Date.UTC(2026, 6, 27, 12),
    timeZone: "America/New_York",
  });
  assert.deepEqual(
    afterFutureCompletion.closeoutFollowUps.items.map((item) => item.id),
    ["past-completion", "future-completion"],
  );
  assert.equal(afterFutureCompletion.closeoutFollowUps.total, 2);

  const closeoutQuery = database.queries.find((sql) => sql.includes("FROM projects p"));
  assert.match(closeoutQuery, /AND p\.installation_completed_at <= \?/u);
});

test("AI-04 rows deep-link to the supported destinations for each row type", async () => {
  // Verified with the bot P2 on today.ts: the app exposes no record-id search
  // state or dynamic record route, and canonicalOperationsSearch strips any
  // param outside each view's bounded allowlist, so a bare href cannot target an
  // exact project or lead. Exact-record activation lives only in-component
  // (FloorOpsApp openProject/openLead), which the propless URL-driven TodayPanel
  // cannot reach without inventing route state. These pins lock every row to its
  // best supported destination: closeout uses the lifecycle filter; the rest
  // land on the correct filtered list view.
  const database = new TodayDatabase();
  database.tasks = [{
    id: "task-project",
    title: "Task project",
    due_date: "2026-07-20",
    project_id: "project-1",
    lead_id: null,
    assignee_email: OFFICE_EMAIL,
    updated_at: 3,
    status: "open",
  }, {
    id: "task-lead",
    title: "Task lead",
    due_date: "2026-07-25",
    project_id: null,
    lead_id: "lead-9",
    assignee_email: OFFICE_EMAIL,
    updated_at: 2,
    status: "open",
  }, {
    id: "task-unlinked",
    title: "Task unlinked",
    due_date: "2026-07-25",
    project_id: null,
    lead_id: null,
    assignee_email: OFFICE_EMAIL,
    updated_at: 1,
    status: "open",
  }];
  database.meetings = [{
    id: "meeting-1",
    project_id: "project-1",
    title: "Site review",
    meeting_at: Date.UTC(2026, 6, 25, 15),
    created_at: 1,
    project_number: "P-1",
    project_name: "Lobby",
  }];
  database.leads = [{
    id: "lead-1",
    lead_number: "L-1",
    company: "FCI TEST — DO NOT USE",
    next_action: "Call the estimator",
    next_action_at: 1,
    updated_at: 1,
    status: "active",
  }];
  database.projects = [{
    id: "closeout-1",
    project_number: "P-3",
    name: "Awaiting follow-up",
    status: "closeout",
    installation_completed_at: 2,
    updated_at: 2,
    followUpRecorded: false,
  }];

  const today = await assembleToday(database, {
    now: Date.UTC(2026, 6, 25, 12),
    timeZone: "America/New_York",
  });
  const taskHrefById = new Map(
    [...today.overdueTasks.items, ...today.dueTodayTasks.items].map((task) => [task.id, task.href]),
  );
  assert.equal(taskHrefById.get("task-project"), "/projects");
  assert.equal(taskHrefById.get("task-lead"), "/leads");
  assert.equal(taskHrefById.get("task-unlinked"), "/assistant");
  assert.equal(today.meetings.items[0].href, "/projects");
  assert.equal(today.leadFollowUps.items[0].href, "/leads");
  assert.equal(today.closeoutFollowUps.items[0].href, "/projects?status=closeout");
});

const routeDatabase = fixtureDatabase();
const cloudflareEnvironment = {
  FCI_OFFICE_EMAILS: OFFICE_EMAIL,
  DB: routeDatabase,
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = cloudflareEnvironment;

const route = await vite.ssrLoadModule("/app/api/v1/assistant/today/route.ts");

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function todayRequest(email = OFFICE_EMAIL) {
  const url = new URL("https://fci.example.test/api/v1/assistant/today");
  const request = new Request(url, {
    headers: email ? { "oai-authenticated-user-email": email } : {},
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("AI-04 route is office-gated, no-store, timezone-aware, and makes no provider call", async () => {
  routeDatabase.preferenceTimeZone = "Not/A-Timezone";
  routeDatabase.queries = [];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The deterministic Today route must not contact Gmail or another provider.");
  };
  try {
    const response = await route.GET(todayRequest());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.equal(body.displayTimezone, "America/New_York");
    assert.equal(body.inbox.href, "/inbox?bucket=needs-review");
    assert.equal(Object.hasOwn(body.inbox, "count"), false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  routeDatabase.queries = [];
  const denied = await route.GET(todayRequest("outside@example.test"));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Cache-Control"), "no-store");
  assert.equal(routeDatabase.queries.length, 0);
});

test("AI-04 source keeps one shared read, exact UI contracts, and one dashboard refresh model", async () => {
  const [routeSource, assembly, tools, assistantRoute, app, assistant, panel, panelStyles, goldens] = await Promise.all([
    read("app/api/v1/assistant/today/route.ts"),
    read("app/application/assistant/today.ts"),
    read("app/application/assistant/tools.ts"),
    read("app/api/v1/assistant/route.ts"),
    read("app/FloorOpsApp.tsx"),
    read("app/assistant/components/AssistantView.tsx"),
    read("app/assistant/components/TodayPanel.tsx"),
    read("app/assistant/components/TodayPanel.module.css"),
    read("tests/e2e/page-layouts.spec.ts"),
  ]);
  const loadState = await read("app/lib/client-get-hooks.ts");
  assert.match(routeSource, /requireOfficeUser\(request\)/u);
  assert.match(routeSource, /noStoreJson\(today\)/u);
  assert.doesNotMatch(routeSource, /gmail|fetch\(/iu);
  assert.doesNotMatch(assembly, /gmail|fetch\(/iu);
  assert.match(assembly, /href: "\/inbox\?bucket=needs-review"/u);
  assert.match(tools, /todayEvidence\(await assembleToday\(database/u);
  assert.doesNotMatch(tools, /current UTC date|timeZone: "UTC"/u);
  assert.match(assistantRoute, /findByEmail\(auth\.user\.email\)[\s\S]*timeZone,/u);
  assert.match(assistant, /useState<AssistantTab>\("today"\)/u);
  assert.match(assistant, /const tabs: AssistantTab\[\] = \["today", "ask", "tasks"\]/u);
  assert.match(assistant, /<section role="tabpanel" id="assistant-today-panel" aria-labelledby="assistant-today-tab" hidden=\{tab !== "today"\}>\{tab === "today" && <TodayPanel \/>\}<\/section>/u);
  assert.match(assistant, /<section role="tabpanel" id="assistant-ask-panel" aria-labelledby="assistant-ask-tab" hidden=\{tab !== "ask"\}>\{tab === "ask" && <>/u);
  assert.match(assistant, /<section role="tabpanel" id="assistant-tasks-panel" aria-labelledby="assistant-tasks-tab" hidden=\{tab !== "tasks"\}>\{tab === "tasks" && <TaskManagementPanel projects=\{projects\} \/>\}<\/section>/u);
  // SET-42 moves the read and latest-request guard into shared SWR/load-state
  // primitives. Pin the public Today behavior instead of the retired local counter.
  assert.match(panel, /cachedGetJson<TodayAssembly[\s\S]*>\(TODAY_URL,/u);
  assert.match(panel, /useClientLoadState\("Today could not be loaded\."\)/u);
  assert.match(panel, /onSuccess: setToday,\s*onFailure: \(\) => setToday\(null\)/u);
  assert.match(panel, /useCachedGetSubscription\(\[TODAY_URL\], \(\) => load\(\{ silent: true \}\)\)/u);
  assert.match(panel, /fetch\(`\/api\/v1\/tasks\/\$\{encodeURIComponent\(task\.id\)\}`[\s\S]*method: "PATCH"[\s\S]*body: JSON\.stringify\(\{ status: "done" \}\)/u);
  assert.match(panel, /if \(!response\.ok\) throw new Error\(data\.error \?\? "The task could not be completed\."\)/u);
  // Completion refreshes in place: a silent reload keeps the current list mounted
  // instead of swapping in the loading empty state. SET-42 moved that behavior
  // into useClientLoadState, so it is pinned where it now lives — forwarding the
  // flag is not the contract, suppressing the loading state is.
  assert.match(panel, /setAnnouncement\(`\$\{task\.title\} completed\.`\);\s+invalidateTaskReadCaches\(\{ notifyToday: false \}\);\s+const refreshed = await load\(\{ force: true, silent: true \}\);/u);
  assert.match(panel, /\{ silent: options\?\.silent \}/u);
  assert.match(
    loadState,
    /if \(!options\.silent\) \{\s*visibleRequestsInFlight\.current \+= 1;\s*setState\("loading"\);/u,
    "the shared loader may only enter the loading state when the read is not silent",
  );
  assert.equal(
    (loadState.match(/setState\("loading"\)/gu) ?? []).length,
    1,
    "no second code path may swap a mounted list for the loading state behind a silent reload",
  );
  // One live region stays mounted across every state (loading/error/ready), so
  // the announcement renders into an already-present region — it is the first
  // child of the always-rendered panel wrapper, before the state-dependent body.
  assert.match(panel, /return <div className=\{styles\.panel\}>\s*<p className=\{styles\.visuallyHidden\} role="status" aria-live="polite">\{announcement\}<\/p>[\s\S]*\{content\}/u);
  // The loading empty state is assigned to content, not returned early, so it can
  // only appear on the initial mount — never as a completion side effect.
  assert.match(panel, /content = <OperationsEmptyState variant="page"><RefreshCw/u);
  // Deterministic focus after a completed row drops out: next actionable row,
  // else previous, else the panel heading.
  assert.match(panel, /pendingFocusRef\.current = nextTaskFocus\(previousIds, completedIndex, remainingIds\);/u);
  assert.match(panel, /return \{ heading: true \};/u);
  assert.match(panel, /<h2 id="today-summary-title" ref=\{headingRef\} tabIndex=\{-1\}>/u);
  assert.match(panel, /Loading today&apos;s saved records…/u);
  assert.match(panel, /errorTitle="Today is unavailable"/u);
  assert.match(panel, /Nothing due in saved records/u);
  assert.match(panel, /href=\{today\.inbox\.href\}/u);
  assert.match(panel, /<label className=\{styles\.taskControl\}>[\s\S]*aria-label=\{`Complete task \$\{task\.title\}`\}/u);
  assert.match(panelStyles, /\.taskControl\s*\{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;[\s\S]*?\}/u);
  assert.match(app, /const dashboardLoadId = \+\+dashboardRefreshLoadIdRef\.current/u);
  assert.match(app, /const loadId = \+\+dashboardRefreshLoadIdRef\.current/u);
  assert.match(app, /const dashboardAppliedLoadIdRef = useRef\(0\);/u);
  assert.match(app, /if \(dashboardLoadId > dashboardAppliedLoadIdRef\.current\) \{\s*dashboardAppliedLoadIdRef\.current = dashboardLoadId;\s*setDashboard\(dashboardData as unknown as DashboardSummary\);\s*\}/u);
  assert.match(app, /if \(loadId > dashboardAppliedLoadIdRef\.current\) \{\s*dashboardAppliedLoadIdRef\.current = loadId;\s*setDashboard\(data as unknown as DashboardSummary\);\s*\}/u);
  assert.match(app, /localDayRolloverDelay\(Date\.now\(\), displayTimezone\)/u);
  assert.match(app, /window\.clearTimeout\(timeoutId\)/u);
  assert.match(app, /onMeetingRecorded=\{\(\) => void refreshDashboardSnapshot\(\)/u);
  assert.match(panel, /const currentTimestamp = Date\.now\(\);[\s\S]*calendarDateRange\(\s*currentTimestamp,\s*today\.displayTimezone,\s*\)\.day === today\.day;[\s\S]*responseIsCurrent\s*\? localDayRolloverDelay\(currentTimestamp, today\.displayTimezone\)\s*: 0;[\s\S]*window\.setTimeout\(\s*\(\) => void load\(\{ force: true \}\),\s*Math\.max\(1_000, rolloverDelay\),?\s*\)/u);
  assert.match(goldens, /const OVERVIEW_LEGACY_SECTIONS_SHA256 = "4b2d9803d4d5d6e7d8fc7544ab7f862d87a076f4bfa0412ba498c66e8a12dd12";/u);
  assert.match(goldens, /const REPORTS_LEGACY_SECTIONS_SHA256 = "4ba01e91ed4a31e0b6da7a0a6ec2334894145cddaacf63bc99e24efd30b999b6";/u);
});
