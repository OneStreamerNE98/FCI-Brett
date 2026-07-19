import {
  normalizeProjectMeeting,
  type ProjectMeetingRow,
} from "../../domain/project-meeting";
import type {
  AcceptedProjectMeetingCreation,
  ProjectMeetingCreationIntent,
  ProjectMeetingRepository,
} from "../../ports/project-meeting-repository";
import {
  bindPostgresCreationRequest,
  calculatePostgresRequestFingerprint,
  claimPostgresCreation,
  completePostgresCreation,
  failPostgresCreation,
  POSTGRES_CREATION_OPERATIONS,
  type PostgresCreationRequestMetadata,
} from "./creation-idempotency";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  isPostgresUuid,
  parsePostgresJsonObject,
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
} from "./postgres-values";

type PostgresProjectMeetingRepositoryOptions = {
  schema?: string;
  request?: PostgresCreationRequestMetadata;
};

type MeetingDatabaseRow = Record<string, unknown> & {
  id: unknown;
  project_id: unknown;
  title: unknown;
  meeting_at: unknown;
  meeting_type: unknown;
  source_provider: unknown;
  source_url: unknown;
  attendees: unknown;
  notes: unknown;
  transcript: unknown;
  summary: unknown;
  decisions: unknown;
  action_items: unknown;
  created_by: unknown;
  created_at: unknown;
  updated_at: unknown;
  version?: unknown;
};

const MEETING_SELECT = `SELECT id::text AS id, project_id::text AS project_id, title,
       meeting_at, meeting_type, source_provider, source_url, attendees,
       notes, transcript, summary, decisions, action_items, created_by,
       created_at, updated_at, version::text AS version
FROM project_meetings`;

const MEETING_IDENTIFIER_CONSTRAINTS = [
  "project_meetings_pkey",
  "activity_events_pkey",
  "outbox_events_pkey",
  "outbox_events_event_key_key",
  "idempotency_requests_pkey",
] as const;

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function nullableText(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function textList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} is invalid`);
  }
  return value as string[];
}

function meetingRowFromPostgres(row: MeetingDatabaseRow): ProjectMeetingRow {
  if (!isPostgresUuid(row.id) || !isPostgresUuid(row.project_id)) {
    throw new Error("PostgreSQL meeting identifiers are invalid");
  }
  return {
    id: row.id,
    project_id: row.project_id,
    title: requiredText(row.title, "PostgreSQL meeting title"),
    meeting_at: parsePostgresTimestamp(row.meeting_at, "PostgreSQL meeting time"),
    meeting_type: requiredText(row.meeting_type, "PostgreSQL meeting type"),
    source_provider: requiredText(row.source_provider, "PostgreSQL meeting source provider"),
    source_url: nullableText(row.source_url, "PostgreSQL meeting source URL"),
    attendees_json: JSON.stringify(textList(row.attendees, "PostgreSQL meeting attendees")),
    notes: nullableText(row.notes, "PostgreSQL meeting notes"),
    transcript: nullableText(row.transcript, "PostgreSQL meeting transcript"),
    summary: nullableText(row.summary, "PostgreSQL meeting summary"),
    decisions: nullableText(row.decisions, "PostgreSQL meeting decisions"),
    action_items_json: JSON.stringify(textList(row.action_items, "PostgreSQL meeting action items")),
    created_by: requiredText(row.created_by, "PostgreSQL meeting creator"),
    created_at: parsePostgresTimestamp(row.created_at, "PostgreSQL meeting created_at"),
    updated_at: parsePostgresTimestamp(row.updated_at, "PostgreSQL meeting updated_at"),
  };
}

function requiredEpoch(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} is invalid`);
  return value;
}

function storedMeetingRow(value: unknown): ProjectMeetingRow {
  const row = parsePostgresJsonObject(value, "PostgreSQL stored meeting row");
  if (!isPostgresUuid(row.id) || !isPostgresUuid(row.project_id)) {
    throw new Error("PostgreSQL stored meeting identifiers are invalid");
  }
  for (const key of ["attendees_json", "action_items_json"] as const) {
    if (typeof row[key] !== "string") throw new Error(`PostgreSQL stored meeting ${key} is invalid`);
    textList(JSON.parse(row[key]), `PostgreSQL stored meeting ${key}`);
  }
  return {
    id: row.id,
    project_id: row.project_id,
    title: requiredText(row.title, "PostgreSQL stored meeting title"),
    meeting_at: requiredEpoch(row.meeting_at, "PostgreSQL stored meeting time"),
    meeting_type: requiredText(row.meeting_type, "PostgreSQL stored meeting type"),
    source_provider: requiredText(row.source_provider, "PostgreSQL stored meeting source provider"),
    source_url: nullableText(row.source_url, "PostgreSQL stored meeting source URL"),
    attendees_json: row.attendees_json as string,
    notes: nullableText(row.notes, "PostgreSQL stored meeting notes"),
    transcript: nullableText(row.transcript, "PostgreSQL stored meeting transcript"),
    summary: nullableText(row.summary, "PostgreSQL stored meeting summary"),
    decisions: nullableText(row.decisions, "PostgreSQL stored meeting decisions"),
    action_items_json: row.action_items_json as string,
    created_by: requiredText(row.created_by, "PostgreSQL stored meeting creator"),
    created_at: requiredEpoch(row.created_at, "PostgreSQL stored meeting created_at"),
    updated_at: requiredEpoch(row.updated_at, "PostgreSQL stored meeting updated_at"),
  };
}

function acceptedMeeting(value: unknown): AcceptedProjectMeetingCreation {
  const record = parsePostgresJsonObject(value, "PostgreSQL stored meeting response");
  return {
    row: storedMeetingRow(record.row),
    version: parsePostgresPositiveBigint(record.version, "PostgreSQL stored meeting version"),
  };
}

function acceptedMeetingFromRow(row: MeetingDatabaseRow): AcceptedProjectMeetingCreation {
  return {
    row: meetingRowFromPostgres(row),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL meeting version"),
  };
}

function parsedIntentLists(meeting: ProjectMeetingRow) {
  let attendees: unknown;
  let actionItems: unknown;
  try {
    attendees = JSON.parse(meeting.attendees_json);
    actionItems = JSON.parse(meeting.action_items_json);
  } catch {
    throw new TypeError("PostgreSQL meeting lists must be valid JSON arrays");
  }
  return {
    attendees: textList(attendees, "PostgreSQL meeting attendees"),
    actionItems: textList(actionItems, "PostgreSQL meeting action items"),
  };
}

function normalizedMeetingFields(meeting: ProjectMeetingRow) {
  if (!Number.isSafeInteger(meeting.meeting_at)) {
    throw new TypeError("PostgreSQL meeting time must be a safe epoch millisecond");
  }
  const lists = parsedIntentLists(meeting);
  const validation = normalizeProjectMeeting({
    title: meeting.title,
    meetingAt: new Date(meeting.meeting_at).toISOString(),
    meetingType: meeting.meeting_type,
    sourceUrl: meeting.source_url,
    attendees: lists.attendees,
    notes: meeting.notes,
    transcript: meeting.transcript,
    summary: meeting.summary,
    decisions: meeting.decisions,
    actionItems: lists.actionItems,
  });
  if (!validation.ok || validation.value.meetingType !== meeting.meeting_type
    || validation.value.sourceProvider !== meeting.source_provider) {
    throw new TypeError("PostgreSQL meeting values must satisfy meeting validation");
  }
  return validation.value;
}

function meetingCreationFingerprintInput(intent: ProjectMeetingCreationIntent) {
  const values = normalizedMeetingFields(intent.meeting);
  return { version: 1, projectId: intent.meeting.project_id, ...values };
}

export function calculatePostgresProjectMeetingCreationFingerprint(
  intent: ProjectMeetingCreationIntent,
) {
  return calculatePostgresRequestFingerprint(meetingCreationFingerprintInput(intent));
}

function assertMeetingIntent(intent: ProjectMeetingCreationIntent) {
  if (!isPostgresUuid(intent.meeting.id)) throw new TypeError("PostgreSQL meeting ID must be a UUID");
  if (!isPostgresUuid(intent.activity.id)) throw new TypeError("PostgreSQL meeting activity ID must be a UUID");
  normalizedMeetingFields(intent.meeting);
  if (intent.activity.recordId !== intent.meeting.project_id) {
    throw new TypeError("PostgreSQL meeting evidence must reference its project");
  }
  if (intent.activity.actor !== intent.meeting.created_by || !intent.meeting.created_by.trim()) {
    throw new TypeError("PostgreSQL meeting actor must match its activity evidence");
  }
  for (const timestamp of [intent.meeting.created_at, intent.meeting.updated_at, intent.activity.createdAt]) {
    if (!Number.isSafeInteger(timestamp)) {
      throw new TypeError("PostgreSQL meeting timestamps must be safe epoch milliseconds");
    }
  }
}

function postgresConstraint(error: unknown, code: string, constraints: readonly string[]) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === code && typeof record.constraint === "string"
    && constraints.includes(record.constraint);
}

export function createPostgresProjectMeetingRepository(
  pool: PostgresPool,
  options: PostgresProjectMeetingRepositoryOptions = {},
): ProjectMeetingRepository {
  return {
    async projectExists(projectId) {
      if (!isPostgresUuid(projectId)) return false;
      return withPostgresTransaction(pool, { schema: options.schema, readOnly: true }, async (client) => {
        const result = await client.query<{ id: unknown }>(
          "SELECT id::text AS id FROM projects WHERE id = $1",
          [projectId],
        );
        if (result.rows.length > 1) throw new Error("PostgreSQL project lookup returned too many rows");
        return result.rowCount === 1 && result.rows[0]?.id === projectId;
      });
    },

    async findProjectForCreation(projectId) {
      if (!isPostgresUuid(projectId)) return null;
      return withPostgresTransaction(pool, { schema: options.schema, readOnly: true }, async (client) => {
        const result = await client.query<{ id: unknown; project_number: unknown }>(
          "SELECT id::text AS id, project_number FROM projects WHERE id = $1",
          [projectId],
        );
        if (result.rowCount === 0) return null;
        if (result.rowCount !== 1 || result.rows[0]?.id !== projectId) {
          throw new Error("PostgreSQL project lookup returned an invalid result");
        }
        return {
          id: projectId,
          projectNumber: requiredText(
            result.rows[0].project_number,
            "PostgreSQL project number",
          ),
        };
      });
    },

    async listForProject(projectId) {
      if (!isPostgresUuid(projectId)) return [];
      return withPostgresTransaction(pool, { schema: options.schema, readOnly: true }, async (client) => {
        const result = await client.query<MeetingDatabaseRow>(
          `${MEETING_SELECT}\nWHERE project_id = $1\nORDER BY meeting_at DESC, created_at DESC, id\nLIMIT 100`,
          [projectId],
        );
        return result.rows.map(meetingRowFromPostgres);
      });
    },

    async create(intent) {
      assertMeetingIntent(intent);
      if (!options.request) {
        throw new TypeError("PostgreSQL meeting creation requires an idempotency request context");
      }
      const request = bindPostgresCreationRequest(
        options.request,
        meetingCreationFingerprintInput(intent),
      );
      try {
        return await withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
          const meeting = intent.meeting;
          const claim = await claimPostgresCreation(
            client,
            POSTGRES_CREATION_OPERATIONS.projectMeeting,
            meeting.created_by,
            meeting.created_at,
            request,
            acceptedMeeting,
          );
          if (claim.outcome === "idempotency-conflict" || claim.outcome === "in-progress") return claim;
          if (claim.outcome === "failed-replay") {
            if (claim.responseStatus === 404 && claim.responseBody.outcome === "project-not-found") {
              return { outcome: "project-not-found" as const };
            }
            throw new Error("Stored PostgreSQL meeting failure response is invalid");
          }
          if (claim.outcome === "replayed") {
            return { outcome: "accepted" as const, value: claim.value, replayed: true };
          }

          if (!isPostgresUuid(meeting.project_id)) {
            await failPostgresCreation(
              client,
              POSTGRES_CREATION_OPERATIONS.projectMeeting,
              meeting.created_by,
              meeting.updated_at,
              request,
              404,
              { outcome: "project-not-found" },
            );
            return { outcome: "project-not-found" as const };
          }
          const project = await client.query<{ id: unknown }>(
            "SELECT id::text AS id FROM projects WHERE id = $1 FOR KEY SHARE",
            [meeting.project_id],
          );
          if (project.rowCount !== 1 || project.rows[0]?.id !== meeting.project_id) {
            if (project.rowCount === 0 && project.rows.length === 0) {
              await failPostgresCreation(
                client,
                POSTGRES_CREATION_OPERATIONS.projectMeeting,
                meeting.created_by,
                meeting.updated_at,
                request,
                404,
                { outcome: "project-not-found" },
              );
              return { outcome: "project-not-found" as const };
            }
            throw new Error("PostgreSQL meeting parent lookup returned an invalid result");
          }

          const lists = parsedIntentLists(meeting);
          const inserted = await client.query<MeetingDatabaseRow>(
            `INSERT INTO project_meetings (
               id, project_id, title, meeting_at, meeting_type, source_provider,
               source_url, attendees, notes, transcript, summary, decisions,
               action_items, created_by, created_at, updated_at, version
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12,
               $13::jsonb, $14, $15, $16, 1
             )
             RETURNING id::text AS id, project_id::text AS project_id, title,
               meeting_at, meeting_type, source_provider, source_url, attendees,
               notes, transcript, summary, decisions, action_items, created_by,
               created_at, updated_at, version::text AS version`,
            [
              meeting.id, meeting.project_id, meeting.title, new Date(meeting.meeting_at),
              meeting.meeting_type, meeting.source_provider, meeting.source_url,
              JSON.stringify(lists.attendees), meeting.notes, meeting.transcript,
              meeting.summary, meeting.decisions, JSON.stringify(lists.actionItems),
              meeting.created_by, new Date(meeting.created_at), new Date(meeting.updated_at),
            ],
          );
          if (inserted.rowCount !== 1 || !inserted.rows[0]) {
            throw new Error("PostgreSQL meeting was not inserted exactly once");
          }
          const value = acceptedMeetingFromRow(inserted.rows[0]);
          await client.query(
            `INSERT INTO activity_events (
               id, project_id, action, actor_id, correlation_id, result, detail, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7)`,
            [
              intent.activity.id, meeting.project_id, intent.activity.action,
              intent.activity.actor, request.correlationId,
              JSON.stringify({ message: intent.activity.detail }),
              new Date(intent.activity.createdAt),
            ],
          );
          await client.query(
            `INSERT INTO outbox_events (
               id, event_key, event_type, project_id, actor_id, correlation_id,
               payload, status, available_at, created_at, updated_at, version
             ) VALUES ($1, $2, 'project.meeting.created', $3, $4, $5, $6::jsonb,
               'pending', $7, $7, $7, 1)`,
            [
              request.outboxEventId, `project.meeting.created:${meeting.id}`,
              meeting.project_id, meeting.created_by, request.correlationId,
              JSON.stringify({
                cause: "project-meeting-created",
                recordId: meeting.id,
                projectId: meeting.project_id,
              }),
              new Date(meeting.created_at),
            ],
          );
          await completePostgresCreation(
            client,
            POSTGRES_CREATION_OPERATIONS.projectMeeting,
            meeting.created_by,
            meeting.updated_at,
            request,
            value,
          );
          return { outcome: "accepted" as const, value, replayed: false };
        });
      } catch (error) {
        if (postgresConstraint(error, "23505", MEETING_IDENTIFIER_CONSTRAINTS)) {
          return { outcome: "identifier-collision" };
        }
        throw error;
      }
    },
  };
}
