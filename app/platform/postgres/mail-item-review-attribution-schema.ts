/**
 * Immutable production PostgreSQL migration v16 for AI-11(d)'s review
 * attribution spine. Three additive columns on mail_items, with CHECK
 * constraints modelled on the v12 analysis migration.
 */
export const MAIL_ITEM_REVIEW_ATTRIBUTION_SCHEMA_STATEMENTS = [
  "ALTER TABLE mail_items ADD COLUMN reviewed_by text",
  "ALTER TABLE mail_items ADD COLUMN reviewed_at timestamptz",
  "ALTER TABLE mail_items ADD COLUMN accepted_intent text",
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_reviewed_by_check CHECK (
    reviewed_by IS NULL OR (
      pg_catalog.btrim(reviewed_by) <> ''
      AND pg_catalog.char_length(reviewed_by) <= 320
      AND reviewed_by !~ '[[:cntrl:]]'
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_reviewed_at_check CHECK (
    reviewed_at IS NULL OR reviewed_at >= '2000-01-01'::timestamptz
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_accepted_intent_check CHECK (
    accepted_intent IS NULL OR (
      pg_catalog.btrim(accepted_intent) <> ''
      AND pg_catalog.char_length(accepted_intent) <= 60
      AND accepted_intent !~ '[[:cntrl:]]'
    )
  )`,
  `ALTER TABLE mail_items ADD CONSTRAINT mail_items_review_attribution_check CHECK (
    (reviewed_by IS NULL) = (reviewed_at IS NULL)
  )`,
] as const;
