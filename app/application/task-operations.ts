import {
  normalizeTaskCreation,
  normalizeTaskListFilters,
  normalizeTaskPatch,
  TASK_PATCH_KEYS,
  taskResponse,
  type TaskRow,
} from "../domain/task";
import type {
  TaskCreationIntent,
  TaskRepository,
} from "../ports/task-repository";
import { AUTHORIZATION_CAPABILITIES } from "./authorization-capabilities";
import type { CreationAuthorizationContext } from "./creation-authorization";

export type ListTasksResult =
  | { ok: false; kind: "forbidden" | "invalid"; message: string }
  | { ok: true; value: ReturnType<typeof taskResponse>[] };

export type CreateTaskResult =
  | {
      ok: false;
      kind:
        | "forbidden"
        | "invalid"
        | "identifier-collision"
        | "project-not-found"
        | "lead-not-found"
        | "review-not-found";
      message: string;
    }
  | {
      ok: true;
      value: ReturnType<typeof taskResponse>;
      inboxReview?: { id: string; status: "accepted" };
    };

export type UpdateTaskResult =
  | {
      ok: false;
      kind:
        | "forbidden"
        | "invalid"
        | "task-not-found"
        | "project-not-found"
        | "lead-not-found";
      message: string;
    }
  | { ok: false; kind: "conflict"; message: string; currentVersion: string }
  | { ok: true; value: ReturnType<typeof taskResponse> };

type TaskOperationDependencies = {
  repository: TaskRepository;
  newId: () => string;
  now: () => number;
  inboxReview?: {
    id: string;
    connectionKey: string;
    intent: "schedule" | "warranty";
  };
};

export async function listTasks(
  input: Record<string, unknown>,
  authorization: CreationAuthorizationContext,
  repository: Pick<TaskRepository, "list">,
): Promise<ListTasksResult> {
  if (
    !authorization.actorId
    || !authorization.capabilities.has(AUTHORIZATION_CAPABILITIES.recordsRead)
  ) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to view tasks." };
  }
  const filters = normalizeTaskListFilters(input);
  if (!filters.ok) return { ok: false, kind: "invalid", message: filters.message };
  return {
    ok: true,
    value: (await repository.list(filters.value)).map(taskResponse),
  };
}

export async function createTask(
  input: unknown,
  authorization: CreationAuthorizationContext,
  dependencies: TaskOperationDependencies,
): Promise<CreateTaskResult> {
  if (
    !authorization.actorId
    || !authorization.capabilities.has(AUTHORIZATION_CAPABILITIES.tasksUpdate)
  ) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to create tasks." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: "invalid", message: "Task details must be valid JSON." };
  }
  const validation = normalizeTaskCreation(input as Record<string, unknown>);
  if (!validation.ok) return { ok: false, kind: "invalid", message: validation.message };
  const values = validation.value;
  if (
    dependencies.inboxReview
    && (
      values.source !== "email"
      || values.sourceRef === null
      || !/^[A-Za-z0-9_-]{1,256}$/.test(values.sourceRef)
    )
  ) {
    return {
      ok: false,
      kind: "invalid",
      message: "Inbox review tasks must use the stored Gmail message as their email source.",
    };
  }
  const createdAt = dependencies.now();
  const id = dependencies.newId();
  const task: TaskRow = {
    id,
    title: values.title,
    details: values.details,
    status: values.status,
    due_date: values.dueDate,
    project_id: values.projectId,
    lead_id: values.leadId,
    assignee_email: values.assigneeEmail,
    source: values.source,
    source_ref: values.sourceRef,
    created_by: authorization.actorId,
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: values.status === "done" ? createdAt : null,
    version: "1",
  };
  const activities: TaskCreationIntent["activities"] = [{
    id: dependencies.newId(),
    recordId: id,
    action: "Task created" as const,
    actor: authorization.actorId,
    detail: `${values.title}${values.dueDate ? ` · due ${values.dueDate}` : ""}`,
    createdAt,
  }];
  if (values.status === "done") {
    activities.push({
      id: dependencies.newId(),
      recordId: id,
      action: "Task completed",
      actor: authorization.actorId,
      detail: values.title,
      createdAt,
    });
  }
  const result = await dependencies.repository.create({
    task,
    activities,
    ...(dependencies.inboxReview
      ? {
          inboxReview: {
            ...dependencies.inboxReview,
            gmailMessageId: values.sourceRef!,
            approvedProjectId: task.project_id,
            acceptedAt: createdAt,
          },
        }
      : {}),
  });
  if (result.outcome === "identifier-collision") {
    return {
      ok: false,
      kind: result.outcome,
      message: "A task identifier collision occurred. Retry the request.",
    };
  }
  if (result.outcome === "project-not-found") {
    return { ok: false, kind: result.outcome, message: "Project not found." };
  }
  if (result.outcome === "lead-not-found") {
    return { ok: false, kind: result.outcome, message: "Lead not found." };
  }
  if (result.outcome === "review-not-found") {
    return {
      ok: false,
      kind: result.outcome,
      message: "Inbox review changed since it was loaded.",
    };
  }
  if (
    dependencies.inboxReview
      ? result.outcome !== "review-accepted"
        || result.inboxReview.id !== dependencies.inboxReview.id
      : result.outcome !== "created"
  ) {
    throw new Error("Task repository returned inconsistent inbox review evidence.");
  }
  return {
    ok: true,
    value: taskResponse(result.value),
    ...(result.outcome === "review-accepted"
      ? { inboxReview: result.inboxReview }
      : {}),
  };
}

export async function updateTask(
  taskId: string,
  input: unknown,
  authorization: CreationAuthorizationContext,
  dependencies: TaskOperationDependencies,
): Promise<UpdateTaskResult> {
  if (
    !authorization.actorId
    || !authorization.capabilities.has(AUTHORIZATION_CAPABILITIES.tasksUpdate)
  ) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to update tasks." };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) {
    return { ok: false, kind: "invalid", message: "Task identifier is invalid." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: "invalid", message: "Task update must be valid JSON." };
  }
  const validation = normalizeTaskPatch(input as Record<string, unknown>);
  if (!validation.ok) return { ok: false, kind: "invalid", message: validation.message };
  const current = await dependencies.repository.findById(taskId);
  if (!current) return { ok: false, kind: "task-not-found", message: "Task not found." };
  const patch = validation.value;
  if (patch.version && patch.version !== current.version) {
    return {
      ok: false,
      kind: "conflict",
      message: "Task changed since it was loaded.",
      currentVersion: current.version,
    };
  }
  const updatedAt = dependencies.now();
  const nextStatus = patch.status ?? current.status;
  const task: TaskRow = {
    ...current,
    title: patch.title ?? current.title,
    details: Object.hasOwn(patch, "details") ? patch.details ?? null : current.details,
    status: nextStatus,
    due_date: Object.hasOwn(patch, "dueDate") ? patch.dueDate ?? null : current.due_date,
    project_id: Object.hasOwn(patch, "projectId") ? patch.projectId ?? null : current.project_id,
    lead_id: Object.hasOwn(patch, "leadId") ? patch.leadId ?? null : current.lead_id,
    assignee_email: Object.hasOwn(patch, "assigneeEmail")
      ? patch.assigneeEmail ?? null
      : current.assignee_email,
    updated_at: updatedAt,
    completed_at: nextStatus === "done"
      ? current.completed_at ?? updatedAt
      : null,
    version: current.version,
  };
  const responseKey = {
    title: "title",
    details: "details",
    status: "status",
    dueDate: "due_date",
    projectId: "project_id",
    leadId: "lead_id",
    assigneeEmail: "assignee_email",
  } as const;
  const label = {
    title: "Title",
    details: "Details",
    status: "Status",
    dueDate: "Due date",
    projectId: "Project",
    leadId: "Lead",
    assigneeEmail: "Assignee",
  } as const;
  const display = (value: unknown) => value === null || value === "" ? "Not set" : String(value);
  const changes = TASK_PATCH_KEYS.flatMap((key) => {
    if (!Object.hasOwn(patch, key)) return [];
    const column = responseKey[key];
    return current[column] === task[column]
      ? []
      : [`${label[key]}: ${display(current[column])} → ${display(task[column])}`];
  });
  if (changes.length === 0) return { ok: true, value: taskResponse(current) };
  const result = await dependencies.repository.update({
    task,
    expectedVersion: patch.version ?? current.version,
    updatedBy: authorization.actorId,
    activity: {
      id: dependencies.newId(),
      recordId: taskId,
      action: "Task fields updated",
      actor: authorization.actorId,
      detail: changes.join("; "),
      createdAt: updatedAt,
    },
  });
  if (result.outcome === "task-not-found") {
    return { ok: false, kind: result.outcome, message: "Task not found." };
  }
  if (result.outcome === "project-not-found") {
    return { ok: false, kind: result.outcome, message: "Project not found." };
  }
  if (result.outcome === "lead-not-found") {
    return { ok: false, kind: result.outcome, message: "Lead not found." };
  }
  if (result.outcome === "conflict") {
    return {
      ok: false,
      kind: result.outcome,
      message: "Task changed since it was loaded.",
      currentVersion: result.currentVersion,
    };
  }
  return { ok: true, value: taskResponse(result.value) };
}
