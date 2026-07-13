import type { ProjectCreationIntent, ProjectRepository } from "../../ports/project-repository";
import type { PilotD1Database } from "./pilot-database";

export function createPilotD1ProjectRepository(database: PilotD1Database): ProjectRepository {
  return {
    async create(intent: ProjectCreationIntent) {
      const { project, activity } = intent;
      const results = await database.batch([
        database.prepare("INSERT INTO projects (id, project_number, client_id, name, status, site, project_manager, estimated_value, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?)")
          .bind(project.id, project.projectNumber, project.clientId, project.name, project.status, project.site, project.projectManager, project.estimatedValue, project.createdBy, project.createdAt, project.updatedAt, project.clientId),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND project_number = ? AND name = ? AND created_by = ? AND created_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, project.id, project.projectNumber, project.name, project.createdBy, project.createdAt),
      ]);
      return results[0]?.meta.changes === 1 ? { outcome: "created" } : { outcome: "client-not-found" };
    },
  };
}
