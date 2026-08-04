import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import { createD1AssistantLabelRepository } from "../../../../adapters/d1/assistant-label-repository";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import {
  AssistantLabelValidationError,
  createAssistantLabelSlug,
  MAX_ASSISTANT_LABELS,
  normalizeAssistantLabelDescription,
  normalizeAssistantLabelSlug,
  normalizeStoredAssistantLabelDefinition,
} from "../../../../domain/assistant-label-definition";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../../lib/development-request-rate-limit";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

export const MAX_ASSISTANT_LABEL_BODY_BYTES = 2_000;

function exactKeys(body: Record<string, unknown>, keys: readonly string[]) {
  const bodyKeys = Object.keys(body);
  return bodyKeys.length === keys.length && keys.every((key) => Object.hasOwn(body, key));
}

async function mutationBody(request: NextRequest) {
  return parseBoundedJsonObject(request, {
    maximumBytes: MAX_ASSISTANT_LABEL_BODY_BYTES,
    invalidMessage: "AI label update must be a valid JSON object.",
    tooLargeMessage: "AI label update is too large.",
  });
}

function validationResponse(error: unknown) {
  return error instanceof AssistantLabelValidationError
    ? noStoreJson({ error: error.message }, 400)
    : null;
}

function mutationAuth(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimit = enforceDevelopmentRequestRateLimit("assistant-labels", auth.user.email);
  return rateLimit ? noStoreResponse(rateLimit) : null;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  const labels = await createD1AssistantLabelRepository(
    env.DB as unknown as D1Database,
  ).list();
  return noStoreJson({ labels, maximumLabels: MAX_ASSISTANT_LABELS });
}

export async function POST(request: NextRequest) {
  const authError = mutationAuth(request);
  if (authError) return authError;
  const parsed = await mutationBody(request);
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  if (!exactKeys(parsed.body, ["description"])) {
    return noStoreJson({ error: "Provide one AI label description." }, 400);
  }
  try {
    const now = Date.now();
    const label = normalizeStoredAssistantLabelDefinition({
      slug: createAssistantLabelSlug(),
      description: normalizeAssistantLabelDescription(parsed.body.description),
      retired: false,
      createdAt: now,
      updatedAt: now,
    });
    await ensureWorkspaceSchema();
    const saved = await createD1AssistantLabelRepository(
      env.DB as unknown as D1Database,
    ).insert(label);
    return saved
      ? noStoreJson({ label }, 201)
      : noStoreJson({ error: `AI labels are limited to ${MAX_ASSISTANT_LABELS}.` }, 409);
  } catch (error) {
    return validationResponse(error) ?? noStoreJson({ error: "AI label could not be added." }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  const authError = mutationAuth(request);
  if (authError) return authError;
  const parsed = await mutationBody(request);
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  if (!exactKeys(parsed.body, ["slug", "description"])) {
    return noStoreJson({ error: "Provide the AI label slug and description." }, 400);
  }
  try {
    const slug = normalizeAssistantLabelSlug(parsed.body.slug);
    const description = normalizeAssistantLabelDescription(parsed.body.description);
    await ensureWorkspaceSchema();
    const updated = await createD1AssistantLabelRepository(
      env.DB as unknown as D1Database,
    ).updateDescription(slug, description, Date.now());
    return updated
      ? noStoreJson({ slug, description })
      : noStoreJson({ error: "AI label not found." }, 404);
  } catch (error) {
    return validationResponse(error) ?? noStoreJson({ error: "AI label could not be updated." }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  const authError = mutationAuth(request);
  if (authError) return authError;
  const parsed = await mutationBody(request);
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  if (!exactKeys(parsed.body, ["slug"])) {
    return noStoreJson({ error: "Provide the AI label slug." }, 400);
  }
  try {
    const slug = normalizeAssistantLabelSlug(parsed.body.slug);
    await ensureWorkspaceSchema();
    const outcome = await createD1AssistantLabelRepository(
      env.DB as unknown as D1Database,
    ).removeOrRetire(slug, Date.now());
    return outcome === "not-found"
      ? noStoreJson({ error: "AI label not found." }, 404)
      : noStoreJson({ slug, outcome });
  } catch (error) {
    return validationResponse(error) ?? noStoreJson({ error: "AI label could not be retired." }, 500);
  }
}
