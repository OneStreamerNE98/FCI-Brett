/**
 * Immutable production PostgreSQL migration v6 for leads and project meetings.
 *
 * The migration is source-only until the owner approves a production-platform
 * apply. Keep each entry to one top-level statement so the migration runner
 * owns the transaction boundary.
 */
export const LEAD_PROJECT_MEETING_STATEMENTS = [
  `
CREATE TABLE leads (
  id uuid CONSTRAINT leads_pkey PRIMARY KEY,
  lead_number text NOT NULL,
  company text NOT NULL,
  contact_name text NOT NULL,
  contact_email text,
  contact_phone text,
  project_name text NOT NULL,
  source text NOT NULL,
  stage text NOT NULL,
  site text NOT NULL,
  estimated_value integer NOT NULL,
  next_action text NOT NULL,
  next_action_at timestamptz,
  owner_email text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT leads_lead_number_key UNIQUE (lead_number),
  CONSTRAINT leads_lead_number_check CHECK (lead_number ~ '^L-[0-9]{4}-[A-Z0-9]{8}$'),
  CONSTRAINT leads_company_check CHECK (
    pg_catalog.btrim(company) <> '' AND pg_catalog.char_length(company) <= 180
    AND company !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_contact_name_check CHECK (
    pg_catalog.btrim(contact_name) <> '' AND pg_catalog.char_length(contact_name) <= 160
    AND contact_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_contact_email_check CHECK (
    contact_email IS NULL OR (
      pg_catalog.char_length(contact_email) <= 254
      AND contact_email = pg_catalog.lower(contact_email)
      AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      AND contact_email !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT leads_contact_phone_check CHECK (
    contact_phone IS NULL OR (
      pg_catalog.btrim(contact_phone) <> '' AND pg_catalog.char_length(contact_phone) <= 40
      AND contact_phone !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT leads_project_name_check CHECK (
    pg_catalog.btrim(project_name) <> '' AND pg_catalog.char_length(project_name) <= 180
    AND project_name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_source_check CHECK (
    pg_catalog.btrim(source) <> '' AND pg_catalog.char_length(source) <= 80
    AND source !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_stage_check CHECK (
    pg_catalog.btrim(stage) <> '' AND pg_catalog.char_length(stage) <= 80
    AND stage !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_site_check CHECK (
    pg_catalog.btrim(site) <> '' AND pg_catalog.char_length(site) <= 300
    AND site !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_estimated_value_check CHECK (
    estimated_value BETWEEN 0 AND 2147483647
  ),
  CONSTRAINT leads_next_action_check CHECK (
    pg_catalog.btrim(next_action) <> '' AND pg_catalog.char_length(next_action) <= 500
    AND next_action !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_next_action_at_check CHECK (
    next_action_at IS NULL OR EXTRACT(epoch FROM next_action_at) >= 0
  ),
  CONSTRAINT leads_owner_email_check CHECK (
    pg_catalog.char_length(owner_email) <= 254
    AND owner_email = pg_catalog.lower(owner_email)
    AND owner_email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
    AND owner_email !~ '[[:cntrl:]]'
  ),
  CONSTRAINT leads_status_check CHECK (status IN ('active', 'converted', 'lost', 'archived')),
  CONSTRAINT leads_created_by_check CHECK (pg_catalog.btrim(created_by) <> ''),
  CONSTRAINT leads_updated_by_check CHECK (pg_catalog.btrim(updated_by) <> ''),
  CONSTRAINT leads_timestamps_check CHECK (updated_at >= created_at),
  CONSTRAINT leads_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX leads_status_updated_at_idx ON leads (status, updated_at DESC, id)",
  "CREATE INDEX leads_stage_updated_at_idx ON leads (stage, updated_at DESC, id)",
  "CREATE INDEX leads_updated_created_idx ON leads (updated_at DESC, created_at DESC, id)",
  `
CREATE TABLE project_meetings (
  id uuid CONSTRAINT project_meetings_pkey PRIMARY KEY,
  project_id uuid NOT NULL,
  title text NOT NULL,
  meeting_at timestamptz NOT NULL,
  meeting_type text NOT NULL,
  source_provider text NOT NULL,
  source_url text,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  transcript text,
  summary text,
  decisions text,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT project_meetings_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT project_meetings_title_check CHECK (
    pg_catalog.btrim(title) <> '' AND pg_catalog.char_length(title) <= 160
    AND pg_catalog.translate(
      title,
      pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
      ''
    ) !~ '[[:cntrl:]]'
  ),
  CONSTRAINT project_meetings_meeting_at_check CHECK (
    EXTRACT(epoch FROM meeting_at) * 1000 BETWEEN -8640000000000000 AND 8640000000000000
  ),
  CONSTRAINT project_meetings_type_check CHECK (
    meeting_type IN ('client', 'site-walk', 'internal', 'pre-install', 'closeout', 'other')
  ),
  CONSTRAINT project_meetings_source_provider_check CHECK (
    source_provider IN ('manual', 'otter', 'link')
  ),
  CONSTRAINT project_meetings_source_url_check CHECK (
    (source_provider = 'manual' AND source_url IS NULL)
    OR (
      source_provider IN ('otter', 'link') AND source_url IS NOT NULL
      AND pg_catalog.char_length(source_url) <= 900
      AND source_url ~ '^https://'
      AND source_url !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT project_meetings_attendees_check CHECK (
    pg_catalog.jsonb_typeof(attendees) = 'array'
    AND pg_catalog.jsonb_array_length(attendees) <= 40
    AND pg_catalog.jsonb_path_query_array(
      attendees,
      '$[*] ? (@.type() == "string" && @ like_regex "^.{1,160}$" flag "s")'
    ) = attendees
  ),
  CONSTRAINT project_meetings_notes_check CHECK (
    notes IS NULL OR (
      pg_catalog.btrim(notes) <> '' AND pg_catalog.char_length(notes) <= 25000
      AND pg_catalog.translate(
        notes,
        pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
        ''
      ) !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT project_meetings_transcript_check CHECK (
    transcript IS NULL OR (
      pg_catalog.btrim(transcript) <> '' AND pg_catalog.char_length(transcript) <= 100000
      AND pg_catalog.translate(
        transcript,
        pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
        ''
      ) !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT project_meetings_summary_check CHECK (
    summary IS NULL OR (
      pg_catalog.btrim(summary) <> '' AND pg_catalog.char_length(summary) <= 12000
      AND pg_catalog.translate(
        summary,
        pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
        ''
      ) !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT project_meetings_decisions_check CHECK (
    decisions IS NULL OR (
      pg_catalog.btrim(decisions) <> '' AND pg_catalog.char_length(decisions) <= 12000
      AND pg_catalog.translate(
        decisions,
        pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
        ''
      ) !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT project_meetings_action_items_check CHECK (
    pg_catalog.jsonb_typeof(action_items) = 'array'
    AND pg_catalog.jsonb_array_length(action_items) <= 50
    AND pg_catalog.jsonb_path_query_array(
      action_items,
      '$[*] ? (@.type() == "string" && @ like_regex "^.{1,160}$" flag "s")'
    ) = action_items
  ),
  CONSTRAINT project_meetings_evidence_check CHECK (
    source_url IS NOT NULL OR notes IS NOT NULL OR transcript IS NOT NULL
    OR summary IS NOT NULL OR decisions IS NOT NULL
    OR pg_catalog.jsonb_array_length(action_items) > 0
  ),
  CONSTRAINT project_meetings_created_by_check CHECK (pg_catalog.btrim(created_by) <> ''),
  CONSTRAINT project_meetings_timestamps_check CHECK (updated_at >= created_at),
  CONSTRAINT project_meetings_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX project_meetings_project_id_meeting_at_idx ON project_meetings (project_id, meeting_at DESC, created_at DESC, id)",
  "ALTER TABLE activity_events ADD COLUMN lead_id uuid",
  "ALTER TABLE activity_events ADD CONSTRAINT activity_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT",
  "ALTER TABLE activity_events DROP CONSTRAINT activity_events_record_check",
  "ALTER TABLE activity_events ADD CONSTRAINT activity_events_record_check CHECK (pg_catalog.num_nonnulls(client_id, project_id, lead_id) = 1)",
  "CREATE INDEX activity_events_lead_id_idx ON activity_events (lead_id) WHERE lead_id IS NOT NULL",
  "ALTER TABLE idempotency_requests DROP CONSTRAINT idempotency_requests_operation_check",
  "ALTER TABLE idempotency_requests ADD CONSTRAINT idempotency_requests_operation_check CHECK (operation IN ('clients.create', 'projects.create', 'leads.create', 'project_meetings.create'))",
  "ALTER TABLE outbox_events ADD COLUMN lead_id uuid",
  "ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT",
  "ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_type_check",
  "ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_type_check CHECK (event_type IN ('client.created', 'project.created', 'lead.created', 'project.meeting.created'))",
  "ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_record_check",
  "ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_record_check CHECK (pg_catalog.num_nonnulls(client_id, project_id, lead_id) = 1)",
  "ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_type_record_check",
  `
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_type_record_check CHECK (
  (event_type = 'client.created' AND client_id IS NOT NULL AND project_id IS NULL AND lead_id IS NULL)
  OR (event_type IN ('project.created', 'project.meeting.created') AND project_id IS NOT NULL AND client_id IS NULL AND lead_id IS NULL)
  OR (event_type = 'lead.created' AND lead_id IS NOT NULL AND client_id IS NULL AND project_id IS NULL)
)
  `.trim(),
  "CREATE INDEX outbox_events_lead_id_idx ON outbox_events (lead_id) WHERE lead_id IS NOT NULL",
] as const;
