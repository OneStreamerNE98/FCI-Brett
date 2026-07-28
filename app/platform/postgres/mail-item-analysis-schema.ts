/**
 * Immutable production PostgreSQL migration v12 for AI-10's durable inbox
 * analysis envelope. Migration v7 remains byte-for-byte unchanged.
 *
 * Keep each entry to one top-level statement so the migration runner owns the
 * transaction boundary.
 */
export const MAIL_ITEM_ANALYSIS_SCHEMA_STATEMENTS = [
  "ALTER TABLE mail_items ADD COLUMN connection_key text NOT NULL DEFAULT 'google-workspace'",
  "ALTER TABLE mail_items ADD COLUMN analysis_payload jsonb",
  "ALTER TABLE mail_items ADD COLUMN party text",
  "ALTER TABLE mail_items ADD COLUMN confidence text",
  "ALTER TABLE mail_items ADD COLUMN content_hash text",
  "ALTER TABLE mail_items ADD COLUMN label_definition_version text",
  "ALTER TABLE mail_items ADD COLUMN attempted_label_definition_version text",
  "ALTER TABLE mail_items ADD COLUMN subject text",
  "ALTER TABLE mail_items ADD COLUMN sender text",
  "ALTER TABLE mail_items ADD COLUMN received_at timestamptz",
  "ALTER TABLE mail_items ADD COLUMN failure_attempts integer NOT NULL DEFAULT 0",
  "ALTER TABLE mail_items ADD COLUMN error_code text",
  "ALTER TABLE mail_items ADD COLUMN coverage_complete boolean NOT NULL DEFAULT false",
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_connection_key_check CHECK (
    connection_key ~ '^[a-z][a-z0-9_-]{0,127}$'
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_analysis_payload_check CHECK (
    analysis_payload IS NULL OR (
      pg_catalog.jsonb_typeof(analysis_payload) = 'object'
      AND pg_catalog.octet_length(analysis_payload::text) <= 32000
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_party_check CHECK (
    party IS NULL OR party IN ('client', 'prospect', 'vendor', 'employee', 'unknown')
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_confidence_check CHECK (
    confidence IS NULL OR confidence IN ('high', 'medium', 'low')
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_content_hash_check CHECK (
    content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_label_definition_version_check CHECK (
    label_definition_version IS NULL OR (
      pg_catalog.btrim(label_definition_version) <> ''
      AND pg_catalog.char_length(label_definition_version) <= 128
      AND label_definition_version !~ '[[:cntrl:]]'
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_attempted_label_definition_version_check CHECK (
    attempted_label_definition_version IS NULL OR (
      pg_catalog.btrim(attempted_label_definition_version) <> ''
      AND pg_catalog.char_length(attempted_label_definition_version) <= 128
      AND attempted_label_definition_version !~ '[[:cntrl:]]'
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_subject_check CHECK (
    subject IS NULL OR (
      pg_catalog.btrim(subject) <> ''
      AND pg_catalog.char_length(subject) <= 500
      AND subject !~ '[[:cntrl:]]'
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_sender_check CHECK (
    sender IS NULL OR (
      pg_catalog.btrim(sender) <> ''
      AND pg_catalog.char_length(sender) <= 500
      AND sender !~ '[[:cntrl:]]'
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_error_code_check CHECK (
    error_code IS NULL OR (
      pg_catalog.btrim(error_code) <> ''
      AND pg_catalog.char_length(error_code) <= 120
      AND error_code !~ '[[:cntrl:]]'
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_analysis_status_check CHECK (
    status IN ('needs-review', 'accepted', 'dismissed', 'skipped-noise', 'failed')
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_failure_state_check CHECK (
    failure_attempts BETWEEN 0 AND 3
    AND (
      (failure_attempts = 0 AND attempted_label_definition_version IS NULL)
      OR (failure_attempts >= 1 AND attempted_label_definition_version IS NOT NULL)
    )
    AND (
      status NOT IN ('accepted', 'dismissed', 'skipped-noise')
      OR failure_attempts = 0
    )
    AND (
      (status = 'failed' AND failure_attempts >= 1 AND error_code IS NOT NULL)
      OR (status <> 'failed' AND error_code IS NULL)
    )
  )`,
  "CREATE UNIQUE INDEX mail_items_profile_message_unique ON mail_items (connection_key, gmail_message_id)",
  "CREATE INDEX mail_items_profile_status_updated_at_idx ON mail_items (connection_key, status, updated_at DESC, id)",
] as const;
