import type { TaskRow } from "../../domain/task";
import type {
  TaskCreationIntent,
  TaskRepository,
  TaskUpdateIntent,
} from "../../ports/task-repository";
import type { D1Database, D1PreparedStatement } from "./d1-database";

type TaskReferenceFailure = "project-not-found" | "lead-not-found";

function isDuplicateTaskError(error: unknown) {
  const detail = error instanceof Error
    ? `${error.message} ${String(error.cause ?? "")}`
    : String(error);
  return /UNIQUE constraint failed: tasks\.id/i.test(detail);
}

async function missingTaskReference(
  database: D1Database,
  task: Pick<TaskRow, "project_id" | "lead_id">,
): Promise<TaskReferenceFailure | null> {
  if (task.project_id) {
    const project = await database
      .prepare("SELECT id FROM projects WHERE id = ?")
      .bind(task.project_id)
      .first<{ id: string }>();
    if (!project) return "project-not-found";
  }
  if (task.lead_id) {
    const lead = await database
      .prepare("SELECT id FROM leads WHERE id = ?")
      .bind(task.lead_id)
      .first<{ id: string }>();
    if (!lead) return "lead-not-found";
  }
  return null;
}

export function createD1TaskRepository(database: D1Database): TaskRepository {
  return {
    async list(filters) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (filters.status) {
        conditions.push("status = ?");
        values.push(filters.status);
      }
      if (filters.dueBefore) {
        conditions.push("due_date IS NOT NULL AND due_date <= ?");
        values.push(filters.dueBefore);
      }
      if (filters.projectId) {
        conditions.push("project_id = ?");
        values.push(filters.projectId);
      }
      if (filters.leadId) {
        conditions.push("lead_id = ?");
        values.push(filters.leadId);
      }
      if (filters.assigneeEmail) {
        conditions.push("assignee_email = ?");
        values.push(filters.assigneeEmail);
      }
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const result = await database
        .prepare(
          `SELECT * FROM tasks${where} ORDER BY due_date IS NULL, due_date, updated_at DESC, id LIMIT ?`,
        )
        .bind(...values, filters.limit)
        .all<TaskRow>();
      return result.results;
    },

    findById(taskId) {
      return database.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<TaskRow>();
    },

    async create(intent: TaskCreationIntent) {
      const { task } = intent;
      const referenceFailure = await missingTaskReference(database, task);
      if (referenceFailure) return { outcome: referenceFailure };
      const existing = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<TaskRow>();
      if (existing) return { outcome: "identifier-collision" };

      const statements: D1PreparedStatement[] = [
        database.prepare("INSERT INTO tasks (id, title, details, status, due_date, project_id, lead_id, assignee_email, source, source_ref, created_by, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(task.id, task.title, task.details, task.status, task.due_date, task.project_id, task.lead_id, task.assignee_email, task.source, task.source_ref, task.created_by, task.created_at, task.updated_at, task.completed_at),
      ];
      for (const activity of intent.activities) {
        statements.push(
          database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND title = ? AND source = ? AND created_by = ? AND created_at = ?)")
            .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, task.id, task.title, task.source, task.created_by, task.created_at),
        );
      }
      try {
        await database.batch(statements);
      } catch (error) {
        if (isDuplicateTaskError(error)) return { outcome: "identifier-collision" };
        throw error;
      }
      const created = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<TaskRow>();
      if (!created) throw new Error("D1 task creation did not return the inserted task");
      return { outcome: "created", value: created };
    },

    async update(intent: TaskUpdateIntent) {
      const { task } = intent;
      const existing = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<TaskRow>();
      if (!existing) return { outcome: "task-not-found" };
      const referenceFailure = await missingTaskReference(database, task);
      if (referenceFailure) return { outcome: referenceFailure };

      const statements: D1PreparedStatement[] = [
        database.prepare("UPDATE tasks SET title = ?, details = ?, status = ?, due_date = ?, project_id = ?, lead_id = ?, assignee_email = ?, updated_at = ?, completed_at = ? WHERE id = ?")
          .bind(task.title, task.details, task.status, task.due_date, task.project_id, task.lead_id, task.assignee_email, task.updated_at, task.completed_at, task.id),
      ];
      if (intent.activity) {
        statements.push(
          database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND status = ? AND updated_at = ?)")
            .bind(intent.activity.id, intent.activity.recordId, intent.activity.action, intent.activity.actor, intent.activity.detail, intent.activity.createdAt, task.id, task.status, task.updated_at),
        );
      }
      const results = await database.batch(statements);
      if (results[0]?.meta.changes !== 1) return { outcome: "task-not-found" };
      const updated = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<TaskRow>();
      if (!updated) throw new Error("D1 task update did not return the updated task");
      return { outcome: "updated", value: updated };
    },
  };
}
