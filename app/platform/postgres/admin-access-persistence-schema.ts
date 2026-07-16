/**
 * Immutable first-rollout access catalog and the additive persistence changes
 * needed by the small-organization administration surface. This migration
 * deliberately seeds no employee, invitation, external identity, or session.
 * Role permissions are fixed presets; later policy changes require a new
 * reviewed migration instead of runtime edits to this catalog.
 * Migration 4 intentionally fails before writing if the generic version-3
 * role/access tables already contain data. No production database has applied
 * version 3 yet; a future populated upgrade requires an explicit backfill
 * migration instead of guessing role or invitation meaning.
 */

export const ADMIN_ACCESS_ROLE_CATALOG = Object.freeze([
  Object.freeze({
    id: "10000000-0000-4000-8000-000000000001",
    key: "administrator",
    displayName: "Administrator",
    description: "Company-wide access, financial visibility, and access administration.",
  }),
  Object.freeze({
    id: "10000000-0000-4000-8000-000000000002",
    key: "office_operations",
    displayName: "Office Operations",
    description: "Company-wide nonfinancial operations without sensitive administration.",
  }),
  Object.freeze({
    id: "10000000-0000-4000-8000-000000000003",
    key: "project_manager",
    displayName: "Project Manager",
    description: "Nonfinancial operations for explicitly assigned projects.",
  }),
] as const);

export const ADMIN_ACCESS_CAPABILITY_CATALOG = Object.freeze([
  Object.freeze({ id: "20000000-0000-4000-8000-000000000001", key: "records.read", displayName: "Read records" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000002", key: "leads.create", displayName: "Create leads" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000003", key: "leads.update", displayName: "Update leads" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000004", key: "clients.create", displayName: "Create clients" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000005", key: "clients.update", displayName: "Update clients" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000006", key: "contacts.create", displayName: "Create contacts" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000007", key: "contacts.update", displayName: "Update contacts" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000008", key: "financials.read", displayName: "View financials" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000009", key: "projects.create", displayName: "Create projects" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000010", key: "projects.assign", displayName: "Assign projects" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000011", key: "projects.status.update", displayName: "Update project status" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000012", key: "tasks.update", displayName: "Update tasks" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000013", key: "meetings.update", displayName: "Update meetings" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000014", key: "notes.update", displayName: "Update notes" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000015", key: "gmail.file", displayName: "File Gmail" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000016", key: "calendar.create", displayName: "Create Calendar events" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000017", key: "files.read", displayName: "View files" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000018", key: "files.upload", displayName: "Upload files" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000019", key: "files.share", displayName: "Share files" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000020", key: "data.export", displayName: "Export data" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000021", key: "audit.read", displayName: "View audit records" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000022", key: "access_admin.read", displayName: "View access administration" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000023", key: "invitations.create", displayName: "Create invitations" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000024", key: "invitations.revoke", displayName: "Revoke invitations" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000025", key: "users.disable", displayName: "Disable users" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000026", key: "roles.assign", displayName: "Assign roles" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000027", key: "sessions.revoke", displayName: "Revoke sessions" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000028", key: "field_links.create", displayName: "Create Field links" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000029", key: "field_links.revoke", displayName: "Revoke Field links" }),
  Object.freeze({ id: "20000000-0000-4000-8000-000000000030", key: "role_permissions.update", displayName: "Update role permissions" }),
] as const);

export const ADMIN_ACCESS_ROLE_CAPABILITY_KEYS = Object.freeze({
  administrator: Object.freeze(ADMIN_ACCESS_CAPABILITY_CATALOG.map(({ key }) => key)),
  office_operations: Object.freeze([
    "records.read",
    "leads.create",
    "leads.update",
    "clients.create",
    "clients.update",
    "contacts.create",
    "contacts.update",
    "projects.status.update",
    "tasks.update",
    "meetings.update",
    "notes.update",
    "files.read",
    "files.upload",
  ] as const),
  project_manager: Object.freeze([
    "records.read",
    "projects.status.update",
    "tasks.update",
    "meetings.update",
    "notes.update",
    "files.read",
    "files.upload",
  ] as const),
} as const);

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const capabilityIdByKey = new Map(
  ADMIN_ACCESS_CAPABILITY_CATALOG.map(({ id, key }) => [key, id]),
);

const roleCapabilityValues = ADMIN_ACCESS_ROLE_CATALOG.flatMap((role) =>
  ADMIN_ACCESS_ROLE_CAPABILITY_KEYS[role.key].map((capabilityKey) => {
    const capabilityId = capabilityIdByKey.get(capabilityKey);
    if (!capabilityId) {
      throw new Error(`Admin access catalog capability ${capabilityKey} is missing`);
    }
    return `(${sqlText(role.id)}::uuid, ${sqlText(capabilityId)}::uuid, NULL, 'system:migration_4', pg_catalog.transaction_timestamp())`;
  }));

export const ADMIN_ACCESS_PERSISTENCE_STATEMENTS = [
  `DO $admin_access_preflight$
   BEGIN
     IF EXISTS (SELECT 1 FROM roles LIMIT 1)
       OR EXISTS (SELECT 1 FROM capabilities LIMIT 1)
       OR EXISTS (SELECT 1 FROM role_capabilities LIMIT 1)
       OR EXISTS (SELECT 1 FROM invitations LIMIT 1)
       OR EXISTS (SELECT 1 FROM user_roles LIMIT 1)
       OR EXISTS (SELECT 1 FROM project_memberships LIMIT 1)
     THEN
       RAISE EXCEPTION USING
         ERRCODE = '55000',
         MESSAGE = 'admin_access_persistence requires empty version-3 role and access tables; use a reviewed backfill migration for populated data';
     END IF;
   END
   $admin_access_preflight$`,
  `INSERT INTO roles (
     id, role_key, display_name, description, status,
     created_at, updated_at, version
   ) VALUES
   ${ADMIN_ACCESS_ROLE_CATALOG.map((role) =>
    `(${sqlText(role.id)}::uuid, ${sqlText(role.key)}, ${sqlText(role.displayName)}, ${sqlText(role.description)}, 'active', pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(), 1)`
  ).join(",\n   ")}`,
  `INSERT INTO capabilities (
     id, capability_key, display_name, description, status,
     created_at, updated_at, version
   ) VALUES
   ${ADMIN_ACCESS_CAPABILITY_CATALOG.map((capability) =>
    `(${sqlText(capability.id)}::uuid, ${sqlText(capability.key)}, ${sqlText(capability.displayName)}, NULL, 'active', pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(), 1)`
  ).join(",\n   ")}`,
  `INSERT INTO role_capabilities (
     role_id, capability_id, granted_by_user_id,
     granted_by_actor_key, granted_at
   ) VALUES
   ${roleCapabilityValues.join(",\n   ")}`,
  `ALTER TABLE invitations
   ADD COLUMN role_id uuid NOT NULL,
   ADD CONSTRAINT invitations_role_id_fkey FOREIGN KEY (role_id)
     REFERENCES roles(id) ON DELETE RESTRICT`,
  "CREATE INDEX invitations_role_id_idx ON invitations (role_id)",
  `CREATE TABLE invitation_project_assignments (
     invitation_id uuid NOT NULL,
     project_id uuid NOT NULL,
     assigned_at timestamptz NOT NULL,
     CONSTRAINT invitation_project_assignments_pkey PRIMARY KEY (invitation_id, project_id),
     CONSTRAINT invitation_project_assignments_invitation_id_fkey FOREIGN KEY (invitation_id)
       REFERENCES invitations(id) ON DELETE RESTRICT,
     CONSTRAINT invitation_project_assignments_project_id_fkey FOREIGN KEY (project_id)
       REFERENCES projects(id) ON DELETE RESTRICT
   )`,
  "CREATE INDEX invitation_project_assignments_project_id_idx ON invitation_project_assignments (project_id, invitation_id)",
  `ALTER TABLE user_roles
   ADD COLUMN version bigint NOT NULL DEFAULT 1,
   ADD CONSTRAINT user_roles_version_check CHECK (version >= 1),
   ADD CONSTRAINT user_roles_permanent_check CHECK (expires_at IS NULL)`,
  "CREATE UNIQUE INDEX user_roles_one_role_per_user_idx ON user_roles (user_id)",
  `ALTER TABLE project_memberships
   ADD COLUMN status text NOT NULL DEFAULT 'active',
   ADD COLUMN revoked_by_user_id uuid,
   ADD COLUMN revoked_by_actor_key text,
   ADD COLUMN revoked_at timestamptz,
   ADD COLUMN revocation_reason_code text,
   ADD COLUMN version bigint NOT NULL DEFAULT 1,
   ADD CONSTRAINT project_memberships_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id)
     REFERENCES users(id) ON DELETE RESTRICT,
   ADD CONSTRAINT project_memberships_status_check CHECK (status IN ('active', 'revoked')),
   ADD CONSTRAINT project_memberships_revocation_evidence_check CHECK (
     (
       status = 'active'
       AND revoked_by_user_id IS NULL
       AND revoked_by_actor_key IS NULL
       AND revoked_at IS NULL
       AND revocation_reason_code IS NULL
     )
     OR (
       status = 'revoked'
       AND revoked_by_user_id IS NOT NULL
       AND revoked_by_actor_key IS NOT NULL
       AND pg_catalog.btrim(revoked_by_actor_key) <> ''
       AND revoked_at IS NOT NULL
       AND revocation_reason_code IS NOT NULL
     )
   ),
   ADD CONSTRAINT project_memberships_revocation_reason_code_check CHECK (
     revocation_reason_code IS NULL
     OR revocation_reason_code ~ '^[a-z][a-z0-9_]*$'
   ),
   ADD CONSTRAINT project_memberships_revocation_time_check CHECK (
     revoked_at IS NULL OR revoked_at >= assigned_at
   ),
   ADD CONSTRAINT project_memberships_permanent_check CHECK (expires_at IS NULL),
   ADD CONSTRAINT project_memberships_version_check CHECK (version >= 1)`,
  "CREATE INDEX project_memberships_revoked_by_user_id_idx ON project_memberships (revoked_by_user_id) WHERE revoked_by_user_id IS NOT NULL",
] as const;
