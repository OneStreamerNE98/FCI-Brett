import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../../../../adapters/d1/d1-database";
import { createD1WorkspaceSettingsRepository } from "../../../../../../../adapters/d1/workspace-settings-repository";
import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { WORKSPACE_SETTINGS_ID } from "../../../../../../../domain/workspace-settings";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import { googleIntegrationErrorResponse } from "../../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
} from "../../../../../../../lib/google-oauth-sites";
import { GoogleSheetsClient } from "../../../../../../../lib/google-sheets";
import { noStoreJson as json, noStoreResponse } from "../../../../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../../_workspace-data";

const MAXIMUM_BODY_BYTES = 2_048;
const PROVIDER_ID = /^[A-Za-z0-9_-]{10,200}$/u;

function spreadsheetId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return PROVIDER_ID.test(normalized) ? normalized : null;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAXIMUM_BODY_BYTES,
    invalidMessage: "Send a valid Client Directory Sheet verification request.",
    tooLargeMessage: "The Client Directory Sheet verification request is too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const externalId = spreadsheetId(parsed.body.spreadsheetId);
  if (!externalId || Object.keys(parsed.body).some((key) => key !== "spreadsheetId")) {
    return json({ error: "Provide one valid Client Directory spreadsheet ID." }, 400);
  }

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config } = setup;
  if (!config.sheetsEnabled || !config.connectReady) {
    return json({
      error: "Complete the Google Workspace Sheets connection before verifying the Client Directory.",
      code: "sheets_configuration_required",
    }, 409);
  }
  if (config.simulation) {
    return json({
      verified: true,
      simulated: true,
      spreadsheet: { id: externalId, url: null },
    });
  }

  const database = env.DB as unknown as D1Database;
  let lease: WorkspaceSetupLease | null = null;
  try {
    await new GoogleSheetsClient(
      await getGoogleAccessToken(config, "sheets"),
      externalId,
    ).metadata();
    const now = Date.now();
    lease = await acquireWorkspaceSetupLease(database, {
      id: crypto.randomUUID(),
      connectionKey: config.workspaceConnectionKey,
      action: "sheets-client-directory-verify",
      scopeKey: "sheets-client-directory-verify",
      actor: auth.user.email,
      now,
      connectionFence: googleConnectionLeaseFence(config),
    });
    if (!lease) {
      return json({
        error: "The Google connection changed or this spreadsheet is already being verified. Try again.",
        code: "sheets_verify_in_progress",
      }, 409);
    }
    const existing = setup.resources.find((resource) => (
      resource.resourceType === "sheets.spreadsheet"
      && resource.resourceKey === "client-directory"
    ));
    // Write the registry row FIRST: it is the tier the runtime resolver ranks
    // highest. If the second (outranked, bootstrap-mirror) write fails, the
    // ranking tier already holds the verified ID, so runtime state and this
    // route's verification agree and a retry only has to heal the mirror.
    // The two adapters each run and guard their own statement internally, so a
    // single atomic database.batch is not reachable without new plumbing.
    await upsertWorkspaceResource(env.DB, {
      id: existing?.id ?? crypto.randomUUID(),
      connectionKey: config.connectionKey,
      resourceType: "sheets.spreadsheet",
      resourceKey: "client-directory",
      externalId,
      externalUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(externalId)}/edit`,
      origin: "adopted",
      metadata: { role: "client-directory" },
      createdBy: existing?.createdBy ?? auth.user.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await createD1WorkspaceSettingsRepository(
      database,
    ).mergeSettings({
      id: WORKSPACE_SETTINGS_ID,
      clientDirectorySheetId: externalId,
      settings: {},
      updatedBy: auth.user.email,
      updatedAt: now,
    });
    await completeWorkspaceSetupLease(database, lease, Date.now());
    lease = null;
    return json({
      verified: true,
      simulated: false,
      spreadsheet: {
        id: externalId,
        url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(externalId)}/edit`,
      },
    });
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(database, lease, "sheets_verify_failed", Date.now());
    }
    return noStoreResponse(googleIntegrationErrorResponse(
      error,
      "The Client Directory spreadsheet could not be verified. Try again.",
    ));
  }
}
