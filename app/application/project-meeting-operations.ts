import {
  normalizeProjectMeeting,
  projectMeetingResponse,
  type ProjectMeetingRow,
} from "../domain/project-meeting";
import type { ProjectMeetingRepository } from "../ports/project-meeting-repository";
import { AUTHORIZATION_CAPABILITIES } from "./authorization-capabilities";
import {
  canCreate,
  CREATION_CAPABILITIES,
  type CreationAuthorizationContext,
} from "./creation-authorization";

export type ListProjectMeetingsResult =
  | { ok: false; kind: "forbidden" | "project-not-found"; message: string }
  | { ok: true; value: ReturnType<typeof projectMeetingResponse>[] };

export type CreateProjectMeetingResult =
  | {
      ok: false;
      kind: "forbidden" | "invalid" | "project-not-found" | "identifier-collision" | "idempotency-conflict" | "in-progress";
      message: string;
    }
  | {
      ok: true;
      value: ReturnType<typeof projectMeetingResponse> & { version?: string };
    };

export async function listProjectMeetings(
  projectId: string,
  authorization: CreationAuthorizationContext,
  repository: Pick<ProjectMeetingRepository, "projectExists" | "listForProject">,
): Promise<ListProjectMeetingsResult> {
  if (!authorization.actorId || !authorization.capabilities.has(AUTHORIZATION_CAPABILITIES.recordsRead)) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to view project meetings." };
  }
  if (!await repository.projectExists(projectId)) {
    return { ok: false, kind: "project-not-found", message: "Project not found." };
  }
  return {
    ok: true,
    value: (await repository.listForProject(projectId)).map(projectMeetingResponse),
  };
}

export async function createProjectMeeting(
  projectId: string,
  input: unknown,
  authorization: CreationAuthorizationContext,
  dependencies: {
    repository: Pick<ProjectMeetingRepository, "findProjectForCreation" | "create">;
    newId: () => string;
    now: () => number;
  },
): Promise<CreateProjectMeetingResult> {
  if (!canCreate(authorization, CREATION_CAPABILITIES.createProjectMeeting)) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to add project meetings." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: "invalid", message: "Meeting details must be valid JSON." };
  }
  const validation = normalizeProjectMeeting(input as Record<string, unknown>);
  if (!validation.ok) return { ok: false, kind: "invalid", message: validation.message };
  const project = await dependencies.repository.findProjectForCreation(projectId);
  if (!project) return { ok: false, kind: "project-not-found", message: "Project not found." };

  const values = validation.value;
  const id = dependencies.newId();
  const createdAt = dependencies.now();
  const meeting: ProjectMeetingRow = {
    id,
    project_id: projectId,
    title: values.title,
    meeting_at: values.meetingAt,
    meeting_type: values.meetingType,
    source_provider: values.sourceProvider,
    source_url: values.sourceUrl,
    attendees_json: JSON.stringify(values.attendees),
    notes: values.notes,
    transcript: values.transcript,
    summary: values.summary,
    decisions: values.decisions,
    action_items_json: JSON.stringify(values.actionItems),
    created_by: authorization.actorId,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const result = await dependencies.repository.create({
    meeting,
    activity: {
      id: dependencies.newId(),
      recordId: projectId,
      action: "Meeting notes captured",
      actor: authorization.actorId,
      detail: `${values.title} · ${values.sourceProvider === "otter" ? "Otter" : values.sourceProvider === "link" ? "Linked source" : "Manual notes"}`,
      createdAt,
    },
  });

  if (result.outcome === "project-not-found") {
    return { ok: false, kind: result.outcome, message: "Project not found." };
  }
  if (result.outcome === "identifier-collision") {
    return { ok: false, kind: result.outcome, message: "A meeting identifier collision occurred. Retry the request." };
  }
  if (result.outcome === "idempotency-conflict") {
    return { ok: false, kind: result.outcome, message: "This request key was already used for different meeting details." };
  }
  if (result.outcome === "in-progress") {
    return { ok: false, kind: result.outcome, message: "This meeting request is already being processed. Retry with the same request key." };
  }
  if (result.outcome === "accepted") {
    return {
      ok: true,
      value: { ...projectMeetingResponse(result.value.row), version: result.value.version },
    };
  }
  return { ok: true, value: projectMeetingResponse(result.value) };
}
