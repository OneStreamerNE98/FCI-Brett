/**
 * Immutable production PostgreSQL migration v9 for the additive flooring KPI
 * fields already present in the development D1 projects table.
 *
 * Keep the category catalog literal here: changing an applied migration is
 * forbidden. A future catalog expansion requires a new migration plus an
 * explicit parity review against the application domain catalog.
 */
export const PRODUCTION_FLOORING_CATEGORIES = [
  "hardwood",
  "carpet",
  "luxury-vinyl",
  "tile-stone",
  "laminate",
  "specialty",
  "mixed",
] as const;

export const FLOORING_KPI_SCHEMA_STATEMENTS = [
  "ALTER TABLE projects ADD COLUMN flooring_category text",
  "ALTER TABLE projects ADD COLUMN square_feet numeric",
  "ALTER TABLE projects ADD COLUMN contract_value numeric",
  "ALTER TABLE projects ADD COLUMN installation_started_at timestamptz",
  "ALTER TABLE projects ADD COLUMN installation_completed_at timestamptz",
  "ALTER TABLE projects ADD COLUMN had_callback boolean NOT NULL DEFAULT false",
  "ALTER TABLE projects ADD COLUMN callback_note text",
  `ALTER TABLE projects ADD CONSTRAINT projects_flooring_category_check CHECK (
  flooring_category IS NULL
  OR flooring_category IN ('hardwood', 'carpet', 'luxury-vinyl', 'tile-stone', 'laminate', 'specialty', 'mixed')
)`,
  `ALTER TABLE projects ADD CONSTRAINT projects_square_feet_check CHECK (
  square_feet IS NULL
  OR (
    square_feet > 0
    AND square_feet = pg_catalog.trunc(square_feet)
    AND square_feet <= 9007199254740991
  )
)`,
  `ALTER TABLE projects ADD CONSTRAINT projects_contract_value_check CHECK (
  contract_value IS NULL
  OR (
    contract_value >= 0
    AND contract_value = pg_catalog.trunc(contract_value)
    AND contract_value <= 9007199254740991
  )
)`,
  `ALTER TABLE projects ADD CONSTRAINT projects_installation_dates_check CHECK (
  (installation_started_at IS NULL OR EXTRACT(epoch FROM installation_started_at) >= 0)
  AND (
    installation_completed_at IS NULL
    OR (
      installation_started_at IS NOT NULL
      AND EXTRACT(epoch FROM installation_completed_at) >= 0
      AND installation_completed_at >= installation_started_at
    )
  )
)`,
  `ALTER TABLE projects ADD CONSTRAINT projects_callback_note_check CHECK (
  callback_note IS NULL
  OR (
    pg_catalog.btrim(callback_note) <> ''
    AND pg_catalog.char_length(callback_note) <= 1000
    AND pg_catalog.translate(
      callback_note,
      pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(13),
      ''
    ) !~ '[[:cntrl:]]'
  )
)`,
] as const;
