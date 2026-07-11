import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const records = sqliteTable("records", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  projectId: text("project_id"),
  status: text("status").notNull().default("active"),
  payload: text("payload", { mode: "json" }).notNull(),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

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
});

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
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  projectNumber: text("project_number").notNull(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("planning"),
  site: text("site"),
  projectManager: text("project_manager"),
  estimatedValue: integer("estimated_value"),
  driveFolderId: text("drive_folder_id"),
  driveUrl: text("drive_url"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

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
});

export const workspaceSettings = sqliteTable("workspace_settings", {
  id: text("id").primaryKey(),
  sharedDriveId: text("shared_drive_id"),
  clientDirectorySheetId: text("client_directory_sheet_id"),
  intakeMailbox: text("intake_mailbox"),
  settingsJson: text("settings_json", { mode: "json" }).notNull(),
  updatedBy: text("updated_by").notNull(),
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
});

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

export const googleIntegrationEvents = sqliteTable("google_integration_events", {
  id: text("id").primaryKey(),
  connectionKey: text("connection_key").notNull(),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
