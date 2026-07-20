import type { ProjectMeetingRow } from "../domain/project-meeting";

export type ProjectMeetingParent = {
  id: string;
  projectNumber: string | null;
};

export type ProjectMeetingActivityIntent = {
  id: string;
  recordId: string;
  action: "Meeting notes captured";
  actor: string;
  detail: string;
  createdAt: number;
};

export type ProjectMeetingCreationIntent = {
  meeting: ProjectMeetingRow;
  activity: ProjectMeetingActivityIntent;
};

export type AcceptedProjectMeetingCreation = {
  row: ProjectMeetingRow;
  /** PostgreSQL bigint values stay strings so callers cannot lose precision. */
  version: string;
};

export type ProjectMeetingCreationRepositoryResult =
  | { outcome: "created"; value: ProjectMeetingRow }
  | { outcome: "accepted"; value: AcceptedProjectMeetingCreation; replayed: boolean }
  | { outcome: "project-not-found" }
  | { outcome: "identifier-collision" }
  | { outcome: "idempotency-conflict" }
  | { outcome: "in-progress" };

export interface ProjectMeetingRepository {
  /** Keeps the GET route's existing `SELECT id` lookup byte-for-byte. */
  projectExists(projectId: string): Promise<boolean>;
  /** Keeps the POST route's existing project-number lookup byte-for-byte. */
  findProjectForCreation(projectId: string): Promise<ProjectMeetingParent | null>;
  listForProject(projectId: string): Promise<ProjectMeetingRow[]>;
  create(intent: ProjectMeetingCreationIntent): Promise<ProjectMeetingCreationRepositoryResult>;
}
