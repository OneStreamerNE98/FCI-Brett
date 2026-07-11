import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { GoogleDriveClient } from "../../../../../lib/google-drive";
import { GoogleIntegrationError, getGoogleAccessToken, getGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "../../../../../lib/google-oauth";
import { trySyncGoogleDirectory } from "../../../../../lib/google-sheets";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  client_id: string;
  client_code: string;
  client_name: string;
};

type MappingRow = { drive_file_id: string; drive_url: string };

function errorResponse(error: unknown) {
  if (error instanceof GoogleIntegrationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: "The project Drive workspace could not be created. Try again." }, { status: 503 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  if (!config.oauthReady) return NextResponse.json({ error: "Google Drive setup is incomplete.", missing: config.missing }, { status: 409 });
  if (!config.provisioningEnabled) {
    return NextResponse.json({ error: "Drive folder creation is disabled for this connection profile. Enable the profile's explicit provisioning flag after test verification." }, { status: 409 });
  }

  const { projectId } = await context.params;
  const project = await env.DB.prepare("SELECT p.id, p.project_number, p.name, p.client_id, c.client_code, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?")
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const accessToken = await getGoogleAccessToken(config, "drive");
  const drive = new GoogleDriveClient(accessToken, config);
  const existing = await env.DB.prepare("SELECT drive_file_id, drive_url FROM drive_folder_mappings WHERE connection_key = ? AND entity_type = 'project' AND entity_id = ? AND folder_key = 'project-root'")
    .bind(config.connectionKey, project.id)
    .first<MappingRow>();
  if (existing) {
    await drive.assertContained(existing.drive_file_id);
    return NextResponse.json({ created: false, driveFolderId: existing.drive_file_id, driveUrl: existing.drive_url, environment: config.environment });
  }
  const now = Date.now();
  const operationKey = `${config.connectionKey}:provision-project:${project.id}`;
  const leaseExpiresAt = now + 5 * 60 * 1000;
  const operation = await env.DB.prepare("INSERT INTO google_drive_operations (id, connection_key, operation_key, project_id, status, lease_expires_at, last_error_code, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'in-progress', ?, NULL, ?, ?, ?) ON CONFLICT(operation_key) DO UPDATE SET status = 'in-progress', lease_expires_at = excluded.lease_expires_at, last_error_code = NULL, created_by = excluded.created_by, updated_at = excluded.updated_at WHERE google_drive_operations.status != 'in-progress' OR google_drive_operations.lease_expires_at < ?")
    .bind(crypto.randomUUID(), config.connectionKey, operationKey, project.id, leaseExpiresAt, auth.user.email, now, now, now)
    .run();
  if (operation.meta.changes !== 1) {
    return NextResponse.json({ error: "A Drive folder request is already in progress for this project. Try again shortly." }, { status: 409 });
  }

  try {
    const provisioned = await drive.provisionProjectFolders({
      client: { id: project.client_id, code: project.client_code, name: project.client_name },
      project: { id: project.id, number: project.project_number, name: project.name, year: project.project_number.slice(3, 7) || new Date().getUTCFullYear().toString() },
    });
    const completedAt = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO drive_folder_mappings (id, connection_key, entity_type, entity_id, folder_key, drive_file_id, parent_drive_file_id, drive_url, created_at, updated_at) VALUES (?, ?, 'client', ?, 'client-root', ?, NULL, ?, ?, ?) ON CONFLICT(connection_key, entity_type, entity_id, folder_key) DO UPDATE SET drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at")
        .bind(crypto.randomUUID(), config.connectionKey, project.client_id, provisioned.clientFolder.id, provisioned.clientFolder.url, completedAt, completedAt),
      env.DB.prepare("INSERT INTO drive_folder_mappings (id, connection_key, entity_type, entity_id, folder_key, drive_file_id, parent_drive_file_id, drive_url, created_at, updated_at) VALUES (?, ?, 'project', ?, 'project-root', ?, NULL, ?, ?, ?) ON CONFLICT(connection_key, entity_type, entity_id, folder_key) DO UPDATE SET drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at")
        .bind(crypto.randomUUID(), config.connectionKey, project.id, provisioned.projectFolder.id, provisioned.projectFolder.url, completedAt, completedAt),
      env.DB.prepare("UPDATE google_drive_operations SET status = 'completed', lease_expires_at = NULL, last_error_code = NULL, updated_at = ? WHERE operation_key = ?")
        .bind(completedAt, operationKey),
      env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, 'google_drive.folder_provisioned', ?, ?, ?)")
        .bind(crypto.randomUUID(), project.id, auth.user.email, `Project workspace created in ${config.environment} Drive profile`, completedAt),
    ]);
    await writeGoogleIntegrationEvent(config, "drive.project_folder_provisioned", auth.user.email, "project", project.id, `environment=${config.environment}`);
    const sheetSync = await trySyncGoogleDirectory(config, auth.user.email);
    return NextResponse.json({ created: true, driveFolderId: provisioned.projectFolder.id, driveUrl: provisioned.projectFolder.url, environment: config.environment, sheetSync }, { status: 201 });
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "provision_failed";
    await env.DB.prepare("UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = ?, updated_at = ? WHERE operation_key = ?")
      .bind(code, Date.now(), operationKey)
      .run();
    await writeGoogleIntegrationEvent(config, "drive.project_folder_failed", auth.user.email, "project", project.id, code);
    return errorResponse(error);
  }
}
