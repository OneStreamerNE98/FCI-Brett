/**
 * Production-owned persistence structures that must exist before employee
 * authorization or route composition can be implemented. These declarations
 * deliberately contain no role/capability seeds, RLS policy, provider calls,
 * credentials, or live Workspace behavior.
 */
export const PRODUCTION_PERSISTENCE_STATEMENTS = [
  `
CREATE TABLE users (
  id uuid CONSTRAINT users_pkey PRIMARY KEY,
  email text NOT NULL,
  email_key text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  authorization_version bigint NOT NULL DEFAULT 1,
  sessions_valid_after timestamptz NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT users_email_key_key UNIQUE (email_key),
  CONSTRAINT users_email_check CHECK (
    pg_catalog.btrim(email) <> ''
    AND pg_catalog.strpos(email, '@') > 1
  ),
  CONSTRAINT users_email_key_check CHECK (
    email_key = pg_catalog.lower(pg_catalog.btrim(email))
    AND pg_catalog.btrim(email_key) <> ''
  ),
  CONSTRAINT users_display_name_check CHECK (pg_catalog.btrim(display_name) <> ''),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_status_time_check CHECK (
    (status = 'active' AND disabled_at IS NULL)
    OR (status = 'disabled' AND disabled_at IS NOT NULL)
  ),
  CONSTRAINT users_authorization_version_check CHECK (authorization_version >= 1),
  CONSTRAINT users_timestamps_check CHECK (
    updated_at >= created_at
    AND sessions_valid_after >= created_at
    AND (disabled_at IS NULL OR disabled_at >= created_at)
  ),
  CONSTRAINT users_version_check CHECK (version >= 1)
)
  `.trim(),
  `
CREATE TABLE external_identities (
  id uuid CONSTRAINT external_identities_pkey PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  email text NOT NULL,
  hosted_domain text,
  email_verified boolean NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_authenticated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT external_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT external_identities_issuer_subject_key UNIQUE (issuer, subject),
  CONSTRAINT external_identities_user_provider_key UNIQUE (user_id, provider),
  CONSTRAINT external_identities_provider_check CHECK (
    provider ~ '^[a-z][a-z0-9_]*$'
    AND provider = pg_catalog.lower(provider)
  ),
  CONSTRAINT external_identities_issuer_check CHECK (pg_catalog.btrim(issuer) <> ''),
  CONSTRAINT external_identities_subject_check CHECK (pg_catalog.btrim(subject) <> ''),
  CONSTRAINT external_identities_email_check CHECK (
    pg_catalog.btrim(email) <> ''
    AND pg_catalog.strpos(email, '@') > 1
  ),
  CONSTRAINT external_identities_hosted_domain_check CHECK (
    hosted_domain IS NULL
    OR (
      pg_catalog.btrim(hosted_domain) <> ''
      AND hosted_domain = pg_catalog.lower(pg_catalog.btrim(hosted_domain))
    )
  ),
  CONSTRAINT external_identities_timestamps_check CHECK (
    last_authenticated_at >= first_seen_at
    AND updated_at >= last_authenticated_at
  ),
  CONSTRAINT external_identities_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX external_identities_user_id_idx ON external_identities (user_id)",
  `
CREATE TABLE invitations (
  id uuid CONSTRAINT invitations_pkey PRIMARY KEY,
  email text NOT NULL,
  email_key text NOT NULL,
  token_hash text,
  status text NOT NULL DEFAULT 'pending',
  invited_by_user_id uuid,
  invited_by_actor_key text NOT NULL,
  accepted_user_id uuid,
  revoked_by_user_id uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  expires_at timestamptz NOT NULL,
  purge_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT invitations_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT invitations_accepted_user_id_fkey FOREIGN KEY (accepted_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT invitations_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT invitations_email_check CHECK (
    pg_catalog.btrim(email) <> ''
    AND pg_catalog.strpos(email, '@') > 1
  ),
  CONSTRAINT invitations_email_key_check CHECK (
    email_key = pg_catalog.lower(pg_catalog.btrim(email))
    AND pg_catalog.btrim(email_key) <> ''
  ),
  CONSTRAINT invitations_token_hash_check CHECK (
    token_hash IS NULL OR token_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT invitations_actor_check CHECK (pg_catalog.btrim(invited_by_actor_key) <> ''),
  CONSTRAINT invitations_status_evidence_check CHECK (
    (
      status = 'pending'
      AND token_hash IS NOT NULL
      AND accepted_user_id IS NULL
      AND accepted_at IS NULL
      AND revoked_by_user_id IS NULL
      AND revoked_at IS NULL
      AND expired_at IS NULL
    )
    OR (
      status = 'accepted'
      AND token_hash IS NULL
      AND accepted_user_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND revoked_by_user_id IS NULL
      AND revoked_at IS NULL
      AND expired_at IS NULL
    )
    OR (
      status = 'revoked'
      AND token_hash IS NULL
      AND accepted_user_id IS NULL
      AND accepted_at IS NULL
      AND revoked_by_user_id IS NOT NULL
      AND revoked_at IS NOT NULL
      AND expired_at IS NULL
    )
    OR (
      status = 'expired'
      AND token_hash IS NULL
      AND accepted_user_id IS NULL
      AND accepted_at IS NULL
      AND revoked_by_user_id IS NULL
      AND revoked_at IS NULL
      AND expired_at IS NOT NULL
    )
  ),
  CONSTRAINT invitations_timestamps_check CHECK (
    expires_at > created_at
    AND purge_after > expires_at
    AND updated_at >= created_at
    AND (accepted_at IS NULL OR accepted_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
    AND (expired_at IS NULL OR expired_at >= expires_at)
  ),
  CONSTRAINT invitations_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE UNIQUE INDEX invitations_pending_email_key_idx ON invitations (email_key) WHERE status = 'pending'",
  "CREATE UNIQUE INDEX invitations_token_hash_idx ON invitations (token_hash) WHERE token_hash IS NOT NULL",
  "CREATE INDEX invitations_invited_by_user_id_idx ON invitations (invited_by_user_id) WHERE invited_by_user_id IS NOT NULL",
  "CREATE INDEX invitations_accepted_user_id_idx ON invitations (accepted_user_id) WHERE accepted_user_id IS NOT NULL",
  "CREATE INDEX invitations_revoked_by_user_id_idx ON invitations (revoked_by_user_id) WHERE revoked_by_user_id IS NOT NULL",
  "CREATE INDEX invitations_purge_after_idx ON invitations (purge_after)",
  `
CREATE TABLE sessions (
  id uuid CONSTRAINT sessions_pkey PRIMARY KEY,
  user_id uuid NOT NULL,
  token_hash text,
  csrf_hash text,
  authorization_version bigint NOT NULL,
  rotated_from_session_id uuid,
  issued_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_actor_key text,
  revocation_reason_code text,
  purge_after timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT sessions_rotated_from_session_id_fkey FOREIGN KEY (rotated_from_session_id) REFERENCES sessions(id) ON DELETE RESTRICT,
  CONSTRAINT sessions_token_hash_check CHECK (
    token_hash IS NULL OR token_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT sessions_csrf_hash_check CHECK (
    csrf_hash IS NULL OR csrf_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT sessions_authorization_version_check CHECK (authorization_version >= 1),
  CONSTRAINT sessions_revocation_evidence_check CHECK (
    (
      revoked_at IS NULL
      AND token_hash IS NOT NULL
      AND csrf_hash IS NOT NULL
      AND revoked_by_actor_key IS NULL
      AND revocation_reason_code IS NULL
    )
    OR (
      revoked_at IS NOT NULL
      AND token_hash IS NULL
      AND csrf_hash IS NULL
      AND revoked_by_actor_key IS NOT NULL
      AND pg_catalog.btrim(revoked_by_actor_key) <> ''
      AND revocation_reason_code IS NOT NULL
      AND revocation_reason_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT sessions_rotation_check CHECK (
    rotated_from_session_id IS NULL OR rotated_from_session_id <> id
  ),
  CONSTRAINT sessions_timestamps_check CHECK (
    last_seen_at >= issued_at
    AND idle_expires_at > issued_at
    AND absolute_expires_at >= idle_expires_at
    AND last_seen_at <= absolute_expires_at
    AND (revoked_at IS NULL OR revoked_at >= issued_at)
    AND purge_after > absolute_expires_at
  ),
  CONSTRAINT sessions_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions (token_hash) WHERE token_hash IS NOT NULL",
  "CREATE UNIQUE INDEX sessions_rotated_from_session_id_idx ON sessions (rotated_from_session_id) WHERE rotated_from_session_id IS NOT NULL",
  "CREATE INDEX sessions_user_id_idx ON sessions (user_id)",
  "CREATE INDEX sessions_active_user_expiry_idx ON sessions (user_id, absolute_expires_at) WHERE revoked_at IS NULL",
  "CREATE INDEX sessions_absolute_expires_at_idx ON sessions (absolute_expires_at)",
  "CREATE INDEX sessions_purge_after_idx ON sessions (purge_after)",
  `
CREATE TABLE roles (
  id uuid CONSTRAINT roles_pkey PRIMARY KEY,
  role_key text NOT NULL,
  display_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  retired_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT roles_role_key_key UNIQUE (role_key),
  CONSTRAINT roles_role_key_check CHECK (role_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT roles_display_name_check CHECK (pg_catalog.btrim(display_name) <> ''),
  CONSTRAINT roles_description_check CHECK (description IS NULL OR pg_catalog.btrim(description) <> ''),
  CONSTRAINT roles_status_check CHECK (status IN ('active', 'retired')),
  CONSTRAINT roles_status_time_check CHECK (
    (status = 'active' AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL)
  ),
  CONSTRAINT roles_timestamps_check CHECK (
    updated_at >= created_at
    AND (retired_at IS NULL OR retired_at >= created_at)
  ),
  CONSTRAINT roles_version_check CHECK (version >= 1)
)
  `.trim(),
  `
CREATE TABLE capabilities (
  id uuid CONSTRAINT capabilities_pkey PRIMARY KEY,
  capability_key text NOT NULL,
  display_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  retired_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT capabilities_capability_key_key UNIQUE (capability_key),
  CONSTRAINT capabilities_capability_key_check CHECK (
    capability_key ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'
  ),
  CONSTRAINT capabilities_display_name_check CHECK (pg_catalog.btrim(display_name) <> ''),
  CONSTRAINT capabilities_description_check CHECK (description IS NULL OR pg_catalog.btrim(description) <> ''),
  CONSTRAINT capabilities_status_check CHECK (status IN ('active', 'retired')),
  CONSTRAINT capabilities_status_time_check CHECK (
    (status = 'active' AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL)
  ),
  CONSTRAINT capabilities_timestamps_check CHECK (
    updated_at >= created_at
    AND (retired_at IS NULL OR retired_at >= created_at)
  ),
  CONSTRAINT capabilities_version_check CHECK (version >= 1)
)
  `.trim(),
  `
CREATE TABLE role_capabilities (
  role_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  granted_by_user_id uuid,
  granted_by_actor_key text NOT NULL,
  granted_at timestamptz NOT NULL,
  CONSTRAINT role_capabilities_pkey PRIMARY KEY (role_id, capability_id),
  CONSTRAINT role_capabilities_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
  CONSTRAINT role_capabilities_capability_id_fkey FOREIGN KEY (capability_id) REFERENCES capabilities(id) ON DELETE RESTRICT,
  CONSTRAINT role_capabilities_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT role_capabilities_actor_check CHECK (pg_catalog.btrim(granted_by_actor_key) <> '')
)
  `.trim(),
  "CREATE INDEX role_capabilities_capability_id_idx ON role_capabilities (capability_id, role_id)",
  "CREATE INDEX role_capabilities_granted_by_user_id_idx ON role_capabilities (granted_by_user_id) WHERE granted_by_user_id IS NOT NULL",
  `
CREATE TABLE user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_by_user_id uuid,
  assigned_by_actor_key text NOT NULL,
  assigned_at timestamptz NOT NULL,
  expires_at timestamptz,
  CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
  CONSTRAINT user_roles_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT user_roles_actor_check CHECK (pg_catalog.btrim(assigned_by_actor_key) <> ''),
  CONSTRAINT user_roles_expiry_check CHECK (expires_at IS NULL OR expires_at > assigned_at)
)
  `.trim(),
  "CREATE INDEX user_roles_role_id_idx ON user_roles (role_id, user_id)",
  "CREATE INDEX user_roles_assigned_by_user_id_idx ON user_roles (assigned_by_user_id) WHERE assigned_by_user_id IS NOT NULL",
  "CREATE INDEX user_roles_expires_at_idx ON user_roles (expires_at) WHERE expires_at IS NOT NULL",
  `
CREATE TABLE project_memberships (
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_by_user_id uuid,
  assigned_by_actor_key text NOT NULL,
  assigned_at timestamptz NOT NULL,
  expires_at timestamptz,
  CONSTRAINT project_memberships_pkey PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_memberships_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT project_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT project_memberships_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT project_memberships_actor_check CHECK (pg_catalog.btrim(assigned_by_actor_key) <> ''),
  CONSTRAINT project_memberships_expiry_check CHECK (expires_at IS NULL OR expires_at > assigned_at)
)
  `.trim(),
  "CREATE INDEX project_memberships_user_id_idx ON project_memberships (user_id, project_id)",
  "CREATE INDEX project_memberships_assigned_by_user_id_idx ON project_memberships (assigned_by_user_id) WHERE assigned_by_user_id IS NOT NULL",
  "CREATE INDEX project_memberships_expires_at_idx ON project_memberships (expires_at) WHERE expires_at IS NOT NULL",
  `
CREATE TABLE audit_events (
  id uuid CONSTRAINT audit_events_pkey PRIMARY KEY,
  executor_type text NOT NULL,
  executor_user_id uuid,
  executor_key text NOT NULL,
  originating_user_id uuid,
  originating_actor_key text,
  action text NOT NULL,
  target_type text,
  target_id text,
  result text NOT NULL,
  reason_code text,
  request_id text,
  correlation_id text NOT NULL,
  source text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  retention_policy_key text NOT NULL,
  retention_until timestamptz,
  CONSTRAINT audit_events_executor_user_id_fkey FOREIGN KEY (executor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_originating_user_id_fkey FOREIGN KEY (originating_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_executor_type_check CHECK (
    executor_type IN ('user', 'service', 'system', 'anonymous', 'external')
  ),
  CONSTRAINT audit_events_executor_check CHECK (
    pg_catalog.btrim(executor_key) <> ''
    AND (
      (executor_type = 'user' AND executor_user_id IS NOT NULL)
      OR (executor_type <> 'user' AND executor_user_id IS NULL)
    )
  ),
  CONSTRAINT audit_events_originator_check CHECK (
    (originating_user_id IS NULL AND originating_actor_key IS NULL)
    OR (
      originating_actor_key IS NOT NULL
      AND pg_catalog.btrim(originating_actor_key) <> ''
    )
  ),
  CONSTRAINT audit_events_action_check CHECK (action ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT audit_events_target_check CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (
      target_type IS NOT NULL
      AND target_id IS NOT NULL
      AND target_type ~ '^[a-z][a-z0-9_]*$'
      AND pg_catalog.btrim(target_id) <> ''
    )
  ),
  CONSTRAINT audit_events_result_check CHECK (result IN ('succeeded', 'failed', 'denied')),
  CONSTRAINT audit_events_reason_code_check CHECK (
    reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT audit_events_request_id_check CHECK (request_id IS NULL OR pg_catalog.btrim(request_id) <> ''),
  CONSTRAINT audit_events_correlation_id_check CHECK (pg_catalog.btrim(correlation_id) <> ''),
  CONSTRAINT audit_events_source_check CHECK (source ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT audit_events_metadata_check CHECK (pg_catalog.jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_events_retention_policy_check CHECK (
    retention_policy_key ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT audit_events_retention_time_check CHECK (
    retention_until IS NULL OR retention_until >= occurred_at
  )
)
  `.trim(),
  "CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at DESC, id)",
  "CREATE INDEX audit_events_action_occurred_at_idx ON audit_events (action, occurred_at DESC, id)",
  "CREATE INDEX audit_events_target_occurred_at_idx ON audit_events (target_type, target_id, occurred_at DESC, id) WHERE target_type IS NOT NULL",
  "CREATE INDEX audit_events_correlation_occurred_at_idx ON audit_events (correlation_id, occurred_at DESC, id)",
  "CREATE INDEX audit_events_executor_user_occurred_at_idx ON audit_events (executor_user_id, occurred_at DESC, id) WHERE executor_user_id IS NOT NULL",
  "CREATE INDEX audit_events_originating_user_occurred_at_idx ON audit_events (originating_user_id, occurred_at DESC, id) WHERE originating_user_id IS NOT NULL",
  "CREATE INDEX audit_events_retention_until_idx ON audit_events (retention_until) WHERE retention_until IS NOT NULL",
  `
CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $audit_event_guard$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only' USING ERRCODE = '55000';
END;
$audit_event_guard$
  `.trim(),
  `
CREATE TRIGGER audit_events_append_only_trigger
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation()
  `.trim(),
  `
CREATE TABLE integration_connections (
  id uuid CONSTRAINT integration_connections_pkey PRIMARY KEY,
  provider text NOT NULL,
  connection_key text NOT NULL,
  issuer text,
  external_subject text,
  external_email text,
  hosted_domain text,
  status text NOT NULL DEFAULT 'pending',
  last_connected_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  created_by_user_id uuid,
  created_by_actor_key text NOT NULL,
  updated_by_user_id uuid,
  updated_by_actor_key text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_connections_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT integration_connections_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT integration_connections_connection_key_key UNIQUE (connection_key),
  CONSTRAINT integration_connections_provider_check CHECK (
    provider ~ '^[a-z][a-z0-9_]*$' AND provider = pg_catalog.lower(provider)
  ),
  CONSTRAINT integration_connections_connection_key_check CHECK (
    connection_key ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT integration_connections_external_identity_check CHECK (
    (
      issuer IS NULL
      AND external_subject IS NULL
      AND external_email IS NULL
      AND hosted_domain IS NULL
    )
    OR (
      issuer IS NOT NULL
      AND external_subject IS NOT NULL
      AND external_email IS NOT NULL
      AND pg_catalog.btrim(issuer) <> ''
      AND pg_catalog.btrim(external_subject) <> ''
      AND pg_catalog.strpos(external_email, '@') > 1
      AND (
        hosted_domain IS NULL
        OR (
          pg_catalog.btrim(hosted_domain) <> ''
          AND hosted_domain = pg_catalog.lower(pg_catalog.btrim(hosted_domain))
        )
      )
    )
  ),
  CONSTRAINT integration_connections_status_check CHECK (
    status IN ('pending', 'connected', 'degraded', 'reauthorization_required', 'revoked', 'disabled')
  ),
  CONSTRAINT integration_connections_status_time_check CHECK (
    (status = 'pending' AND last_connected_at IS NULL AND revoked_at IS NULL)
    OR (status IN ('connected', 'degraded', 'reauthorization_required') AND last_connected_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'disabled' AND revoked_at IS NULL)
  ),
  CONSTRAINT integration_connections_error_check CHECK (
    (last_error_at IS NULL AND last_error_code IS NULL)
    OR (
      last_error_at IS NOT NULL
      AND last_error_code IS NOT NULL
      AND last_error_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT integration_connections_created_actor_check CHECK (pg_catalog.btrim(created_by_actor_key) <> ''),
  CONSTRAINT integration_connections_updated_actor_check CHECK (pg_catalog.btrim(updated_by_actor_key) <> ''),
  CONSTRAINT integration_connections_timestamps_check CHECK (
    updated_at >= created_at
    AND (last_connected_at IS NULL OR last_connected_at >= created_at)
    AND (last_success_at IS NULL OR last_success_at >= created_at)
    AND (last_error_at IS NULL OR last_error_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT integration_connections_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE UNIQUE INDEX integration_connections_external_identity_idx ON integration_connections (provider, issuer, external_subject) WHERE issuer IS NOT NULL",
  "CREATE INDEX integration_connections_created_by_user_id_idx ON integration_connections (created_by_user_id) WHERE created_by_user_id IS NOT NULL",
  "CREATE INDEX integration_connections_updated_by_user_id_idx ON integration_connections (updated_by_user_id) WHERE updated_by_user_id IS NOT NULL",
  "CREATE INDEX integration_connections_status_updated_at_idx ON integration_connections (status, updated_at DESC, id)",
  `
CREATE TABLE integration_credentials (
  id uuid CONSTRAINT integration_credentials_pkey PRIMARY KEY,
  connection_id uuid NOT NULL,
  credential_kind text NOT NULL,
  ciphertext bytea,
  key_version text,
  status text NOT NULL DEFAULT 'active',
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_credentials_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE RESTRICT,
  CONSTRAINT integration_credentials_connection_kind_key UNIQUE (connection_id, credential_kind),
  CONSTRAINT integration_credentials_kind_check CHECK (credential_kind ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT integration_credentials_key_version_check CHECK (
    key_version IS NULL OR pg_catalog.btrim(key_version) <> ''
  ),
  CONSTRAINT integration_credentials_status_check CHECK (status IN ('active', 'rotating', 'revoked')),
  CONSTRAINT integration_credentials_status_evidence_check CHECK (
    (status IN ('active', 'rotating') AND ciphertext IS NOT NULL AND key_version IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND ciphertext IS NULL AND key_version IS NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT integration_credentials_rotation_check CHECK (
    (status = 'rotating' AND rotated_at IS NOT NULL)
    OR (status <> 'rotating')
  ),
  CONSTRAINT integration_credentials_timestamps_check CHECK (
    updated_at >= created_at
    AND (rotated_at IS NULL OR rotated_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT integration_credentials_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX integration_credentials_connection_id_idx ON integration_credentials (connection_id)",
  `
CREATE TABLE integration_connection_scopes (
  connection_id uuid NOT NULL,
  scope text NOT NULL,
  granted_at timestamptz NOT NULL,
  CONSTRAINT integration_connection_scopes_pkey PRIMARY KEY (connection_id, scope),
  CONSTRAINT integration_connection_scopes_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE RESTRICT,
  CONSTRAINT integration_connection_scopes_scope_check CHECK (pg_catalog.btrim(scope) <> '')
)
  `.trim(),
  "CREATE INDEX integration_connection_scopes_scope_idx ON integration_connection_scopes (scope, connection_id)",
  `
CREATE TABLE integration_oauth_attempts (
  id uuid CONSTRAINT integration_oauth_attempts_pkey PRIMARY KEY,
  connection_id uuid NOT NULL,
  initiated_by_user_id uuid NOT NULL,
  state_hash text,
  browser_nonce_hash text,
  pkce_verifier_ciphertext bytea,
  key_version text,
  requested_scopes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  failure_code text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  purge_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_oauth_attempts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE RESTRICT,
  CONSTRAINT integration_oauth_attempts_initiated_by_user_id_fkey FOREIGN KEY (initiated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT integration_oauth_attempts_state_hash_check CHECK (
    state_hash IS NULL OR state_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT integration_oauth_attempts_browser_nonce_hash_check CHECK (
    browser_nonce_hash IS NULL OR browser_nonce_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT integration_oauth_attempts_key_version_check CHECK (
    key_version IS NULL OR pg_catalog.btrim(key_version) <> ''
  ),
  CONSTRAINT integration_oauth_attempts_scopes_check CHECK (
    pg_catalog.jsonb_typeof(requested_scopes) = 'array'
    AND pg_catalog.jsonb_array_length(requested_scopes) > 0
  ),
  CONSTRAINT integration_oauth_attempts_status_check CHECK (
    status IN ('pending', 'consumed', 'failed', 'expired')
  ),
  CONSTRAINT integration_oauth_attempts_state_evidence_check CHECK (
    (
      status = 'pending'
      AND state_hash IS NOT NULL
      AND browser_nonce_hash IS NOT NULL
      AND pkce_verifier_ciphertext IS NOT NULL
      AND key_version IS NOT NULL
      AND failure_code IS NULL
      AND consumed_at IS NULL
      AND failed_at IS NULL
      AND expired_at IS NULL
    )
    OR (
      status = 'consumed'
      AND state_hash IS NULL
      AND browser_nonce_hash IS NULL
      AND pkce_verifier_ciphertext IS NULL
      AND key_version IS NULL
      AND failure_code IS NULL
      AND consumed_at IS NOT NULL
      AND failed_at IS NULL
      AND expired_at IS NULL
    )
    OR (
      status = 'failed'
      AND state_hash IS NULL
      AND browser_nonce_hash IS NULL
      AND pkce_verifier_ciphertext IS NULL
      AND key_version IS NULL
      AND failure_code IS NOT NULL
      AND failure_code ~ '^[a-z][a-z0-9_]*$'
      AND consumed_at IS NULL
      AND failed_at IS NOT NULL
      AND expired_at IS NULL
    )
    OR (
      status = 'expired'
      AND state_hash IS NULL
      AND browser_nonce_hash IS NULL
      AND pkce_verifier_ciphertext IS NULL
      AND key_version IS NULL
      AND failure_code IS NULL
      AND consumed_at IS NULL
      AND failed_at IS NULL
      AND expired_at IS NOT NULL
    )
  ),
  CONSTRAINT integration_oauth_attempts_timestamps_check CHECK (
    expires_at > created_at
    AND purge_after > expires_at
    AND updated_at >= created_at
    AND (consumed_at IS NULL OR consumed_at >= created_at)
    AND (failed_at IS NULL OR failed_at >= created_at)
    AND (expired_at IS NULL OR expired_at >= expires_at)
  ),
  CONSTRAINT integration_oauth_attempts_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE UNIQUE INDEX integration_oauth_attempts_state_hash_idx ON integration_oauth_attempts (state_hash) WHERE state_hash IS NOT NULL",
  "CREATE INDEX integration_oauth_attempts_connection_id_idx ON integration_oauth_attempts (connection_id)",
  "CREATE INDEX integration_oauth_attempts_initiated_by_user_id_idx ON integration_oauth_attempts (initiated_by_user_id)",
  "CREATE INDEX integration_oauth_attempts_pending_expiry_idx ON integration_oauth_attempts (expires_at, id) WHERE status = 'pending'",
  "CREATE INDEX integration_oauth_attempts_purge_after_idx ON integration_oauth_attempts (purge_after)",
  `
CREATE TABLE integration_resources (
  id uuid CONSTRAINT integration_resources_pkey PRIMARY KEY,
  connection_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_key text NOT NULL,
  external_id text NOT NULL,
  parent_external_id text,
  external_url text,
  owner_type text NOT NULL,
  client_id uuid,
  project_id uuid,
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_resources_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE RESTRICT,
  CONSTRAINT integration_resources_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT integration_resources_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT integration_resources_connection_id_id_key UNIQUE (connection_id, id),
  CONSTRAINT integration_resources_connection_type_external_key UNIQUE (connection_id, resource_type, external_id),
  CONSTRAINT integration_resources_connection_resource_key UNIQUE (connection_id, resource_key),
  CONSTRAINT integration_resources_type_check CHECK (resource_type ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT integration_resources_key_check CHECK (resource_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT integration_resources_external_id_check CHECK (pg_catalog.btrim(external_id) <> ''),
  CONSTRAINT integration_resources_parent_external_id_check CHECK (
    parent_external_id IS NULL OR pg_catalog.btrim(parent_external_id) <> ''
  ),
  CONSTRAINT integration_resources_external_url_check CHECK (
    external_url IS NULL OR external_url ~ '^https://'
  ),
  CONSTRAINT integration_resources_owner_check CHECK (
    (owner_type = 'workspace' AND client_id IS NULL AND project_id IS NULL)
    OR (owner_type = 'client' AND client_id IS NOT NULL AND project_id IS NULL)
    OR (owner_type = 'project' AND client_id IS NULL AND project_id IS NOT NULL)
  ),
  CONSTRAINT integration_resources_status_check CHECK (
    status IN ('pending', 'verified', 'disabled', 'archived')
  ),
  CONSTRAINT integration_resources_status_time_check CHECK (
    (status = 'pending' AND verified_at IS NULL AND archived_at IS NULL)
    OR (status IN ('verified', 'disabled') AND verified_at IS NOT NULL AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT integration_resources_metadata_check CHECK (pg_catalog.jsonb_typeof(metadata) = 'object'),
  CONSTRAINT integration_resources_timestamps_check CHECK (
    updated_at >= created_at
    AND (verified_at IS NULL OR verified_at >= created_at)
    AND (archived_at IS NULL OR archived_at >= created_at)
  ),
  CONSTRAINT integration_resources_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX integration_resources_connection_id_idx ON integration_resources (connection_id)",
  "CREATE INDEX integration_resources_client_id_idx ON integration_resources (client_id) WHERE client_id IS NOT NULL",
  "CREATE INDEX integration_resources_project_id_idx ON integration_resources (project_id) WHERE project_id IS NOT NULL",
  "CREATE INDEX integration_resources_status_updated_at_idx ON integration_resources (status, updated_at DESC, id)",
  `
CREATE TABLE integration_cursors (
  id uuid CONSTRAINT integration_cursors_pkey PRIMARY KEY,
  resource_id uuid NOT NULL,
  cursor_kind text NOT NULL,
  cursor_ciphertext bytea,
  key_version text,
  status text NOT NULL DEFAULT 'active',
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_cursors_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES integration_resources(id) ON DELETE RESTRICT,
  CONSTRAINT integration_cursors_resource_kind_key UNIQUE (resource_id, cursor_kind),
  CONSTRAINT integration_cursors_kind_check CHECK (cursor_kind ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT integration_cursors_key_version_check CHECK (
    key_version IS NULL OR pg_catalog.btrim(key_version) <> ''
  ),
  CONSTRAINT integration_cursors_status_check CHECK (
    status IN ('active', 'resync_required', 'disabled')
  ),
  CONSTRAINT integration_cursors_status_evidence_check CHECK (
    (status = 'active' AND cursor_ciphertext IS NOT NULL AND key_version IS NOT NULL)
    OR (status IN ('resync_required', 'disabled') AND cursor_ciphertext IS NULL AND key_version IS NULL)
  ),
  CONSTRAINT integration_cursors_error_check CHECK (
    (last_error_at IS NULL AND last_error_code IS NULL)
    OR (
      last_error_at IS NOT NULL
      AND last_error_code IS NOT NULL
      AND last_error_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT integration_cursors_timestamps_check CHECK (
    updated_at >= created_at
    AND (last_success_at IS NULL OR last_success_at >= created_at)
    AND (last_error_at IS NULL OR last_error_at >= created_at)
    AND (expires_at IS NULL OR expires_at > created_at)
  ),
  CONSTRAINT integration_cursors_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX integration_cursors_resource_id_idx ON integration_cursors (resource_id)",
  "CREATE INDEX integration_cursors_expires_at_idx ON integration_cursors (expires_at) WHERE expires_at IS NOT NULL",
  `
CREATE TABLE integration_events (
  id uuid CONSTRAINT integration_events_pkey PRIMARY KEY,
  connection_id uuid NOT NULL,
  resource_id uuid,
  event_key text NOT NULL,
  event_type text NOT NULL,
  executor_type text NOT NULL,
  executor_user_id uuid,
  executor_key text NOT NULL,
  result text NOT NULL,
  error_code text,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  retention_policy_key text NOT NULL,
  retention_until timestamptz,
  CONSTRAINT integration_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE RESTRICT,
  CONSTRAINT integration_events_connection_resource_fkey FOREIGN KEY (connection_id, resource_id) REFERENCES integration_resources(connection_id, id) ON DELETE RESTRICT,
  CONSTRAINT integration_events_executor_user_id_fkey FOREIGN KEY (executor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT integration_events_connection_event_key UNIQUE (connection_id, event_key),
  CONSTRAINT integration_events_event_key_check CHECK (pg_catalog.btrim(event_key) <> ''),
  CONSTRAINT integration_events_event_type_check CHECK (
    event_type ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'
  ),
  CONSTRAINT integration_events_executor_type_check CHECK (
    executor_type IN ('user', 'service', 'system', 'anonymous', 'external')
  ),
  CONSTRAINT integration_events_executor_check CHECK (
    pg_catalog.btrim(executor_key) <> ''
    AND (
      (executor_type = 'user' AND executor_user_id IS NOT NULL)
      OR (executor_type <> 'user' AND executor_user_id IS NULL)
    )
  ),
  CONSTRAINT integration_events_result_check CHECK (result IN ('succeeded', 'failed', 'denied')),
  CONSTRAINT integration_events_error_check CHECK (
    error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT integration_events_correlation_check CHECK (pg_catalog.btrim(correlation_id) <> ''),
  CONSTRAINT integration_events_metadata_check CHECK (pg_catalog.jsonb_typeof(metadata) = 'object'),
  CONSTRAINT integration_events_retention_policy_check CHECK (
    retention_policy_key ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT integration_events_retention_time_check CHECK (
    retention_until IS NULL OR retention_until >= occurred_at
  )
)
  `.trim(),
  "CREATE INDEX integration_events_occurred_at_idx ON integration_events (occurred_at DESC, id)",
  "CREATE INDEX integration_events_connection_resource_idx ON integration_events (connection_id, resource_id) WHERE resource_id IS NOT NULL",
  "CREATE INDEX integration_events_connection_occurred_at_idx ON integration_events (connection_id, occurred_at DESC, id)",
  "CREATE INDEX integration_events_resource_occurred_at_idx ON integration_events (resource_id, occurred_at DESC, id) WHERE resource_id IS NOT NULL",
  "CREATE INDEX integration_events_executor_user_id_idx ON integration_events (executor_user_id) WHERE executor_user_id IS NOT NULL",
  "CREATE INDEX integration_events_result_occurred_at_idx ON integration_events (result, occurred_at DESC, id)",
  "CREATE INDEX integration_events_retention_until_idx ON integration_events (retention_until) WHERE retention_until IS NOT NULL",
  `
CREATE FUNCTION prevent_integration_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $integration_event_guard$
BEGIN
  RAISE EXCEPTION 'integration_events are append-only' USING ERRCODE = '55000';
END;
$integration_event_guard$
  `.trim(),
  `
CREATE TRIGGER integration_events_append_only_trigger
BEFORE UPDATE OR DELETE ON integration_events
FOR EACH ROW EXECUTE FUNCTION prevent_integration_event_mutation()
  `.trim(),
  `
CREATE TABLE files (
  id uuid CONSTRAINT files_pkey PRIMARY KEY,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_version_number bigint NOT NULL,
  retention_policy_key text NOT NULL,
  retention_until timestamptz,
  created_by_user_id uuid,
  created_by_actor_key text NOT NULL,
  archived_by_user_id uuid,
  archived_by_actor_key text,
  archived_at timestamptz,
  deleted_by_user_id uuid,
  deleted_by_actor_key text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT files_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT files_archived_by_user_id_fkey FOREIGN KEY (archived_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT files_deleted_by_user_id_fkey FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT files_category_check CHECK (category ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT files_status_check CHECK (status IN ('active', 'archived', 'deleted')),
  CONSTRAINT files_current_version_check CHECK (current_version_number >= 1),
  CONSTRAINT files_retention_policy_check CHECK (retention_policy_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT files_created_actor_check CHECK (pg_catalog.btrim(created_by_actor_key) <> ''),
  CONSTRAINT files_archive_actor_check CHECK (
    (archived_by_user_id IS NULL AND archived_by_actor_key IS NULL AND archived_at IS NULL)
    OR (
      archived_by_actor_key IS NOT NULL
      AND pg_catalog.btrim(archived_by_actor_key) <> ''
      AND archived_at IS NOT NULL
    )
  ),
  CONSTRAINT files_delete_actor_check CHECK (
    (deleted_by_user_id IS NULL AND deleted_by_actor_key IS NULL AND deleted_at IS NULL)
    OR (
      deleted_by_actor_key IS NOT NULL
      AND pg_catalog.btrim(deleted_by_actor_key) <> ''
      AND deleted_at IS NOT NULL
    )
  ),
  CONSTRAINT files_status_evidence_check CHECK (
    (status = 'active' AND archived_at IS NULL AND deleted_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL AND deleted_at IS NULL)
    OR (status = 'deleted' AND deleted_at IS NOT NULL)
  ),
  CONSTRAINT files_timestamps_check CHECK (
    updated_at >= created_at
    AND (retention_until IS NULL OR retention_until >= created_at)
    AND (archived_at IS NULL OR archived_at >= created_at)
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT files_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX files_created_by_user_id_idx ON files (created_by_user_id) WHERE created_by_user_id IS NOT NULL",
  "CREATE INDEX files_archived_by_user_id_idx ON files (archived_by_user_id) WHERE archived_by_user_id IS NOT NULL",
  "CREATE INDEX files_deleted_by_user_id_idx ON files (deleted_by_user_id) WHERE deleted_by_user_id IS NOT NULL",
  "CREATE INDEX files_current_version_idx ON files (id, current_version_number)",
  "CREATE INDEX files_retention_until_idx ON files (retention_until) WHERE retention_until IS NOT NULL",
  `
CREATE TABLE file_versions (
  id uuid CONSTRAINT file_versions_pkey PRIMARY KEY,
  file_id uuid NOT NULL,
  version_number bigint NOT NULL,
  status text NOT NULL DEFAULT 'registered',
  source_key text NOT NULL,
  original_filename text NOT NULL,
  declared_media_type text NOT NULL,
  detected_media_type text,
  byte_size bigint,
  sha256_checksum text,
  created_by_user_id uuid,
  created_by_actor_key text NOT NULL,
  released_at timestamptz,
  rejection_code text,
  rejected_at timestamptz,
  deleted_by_user_id uuid,
  deleted_by_actor_key text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT file_versions_file_id_fkey FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE RESTRICT,
  CONSTRAINT file_versions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT file_versions_deleted_by_user_id_fkey FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT file_versions_file_version_key UNIQUE (file_id, version_number),
  CONSTRAINT file_versions_source_key_key UNIQUE (source_key),
  CONSTRAINT file_versions_version_number_check CHECK (version_number >= 1),
  CONSTRAINT file_versions_status_check CHECK (
    status IN ('registered', 'quarantined', 'scanning', 'released', 'rejected', 'deleted')
  ),
  CONSTRAINT file_versions_source_key_check CHECK (source_key ~ '^[a-z0-9][a-z0-9/_-]*$'),
  CONSTRAINT file_versions_filename_check CHECK (pg_catalog.btrim(original_filename) <> ''),
  CONSTRAINT file_versions_declared_media_type_check CHECK (pg_catalog.btrim(declared_media_type) <> ''),
  CONSTRAINT file_versions_detected_media_type_check CHECK (
    detected_media_type IS NULL OR pg_catalog.btrim(detected_media_type) <> ''
  ),
  CONSTRAINT file_versions_byte_size_check CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT file_versions_sha256_check CHECK (
    sha256_checksum IS NULL OR sha256_checksum ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT file_versions_created_actor_check CHECK (pg_catalog.btrim(created_by_actor_key) <> ''),
  CONSTRAINT file_versions_deleted_actor_check CHECK (
    (deleted_by_user_id IS NULL AND deleted_by_actor_key IS NULL AND deleted_at IS NULL)
    OR (
      deleted_by_actor_key IS NOT NULL
      AND pg_catalog.btrim(deleted_by_actor_key) <> ''
      AND deleted_at IS NOT NULL
    )
  ),
  CONSTRAINT file_versions_status_evidence_check CHECK (
    (
      status IN ('registered', 'quarantined', 'scanning')
      AND released_at IS NULL
      AND rejection_code IS NULL
      AND rejected_at IS NULL
      AND deleted_at IS NULL
    )
    OR (
      status = 'released'
      AND detected_media_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND sha256_checksum IS NOT NULL
      AND released_at IS NOT NULL
      AND rejection_code IS NULL
      AND rejected_at IS NULL
      AND deleted_at IS NULL
    )
    OR (
      status = 'rejected'
      AND released_at IS NULL
      AND rejection_code IS NOT NULL
      AND rejection_code ~ '^[a-z][a-z0-9_]*$'
      AND rejected_at IS NOT NULL
      AND deleted_at IS NULL
    )
    OR (
      status = 'deleted'
      AND released_at IS NULL
      AND rejection_code IS NULL
      AND rejected_at IS NULL
      AND deleted_at IS NOT NULL
    )
  ),
  CONSTRAINT file_versions_timestamps_check CHECK (
    updated_at >= created_at
    AND (released_at IS NULL OR released_at >= created_at)
    AND (rejected_at IS NULL OR rejected_at >= created_at)
    AND (deleted_at IS NULL OR deleted_at >= created_at)
  ),
  CONSTRAINT file_versions_row_version_check CHECK (row_version >= 1)
)
  `.trim(),
  "CREATE INDEX file_versions_created_by_user_id_idx ON file_versions (created_by_user_id) WHERE created_by_user_id IS NOT NULL",
  "CREATE INDEX file_versions_deleted_by_user_id_idx ON file_versions (deleted_by_user_id) WHERE deleted_by_user_id IS NOT NULL",
  "CREATE INDEX file_versions_status_updated_at_idx ON file_versions (status, updated_at DESC, id)",
  `
ALTER TABLE files
ADD CONSTRAINT files_current_version_fkey FOREIGN KEY (id, current_version_number)
REFERENCES file_versions(file_id, version_number)
DEFERRABLE INITIALLY DEFERRED
  `.trim(),
  `
CREATE TABLE storage_objects (
  id uuid CONSTRAINT storage_objects_pkey PRIMARY KEY,
  file_version_id uuid NOT NULL,
  purpose text NOT NULL,
  provider text NOT NULL,
  container text NOT NULL,
  object_key text NOT NULL,
  generation text,
  status text NOT NULL DEFAULT 'pending',
  media_type text,
  byte_size bigint,
  sha256_checksum text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_code text,
  verified_at timestamptz,
  deleted_at timestamptz,
  retention_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT storage_objects_file_version_id_fkey FOREIGN KEY (file_version_id) REFERENCES file_versions(id) ON DELETE RESTRICT,
  CONSTRAINT storage_objects_file_version_purpose_key UNIQUE (file_version_id, purpose),
  CONSTRAINT storage_objects_provider_container_object_key UNIQUE (provider, container, object_key),
  CONSTRAINT storage_objects_purpose_check CHECK (purpose IN ('quarantine', 'released')),
  CONSTRAINT storage_objects_provider_check CHECK (provider ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT storage_objects_container_check CHECK (pg_catalog.btrim(container) <> ''),
  CONSTRAINT storage_objects_object_key_check CHECK (pg_catalog.btrim(object_key) <> ''),
  CONSTRAINT storage_objects_generation_check CHECK (
    generation IS NULL OR pg_catalog.btrim(generation) <> ''
  ),
  CONSTRAINT storage_objects_status_check CHECK (status IN ('pending', 'available', 'failed', 'deleted')),
  CONSTRAINT storage_objects_media_type_check CHECK (
    media_type IS NULL OR pg_catalog.btrim(media_type) <> ''
  ),
  CONSTRAINT storage_objects_byte_size_check CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT storage_objects_sha256_check CHECK (
    sha256_checksum IS NULL OR sha256_checksum ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT storage_objects_metadata_check CHECK (pg_catalog.jsonb_typeof(metadata) = 'object'),
  CONSTRAINT storage_objects_status_evidence_check CHECK (
    (
      status = 'pending'
      AND generation IS NULL
      AND byte_size IS NULL
      AND sha256_checksum IS NULL
      AND failure_code IS NULL
      AND verified_at IS NULL
      AND deleted_at IS NULL
    )
    OR (
      status = 'available'
      AND generation IS NOT NULL
      AND media_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND sha256_checksum IS NOT NULL
      AND failure_code IS NULL
      AND verified_at IS NOT NULL
      AND deleted_at IS NULL
    )
    OR (
      status = 'failed'
      AND generation IS NULL
      AND failure_code IS NOT NULL
      AND failure_code ~ '^[a-z][a-z0-9_]*$'
      AND verified_at IS NULL
      AND deleted_at IS NULL
    )
    OR (
      status = 'deleted'
      AND generation IS NOT NULL
      AND failure_code IS NULL
      AND deleted_at IS NOT NULL
    )
  ),
  CONSTRAINT storage_objects_timestamps_check CHECK (
    updated_at >= created_at
    AND (verified_at IS NULL OR verified_at >= created_at)
    AND (deleted_at IS NULL OR deleted_at >= created_at)
    AND (retention_until IS NULL OR retention_until >= created_at)
  ),
  CONSTRAINT storage_objects_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX storage_objects_file_version_id_idx ON storage_objects (file_version_id)",
  "CREATE INDEX storage_objects_retention_until_idx ON storage_objects (retention_until) WHERE retention_until IS NOT NULL",
  "CREATE INDEX storage_objects_status_updated_at_idx ON storage_objects (status, updated_at DESC, id)",
  `
CREATE TABLE file_links (
  id uuid CONSTRAINT file_links_pkey PRIMARY KEY,
  file_id uuid NOT NULL,
  client_id uuid,
  project_id uuid,
  relationship_key text NOT NULL,
  linked_by_user_id uuid,
  linked_by_actor_key text NOT NULL,
  linked_at timestamptz NOT NULL,
  unlinked_by_user_id uuid,
  unlinked_by_actor_key text,
  unlinked_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT file_links_file_id_fkey FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE RESTRICT,
  CONSTRAINT file_links_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT file_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT file_links_linked_by_user_id_fkey FOREIGN KEY (linked_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT file_links_unlinked_by_user_id_fkey FOREIGN KEY (unlinked_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT file_links_target_check CHECK (pg_catalog.num_nonnulls(client_id, project_id) = 1),
  CONSTRAINT file_links_relationship_key_check CHECK (relationship_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT file_links_linked_actor_check CHECK (pg_catalog.btrim(linked_by_actor_key) <> ''),
  CONSTRAINT file_links_unlinked_actor_check CHECK (
    (unlinked_by_user_id IS NULL AND unlinked_by_actor_key IS NULL AND unlinked_at IS NULL)
    OR (
      unlinked_by_actor_key IS NOT NULL
      AND pg_catalog.btrim(unlinked_by_actor_key) <> ''
      AND unlinked_at IS NOT NULL
    )
  ),
  CONSTRAINT file_links_unlinked_time_check CHECK (
    unlinked_at IS NULL OR unlinked_at >= linked_at
  ),
  CONSTRAINT file_links_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE UNIQUE INDEX file_links_active_client_idx ON file_links (file_id, client_id, relationship_key) WHERE client_id IS NOT NULL AND unlinked_at IS NULL",
  "CREATE UNIQUE INDEX file_links_active_project_idx ON file_links (file_id, project_id, relationship_key) WHERE project_id IS NOT NULL AND unlinked_at IS NULL",
  "CREATE INDEX file_links_file_id_idx ON file_links (file_id)",
  "CREATE INDEX file_links_client_id_idx ON file_links (client_id) WHERE client_id IS NOT NULL",
  "CREATE INDEX file_links_project_id_idx ON file_links (project_id) WHERE project_id IS NOT NULL",
  "CREATE INDEX file_links_linked_by_user_id_idx ON file_links (linked_by_user_id) WHERE linked_by_user_id IS NOT NULL",
  "CREATE INDEX file_links_unlinked_by_user_id_idx ON file_links (unlinked_by_user_id) WHERE unlinked_by_user_id IS NOT NULL",
] as const;
