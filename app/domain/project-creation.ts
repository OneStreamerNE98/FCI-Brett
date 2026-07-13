export const PROJECT_STATUSES = ["planning", "mobilizing", "installation", "closeout", "completed", "cancelled", "archived"] as const;

export type ProjectStatus = typeof PROJECT_STATUSES[number];

export type NormalizedProjectCreation = {
  clientId: string;
  name: string;
  status: ProjectStatus;
  site: string | null;
  projectManager: string | null;
  estimatedValue: number | null;
};

export type ProjectCreationValidation =
  | { ok: true; value: NormalizedProjectCreation }
  | { ok: false; message: string };

function invalidJsonDetails(): ProjectCreationValidation {
  return { ok: false, message: "Project details must be valid JSON." };
}

export function normalizeProjectCreation(input: unknown): ProjectCreationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalidJsonDetails();

  const record = input as Record<string, unknown>;
  for (const field of ["clientId", "name", "status", "site", "projectManager"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") return invalidJsonDetails();
  }
  if (record.estimatedValue !== undefined && typeof record.estimatedValue !== "number") return invalidJsonDetails();

  const clientId = record.clientId as string | undefined;
  const name = (record.name as string | undefined)?.trim();
  if (!clientId || !name) return { ok: false, message: "clientId and project name are required" };
  if (name.length > 180) return { ok: false, message: "project name is too long" };

  const status = ((record.status as string | undefined)?.trim().toLowerCase() || "planning") as ProjectStatus;
  if (!PROJECT_STATUSES.includes(status)) return { ok: false, message: "project status is invalid" };

  const estimatedValue = record.estimatedValue as number | undefined;
  if (estimatedValue !== undefined && (!Number.isSafeInteger(estimatedValue) || estimatedValue < 0)) {
    return { ok: false, message: "estimated value must be a non-negative whole number" };
  }

  return {
    ok: true,
    value: {
      clientId,
      name,
      status,
      site: (record.site as string | undefined)?.trim() || null,
      projectManager: (record.projectManager as string | undefined)?.trim() || null,
      estimatedValue: estimatedValue ?? null,
    },
  };
}
