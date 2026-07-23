/**
 * Immutable production PostgreSQL migration v7 for the settings,
 * preferences, filing-rule, and mail-item repository ports.
 *
 * The migration is source-only until the owner approves a production-platform
 * apply. Keep each entry to one top-level statement so the migration runner
 * owns the transaction boundary.
 */
export const SETTINGS_PERSISTENCE_STATEMENTS = [
  `
CREATE TABLE workspace_settings (
  id text CONSTRAINT workspace_settings_pkey PRIMARY KEY,
  shared_drive_id text,
  client_directory_sheet_id text,
  intake_mailbox text,
  settings_json jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT workspace_settings_id_check CHECK (
    pg_catalog.btrim(id) <> ''
    AND pg_catalog.char_length(id) <= 128
    AND id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT workspace_settings_shared_drive_id_check CHECK (
    shared_drive_id IS NULL OR (
      pg_catalog.btrim(shared_drive_id) <> ''
      AND pg_catalog.char_length(shared_drive_id) <= 512
      AND shared_drive_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT workspace_settings_client_directory_sheet_id_check CHECK (
    client_directory_sheet_id IS NULL OR (
      pg_catalog.btrim(client_directory_sheet_id) <> ''
      AND pg_catalog.char_length(client_directory_sheet_id) <= 512
      AND client_directory_sheet_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT workspace_settings_intake_mailbox_check CHECK (
    intake_mailbox IS NULL OR (
      pg_catalog.char_length(intake_mailbox) <= 254
      AND intake_mailbox = pg_catalog.lower(intake_mailbox)
      AND intake_mailbox ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      AND intake_mailbox !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT workspace_settings_json_check CHECK (
    pg_catalog.jsonb_typeof(settings_json) = 'object'
  ),
  CONSTRAINT workspace_settings_updated_by_check CHECK (
    pg_catalog.btrim(updated_by) <> ''
    AND pg_catalog.char_length(updated_by) <= 320
    AND updated_by !~ '[[:cntrl:]]'
  )
)
  `.trim(),
  `
CREATE TABLE user_preferences (
  user_email text CONSTRAINT user_preferences_pkey PRIMARY KEY,
  display_timezone text NOT NULL,
  reply_signature text NOT NULL DEFAULT '',
  notification_preferences_json jsonb NOT NULL DEFAULT '{"lead.created":false,"gmail.filing_review_needed":false,"calendar.schedule_changed":false,"project.warranty_follow_up_due":false}'::jsonb,
  page_layouts_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL,
  CONSTRAINT user_preferences_user_email_check CHECK (
    pg_catalog.char_length(user_email) <= 254
    AND user_email = pg_catalog.lower(user_email)
    AND user_email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
    AND user_email !~ '[[:cntrl:]]'
  ),
  CONSTRAINT user_preferences_display_timezone_check CHECK (
    pg_catalog.btrim(display_timezone) <> ''
    AND pg_catalog.char_length(display_timezone) <= 80
    AND display_timezone !~ '[[:cntrl:]]'
  ),
  CONSTRAINT user_preferences_reply_signature_check CHECK (
    pg_catalog.char_length(reply_signature) <= 2000
    AND pg_catalog.translate(
      reply_signature,
      pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
      ''
    ) !~ '[[:cntrl:]]'
  ),
  CONSTRAINT user_preferences_notification_preferences_json_check CHECK (
    pg_catalog.jsonb_typeof(notification_preferences_json) = 'object'
  ),
  CONSTRAINT user_preferences_page_layouts_json_check CHECK (
    pg_catalog.jsonb_typeof(page_layouts_json) = 'object'
  )
)
  `.trim(),
  `
CREATE TABLE filing_rules (
  id text CONSTRAINT filing_rules_pkey PRIMARY KEY,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL,
  match_summary text NOT NULL,
  action text NOT NULL,
  target_category text NOT NULL,
  approval_required boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT filing_rules_id_check CHECK (
    pg_catalog.btrim(id) <> ''
    AND pg_catalog.char_length(id) <= 128
    AND id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT filing_rules_name_check CHECK (
    pg_catalog.btrim(name) <> ''
    AND pg_catalog.char_length(name) <= 120
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT filing_rules_priority_check CHECK (priority BETWEEN 1 AND 999),
  CONSTRAINT filing_rules_match_summary_check CHECK (
    pg_catalog.btrim(match_summary) <> ''
    AND pg_catalog.char_length(match_summary) <= 600
    AND match_summary !~ '[[:cntrl:]]'
  ),
  CONSTRAINT filing_rules_action_check CHECK (
    action IN ('suggest', 'review', 'ignore')
  ),
  CONSTRAINT filing_rules_target_category_check CHECK (
    pg_catalog.btrim(target_category) <> ''
    AND pg_catalog.char_length(target_category) <= 160
    AND target_category !~ '[[:cntrl:]]'
  ),
  CONSTRAINT filing_rules_created_by_check CHECK (
    pg_catalog.btrim(created_by) <> ''
    AND pg_catalog.char_length(created_by) <= 320
    AND created_by !~ '[[:cntrl:]]'
  ),
  CONSTRAINT filing_rules_timestamps_check CHECK (updated_at >= created_at)
)
  `.trim(),
  "CREATE INDEX filing_rules_priority_created_at_idx ON filing_rules (priority, created_at, id)",
  `
CREATE TABLE mail_items (
  id text CONSTRAINT mail_items_pkey PRIMARY KEY,
  gmail_message_id text,
  gmail_thread_id text,
  client_id uuid,
  suggested_project_id uuid,
  approved_project_id uuid,
  status text NOT NULL,
  match_reason text,
  email_drive_file_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT mail_items_id_check CHECK (
    pg_catalog.btrim(id) <> ''
    AND pg_catalog.char_length(id) <= 512
    AND id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mail_items_gmail_message_id_check CHECK (
    gmail_message_id IS NULL OR (
      pg_catalog.btrim(gmail_message_id) <> ''
      AND pg_catalog.char_length(gmail_message_id) <= 512
      AND gmail_message_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT mail_items_gmail_thread_id_check CHECK (
    gmail_thread_id IS NULL OR (
      pg_catalog.btrim(gmail_thread_id) <> ''
      AND pg_catalog.char_length(gmail_thread_id) <= 512
      AND gmail_thread_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT mail_items_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT mail_items_suggested_project_id_fkey FOREIGN KEY (suggested_project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT mail_items_approved_project_id_fkey FOREIGN KEY (approved_project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT mail_items_status_check CHECK (
    pg_catalog.btrim(status) <> ''
    AND pg_catalog.char_length(status) <= 80
    AND status !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mail_items_match_reason_check CHECK (
    match_reason IS NULL OR (
      pg_catalog.btrim(match_reason) <> ''
      AND pg_catalog.char_length(match_reason) <= 1000
      AND pg_catalog.translate(
        match_reason,
        pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
        ''
      ) !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT mail_items_email_drive_file_id_check CHECK (
    email_drive_file_id IS NULL OR (
      pg_catalog.btrim(email_drive_file_id) <> ''
      AND pg_catalog.char_length(email_drive_file_id) <= 512
      AND email_drive_file_id !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT mail_items_timestamps_check CHECK (updated_at >= created_at)
)
  `.trim(),
  "CREATE INDEX mail_items_status_updated_at_idx ON mail_items (status, updated_at DESC, id)",
  "CREATE INDEX mail_items_client_id_idx ON mail_items (client_id)",
  "CREATE INDEX mail_items_suggested_project_id_idx ON mail_items (suggested_project_id)",
  "CREATE INDEX mail_items_approved_project_id_idx ON mail_items (approved_project_id)",
] as const;
