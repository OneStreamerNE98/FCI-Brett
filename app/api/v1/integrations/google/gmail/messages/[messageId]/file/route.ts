import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { GoogleDriveClient } from "../../../../../../../../lib/google-drive";
import { gmailAttachmentArtifactKey } from "../../../../../../../../lib/google-gmail-artifacts";
import {
  gmailArchiveApprovedIntegrationEvent,
  gmailArchiveFailedIntegrationEvent,
  gmailArchiveFiledIntegrationEvent,
  type GoogleIntegrationEventSpec,
} from "../../../../../../../../lib/google-integration-events";
import { GoogleIntegrationError, getGoogleAccessToken, type GoogleRuntimeConfig } from "../../../../../../../../lib/google-oauth-sites";
import { validateGmailMessageId } from "../../../../../../../../lib/google-gmail";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../../lib/workspace-auth";
import { getWorkspaceGmailClient, gmailErrorResponse, readBoundedJson } from "../../../_route-helpers";

const EMAIL_ARCHIVE_PATH = ["05_Correspondence", "Email Archive"] as const;
const EMAIL_ATTACHMENTS_PATH = ["05_Correspondence", "Email Attachments"] as const;
const FILING_LEASE_MS = 5 * 60 * 1000;
const FILING_LEASE_EXISTS = "EXISTS (SELECT 1 FROM google_drive_operations WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?)";

type FilingLease = Readonly<{
  operationKey: string;
  leaseExpiresAt: number;
}>;

type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  client_name: string;
};

type DriveMappingRow = { drive_file_id: string; drive_url: string };

type ArchiveRow = {
  id: string;
  project_id: string;
  status: string;
  email_drive_file_id: string | null;
  email_drive_url: string | null;
  attachment_count: number;
  filed_at: number | null;
};

type ArchiveProjectContext = {
  project: ProjectRow;
  projectRoot: DriveMappingRow;
  emailArchiveFolder: { id: string; name: string; webViewLink?: string };
  attachmentFolder: { id: string; name: string; webViewLink?: string };
  drive: GoogleDriveClient | null;
};

function projectId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new GoogleIntegrationError("invalid_project", "Choose a valid project before filing this email.", 400);
  }
  return value;
}

function compactErrorCode(error: unknown) {
  return error instanceof GoogleIntegrationError ? error.code : "gmail_file_archive_failed";
}

function errorResponse(error: unknown) {
  if (error instanceof GoogleIntegrationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "The email could not be filed. Nothing was automatically moved; retry after reviewing the project workspace." }, { status: 503 });
}

function integrationEventStatement(
  config: GoogleRuntimeConfig,
  actor: string,
  event: GoogleIntegrationEventSpec,
  createdAt: number,
  lease: FilingLease,
) {
  return env.DB.prepare(`INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS}`)
    .bind(
      crypto.randomUUID(),
      config.connectionKey,
      event.eventType,
      actor,
      event.entityType,
      event.entityId,
      event.detail,
      createdAt,
      lease.operationKey,
      lease.leaseExpiresAt,
    );
}

function leaseLostError() {
  return new GoogleIntegrationError(
    "gmail_file_lease_lost",
    "This email filing request expired while provider work was still running. Refresh before retrying; stable source identities prevent duplicate Drive files.",
    409,
  );
}

function leaseGuardStatement(lease: FilingLease, updatedAt: number) {
  return env.DB.prepare("UPDATE google_drive_operations SET updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
    .bind(updatedAt, lease.operationKey, lease.leaseExpiresAt);
}

function assertLeaseGuard(result: Readonly<{ meta?: Readonly<{ changes?: number }> }> | undefined) {
  if (result?.meta.changes !== 1) throw leaseLostError();
}

async function sha256Base64Url(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loadProjectContext(config: GoogleRuntimeConfig, selectedProjectId: string): Promise<ArchiveProjectContext> {
  const project = await env.DB.prepare("SELECT p.id, p.project_number, p.name, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?")
    .bind(selectedProjectId)
    .first<ProjectRow>();
  if (!project) throw new GoogleIntegrationError("project_not_found", "The selected project was not found.", 404);

  // Only a root mapped by the active connection profile may be used. Filing never
  // provisions folders: that remains a separate, explicit project setup action.
  const projectRoot = await env.DB.prepare("SELECT drive_file_id, drive_url FROM drive_folder_mappings WHERE connection_key = ? AND entity_type = 'project' AND entity_id = ? AND folder_key = 'project-root'")
    .bind(config.connectionKey, project.id)
    .first<DriveMappingRow>();
  if (!projectRoot) {
    throw new GoogleIntegrationError("project_drive_workspace_required", "Create and verify this project's managed Drive workspace before filing email. No folders were created.", 409);
  }

  if (config.simulation) {
    return {
      project,
      projectRoot,
      emailArchiveFolder: { id: `${projectRoot.drive_file_id}-email-archive`, name: "Email Archive" },
      attachmentFolder: { id: `${projectRoot.drive_file_id}-email-attachments`, name: "Email Attachments" },
      drive: null,
    };
  }
  const drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
  await drive.assertContained(projectRoot.drive_file_id);
  const [emailArchiveFolder, attachmentFolder] = await Promise.all([
    drive.resolveManagedProjectFolderPath(projectRoot.drive_file_id, EMAIL_ARCHIVE_PATH),
    drive.resolveManagedProjectFolderPath(projectRoot.drive_file_id, EMAIL_ATTACHMENTS_PATH),
  ]);
  return { project, projectRoot, emailArchiveFolder, attachmentFolder, drive };
}

async function findArchive(config: GoogleRuntimeConfig, messageId: string) {
  return env.DB.prepare("SELECT id, project_id, status, email_drive_file_id, email_drive_url, attachment_count, filed_at FROM gmail_file_archives WHERE connection_key = ? AND gmail_message_id = ?")
    .bind(config.connectionKey, messageId)
    .first<ArchiveRow>();
}

function assertArchiveProject(archive: ArchiveRow | null, selectedProjectId: string) {
  if (archive && archive.project_id !== selectedProjectId) {
    throw new GoogleIntegrationError("gmail_message_already_assigned", "This email has already been approved for a different independent project and cannot be filed here.", 409);
  }
}

function publicArchive(archive: ArchiveRow | null) {
  if (!archive) return null;
  return {
    status: archive.status,
    filed: archive.status === "filed",
    emailDriveUrl: archive.email_drive_url,
    attachmentCount: archive.attachment_count,
    filedAt: archive.filed_at,
  };
}

/**
 * Read-only review preview. The response intentionally excludes raw message
 * content while allowing the user to verify the exact project and attachments.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  try {
    const { messageId } = await context.params;
    const safeMessageId = validateGmailMessageId(messageId);
    const selectedProjectId = projectId(request.nextUrl.searchParams.get("projectId"));
    const { config, client } = await getWorkspaceGmailClient();
    const [existing, workspace, message] = await Promise.all([
      findArchive(config, safeMessageId),
      loadProjectContext(config, selectedProjectId),
      client.getMessageArchive(safeMessageId),
    ]);
    assertArchiveProject(existing, selectedProjectId);
    return NextResponse.json({
      message: {
        id: message.id,
        threadId: message.threadId,
        from: message.summary.from,
        to: message.summary.to,
        subject: message.summary.subject,
        date: message.summary.date,
        attachmentCount: message.attachments.length,
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          byteSize: attachment.bytes.byteLength,
        })),
      },
      project: {
        id: workspace.project.id,
        number: workspace.project.project_number,
        name: workspace.project.name,
        client: workspace.project.client_name,
      },
      destinations: {
        emailArchive: "05_Correspondence / Email Archive",
        attachments: "05_Correspondence / Email Attachments",
      },
      existing: publicArchive(existing),
      inboxRetained: true,
      environment: config.environment,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return error instanceof GoogleIntegrationError ? errorResponse(error) : gmailErrorResponse(error);
  }
}

/**
 * Explicit review-approved mutation. This copies the original `.eml` and every
 * attachment to a single selected project, then adds FCI/Filed without removing
 * the Gmail Inbox label. All Drive writes use stable source properties so retries
 * resume safely rather than creating duplicate files.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  let archiveId: string | null = null;
  let selectedProjectId: string | null = null;
  let approvalRecorded = false;
  let config: GoogleRuntimeConfig | null = null;
  let lease: FilingLease | null = null;

  try {
    const body = await readBoundedJson(request, 2_000);
    selectedProjectId = projectId(body.projectId);
    const { messageId } = await context.params;
    const safeMessageId = validateGmailMessageId(messageId);
    const gmail = await getWorkspaceGmailClient();
    config = gmail.config;
    const [existing, workspace, message] = await Promise.all([
      findArchive(config, safeMessageId),
      loadProjectContext(config, selectedProjectId),
      gmail.client.getMessageArchive(safeMessageId),
    ]);
    assertArchiveProject(existing, selectedProjectId);
    if (existing?.status === "filed") {
      return NextResponse.json({ filed: true, alreadyFiled: true, archive: publicArchive(existing), inboxRetained: true, environment: config.environment });
    }

    const now = Date.now();
    // The archive identity is connection + Gmail message, so the lease must use
    // the same scope. Including projectId would let cross-project contenders race
    // the single archive row with separate leases.
    const operationKey = `${config.connectionKey}:file-gmail:${safeMessageId}`;
    const operationLeaseExpiresAt = now + FILING_LEASE_MS;
    const operation = await env.DB.prepare("INSERT INTO google_drive_operations (id, connection_key, operation_key, project_id, status, lease_expires_at, last_error_code, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'in-progress', ?, NULL, ?, ?, ?) ON CONFLICT(operation_key) DO UPDATE SET status = 'in-progress', lease_expires_at = excluded.lease_expires_at, last_error_code = NULL, created_by = excluded.created_by, updated_at = excluded.updated_at WHERE google_drive_operations.status != 'in-progress' OR google_drive_operations.lease_expires_at < ?")
      .bind(crypto.randomUUID(), config.connectionKey, operationKey, selectedProjectId, operationLeaseExpiresAt, auth.user.email, now, now, now)
      .run();
    if (operation.meta.changes !== 1) {
      throw new GoogleIntegrationError("gmail_file_in_progress", "This email is already being filed for the selected project. Refresh shortly before trying again.", 409);
    }
    lease = Object.freeze({ operationKey, leaseExpiresAt: operationLeaseExpiresAt });

    // Serialize the archive decision as well as the provider writes. A contender
    // may have completed after our optimistic first read but before lease acquire.
    const lockedExisting = await findArchive(config, safeMessageId);
    assertArchiveProject(lockedExisting, selectedProjectId);
    if (lockedExisting?.status === "filed") {
      const completedAt = Date.now();
      const completed = await env.DB.prepare("UPDATE google_drive_operations SET status = 'completed', lease_expires_at = NULL, last_error_code = NULL, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
        .bind(completedAt, lease.operationKey, lease.leaseExpiresAt)
        .run();
      assertLeaseGuard(completed);
      return NextResponse.json({ filed: true, alreadyFiled: true, archive: publicArchive(lockedExisting), inboxRetained: true, environment: config.environment });
    }
    archiveId = lockedExisting?.id ?? crypto.randomUUID();

    // Record approval and a content-free audit trail before provider work in both
    // modes. Simulation uses the same durable lease and integration-event contract.
    const approvedEvent = gmailArchiveApprovedIntegrationEvent(config.environment, selectedProjectId);
    const approvalResults = await env.DB.batch([
      env.DB.prepare(`INSERT INTO gmail_file_archives (id, connection_key, gmail_message_id, gmail_thread_id, project_id, project_drive_folder_id, email_archive_folder_id, attachment_folder_id, status, approval_actor, approved_at, email_drive_file_id, email_drive_url, attachment_count, last_error_code, filed_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'filing', ?, ?, NULL, NULL, 0, NULL, NULL, ?, ? WHERE ${FILING_LEASE_EXISTS} ON CONFLICT(connection_key, gmail_message_id) DO UPDATE SET gmail_thread_id = excluded.gmail_thread_id, project_id = excluded.project_id, project_drive_folder_id = excluded.project_drive_folder_id, email_archive_folder_id = excluded.email_archive_folder_id, attachment_folder_id = excluded.attachment_folder_id, status = 'filing', approval_actor = excluded.approval_actor, approved_at = excluded.approved_at, last_error_code = NULL, updated_at = excluded.updated_at`)
        .bind(archiveId, config.connectionKey, safeMessageId, message.threadId, selectedProjectId, workspace.projectRoot.drive_file_id, workspace.emailArchiveFolder.id, workspace.attachmentFolder.id, auth.user.email, now, now, now, lease.operationKey, lease.leaseExpiresAt),
      env.DB.prepare(`INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS}`)
        .bind(
          crypto.randomUUID(),
          selectedProjectId,
          config.simulation ? "workspace_simulation.gmail_approved" : "gmail.archive_approved",
          auth.user.email,
          config.simulation
            ? "Simulated review-approved Gmail archive started; no Google data changed"
            : "Review-approved Workspace Gmail archive started",
          now,
          lease.operationKey,
          lease.leaseExpiresAt,
        ),
      integrationEventStatement(config, auth.user.email, approvedEvent, now, lease),
      leaseGuardStatement(lease, now),
    ]);
    assertLeaseGuard(approvalResults.at(-1));
    approvalRecorded = true;

    let filedEmailDriveUrl: string;
    let filedAttachmentCount: number;
    let responseAttachments: Array<Record<string, unknown>>;

    if (config.simulation) {
      const emailDriveFileId = `sim-email-${safeMessageId}`;
      const emailDriveUrl = `${request.nextUrl.origin}/?workspace-simulation=email&message=${encodeURIComponent(safeMessageId)}`;
      const attachmentRows = await Promise.all(message.attachments.map(async (attachment) => {
        const contentSha256 = await sha256Base64Url(attachment.bytes);
        const artifactKey = gmailAttachmentArtifactKey(attachment.partId, contentSha256);
        return {
          id: crypto.randomUUID(),
          artifactKey,
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          byteSize: attachment.bytes.byteLength,
          sha256: contentSha256,
          driveFileId: `sim-attachment-${safeMessageId}-${artifactKey}`,
          driveUrl: `${request.nextUrl.origin}/?workspace-simulation=attachment&message=${encodeURIComponent(safeMessageId)}&artifact=${encodeURIComponent(artifactKey)}`,
        };
      }));
      const copiedAt = Date.now();
      const copyResults = await env.DB.batch([
        env.DB.prepare(`INSERT INTO gmail_file_archive_artifacts (id, archive_id, artifact_key, kind, gmail_attachment_id, original_filename, mime_type, byte_size, sha256, drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, 'original-eml', 'email', NULL, NULL, 'message/rfc822', ?, NULL, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS} ON CONFLICT(archive_id, artifact_key) DO UPDATE SET byte_size = excluded.byte_size, drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), archiveId, message.raw.bytes.byteLength, emailDriveFileId, emailDriveUrl, copiedAt, copiedAt, lease.operationKey, lease.leaseExpiresAt),
        ...attachmentRows.map((attachment) => env.DB.prepare(`INSERT INTO gmail_file_archive_artifacts (id, archive_id, artifact_key, kind, gmail_attachment_id, original_filename, mime_type, byte_size, sha256, drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, ?, 'attachment', ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS} ON CONFLICT(archive_id, artifact_key) DO UPDATE SET gmail_attachment_id = excluded.gmail_attachment_id, original_filename = excluded.original_filename, mime_type = excluded.mime_type, byte_size = excluded.byte_size, sha256 = excluded.sha256, drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
          .bind(attachment.id, archiveId, attachment.artifactKey, attachment.attachmentId, attachment.filename, attachment.mimeType, attachment.byteSize, attachment.sha256, attachment.driveFileId, attachment.driveUrl, copiedAt, copiedAt, lease.operationKey, lease.leaseExpiresAt)),
        env.DB.prepare(`UPDATE gmail_file_archives SET status = 'drive-complete', email_drive_file_id = ?, email_drive_url = ?, attachment_count = ?, last_error_code = NULL, updated_at = ? WHERE id = ? AND ${FILING_LEASE_EXISTS}`)
          .bind(emailDriveFileId, emailDriveUrl, attachmentRows.length, copiedAt, archiveId, lease.operationKey, lease.leaseExpiresAt),
        leaseGuardStatement(lease, copiedAt),
      ]);
      assertLeaseGuard(copyResults.at(-1));
      filedEmailDriveUrl = emailDriveUrl;
      filedAttachmentCount = attachmentRows.length;
      responseAttachments = attachmentRows.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        driveUrl: attachment.driveUrl,
      }));
    } else {
      const emailArtifactKey = "original-eml";
      const emailUpload = await workspace.drive!.findOrUploadManagedFile({
        parentId: workspace.emailArchiveFolder.id,
        name: `FCI-${workspace.project.project_number}-${safeMessageId}.eml`,
        mimeType: "message/rfc822",
        bytes: message.raw.bytes,
        appProperties: {
          fciArchiveId: archiveId,
          fciArtifactKey: emailArtifactKey,
          fciArchiveKind: "email-eml",
          fciProjectId: selectedProjectId,
          fciGmailMessageId: safeMessageId,
        },
      });
      const attachmentUploads = [] as Array<{
        artifactKey: string;
        attachmentId: string | null;
        originalFilename: string | null;
        filename: string;
        mimeType: string;
        byteSize: number;
        sha256: string;
        driveFileId: string;
        driveUrl: string;
      }>;
      for (const attachment of message.attachments) {
        const contentSha256 = await sha256Base64Url(attachment.bytes);
        const artifactKey = gmailAttachmentArtifactKey(attachment.partId, contentSha256);
        const upload = await workspace.drive!.findOrUploadManagedFile({
          parentId: workspace.attachmentFolder.id,
          name: attachment.filename,
          mimeType: attachment.mimeType,
          bytes: attachment.bytes,
          appProperties: {
            fciArchiveId: archiveId,
            fciArtifactKey: artifactKey,
            fciArchiveKind: "attachment",
            fciProjectId: selectedProjectId,
            fciGmailMessageId: safeMessageId,
          },
        });
        attachmentUploads.push({
          artifactKey,
          attachmentId: attachment.attachmentId,
          originalFilename: attachment.originalFilename,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          byteSize: attachment.bytes.byteLength,
          sha256: contentSha256,
          driveFileId: upload.file.id,
          driveUrl: upload.file.url,
        });
      }

      const copiedAt = Date.now();
      const copyResults = await env.DB.batch([
        env.DB.prepare(`INSERT INTO gmail_file_archive_artifacts (id, archive_id, artifact_key, kind, gmail_attachment_id, original_filename, mime_type, byte_size, sha256, drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, 'original-eml', 'email', NULL, NULL, 'message/rfc822', ?, ?, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS} ON CONFLICT(archive_id, artifact_key) DO UPDATE SET byte_size = excluded.byte_size, sha256 = excluded.sha256, drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), archiveId, message.raw.bytes.byteLength, await sha256Base64Url(message.raw.bytes), emailUpload.file.id, emailUpload.file.url, copiedAt, copiedAt, lease.operationKey, lease.leaseExpiresAt),
        ...attachmentUploads.map((attachment) => env.DB.prepare(`INSERT INTO gmail_file_archive_artifacts (id, archive_id, artifact_key, kind, gmail_attachment_id, original_filename, mime_type, byte_size, sha256, drive_file_id, drive_url, created_at, updated_at) SELECT ?, ?, ?, 'attachment', ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS} ON CONFLICT(archive_id, artifact_key) DO UPDATE SET gmail_attachment_id = excluded.gmail_attachment_id, original_filename = excluded.original_filename, mime_type = excluded.mime_type, byte_size = excluded.byte_size, sha256 = excluded.sha256, drive_file_id = excluded.drive_file_id, drive_url = excluded.drive_url, updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), archiveId, attachment.artifactKey, attachment.attachmentId, attachment.originalFilename ?? attachment.filename, attachment.mimeType, attachment.byteSize, attachment.sha256, attachment.driveFileId, attachment.driveUrl, copiedAt, copiedAt, lease.operationKey, lease.leaseExpiresAt)),
        env.DB.prepare(`UPDATE gmail_file_archives SET status = 'drive-complete', email_drive_file_id = ?, email_drive_url = ?, attachment_count = ?, last_error_code = NULL, updated_at = ? WHERE id = ? AND ${FILING_LEASE_EXISTS}`)
          .bind(emailUpload.file.id, emailUpload.file.url, attachmentUploads.length, copiedAt, archiveId, lease.operationKey, lease.leaseExpiresAt),
        leaseGuardStatement(lease, copiedAt),
      ]);
      assertLeaseGuard(copyResults.at(-1));
      filedEmailDriveUrl = emailUpload.file.url;
      filedAttachmentCount = attachmentUploads.length;
      responseAttachments = attachmentUploads.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        driveUrl: attachment.driveUrl,
      }));
    }

    // Both modes share the same final label ordering, durable state transition,
    // audit contract, and exact lease completion.
    await gmail.client.applyFiledLabel(safeMessageId);
    const filedAt = Date.now();
    const filedEvent = gmailArchiveFiledIntegrationEvent(config.environment, selectedProjectId, filedAttachmentCount);
    const finalResults = await env.DB.batch([
      env.DB.prepare(`UPDATE gmail_file_archives SET status = 'filed', filed_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ? AND ${FILING_LEASE_EXISTS}`)
        .bind(filedAt, filedAt, archiveId, lease.operationKey, lease.leaseExpiresAt),
      env.DB.prepare(`INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS}`)
        .bind(
          crypto.randomUUID(),
          selectedProjectId,
          config.simulation ? "workspace_simulation.gmail_filed" : "gmail.archive_filed",
          auth.user.email,
          config.simulation
            ? `Simulated Gmail archive completed with ${filedAttachmentCount} attachment(s); Inbox retained`
            : `Review-approved Workspace Gmail archive completed with ${filedAttachmentCount} attachment(s); inbox retained`,
          filedAt,
          lease.operationKey,
          lease.leaseExpiresAt,
        ),
      integrationEventStatement(config, auth.user.email, filedEvent, filedAt, lease),
      env.DB.prepare("UPDATE google_drive_operations SET status = 'completed', lease_expires_at = NULL, last_error_code = NULL, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
        .bind(filedAt, lease.operationKey, lease.leaseExpiresAt),
    ]);
    assertLeaseGuard(finalResults.at(-1));

    return NextResponse.json({
      filed: true,
      alreadyFiled: false,
      ...(config.simulation ? { simulated: true } : {}),
      archive: {
        status: "filed",
        emailDriveUrl: filedEmailDriveUrl,
        attachmentCount: filedAttachmentCount,
        attachments: responseAttachments,
      },
      inboxRetained: true,
      environment: config.environment,
    });
  } catch (error) {
    const code = compactErrorCode(error);
    if (lease && config) {
      const failedAt = Date.now();
      try {
        if (approvalRecorded && archiveId && selectedProjectId) {
          const failedEvent = gmailArchiveFailedIntegrationEvent(config.environment, selectedProjectId, code);
          await env.DB.batch([
            env.DB.prepare(`UPDATE gmail_file_archives SET status = 'failed', last_error_code = ?, updated_at = ? WHERE id = ? AND ${FILING_LEASE_EXISTS}`)
              .bind(code, failedAt, archiveId, lease.operationKey, lease.leaseExpiresAt),
            env.DB.prepare(`INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${FILING_LEASE_EXISTS}`)
              .bind(
                crypto.randomUUID(),
                selectedProjectId,
                config.simulation ? "workspace_simulation.gmail_failed" : "gmail.archive_failed",
                auth.user.email,
                `Review-approved Gmail archive stopped; code=${code}; no Inbox label was removed`,
                failedAt,
                lease.operationKey,
                lease.leaseExpiresAt,
              ),
            integrationEventStatement(config, auth.user.email, failedEvent, failedAt, lease),
            env.DB.prepare("UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = ?, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
              .bind(code, failedAt, lease.operationKey, lease.leaseExpiresAt),
          ]);
        } else {
          await env.DB.prepare("UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = ?, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
            .bind(code, failedAt, lease.operationKey, lease.leaseExpiresAt)
            .run();
        }
      } catch {
        // Preserve the original integration error. Stable Drive properties and the
        // operation lease make the next user-approved retry safe to resume.
      }
    }
    return error instanceof GoogleIntegrationError ? errorResponse(error) : gmailErrorResponse(error);
  }
}
