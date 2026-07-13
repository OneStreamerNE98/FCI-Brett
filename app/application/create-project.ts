import { normalizeProjectCreation } from "../domain/project-creation";
import type { DirectoryMirror } from "../ports/directory-mirror";
import type { ProjectRepository } from "../ports/project-repository";
import { canCreate, CREATION_CAPABILITIES, type CreationAuthorizationContext } from "./creation-authorization";
import { mirrorAfterDurableCreate } from "./mirror-after-create";

export type CreateProjectFailure = {
  ok: false;
  kind: "forbidden" | "invalid" | "client-not-found";
  message: string;
};

export type CreateProjectSuccess = {
  ok: true;
  value: {
    id: string;
    projectNumber: string;
    createdAt: number;
    sheetSync: Awaited<ReturnType<typeof mirrorAfterDurableCreate>>;
  };
};

export type CreateProjectResult = CreateProjectFailure | CreateProjectSuccess;

export type CreateProjectDependencies = {
  repository: ProjectRepository;
  directoryMirror: DirectoryMirror;
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
      projectManager: normalized.value.projectManager,
      estimatedValue: normalized.value.estimatedValue,
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

  const sheetSync = await mirrorAfterDurableCreate(dependencies.directoryMirror, {
    actorId: authorization.actorId,
    cause: "project-created",
    recordId: id,
  });
  return { ok: true, value: { id, projectNumber, createdAt, sheetSync } };
}
