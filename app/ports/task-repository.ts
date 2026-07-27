import type { TaskListFilters, TaskRow } from "../domain/task";
import type { VersionConflict } from "../domain/record-version";

export type TaskActivityIntent = {
  id: string;
  recordId: string;
  action: "Task created" | "Task completed" | "Task fields updated";
  actor: string;
  detail: string;
  createdAt: number;
};

export type TaskCreationIntent = {
  task: TaskRow;
  activities: TaskActivityIntent[];
};

export type TaskCreationRepositoryResult =
  | { outcome: "created"; value: TaskRow }
  | { outcome: "identifier-collision" }
  | { outcome: "project-not-found" }
  | { outcome: "lead-not-found" };

export type TaskUpdateIntent = {
  task: TaskRow;
  expectedVersion: string;
  updatedBy: string;
  activity: TaskActivityIntent;
};

export type TaskUpdateRepositoryResult =
  | { outcome: "updated"; value: TaskRow }
  | { outcome: "task-not-found" }
  | { outcome: "project-not-found" }
  | { outcome: "lead-not-found" }
  | VersionConflict;

export interface TaskRepository {
  list(filters: TaskListFilters): Promise<TaskRow[]>;
  findById(taskId: string): Promise<TaskRow | null>;
  create(intent: TaskCreationIntent): Promise<TaskCreationRepositoryResult>;
  update(intent: TaskUpdateIntent): Promise<TaskUpdateRepositoryResult>;
}
