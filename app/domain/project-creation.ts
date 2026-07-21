export const PROJECT_STATUSES = ["planning", "mobilizing", "installation", "closeout", "completed", "cancelled", "archived"] as const;
export const FLOORING_CATEGORIES = ["hardwood", "carpet", "luxury-vinyl", "tile-stone", "laminate", "specialty", "mixed"] as const;

export const PROJECT_MANAGER_IDENTITY_ERROR = "project manager must be an authorized office email";

export type ProjectStatus = typeof PROJECT_STATUSES[number];
export type FlooringCategory = typeof FLOORING_CATEGORIES[number];

export type NormalizedProjectCreation = {
  clientId: string;
  name: string;
  status: ProjectStatus;
  site: string | null;
  projectManagerId: string | null;
  estimatedValue: number | null;
  flooringCategory: FlooringCategory | null;
  squareFeet: number | null;
  contractValue: number | null;
};

export type ProjectManagerIdValidation =
  | { ok: true; value: string }
  | { ok: false; message: typeof PROJECT_MANAGER_IDENTITY_ERROR };

export type NormalizedProjectManagerAssignment = {
  projectId: string;
  projectManagerId: string;
};

export type ProjectManagerAssignmentValidation =
  | { ok: true; value: NormalizedProjectManagerAssignment }
  | { ok: false; message: string };

export type ProjectCreationValidation =
  | { ok: true; value: NormalizedProjectCreation }
  | { ok: false; message: string };

function invalidJsonDetails(): ProjectCreationValidation {
  return { ok: false, message: "Project details must be valid JSON." };
}

/**
 * Office email is the development environment's stable staff identifier. Display names are not
 * accepted here because the current office allowlist cannot resolve a name to
 * one unambiguous account.
 */
export function normalizeProjectManagerId(input: unknown): ProjectManagerIdValidation {
  if (typeof input !== "string") return { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR };
  const value = input.trim().toLowerCase();
  if (!value || value.length > 254 || /[\s\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR };
  }

  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR };
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR };
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
    return { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR };
  }

  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR };
  }
  return { ok: true, value };
}

export function normalizeProjectManagerAssignment(input: unknown): ProjectManagerAssignmentValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Project manager correction must be valid JSON." };
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "projectId" && key !== "projectManagerId")) {
    return { ok: false, message: "Only projectId and projectManagerId can be changed here." };
  }
  if (typeof record.projectId !== "string" || typeof record.projectManagerId !== "string") {
    return { ok: false, message: "projectId and projectManagerId are required" };
  }
  const projectId = record.projectId.trim();
  if (!projectId || projectId.length > 128 || /[\s\u0000-\u001f\u007f]/.test(projectId)) {
    return { ok: false, message: "projectId is invalid" };
  }
  const projectManagerId = normalizeProjectManagerId(record.projectManagerId);
  if (!projectManagerId.ok) return projectManagerId;
  return { ok: true, value: { projectId, projectManagerId: projectManagerId.value } };
}

export function normalizeProjectCreation(input: unknown): ProjectCreationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalidJsonDetails();

  const record = input as Record<string, unknown>;
  for (const field of ["clientId", "name", "status", "site", "projectManager", "projectManagerId"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") return invalidJsonDetails();
  }
  if (record.flooringCategory !== undefined && record.flooringCategory !== null && typeof record.flooringCategory !== "string") return invalidJsonDetails();
  for (const field of ["estimatedValue", "squareFeet", "contractValue"] as const) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== "number") return invalidJsonDetails();
  }

  const clientId = record.clientId as string | undefined;
  const name = (record.name as string | undefined)?.trim();
  if (!clientId || !name) return { ok: false, message: "clientId and project name are required" };
  if (name.length > 180) return { ok: false, message: "project name is too long" };

  const status = ((record.status as string | undefined)?.trim().toLowerCase() || "planning") as ProjectStatus;
  if (!PROJECT_STATUSES.includes(status)) return { ok: false, message: "project status is invalid" };

  const estimatedValue = record.estimatedValue as number | null | undefined;
  if (estimatedValue !== undefined && estimatedValue !== null && (!Number.isSafeInteger(estimatedValue) || estimatedValue < 0)) {
    return { ok: false, message: "estimated value must be a non-negative whole number" };
  }

  const flooringCategoryValue = (record.flooringCategory as string | undefined)?.trim().toLowerCase() || null;
  const flooringCategory = flooringCategoryValue as FlooringCategory | null;
  if (flooringCategory !== null && !FLOORING_CATEGORIES.includes(flooringCategory)) {
    return { ok: false, message: "flooring category is invalid" };
  }

  const squareFeet = record.squareFeet as number | null | undefined;
  if (squareFeet !== undefined && squareFeet !== null && (!Number.isSafeInteger(squareFeet) || squareFeet <= 0)) {
    return { ok: false, message: "square feet must be a positive whole number" };
  }

  const contractValue = record.contractValue as number | null | undefined;
  if (contractValue !== undefined && contractValue !== null && (!Number.isSafeInteger(contractValue) || contractValue < 0)) {
    return { ok: false, message: "contract value must be a non-negative whole number" };
  }

  const managerCandidates = [record.projectManagerId, record.projectManager]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const normalizedManagers = managerCandidates.map(normalizeProjectManagerId);
  const invalidManager = normalizedManagers.find((result) => !result.ok);
  if (invalidManager) return invalidManager;
  const managerIds = [...new Set(normalizedManagers.map((result) => result.ok ? result.value : ""))];
  if (managerIds.length > 1) return { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR };

  return {
    ok: true,
    value: {
      clientId,
      name,
      status,
      site: (record.site as string | undefined)?.trim() || null,
      projectManagerId: managerIds[0] ?? null,
      estimatedValue: estimatedValue ?? null,
      flooringCategory,
      squareFeet: squareFeet ?? null,
      contractValue: contractValue ?? null,
    },
  };
}
