import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { getGoogleConnectionStatus, getGoogleRuntimeConfig } from "../../../../../../lib/google-oauth";
import { getGoogleSheetMirrorStatus } from "../../../../../../lib/google-sheets";
import { requireOfficeUser } from "../../../../../../lib/workspace-auth";

/** Read-only health for the generated Client Directory / Project Register workbook. */
export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  const connection = await getGoogleConnectionStatus(config);
  const mirror = await getGoogleSheetMirrorStatus(config, connection);
  return NextResponse.json({ mirror });
}
