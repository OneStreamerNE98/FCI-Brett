import type { TaskListFilters, TaskRow } from "../../domain/task";
import type {
  TaskCreationIntent,
  TaskRepository,
  TaskUpdateIntent,
} from "../../ports/task-repository";

type MemoryTaskRepositoryOptions = {
  projectIds?: Iterable<string>;
  leadIds?: Iterable<string>;
};

function snapshot(row: TaskRow): TaskRow {
  return { ...row };
}

function snapshotActivity(activity: TaskCreationIntent["activities"][number]) {
  return { ...activity };
}

function matches(row: TaskRow, filters: TaskListFilters) {
  return (
    (!filters.status || row.status === filters.status)
    && (!filters.dueBefore || row.due_date !== null && row.due_date <= filters.dueBefore)
    && (!filters.projectId || row.project_id === filters.projectId)
    && (!filters.leadId || row.lead_id === filters.leadId)
    && (!filters.assigneeEmail || row.assignee_email === filters.assigneeEmail)
  );
}

function compareTasks(left: TaskRow, right: TaskRow) {
  if (left.due_date === null && right.due_date !== null) return 1;
  if (left.due_date !== null && right.due_date === null) return -1;
  return (left.due_date ?? "").localeCompare(right.due_date ?? "")
    || right.updated_at - left.updated_at
    || left.id.localeCompare(right.id);
}

/** Local-only adapter used by task application and provider contract tests. */
export class MemoryTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, TaskRow>();
  readonly #activities: TaskCreationIntent["activities"] = [];
  readonly #projectIds: Set<string>;
  readonly #leadIds: Set<string>;

  constructor(options: MemoryTaskRepositoryOptions = {}) {
    this.#projectIds = new Set(options.projectIds ?? []);
    this.#leadIds = new Set(options.leadIds ?? []);
  }

  activityIntents() {
    return this.#activities.map(snapshotActivity);
  }

  async list(filters: TaskListFilters) {
    return [...this.#tasks.values()]
      .filter((row) => matches(row, filters))
      .sort(compareTasks)
      .slice(0, filters.limit)
      .map(snapshot);
  }

  async findById(taskId: string) {
    const row = this.#tasks.get(taskId);
    return row ? snapshot(row) : null;
  }

  async create(intent: TaskCreationIntent) {
    if (intent.task.project_id && !this.#projectIds.has(intent.task.project_id)) {
      return { outcome: "project-not-found" as const };
    }
    if (intent.task.lead_id && !this.#leadIds.has(intent.task.lead_id)) {
      return { outcome: "lead-not-found" as const };
    }
    if (this.#tasks.has(intent.task.id)) return { outcome: "identifier-collision" as const };
    this.#tasks.set(intent.task.id, snapshot(intent.task));
    this.#activities.push(...intent.activities.map(snapshotActivity));
    return { outcome: "created" as const, value: snapshot(intent.task) };
  }

  async update(intent: TaskUpdateIntent) {
    if (!this.#tasks.has(intent.task.id)) return { outcome: "task-not-found" as const };
    if (intent.task.project_id && !this.#projectIds.has(intent.task.project_id)) {
      return { outcome: "project-not-found" as const };
    }
    if (intent.task.lead_id && !this.#leadIds.has(intent.task.lead_id)) {
      return { outcome: "lead-not-found" as const };
    }
    this.#tasks.set(intent.task.id, snapshot(intent.task));
    if (intent.activity) this.#activities.push(snapshotActivity(intent.activity));
    return { outcome: "updated" as const, value: snapshot(intent.task) };
  }
}
