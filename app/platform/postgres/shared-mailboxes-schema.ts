/**
 * Immutable production PostgreSQL migration v17 for WS-20's explicit
 * per-mailbox ownership. New mail-item writes must always provide the
 * connection key selected for the request instead of inheriting the former
 * single-mailbox sentinel.
 */
export const SHARED_MAILBOX_SCHEMA_STATEMENTS = [
  "ALTER TABLE mail_items ALTER COLUMN connection_key DROP DEFAULT",
] as const;
