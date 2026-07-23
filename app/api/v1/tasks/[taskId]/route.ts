import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1TaskRepository } from "../../../../adapters/d1/task-repository";
import { updateTask } from "../../../../application/task-operations";
import { AUTHORIZATION_CAPABILITIES } from "../../../../application/authorization-capabilities";
import { creationAuthorizationFor } from "../../../../application/creation-authorization";
import { MAX_TASK_BODY_BYTES } from "../../../../domain/task";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../../lib/development-request-rate-limit";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

type RouteContext = { params: Promise<{ taskId: string }> };

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("tasks", auth.user.email);
  if (rateLimitResponse) return rateLimitResponse;
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_TASK_BODY_BYTES,
    invalidMessage: "Task update must be valid JSON.",
    tooLargeMessage: "Task update is too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { taskId } = await context.params;
  await ensureWorkspaceSchema();
  const result = await updateTask(
    taskId,
    parsed.body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.tasksUpdate],
    }),
    {
      repository: createD1TaskRepository(env.DB as unknown as D1Database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  if (!result.ok) {
    const status = result.kind === "forbidden"
      ? 403
      : (
          result.kind === "task-not-found"
          || result.kind === "project-not-found"
          || result.kind === "lead-not-found"
        )
        ? 404
        : 400;
    return json({ error: result.message }, status);
  }
  return json({ task: result.value });
}
