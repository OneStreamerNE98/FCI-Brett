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

-- Cloud Run runtime. Every table grant below is an exact capability boundary;
-- objects omitted from the list remain inaccessible after the reset above.
-- UPDATE on clients is currently required because protected writes use
-- SELECT ... FOR KEY SHARE. Session issuance uses FOR SHARE on users, whose
-- locking requirement and administration mutations use exact column grants
-- instead of table-wide access to identity/security fields. Invitation
-- revocation, session revocation, role reassignment, and project-membership
-- lifecycle changes are likewise limited to their reviewed columns. No
-- runtime table receives DELETE, TRUNCATE, REFERENCES, TRIGGER, or grant
-- options.
GRANT USAGE ON SCHEMA fci_app TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.clients TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.contacts TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.projects TO fci_runtime;
GRANT INSERT ON TABLE fci_app.activity_events TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.idempotency_requests TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.outbox_events TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.users TO fci_runtime;
GRANT UPDATE (status, disabled_at, authorization_version, sessions_valid_after, updated_at, version) ON TABLE fci_app.users TO fci_runtime;
GRANT INSERT ON TABLE fci_app.external_identities TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.invitations TO fci_runtime;
GRANT UPDATE (token_hash, status, revoked_by_user_id, revoked_at, expired_at, updated_at, version) ON TABLE fci_app.invitations TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.invitation_project_assignments TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.sessions TO fci_runtime;
GRANT UPDATE (token_hash, csrf_hash, revoked_at, revoked_by_actor_key, revocation_reason_code, version) ON TABLE fci_app.sessions TO fci_runtime;
GRANT SELECT ON TABLE fci_app.roles TO fci_runtime;
GRANT SELECT ON TABLE fci_app.capabilities TO fci_runtime;
GRANT SELECT ON TABLE fci_app.role_capabilities TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.user_roles TO fci_runtime;
GRANT UPDATE (role_id, assigned_by_user_id, assigned_by_actor_key, assigned_at, version) ON TABLE fci_app.user_roles TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.project_memberships TO fci_runtime;
GRANT UPDATE (assigned_by_user_id, assigned_by_actor_key, assigned_at, status, revoked_by_user_id, revoked_by_actor_key, revoked_at, revocation_reason_code, version) ON TABLE fci_app.project_memberships TO fci_runtime;
GRANT INSERT ON TABLE fci_app.audit_events TO fci_runtime;
GRANT SELECT ON TABLE fci_app.audit_activity_projection TO fci_runtime;
GRANT INSERT ON TABLE fci_app.integration_connections TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.integration_oauth_attempts TO fci_runtime;
GRANT INSERT ON TABLE fci_app.integration_resources TO fci_runtime;
GRANT SELECT, INSERT ON TABLE fci_app.files TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.file_versions TO fci_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.storage_objects TO fci_runtime;
GRANT INSERT ON TABLE fci_app.file_links TO fci_runtime;

-- The runtime receives no direct production_schema_migrations table access.
-- Readiness crosses this one narrow, argument-free SECURITY DEFINER boundary
-- to compare non-secret migration metadata. The fixed system-only search path
-- keeps pg_temp last, and the qualified relation prevents object shadowing.
CREATE OR REPLACE FUNCTION fci_app.read_production_schema_history()
RETURNS TABLE (version integer, name text, checksum text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $production_schema_history_reader$
  SELECT history.version, history.name, history.checksum
  FROM fci_app.production_schema_migrations AS history
  ORDER BY history.version
$production_schema_history_reader$;

REVOKE ALL ON FUNCTION fci_app.read_production_schema_history()
  FROM PUBLIC, fci_runtime, fci_rehearsal_importer;
GRANT EXECUTE ON FUNCTION fci_app.read_production_schema_history() TO fci_runtime;

-- integration_credentials intentionally has no runtime table grant. A future
-- connector must introduce and review a separately named credential boundary
-- instead of making ciphertext available to the general application role.

-- The rehearsal role deliberately receives no fci_app access. Its temporary,
-- prefix-validated grants belong only to an isolated fci_rehearsal_* schema;
-- see rehearsal-importer-template.sql.

COMMIT;
