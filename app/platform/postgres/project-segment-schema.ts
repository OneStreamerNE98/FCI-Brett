/**
 * Immutable production PostgreSQL migration v10 for the closed project
 * segment catalog already used by the development D1 adapter.
 *
 * Keep the catalog literal here: changing an applied migration is forbidden.
 * A future catalog expansion requires a new migration plus an explicit parity
 * review against the application domain catalog.
 */
export const PRODUCTION_PROJECT_SEGMENTS = [
  "commercial",
  "residential",
] as const;

export const PROJECT_SEGMENT_SCHEMA_STATEMENTS = [
  "ALTER TABLE projects ADD COLUMN segment text",
  `ALTER TABLE projects ADD CONSTRAINT projects_segment_check CHECK (
  segment IS NULL
  OR segment IN ('commercial', 'residential')
)`,
] as const;
