import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1TaskRepository } from "../../../../adapters/d1/task-repository";
import { updateTask } from "../../../../application/task-operations";
import { AUTHORIZATION_CAPABILITIES } from "../../../../application/authorization-capabilities";
import { creationAuthorizationFor } from "../../../../application/creation-authorization";
import { MAX_TASK_BODY_BYTES, taskResponse } from "../../../../domain/task";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../../lib/development-request-rate-limit";
import { noStoreJson as json, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  const { taskId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) {
    return json({ error: "Task identifier is invalid." }, 400);
  }
  await ensureWorkspaceSchema();
  const task = await createD1TaskRepository(
    env.DB as unknown as D1Database,
  ).findById(taskId);
  if (!task) return json({ error: "Task not found." }, 404);
  return json({ task: taskResponse(task) });
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
      : result.kind === "conflict"
        ? 409
      : (
          result.kind === "task-not-found"
          || result.kind === "project-not-found"
          || result.kind === "lead-not-found"
        )
        ? 404
        : 400;
    return json(
      result.kind === "conflict"
        ? { error: result.message, currentVersion: result.currentVersion }
        : { error: result.message },
      status,
    );
  }
  return json({ task: result.value });
}
