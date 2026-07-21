import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const records = sqliteTable("records", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  projectId: text("project_id"),
  status: text("status").notNull().default("active"),
  payload: text("payload", { mode: "json" }).notNull(),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("records_type_idx").on(table.type, table.updatedAt),
]);

export const activityEvents = sqliteTable("activity_events", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const webhookReceipts = sqliteTable("webhook_receipts", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  clientCode: text("client_code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  industry: text("industry"),
  driveFolderId: text("drive_folder_id"),
  driveUrl: text("drive_url"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("clients_code_unique_idx").on(table.clientCode),
  uniqueIndex("clients_name_idx").on(table.name),
]);

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("contacts_client_idx").on(table.clientId),
]);

/** Durable sales opportunities captured before they become client projects. */
export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  leadNumber: text("lead_number").notNull(),
  company: text("company").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  projectName: text("project_name").notNull(),
  source: text("source").notNull(),
  stage: text("stage").notNull(),
  site: text("site").notNull(),
  estimatedValue: integer("estimated_value").notNull(),
  nextAction: text("next_action").notNull(),
  nextActionAt: integer("next_action_at", { mode: "timestamp_ms" }),
  ownerEmail: text("owner_email").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("leads_number_unique").on(table.leadNumber),
  index("leads_status_updated_idx").on(table.status, table.updatedAt),
  index("leads_stage_updated_idx").on(table.stage, table.updatedAt),
]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  projectNumber: text("project_number").notNull(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("planning"),
  site: text("site"),
  projectManager: text("project_manager"),
  estimatedValue: integer("estimated_value"),
  flooringCategory: text("flooring_category"),
  squareFeet: integer("square_feet"),
  contractValue: integer("contract_value"),
  driveFolderId: text("drive_folder_id"),
  driveUrl: text("drive_url"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("projects_number_unique_idx").on(table.projectNumber),
  index("projects_client_idx").on(table.clientId, table.updatedAt),
]);

/** Project-specific meeting notes, including manual or Otter-derived evidence. */
export const projectMeetings = sqliteTable("project_meetings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  meetingAt: integer("meeting_at", { mode: "timestamp_ms" }).notNull(),
  meetingType: text("meeting_type").notNull(),
  sourceProvider: text("source_provider").notNull(),
  sourceUrl: text("source_url"),
  attendeesJson: text("attendees_json", { mode: "json" }).notNull(),
  notes: text("notes"),
  transcript: text("transcript"),
  summary: text("summary"),
  decisions: text("decisions"),
  actionItemsJson: text("action_items_json", { mode: "json" }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("project_meetings_project_date_idx").on(table.projectId, table.meetingAt),
]);

export const filingRules = sqliteTable("filing_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull(),
  matchSummary: text("match_summary").notNull(),
  action: text("action").notNull(),
  targetCategory: text("target_category").notNull(),
  approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("filing_rules_priority_idx").on(table.priority),
]);

export const workspaceSettings = sqliteTable("workspace_settings", {
  id: text("id").primaryKey(),
  sharedDriveId: text("shared_drive_id"),
  clientDirectorySheetId: text("client_directory_sheet_id"),
  intakeMailbox: text("intake_mailbox"),
  settingsJson: text("settings_json", { mode: "json" }).notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const userPreferences = sqliteTable("user_preferences", {
  userEmail: text("user_email").primaryKey(),
  displayTimezone: text("display_timezone").notNull(),
  replySignature: text("reply_signature").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const mailItems = sqliteTable("mail_items", {
  id: text("id").primaryKey(),
  gmailMessageId: text("gmail_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  clientId: text("client_id"),
  suggestedProjectId: text("suggested_project_id"),
  approvedProjectId: text("approved_project_id"),
  status: text("status").notNull(),
  matchReason: text("match_reason"),
  emailDriveFileId: text("email_drive_file_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("mail_items_status_idx").on(table.status, table.updatedAt),
]);

/**
 * A review-approved archive of one Gmail message into exactly one project.
 *
 * This deliberately lives beside the earlier suggestion-only `mail_items` table:
 * the archive record is an immutable operational decision with its own Drive
 * evidence and retry state, rather than a loose inbox match.
 */
export const gmailFileArchives = sqliteTable("gmail_file_archives", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull(),
  gmailMessageId: text("gmail_message_id").notNull(),
  gmailThreadId: text("gmail_thread_id"),
  projectId: text("project_id").notNull(),
  projectDriveFolderId: text("project_drive_folder_id").notNull(),
  emailArchiveFolderId: text("email_archive_folder_id").notNull(),
  attachmentFolderId: text("attachment_folder_id").notNull(),
  status: text("status").notNull(),
  approvalActor: text("approval_actor").notNull(),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }).notNull(),
  emailDriveFileId: text("email_drive_file_id"),
  emailDriveUrl: text("email_drive_url"),
  attachmentCount: integer("attachment_count").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  filedAt: integer("filed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  // One Gmail message belongs to one explicit project in a connection profile.
  // This prevents accidental reuse across a repeat client's independent jobs.
  uniqueIndex("gmail_file_archives_profile_message_unique").on(table.connectionKey, table.gmailMessageId),
  index("gmail_file_archives_project_status_idx").on(table.connectionKey, table.projectId, table.status, table.updatedAt),
]);

/** Individual `.eml` and attachment files copied for a Gmail archive. */
export const gmailFileArchiveArtifacts = sqliteTable("gmail_file_archive_artifacts", {
  id: text("id").primaryKey(),
  archiveId: text("archive_id").notNull(),
  artifactKey: text("artifact_key").notNull(),
  kind: text("kind").notNull(),
  gmailAttachmentId: text("gmail_attachment_id"),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256"),
  driveFileId: text("drive_file_id").notNull(),
  driveUrl: text("drive_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("gmail_file_archive_artifacts_archive_key_unique").on(table.archiveId, table.artifactKey),
  index("gmail_file_archive_artifacts_archive_idx").on(table.archiveId, table.kind),
]);

export const googleOauthAttempts = sqliteTable("google_oauth_attempts", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull(),
  stateHash: text("state_hash").notNull().unique(),
  pkceVerifierCiphertext: text("pkce_verifier_ciphertext").notNull(),
  browserNonceHash: text("browser_nonce_hash").notNull(),
  initiatedBy: text("initiated_by").notNull(),
  scopesJson: text("scopes_json", { mode: "json" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const googleConnections = sqliteTable("google_connections", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull().unique(),
  googleSubject: text("google_subject").notNull(),
  googleEmail: text("google_email").notNull(),
  scopesJson: text("scopes_json", { mode: "json" }).notNull(),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  keyVersion: text("key_version").notNull(),
  status: text("status").notNull().default("connected"),
  lastErrorCode: text("last_error_code"),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

/** App-managed Google Workspace resource IDs for the controlled development connector. */
export const workspaceResources = sqliteTable("workspace_resources", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceKey: text("resource_key").notNull(),
  externalId: text("external_id").notNull(),
  parentExternalId: text("parent_external_id"),
  externalUrl: text("external_url"),
  origin: text("origin").notNull(),
  metadataJson: text("metadata_json", { mode: "json" }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("workspace_resources_connection_type_key_unique").on(
    table.connectionKey,
    table.resourceType,
    table.resourceKey,
  ),
]);

export const driveFolderMappings = sqliteTable("drive_folder_mappings", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  folderKey: text("folder_key").notNull(),
  driveFileId: text("drive_file_id").notNull().unique(),
  parentDriveFileId: text("parent_drive_file_id"),
  driveUrl: text("drive_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("drive_folder_mappings_profile_entity_folder_unique").on(table.connectionKey, table.entityType, table.entityId, table.folderKey),
]);

export const googleDriveOperations = sqliteTable("google_drive_operations", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull(),
  operationKey: text("operation_key").notNull().unique(),
  projectId: text("project_id").notNull(),
  status: text("status").notNull(),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
  lastErrorCode: text("last_error_code"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Per-profile state for the generated Google Sheets client/project directory mirror. */
export const googleSheetSyncState = sqliteTable("google_sheet_sync_state", {
  connectionKey: text("connection_key").notNull(),
  entityType: text("entity_type").notNull(),
  status: text("status").notNull(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("google_sheet_sync_state_profile_entity_unique").on(table.connectionKey, table.entityType),
]);

export const googleIntegrationEvents = sqliteTable("google_integration_events", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull(),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("google_integration_events_created_idx").on(table.createdAt),
]);

/** Durable local-only fixtures used by Workspace simulation mode. */
export const workspaceSimulationState = sqliteTable("workspace_simulation_state", {
  id: text("id").primaryKey(),
  stateJson: text("state_json", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
