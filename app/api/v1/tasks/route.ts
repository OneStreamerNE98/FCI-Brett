import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1TaskRepository } from "../../../adapters/d1/task-repository";
import { createTask, listTasks } from "../../../application/task-operations";
import { AUTHORIZATION_CAPABILITIES } from "../../../application/authorization-capabilities";
import { creationAuthorizationFor } from "../../../application/creation-authorization";
import { MAX_TASK_BODY_BYTES } from "../../../domain/task";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../lib/development-request-rate-limit";
import { queueGoogleChatNotification } from "../../../lib/google-chat-notifier-sites";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth-sites";
import { noStoreJson as json } from "../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

const INBOX_TASK_REVIEW_INTENTS = new Set(["schedule", "warranty"]);

function taskRequestBody(body: Record<string, unknown>) {
  const hasReviewId = Object.hasOwn(body, "inboxReviewId");
  const hasReviewIntent = Object.hasOwn(body, "inboxReviewIntent");
  if (!hasReviewId && !hasReviewIntent) {
    return { ok: true as const, body, inboxReview: undefined };
  }
  if (
    !hasReviewId
    || !hasReviewIntent
    || typeof body.inboxReviewId !== "string"
    || !body.inboxReviewId.trim()
    || body.inboxReviewId.length > 512
    || /[\u0000-\u001f\u007f]/.test(body.inboxReviewId)
    || typeof body.inboxReviewIntent !== "string"
    || !INBOX_TASK_REVIEW_INTENTS.has(body.inboxReviewIntent)
  ) {
    return {
      ok: false as const,
      error: "Inbox review task details are invalid.",
    };
  }
  const taskBody = { ...body };
  delete taskBody.inboxReviewId;
  delete taskBody.inboxReviewIntent;
  return {
    ok: true as const,
    body: taskBody,
    inboxReview: {
      id: body.inboxReviewId,
      intent: body.inboxReviewIntent as "schedule" | "warranty",
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const filters = Object.fromEntries(request.nextUrl.searchParams.entries());
  await ensureWorkspaceSchema();
  const result = await listTasks(
    filters,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.recordsRead],
    }),
    createD1TaskRepository(env.DB as unknown as D1Database),
  );
  if (!result.ok) return json({ error: result.message }, result.kind === "forbidden" ? 403 : 400);
  return json({ tasks: result.value });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("tasks", auth.user.email);
  if (rateLimitResponse) return rateLimitResponse;
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_TASK_BODY_BYTES,
    invalidMessage: "Task details must be valid JSON.",
    tooLargeMessage: "Task details are too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const taskRequest = taskRequestBody(parsed.body);
  if (!taskRequest.ok) return json({ error: taskRequest.error }, 400);
  if (taskRequest.inboxReview) {
    const admin = requireOfficeUser(request, { admin: true });
    if ("response" in admin) return admin.response;
  }
  await ensureWorkspaceSchema();
  const result = await createTask(
    taskRequest.body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [AUTHORIZATION_CAPABILITIES.tasksUpdate],
    }),
    {
      repository: createD1TaskRepository(env.DB as unknown as D1Database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
      ...(taskRequest.inboxReview
        ? {
            inboxReview: {
              ...taskRequest.inboxReview,
              connectionKey: getGoogleRuntimeConfig().connectionKey,
            },
          }
        : {}),
    },
  );
  if (!result.ok) {
    const status = result.kind === "forbidden"
      ? 403
      : result.kind === "invalid"
        ? 400
        : result.kind === "project-not-found" || result.kind === "lead-not-found"
          ? 404
          : 409;
    return json({ error: result.message }, status);
  }
  if (result.value.assigneeEmail) {
    queueGoogleChatNotification(
      {
        eventType: "task.assigned",
        entityId: result.value.id,
        taskTitle: result.value.title,
        assigneeEmail: result.value.assigneeEmail,
        ...(result.value.dueDate ? { dueDate: result.value.dueDate } : {}),
      },
      auth.user.email,
      request.nextUrl.origin,
    );
  }
  return json({
    task: result.value,
    ...(result.inboxReview ? { inboxReview: result.inboxReview } : {}),
  }, 201);
}
