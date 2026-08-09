import { NextRequest } from "next/server";
import { disconnectGoogleConnection, getEffectiveGoogleRuntimeConfig, getGoogleConnectionStatus, getGoogleMailboxRuntimeConfig, listGoogleMailboxConnections } from "../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";
import { noStoreJson as noStore, noStoreResponse } from "../../../../../lib/no-store-json";
import { parseBoundedJsonObject } from "../../../../../lib/api-json-body";
import { googleIntegrationErrorResponse } from "../../../../../lib/google-integration-error";

const DISCONNECT_BODY_LIMIT = 256;

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  const config = await getEffectiveGoogleRuntimeConfig();
  const [connection, mailboxes] = await Promise.all([
    getGoogleConnectionStatus(config),
    listGoogleMailboxConnections(config),
  ]);
  return noStore({
    runtimeMode: config.environment,
    simulation: config.simulation,
    connection,
    enabledServices: config.enabledServices,
    mailboxes,
  });
}

export async function DELETE(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: DISCONNECT_BODY_LIMIT,
    invalidMessage: "Choose the Google mailbox to disconnect.",
    tooLargeMessage: "The disconnect request is too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const fields = Object.keys(parsed.body);
  const mailbox = typeof parsed.body.mailbox === "string"
    ? parsed.body.mailbox.trim().toLowerCase()
    : "";
  if (
    fields.length !== 1
    || fields[0] !== "mailbox"
    || mailbox.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)
  ) {
    return noStore({ error: "Choose a valid attached Google mailbox to disconnect." }, { status: 400 });
  }
  await ensureWorkspaceSchema();
  try {
    const config = await getGoogleMailboxRuntimeConfig(mailbox);
    const result = await disconnectGoogleConnection(config, auth.user.email);
    return noStore({
      disconnected: true,
      mailbox,
      revocationRequested: result.revocationRequested,
      providerRevocation: result.providerRevocation,
    });
  } catch (error) {
    return noStoreResponse(googleIntegrationErrorResponse(
      error,
      "The Google mailbox could not be disconnected. Try again.",
    ));
  }
}
