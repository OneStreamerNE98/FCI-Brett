import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getGoogleRuntimeConfig } from "../../../../../../lib/google-oauth-sites";
import { resetWorkspaceSimulation } from "../../../../../../lib/workspace-simulation";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  if (!config.simulation) return NextResponse.json({ error: "Simulation reset is available only in local Workspace simulation mode." }, { status: 409 });

  await env.DB.batch([
    env.DB.prepare("DELETE FROM gmail_file_archive_artifacts WHERE archive_id IN (SELECT id FROM gmail_file_archives WHERE connection_key = ?)").bind(config.connectionKey),
    env.DB.prepare("DELETE FROM gmail_file_archives WHERE connection_key = ?").bind(config.connectionKey),
    env.DB.prepare("DELETE FROM drive_folder_mappings WHERE connection_key = ?").bind(config.connectionKey),
    env.DB.prepare("DELETE FROM google_drive_operations WHERE connection_key = ?").bind(config.connectionKey),
    env.DB.prepare("DELETE FROM google_sheet_sync_state WHERE connection_key = ?").bind(config.connectionKey),
    env.DB.prepare("DELETE FROM google_integration_events WHERE connection_key = ?").bind(config.connectionKey),
    env.DB.prepare("DELETE FROM workspace_resources WHERE connection_key = ?").bind(config.connectionKey),
  ]);
  return NextResponse.json(await resetWorkspaceSimulation(), { headers: { "Cache-Control": "no-store" } });
}
