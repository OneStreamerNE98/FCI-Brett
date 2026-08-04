import {
  FLOORING_CATEGORIES,
  PROJECT_STATUSES,
  type FlooringCategory,
  type ProjectStatus,
} from "../../domain/project-creation";
import { normalizeProjectSegment } from "../../domain/project-segment";
import { SAVED_ADDRESS_VERDICTS, type SavedAddressVerdict } from "../../domain/address-validation";
import type {
  ProjectCreationIntent,
  ProjectOperationsRepository,
  ProjectRepository,
  ProjectRow,
} from "../../ports/project-repository";
import type { D1Database } from "./d1-database";
import { d1RecordVersion, nextD1RecordVersion } from "./record-version.ts";

type D1ProjectRow = {
  id: string;
  project_number: string;
  client_id: string;
  name: string;
  status: string;
  site: string | null;
  latitude: number | null;
  longitude: number | null;
  address_validation_verdict: string | null;
  project_manager: string | null;
  estimated_value: number | null;
  flooring_category: string | null;
  square_feet: number | null;
  contract_value: number | null;
  segment: string | null;
  updated_at: number;
  version: unknown;
};

function projectRow(row: D1ProjectRow): ProjectRow {
  const addressVerdict = row.address_validation_verdict ?? null;
  if (!PROJECT_STATUSES.includes(row.status as ProjectStatus)) {
    throw new Error("D1 project status is unsupported.");
  }
  if (
    row.flooring_category !== null
    && !FLOORING_CATEGORIES.includes(row.flooring_category as FlooringCategory)
  ) {
    throw new Error("D1 project flooring category is unsupported.");
  }
  const segment = normalizeProjectSegment(row.segment);
  if (row.segment !== null && segment === null) {
    throw new Error("D1 project segment is unsupported.");
  }
  if (
    addressVerdict !== null
    && !SAVED_ADDRESS_VERDICTS.includes(addressVerdict as SavedAddressVerdict)
  ) {
    throw new Error("D1 project address verdict is unsupported.");
  }
  return {
    id: row.id,
    projectNumber: row.project_number,
    clientId: row.client_id,
    name: row.name,
    status: row.status as ProjectStatus,
    site: row.site,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    addressValidationVerdict: addressVerdict as SavedAddressVerdict | null,
    projectManagerId: row.project_manager,
    estimatedValue: row.estimated_value,
    flooringCategory: row.flooring_category as FlooringCategory | null,
    squareFeet: row.square_feet,
    contractValue: row.contract_value,
    segment,
    updatedAt: row.updated_at,
    version: d1RecordVersion(row.version, "D1 project version"),
  };
}

async function currentProjectVersion(database: D1Database, projectId: string) {
  const row = await database
    .prepare("SELECT version FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ version: unknown }>();
  return row ? d1RecordVersion(row.version, "D1 project version") : null;
}

async function operationExpectedVersion(
  database: D1Database,
  projectId: string,
  supplied: string | undefined,
) {
  const currentVersion = await currentProjectVersion(database, projectId);
  if (!currentVersion) return { outcome: "project-not-found" as const };
  if (supplied === undefined) return { outcome: "ready" as const, expectedVersion: currentVersion };
  const expectedVersion = d1RecordVersion(supplied, "Expected D1 project version");
  return expectedVersion === currentVersion
    ? { outcome: "ready" as const, expectedVersion }
    : { outcome: "conflict" as const, currentVersion };
}

async function projectUpdateFailure(database: D1Database, projectId: string) {
  const currentVersion = await currentProjectVersion(database, projectId);
  return currentVersion
    ? { outcome: "conflict" as const, currentVersion }
    : { outcome: "project-not-found" as const };
}

const PROJECT_SELECT = `SELECT id, project_number, client_id, name, status, site,
  latitude, longitude, address_validation_verdict,
  project_manager, estimated_value, flooring_category, square_feet,
  contract_value, segment, updated_at, version
FROM projects`;

export function createD1ProjectRepository(database: D1Database): ProjectRepository & ProjectOperationsRepository {
  return {
    async findById(projectId) {
      const row = await database
        .prepare(`${PROJECT_SELECT} WHERE id = ?`)
        .bind(projectId)
        .first<D1ProjectRow>();
      return row ? projectRow(row) : null;
    },

    async create(intent: ProjectCreationIntent) {
      const { project, activity } = intent;
      const results = await database.batch([
        database.prepare("INSERT INTO projects (id, project_number, client_id, name, status, site, latitude, longitude, address_validation_verdict, project_manager, estimated_value, flooring_category, square_feet, contract_value, segment, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'residential' THEN 'residential' WHEN ? = 'commercial' THEN 'commercial' WHEN LOWER(TRIM(COALESCE(c.industry, ''))) = 'residential' THEN 'residential' ELSE 'commercial' END, ?, ?, ? FROM clients c WHERE c.id = ?")
          .bind(project.id, project.projectNumber, project.clientId, project.name, project.status, project.site, project.latitude ?? null, project.longitude ?? null, project.addressValidationVerdict ?? null, project.projectManagerId, project.estimatedValue, project.flooringCategory, project.squareFeet, project.contractValue, project.segment, project.segment, project.createdBy, project.createdAt, project.updatedAt, project.clientId),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND project_number = ? AND name = ? AND created_by = ? AND created_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, project.id, project.projectNumber, project.name, project.createdBy, project.createdAt),
      ]);
      return results[0]?.meta.changes === 1 ? { outcome: "created" } : { outcome: "client-not-found" };
    },

    async update(intent) {
      const expectedVersion = d1RecordVersion(intent.expectedVersion, "Expected D1 project version");
      const resultingVersion = nextD1RecordVersion(expectedVersion);
      const currentVersion = await currentProjectVersion(database, intent.projectId);
      if (!currentVersion) return { outcome: "project-not-found" };
      if (currentVersion !== expectedVersion) return { outcome: "conflict", currentVersion };
      const parent = await database
        .prepare("SELECT id FROM clients WHERE id = ?")
        .bind(intent.values.clientId)
        .first<{ id: string }>();
      if (!parent) return { outcome: "client-not-found" };
      const { activity, values } = intent;
      const results = await database.batch([
        database.prepare("UPDATE projects SET client_id = ?, name = ?, status = ?, site = ?, latitude = ?, longitude = ?, address_validation_verdict = ?, estimated_value = ?, flooring_category = ?, square_feet = ?, contract_value = ?, segment = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
          .bind(
            values.clientId,
            values.name,
            values.status,
            values.site,
            values.latitude,
            values.longitude,
            values.addressValidationVerdict,
            values.estimatedValue,
            values.flooringCategory,
            values.squareFeet,
            values.contractValue,
            values.segment,
            intent.updatedAt,
            intent.projectId,
            expectedVersion,
          ),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND version = ? AND updated_at = ?)")
          .bind(
            activity.id,
            activity.recordId,
            activity.action,
            activity.actor,
            activity.detail,
            activity.createdAt,
            intent.projectId,
            resultingVersion,
            intent.updatedAt,
          ),
      ]);
      if (results[0]?.meta.changes !== 1) {
        return projectUpdateFailure(database, intent.projectId);
      }
      const updated = await database
        .prepare(`${PROJECT_SELECT} WHERE id = ?`)
        .bind(intent.projectId)
        .first<D1ProjectRow>();
      if (!updated) throw new Error("D1 project update did not return the updated project");
      return { outcome: "updated", value: projectRow(updated) };
    },

    async assignManager(intent) {
      const readiness = await operationExpectedVersion(
        database,
        intent.projectId,
        intent.expectedVersion,
      );
      if (readiness.outcome !== "ready") return readiness;
      const resultingVersion = nextD1RecordVersion(readiness.expectedVersion);
      const { activity } = intent;
      const results = await database.batch([
        database.prepare("UPDATE projects SET project_manager = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
          .bind(intent.projectManagerId, intent.updatedAt, intent.projectId, readiness.expectedVersion),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND version = ? AND project_manager = ? AND updated_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, intent.projectId, resultingVersion, intent.projectManagerId, intent.updatedAt),
      ]);
      return results[0]?.meta.changes === 1
        ? { outcome: "updated" }
        : projectUpdateFailure(database, intent.projectId);
    },
    async recordInstallationDates(intent) {
      const readiness = await operationExpectedVersion(
        database,
        intent.projectId,
        intent.expectedVersion,
      );
      if (readiness.outcome !== "ready") return readiness;
      const resultingVersion = nextD1RecordVersion(readiness.expectedVersion);
      const { activity } = intent;
      const results = await database.batch([
        database.prepare("UPDATE projects SET installation_started_at = ?, installation_completed_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
          .bind(intent.installationStartedAt, intent.installationCompletedAt, intent.updatedAt, intent.projectId, readiness.expectedVersion),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND version = ? AND installation_started_at = ? AND installation_completed_at = ? AND updated_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, intent.projectId, resultingVersion, intent.installationStartedAt, intent.installationCompletedAt, intent.updatedAt),
      ]);
      return results[0]?.meta.changes === 1
        ? { outcome: "updated" }
        : projectUpdateFailure(database, intent.projectId);
    },
    async recordFollowUpResult(intent) {
      const readiness = await operationExpectedVersion(
        database,
        intent.projectId,
        intent.expectedVersion,
      );
      if (readiness.outcome !== "ready") return readiness;
      const resultingVersion = nextD1RecordVersion(readiness.expectedVersion);
      const { activity } = intent;
      const hadCallback = intent.hadCallback ? 1 : 0;
      const results = await database.batch([
        database.prepare("UPDATE projects SET had_callback = ?, callback_note = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
          .bind(hadCallback, intent.callbackNote, intent.updatedAt, intent.projectId, readiness.expectedVersion),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND version = ? AND had_callback = ? AND callback_note IS ? AND updated_at = ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt, intent.projectId, resultingVersion, hadCallback, intent.callbackNote, intent.updatedAt),
      ]);
      return results[0]?.meta.changes === 1
        ? { outcome: "updated" }
        : projectUpdateFailure(database, intent.projectId);
    },
  };
}
