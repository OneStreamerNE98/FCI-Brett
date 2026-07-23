/**
 * Immutable production PostgreSQL task schema intended for migration v8.
 *
 * BE-07 owns migration v7. Register these statements only after v7 exists so
 * the production migration chain remains positive, contiguous, and ordered.
 */
export const TASK_SCHEMA_STATEMENTS = [
  `
CREATE TABLE tasks (
  id uuid CONSTRAINT tasks_pkey PRIMARY KEY,
  title text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  due_date date,
  project_id uuid,
  lead_id uuid,
  assignee_email text,
  source text NOT NULL DEFAULT 'manual',
  source_ref text,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT tasks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT,
  CONSTRAINT tasks_title_check CHECK (
    pg_catalog.btrim(title) <> '' AND pg_catalog.char_length(title) <= 200
    AND title !~ '[[:cntrl:]]'
  ),
  CONSTRAINT tasks_details_check CHECK (
    details IS NULL OR (
      pg_catalog.btrim(details) <> '' AND pg_catalog.char_length(details) <= 4000
      AND pg_catalog.translate(
        details,
        pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
        ''
      ) !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT tasks_status_check CHECK (status IN ('open', 'done')),
  CONSTRAINT tasks_assignee_email_check CHECK (
    assignee_email IS NULL OR (
      pg_catalog.char_length(assignee_email) <= 254
      AND assignee_email = pg_catalog.lower(assignee_email)
      AND assignee_email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      AND assignee_email !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT tasks_source_check CHECK (source IN ('manual', 'meeting', 'email', 'ai')),
  CONSTRAINT tasks_source_ref_check CHECK (
    source_ref IS NULL OR (
      pg_catalog.btrim(source_ref) <> ''
      AND pg_catalog.char_length(source_ref) <= 512
      AND source_ref !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT tasks_created_by_check CHECK (pg_catalog.btrim(created_by) <> ''),
  CONSTRAINT tasks_updated_by_check CHECK (pg_catalog.btrim(updated_by) <> ''),
  CONSTRAINT tasks_timestamps_check CHECK (
    updated_at >= created_at
    AND (
      (status = 'open' AND completed_at IS NULL)
      OR (status = 'done' AND completed_at IS NOT NULL AND completed_at >= created_at)
    )
  ),
  CONSTRAINT tasks_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX tasks_status_due_date_idx ON tasks (status, due_date)",
  "CREATE INDEX tasks_project_status_idx ON tasks (project_id, status)",
  "CREATE INDEX tasks_lead_id_idx ON tasks (lead_id) WHERE lead_id IS NOT NULL",
  "ALTER TABLE project_meetings DROP CONSTRAINT project_meetings_type_check",
  "ALTER TABLE project_meetings ADD CONSTRAINT project_meetings_type_check CHECK (meeting_type IN ('client', 'site-walk', 'internal', 'pre-install', 'closeout', 'phone-call', 'other'))",
  "ALTER TABLE activity_events ADD COLUMN task_id uuid",
  "ALTER TABLE activity_events ADD CONSTRAINT activity_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE RESTRICT",
  "ALTER TABLE activity_events DROP CONSTRAINT activity_events_record_check",
  "ALTER TABLE activity_events ADD CONSTRAINT activity_events_record_check CHECK (pg_catalog.num_nonnulls(client_id, project_id, lead_id, task_id) = 1)",
  "CREATE INDEX activity_events_task_id_idx ON activity_events (task_id) WHERE task_id IS NOT NULL",
] as const;
