import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1ProjectRepository } from "../../../../adapters/d1/project-repository";
import {
  MAX_PROJECT_PATCH_BODY_BYTES,
  projectUpdateResponse,
  updateProject,
} from "../../../../application/update-project";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import {
  releaseFailedAddressMutation,
  resolveAddressMutation,
  type AddressMutationSuccess,
} from "../../../../lib/address-mutation-sites";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_PROJECT_PATCH_BODY_BYTES,
    invalidMessage: "Project update must be valid JSON.",
    tooLargeMessage: "Project update is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);

  const { projectId } = await context.params;
  await ensureWorkspaceSchema();
  const { addressReview, ...projectBody } = parsed.body;
  const database = env.DB as unknown as D1Database;
  let trustedAddress;
  let addressResolution: AddressMutationSuccess | undefined;
  if (Object.hasOwn(projectBody, "site")) {
    const resolved = await resolveAddressMutation(database, {
      actorId: auth.user.email,
      entityKind: "project",
      targetId: projectId,
      rawAddress: projectBody.site,
      rawReview: addressReview,
    });
    if (!resolved.ok) return noStoreJson({ error: resolved.message }, 400);
    projectBody.site = resolved.value.address;
    trustedAddress = resolved.value;
    addressResolution = resolved;
  } else if (addressReview !== undefined) {
    return noStoreJson({ error: "Address review requires a project site update." }, 400);
  }
  const result = await updateProject(
    projectId,
    projectBody,
    { actorId: auth.user.email, isAdmin: auth.user.isAdmin },
    {
      repository: createD1ProjectRepository(database),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
    trustedAddress,
  );
  if (!result.ok) {
    if (addressResolution) await releaseFailedAddressMutation(database, addressResolution);
    const status = result.kind === "forbidden"
      ? 403
      : result.kind === "conflict"
        ? 409
        : result.kind === "project-not-found" || result.kind === "client-not-found"
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
  return noStoreJson({ project: projectUpdateResponse(result.value, auth.user.isAdmin, auth.user.email) });
}
