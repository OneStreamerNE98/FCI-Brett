/**
 * Minimized security-audit projection for the Administrator Activity reader.
 *
 * The general runtime role remains unable to SELECT from audit_events. The
 * least-privilege policy grants SELECT only on this security-barrier view,
 * whose columns deliberately omit raw metadata, identifiers, credentials,
 * request/correlation evidence, and retention fields.
 */
export const ADMIN_AUDIT_ACTIVITY_STATEMENTS = [
  `
CREATE INDEX audit_events_occurred_cursor_key_idx
ON audit_events (
  occurred_at DESC,
  (pg_catalog.encode(pg_catalog.sha256(id::text::bytea), 'hex'))
)
  `.trim(),
  `
CREATE INDEX audit_events_result_occurred_cursor_key_idx
ON audit_events (
  result,
  occurred_at DESC,
  (pg_catalog.encode(pg_catalog.sha256(id::text::bytea), 'hex'))
)
  `.trim(),
  `
CREATE VIEW audit_activity_projection
WITH (security_barrier = true, security_invoker = false)
AS
SELECT pg_catalog.encode(
         pg_catalog.sha256(event.id::text::bytea),
         'hex'
       ) AS cursor_key,
       pg_catalog.left(CASE
         WHEN actor.id IS NOT NULL
           THEN actor.display_name || ' (' || actor.email || ')'
         WHEN event.executor_type = 'service' THEN 'FCI service'
         WHEN event.executor_type = 'system' THEN 'FCI system'
         WHEN event.executor_type = 'external' THEN 'External actor'
         WHEN event.executor_type = 'anonymous' THEN 'Unknown visitor'
         ELSE 'Unknown actor'
       END, 320) AS actor_label,
       event.action,
       pg_catalog.left(CASE
         WHEN target_user.id IS NOT NULL
           THEN target_user.display_name || ' (' || target_user.email || ')'
         WHEN target_invitation.id IS NOT NULL
           THEN 'Invitation for ' || target_invitation.email
         WHEN target_project.id IS NOT NULL
           THEN target_project.project_number || ' — ' || target_project.name
         WHEN event.target_type = 'session' THEN 'Employee session'
         WHEN event.target_type = 'operation' AND event.target_id = 'audit.view'
           THEN 'Security activity'
         WHEN event.target_type = 'operation' AND event.target_id = 'access_admin.view'
           THEN 'People & Access'
         WHEN event.target_type = 'operation' THEN 'Application operation'
         WHEN event.target_type = 'file' THEN 'Project file'
         WHEN event.target_type = 'route' THEN 'Application request'
         WHEN event.target_type IS NULL THEN 'FCI Operations'
         ELSE pg_catalog.initcap(pg_catalog.replace(event.target_type, '_', ' '))
       END, 512) AS target_label,
       event.result,
       event.reason_code,
       CASE
         WHEN event.action IN (
           'identity.invitation_created',
           'identity.invitation_revoked',
           'authorization.user_access_changed',
           'identity.user_disabled',
           'identity.sessions_invalidated'
         )
         AND pg_catalog.jsonb_typeof(event.metadata -> 'reason') = 'string'
         THEN pg_catalog.left(
           NULLIF(pg_catalog.btrim(event.metadata ->> 'reason'), ''),
           500
         )
         ELSE NULL
       END AS administrator_reason,
       event.occurred_at
FROM audit_events AS event
LEFT JOIN users AS actor ON actor.id = event.executor_user_id
LEFT JOIN users AS target_user
  ON event.target_type = 'user'
 AND target_user.id::text = event.target_id
LEFT JOIN invitations AS target_invitation
  ON event.target_type = 'invitation'
 AND target_invitation.id::text = event.target_id
LEFT JOIN projects AS target_project
  ON event.target_type = 'project'
 AND target_project.id::text = event.target_id
  `.trim(),
] as const;
