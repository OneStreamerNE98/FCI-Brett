import type { ProjectMeetingRow } from "../../domain/project-meeting";
import type {
  ProjectMeetingCreationIntent,
  ProjectMeetingRepository,
} from "../../ports/project-meeting-repository";
import type { D1Database } from "./d1-database";

export function createD1ProjectMeetingRepository(
  database: D1Database,
): ProjectMeetingRepository {
  return {
    async projectExists(projectId) {
      const project = await database
        .prepare("SELECT id FROM projects WHERE id = ?")
        .bind(projectId)
        .first<{ id: string }>();
      return Boolean(project);
    },

    async findProjectForCreation(projectId) {
      const project = await database
        .prepare("SELECT id, project_number FROM projects WHERE id = ?")
        .bind(projectId)
        .first<{ id: string; project_number: string }>();
      return project
        ? { id: project.id, projectNumber: project.project_number }
        : null;
    },

    async listForProject(projectId) {
      const meetings = await database
        .prepare("SELECT * FROM project_meetings WHERE project_id = ? ORDER BY meeting_at DESC, created_at DESC LIMIT 100")
        .bind(projectId)
        .all<ProjectMeetingRow>();
      return meetings.results;
    },

    async create(intent: ProjectMeetingCreationIntent) {
      const { meeting, activity } = intent;
      await database.batch([
        database.prepare("INSERT INTO project_meetings (id, project_id, title, meeting_at, meeting_type, source_provider, source_url, attendees_json, notes, transcript, summary, decisions, action_items_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(meeting.id, meeting.project_id, meeting.title, meeting.meeting_at, meeting.meeting_type, meeting.source_provider, meeting.source_url, meeting.attendees_json, meeting.notes, meeting.transcript, meeting.summary, meeting.decisions, meeting.action_items_json, meeting.created_by, meeting.created_at, meeting.updated_at),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt),
      ]);
      const created = await database
        .prepare("SELECT * FROM project_meetings WHERE id = ?")
        .bind(meeting.id)
        .first<ProjectMeetingRow>();
      if (!created) throw new Error("D1 meeting creation did not return the inserted meeting");
      return { outcome: "created", value: created };
    },
  };
}
