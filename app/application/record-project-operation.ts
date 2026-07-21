import { FLOORING_OPERATIONS_TIME_ZONE, normalizeProjectOperation } from "../domain/project-operations";
import type { ProjectOperationsRepository } from "../ports/project-repository";

const activityDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: FLOORING_OPERATIONS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function activityDate(timestamp: number) {
  const parts = activityDateFormatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export type RecordProjectOperationAuthorization = {
  actorId: string;
  canManageProjects: boolean;
};

export type RecordProjectOperationDependencies = {
  repository: ProjectOperationsRepository;
  newId: () => string;
  now: () => number;
};

export type RecordProjectOperationResult =
  | { ok: false; kind: "forbidden" | "invalid" | "project-not-found"; message: string }
  | {
      ok: true;
      value:
        | { action: "record-installation-dates"; projectId: string; installationStartedAt: number; installationCompletedAt: number; updatedAt: number }
        | { action: "record-follow-up-result"; projectId: string; hadCallback: boolean; callbackNote: string | null; updatedAt: number };
    };

export async function recordProjectOperation(
  input: unknown,
  authorization: RecordProjectOperationAuthorization,
  dependencies: RecordProjectOperationDependencies,
): Promise<RecordProjectOperationResult> {
  if (!authorization.canManageProjects || !authorization.actorId.trim()) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to record project operations." };
  }

  const normalized = normalizeProjectOperation(input);
  if (!normalized.ok) return { ok: false, kind: "invalid", message: normalized.message };

  const updatedAt = dependencies.now();
  if (normalized.value.action === "record-installation-dates") {
    const result = await dependencies.repository.recordInstallationDates({
      projectId: normalized.value.projectId,
      installationStartedAt: normalized.value.installationStartedAt,
      installationCompletedAt: normalized.value.installationCompletedAt,
      updatedAt,
      activity: {
        id: dependencies.newId(),
        recordId: normalized.value.projectId,
        action: "Installation dates recorded",
        actor: authorization.actorId,
        detail: `Installation recorded from ${activityDate(normalized.value.installationStartedAt)} to ${activityDate(normalized.value.installationCompletedAt)}`,
        createdAt: updatedAt,
      },
    });
    if (result.outcome === "project-not-found") {
      return { ok: false, kind: "project-not-found", message: "project not found" };
    }
    return { ok: true, value: { ...normalized.value, updatedAt } };
  }

  const result = await dependencies.repository.recordFollowUpResult({
    projectId: normalized.value.projectId,
    hadCallback: normalized.value.hadCallback,
    callbackNote: normalized.value.callbackNote,
    updatedAt,
    activity: {
      id: dependencies.newId(),
      recordId: normalized.value.projectId,
      action: "Follow-up result recorded",
      actor: authorization.actorId,
      detail: `Post-installation callback: ${normalized.value.hadCallback ? "Yes" : "No"}${normalized.value.callbackNote ? " · Note recorded" : ""}`,
      createdAt: updatedAt,
    },
  });
  if (result.outcome === "project-not-found") {
    return { ok: false, kind: "project-not-found", message: "project not found" };
  }
  return { ok: true, value: { ...normalized.value, updatedAt } };
}
