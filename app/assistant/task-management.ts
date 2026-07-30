export const TASK_MANAGEMENT_PATCH_KEYS = [
  "title",
  "details",
  "status",
  "dueDate",
  "projectId",
  "leadId",
  "assigneeEmail",
] as const;

export type TaskManagementPatchKey = typeof TASK_MANAGEMENT_PATCH_KEYS[number];
export type TaskManagementStatus = "open" | "done";

export type TaskManagementRecord = {
  id: string;
  title: string;
  details: string | null;
  status: TaskManagementStatus;
  dueDate: string | null;
  projectId: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
  source: string;
  sourceRef: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  version: string;
};

export type TaskManagementDraft = {
  title: string;
  details: string;
  status: TaskManagementStatus;
  dueDate: string;
  projectId: string;
  leadId: string;
  assigneeEmail: string;
};

export type TaskManagementFilters = {
  status: "" | TaskManagementStatus;
  assigneeEmail: string;
  dueBefore: string;
  projectId: string;
};

export type TaskManagementPatch = Partial<{
  title: string;
  details: string | null;
  status: TaskManagementStatus;
  dueDate: string | null;
  projectId: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
}> & {
  version: string;
};

export const EMPTY_TASK_DRAFT: TaskManagementDraft = {
  title: "",
  details: "",
  status: "open",
  dueDate: "",
  projectId: "",
  leadId: "",
  assigneeEmail: "",
};

export const EMPTY_TASK_FILTERS: TaskManagementFilters = {
  status: "",
  assigneeEmail: "",
  dueBefore: "",
  projectId: "",
};

function optional(value: string) {
  const cleaned = value.trim();
  return cleaned || null;
}

export function taskManagementDraft(
  task?: TaskManagementRecord,
): TaskManagementDraft {
  if (!task) return { ...EMPTY_TASK_DRAFT };
  return {
    title: task.title,
    details: task.details ?? "",
    status: task.status,
    dueDate: task.dueDate ?? "",
    projectId: task.projectId ?? "",
    leadId: task.leadId ?? "",
    assigneeEmail: task.assigneeEmail ?? "",
  };
}

export function taskManagementCreateBody(draft: TaskManagementDraft) {
  return {
    title: draft.title.trim(),
    details: optional(draft.details),
    status: draft.status,
    dueDate: optional(draft.dueDate),
    projectId: optional(draft.projectId),
    leadId: optional(draft.leadId),
    assigneeEmail: optional(draft.assigneeEmail)?.toLowerCase() ?? null,
    source: "manual" as const,
  };
}

export function taskManagementPatch(
  task: TaskManagementRecord,
  draft: TaskManagementDraft,
): TaskManagementPatch | null {
  const createShape = taskManagementCreateBody(draft);
  const patch: TaskManagementPatch = { version: task.version };

  if (createShape.title !== task.title) patch.title = createShape.title;
  if (createShape.details !== task.details) patch.details = createShape.details;
  if (createShape.status !== task.status) patch.status = createShape.status;
  if (createShape.dueDate !== task.dueDate) patch.dueDate = createShape.dueDate;
  if (createShape.projectId !== task.projectId) patch.projectId = createShape.projectId;
  if (createShape.leadId !== task.leadId) patch.leadId = createShape.leadId;
  if (createShape.assigneeEmail !== task.assigneeEmail) {
    patch.assigneeEmail = createShape.assigneeEmail;
  }

  return Object.keys(patch).length > 1 ? patch : null;
}

export function taskManagementSearch(filters: TaskManagementFilters) {
  const search = new URLSearchParams({ limit: "200" });
  if (filters.status) search.set("status", filters.status);
  if (filters.assigneeEmail.trim()) {
    search.set("assigneeEmail", filters.assigneeEmail.trim().toLowerCase());
  }
  if (filters.dueBefore) search.set("dueBefore", filters.dueBefore);
  if (filters.projectId) search.set("projectId", filters.projectId);
  return search.toString();
}

export function isTaskManagementRecord(value: unknown): value is TaskManagementRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string"
    && typeof row.title === "string"
    && (row.details === null || typeof row.details === "string")
    && (row.status === "open" || row.status === "done")
    && (row.dueDate === null || typeof row.dueDate === "string")
    && (row.projectId === null || typeof row.projectId === "string")
    && (row.leadId === null || typeof row.leadId === "string")
    && (row.assigneeEmail === null || typeof row.assigneeEmail === "string")
    && typeof row.source === "string"
    && (row.sourceRef === null || typeof row.sourceRef === "string")
    && typeof row.createdBy === "string"
    && typeof row.createdAt === "number"
    && typeof row.updatedAt === "number"
    && (row.completedAt === null || typeof row.completedAt === "number")
    && typeof row.version === "string"
  );
}

export function taskManagementSavedValue(
  task: TaskManagementRecord,
  key: TaskManagementPatchKey,
) {
  const value = task[key];
  if (key === "status") return value === "done" ? "Done" : "Open";
  return value === null || value === "" ? "Not set" : String(value);
}
