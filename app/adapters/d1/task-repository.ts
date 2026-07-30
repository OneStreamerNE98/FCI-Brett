import type { TaskRow } from "../../domain/task";
import type {
  TaskCreationIntent,
  TaskRepository,
  TaskUpdateIntent,
} from "../../ports/task-repository";
import type { D1Database, D1PreparedStatement } from "./d1-database";
import { d1RecordVersion, nextD1RecordVersion } from "./record-version.ts";

type D1TaskRow = Omit<TaskRow, "version"> & { version: unknown };

function taskRow(row: D1TaskRow): TaskRow {
  return { ...row, version: d1RecordVersion(row.version, "D1 task version") };
}

async function currentTaskVersion(database: D1Database, taskId: string) {
  const row = await database
    .prepare("SELECT version FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ version: unknown }>();
  return row ? d1RecordVersion(row.version, "D1 task version") : null;
}

type TaskReferenceFailure = "project-not-found" | "lead-not-found";

function assertInboxReviewIntent(intent: TaskCreationIntent) {
  const created = intent.activities[0];
  if (
    !created
    || created.action !== "Task created"
    || created.recordId !== intent.task.id
    || created.actor !== intent.task.created_by
    || created.createdAt !== intent.task.created_at
  ) {
    throw new TypeError("D1 task creation evidence is invalid");
  }
  const review = intent.inboxReview;
  if (!review) return;
  if (
    !review.id.trim()
    || review.id.length > 512
    || /[\u0000-\u001f\u007f]/.test(review.id)
    || !/^[a-z][a-z0-9_-]{0,127}$/.test(review.connectionKey)
    || !/^[A-Za-z0-9_-]{1,256}$/.test(review.gmailMessageId)
    || !["schedule", "warranty"].includes(review.intent)
    || review.gmailMessageId !== intent.task.source_ref
    || intent.task.source !== "email"
    || review.approvedProjectId !== intent.task.project_id
    || review.acceptedAt !== intent.task.created_at
  ) {
    throw new TypeError("D1 inbox review task evidence is invalid");
  }
}

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
        .all<D1TaskRow>();
      return result.results.map(taskRow);
    },

    findById(taskId) {
      return database.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<D1TaskRow>()
        .then((row) => row ? taskRow(row) : null);
    },

    async create(intent: TaskCreationIntent) {
      assertInboxReviewIntent(intent);
      const { task } = intent;
      const referenceFailure = await missingTaskReference(database, task);
      if (referenceFailure) return { outcome: referenceFailure };
      const existing = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<D1TaskRow>();
      if (existing) return { outcome: "identifier-collision" };

      const statements: D1PreparedStatement[] = [];
      if (intent.inboxReview) {
        statements.push(
          database.prepare(
            `UPDATE mail_items SET status = 'accepted',
               approved_project_id = ?, attempted_label_definition_version = NULL,
               failure_attempts = 0, error_code = NULL, updated_at = ?
             WHERE id = ? AND connection_key = ? AND gmail_message_id = ?
               AND status = 'needs-review'
               AND CASE
                 WHEN json_valid(analysis_payload) = 1 THEN CASE
                   WHEN json_type(analysis_payload, '$.intents') = 'array' THEN EXISTS (
                     SELECT 1
                     FROM json_each(mail_items.analysis_payload, '$.intents') AS stored_intent
                     WHERE stored_intent.type = 'text' AND stored_intent.value = ?
                   )
                   ELSE 0
                 END
                 ELSE 0
               END`,
          ).bind(
            intent.inboxReview.approvedProjectId,
            intent.inboxReview.acceptedAt,
            intent.inboxReview.id,
            intent.inboxReview.connectionKey,
            intent.inboxReview.gmailMessageId,
            intent.inboxReview.intent,
          ),
        );
      }
      statements.push(
        database.prepare(intent.inboxReview
          ? "INSERT INTO tasks (id, title, details, status, due_date, project_id, lead_id, assignee_email, source, source_ref, created_by, created_at, updated_at, completed_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1"
          : "INSERT INTO tasks (id, title, details, status, due_date, project_id, lead_id, assignee_email, source, source_ref, created_by, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(task.id, task.title, task.details, task.status, task.due_date, task.project_id, task.lead_id, task.assignee_email, task.source, task.source_ref, task.created_by, task.created_at, task.updated_at, task.completed_at),
      );
      for (const activity of intent.activities) {
        statements.push(
          database.prepare(`INSERT INTO activity_events (id, record_id, action, actor, detail, created_at)
            SELECT ?, ?, ?, ?, ?, ?
            WHERE ${intent.inboxReview ? "changes() = 1 AND " : ""}EXISTS (
              SELECT 1 FROM tasks
              WHERE id = ? AND title = ? AND source = ? AND created_by = ? AND created_at = ?
            )`)
            .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, task.id, task.title, task.source, task.created_by, task.created_at),
        );
      }
      try {
        const results = await database.batch(statements);
        if (intent.inboxReview && results[0]?.meta.changes !== 1) {
          return { outcome: "review-not-found" };
        }
        const taskInsertIndex = intent.inboxReview ? 1 : 0;
        if (results[taskInsertIndex]?.meta.changes !== 1) {
          throw new Error("D1 task was not inserted exactly once");
        }
      } catch (error) {
        if (isDuplicateTaskError(error)) return { outcome: "identifier-collision" };
        throw error;
      }
      const created = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<D1TaskRow>();
      if (!created) throw new Error("D1 task creation did not return the inserted task");
      return intent.inboxReview
        ? {
            outcome: "review-accepted",
            value: taskRow(created),
            inboxReview: { id: intent.inboxReview.id, status: "accepted" },
          }
        : { outcome: "created", value: taskRow(created) };
    },

    async update(intent: TaskUpdateIntent) {
      const { task } = intent;
      const expectedVersion = d1RecordVersion(intent.expectedVersion, "Expected D1 task version");
      const resultingVersion = nextD1RecordVersion(expectedVersion);
      const existing = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<D1TaskRow>();
      if (!existing) return { outcome: "task-not-found" };
      const currentVersion = d1RecordVersion(existing.version, "D1 task version");
      if (currentVersion !== expectedVersion) {
        return { outcome: "conflict", currentVersion };
      }
      const referenceFailure = await missingTaskReference(database, task);
      if (referenceFailure) return { outcome: referenceFailure };

      const statements: D1PreparedStatement[] = [
        database.prepare("UPDATE tasks SET title = ?, details = ?, status = ?, due_date = ?, project_id = ?, lead_id = ?, assignee_email = ?, updated_at = ?, completed_at = ?, version = version + 1 WHERE id = ? AND version = ?")
          .bind(task.title, task.details, task.status, task.due_date, task.project_id, task.lead_id, task.assignee_email, task.updated_at, task.completed_at, task.id, expectedVersion),
      ];
      statements.push(
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND version = ? AND updated_at = ?)")
          .bind(intent.activity.id, intent.activity.recordId, intent.activity.action, intent.activity.actor, intent.activity.detail, intent.activity.createdAt, task.id, resultingVersion, task.updated_at),
      );
      const results = await database.batch(statements);
      if (results[0]?.meta.changes !== 1) {
        const latestVersion = await currentTaskVersion(database, task.id);
        return latestVersion
          ? { outcome: "conflict", currentVersion: latestVersion }
          : { outcome: "task-not-found" };
      }
      const updated = await database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .bind(task.id)
        .first<D1TaskRow>();
      if (!updated) throw new Error("D1 task update did not return the updated task");
      return { outcome: "updated", value: taskRow(updated) };
    },
  };
}
