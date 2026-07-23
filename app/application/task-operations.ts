import {
  normalizeTaskCreation,
  normalizeTaskListFilters,
  normalizeTaskPatch,
  taskResponse,
  type TaskRow,
} from "../domain/task";
import type { TaskActivityIntent, TaskRepository } from "../ports/task-repository";
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
        | "lead-not-found";
      message: string;
    }
  | { ok: true; value: ReturnType<typeof taskResponse> };

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
  | { ok: true; value: ReturnType<typeof taskResponse> };

type TaskOperationDependencies = {
  repository: TaskRepository;
  newId: () => string;
  now: () => number;
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
  };
  const activities: TaskActivityIntent[] = [{
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
  const result = await dependencies.repository.create({ task, activities });
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
  return { ok: true, value: taskResponse(result.value) };
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
  };
  const completing = current.status !== "done" && nextStatus === "done";
  const result = await dependencies.repository.update({
    task,
    updatedBy: authorization.actorId,
    activity: completing
      ? {
          id: dependencies.newId(),
          recordId: taskId,
          action: "Task completed",
          actor: authorization.actorId,
          detail: task.title,
          createdAt: updatedAt,
        }
      : null,
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
  return { ok: true, value: taskResponse(result.value) };
}
