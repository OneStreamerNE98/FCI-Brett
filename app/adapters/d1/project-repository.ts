import type { ProjectCreationIntent, ProjectOperationsRepository, ProjectRepository } from "../../ports/project-repository";
import type { D1Database } from "./d1-database";

export function createD1ProjectRepository(database: D1Database): ProjectRepository & ProjectOperationsRepository {
  return {
    async create(intent: ProjectCreationIntent) {
      const { project, activity } = intent;
      const results = await database.batch([
        database.prepare("INSERT INTO projects (id, project_number, client_id, name, status, site, project_manager, estimated_value, flooring_category, square_feet, contract_value, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?)")
          .bind(project.id, project.projectNumber, project.clientId, project.name, project.status, project.site, project.projectManagerId, project.estimatedValue, project.flooringCategory, project.squareFeet, project.contractValue, project.createdBy, project.createdAt, project.updatedAt, project.clientId),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND project_number = ? AND name = ? AND created_by = ? AND created_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, project.id, project.projectNumber, project.name, project.createdBy, project.createdAt),
      ]);
      return results[0]?.meta.changes === 1 ? { outcome: "created" } : { outcome: "client-not-found" };
    },
    async assignManager(intent) {
      const { activity } = intent;
      const results = await database.batch([
        database.prepare("UPDATE projects SET project_manager = ?, updated_at = ? WHERE id = ?")
          .bind(intent.projectManagerId, intent.updatedAt, intent.projectId),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND project_manager = ? AND updated_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, intent.projectId, intent.projectManagerId, intent.updatedAt),
      ]);
      return results[0]?.meta.changes === 1 ? { outcome: "updated" } : { outcome: "project-not-found" };
    },
    async recordInstallationDates(intent) {
      const { activity } = intent;
      const results = await database.batch([
        database.prepare("UPDATE projects SET installation_started_at = ?, installation_completed_at = ?, updated_at = ? WHERE id = ?")
          .bind(intent.installationStartedAt, intent.installationCompletedAt, intent.updatedAt, intent.projectId),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND installation_started_at = ? AND installation_completed_at = ? AND updated_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, intent.projectId, intent.installationStartedAt, intent.installationCompletedAt, intent.updatedAt),
      ]);
      return results[0]?.meta.changes === 1 ? { outcome: "updated" } : { outcome: "project-not-found" };
    },
    async recordFollowUpResult(intent) {
      const { activity } = intent;
      const hadCallback = intent.hadCallback ? 1 : 0;
      const results = await database.batch([
        database.prepare("UPDATE projects SET had_callback = ?, callback_note = ?, updated_at = ? WHERE id = ?")
          .bind(hadCallback, intent.callbackNote, intent.updatedAt, intent.projectId),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND had_callback = ? AND callback_note IS ? AND updated_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, intent.projectId, hadCallback, intent.callbackNote, intent.updatedAt),
      ]);
      return results[0]?.meta.changes === 1 ? { outcome: "updated" } : { outcome: "project-not-found" };
    },
  };
}
