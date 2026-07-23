import type { TaskListFilters, TaskRow } from "../domain/task";

export type TaskActivityIntent = {
  id: string;
  recordId: string;
  action: "Task created" | "Task completed";
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
  | { outcome: "identifier-collision" };

export type TaskUpdateIntent = {
  task: TaskRow;
  updatedBy: string;
  activity: TaskActivityIntent | null;
};

export type TaskUpdateRepositoryResult =
  | { outcome: "updated"; value: TaskRow }
  | { outcome: "task-not-found" };

export interface TaskRepository {
  list(filters: TaskListFilters): Promise<TaskRow[]>;
  findById(taskId: string): Promise<TaskRow | null>;
  create(intent: TaskCreationIntent): Promise<TaskCreationRepositoryResult>;
  update(intent: TaskUpdateIntent): Promise<TaskUpdateRepositoryResult>;
}
