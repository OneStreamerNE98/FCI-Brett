/**
 * Immutable production PostgreSQL migration v11.
 *
 * All six core tables already had constrained bigint version columns in their
 * original migrations. These comments make the shared compare-and-swap law
 * explicit without redefining or rewriting any applied column.
 */
const CORE_RECORD_VERSION_COMMENT =
  "Optimistic concurrency token: update only the expected version and increment once.";

export const CORE_RECORD_CONCURRENCY_STATEMENTS = [
  `COMMENT ON COLUMN clients.version IS '${CORE_RECORD_VERSION_COMMENT}'`,
  `COMMENT ON COLUMN contacts.version IS '${CORE_RECORD_VERSION_COMMENT}'`,
  `COMMENT ON COLUMN leads.version IS '${CORE_RECORD_VERSION_COMMENT}'`,
  `COMMENT ON COLUMN projects.version IS '${CORE_RECORD_VERSION_COMMENT}'`,
  `COMMENT ON COLUMN project_meetings.version IS '${CORE_RECORD_VERSION_COMMENT}'`,
  `COMMENT ON COLUMN tasks.version IS '${CORE_RECORD_VERSION_COMMENT}'`,
] as const;
