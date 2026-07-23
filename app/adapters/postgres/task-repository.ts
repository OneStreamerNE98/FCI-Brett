import {
  normalizeTaskCreation,
  TASK_SOURCES,
  TASK_STATUSES,
  type TaskListFilters,
  type TaskRow,
} from "../../domain/task";
import type {
  TaskCreationIntent,
  TaskRepository,
  TaskUpdateIntent,
} from "../../ports/task-repository";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  isPostgresUuid,
  parsePostgresTimestamp,
} from "./postgres-values";

type PostgresTaskRepositoryOptions = {
  schema?: string;
};

type TaskDatabaseRow = Record<string, unknown> & {
  id: unknown;
  title: unknown;
  details: unknown;
  status: unknown;
  due_date: unknown;
  project_id: unknown;
  lead_id: unknown;
  assignee_email: unknown;
  source: unknown;
  source_ref: unknown;
  created_by: unknown;
  created_at: unknown;
  updated_at: unknown;
  completed_at: unknown;
  version?: unknown;
};

const TASK_SELECT = `SELECT id::text AS id, title, details, status,
       due_date::text AS due_date, project_id::text AS project_id,
       lead_id::text AS lead_id, assignee_email, source, source_ref,
       created_by, created_at, updated_at, completed_at,
       version::text AS version
FROM tasks`;

const TASK_IDENTIFIER_CONSTRAINTS = [
  "tasks_pkey",
  "activity_events_pkey",
] as const;
const TASK_PROJECT_REFERENCE_CONSTRAINTS = ["tasks_project_id_fkey"] as const;
const TASK_LEAD_REFERENCE_CONSTRAINTS = ["tasks_lead_id_fkey"] as const;

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function nullableText(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function nullableUuid(value: unknown, label: string) {
  if (value === null) return null;
  if (!isPostgresUuid(value)) throw new Error(`${label} is invalid`);
  return value;
}

function nullableTimestamp(value: unknown, label: string) {
  return value === null ? null : parsePostgresTimestamp(value, label);
}

function taskRowFromPostgres(row: TaskDatabaseRow): TaskRow {
  if (!isPostgresUuid(row.id)) throw new Error("PostgreSQL task ID is invalid");
  const status = requiredText(row.status, "PostgreSQL task status");
  const source = requiredText(row.source, "PostgreSQL task source");
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    throw new Error("PostgreSQL task status is unsupported");
  }
  if (!(TASK_SOURCES as readonly string[]).includes(source)) {
    throw new Error("PostgreSQL task source is unsupported");
  }
  const task: TaskRow = {
    id: row.id,
    title: requiredText(row.title, "PostgreSQL task title"),
    details: nullableText(row.details, "PostgreSQL task details"),
    status,
    due_date: nullableText(row.due_date, "PostgreSQL task due date"),
    project_id: nullableUuid(row.project_id, "PostgreSQL task project ID"),
    lead_id: nullableUuid(row.lead_id, "PostgreSQL task lead ID"),
    assignee_email: nullableText(row.assignee_email, "PostgreSQL task assignee email"),
    source,
    source_ref: nullableText(row.source_ref, "PostgreSQL task source reference"),
    created_by: requiredText(row.created_by, "PostgreSQL task creator"),
    created_at: parsePostgresTimestamp(row.created_at, "PostgreSQL task created_at"),
    updated_at: parsePostgresTimestamp(row.updated_at, "PostgreSQL task updated_at"),
    completed_at: nullableTimestamp(row.completed_at, "PostgreSQL task completed_at"),
  };
  assertNormalizedTask(task);
  return task;
}

function assertUuid(value: string, label: string) {
  if (!isPostgresUuid(value)) throw new TypeError(`${label} must be a UUID`);
}

function assertNormalizedTask(task: TaskRow) {
  const validation = normalizeTaskCreation({
    title: task.title,
    details: task.details,
    status: task.status,
    dueDate: task.due_date,
    projectId: task.project_id,
    leadId: task.lead_id,
    assigneeEmail: task.assignee_email,
    source: task.source,
    sourceRef: task.source_ref,
  });
  if (!validation.ok) throw new TypeError("PostgreSQL task values must satisfy task validation");
  if (task.project_id) assertUuid(task.project_id, "PostgreSQL task project ID");
  if (task.lead_id) assertUuid(task.lead_id, "PostgreSQL task lead ID");
  for (const timestamp of [task.created_at, task.updated_at]) {
    if (!Number.isSafeInteger(timestamp)) {
      throw new TypeError("PostgreSQL task timestamps must be safe epoch milliseconds");
    }
  }
  const completedAt = task.completed_at;
  if (
    task.updated_at < task.created_at
    || task.status === "open" && completedAt !== null
    || task.status === "done"
      && (!Number.isSafeInteger(completedAt) || completedAt === null || completedAt < task.created_at)
  ) {
    throw new TypeError("PostgreSQL task completion timestamps are inconsistent");
  }
}

function assertCreationIntent(intent: TaskCreationIntent) {
  assertUuid(intent.task.id, "PostgreSQL task ID");
  assertNormalizedTask(intent.task);
  for (const activity of intent.activities) {
    assertUuid(activity.id, "PostgreSQL task activity ID");
    if (
      activity.recordId !== intent.task.id
      || activity.actor !== intent.task.created_by
      || !Number.isSafeInteger(activity.createdAt)
    ) {
      throw new TypeError("PostgreSQL task creation evidence must match the task and actor");
    }
  }
}

function assertUpdateIntent(intent: TaskUpdateIntent) {
  assertUuid(intent.task.id, "PostgreSQL task ID");
  assertNormalizedTask(intent.task);
  if (!intent.updatedBy.trim()) throw new TypeError("PostgreSQL task updater is required");
  if (intent.activity) {
    assertUuid(intent.activity.id, "PostgreSQL task activity ID");
    if (
      intent.activity.recordId !== intent.task.id
      || intent.activity.actor !== intent.updatedBy
      || intent.activity.createdAt !== intent.task.updated_at
    ) {
      throw new TypeError("PostgreSQL task completion evidence must match the task and updater");
    }
  }
}

function postgresConstraint(error: unknown, code: string, constraints: readonly string[]) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === code && typeof record.constraint === "string"
    && constraints.includes(record.constraint);
}

function taskReferenceFailure(error: unknown) {
  if (postgresConstraint(error, "23503", TASK_PROJECT_REFERENCE_CONSTRAINTS)) {
    return "project-not-found" as const;
  }
  if (postgresConstraint(error, "23503", TASK_LEAD_REFERENCE_CONSTRAINTS)) {
    return "lead-not-found" as const;
  }
  return null;
}

function taskParameters(task: TaskRow, updatedBy: string) {
  return [
    task.id,
    task.title,
    task.details,
    task.status,
    task.due_date,
    task.project_id,
    task.lead_id,
    task.assignee_email,
    task.source,
    task.source_ref,
    task.created_by,
    updatedBy,
    new Date(task.created_at),
    new Date(task.updated_at),
    task.completed_at === null ? null : new Date(task.completed_at),
  ];
}

async function insertActivity(
  client: { query(sql: string, values?: readonly unknown[]): Promise<unknown> },
  activity: TaskCreationIntent["activities"][number],
  correlationPrefix: string,
) {
  await client.query(
    `INSERT INTO activity_events (
       id, task_id, action, actor_id, correlation_id, result, detail, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7)`,
    [
      activity.id,
      activity.recordId,
      activity.action,
      activity.actor,
      `${correlationPrefix}:${activity.id}`,
      JSON.stringify({ message: activity.detail }),
      new Date(activity.createdAt),
    ],
  );
}

export function createPostgresTaskRepository(
  pool: PostgresPool,
  options: PostgresTaskRepositoryOptions = {},
): TaskRepository {
  return {
    async list(filters: TaskListFilters) {
      return withPostgresTransaction(
        pool,
        { schema: options.schema, readOnly: true },
        async (client) => {
          const conditions: string[] = [];
          const values: unknown[] = [];
          const bind = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
          };
          if (filters.status) conditions.push(`status = ${bind(filters.status)}`);
          if (filters.dueBefore) conditions.push(`due_date <= ${bind(filters.dueBefore)}::date`);
          if (filters.projectId) conditions.push(`project_id = ${bind(filters.projectId)}`);
          if (filters.leadId) conditions.push(`lead_id = ${bind(filters.leadId)}`);
          if (filters.assigneeEmail) {
            conditions.push(`assignee_email = ${bind(filters.assigneeEmail)}`);
          }
          const where = conditions.length > 0 ? `\nWHERE ${conditions.join(" AND ")}` : "";
          const limit = bind(filters.limit);
          const result = await client.query<TaskDatabaseRow>(
            `${TASK_SELECT}${where}
ORDER BY due_date NULLS LAST, updated_at DESC, id
LIMIT ${limit}`,
            values,
          );
          return result.rows.map(taskRowFromPostgres);
        },
      );
    },

    async findById(taskId) {
      if (!isPostgresUuid(taskId)) return null;
      return withPostgresTransaction(
        pool,
        { schema: options.schema, readOnly: true },
        async (client) => {
          const result = await client.query<TaskDatabaseRow>(
            `${TASK_SELECT}\nWHERE id = $1`,
            [taskId],
          );
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || !result.rows[0]) {
            throw new Error("PostgreSQL task lookup returned an invalid result");
          }
          return taskRowFromPostgres(result.rows[0]);
        },
      );
    },

    async create(intent) {
      assertCreationIntent(intent);
      try {
        return await withPostgresTransaction(
          pool,
          { schema: options.schema },
          async (client) => {
            const inserted = await client.query<TaskDatabaseRow>(
              `INSERT INTO tasks (
                 id, title, details, status, due_date, project_id, lead_id,
                 assignee_email, source, source_ref, created_by, updated_by,
                 created_at, updated_at, completed_at, version
               ) VALUES (
                 $1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, 1
               )
               RETURNING id::text AS id, title, details, status,
                 due_date::text AS due_date, project_id::text AS project_id,
                 lead_id::text AS lead_id, assignee_email, source, source_ref,
                 created_by, created_at, updated_at, completed_at,
                 version::text AS version`,
              taskParameters(intent.task, intent.task.created_by),
            );
            if (inserted.rowCount !== 1 || !inserted.rows[0]) {
              throw new Error("PostgreSQL task was not inserted exactly once");
            }
            for (const activity of intent.activities) {
              await insertActivity(client, activity, "task-create");
            }
            return {
              outcome: "created" as const,
              value: taskRowFromPostgres(inserted.rows[0]),
            };
          },
        );
      } catch (error) {
        const referenceFailure = taskReferenceFailure(error);
        if (referenceFailure) return { outcome: referenceFailure };
        if (postgresConstraint(error, "23505", TASK_IDENTIFIER_CONSTRAINTS)) {
          return { outcome: "identifier-collision" };
        }
        throw error;
      }
    },

    async update(intent) {
      assertUpdateIntent(intent);
      try {
        return await withPostgresTransaction(
          pool,
          { schema: options.schema },
          async (client) => {
            const task = intent.task;
            const updated = await client.query<TaskDatabaseRow>(
              `UPDATE tasks SET
                 title = $1, details = $2, status = $3, due_date = $4::date,
                 project_id = $5, lead_id = $6, assignee_email = $7,
                 updated_by = $8, updated_at = $9, completed_at = $10,
                 version = version + 1
               WHERE id = $11
               RETURNING id::text AS id, title, details, status,
                 due_date::text AS due_date, project_id::text AS project_id,
                 lead_id::text AS lead_id, assignee_email, source, source_ref,
                 created_by, created_at, updated_at, completed_at,
                 version::text AS version`,
              [
                task.title,
                task.details,
                task.status,
                task.due_date,
                task.project_id,
                task.lead_id,
                task.assignee_email,
                intent.updatedBy,
                new Date(task.updated_at),
                task.completed_at === null ? null : new Date(task.completed_at),
                task.id,
              ],
            );
            if (updated.rowCount === 0) return { outcome: "task-not-found" as const };
            if (updated.rowCount !== 1 || !updated.rows[0]) {
              throw new Error("PostgreSQL task update returned an invalid result");
            }
            if (intent.activity) await insertActivity(client, intent.activity, "task-update");
            return { outcome: "updated" as const, value: taskRowFromPostgres(updated.rows[0]) };
          },
        );
      } catch (error) {
        const referenceFailure = taskReferenceFailure(error);
        if (referenceFailure) return { outcome: referenceFailure };
        throw error;
      }
    },
  };
}
