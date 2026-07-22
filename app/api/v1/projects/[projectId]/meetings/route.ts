import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../../adapters/d1/d1-database";
import { createD1ProjectMeetingRepository } from "../../../../../adapters/d1/project-meeting-repository";
import {
  createProjectMeeting,
  listProjectMeetings,
} from "../../../../../application/project-meeting-operations";
import { creationAuthorizationFor } from "../../../../../application/creation-authorization";
import { AUTHORIZATION_CAPABILITIES } from "../../../../../application/authorization-capabilities";
import { ensureWorkspaceSchema } from "../../../_workspace-data";
import { parseBoundedJsonObject } from "../../../../../lib/api-json-body";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { projectId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) return NextResponse.json({ error: "Invalid project." }, { status: 400 });
  await ensureWorkspaceSchema();
  const repository = createD1ProjectMeetingRepository(env.DB as unknown as D1Database);
  const result = await listProjectMeetings(
    projectId,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.recordsRead],
    }),
    repository,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.kind === "project-not-found" ? 404 : 403 },
    );
  }
  return NextResponse.json({ meetings: result.value }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { projectId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) return NextResponse.json({ error: "Invalid project." }, { status: 400 });

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: 180_000,
    invalidMessage: "Meeting details must be valid JSON.",
    tooLargeMessage: "Meeting notes are too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  await ensureWorkspaceSchema();
  const result = await createProjectMeeting(
    projectId,
    parsed.body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.meetingsUpdate],
    }),
    {
      repository: createD1ProjectMeetingRepository(env.DB as unknown as D1Database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  if (!result.ok) {
    const status = result.kind === "forbidden"
      ? 403
      : result.kind === "project-not-found"
        ? 404
        : result.kind === "invalid"
          ? 400
          : 409;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json({ meeting: result.value }, { status: 201 });
}
