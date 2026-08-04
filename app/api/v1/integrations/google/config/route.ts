import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../../adapters/d1/d1-database";
import { createD1WorkspaceSettingsRepository } from "../../../../../adapters/d1/workspace-settings-repository";
import { WORKSPACE_SETTINGS_ID } from "../../../../../domain/workspace-settings";
import { parseBoundedJsonObject } from "../../../../../lib/api-json-body";
import {
  getConnectionScope,
  getEffectiveGoogleRuntimeConfig,
} from "../../../../../lib/google-oauth-sites";
import { noStoreJson as json, noStoreResponse } from "../../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

const MAXIMUM_BODY_BYTES = 1_024;

function publicConfiguration(config: Awaited<ReturnType<typeof getEffectiveGoogleRuntimeConfig>>) {
  return Object.freeze({
    driveProvisioningEnabled: config.provisioningEnabled,
    driveProvisioningSource: config.effectiveSources.driveProvisioningEnabled,
  });
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  return json(publicConfiguration(await getEffectiveGoogleRuntimeConfig()));
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAXIMUM_BODY_BYTES,
    invalidMessage: "Send a valid Workspace runtime configuration update.",
    tooLargeMessage: "Workspace runtime configuration update is too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  if (
    Object.keys(parsed.body).length !== 1
    || typeof parsed.body.driveProvisioningEnabled !== "boolean"
  ) {
    return json({ error: "Choose whether app-managed Drive provisioning is enabled." }, 400);
  }
  if (getConnectionScope().simulation) {
    return json({
      error: "Drive provisioning is always enabled in simulation and cannot be changed.",
      code: "simulation_configuration_fixed",
    }, 409);
  }

  await ensureWorkspaceSchema();
  await createD1WorkspaceSettingsRepository(
    env.DB as unknown as D1Database,
  ).mergeSettings({
    id: WORKSPACE_SETTINGS_ID,
    settings: {
      driveProvisioningEnabled: parsed.body.driveProvisioningEnabled,
    },
    updatedBy: auth.user.email,
    updatedAt: Date.now(),
  });
  return json(publicConfiguration(await getEffectiveGoogleRuntimeConfig()));
}
