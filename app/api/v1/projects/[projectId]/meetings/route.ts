import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../../adapters/d1/d1-database";
import { createD1ProjectMeetingRepository } from "../../../../../adapters/d1/project-meeting-repository";
import {
  normalizeProjectMeeting,
  projectMeetingResponse,
} from "../../../../../domain/project-meeting";
import { ensureWorkspaceSchema } from "../../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { projectId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) return NextResponse.json({ error: "Invalid project." }, { status: 400 });
  await ensureWorkspaceSchema();
  const repository = createD1ProjectMeetingRepository(env.DB as unknown as D1Database);
  if (!await repository.projectExists(projectId)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const meetings = await repository.listForProject(projectId);
  return NextResponse.json({ meetings: meetings.map(projectMeetingResponse) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { projectId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) return NextResponse.json({ error: "Invalid project." }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 180_000) return NextResponse.json({ error: "Meeting notes are too large." }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 180_000) return NextResponse.json({ error: "Meeting notes are too large." }, { status: 413 });
  const body = (() => { try { return JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; } })();
  if (!body) return NextResponse.json({ error: "Meeting details must be valid JSON." }, { status: 400 });
  const validation = normalizeProjectMeeting(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }
  const values = validation.value;

  await ensureWorkspaceSchema();
  const repository = createD1ProjectMeetingRepository(env.DB as unknown as D1Database);
  const project = await repository.findProjectForCreation(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const result = await repository.create({
    meeting: {
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
      created_by: auth.user.email,
      created_at: now,
      updated_at: now,
    },
    activity: {
      id: crypto.randomUUID(),
      recordId: projectId,
      action: "Meeting notes captured",
      actor: auth.user.email,
      detail: `${values.title} · ${values.sourceProvider === "otter" ? "Otter" : values.sourceProvider === "link" ? "Linked source" : "Manual notes"}`,
      createdAt: now,
    },
  });
  if (result.outcome !== "created") {
    throw new Error(`D1 meeting creation returned unexpected outcome ${result.outcome}`);
  }
  return NextResponse.json({ meeting: projectMeetingResponse(result.value) }, { status: 201 });
}
