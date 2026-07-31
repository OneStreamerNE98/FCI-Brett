/**
 * Immutable production PostgreSQL migration v13 for GI-01's bounded Forms
 * watermark and review-first lead queue.
 *
 * Keep each entry to one top-level statement so the migration runner owns the
 * transaction boundary.
 */
export const GOOGLE_FORM_LEAD_INTAKE_SCHEMA_STATEMENTS = [
  `
CREATE TABLE google_form_lead_intake_watermarks (
  connection_key text NOT NULL,
  spreadsheet_id text NOT NULL,
  last_processed_row integer NOT NULL,
  last_processed_at timestamptz NOT NULL,
  updated_by text NOT NULL,
  CONSTRAINT google_form_lead_intake_watermarks_pkey PRIMARY KEY (
    connection_key,
    spreadsheet_id
  ),
  CONSTRAINT google_form_lead_intake_watermarks_connection_key_check CHECK (
    connection_key ~ '^[a-z][a-z0-9_-]{0,127}$'
  ),
  CONSTRAINT google_form_lead_intake_watermarks_spreadsheet_id_check CHECK (
    spreadsheet_id ~ '^[A-Za-z0-9_-]{1,256}$'
  ),
  CONSTRAINT google_form_lead_intake_watermarks_row_check CHECK (
    last_processed_row >= 2
  ),
  CONSTRAINT google_form_lead_intake_watermarks_actor_check CHECK (
    pg_catalog.btrim(updated_by) <> ''
    AND pg_catalog.char_length(updated_by) <= 320
    AND updated_by !~ '[[:cntrl:]]'
  )
)
`.trim(),
  `
CREATE TABLE google_form_lead_reviews (
  id uuid CONSTRAINT google_form_lead_reviews_pkey PRIMARY KEY,
  connection_key text NOT NULL,
  spreadsheet_id text NOT NULL,
  source_row integer NOT NULL,
  submitted_at text,
  state text NOT NULL,
  status text NOT NULL DEFAULT 'needs-review',
  proposal_json jsonb NOT NULL,
  reasons_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  accepted_lead_id uuid REFERENCES leads (id),
  CONSTRAINT google_form_lead_reviews_source_key UNIQUE (
    connection_key,
    spreadsheet_id,
    source_row
  ),
  CONSTRAINT google_form_lead_reviews_connection_key_check CHECK (
    connection_key ~ '^[a-z][a-z0-9_-]{0,127}$'
  ),
  CONSTRAINT google_form_lead_reviews_spreadsheet_id_check CHECK (
    spreadsheet_id ~ '^[A-Za-z0-9_-]{1,256}$'
  ),
  CONSTRAINT google_form_lead_reviews_source_row_check CHECK (source_row >= 2),
  CONSTRAINT google_form_lead_reviews_submitted_at_check CHECK (
    submitted_at IS NULL OR (
      pg_catalog.btrim(submitted_at) <> ''
      AND pg_catalog.char_length(submitted_at) <= 100
      AND submitted_at !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT google_form_lead_reviews_state_check CHECK (
    state IN ('ready', 'duplicate', 'invalid', 'blocked-real-data')
  ),
  CONSTRAINT google_form_lead_reviews_status_check CHECK (
    status IN ('needs-review', 'accepted', 'dismissed')
  ),
  CONSTRAINT google_form_lead_reviews_proposal_check CHECK (
    pg_catalog.jsonb_typeof(proposal_json) = 'object'
    AND pg_catalog.octet_length(proposal_json::text) <= 16000
  ),
  CONSTRAINT google_form_lead_reviews_reasons_check CHECK (
    pg_catalog.jsonb_typeof(reasons_json) = 'array'
    AND pg_catalog.jsonb_array_length(reasons_json) <= 12
    AND pg_catalog.octet_length(reasons_json::text) <= 4000
  ),
  CONSTRAINT google_form_lead_reviews_time_check CHECK (updated_at >= created_at),
  CONSTRAINT google_form_lead_reviews_disposition_check CHECK (
    (
      status = 'needs-review'
      AND reviewed_by IS NULL
      AND reviewed_at IS NULL
      AND accepted_lead_id IS NULL
    )
    OR (
      status = 'accepted'
      AND reviewed_by IS NOT NULL
      AND pg_catalog.btrim(reviewed_by) <> ''
      AND pg_catalog.char_length(reviewed_by) <= 320
      AND reviewed_by !~ '[[:cntrl:]]'
      AND reviewed_at IS NOT NULL
      AND accepted_lead_id IS NOT NULL
    )
    OR (
      status = 'dismissed'
      AND reviewed_by IS NOT NULL
      AND pg_catalog.btrim(reviewed_by) <> ''
      AND pg_catalog.char_length(reviewed_by) <= 320
      AND reviewed_by !~ '[[:cntrl:]]'
      AND reviewed_at IS NOT NULL
      AND accepted_lead_id IS NULL
    )
  )
)
`.trim(),
  `CREATE INDEX google_form_lead_reviews_queue_idx
   ON google_form_lead_reviews (connection_key, status, source_row, id)`,
  `CREATE INDEX google_form_lead_reviews_accepted_lead_idx
   ON google_form_lead_reviews (accepted_lead_id)`,
] as const;
