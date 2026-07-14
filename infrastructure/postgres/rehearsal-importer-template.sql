-- FCI Operations isolated test-data rehearsal grants.
--
-- SOURCE-ONLY PSQL TEMPLATE. Do not execute without owner approval. Supply one
-- existing, already-migrated schema with:
--   --set=fci_rehearsal_schema=fci_rehearsal_<reviewed_run_identifier>
--
-- The prefix check prevents this template from granting importer access to
-- fci_app or any other production/application schema. Identifier interpolation
-- uses psql's quoted-identifier form after the value has passed the allowlist.

\set ON_ERROR_STOP on

\if :{?fci_rehearsal_schema}
\else
  \echo 'fci_rehearsal_schema is required'
  \quit 3
\endif

SELECT :'fci_rehearsal_schema' ~ '^fci_rehearsal_[a-z0-9_]{1,49}$'
  AS fci_rehearsal_schema_is_valid
\gset

\if :fci_rehearsal_schema_is_valid
\else
  \echo 'fci_rehearsal_schema must use the fci_rehearsal_* allowlist'
  \quit 3
\endif

BEGIN;

SET LOCAL ROLE fci_migration_owner;

SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_namespace AS namespace
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
  WHERE namespace.nspname = :'fci_rehearsal_schema'
    AND owner_role.rolname = 'fci_migration_owner'
) AS fci_rehearsal_schema_has_expected_owner
\gset

\if :fci_rehearsal_schema_has_expected_owner
\else
  \echo 'rehearsal schema is missing or is not owned by fci_migration_owner'
  \quit 3
\endif

SELECT count(*) = 7 AS fci_rehearsal_schema_has_required_tables
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = :'fci_rehearsal_schema'
  AND relation.relkind IN ('r', 'p')
  AND relation.relname IN (
    'production_schema_migrations',
    'clients',
    'contacts',
    'projects',
    'activity_events',
    'idempotency_requests',
    'outbox_events'
  )
\gset

\if :fci_rehearsal_schema_has_required_tables
\else
  \echo 'rehearsal schema does not contain the complete migrated core schema'
  \quit 3
\endif

-- Remove drift first. Runtime and PUBLIC never receive access to a rehearsal
-- schema; the importer receives only the exact matrix below.
REVOKE ALL ON SCHEMA :"fci_rehearsal_schema" FROM PUBLIC;
REVOKE ALL ON SCHEMA :"fci_rehearsal_schema" FROM fci_runtime;
REVOKE ALL ON SCHEMA :"fci_rehearsal_schema" FROM fci_rehearsal_importer;
REVOKE ALL ON ALL TABLES IN SCHEMA :"fci_rehearsal_schema" FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA :"fci_rehearsal_schema" FROM fci_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA :"fci_rehearsal_schema" FROM fci_rehearsal_importer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA :"fci_rehearsal_schema" FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA :"fci_rehearsal_schema" FROM fci_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA :"fci_rehearsal_schema" FROM fci_rehearsal_importer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA :"fci_rehearsal_schema" FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA :"fci_rehearsal_schema" FROM fci_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA :"fci_rehearsal_schema" FROM fci_rehearsal_importer;

GRANT USAGE ON SCHEMA :"fci_rehearsal_schema" TO fci_rehearsal_importer;
GRANT SELECT, INSERT ON TABLE :"fci_rehearsal_schema".clients TO fci_rehearsal_importer;
GRANT SELECT, INSERT ON TABLE :"fci_rehearsal_schema".contacts TO fci_rehearsal_importer;
GRANT SELECT, INSERT ON TABLE :"fci_rehearsal_schema".projects TO fci_rehearsal_importer;
GRANT SELECT, INSERT ON TABLE :"fci_rehearsal_schema".activity_events TO fci_rehearsal_importer;
GRANT SELECT ON TABLE :"fci_rehearsal_schema".production_schema_migrations TO fci_rehearsal_importer;
GRANT SELECT ON TABLE :"fci_rehearsal_schema".idempotency_requests TO fci_rehearsal_importer;
GRANT SELECT ON TABLE :"fci_rehearsal_schema".outbox_events TO fci_rehearsal_importer;

COMMIT;
