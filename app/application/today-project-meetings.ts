import type { D1Database } from "../adapters/d1/d1-database";

export const TODAY_PROJECT_MEETINGS_DISPLAY_LIMIT = 5;
export const TODAY_PROJECT_MEETINGS_TOOL_LIMIT = 12;

type TodayProjectMeetingDatabaseRow = {
  id: string;
  project_id: string;
  title: string;
  meeting_at: number;
  project_number: string;
  project_name: string;
  total: number | string | null;
};

export type TodayProjectMeeting = {
  id: string;
  projectId: string;
  title: string;
  meetingAt: number;
  projectNumber: string;
  projectName: string;
};

export type TodayProjectMeetingsRead = {
  items: TodayProjectMeeting[];
  total: number;
};

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

function validTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    throw new Error("Today's meeting read requires a valid IANA timezone.");
  }
}

function calendarDateParts(timestamp: number, timeZone: string): CalendarDateParts {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function timeZoneOffsetAt(timestamp: number, timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return representedAsUtc - Math.trunc(timestamp / 1000) * 1000;
}

function zonedMidnight(parts: CalendarDateParts, timeZone: string) {
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidate = localMidnightAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    candidate = localMidnightAsUtc - timeZoneOffsetAt(candidate, timeZone);
  }
  return candidate;
}

export function calendarDateRange(timestamp: number, requestedTimeZone: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) {
    throw new Error("Today's meeting read requires a valid timestamp.");
  }
  const timeZone = validTimeZone(requestedTimeZone);
  const today = calendarDateParts(timestamp, timeZone);
  const nextDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const tomorrow = {
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
  };
  const day = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  return {
    day,
    start: zonedMidnight(today, timeZone),
    end: zonedMidnight(tomorrow, timeZone),
    timeZone,
  };
}

function boundedLimit(value: number) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 25)
    : TODAY_PROJECT_MEETINGS_DISPLAY_LIMIT;
}

/**
 * One bounded, read-only project-meeting projection for the Overview and the
 * AI Today surface. The caller chooses whether "today" ends at midnight or
 * continues into the next-up queue; both consumers keep one SQL contract.
 */
export async function readTodayProjectMeetings(
  database: D1Database,
  options: {
    now: number;
    timeZone: string;
    includeUpcoming: boolean;
    limit: number;
  },
): Promise<TodayProjectMeetingsRead> {
  const range = calendarDateRange(options.now, options.timeZone);
  const beforeClause = options.includeUpcoming ? "" : " AND m.meeting_at < ?";
  const statement = database
    .prepare(`SELECT m.id, m.project_id, m.title, m.meeting_at, p.project_number, p.name AS project_name, COUNT(*) OVER() AS total
      FROM project_meetings m
      JOIN projects p ON p.id = m.project_id
      WHERE m.meeting_at >= ?${beforeClause}
      ORDER BY m.meeting_at ASC, m.created_at ASC, m.id ASC
      LIMIT ?`);
  const bound = options.includeUpcoming
    ? statement.bind(range.start, boundedLimit(options.limit))
    : statement.bind(range.start, range.end, boundedLimit(options.limit));
  const rows = await bound.all<TodayProjectMeetingDatabaseRow>();
  const items = rows.results.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    meetingAt: Number(row.meeting_at),
    projectNumber: row.project_number,
    projectName: row.project_name,
  }));
  const total = Number(rows.results[0]?.total ?? items.length);
  return {
    items,
    total: Number.isSafeInteger(total) && total >= items.length ? total : items.length,
  };
}
