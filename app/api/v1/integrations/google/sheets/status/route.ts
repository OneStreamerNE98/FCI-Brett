import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { getEffectiveGoogleRuntimeSetup, getGoogleConnectionStatus } from "../../../../../../lib/google-oauth-sites";
import { getGoogleSheetMirrorStatus } from "../../../../../../lib/google-sheets-sites";
import { requireOfficeUser } from "../../../../../../lib/workspace-auth";

/** Read-only health for the generated Client Directory / Project Register workbook. */
export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config } = setup;
  const connection = await getGoogleConnectionStatus(config);
  const mirror = await getGoogleSheetMirrorStatus(config, connection, setup.effectiveResources.clientDirectorySheet.source);
  return NextResponse.json({ mirror }, { headers: { "Cache-Control": "no-store" } });
}
