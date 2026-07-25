"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox,
  ListTodo,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import type {
  TodayAssembly,
  TodayCloseoutFollowUp,
  TodayLeadFollowUp,
  TodayMeeting,
  TodayTask,
} from "../../application/assistant/today";
import {
  calendarDateRange,
  localDayRolloverDelay,
} from "../../application/today-project-meetings";
import { OperationsEmptyState } from "../../components/operations/OperationsPrimitives";
import styles from "./TodayPanel.module.css";

type LoadState = "loading" | "ready" | "error";

type TaskFocusTarget = { taskId: string } | { heading: true };

// The actionable checkboxes render in DOM order: overdue tasks, then due-today
// tasks. Focus resolution walks that same flat order.
function orderedTaskIds(assembly: TodayAssembly): string[] {
  return [...assembly.overdueTasks.items, ...assembly.dueTodayTasks.items].map((task) => task.id);
}

// After a completed row drops out of the refreshed list, pick the next row still
// present from completedIndex, then the previous one, and fall back to the stable
// panel heading when none remain (mirrors AI-07's nextReviewFocus).
function nextTaskFocus(
  previousIds: readonly string[],
  completedIndex: number,
  remainingIds: readonly string[],
): TaskFocusTarget {
  const remaining = new Set(remainingIds);
  for (let index = completedIndex + 1; index < previousIds.length; index += 1) {
    if (remaining.has(previousIds[index])) return { taskId: previousIds[index] };
  }
  for (let index = Math.min(completedIndex, previousIds.length) - 1; index >= 0; index -= 1) {
    if (remaining.has(previousIds[index])) return { taskId: previousIds[index] };
  }
  return { heading: true };
}

function dateTimeLabel(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function dateLabel(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

function overflowLabel(rendered: number, total: number) {
  const remaining = Math.max(0, total - rendered);
  return remaining > 0 ? `and ${remaining} more…` : null;
}

function TaskSection({
  title,
  empty,
  items,
  total,
  completingTaskId,
  onComplete,
  registerControl,
}: {
  title: string;
  empty: string;
  items: TodayTask[];
  total: number;
  completingTaskId: string;
  onComplete: (task: TodayTask) => void;
  registerControl: (taskId: string, node: HTMLInputElement | null) => void;
}) {
  const overflow = overflowLabel(items.length, total);
  return <section className={styles.section} aria-labelledby={`today-${title.toLowerCase().replaceAll(" ", "-")}`}>
    <header>
      <div>
        <ListTodo size={18} aria-hidden="true" />
        <h2 id={`today-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h2>
      </div>
      <span>{total}</span>
    </header>
    {items.length === 0 ? <p className={styles.empty}>{empty}</p> : <ul className={styles.rows}>{items.map((task) => <li className={styles.taskRow} key={task.id}>
      <label className={styles.taskControl}>
        <input
          ref={(node) => registerControl(task.id, node)}
          type="checkbox"
          checked={false}
          disabled={Boolean(completingTaskId)}
          onChange={() => onComplete(task)}
          aria-label={`Complete task ${task.title}`}
        />
      </label>
      <Link href={task.href}>
        <span><strong>{task.title}</strong><small>Due {task.dueDate}{task.assigneeEmail ? ` · ${task.assigneeEmail}` : ""}</small></span>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </li>)}</ul>}
    {overflow && <p className={styles.overflow}>{overflow}</p>}
  </section>;
}

function MeetingSection({
  items,
  total,
  timeZone,
}: {
  items: TodayMeeting[];
  total: number;
  timeZone: string;
}) {
  const overflow = overflowLabel(items.length, total);
  return <section className={styles.section} aria-labelledby="today-meetings">
    <header>
      <div><CalendarDays size={18} aria-hidden="true" /><h2 id="today-meetings">Today&apos;s meetings</h2></div>
      <span>{total}</span>
    </header>
    {items.length === 0 ? <p className={styles.empty}>No project meetings are saved for today.</p> : <ul className={styles.rows}>{items.map((meeting) => <li key={meeting.id}><Link href={meeting.href}>
      <span><strong>{meeting.title}</strong><small>{meeting.projectNumber} — {meeting.projectName} · {dateTimeLabel(meeting.meetingAt, timeZone)}</small></span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link></li>)}</ul>}
    {overflow && <p className={styles.overflow}>{overflow}</p>}
  </section>;
}

function LeadFollowUpSection({
  items,
  total,
  timeZone,
}: {
  items: TodayLeadFollowUp[];
  total: number;
  timeZone: string;
}) {
  const overflow = overflowLabel(items.length, total);
  return <section className={styles.section} aria-labelledby="today-lead-follow-ups">
    <header>
      <div><Clock3 size={18} aria-hidden="true" /><h2 id="today-lead-follow-ups">Lead follow-ups</h2></div>
      <span>{total}</span>
    </header>
    {items.length === 0 ? <p className={styles.empty}>No active lead follow-ups are past due.</p> : <ul className={styles.rows}>{items.map((lead) => <li key={lead.id}><Link href={lead.href}>
      <span><strong>{lead.leadNumber} — {lead.company}</strong><small>{lead.nextAction} · due {dateTimeLabel(lead.nextActionAt, timeZone)}</small></span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link></li>)}</ul>}
    {overflow && <p className={styles.overflow}>{overflow}</p>}
  </section>;
}

function CloseoutFollowUpSection({
  items,
  total,
  timeZone,
}: {
  items: TodayCloseoutFollowUp[];
  total: number;
  timeZone: string;
}) {
  const overflow = overflowLabel(items.length, total);
  return <section className={styles.section} aria-labelledby="today-closeout-follow-ups">
    <header>
      <div><UserRoundCheck size={18} aria-hidden="true" /><h2 id="today-closeout-follow-ups">Closeout follow-ups</h2></div>
      <span>{total}</span>
    </header>
    {items.length === 0 ? <p className={styles.empty}>No completed installations are waiting for a recorded follow-up result.</p> : <ul className={styles.rows}>{items.map((project) => <li key={project.id}><Link href={project.href}>
      <span><strong>{project.projectNumber} — {project.name}</strong><small>Installation completed {dateLabel(project.installationCompletedAt, timeZone)} · no follow-up result recorded</small></span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link></li>)}</ul>}
    {overflow && <p className={styles.overflow}>{overflow}</p>}
  </section>;
}

export function TodayPanel() {
  const [state, setState] = useState<LoadState>("loading");
  const [today, setToday] = useState<TodayAssembly | null>(null);
  const [error, setError] = useState("");
  const [completingTaskId, setCompletingTaskId] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [taskError, setTaskError] = useState("");
  const loadIdRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const taskControlRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusRef = useRef<TaskFocusTarget | null>(null);

  const registerTaskControl = useCallback((taskId: string, node: HTMLInputElement | null) => {
    if (node) taskControlRefs.current.set(taskId, node);
    else taskControlRefs.current.delete(taskId);
  }, []);

  // Resolve deferred focus once controls are re-enabled after an in-place refresh.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || completingTaskId) return;
    pendingFocusRef.current = null;
    const target = "taskId" in pending
      ? taskControlRefs.current.get(pending.taskId)
      : headingRef.current;
    target?.focus();
  });

  const load = useCallback(async (
    options?: { signal?: AbortSignal; silent?: boolean },
  ): Promise<TodayAssembly | undefined> => {
    const signal = options?.signal;
    const loadId = ++loadIdRef.current;
    // A silent reload (the completion path) keeps the current list mounted while
    // fresh data loads instead of swapping in the loading empty state.
    if (!options?.silent) setState("loading");
    setError("");
    try {
      const response = await fetch("/api/v1/assistant/today", {
        headers: { Accept: "application/json" },
        signal,
      });
      const data = await response.json().catch(() => ({})) as TodayAssembly & { error?: string };
      if (!response.ok || !data.overdueTasks || !data.dueTodayTasks) {
        throw new Error(data.error ?? "Today could not be loaded.");
      }
      if (loadId !== loadIdRef.current) return;
      setToday(data);
      setState("ready");
      return data;
    } catch (loadError) {
      if (signal?.aborted || loadId !== loadIdRef.current) return;
      // Stale-while-revalidate: a failed background refresh keeps the stale list.
      if (options?.silent) return;
      setToday(null);
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Today could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load({ signal: controller.signal }));
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!today) return;
    const currentTimestamp = Date.now();
    const responseIsCurrent = calendarDateRange(
      currentTimestamp,
      today.displayTimezone,
    ).day === today.day;
    const rolloverDelay = responseIsCurrent
      ? localDayRolloverDelay(currentTimestamp, today.displayTimezone)
      : 0;
    // Floor the corrective re-read at the same 1s minimum localDayRolloverDelay
    // enforces so clock skew can't cause back-to-back refetch hammering.
    const timeoutId = window.setTimeout(() => void load(), Math.max(1_000, rolloverDelay));
    return () => window.clearTimeout(timeoutId);
  }, [load, today]);

  async function completeTask(task: TodayTask) {
    const previousIds = today ? orderedTaskIds(today) : [];
    const completedIndex = previousIds.indexOf(task.id);
    setCompletingTaskId(task.id);
    setAnnouncement("");
    setTaskError("");
    try {
      const response = await fetch(`/api/v1/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The task could not be completed.");
      setAnnouncement(`${task.title} completed.`);
      const refreshed = await load({ silent: true });
      if (refreshed && completedIndex >= 0) {
        const remainingIds = orderedTaskIds(refreshed);
        if (!remainingIds.includes(task.id)) {
          pendingFocusRef.current = nextTaskFocus(previousIds, completedIndex, remainingIds);
        }
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "The task could not be completed.";
      setTaskError(message);
    } finally {
      setCompletingTaskId("");
    }
  }

  const savedWorkCount = today
    ? today.overdueTasks.total
      + today.dueTodayTasks.total
      + today.meetings.total
      + today.leadFollowUps.total
      + today.closeoutFollowUps.total
    : 0;

  let content;
  if (state === "loading") {
    content = <OperationsEmptyState variant="page"><RefreshCw className={styles.spinner} size={24} aria-hidden="true" /><h2>Loading today&apos;s saved records…</h2><p>Checking tasks, meetings, leads, and closeout follow-ups.</p></OperationsEmptyState>;
  } else if (state === "error" || !today) {
    content = <OperationsEmptyState variant="page" tone="error"><CircleAlert size={24} aria-hidden="true" /><h2>Today is unavailable</h2><p>{error || "Today could not be loaded."}</p><button className="soft-button" type="button" onClick={() => void load()}>Try again</button></OperationsEmptyState>;
  } else {
    content = <>
      <section className={styles.summary} aria-labelledby="today-summary-title">
        <div><p className="eyebrow">Saved-record snapshot</p><h2 id="today-summary-title" ref={headingRef} tabIndex={-1}>{savedWorkCount === 0 ? "Nothing due in saved records" : `${savedWorkCount} saved item${savedWorkCount === 1 ? "" : "s"} to review`}</h2><p>Computed when you open this page in {today.displayTimezone}. No scheduler or Gmail search runs here.</p></div>
        <CheckCircle2 size={24} aria-hidden="true" />
      </section>
      <div className={styles.grid}>
        <TaskSection title="Overdue tasks" empty="No open tasks are overdue." items={today.overdueTasks.items} total={today.overdueTasks.total} completingTaskId={completingTaskId} onComplete={(task) => void completeTask(task)} registerControl={registerTaskControl} />
        <TaskSection title="Due today" empty="No open tasks are due today." items={today.dueTodayTasks.items} total={today.dueTodayTasks.total} completingTaskId={completingTaskId} onComplete={(task) => void completeTask(task)} registerControl={registerTaskControl} />
        <MeetingSection items={today.meetings.items} total={today.meetings.total} timeZone={today.displayTimezone} />
        <LeadFollowUpSection items={today.leadFollowUps.items} total={today.leadFollowUps.total} timeZone={today.displayTimezone} />
        <CloseoutFollowUpSection items={today.closeoutFollowUps.items} total={today.closeoutFollowUps.total} timeZone={today.displayTimezone} />
        <section className={`${styles.section} ${styles.inbox}`} aria-labelledby="today-inbox">
          <header><div><Inbox size={18} aria-hidden="true" /><h2 id="today-inbox">{today.inbox.label}</h2></div></header>
          <Link href={today.inbox.href}><span><strong>{today.inbox.detail}</strong><small>Review messages without guessing a count.</small></span><ChevronRight size={16} aria-hidden="true" /></Link>
        </section>
      </div>
    </>;
  }

  // One live region and one task-error region stay mounted across every state so
  // completion announcements render into an already-present region and focus can
  // fall back to the panel heading.
  return <div className={styles.panel}>
    <p className={styles.visuallyHidden} role="status" aria-live="polite">{announcement}</p>
    {taskError && <p className={styles.taskError} role="alert">{taskError}</p>}
    {content}
  </div>;
}
