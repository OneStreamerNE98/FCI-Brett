/**
 * Immutable production PostgreSQL migration v14 for GI-04's review-first
 * address validation evidence and nullable record metadata.
 *
 * Existing records remain valid legacy rows. New mutation paths always write
 * a bounded verdict, while NOT VALID checks avoid an implicit data backfill or
 * table-wide validation during this additive migration.
 */
export const ADDRESS_VALIDATION_SCHEMA_STATEMENTS = [
  `ALTER TABLE clients
   ADD COLUMN site_address text,
   ADD COLUMN latitude double precision,
   ADD COLUMN longitude double precision,
   ADD COLUMN address_validation_verdict text`,
  `ALTER TABLE leads
   ADD COLUMN latitude double precision,
   ADD COLUMN longitude double precision,
   ADD COLUMN address_validation_verdict text`,
  `ALTER TABLE projects
   ADD COLUMN latitude double precision,
   ADD COLUMN longitude double precision,
   ADD COLUMN address_validation_verdict text`,
  `ALTER TABLE clients ADD CONSTRAINT clients_site_address_check CHECK (
     site_address IS NULL OR (
       pg_catalog.btrim(site_address) <> ''
       AND pg_catalog.char_length(site_address) <= 280
       AND site_address !~ '[[:cntrl:]]'
     )
   ) NOT VALID`,
  `ALTER TABLE leads ADD CONSTRAINT leads_site_address_check CHECK (
     pg_catalog.btrim(site) <> ''
     AND pg_catalog.char_length(site) <= 280
     AND site !~ '[[:cntrl:]]'
   ) NOT VALID`,
  `ALTER TABLE projects ADD CONSTRAINT projects_site_address_check CHECK (
     site IS NULL OR (
       pg_catalog.btrim(site) <> ''
       AND pg_catalog.char_length(site) <= 280
       AND site !~ '[[:cntrl:]]'
     )
   ) NOT VALID`,
  `ALTER TABLE clients ADD CONSTRAINT clients_address_coordinates_check CHECK (
     (latitude IS NULL) = (longitude IS NULL)
     AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
     AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
   ) NOT VALID`,
  `ALTER TABLE leads ADD CONSTRAINT leads_address_coordinates_check CHECK (
     (latitude IS NULL) = (longitude IS NULL)
     AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
     AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
   ) NOT VALID`,
  `ALTER TABLE projects ADD CONSTRAINT projects_address_coordinates_check CHECK (
     (latitude IS NULL) = (longitude IS NULL)
     AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
     AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
   ) NOT VALID`,
  `ALTER TABLE clients ADD CONSTRAINT clients_address_verdict_check CHECK (
     address_validation_verdict IS NULL
     OR address_validation_verdict IN ('validated', 'review-confirmed', 'unvalidated', 'simulated')
   ) NOT VALID`,
  `ALTER TABLE leads ADD CONSTRAINT leads_address_verdict_check CHECK (
     address_validation_verdict IS NULL
     OR address_validation_verdict IN ('validated', 'review-confirmed', 'unvalidated', 'simulated')
   ) NOT VALID`,
  `ALTER TABLE projects ADD CONSTRAINT projects_address_verdict_check CHECK (
     address_validation_verdict IS NULL
     OR address_validation_verdict IN ('validated', 'review-confirmed', 'unvalidated', 'simulated')
   ) NOT VALID`,
  `ALTER TABLE clients ADD CONSTRAINT clients_address_metadata_check CHECK (
     (site_address IS NULL AND latitude IS NULL AND longitude IS NULL AND address_validation_verdict IS NULL)
     OR (
       site_address IS NOT NULL
       AND (
         (address_validation_verdict IS NULL AND latitude IS NULL AND longitude IS NULL)
         OR (address_validation_verdict = 'unvalidated' AND latitude IS NULL AND longitude IS NULL)
         OR (address_validation_verdict IN ('validated', 'review-confirmed', 'simulated') AND latitude IS NOT NULL AND longitude IS NOT NULL)
       )
     )
   ) NOT VALID`,
  `ALTER TABLE leads ADD CONSTRAINT leads_address_metadata_check CHECK (
     (address_validation_verdict IS NULL AND latitude IS NULL AND longitude IS NULL)
     OR (address_validation_verdict = 'unvalidated' AND latitude IS NULL AND longitude IS NULL)
     OR (address_validation_verdict IN ('validated', 'review-confirmed', 'simulated') AND latitude IS NOT NULL AND longitude IS NOT NULL)
   ) NOT VALID`,
  `ALTER TABLE projects ADD CONSTRAINT projects_address_metadata_check CHECK (
     (site IS NULL AND latitude IS NULL AND longitude IS NULL AND address_validation_verdict IS NULL)
     OR (
       site IS NOT NULL
       AND (
         (address_validation_verdict IS NULL AND latitude IS NULL AND longitude IS NULL)
         OR (address_validation_verdict = 'unvalidated' AND latitude IS NULL AND longitude IS NULL)
         OR (address_validation_verdict IN ('validated', 'review-confirmed', 'simulated') AND latitude IS NOT NULL AND longitude IS NOT NULL)
       )
     )
   ) NOT VALID`,
  `
CREATE TABLE address_validation_reviews (
  id uuid CONSTRAINT address_validation_reviews_pkey PRIMARY KEY,
  actor_id text NOT NULL,
  entity_kind text NOT NULL,
  target_id text NOT NULL,
  input_address text NOT NULL,
  standardized_address text,
  latitude double precision,
  longitude double precision,
  verdict text NOT NULL,
  failure_code text,
  simulated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT address_validation_reviews_actor_check CHECK (
    pg_catalog.btrim(actor_id) <> ''
    AND pg_catalog.char_length(actor_id) <= 320
    AND actor_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT address_validation_reviews_entity_check CHECK (
    entity_kind IN ('lead', 'client', 'project')
  ),
  CONSTRAINT address_validation_reviews_target_check CHECK (
    pg_catalog.btrim(target_id) <> ''
    AND pg_catalog.char_length(target_id) <= 128
    AND target_id !~ '[[:cntrl:][:space:]]'
  ),
  CONSTRAINT address_validation_reviews_input_check CHECK (
    pg_catalog.btrim(input_address) <> ''
    AND pg_catalog.char_length(input_address) <= 280
    AND input_address !~ '[[:cntrl:]]'
  ),
  CONSTRAINT address_validation_reviews_standardized_check CHECK (
    standardized_address IS NULL OR (
      pg_catalog.btrim(standardized_address) <> ''
      AND pg_catalog.char_length(standardized_address) <= 280
      AND standardized_address !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT address_validation_reviews_coordinates_check CHECK (
    (latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT address_validation_reviews_verdict_check CHECK (
    verdict IN ('validated', 'needs-confirmation', 'needs-correction', 'unvalidated', 'simulated')
  ),
  CONSTRAINT address_validation_reviews_failure_check CHECK (
    failure_code IS NULL OR (
      failure_code ~ '^[a-z][a-z0-9_-]{0,63}$'
      AND pg_catalog.char_length(failure_code) <= 64
    )
  ),
  CONSTRAINT address_validation_reviews_evidence_check CHECK (
    (verdict = 'unvalidated' AND standardized_address IS NULL AND latitude IS NULL AND longitude IS NULL)
    OR (
      verdict <> 'unvalidated'
      AND standardized_address IS NOT NULL
      AND (
        verdict IN ('needs-correction')
        OR (latitude IS NOT NULL AND longitude IS NOT NULL)
      )
    )
  ),
  CONSTRAINT address_validation_reviews_simulation_check CHECK (
    simulated = (verdict = 'simulated')
  ),
  CONSTRAINT address_validation_reviews_time_check CHECK (
    expires_at > created_at
    AND (consumed_at IS NULL OR consumed_at >= created_at)
  )
)
`.trim(),
  `CREATE INDEX address_validation_reviews_expiry_idx
   ON address_validation_reviews (expires_at, consumed_at)`,
  `CREATE INDEX address_validation_reviews_actor_idx
   ON address_validation_reviews (actor_id, created_at, id)`,
] as const;
