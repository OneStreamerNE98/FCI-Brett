import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
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
    invalidMessage: "Send a valid lead-form Sheet verification request.",
    tooLargeMessage: "The lead-form Sheet verification request is too large.",
  });
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const externalId = spreadsheetId(parsed.body.spreadsheetId);
  if (!externalId || Object.keys(parsed.body).some((key) => key !== "spreadsheetId")) {
    return json({ error: "Provide one valid lead-form response spreadsheet ID." }, 400);
  }

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config } = setup;
  if (!config.sheetsEnabled || !config.connectReady) {
    return json({
      error: "Complete the Google Workspace Sheets connection before verifying form responses.",
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

  try {
    await new GoogleSheetsClient(
      await getGoogleAccessToken(config, "sheets"),
      externalId,
    ).metadata();
    const now = Date.now();
    const existing = setup.resources.find((resource) => (
      resource.resourceType === "sheets.spreadsheet"
      && resource.resourceKey === "lead-form-responses"
    ));
    await upsertWorkspaceResource(env.DB, {
      id: existing?.id ?? crypto.randomUUID(),
      connectionKey: config.connectionKey,
      resourceType: "sheets.spreadsheet",
      resourceKey: "lead-form-responses",
      externalId,
      externalUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(externalId)}/edit`,
      origin: "adopted",
      metadata: { role: "lead-form-responses" },
      createdBy: existing?.createdBy ?? auth.user.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return json({
      verified: true,
      simulated: false,
      spreadsheet: {
        id: externalId,
        url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(externalId)}/edit`,
      },
    });
  } catch (error) {
    return noStoreResponse(googleIntegrationErrorResponse(
      error,
      "The lead-form response spreadsheet could not be verified. Try again.",
    ));
  }
}
