import type { D1Database } from "../../adapters/d1/d1-database";
import {
  calendarDateRange,
  readTodayProjectMeetings,
  TODAY_PROJECT_MEETINGS_TOOL_LIMIT,
  type TodayProjectMeeting,
} from "../today-project-meetings";
import { compact, type Evidence } from "./evidence";

export const TODAY_SECTION_LIMIT = 12;
export const TODAY_TOOL_EVIDENCE_LIMIT = 25;

type CountedRow = {
  total: number | string | null;
};

type TodayTaskRow = CountedRow & {
  id: string;
  title: string;
  due_date: string;
  project_id: string | null;
  lead_id: string | null;
  assignee_email: string | null;
  updated_at: number;
};

type TodayLeadRow = CountedRow & {
  id: string;
  lead_number: string;
  company: string;
  next_action: string;
  next_action_at: number;
};

type TodayCloseoutRow = CountedRow & {
  id: string;
  project_number: string;
  name: string;
  installation_completed_at: number;
};

export type TodayCollection<T> = {
  items: T[];
  total: number;
};

export type TodayTask = {
  id: string;
  title: string;
  dueDate: string;
  projectId: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
  updatedAt: number;
  href: string;
};

export type TodayMeeting = TodayProjectMeeting & {
  href: string;
};

export type TodayLeadFollowUp = {
  id: string;
  leadNumber: string;
  company: string;
  nextAction: string;
  nextActionAt: number;
  href: string;
};

export type TodayCloseoutFollowUp = {
  id: string;
  projectNumber: string;
  name: string;
  installationCompletedAt: number;
  href: string;
};

export type TodayAssembly = {
  generatedAt: number;
  day: string;
  displayTimezone: string;
  overdueTasks: TodayCollection<TodayTask>;
  dueTodayTasks: TodayCollection<TodayTask>;
  meetings: TodayCollection<TodayMeeting>;
  leadFollowUps: TodayCollection<TodayLeadFollowUp>;
  closeoutFollowUps: TodayCollection<TodayCloseoutFollowUp>;
  inbox: {
    label: "Needs review";
    detail: "Open the inbox review queue";
    href: "/inbox?bucket=needs-review";
  };
};

function safeTotal<T>(rows: Array<T & CountedRow>) {
  const total = Number(rows[0]?.total ?? rows.length);
  return Number.isSafeInteger(total) && total >= rows.length ? total : rows.length;
}

function taskHref(row: Pick<TodayTaskRow, "project_id" | "lead_id">) {
  if (row.project_id) return "/projects";
  if (row.lead_id) return "/leads";
  return "/assistant";
}

async function readTasks(
  database: D1Database,
  day: string,
  comparison: "<" | "=",
): Promise<TodayCollection<TodayTask>> {
  const rows = await database
    .prepare(`SELECT id, title, due_date, project_id, lead_id, assignee_email, updated_at, COUNT(*) OVER() AS total
      FROM tasks
      WHERE status = 'open' AND due_date IS NOT NULL AND due_date ${comparison} ?
      ORDER BY due_date ASC, updated_at DESC, id ASC
      LIMIT ?`)
    .bind(day, TODAY_SECTION_LIMIT)
    .all<TodayTaskRow>();
  return {
    items: rows.results.map((row) => ({
      id: row.id,
      title: row.title,
      dueDate: row.due_date,
      projectId: row.project_id,
      leadId: row.lead_id,
      assigneeEmail: row.assignee_email,
      updatedAt: Number(row.updated_at),
      href: taskHref(row),
    })),
    total: safeTotal(rows.results),
  };
}

async function readLeadFollowUps(
  database: D1Database,
  now: number,
): Promise<TodayCollection<TodayLeadFollowUp>> {
  const rows = await database
    .prepare(`SELECT id, lead_number, company, next_action, next_action_at, COUNT(*) OVER() AS total
      FROM leads
      WHERE LOWER(status) = 'active' AND next_action_at IS NOT NULL AND next_action_at < ?
      ORDER BY next_action_at ASC, updated_at ASC, id ASC
      LIMIT ?`)
    .bind(now, TODAY_SECTION_LIMIT)
    .all<TodayLeadRow>();
  return {
    items: rows.results.map((row) => ({
      id: row.id,
      leadNumber: row.lead_number,
      company: row.company,
      nextAction: row.next_action,
      nextActionAt: Number(row.next_action_at),
      href: "/leads",
    })),
    total: safeTotal(rows.results),
  };
}

async function readCloseoutFollowUps(
  database: D1Database,
): Promise<TodayCollection<TodayCloseoutFollowUp>> {
  const rows = await database
    .prepare(`SELECT p.id, p.project_number, p.name, p.installation_completed_at, COUNT(*) OVER() AS total
      FROM projects p
      WHERE LOWER(p.status) = 'closeout'
        AND p.installation_completed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM activity_events e
          WHERE e.record_id = p.id AND e.action = 'Follow-up result recorded'
        )
      ORDER BY p.installation_completed_at ASC, p.updated_at ASC, p.id ASC
      LIMIT ?`)
    .bind(TODAY_SECTION_LIMIT)
    .all<TodayCloseoutRow>();
  return {
    items: rows.results.map((row) => ({
      id: row.id,
      projectNumber: row.project_number,
      name: row.name,
      installationCompletedAt: Number(row.installation_completed_at),
      href: "/projects?status=closeout",
    })),
    total: safeTotal(rows.results),
  };
}

/**
 * One bounded, deterministic Today assembly shared by the route and AI tool.
 * It reads saved records only and never contacts Gmail or another provider.
 */
export async function assembleToday(
  database: D1Database,
  options: {
    now: number;
    timeZone: string;
  },
): Promise<TodayAssembly> {
  const range = calendarDateRange(options.now, options.timeZone);
  const [
    overdueTasks,
    dueTodayTasks,
    meetingRead,
    leadFollowUps,
    closeoutFollowUps,
  ] = await Promise.all([
    readTasks(database, range.day, "<"),
    readTasks(database, range.day, "="),
    readTodayProjectMeetings(database, {
      now: options.now,
      timeZone: range.timeZone,
      includeUpcoming: false,
      limit: TODAY_PROJECT_MEETINGS_TOOL_LIMIT,
    }),
    readLeadFollowUps(database, options.now),
    readCloseoutFollowUps(database),
  ]);

  return {
    generatedAt: options.now,
    day: range.day,
    displayTimezone: range.timeZone,
    overdueTasks,
    dueTodayTasks,
    meetings: {
      items: meetingRead.items.map((meeting) => ({
        ...meeting,
        href: "/projects",
      })),
      total: meetingRead.total,
    },
    leadFollowUps,
    closeoutFollowUps,
    inbox: {
      label: "Needs review",
      detail: "Open the inbox review queue",
      href: "/inbox?bucket=needs-review",
    },
  };
}

export function todayEvidence(today: TodayAssembly): Evidence[] {
  return [
    ...today.overdueTasks.items.map((task) => ({
      id: `task:${task.id}`,
      label: `Overdue task · ${compact(task.title, 160)}`,
      detail: `Due ${task.dueDate}${task.assigneeEmail ? ` · ${task.assigneeEmail}` : ""}`,
    })),
    ...today.dueTodayTasks.items.map((task) => ({
      id: `task:${task.id}`,
      label: `Due-today task · ${compact(task.title, 160)}`,
      detail: `Due ${task.dueDate}${task.assigneeEmail ? ` · ${task.assigneeEmail}` : ""}`,
    })),
    ...today.meetings.items.map((meeting) => ({
      id: `meeting:${meeting.id}`,
      label: `Meeting · ${compact(meeting.title, 160)}`,
      detail: `${meeting.projectNumber} · ${new Date(meeting.meetingAt).toISOString()}`,
    })),
    ...today.leadFollowUps.items.map((lead) => ({
      id: `lead:${lead.id}`,
      label: `Lead follow-up · ${lead.leadNumber} — ${compact(lead.company, 160)}`,
      detail: `${compact(lead.nextAction, 300)} · ${new Date(lead.nextActionAt).toISOString()}`,
    })),
    ...today.closeoutFollowUps.items.map((project) => ({
      id: `project:${project.id}`,
      label: `Closeout follow-up · ${project.projectNumber} — ${compact(project.name, 160)}`,
      detail: `Installation completed ${new Date(project.installationCompletedAt).toISOString()}; no follow-up result is recorded.`,
    })),
  ].slice(0, TODAY_TOOL_EVIDENCE_LIMIT);
}
