import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calendarDateRange,
  readTodayProjectMeetings,
  TODAY_PROJECT_MEETINGS_DISPLAY_LIMIT,
  TODAY_PROJECT_MEETINGS_TOOL_LIMIT,
} from "../app/application/today-project-meetings.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

class MeetingDatabase {
  constructor(rows) {
    this.rows = rows;
    this.queries = [];
  }

  prepare(sql) {
    const query = { sql, values: [] };
    this.queries.push(query);
    const statement = {
      bind: (...values) => {
        query.values = values;
        return statement;
      },
      all: async () => ({ results: structuredClone(this.rows) }),
    };
    return statement;
  }
}

test("DES-08d derives New York local-day boundaries on both sides of midnight", () => {
  const beforeMidnight = calendarDateRange(Date.UTC(2026, 6, 24, 3, 59), "America/New_York");
  assert.deepEqual(beforeMidnight, {
    day: "2026-07-23",
    start: Date.UTC(2026, 6, 23, 4),
    end: Date.UTC(2026, 6, 24, 4),
    timeZone: "America/New_York",
  });

  const afterMidnight = calendarDateRange(Date.UTC(2026, 6, 24, 4, 1), "America/New_York");
  assert.deepEqual(afterMidnight, {
    day: "2026-07-24",
    start: Date.UTC(2026, 6, 24, 4),
    end: Date.UTC(2026, 6, 25, 4),
    timeZone: "America/New_York",
  });
  assert.throws(() => calendarDateRange(Date.now(), "Not/A-Timezone"), /valid IANA timezone/u);
});

test("DES-08d reads at most five local-today and next-up rows with an exact overflow total", async () => {
  const database = new MeetingDatabase([{
    id: "meeting-1",
    project_id: "project-1",
    title: "Morning check-in",
    meeting_at: Date.UTC(2026, 6, 24, 14),
    project_number: "CF-2026-0001",
    project_name: "Lobby flooring",
    total: "8",
  }]);
  const result = await readTodayProjectMeetings(database, {
    now: Date.UTC(2026, 6, 24, 12),
    timeZone: "America/New_York",
    includeUpcoming: true,
    limit: TODAY_PROJECT_MEETINGS_DISPLAY_LIMIT,
  });

  assert.deepEqual(database.queries[0].values, [Date.UTC(2026, 6, 24, 4), 5]);
  assert.doesNotMatch(database.queries[0].sql, /m\.meeting_at < \?/u);
  assert.match(database.queries[0].sql, /COUNT\(\*\) OVER\(\) AS total/u);
  assert.match(database.queries[0].sql, /ORDER BY m\.meeting_at ASC, m\.created_at ASC, m\.id ASC\s+LIMIT \?/u);
  assert.deepEqual(result, {
    items: [{
      id: "meeting-1",
      projectId: "project-1",
      title: "Morning check-in",
      meetingAt: Date.UTC(2026, 6, 24, 14),
      projectNumber: "CF-2026-0001",
      projectName: "Lobby flooring",
    }],
    total: 8,
  });
});

test("DES-08d and AI-04 route every Today consumer through the shared bounded read", async () => {
  const [tools, dashboard, dashboardRoute, assistantRoute, todayAssembly] = await Promise.all([
    read("app/application/assistant/tools.ts"),
    read("app/application/dashboard-data.ts"),
    read("app/api/v1/dashboard/route.ts"),
    read("app/api/v1/assistant/route.ts"),
    read("app/application/assistant/today.ts"),
  ]);
  assert.match(tools, /todayEvidence\(await assembleToday\(database, \{\s+now: now\(\),\s+timeZone:/u);
  assert.doesNotMatch(tools, /timeZone: "UTC"|current UTC date/u);
  assert.doesNotMatch(tools, /WHERE m\.meeting_at >= \? AND m\.meeting_at < \? ORDER BY m\.meeting_at ASC LIMIT 12/u);
  assert.match(todayAssembly, /readTodayProjectMeetings\(database, \{\s+now: options\.now,\s+timeZone: range\.timeZone,\s+includeUpcoming: false,\s+limit: TODAY_PROJECT_MEETINGS_TOOL_LIMIT/u);
  assert.equal(TODAY_PROJECT_MEETINGS_TOOL_LIMIT, 12);
  assert.match(dashboard, /includeUpcoming: true,\s+limit: TODAY_PROJECT_MEETINGS_DISPLAY_LIMIT/u);
  assert.equal(TODAY_PROJECT_MEETINGS_DISPLAY_LIMIT, 5);
  assert.match(dashboardRoute, /findByEmail\(auth\.user\.email\)/u);
  assert.match(dashboardRoute, /normalizeUserDisplayTimezone\(preferences\?\.displayTimezone\)/u);
  assert.match(dashboardRoute, /dashboardData\(env\.DB, \{ now: generatedAt, timeZone \}\)/u);
  assert.match(assistantRoute, /findByEmail\(auth\.user\.email\)[\s\S]*createAssistantToolRegistry\(\{[\s\S]*timeZone,/u);
});
