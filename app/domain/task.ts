export const MAX_TASK_BODY_BYTES = 8_000;
export const MAX_TASK_LIST_RESULTS = 200;

export const TASK_STATUSES = ["open", "done"] as const;
export const TASK_SOURCES = ["manual", "meeting", "email", "ai"] as const;

export type TaskStatus = typeof TASK_STATUSES[number];
export type TaskSource = typeof TASK_SOURCES[number];

const TASK_STATUS_SET = new Set<string>(TASK_STATUSES);
const TASK_SOURCE_SET = new Set<string>(TASK_SOURCES);
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TASK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type TaskRow = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  due_date: string | null;
  project_id: string | null;
  lead_id: string | null;
  assignee_email: string | null;
  source: string;
  source_ref: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

export type ValidatedTaskCreation = {
  title: string;
  details: string | null;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
  source: TaskSource;
  sourceRef: string | null;
};

export type ValidatedTaskPatch = Partial<{
  title: string;
  details: string | null;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
}>;

export type TaskListFilters = {
  status?: TaskStatus;
  dueBefore?: string;
  projectId?: string;
  leadId?: string;
  assigneeEmail?: string;
  limit: number;
};

export type TaskValidation<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const TASK_CREATE_KEYS = new Set([
  "title",
  "details",
  "status",
  "dueDate",
  "projectId",
  "leadId",
  "assigneeEmail",
  "source",
  "sourceRef",
]);

const TASK_PATCH_KEYS = new Set([
  "title",
  "details",
  "status",
  "dueDate",
  "projectId",
  "leadId",
  "assigneeEmail",
]);

const TASK_LIST_KEYS = new Set([
  "status",
  "dueBefore",
  "projectId",
  "leadId",
  "assigneeEmail",
  "limit",
]);

function hasOnlyKeys(body: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(body).every((key) => allowed.has(key));
}

function singleLineText(value: unknown, maximum: number, required = true) {
  if (value === undefined || value === null) return required ? undefined : null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return required ? undefined : null;
  if (cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) return undefined;
  return cleaned;
}

function multilineText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return null;
  if (
    cleaned.length > maximum
    || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)
  ) {
    return undefined;
  }
  return cleaned;
}

function taskId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return TASK_ID_PATTERN.test(cleaned) ? cleaned : undefined;
}

function taskEmail(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const cleaned = singleLineText(value, 254);
  if (!cleaned) return undefined;
  const normalized = cleaned.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function taskDate(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !TASK_DATE_PATTERN.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function taskStatus(value: unknown, fallback?: TaskStatus) {
  const candidate = value ?? fallback;
  return typeof candidate === "string" && TASK_STATUS_SET.has(candidate)
    ? candidate as TaskStatus
    : undefined;
}

function taskSource(value: unknown) {
  const candidate = value ?? "manual";
  return typeof candidate === "string" && TASK_SOURCE_SET.has(candidate)
    ? candidate as TaskSource
    : undefined;
}

export function normalizeTaskCreation(
  body: Record<string, unknown>,
): TaskValidation<ValidatedTaskCreation> {
  if (!hasOnlyKeys(body, TASK_CREATE_KEYS)) {
    return { ok: false, message: "Task details contain unsupported fields." };
  }
  const title = singleLineText(body.title, 200);
  const details = multilineText(body.details, 4_000);
  const status = taskStatus(body.status, "open");
  const dueDate = taskDate(body.dueDate);
  const projectId = taskId(body.projectId);
  const leadId = taskId(body.leadId);
  const assigneeEmail = taskEmail(body.assigneeEmail);
  const source = taskSource(body.source);
  const sourceRef = singleLineText(body.sourceRef, 512, false);
  if (
    !title
    || details === undefined
    || !status
    || dueDate === undefined
    || projectId === undefined
    || leadId === undefined
    || assigneeEmail === undefined
    || !source
    || sourceRef === undefined
  ) {
    return {
      ok: false,
      message: "Enter a valid task title, details, status, due date, relationship, assignee, and source.",
    };
  }
  return {
    ok: true,
    value: {
      title,
      details,
      status,
      dueDate,
      projectId,
      leadId,
      assigneeEmail,
      source,
      sourceRef,
    },
  };
}

export function normalizeTaskPatch(
  body: Record<string, unknown>,
): TaskValidation<ValidatedTaskPatch> {
  if (!hasOnlyKeys(body, TASK_PATCH_KEYS) || Object.keys(body).length === 0) {
    return { ok: false, message: "Task update must contain at least one supported field." };
  }
  const patch: ValidatedTaskPatch = {};
  if (Object.hasOwn(body, "title")) {
    const value = singleLineText(body.title, 200);
    if (!value) return { ok: false, message: "Task title must be 200 characters or fewer." };
    patch.title = value;
  }
  if (Object.hasOwn(body, "details")) {
    const value = multilineText(body.details, 4_000);
    if (value === undefined) return { ok: false, message: "Task details must be 4000 characters or fewer." };
    patch.details = value;
  }
  if (Object.hasOwn(body, "status")) {
    const value = taskStatus(body.status);
    if (!value) return { ok: false, message: "Task status must be open or done." };
    patch.status = value;
  }
  if (Object.hasOwn(body, "dueDate")) {
    const value = taskDate(body.dueDate);
    if (value === undefined) return { ok: false, message: "Task due date must be a valid YYYY-MM-DD date." };
    patch.dueDate = value;
  }
  if (Object.hasOwn(body, "projectId")) {
    const value = taskId(body.projectId);
    if (value === undefined) return { ok: false, message: "Task project is invalid." };
    patch.projectId = value;
  }
  if (Object.hasOwn(body, "leadId")) {
    const value = taskId(body.leadId);
    if (value === undefined) return { ok: false, message: "Task lead is invalid." };
    patch.leadId = value;
  }
  if (Object.hasOwn(body, "assigneeEmail")) {
    const value = taskEmail(body.assigneeEmail);
    if (value === undefined) return { ok: false, message: "Task assignee email is invalid." };
    patch.assigneeEmail = value;
  }
  return { ok: true, value: patch };
}

export function normalizeTaskListFilters(
  input: Record<string, unknown>,
): TaskValidation<TaskListFilters> {
  if (!hasOnlyKeys(input, TASK_LIST_KEYS)) {
    return { ok: false, message: "Task filters contain unsupported fields." };
  }
  const status = input.status === undefined || input.status === ""
    ? undefined
    : taskStatus(input.status);
  const dueBefore = input.dueBefore === undefined || input.dueBefore === ""
    ? undefined
    : taskDate(input.dueBefore);
  const projectId = input.projectId === undefined || input.projectId === ""
    ? undefined
    : taskId(input.projectId);
  const leadId = input.leadId === undefined || input.leadId === ""
    ? undefined
    : taskId(input.leadId);
  const assigneeEmail = input.assigneeEmail === undefined || input.assigneeEmail === ""
    ? undefined
    : taskEmail(input.assigneeEmail);
  const requestedLimit = input.limit === undefined || input.limit === ""
    ? MAX_TASK_LIST_RESULTS
    : Number(input.limit);
  if (
    status === undefined && input.status !== undefined && input.status !== ""
    || dueBefore === undefined && input.dueBefore !== undefined && input.dueBefore !== ""
    || projectId === undefined && input.projectId !== undefined && input.projectId !== ""
    || leadId === undefined && input.leadId !== undefined && input.leadId !== ""
    || assigneeEmail === undefined && input.assigneeEmail !== undefined && input.assigneeEmail !== ""
    || !Number.isSafeInteger(requestedLimit)
    || requestedLimit < 1
    || requestedLimit > MAX_TASK_LIST_RESULTS
  ) {
    return { ok: false, message: "Task filters are invalid." };
  }
  return {
    ok: true,
    value: {
      ...(status ? { status } : {}),
      ...(dueBefore ? { dueBefore } : {}),
      ...(projectId ? { projectId } : {}),
      ...(leadId ? { leadId } : {}),
      ...(assigneeEmail ? { assigneeEmail } : {}),
      limit: requestedLimit,
    },
  };
}

export function taskResponse(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    status: row.status,
    dueDate: row.due_date,
    projectId: row.project_id,
    leadId: row.lead_id,
    assigneeEmail: row.assignee_email,
    source: row.source,
    sourceRef: row.source_ref,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
