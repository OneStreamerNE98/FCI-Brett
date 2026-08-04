import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1ClientRepository } from "../../../../adapters/d1/client-repository";
import {
  clientUpdateResponse,
  MAX_CLIENT_PATCH_BODY_BYTES,
  updateClient,
} from "../../../../application/update-client";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { resolveAddressMutation } from "../../../../lib/address-mutation-sites";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_CLIENT_PATCH_BODY_BYTES,
    invalidMessage: "Client update must be valid JSON.",
    tooLargeMessage: "Client update is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);

  const { clientId } = await context.params;
  await ensureWorkspaceSchema();
  const { addressReview, ...clientBody } = parsed.body;
  const database = env.DB as unknown as D1Database;
  let trustedAddress;
  if (Object.hasOwn(clientBody, "siteAddress")) {
    const resolved = await resolveAddressMutation(database, {
      actorId: auth.user.email,
      entityKind: "client",
      targetId: clientId,
      rawAddress: clientBody.siteAddress,
      rawReview: addressReview,
    });
    if (!resolved.ok) return noStoreJson({ error: resolved.message }, 400);
    clientBody.siteAddress = resolved.value.address;
    trustedAddress = resolved.value;
  } else if (addressReview !== undefined) {
    return noStoreJson({ error: "Address review requires a site address update." }, 400);
  }
  const result = await updateClient(
    clientId,
    clientBody,
    auth.user.email,
    {
      repository: createD1ClientRepository(database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
    trustedAddress,
  );
  if (!result.ok) {
    const status = result.kind === "forbidden"
      ? 403
      : result.kind === "conflict" || result.kind === "duplicate"
        ? 409
        : result.kind === "client-not-found"
          ? 404
          : 400;
    return noStoreJson(
      result.kind === "conflict"
        ? {
            error: result.message,
            currentVersion: result.currentVersion,
            currentValues: result.currentValues,
          }
        : {
            error: result.message,
            ...(result.kind === "duplicate" ? { outcome: "duplicate" } : {}),
          },
      status,
    );
  }
  return noStoreJson({ client: clientUpdateResponse(result.value) });
}
