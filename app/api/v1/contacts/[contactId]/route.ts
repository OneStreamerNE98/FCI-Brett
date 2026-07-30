import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1ClientRepository } from "../../../../adapters/d1/client-repository";
import {
  contactUpdateResponse,
  MAX_CONTACT_PATCH_BODY_BYTES,
  updateContact,
} from "../../../../application/update-contact";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

type RouteContext = { params: Promise<{ contactId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_CONTACT_PATCH_BODY_BYTES,
    invalidMessage: "Contact update must be valid JSON.",
    tooLargeMessage: "Contact update is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);

  const { contactId } = await context.params;
  await ensureWorkspaceSchema();
  const result = await updateContact(
    contactId,
    parsed.body,
    auth.user.email,
    {
      repository: createD1ClientRepository(env.DB as unknown as D1Database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  if (!result.ok) {
    const status = result.kind === "forbidden"
      ? 403
      : result.kind === "conflict"
        ? 409
        : result.kind === "contact-not-found"
          ? 404
          : 400;
    return noStoreJson(
      result.kind === "conflict"
        ? {
            error: result.message,
            currentVersion: result.currentVersion,
            currentValues: result.currentValues,
          }
        : { error: result.message },
      status,
    );
  }
  return noStoreJson({ contact: contactUpdateResponse(result.value) });
}
