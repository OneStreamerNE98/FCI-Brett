/** Immutable PostgreSQL migration v15 for AI-11(c)'s administrator-owned
 * intent-label catalog. The four AI-10 labels preserve the existing catalog
 * and therefore its byte-derived definition version on upgrade. */
export const ASSISTANT_LABEL_SCHEMA_STATEMENTS = [
  `CREATE TABLE assistant_label_definitions (
     slug text CONSTRAINT assistant_label_definitions_pkey PRIMARY KEY,
     description text NOT NULL,
     retired boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL,
     updated_at timestamptz NOT NULL,
     CONSTRAINT assistant_label_definitions_slug_check CHECK (
       slug ~ '^[A-Za-z0-9_-]{1,60}$'
     ),
     CONSTRAINT assistant_label_definitions_description_check CHECK (
       pg_catalog.btrim(description) <> ''
       AND pg_catalog.char_length(description) <= 300
       AND description !~ '[[:cntrl:]]'
     ),
     CONSTRAINT assistant_label_definitions_timestamps_check CHECK (
       updated_at >= created_at
     )
   )`,
  `CREATE INDEX assistant_label_definitions_created_at_idx
   ON assistant_label_definitions (created_at, slug)`,
  `INSERT INTO assistant_label_definitions (
     slug, description, retired, created_at, updated_at
   ) VALUES
     ('lead', 'A new sales opportunity or request for an estimate.', false, pg_catalog.to_timestamp(0), pg_catalog.to_timestamp(0)),
     ('project-update', 'Information or a requested change concerning existing project work.', false, pg_catalog.to_timestamp(0), pg_catalog.to_timestamp(0)),
     ('schedule', 'A request or change involving an appointment, installation, or project timing.', false, pg_catalog.to_timestamp(0), pg_catalog.to_timestamp(0)),
     ('warranty', 'A callback, repair, service, or warranty concern.', false, pg_catalog.to_timestamp(0), pg_catalog.to_timestamp(0))`,
] as const;
