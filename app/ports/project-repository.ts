import type { ProjectStatus } from "../domain/project-creation";

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

export type ProjectCreationRepositoryResult = { outcome: "created" } | { outcome: "client-not-found" };

export type ProjectManagerAssignmentIntent = {
  projectId: string;
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

export type ProjectManagerAssignmentRepositoryResult = { outcome: "updated" } | { outcome: "project-not-found" };

export interface ProjectRepository {
  create(intent: ProjectCreationIntent): Promise<ProjectCreationRepositoryResult>;
  assignManager(intent: ProjectManagerAssignmentIntent): Promise<ProjectManagerAssignmentRepositoryResult>;
}
