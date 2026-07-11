import { env } from "cloudflare:workers";

export async function ensureWorkspaceSchema() {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, client_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', industry TEXT, drive_folder_id TEXT, drive_url TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS clients_name_idx ON clients(name)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT, is_primary INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS contacts_client_idx ON contacts(client_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, project_number TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planning', site TEXT, project_manager TEXT, estimated_value INTEGER, drive_folder_id TEXT, drive_url TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS projects_client_idx ON projects(client_id, updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS filing_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL, match_summary TEXT NOT NULL, action TEXT NOT NULL, target_category TEXT NOT NULL, approval_required INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS filing_rules_priority_idx ON filing_rules(priority)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS workspace_settings (id TEXT PRIMARY KEY, shared_drive_id TEXT, client_directory_sheet_id TEXT, intake_mailbox TEXT, settings_json TEXT NOT NULL DEFAULT '{}', updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mail_items (id TEXT PRIMARY KEY, gmail_message_id TEXT, gmail_thread_id TEXT, client_id TEXT, suggested_project_id TEXT, approved_project_id TEXT, status TEXT NOT NULL, match_reason TEXT, email_drive_file_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS mail_items_status_idx ON mail_items(status, updated_at)"),
  ]);
}

export function actorFrom(headers: Headers) {
  return headers.get("oai-authenticated-user-email") ?? "local-user";
}
