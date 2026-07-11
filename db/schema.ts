import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
