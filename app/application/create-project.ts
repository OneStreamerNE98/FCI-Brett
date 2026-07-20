import { normalizeProjectCreation, normalizeProjectManagerAssignment, normalizeProjectManagerId, PROJECT_MANAGER_IDENTITY_ERROR } from "../domain/project-creation";
import type { DirectoryMirror } from "../ports/directory-mirror";
import type { ProjectRepository } from "../ports/project-repository";
import { canCreate, CREATION_CAPABILITIES, type CreationAuthorizationContext } from "./creation-authorization";
import { mirrorAfterDurableCreate, queuedMirrorAfterDurableCreate } from "./mirror-after-create";

export type CreateProjectFailure = {
  ok: false;
  kind: "forbidden" | "invalid" | "project-manager-not-authorized" | "client-not-found" | "identifier-collision" | "idempotency-conflict" | "in-progress";
  message: string;
};

export type CreateProjectSuccess = {
  ok: true;
  value: {
    id: string;
    projectNumber: string;
    projectManagerId: string;
    createdAt: number;
    version?: string;
    sheetSync: Awaited<ReturnType<typeof mirrorAfterDurableCreate>>;
  };
};

export type CreateProjectResult = CreateProjectFailure | CreateProjectSuccess;

export type CreateProjectDependencies = {
  repository: Pick<ProjectRepository, "create">;
  directoryMirror: DirectoryMirror;
  resolveProjectManagerId: (candidateId: string) => string | null | Promise<string | null>;
  newId: () => string;
  now: () => number;
};

export type AssignProjectManagerResult =
  | { ok: false; kind: "forbidden" | "invalid" | "project-manager-not-authorized" | "project-not-found"; message: string }
  | { ok: true; value: { projectId: string; projectManagerId: string; updatedAt: number } };

export type AssignProjectManagerAuthorization = {
  actorId: string;
  canManageProjects: boolean;
};

export type AssignProjectManagerDependencies = {
  repository: Pick<ProjectRepository, "assignManager">;
  resolveProjectManagerId: (candidateId: string) => string | null | Promise<string | null>;
  newId: () => string;
  now: () => number;
};

export async function createProject(
  input: unknown,
  authorization: CreationAuthorizationContext,
  dependencies: CreateProjectDependencies,
): Promise<CreateProjectResult> {
  if (!canCreate(authorization, CREATION_CAPABILITIES.createProject)) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to create projects." };
  }

  const normalized = normalizeProjectCreation(input);
  if (!normalized.ok) return { ok: false, kind: "invalid", message: normalized.message };

  const managerCandidate = normalizeProjectManagerId(normalized.value.projectManagerId ?? authorization.actorId);
  if (!managerCandidate.ok) {
    return { ok: false, kind: "project-manager-not-authorized", message: PROJECT_MANAGER_IDENTITY_ERROR };
  }
  const resolvedManager = await dependencies.resolveProjectManagerId(managerCandidate.value);
  const projectManagerId = normalizeProjectManagerId(resolvedManager);
  if (!projectManagerId.ok || projectManagerId.value !== managerCandidate.value) {
    return { ok: false, kind: "project-manager-not-authorized", message: PROJECT_MANAGER_IDENTITY_ERROR };
  }

  const createdAt = dependencies.now();
  const id = dependencies.newId();
  const projectNumber = `CF-${new Date(createdAt).getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const activityId = dependencies.newId();
  const repositoryResult = await dependencies.repository.create({
    project: {
      id,
      projectNumber,
      clientId: normalized.value.clientId,
      name: normalized.value.name,
      status: normalized.value.status,
      site: normalized.value.site,
      projectManagerId: projectManagerId.value,
      estimatedValue: normalized.value.estimatedValue,
      flooringCategory: normalized.value.flooringCategory,
      squareFeet: normalized.value.squareFeet,
      contractValue: normalized.value.contractValue,
      createdBy: authorization.actorId,
      createdAt,
      updatedAt: createdAt,
    },
    activity: {
      id: activityId,
      recordId: id,
      action: "Project created",
      actor: authorization.actorId,
      detail: `${projectNumber} · ${normalized.value.name}`,
      createdAt,
    },
  });

  if (repositoryResult.outcome === "client-not-found") {
    return { ok: false, kind: "client-not-found", message: "client not found" };
  }
  if (repositoryResult.outcome === "identifier-collision") {
    return { ok: false, kind: "identifier-collision", message: "A project identifier collision occurred. Retry the request." };
  }
  if (repositoryResult.outcome === "idempotency-conflict") {
    return { ok: false, kind: "idempotency-conflict", message: "This request key was already used for different project details." };
  }
  if (repositoryResult.outcome === "in-progress") {
    return { ok: false, kind: "in-progress", message: "This project request is already being processed. Retry with the same request key." };
  }

  if (repositoryResult.outcome === "accepted") {
    return {
      ok: true,
      value: {
        id: repositoryResult.value.id,
        projectNumber: repositoryResult.value.projectNumber,
        projectManagerId: repositoryResult.value.projectManagerId,
        createdAt: repositoryResult.value.createdAt,
        version: repositoryResult.value.version,
        sheetSync: queuedMirrorAfterDurableCreate(),
      },
    };
  }

  const sheetSync = await mirrorAfterDurableCreate(dependencies.directoryMirror, {
    actorId: authorization.actorId,
    cause: "project-created",
    recordId: id,
  });
  return { ok: true, value: { id, projectNumber, projectManagerId: projectManagerId.value, createdAt, sheetSync } };
}

export async function assignProjectManager(
  input: unknown,
  authorization: AssignProjectManagerAuthorization,
  dependencies: AssignProjectManagerDependencies,
): Promise<AssignProjectManagerResult> {
  if (!authorization.canManageProjects || !authorization.actorId.trim()) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to change project managers." };
  }
  const normalized = normalizeProjectManagerAssignment(input);
  if (!normalized.ok) return { ok: false, kind: "invalid", message: normalized.message };

  const resolvedManager = await dependencies.resolveProjectManagerId(normalized.value.projectManagerId);
  const projectManagerId = normalizeProjectManagerId(resolvedManager);
  if (!projectManagerId.ok || projectManagerId.value !== normalized.value.projectManagerId) {
    return { ok: false, kind: "project-manager-not-authorized", message: PROJECT_MANAGER_IDENTITY_ERROR };
  }

  const updatedAt = dependencies.now();
  const repositoryResult = await dependencies.repository.assignManager({
    projectId: normalized.value.projectId,
    projectManagerId: projectManagerId.value,
    updatedAt,
    activity: {
      id: dependencies.newId(),
      recordId: normalized.value.projectId,
      action: "Project manager assigned",
      actor: authorization.actorId,
      detail: `Project manager assigned to ${projectManagerId.value}`,
      createdAt: updatedAt,
    },
  });
  if (repositoryResult.outcome === "project-not-found") {
    return { ok: false, kind: "project-not-found", message: "project not found" };
  }
  return {
    ok: true,
    value: { projectId: normalized.value.projectId, projectManagerId: projectManagerId.value, updatedAt },
  };
}
