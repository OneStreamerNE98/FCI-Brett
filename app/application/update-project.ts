import {
  PROJECT_ADMIN_EDIT_KEYS,
  PROJECT_PATCH_KEYS,
  normalizeProjectPatch,
  type ProjectPatchKey,
  type ValidatedProjectPatch,
} from "../domain/project-patch.ts";
import type {
  ProjectFieldUpdateIntent,
  ProjectRepository,
  ProjectRow,
} from "../ports/project-repository.ts";
import { normalizeProjectManagerId } from "../domain/project-creation.ts";
import { officeIdentityForEmail } from "../lib/workspace-auth.ts";

export const MAX_PROJECT_PATCH_BODY_BYTES = 64_000;

export type UpdateProjectAuthorization = Readonly<{
  actorId: string;
  isAdmin: boolean;
}>;

export type UpdateProjectDependencies = Readonly<{
  repository: Pick<ProjectRepository, "findById" | "update">;
  newId: () => string;
  now: () => number;
}>;

export type UpdateProjectResult =
  | { ok: true; value: ProjectRow }
  | {
      ok: false;
      kind: "invalid" | "forbidden" | "project-not-found" | "client-not-found";
      message: string;
    }
  | {
      ok: false;
      kind: "conflict";
      message: string;
      currentVersion: string;
      currentValues: ProjectConflictValues;
    };

export type ProjectConflictValues = Partial<
  Pick<ProjectFieldUpdateIntent["values"], ProjectPatchKey>
>;

const PROJECT_FIELD_LABELS = {
  name: "Name",
  status: "Status",
  site: "Site",
  clientId: "Client",
  estimatedValue: "Estimated value",
  flooringCategory: "Flooring category",
  squareFeet: "Square feet",
  contractValue: "Contract value",
  segment: "Segment",
} as const satisfies Record<ProjectPatchKey, string>;

function isAdminOnlyPatch(patch: ValidatedProjectPatch) {
  return PROJECT_ADMIN_EDIT_KEYS.find((key) => Object.hasOwn(patch, key));
}

function displayProjectField(key: ProjectPatchKey, value: unknown) {
  if (value === null || value === "") return "Not set";
  return String(value);
}

function displayProjectChange(key: ProjectPatchKey, before: unknown, after: unknown) {
  if (key !== "contractValue") {
    return `${displayProjectField(key, before)} → ${displayProjectField(key, after)}`;
  }
  if (before === null) return "Not set → Set";
  if (after === null) return "Set → Not set";
  return "Set → Updated";
}

function projectValues(row: ProjectRow): ProjectFieldUpdateIntent["values"] {
  return {
    clientId: row.clientId,
    name: row.name,
    status: row.status,
    site: row.site,
    estimatedValue: row.estimatedValue,
    flooringCategory: row.flooringCategory,
    squareFeet: row.squareFeet,
    contractValue: row.contractValue,
    segment: row.segment,
  };
}

function projectConflictValues(
  row: ProjectRow,
  patch: ValidatedProjectPatch,
): ProjectConflictValues {
  const values = projectValues(row);
  return Object.fromEntries(
    PROJECT_PATCH_KEYS.flatMap((key) =>
      Object.hasOwn(patch, key) ? [[key, values[key]]] : []
    ),
  ) as ProjectConflictValues;
}

function projectConflict(
  row: ProjectRow,
  patch: ValidatedProjectPatch,
): Extract<UpdateProjectResult, { ok: false; kind: "conflict" }> {
  return {
    ok: false,
    kind: "conflict",
    message: "Project changed since it was loaded.",
    currentVersion: row.version,
    currentValues: projectConflictValues(row, patch),
  };
}

function mergeProjectPatch(
  current: ProjectFieldUpdateIntent["values"],
  patch: ValidatedProjectPatch,
): ProjectFieldUpdateIntent["values"] {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      Object.hasOwn(patch, key) ? patch[key as ProjectPatchKey] : value,
    ]),
  ) as ProjectFieldUpdateIntent["values"];
}

function unauthorizedMessage(key: typeof PROJECT_ADMIN_EDIT_KEYS[number]) {
  if (key === "status") return "An FCI administrator must update project status.";
  if (key === "estimatedValue") {
    return "An FCI administrator must update project estimated value.";
  }
  return "An FCI administrator must update project contract value.";
}

export async function updateProject(
  projectId: string,
  input: unknown,
  authorization: UpdateProjectAuthorization,
  dependencies: UpdateProjectDependencies,
): Promise<UpdateProjectResult> {
  if (!authorization.actorId.trim()) {
    return {
      ok: false,
      kind: "forbidden",
      message: "You do not have permission to update projects.",
    };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
    return { ok: false, kind: "invalid", message: "Project identifier is invalid." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: "invalid", message: "Project update must be valid JSON." };
  }
  const normalized = normalizeProjectPatch(input as Record<string, unknown>);
  if (!normalized.ok) {
    return { ok: false, kind: "invalid", message: normalized.message };
  }
  const adminOnlyKey = isAdminOnlyPatch(normalized.value);
  if (adminOnlyKey && !authorization.isAdmin) {
    return {
      ok: false,
      kind: "forbidden",
      message: unauthorizedMessage(adminOnlyKey),
    };
  }

  const current = await dependencies.repository.findById(projectId);
  if (!current) {
    return { ok: false, kind: "project-not-found", message: "Project not found." };
  }
  if (normalized.value.version !== current.version) {
    return projectConflict(current, normalized.value);
  }

  const currentValues = projectValues(current);
  const values = mergeProjectPatch(currentValues, normalized.value);
  const changes = PROJECT_PATCH_KEYS.flatMap((key) => {
    if (!Object.hasOwn(normalized.value, key) || currentValues[key] === values[key]) return [];
    return [
      `${PROJECT_FIELD_LABELS[key]}: ${displayProjectChange(key, currentValues[key], values[key])}`,
    ];
  });
  if (changes.length === 0) return { ok: true, value: current };

  const updatedAt = dependencies.now();
  const result = await dependencies.repository.update({
    projectId,
    expectedVersion: normalized.value.version,
    values,
    updatedAt,
    updatedBy: authorization.actorId,
    activity: {
      id: dependencies.newId(),
      recordId: projectId,
      action: "Project fields updated",
      actor: authorization.actorId,
      detail: changes.join("; "),
      createdAt: updatedAt,
    },
  });
  if (result.outcome === "project-not-found") {
    return { ok: false, kind: result.outcome, message: "Project not found." };
  }
  if (result.outcome === "client-not-found") {
    return { ok: false, kind: result.outcome, message: "Client not found." };
  }
  if (result.outcome === "conflict") {
    const latest = await dependencies.repository.findById(projectId);
    if (!latest) {
      return { ok: false, kind: "project-not-found", message: "Project not found." };
    }
    return projectConflict(latest, normalized.value);
  }
  return { ok: true, value: result.value };
}

export function projectUpdateResponse(row: ProjectRow, isAdmin: boolean, actorEmail: string) {
  return {
    id: row.id,
    projectNumber: row.projectNumber,
    clientId: row.clientId,
    name: row.name,
    status: row.status,
    site: row.site,
    // Same disclosure guarantee as the collection GET (projects/route.ts
    // authorizedProjectManagerId): a manager email is returned only when it is the
    // requesting actor or a current office identity — an offboarded manager's email
    // must not resurface through the mutation response (review finding, PR #228).
    projectManagerId: authorizedResponseProjectManagerId(row.projectManagerId, actorEmail),
    estimatedValue: row.estimatedValue,
    flooringCategory: row.flooringCategory,
    squareFeet: row.squareFeet,
    contractValue: isAdmin ? row.contractValue : null,
    segment: row.segment,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function authorizedResponseProjectManagerId(candidate: unknown, actorEmail: string) {
  const normalized = normalizeProjectManagerId(candidate);
  if (!normalized.ok) return null;
  if (normalized.value === actorEmail) return normalized.value;
  return officeIdentityForEmail(normalized.value)?.email ?? null;
}
