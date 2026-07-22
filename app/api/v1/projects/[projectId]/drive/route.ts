import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { buildProjectDriveBlueprintPlan, GoogleDriveClient } from "../../../../../lib/google-drive";
import { mapGoogleIntegrationError } from "../../../../../lib/google-integration-error";
import { GoogleIntegrationError, getEffectiveGoogleRuntimeSetup, getGoogleAccessToken } from "../../../../../lib/google-oauth-sites";
import { enforceDevelopmentRequestRateLimit } from "../../../../../lib/development-request-rate-limit";
import { trySyncGoogleDirectory } from "../../../../../lib/google-sheets-sites";
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

const OPERATION_LEASE_EXISTS = "EXISTS (SELECT 1 FROM google_drive_operations WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?)";

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function errorResponse(error: unknown) {
  const mapped = mapGoogleIntegrationError(error, "The project Drive workspace could not be created. Try again.");
  return noStore(mapped.body, { status: mapped.status });
}

function integrationEventStatement(
  connectionKey: string,
  eventType: string,
  actor: string,
  entityType: string,
  entityId: string,
  detail: string,
  operationKey: string,
  leaseExpiresAt: number,
) {
  return env.DB.prepare(`INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${OPERATION_LEASE_EXISTS}`)
    .bind(crypto.randomUUID(), connectionKey, eventType, actor, entityType, entityId, detail, Date.now(), operationKey, leaseExpiresAt);
}

function assertLeaseCompleted(result: Readonly<{ meta?: Readonly<{ changes?: number }> }> | undefined) {
  if (result?.meta.changes !== 1) {
    throw new GoogleIntegrationError(
      "project_drive_lease_lost",
      "This Drive request expired while provider work was still running. Refresh before retrying; managed folder identities prevent duplicates.",
      409,
    );
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("project-drive-provisioning", auth.user.email);
  if (rateLimitResponse) return rateLimitResponse;
  await ensureWorkspaceSchema();
  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, resources } = setup;
  if (!config.connectReady || !config.drive.rootFolderId) return noStore({ error: "Google Drive setup is incomplete.", missing: config.missing }, { status: 409 });
  if (!config.provisioningEnabled) {
    return noStore({ error: "Shared Drive folder creation is disabled. Enable Workspace provisioning only after the company drive is verified." }, { status: 409 });
  }

  const { projectId } = await context.params;
  const project = await env.DB.prepare("SELECT p.id, p.project_number, p.name, p.client_id, c.client_code, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?")
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) return noStore({ error: "Project not found." }, { status: 404 });
  const projectYear = project.project_number.slice(3, 7) || new Date().getUTCFullYear().toString();

  const existing = await env.DB.prepare("SELECT drive_file_id, drive_url FROM drive_folder_mappings WHERE connection_key = ? AND entity_type = 'project' AND entity_id = ? AND folder_key = 'project-root'")
    .bind(config.connectionKey, project.id)
    .first<MappingRow>();
  if (existing) {
    try {
      if (!config.simulation) {
        const drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
        await drive.assertContained(existing.drive_file_id);
      }
      return noStore({ created: false, driveFolderId: existing.drive_file_id, driveUrl: existing.drive_url, environment: config.environment });
    } catch (error) {
      return errorResponse(error);
    }
  }
  let drive: GoogleDriveClient | null = null;
  if (!config.simulation) {
    try {
      drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
    } catch (error) {
      return errorResponse(error);
    }
  }

  const now = Date.now();
  const operationKey = `${config.connectionKey}:provision-project:${project.id}`;
  const leaseExpiresAt = now + 5 * 60 * 1000;
  const operation = await env.DB.prepare("INSERT INTO google_drive_operations (id, connection_key, operation_key, project_id, status, lease_expires_at, last_error_code, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'in-progress', ?, NULL, ?, ?, ?) ON CONFLICT(operation_key) DO UPDATE SET status = 'in-progress', lease_expires_at = excluded.lease_expires_at, last_error_code = NULL, created_by = excluded.created_by, updated_at = excluded.updated_at WHERE google_drive_operations.status != 'in-progress' OR google_drive_operations.lease_expires_at < ?")
    .bind(crypto.randomUUID(), config.connectionKey, operationKey, project.id, leaseExpiresAt, auth.user.email, now, now, now)
    .run();
  if (operation.meta.changes !== 1) {
    return noStore({ error: "A Drive folder request is already in progress for this project. Try again shortly." }, { status: 409 });
  }

  try {
    if (config.simulation) {
      const blueprintPlan = buildProjectDriveBlueprintPlan(blueprint);
      const completedAt = Date.now();
      const clientFolderId = `sim-client-${project.client_id}`;
      const projectFolderId = `sim-project-${project.id}`;
      const clientUrl = `${request.nextUrl.origin}/?workspace-simulation=client&client=${encodeURIComponent(project.client_id)}`;
      const projectUrl = `${request.nextUrl.origin}/?workspace-simulation=project&project=${encodeURIComponent(project.id)}`;
      const registeredRootId = (key: string) => resources.find((resource) => (
        resource.resourceType === "drive.folder" && resource.resourceKey === key
      ))?.externalId ?? `workspace-simulation-folder-${key}`;
      const accountsRootId = registeredRootId(blueprintPlan.accountsRoot.key);
      const projectsRootId = registeredRootId(blueprintPlan.projectsRoot.key);
      const projectFolderName = `${project.project_number} — ${project.name}`;
      const completionResults = await env.DB.batch([
        env.DB.prepare(`INSERT INTO drive_folder_mappings (id, connection_key, entity_type, entity_id, folder_key, drive_file_id, parent_drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, 'client', ?, 'client-root', ?, NULL, ?, ?, ? WHERE ${OPERATION_LEASE_EXISTS} ON CONFLICT(connection_key, entity_type, entity_id, folder_key) DO UPDATE SET drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), config.connectionKey, project.client_id, clientFolderId, clientUrl, completedAt, completedAt, operationKey, leaseExpiresAt),
        env.DB.prepare(`INSERT INTO drive_folder_mappings (id, connection_key, entity_type, entity_id, folder_key, drive_file_id, parent_drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, 'project', ?, 'project-root', ?, NULL, ?, ?, ? WHERE ${OPERATION_LEASE_EXISTS} ON CONFLICT(connection_key, entity_type, entity_id, folder_key) DO UPDATE SET drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), config.connectionKey, project.id, projectFolderId, projectUrl, completedAt, completedAt, operationKey, leaseExpiresAt),
        env.DB.prepare(`INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, 'workspace_simulation.folder_provisioned', ?, ?, ? WHERE ${OPERATION_LEASE_EXISTS}`)
          .bind(crypto.randomUUID(), project.id, auth.user.email, "Simulated Shared Drive project workspace created; no Google data changed", completedAt, operationKey, leaseExpiresAt),
        integrationEventStatement(config.connectionKey, "drive.simulation_project_folder_provisioned", auth.user.email, "project", project.id, "mode=simulation", operationKey, leaseExpiresAt),
        env.DB.prepare("UPDATE google_drive_operations SET status = 'completed', lease_expires_at = NULL, last_error_code = NULL, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
          .bind(completedAt, operationKey, leaseExpiresAt),
      ]);
      assertLeaseCompleted(completionResults.at(-1));
      const sheetSync = await trySyncGoogleDirectory(config, auth.user.email);
      return noStore({
        created: true,
        simulated: true,
        driveFolderId: projectFolderId,
        driveUrl: projectUrl,
        environment: config.environment,
        sheetSync,
        simulationPlan: {
          roots: {
            clientAccounts: { id: accountsRootId, name: blueprintPlan.accountsRoot.name },
            projects: { id: projectsRootId, name: blueprintPlan.projectsRoot.name },
          },
          clientFolder: {
            id: clientFolderId,
            parentId: accountsRootId,
            path: `${blueprintPlan.accountsRoot.name} / ${project.client_code} — ${project.client_name}`,
          },
          projectFolder: {
            id: projectFolderId,
            rootId: projectsRootId,
            path: `${blueprintPlan.projectsRoot.name} / ${projectYear} / ${projectFolderName}`,
          },
          projectFolders: blueprintPlan.projectFolderPaths.map((path) => (
            `${blueprintPlan.projectsRoot.name} / ${projectYear} / ${projectFolderName} / ${path.join(" / ")}`
          )),
        },
      }, { status: 201 });
    }

    const provisioned = await drive!.provisionProjectFolders({
      client: { id: project.client_id, code: project.client_code, name: project.client_name },
      project: { id: project.id, number: project.project_number, name: project.name, year: projectYear },
      blueprint,
    });
    const completedAt = Date.now();
    const completionResults = await env.DB.batch([
      env.DB.prepare(`INSERT INTO drive_folder_mappings (id, connection_key, entity_type, entity_id, folder_key, drive_file_id, parent_drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, 'client', ?, 'client-root', ?, NULL, ?, ?, ? WHERE ${OPERATION_LEASE_EXISTS} ON CONFLICT(connection_key, entity_type, entity_id, folder_key) DO UPDATE SET drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), config.connectionKey, project.client_id, provisioned.clientFolder.id, provisioned.clientFolder.url, completedAt, completedAt, operationKey, leaseExpiresAt),
      env.DB.prepare(`INSERT INTO drive_folder_mappings (id, connection_key, entity_type, entity_id, folder_key, drive_file_id, parent_drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, 'project', ?, 'project-root', ?, NULL, ?, ?, ? WHERE ${OPERATION_LEASE_EXISTS} ON CONFLICT(connection_key, entity_type, entity_id, folder_key) DO UPDATE SET drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), config.connectionKey, project.id, provisioned.projectFolder.id, provisioned.projectFolder.url, completedAt, completedAt, operationKey, leaseExpiresAt),
      env.DB.prepare(`INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, 'google_drive.folder_provisioned', ?, ?, ? WHERE ${OPERATION_LEASE_EXISTS}`)
        .bind(crypto.randomUUID(), project.id, auth.user.email, "Project workspace created in the company Google Shared Drive", completedAt, operationKey, leaseExpiresAt),
      integrationEventStatement(config.connectionKey, "drive.project_folder_provisioned", auth.user.email, "project", project.id, "mode=workspace", operationKey, leaseExpiresAt),
      env.DB.prepare("UPDATE google_drive_operations SET status = 'completed', lease_expires_at = NULL, last_error_code = NULL, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
        .bind(completedAt, operationKey, leaseExpiresAt),
    ]);
    assertLeaseCompleted(completionResults.at(-1));
    const sheetSync = await trySyncGoogleDirectory(config, auth.user.email);
    return noStore({ created: true, driveFolderId: provisioned.projectFolder.id, driveUrl: provisioned.projectFolder.url, environment: config.environment, sheetSync }, { status: 201 });
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "provision_failed";
    await env.DB.batch([
      integrationEventStatement(config.connectionKey, "drive.project_folder_failed", auth.user.email, "project", project.id, code, operationKey, leaseExpiresAt),
      env.DB.prepare("UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = ?, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
        .bind(code, Date.now(), operationKey, leaseExpiresAt),
    ]);
    return errorResponse(error);
  }
}
