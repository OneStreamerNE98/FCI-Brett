-- FCI Operations production PostgreSQL least-privilege policy.
--
-- SOURCE ONLY: do not run this file against any environment without owner
-- approval and a reviewed, environment-specific provisioning procedure.
-- This file intentionally contains no login roles, passwords, IAM principal
-- names, database URLs, or other credentials.
--
-- Apply the two phases separately. The bootstrap phase runs once as the
-- approved database bootstrap administrator. The post-migration phase runs as
-- fci_migration_owner only after the immutable migrations have completed.

-- ---------------------------------------------------------------------------
-- Phase 1: bootstrap capability roles and the dedicated application schema.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE ROLE fci_migration_owner
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE ROLE fci_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE ROLE fci_rehearsal_importer
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA fci_app AUTHORIZATION fci_migration_owner;

REVOKE ALL ON SCHEMA fci_app FROM PUBLIC;
REVOKE ALL ON SCHEMA fci_app FROM fci_runtime;
REVOKE ALL ON SCHEMA fci_app FROM fci_rehearsal_importer;

-- Global defaults and per-schema defaults are additive in PostgreSQL. Revoke
-- both layers for every known non-owner role so a prior global grant cannot
-- bypass the schema-scoped policy.
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner
  REVOKE ALL ON TABLES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner
  REVOKE ALL ON SEQUENCES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner IN SCHEMA fci_app
  REVOKE ALL ON TABLES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner IN SCHEMA fci_app
  REVOKE ALL ON SEQUENCES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner IN SCHEMA fci_app
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, fci_runtime, fci_rehearsal_importer;

COMMIT;

-- The environment-specific migration login is granted SET membership in
-- fci_migration_owner by the bootstrap administrator. The migration command
-- MUST execute `SET ROLE fci_migration_owner` on its dedicated connection
-- before running DDL. Inherited privileges alone do not make objects owned by
-- fci_migration_owner and do not apply this role's default privileges.

-- ---------------------------------------------------------------------------
-- Phase 2: exact grants after the immutable schema migrations have completed.
-- Execute this phase only after `SET ROLE fci_migration_owner` and verify that
-- current_user is fci_migration_owner before continuing.
-- ---------------------------------------------------------------------------

BEGIN;

DO $fci_access_policy$
BEGIN
  IF current_user <> 'fci_migration_owner' THEN
    RAISE EXCEPTION 'least-privilege grants require SET ROLE fci_migration_owner'
      USING ERRCODE = '42501';
  END IF;
END;
$fci_access_policy$;

-- Remove known default-privilege drift before any later migration can create
-- an object with unintended runtime or rehearsal access.
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner
  REVOKE ALL ON TABLES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner
  REVOKE ALL ON SEQUENCES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner IN SCHEMA fci_app
  REVOKE ALL ON TABLES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner IN SCHEMA fci_app
  REVOKE ALL ON SEQUENCES FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner IN SCHEMA fci_app
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, fci_runtime, fci_rehearsal_importer;

-- Reset every non-owner grant first so reapplying this reviewed policy removes
-- drift instead of accumulating privileges.
REVOKE ALL ON SCHEMA fci_app FROM PUBLIC;
REVOKE ALL ON SCHEMA fci_app FROM fci_runtime;
REVOKE ALL ON SCHEMA fci_app FROM fci_rehearsal_importer;
REVOKE ALL ON ALL TABLES IN SCHEMA fci_app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fci_app FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fci_app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA fci_app FROM fci_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fci_app FROM fci_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fci_app FROM fci_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA fci_app FROM fci_rehearsal_importer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fci_app FROM fci_rehearsal_importer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fci_app FROM fci_rehearsal_importer;

-- Cloud Run runtime. No DELETE, TRUNCATE, REFERENCES, TRIGGER, schema CREATE,
-- sequence, or function privilege is granted. UPDATE on clients is currently
-- required because project creation uses SELECT ... FOR KEY SHARE on clients;
-- PostgreSQL requires UPDATE privilege for that locking clause.
GRANT USAGE ON SCHEMA fci_app TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.clients TO fci_runtime;
GRANT INSERT ON TABLE fci_app.contacts TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.projects TO fci_runtime;
GRANT INSERT ON TABLE fci_app.activity_events TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.idempotency_requests TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.outbox_events TO fci_runtime;

-- Readiness may compare the immutable migration history. This is the runtime's
-- sole migration-history privilege; it receives no INSERT, UPDATE, or DELETE.
GRANT SELECT ON TABLE fci_app.production_schema_migrations TO fci_runtime;

-- The rehearsal role deliberately receives no fci_app access. Its temporary,
-- prefix-validated grants belong only to an isolated fci_rehearsal_* schema;
-- see rehearsal-importer-template.sql.

COMMIT;
