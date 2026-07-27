import type { ProjectStatus } from "../domain/project-creation";
import type { FlooringCategory } from "../domain/project-creation";
import type { VersionConflict } from "../domain/record-version";
import type { ProjectSegment } from "../domain/project-segment";

export type ProjectCreationIntent = {
  project: {
    id: string;
    projectNumber: string;
    clientId: string;
    name: string;
    status: ProjectStatus;
    site: string | null;
    projectManagerId: string;
    estimatedValue: number | null;
    flooringCategory: string | null;
    squareFeet: number | null;
    contractValue: number | null;
    segment: ProjectSegment | null;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
  };
  activity: {
    id: string;
    recordId: string;
    action: "Project created";
    actor: string;
    detail: string;
    createdAt: number;
  };
};

export type AcceptedProjectCreation = {
  id: string;
  projectNumber: string;
  projectManagerId: string;
  createdAt: number;
  estimatedValue: number | null;
  /** PostgreSQL bigint values stay strings so callers cannot lose precision. */
  version: string;
};

export type ProjectCreationRepositoryResult =
  | { outcome: "created" }
  | { outcome: "accepted"; value: AcceptedProjectCreation; replayed: boolean }
  | { outcome: "client-not-found" }
  | { outcome: "identifier-collision" }
  | { outcome: "idempotency-conflict" }
  | { outcome: "in-progress" };

export type ProjectManagerAssignmentIntent = {
  projectId: string;
  expectedVersion?: string;
  projectManagerId: string;
  updatedAt: number;
  activity: {
    id: string;
    recordId: string;
    action: "Project manager assigned";
    actor: string;
    detail: string;
    createdAt: number;
  };
};

export type ProjectManagerAssignmentRepositoryResult =
  | { outcome: "updated" }
  | { outcome: "project-not-found" }
  | VersionConflict;

type ProjectOperationActivity = {
  id: string;
  recordId: string;
  actor: string;
  detail: string;
  createdAt: number;
};

export type ProjectInstallationDatesIntent = {
  projectId: string;
  expectedVersion?: string;
  installationStartedAt: number;
  installationCompletedAt: number;
  updatedAt: number;
  activity: ProjectOperationActivity & { action: "Installation dates recorded" };
};

export type ProjectFollowUpResultIntent = {
  projectId: string;
  expectedVersion?: string;
  hadCallback: boolean;
  callbackNote: string | null;
  updatedAt: number;
  activity: ProjectOperationActivity & { action: "Follow-up result recorded" };
};

export type ProjectOperationRepositoryResult =
  | { outcome: "updated" }
  | { outcome: "project-not-found" }
  | VersionConflict;

export type ProjectRow = {
  id: string;
  projectNumber: string;
  clientId: string;
  name: string;
  status: ProjectStatus;
  site: string | null;
  projectManagerId: string | null;
  estimatedValue: number | null;
  flooringCategory: FlooringCategory | null;
  squareFeet: number | null;
  contractValue: number | null;
  segment: ProjectSegment | null;
  updatedAt: number;
  version: string;
};

export type ProjectFieldUpdateIntent = {
  projectId: string;
  expectedVersion: string;
  values: Pick<
    ProjectRow,
    | "clientId"
    | "name"
    | "status"
    | "site"
    | "estimatedValue"
    | "flooringCategory"
    | "squareFeet"
    | "contractValue"
    | "segment"
  >;
  updatedAt: number;
  updatedBy: string;
  activity: ProjectOperationActivity & { action: "Project fields updated" };
};

export type ProjectFieldUpdateRepositoryResult =
  | { outcome: "updated"; value: ProjectRow }
  | { outcome: "project-not-found" }
  | { outcome: "client-not-found" }
  | VersionConflict;

export interface ProjectRepository {
  findById(projectId: string): Promise<ProjectRow | null>;
  create(intent: ProjectCreationIntent): Promise<ProjectCreationRepositoryResult>;
  update(intent: ProjectFieldUpdateIntent): Promise<ProjectFieldUpdateRepositoryResult>;
  assignManager(intent: ProjectManagerAssignmentIntent): Promise<ProjectManagerAssignmentRepositoryResult>;
}

export interface ProjectOperationsRepository {
  findById(projectId: string): Promise<ProjectRow | null>;
  recordInstallationDates(intent: ProjectInstallationDatesIntent): Promise<ProjectOperationRepositoryResult>;
  recordFollowUpResult(intent: ProjectFollowUpResultIntent): Promise<ProjectOperationRepositoryResult>;
}
