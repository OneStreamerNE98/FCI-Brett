import { createHash } from "node:crypto";

import { ADMIN_AUDIT_ACTIVITY_STATEMENTS } from "./admin-audit-activity-schema.ts";
import { ADMIN_ACCESS_PERSISTENCE_STATEMENTS } from "./admin-access-persistence-schema.ts";
import { LEAD_PROJECT_MEETING_STATEMENTS } from "./lead-project-meeting-schema.ts";
import { PRODUCTION_PERSISTENCE_STATEMENTS } from "./production-persistence-schema.ts";
import { SETTINGS_PERSISTENCE_STATEMENTS } from "./settings-persistence-schema.ts";
import { TASK_SCHEMA_STATEMENTS } from "./task-schema.ts";

export interface ProductionSchemaMigration {
  version: number;
  name: string;
  checksum: string;
  statements: readonly string[];
}

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

/**
 * A dedicated PostgreSQL connection. Session advisory locks are connection
 * scoped, so callers must not substitute a pool-level query helper here.
 */
export interface PostgresMigrationClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  release(error?: Error): void;
}

export interface PostgresMigrationPool {
  connect(): Promise<PostgresMigrationClient>;
}

export const PRODUCTION_MIGRATION_LOCK_ID = "7314269172071301";

export const PRODUCTION_SCHEMA_HISTORY_SQL = `
CREATE TABLE IF NOT EXISTS production_schema_migrations (
  version integer CONSTRAINT production_schema_migrations_pkey PRIMARY KEY,
  name text CONSTRAINT production_schema_migrations_name_key UNIQUE NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT production_schema_migrations_version_check CHECK (version > 0),
  CONSTRAINT production_schema_migrations_name_check CHECK (name ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT production_schema_migrations_checksum_check CHECK (checksum ~ '^sha256:[0-9a-f]{64}$')
)
`.trim();

const CORE_RECORD_STATEMENTS = [
  `
CREATE TABLE clients (
  id uuid CONSTRAINT clients_pkey PRIMARY KEY,
  client_code text NOT NULL,
  name text NOT NULL,
  normalized_name_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  industry text,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT clients_client_code_key UNIQUE (client_code),
  CONSTRAINT clients_normalized_name_key_key UNIQUE (normalized_name_key),
  CONSTRAINT clients_client_code_check CHECK (client_code ~ '^CL-[A-Z0-9]{8}$'),
  CONSTRAINT clients_name_check CHECK (pg_catalog.btrim(name) <> ''),
  CONSTRAINT clients_normalized_name_key_check CHECK (
    normalized_name_key <> ''
    AND normalized_name_key = pg_catalog.lower(pg_catalog.btrim(normalized_name_key))
  ),
  CONSTRAINT clients_status_check CHECK (status IN ('active', 'prospect', 'inactive', 'archived')),
  CONSTRAINT clients_created_by_check CHECK (pg_catalog.btrim(created_by) <> ''),
  CONSTRAINT clients_updated_by_check CHECK (pg_catalog.btrim(updated_by) <> ''),
  CONSTRAINT clients_timestamps_check CHECK (updated_at >= created_at),
  CONSTRAINT clients_version_check CHECK (version >= 1)
)
  `.trim(),
  `
CREATE TABLE contacts (
  id uuid CONSTRAINT contacts_pkey PRIMARY KEY,
  client_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  role text NOT NULL DEFAULT 'Primary contact',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT contacts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT contacts_name_check CHECK (pg_catalog.btrim(name) <> ''),
  CONSTRAINT contacts_email_check CHECK (email IS NULL OR pg_catalog.btrim(email) <> ''),
  CONSTRAINT contacts_phone_check CHECK (phone IS NULL OR pg_catalog.btrim(phone) <> ''),
  CONSTRAINT contacts_role_check CHECK (pg_catalog.btrim(role) <> ''),
  CONSTRAINT contacts_timestamps_check CHECK (updated_at >= created_at),
  CONSTRAINT contacts_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX contacts_client_id_idx ON contacts (client_id)",
  "CREATE UNIQUE INDEX contacts_one_primary_per_client_idx ON contacts (client_id) WHERE is_primary",
  `
CREATE TABLE projects (
  id uuid CONSTRAINT projects_pkey PRIMARY KEY,
  project_number text NOT NULL,
  client_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'planning',
  site text,
  project_manager text,
  estimated_value numeric,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT projects_project_number_key UNIQUE (project_number),
  CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT projects_project_number_check CHECK (project_number ~ '^CF-[0-9]{4}-[A-Z0-9]{8}$'),
  CONSTRAINT projects_name_check CHECK (pg_catalog.btrim(name) <> ''),
  CONSTRAINT projects_status_check CHECK (
    status IN ('planning', 'mobilizing', 'installation', 'closeout', 'completed', 'cancelled', 'archived')
  ),
  CONSTRAINT projects_estimated_value_check CHECK (
    estimated_value IS NULL
    OR (
      estimated_value >= 0
      AND estimated_value = pg_catalog.trunc(estimated_value)
      AND estimated_value <= 9007199254740991
    )
  ),
  CONSTRAINT projects_created_by_check CHECK (pg_catalog.btrim(created_by) <> ''),
  CONSTRAINT projects_updated_by_check CHECK (pg_catalog.btrim(updated_by) <> ''),
  CONSTRAINT projects_timestamps_check CHECK (updated_at >= created_at),
  CONSTRAINT projects_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX projects_client_id_idx ON projects (client_id)",
  `
CREATE TABLE activity_events (
  id uuid CONSTRAINT activity_events_pkey PRIMARY KEY,
  client_id uuid,
  project_id uuid,
  action text NOT NULL,
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  result text NOT NULL DEFAULT 'succeeded',
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT activity_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT activity_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT activity_events_record_check CHECK (pg_catalog.num_nonnulls(client_id, project_id) = 1),
  CONSTRAINT activity_events_action_check CHECK (pg_catalog.btrim(action) <> ''),
  CONSTRAINT activity_events_actor_id_check CHECK (pg_catalog.btrim(actor_id) <> ''),
  CONSTRAINT activity_events_correlation_id_check CHECK (pg_catalog.btrim(correlation_id) <> ''),
  CONSTRAINT activity_events_result_check CHECK (result IN ('succeeded', 'failed', 'denied')),
  CONSTRAINT activity_events_reason_check CHECK (reason IS NULL OR pg_catalog.btrim(reason) <> ''),
  CONSTRAINT activity_events_detail_check CHECK (pg_catalog.jsonb_typeof(detail) = 'object')
)
  `.trim(),
  "CREATE INDEX activity_events_client_id_idx ON activity_events (client_id) WHERE client_id IS NOT NULL",
  "CREATE INDEX activity_events_project_id_idx ON activity_events (project_id) WHERE project_id IS NOT NULL",
  "CREATE INDEX activity_events_occurred_at_idx ON activity_events (occurred_at DESC, id)",
  `
CREATE FUNCTION prevent_activity_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $activity_event_guard$
BEGIN
  RAISE EXCEPTION 'activity_events are append-only' USING ERRCODE = '55000';
END;
$activity_event_guard$
  `.trim(),
  `
CREATE TRIGGER activity_events_append_only_trigger
BEFORE UPDATE OR DELETE ON activity_events
FOR EACH ROW EXECUTE FUNCTION prevent_activity_event_mutation()
  `.trim(),
] as const;

const DELIVERY_CONTROL_STATEMENTS = [
  `
CREATE TABLE idempotency_requests (
  id uuid CONSTRAINT idempotency_requests_pkey PRIMARY KEY,
  actor_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT idempotency_requests_actor_operation_key_key UNIQUE (actor_id, operation, idempotency_key),
  CONSTRAINT idempotency_requests_actor_id_check CHECK (pg_catalog.btrim(actor_id) <> ''),
  CONSTRAINT idempotency_requests_operation_check CHECK (operation IN ('clients.create', 'projects.create')),
  CONSTRAINT idempotency_requests_key_check CHECK (pg_catalog.btrim(idempotency_key) <> ''),
  CONSTRAINT idempotency_requests_fingerprint_check CHECK (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT idempotency_requests_status_check CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT idempotency_requests_response_status_check CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  CONSTRAINT idempotency_requests_completed_response_check CHECK (
    status <> 'completed' OR (response_status IS NOT NULL AND response_body IS NOT NULL)
  ),
  CONSTRAINT idempotency_requests_timestamps_check CHECK (
    updated_at >= created_at AND expires_at > created_at
  ),
  CONSTRAINT idempotency_requests_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX idempotency_requests_expires_at_idx ON idempotency_requests (expires_at)",
  `
CREATE TABLE outbox_events (
  id uuid CONSTRAINT outbox_events_pkey PRIMARY KEY,
  event_key text NOT NULL,
  event_type text NOT NULL,
  client_id uuid,
  project_id uuid,
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  available_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  attempt_count integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT outbox_events_event_key_key UNIQUE (event_key),
  CONSTRAINT outbox_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT outbox_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT outbox_events_type_check CHECK (event_type IN ('client.created', 'project.created')),
  CONSTRAINT outbox_events_record_check CHECK (pg_catalog.num_nonnulls(client_id, project_id) = 1),
  CONSTRAINT outbox_events_type_record_check CHECK (
    (event_type = 'client.created' AND client_id IS NOT NULL AND project_id IS NULL)
    OR (event_type = 'project.created' AND project_id IS NOT NULL AND client_id IS NULL)
  ),
  CONSTRAINT outbox_events_actor_id_check CHECK (pg_catalog.btrim(actor_id) <> ''),
  CONSTRAINT outbox_events_correlation_id_check CHECK (pg_catalog.btrim(correlation_id) <> ''),
  CONSTRAINT outbox_events_payload_check CHECK (pg_catalog.jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox_events_status_check CHECK (status IN ('pending', 'processing', 'completed', 'dead')),
  CONSTRAINT outbox_events_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT outbox_events_processing_lease_check CHECK (
    status <> 'processing' OR lease_expires_at IS NOT NULL
  ),
  CONSTRAINT outbox_events_completed_at_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT outbox_events_dead_lettered_at_check CHECK (
    (status = 'dead' AND dead_lettered_at IS NOT NULL)
    OR (status <> 'dead' AND dead_lettered_at IS NULL)
  ),
  CONSTRAINT outbox_events_timestamps_check CHECK (
    updated_at >= created_at AND available_at >= created_at
  ),
  CONSTRAINT outbox_events_version_check CHECK (version >= 1)
)
  `.trim(),
  "CREATE INDEX outbox_events_client_id_idx ON outbox_events (client_id) WHERE client_id IS NOT NULL",
  "CREATE INDEX outbox_events_project_id_idx ON outbox_events (project_id) WHERE project_id IS NOT NULL",
  "CREATE INDEX outbox_events_pending_available_idx ON outbox_events (available_at, created_at, id) WHERE status = 'pending'",
  "CREATE INDEX outbox_events_expired_lease_idx ON outbox_events (lease_expires_at, id) WHERE status = 'processing'",
] as const;

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function topLevelSqlCode(value: string) {
  let code = "";
  let index = 0;

  while (index < value.length) {
    const character = value[index];
    const next = value[index + 1];

    if (character === "-" && next === "-") {
      while (index < value.length && value[index] !== "\n") {
        code += " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && next === "*") {
      let depth = 1;
      code += "  ";
      index += 2;
      while (index < value.length && depth > 0) {
        if (value[index] === "/" && value[index + 1] === "*") {
          depth += 1;
          code += "  ";
          index += 2;
        } else if (value[index] === "*" && value[index + 1] === "/") {
          depth -= 1;
          code += "  ";
          index += 2;
        } else {
          code += value[index] === "\n" ? "\n" : " ";
          index += 1;
        }
      }
      continue;
    }

    if (character === "'" || character === '"') {
      const quote = character;
      const usesBackslashEscapes =
        quote === "'" &&
        (value[index - 1] === "E" || value[index - 1] === "e") &&
        (index < 2 || !/[A-Za-z0-9_$]/.test(value[index - 2]));
      code += " ";
      index += 1;
      while (index < value.length) {
        if (usesBackslashEscapes && value[index] === "\\") {
          code += "  ";
          index += 2;
        } else if (value[index] === quote && value[index + 1] === quote) {
          code += "  ";
          index += 2;
        } else if (value[index] === quote) {
          code += " ";
          index += 1;
          break;
        } else {
          code += value[index] === "\n" ? "\n" : " ";
          index += 1;
        }
      }
      continue;
    }

    if (character === "$") {
      const delimiter = value.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        const closeAt = value.indexOf(delimiter, index + delimiter.length);
        const end = closeAt === -1 ? value.length : closeAt + delimiter.length;
        code += value.slice(index, end).replace(/[^\n]/g, " ");
        index = end;
        continue;
      }
    }

    code += character;
    index += 1;
  }

  return code;
}

function validateMigrationStatementBoundary(statement: string, version: number) {
  const topLevelCode = topLevelSqlCode(statement);
  const statements = topLevelCode.split(";").filter((part) => part.trim());
  if (statements.length !== 1) {
    throw new Error(
      `Production schema migration ${version} must keep exactly one top-level SQL statement per registry entry`,
    );
  }

  if (
    /^\s*(?:BEGIN\b|START\s+TRANSACTION\b|COMMIT\b|END\b|ROLLBACK\b|ABORT\b|SAVEPOINT\b|RELEASE\s+(?:SAVEPOINT\s+)?\b|PREPARE\s+TRANSACTION\b|SET\s+TRANSACTION\b)/i.test(
      statements[0],
    )
  ) {
    throw new Error(`Production schema migration ${version} cannot manage its own transaction`);
  }
}

export function calculateProductionMigrationChecksum(
  migration: Pick<ProductionSchemaMigration, "version" | "name" | "statements">,
) {
  const canonical = [
    `version:${migration.version}`,
    `name:${migration.name}`,
    ...migration.statements.map((statement, index) =>
      `statement:${index + 1}\n${normalizeLineEndings(statement)}`,
    ),
  ].join("\n-- production-schema-migration --\n");

  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export const PRODUCTION_SCHEMA_MIGRATIONS: readonly ProductionSchemaMigration[] = [
  {
    version: 1,
    name: "core_records",
    checksum: "sha256:b3aab0addffeb3e8b4efc58373f359f56489778be9d0ec16dc098ab183beb9f6",
    statements: CORE_RECORD_STATEMENTS,
  },
  {
    version: 2,
    name: "delivery_controls",
    checksum: "sha256:18e19555f53bc5f7f793e0fc5a2960ead8124cc67debff1db24785732bea5aea",
    statements: DELIVERY_CONTROL_STATEMENTS,
  },
  {
    version: 3,
    name: "production_persistence_boundary",
    checksum: "sha256:12d02573feec218e2ed411ec55ab5d9a08e5b5f20fdbbb58103305a7ef3dcb7f",
    statements: PRODUCTION_PERSISTENCE_STATEMENTS,
  },
  {
    version: 4,
    name: "admin_access_persistence",
    checksum: "sha256:a779369e499410a161fa31a02e0ea56972648b81e7836b75c37f7fdacaad6cd3",
    statements: ADMIN_ACCESS_PERSISTENCE_STATEMENTS,
  },
  {
    version: 5,
    name: "admin_audit_activity",
    checksum: "sha256:aa5e56dc3d1c22d3a6bc5be32f48cfde9ea133cdd853ce6fa024073ebeee05d9",
    statements: ADMIN_AUDIT_ACTIVITY_STATEMENTS,
  },
  {
    version: 6,
    name: "lead_project_meetings",
    checksum: "sha256:ff32915b98da08104a94eb4946aca84d0e1c1b144cc8b90d5bc2c7b435e34f99",
    statements: LEAD_PROJECT_MEETING_STATEMENTS,
  },
  {
    version: 7,
    name: "settings_persistence",
    checksum: "sha256:cb468b7237bc478ebe7f35f93ccc97611c94b66fc870e61258b6762297e7d63a",
    statements: SETTINGS_PERSISTENCE_STATEMENTS,
  },
  {
    version: 8,
    name: "tasks",
    checksum: "sha256:e7df1a997fabf3aab599dbeefc7629e8d987a9152b0620a1372ebc0a57074951",
    statements: TASK_SCHEMA_STATEMENTS,
  },
];

export interface AppliedProductionMigrationRow extends Record<string, unknown> {
  version: number | string;
  name: string;
  checksum: string;
}

function migrationVersion(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Production schema history contains an invalid version: ${String(value)}`);
  }
  return parsed;
}

export function validateProductionMigrationRegistry(
  migrations: readonly ProductionSchemaMigration[],
) {
  let previousVersion = 0;
  const names = new Set<string>();

  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version !== previousVersion + 1) {
      throw new Error("Production schema migration versions must be positive, contiguous, and ordered");
    }
    if (!/^[a-z][a-z0-9_]*$/.test(migration.name)) {
      throw new Error(`Production schema migration ${migration.version} needs a lowercase snake_case name`);
    }
    if (names.has(migration.name)) {
      throw new Error(`Production schema migration name ${migration.name} is duplicated`);
    }
    if (migration.statements.length === 0 || migration.statements.some((statement) => !statement.trim())) {
      throw new Error(`Production schema migration ${migration.version} must contain SQL statements`);
    }
    for (const statement of migration.statements) {
      validateMigrationStatementBoundary(statement, migration.version);
    }
    if (
      migration.statements.some((statement) =>
        /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(statement),
      )
    ) {
      throw new Error(`Production schema migration ${migration.version} cannot create concurrent indexes inside its transaction`);
    }

    const calculated = calculateProductionMigrationChecksum(migration);
    if (migration.checksum !== calculated) {
      throw new Error(
        `Production schema migration ${migration.version} checksum declaration does not match its immutable contents`,
      );
    }
    names.add(migration.name);
    previousVersion = migration.version;
  }
}

export function assertProductionMigrationHistoryIsKnownPrefix(
  appliedRows: readonly AppliedProductionMigrationRow[],
  migrations: readonly ProductionSchemaMigration[],
) {
  if (appliedRows.length > migrations.length) {
    throw new Error("Production database schema is newer than this migration registry");
  }

  for (const [index, row] of appliedRows.entries()) {
    const expected = migrations[index];
    const version = migrationVersion(row.version);
    if (!expected || version !== expected.version) {
      throw new Error(
        `Production schema history must be a known contiguous prefix; found version ${version} at position ${index + 1}`,
      );
    }
    if (row.name !== expected.name || row.checksum !== expected.checksum) {
      throw new Error(
        `Production schema migration ${version} history mismatch; applied name/checksum is immutable`,
      );
    }
  }
}

async function rollbackForDiscardSafety(client: PostgresMigrationClient) {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    // Preserve the primary migration failure, but retain rollback ambiguity so
    // the connection is explicitly discarded rather than returned to a pool
    // with a transaction that may still be open.
    return cleanupFailure(error);
  }
}

export type ProductionMigrationRunResult = {
  appliedVersions: number[];
  currentVersion: number;
};

export type ProductionMigrationOptions = {
  schema?: string;
  /** Maximum time to wait for the cross-process advisory lock. */
  lockTimeoutMs?: number;
  /** Per-migration PostgreSQL lock timeout inside the DDL transaction. */
  transactionLockTimeoutMs?: number;
  /** Per-migration PostgreSQL statement timeout inside the DDL transaction. */
  statementTimeoutMs?: number;
  /**
   * Optional NOLOGIN owner role used by the dedicated migration principal.
   * PostgreSQL object ownership follows CURRENT_USER, so inherited membership
   * alone is not sufficient for deterministic migration ownership.
   */
  role?: string;
};

function productionSchemaName(value: string | undefined) {
  const schema = value ?? "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error("Production migration schema must be a lowercase PostgreSQL identifier");
  }
  return schema;
}

function productionLockTimeout(value: number | undefined) {
  const timeout = value ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 300_000) {
    throw new Error("Production migration lock timeout must be an integer from 0 to 300000 ms");
  }
  return timeout;
}

function productionTransactionTimeout(
  value: number | undefined,
  fallback: number,
  minimum: number,
  label: string,
) {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout < minimum || timeout > 300_000) {
    throw new Error(`${label} must be an integer from ${minimum} to 300000 ms`);
  }
  return timeout;
}

function productionMigrationRole(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error("Production migration role must be a lowercase PostgreSQL identifier");
  }
  return value;
}

async function tryAcquireProductionMigrationLock(
  client: PostgresMigrationClient,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1::bigint) AS acquired",
      [PRODUCTION_MIGRATION_LOCK_ID],
    );
    if (result.rows[0]?.acquired === true) return true;

    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
  }
}

function cleanupFailure(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runProductionSchemaMigrations(
  pool: PostgresMigrationPool,
  migrations: readonly ProductionSchemaMigration[] = PRODUCTION_SCHEMA_MIGRATIONS,
  options: ProductionMigrationOptions = {},
): Promise<ProductionMigrationRunResult> {
  validateProductionMigrationRegistry(migrations);
  const schema = productionSchemaName(options.schema);
  const lockTimeoutMs = productionLockTimeout(options.lockTimeoutMs);
  const transactionLockTimeoutMs = productionTransactionTimeout(
    options.transactionLockTimeoutMs,
    5_000,
    100,
    "Production migration transaction lock timeout",
  );
  const statementTimeoutMs = productionTransactionTimeout(
    options.statementTimeoutMs,
    30_000,
    1_000,
    "Production migration statement timeout",
  );
  const role = productionMigrationRole(options.role);

  const client = await pool.connect();
  let lockHeld = false;
  let originalSearchPath: string | undefined;
  let searchPathChanged = false;
  let roleMayHaveChanged = false;
  let lockAcquisitionFailed = false;
  let rollbackFailure: Error | undefined;
  let primaryError: unknown;

  try {
    if (role !== undefined) {
      // Identifiers cannot be query parameters. The strict lowercase validator
      // above makes the quoted role name safe and keeps credentials out of SQL.
      roleMayHaveChanged = true;
      await client.query(`SET ROLE "${role}"`);
      const activeRole = await client.query<{ current_user: unknown }>(
        "SELECT CURRENT_USER AS current_user",
      );
      if (activeRole.rowCount !== 1 || activeRole.rows[0]?.current_user !== role) {
        throw new Error(`Production migration role ${role} was not activated`);
      }
    }

    try {
      const acquired = await tryAcquireProductionMigrationLock(client, lockTimeoutMs);
      if (!acquired) {
        throw new Error(
          `Production migration lock was not acquired within ${lockTimeoutMs} ms`,
        );
      }
      lockHeld = true;
    } catch (error) {
      // A failed query could have acquired the session lock before its response
      // was lost. Mark the client for discard so closing the session releases
      // any ambiguous lock state.
      lockAcquisitionFailed = true;
      throw error;
    }

    const schemaLookup = await client.query<{
      schema_oid: string;
      schema_owner: string;
    }>(
      `SELECT namespace.oid::text AS schema_oid,
              owner_role.rolname AS schema_owner
       FROM pg_catalog.pg_namespace AS namespace
       JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
       WHERE namespace.nspname = $1`,
      [schema],
    );
    const schemaRow = schemaLookup.rows[0];
    if (schemaLookup.rowCount !== 1 || !schemaRow?.schema_oid) {
      throw new Error(`Production migration schema ${schema} does not exist`);
    }
    if (role !== undefined && schemaRow.schema_owner !== role) {
      throw new Error(
        `Production migration schema ${schema} must be owned by the activated role ${role}`,
      );
    }
    const searchPathLookup = await client.query<{ search_path: string }>(
      "SELECT pg_catalog.current_setting('search_path') AS search_path",
    );
    originalSearchPath = searchPathLookup.rows[0]?.search_path;
    if (typeof originalSearchPath !== "string") {
      throw new Error("Production migration connection did not report its search_path");
    }
    await client.query("SELECT pg_catalog.set_config('search_path', $1, false)", [
      `${schema}, pg_catalog, pg_temp`,
    ]);
    searchPathChanged = true;

    // This is the only IF NOT EXISTS statement in the production foundation.
    // The advisory lock serializes even this first-time history bootstrap.
    await client.query(PRODUCTION_SCHEMA_HISTORY_SQL);

    // Re-read only after the cross-process lock is held. Another runner may
    // have completed a version while this connection waited for the lock.
    const history = await client.query<AppliedProductionMigrationRow>(
      "SELECT version, name, checksum FROM production_schema_migrations ORDER BY version",
    );
    assertProductionMigrationHistoryIsKnownPrefix(history.rows, migrations);

    const appliedVersions: number[] = [];
    for (const migration of migrations.slice(history.rows.length)) {
      try {
        // Keep BEGIN inside the guarded region. If PostgreSQL accepts BEGIN
        // but the client loses the response, the catch path still attempts a
        // rollback before the connection can return to its pool.
        await client.query("BEGIN");
        await client.query(`SET LOCAL lock_timeout = '${transactionLockTimeoutMs}ms'`);
        await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
        for (const statement of migration.statements) await client.query(statement);
        await client.query(
          `INSERT INTO production_schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        appliedVersions.push(migration.version);
      } catch (error) {
        rollbackFailure ??= await rollbackForDiscardSafety(client);
        throw new Error(
          `Production schema migration ${migration.version} (${migration.name}) did not complete cleanly; retry only through the locked runner so committed history can be rechecked`,
          { cause: error },
        );
      }
    }

    return {
      appliedVersions,
      currentVersion: migrations.at(-1)?.version ?? 0,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError: unknown;
    try {
      if (searchPathChanged && originalSearchPath !== undefined) {
        try {
          await client.query("SELECT pg_catalog.set_config('search_path', $1, false)", [
            originalSearchPath,
          ]);
        } catch (error) {
          cleanupError = error;
        }
      }
      if (lockHeld) {
        try {
          await client.query("SELECT pg_catalog.pg_advisory_unlock($1::bigint)", [
            PRODUCTION_MIGRATION_LOCK_ID,
          ]);
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (roleMayHaveChanged) {
        try {
          await client.query("RESET ROLE");
        } catch (error) {
          cleanupError ??= error;
        }
      }
    } finally {
      const discardError = cleanupError
        ?? rollbackFailure
        ?? (lockAcquisitionFailed ? primaryError : undefined);
      client.release(discardError ? cleanupFailure(discardError) : undefined);
    }
    if (!primaryError && cleanupError) throw cleanupError;
  }
}
