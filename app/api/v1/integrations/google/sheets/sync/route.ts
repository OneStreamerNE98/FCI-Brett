import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { enforceDevelopmentRequestRateLimit } from "../../../../../../lib/development-request-rate-limit";
import { GoogleIntegrationError, getEffectiveGoogleRuntimeSetup, getGoogleConnectionStatus } from "../../../../../../lib/google-oauth-sites";
import { getGoogleSheetMirrorStatus, syncGoogleDirectory } from "../../../../../../lib/google-sheets-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";

/** Reconciles the generated Google Sheet from durable FCI Operations records. */
export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("google-sheets-sync", auth.user.email);
  if (rateLimitResponse) return rateLimitResponse;
  await ensureWorkspaceSchema();
  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config } = setup;
  const responseOptions = { headers: { "Cache-Control": "no-store" } } as const;
  try {
    const result = await syncGoogleDirectory(config, auth.user.email);
    const connection = await getGoogleConnectionStatus(config);
    const mirror = await getGoogleSheetMirrorStatus(config, connection, setup.effectiveResources.clientDirectorySheet.source);
    return NextResponse.json({ result, mirror }, responseOptions);
  } catch (error) {
    const connection = await getGoogleConnectionStatus(config);
    const mirror = await getGoogleSheetMirrorStatus(config, connection, setup.effectiveResources.clientDirectorySheet.source);
    if (error instanceof GoogleIntegrationError) return NextResponse.json({ error: error.message, code: error.code, mirror }, { status: error.status, ...responseOptions });
    return NextResponse.json({ error: "Google Sheets could not complete the directory sync.", code: "sheets_sync_failed", mirror }, { status: 503, ...responseOptions });
  }
}
