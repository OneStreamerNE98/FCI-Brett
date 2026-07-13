import type { ProjectStatus } from "../domain/project-creation";

export type ProjectCreationIntent = {
  project: {
    id: string;
    projectNumber: string;
    clientId: string;
    name: string;
    status: ProjectStatus;
    site: string | null;
    projectManager: string | null;
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

export interface ProjectRepository {
  create(intent: ProjectCreationIntent): Promise<ProjectCreationRepositoryResult>;
}
