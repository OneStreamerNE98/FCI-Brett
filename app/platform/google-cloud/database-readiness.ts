export type DatabaseReadinessQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> = {
  rows: Row[];
  rowCount: number | null;
};

export interface DatabaseReadinessQuery {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<DatabaseReadinessQueryResult<Row>>;
}

export interface DatabaseReadinessClient extends DatabaseReadinessQuery {
  release(error?: Error): void;
}

export interface DatabaseReadinessPool {
  connect(): Promise<DatabaseReadinessClient>;
}

export interface DatabaseReadinessProbe {
  check(): Promise<boolean>;
  invalidate(): void;
}

export type ExpectedProductionMigration = Readonly<{
  version: number;
  name: string;
  checksum: string;
}>;

/**
 * Read-only runtime copy of the immutable production migration metadata.
 * A contract test keeps this in lockstep with the migration registry without
 * importing migration SQL into the request-serving bundle.
 */
export const EXPECTED_PRODUCTION_SCHEMA_HISTORY: readonly ExpectedProductionMigration[] =
  Object.freeze([
    Object.freeze({
      version: 1,
      name: "core_records",
      checksum: "sha256:b3aab0addffeb3e8b4efc58373f359f56489778be9d0ec16dc098ab183beb9f6",
    }),
    Object.freeze({
      version: 2,
      name: "delivery_controls",
      checksum: "sha256:18e19555f53bc5f7f793e0fc5a2960ead8124cc67debff1db24785732bea5aea",
    }),
    Object.freeze({
      version: 3,
      name: "production_persistence_boundary",
      checksum: "sha256:12d02573feec218e2ed411ec55ab5d9a08e5b5f20fdbbb58103305a7ef3dcb7f",
    }),
    Object.freeze({
      version: 4,
      name: "admin_access_persistence",
      checksum: "sha256:a779369e499410a161fa31a02e0ea56972648b81e7836b75c37f7fdacaad6cd3",
    }),
  ]);

export const DATABASE_TABLE_PRIVILEGES = Object.freeze([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const);

export type DatabaseTablePrivilege = (typeof DATABASE_TABLE_PRIVILEGES)[number];

export type ExpectedRuntimeTableAccess = Readonly<{
  table: string;
  privileges: readonly DatabaseTablePrivilege[];
}>;

function runtimeTableAccess(
  table: string,
  privileges: readonly DatabaseTablePrivilege[],
): ExpectedRuntimeTableAccess {
  return Object.freeze({ table, privileges: Object.freeze([...privileges]) });
}

/**
 * Exact production runtime table capabilities. An empty privilege list is an
 * intentional denial that readiness verifies, not an omitted decision.
 */
export const EXPECTED_RUNTIME_TABLE_ACCESS: readonly ExpectedRuntimeTableAccess[] =
  Object.freeze([
    runtimeTableAccess("clients", ["SELECT", "INSERT", "UPDATE"]),
    runtimeTableAccess("contacts", ["SELECT", "INSERT"]),
    runtimeTableAccess("projects", ["SELECT", "INSERT", "UPDATE"]),
    runtimeTableAccess("activity_events", ["INSERT"]),
    runtimeTableAccess("idempotency_requests", ["SELECT", "INSERT", "UPDATE"]),
    runtimeTableAccess("outbox_events", ["SELECT", "INSERT", "UPDATE"]),
    runtimeTableAccess("production_schema_migrations", []),
    runtimeTableAccess("users", ["SELECT", "INSERT"]),
    runtimeTableAccess("external_identities", ["INSERT"]),
    runtimeTableAccess("invitations", ["SELECT", "INSERT"]),
    runtimeTableAccess("invitation_project_assignments", ["SELECT", "INSERT"]),
    runtimeTableAccess("sessions", ["SELECT", "INSERT"]),
    runtimeTableAccess("roles", ["SELECT"]),
    runtimeTableAccess("capabilities", ["SELECT"]),
    runtimeTableAccess("role_capabilities", ["SELECT"]),
    runtimeTableAccess("user_roles", ["SELECT", "INSERT"]),
    runtimeTableAccess("project_memberships", ["SELECT", "INSERT"]),
    runtimeTableAccess("audit_events", ["INSERT"]),
    runtimeTableAccess("integration_connections", ["INSERT"]),
    runtimeTableAccess("integration_credentials", []),
    runtimeTableAccess("integration_connection_scopes", []),
    runtimeTableAccess("integration_oauth_attempts", ["SELECT", "INSERT", "UPDATE"]),
    runtimeTableAccess("integration_resources", ["INSERT"]),
    runtimeTableAccess("integration_cursors", []),
    runtimeTableAccess("integration_events", []),
    runtimeTableAccess("files", ["SELECT", "INSERT"]),
    runtimeTableAccess("file_versions", ["SELECT", "INSERT", "UPDATE"]),
    runtimeTableAccess("storage_objects", ["SELECT", "INSERT", "UPDATE"]),
    runtimeTableAccess("file_links", ["INSERT"]),
  ]);

export type ExpectedRuntimeColumnUpdateAccess = Readonly<{
  table: string;
  columns: readonly string[];
}>;

function runtimeColumnUpdateAccess(
  table: string,
  columns: readonly string[],
): ExpectedRuntimeColumnUpdateAccess {
  return Object.freeze({ table, columns: Object.freeze([...columns]) });
}

/**
 * Exact column-only UPDATE grants for identity and administration state. The
 * corresponding tables deliberately have no table-wide UPDATE privilege.
 */
export const EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS: readonly ExpectedRuntimeColumnUpdateAccess[] =
  Object.freeze([
    runtimeColumnUpdateAccess("users", [
      "status",
      "disabled_at",
      "authorization_version",
      "sessions_valid_after",
      "updated_at",
      "version",
    ]),
    runtimeColumnUpdateAccess("invitations", [
      "token_hash",
      "status",
      "revoked_by_user_id",
      "revoked_at",
      "expired_at",
      "updated_at",
      "version",
    ]),
    runtimeColumnUpdateAccess("sessions", [
      "token_hash",
      "csrf_hash",
      "revoked_at",
      "revoked_by_actor_key",
      "revocation_reason_code",
      "version",
    ]),
    runtimeColumnUpdateAccess("user_roles", [
      "role_id",
      "assigned_by_user_id",
      "assigned_by_actor_key",
      "assigned_at",
      "version",
    ]),
    runtimeColumnUpdateAccess("project_memberships", [
      "assigned_by_user_id",
      "assigned_by_actor_key",
      "assigned_at",
      "status",
      "revoked_by_user_id",
      "revoked_by_actor_key",
      "revoked_at",
      "revocation_reason_code",
      "version",
    ]),
  ]);

type RuntimeColumnUpdatePrivilegeExpectation = Readonly<{
  tableName: string;
  columnName: string;
}>;

const RUNTIME_COLUMN_UPDATE_PRIVILEGE_EXPECTATIONS:
  readonly RuntimeColumnUpdatePrivilegeExpectation[] = Object.freeze(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.flatMap(({ table, columns }) =>
      columns.map((column) => Object.freeze({
        tableName: table,
        columnName: column,
      })),
    ),
  );

const RUNTIME_COLUMN_UPDATE_TABLES = new Set(
  EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.map(({ table }) => table),
);

type RuntimeTablePrivilegeExpectation = Readonly<{
  tableName: string;
  privilege: DatabaseTablePrivilege;
  shouldHave: boolean;
}>;

const RUNTIME_TABLE_PRIVILEGE_EXPECTATIONS: readonly RuntimeTablePrivilegeExpectation[] =
  Object.freeze(
    EXPECTED_RUNTIME_TABLE_ACCESS.flatMap(({ table, privileges }) => {
      const allowed = new Set(privileges);
      return DATABASE_TABLE_PRIVILEGES.map((privilege) => Object.freeze({
        tableName: table,
        privilege,
        shouldHave: allowed.has(privilege),
      }));
    }),
  );

type PermissionRow = Record<string, unknown> & {
  has_usage: unknown;
  has_usage_grant_option: unknown;
  has_create: unknown;
  can_set_migration_owner: unknown;
  can_set_rehearsal_importer: unknown;
  has_sequence_access: unknown;
  history_reader_exists: unknown;
  history_reader_security_definer: unknown;
  history_reader_owner: unknown;
  history_reader_fixed_search_path: unknown;
  has_history_reader_execute: unknown;
  has_history_reader_grant_option: unknown;
  has_unreviewed_function_execute: unknown;
};

type RuntimeColumnUpdatePrivilegeRow = Record<string, unknown> & {
  tableName: unknown;
  columnName: unknown;
  shouldHave: unknown;
  relationExists: unknown;
  columnExists: unknown;
  hasPrivilege: unknown;
  hasGrantOption: unknown;
};

type RuntimeTablePrivilegeRow = Record<string, unknown> & {
  tableName: unknown;
  privilege: unknown;
  shouldHave: unknown;
  relationExists: unknown;
  hasPrivilege: unknown;
  hasColumnPrivilege: unknown;
  hasGrantOption: unknown;
  hasColumnGrantOption: unknown;
};

export type ProductionMigrationHistoryRow = Record<string, unknown> & {
  version: unknown;
  name: unknown;
  checksum: unknown;
};

export type DatabaseReadinessOptions = {
  database: DatabaseReadinessPool;
  schema: string;
  cacheTtlMs?: number;
  statementTimeoutMs?: number;
  now?: () => number;
  expectedHistory?: readonly ExpectedProductionMigration[];
};

const DEFAULT_CACHE_TTL_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 1_500;
const MAX_CACHE_TTL_MS = 60_000;
const MAX_STATEMENT_TIMEOUT_MS = 10_000;
const POSTGRES_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function validatedSchema(value: string) {
  if (!POSTGRES_IDENTIFIER.test(value)) {
    throw new TypeError("Database readiness schema must be a lowercase PostgreSQL identifier");
  }
  return value;
}

function validatedCacheTtl(value: number | undefined) {
  const ttl = value ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > MAX_CACHE_TTL_MS) {
    throw new TypeError(`Database readiness cache TTL must be an integer from 0 to ${MAX_CACHE_TTL_MS} ms`);
  }
  return ttl;
}

function validatedStatementTimeout(value: number | undefined) {
  const timeout = value ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > MAX_STATEMENT_TIMEOUT_MS) {
    throw new TypeError(
      `Database readiness statement timeout must be an integer from 100 to ${MAX_STATEMENT_TIMEOUT_MS} ms`,
    );
  }
  return timeout;
}

function migrationVersion(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

export function productionSchemaHistoryMatches(
  rows: readonly ProductionMigrationHistoryRow[],
  expected: readonly ExpectedProductionMigration[] = EXPECTED_PRODUCTION_SCHEMA_HISTORY,
) {
  if (rows.length !== expected.length) return false;
  return rows.every((row, index) => {
    const target = expected[index];
    return Boolean(
      target &&
      migrationVersion(row.version) === target.version &&
      row.name === target.name &&
      row.checksum === target.checksum,
    );
  });
}

function runtimeTablePrivilegeMatrixMatches(rows: readonly RuntimeTablePrivilegeRow[]) {
  if (rows.length !== RUNTIME_TABLE_PRIVILEGE_EXPECTATIONS.length) return false;

  return rows.every((row, index) => {
    const expected = RUNTIME_TABLE_PRIVILEGE_EXPECTATIONS[index];
    const supportsColumnGrant = expected && ["SELECT", "INSERT", "UPDATE", "REFERENCES"]
      .includes(expected.privilege);
    const hasReviewedColumnOnlyGrant = expected?.privilege === "UPDATE" &&
      RUNTIME_COLUMN_UPDATE_TABLES.has(expected.tableName);
    return Boolean(
      expected &&
      row.tableName === expected.tableName &&
      row.privilege === expected.privilege &&
      row.shouldHave === expected.shouldHave &&
      row.relationExists === true &&
      row.hasPrivilege === expected.shouldHave &&
      row.hasColumnPrivilege === (
        supportsColumnGrant ? expected.shouldHave || hasReviewedColumnOnlyGrant : false
      ) &&
      row.hasGrantOption === false &&
      row.hasColumnGrantOption === false
    );
  });
}

function runtimeColumnUpdatePrivilegeMatrixMatches(
  rows: readonly RuntimeColumnUpdatePrivilegeRow[],
) {
  if (rows.length < RUNTIME_COLUMN_UPDATE_PRIVILEGE_EXPECTATIONS.length) return false;

  for (const [index, expected] of RUNTIME_COLUMN_UPDATE_PRIVILEGE_EXPECTATIONS.entries()) {
    const row = rows[index];
    if (!(
      row &&
      row.tableName === expected.tableName &&
      row.columnName === expected.columnName &&
      row.shouldHave === true &&
      row.relationExists === true &&
      row.columnExists === true &&
      row.hasPrivilege === true &&
      row.hasGrantOption === false
    )) return false;
  }

  return rows.slice(RUNTIME_COLUMN_UPDATE_PRIVILEGE_EXPECTATIONS.length).every((row) =>
    row.shouldHave === false &&
    row.relationExists === true &&
    row.columnExists === true &&
    row.hasPrivilege === false &&
    row.hasGrantOption === false);
}

async function readDatabaseReadiness(
  database: DatabaseReadinessPool,
  schema: string,
  expectedHistory: readonly ExpectedProductionMigration[],
  statementTimeoutMs: number,
) {
  const client = await database.connect();
  let transactionStarted = false;
  let ambiguousTransactionState = false;
  let releaseError: Error | undefined;
  try {
    ambiguousTransactionState = true;
    await client.query("BEGIN READ ONLY");
    ambiguousTransactionState = false;
    transactionStarted = true;
    await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);

    // All data statements are deliberately read-only. Runtime readiness must
    // never bootstrap schema, change roles, or apply migrations.
    const permissions = await client.query<PermissionRow>(
      `WITH history_reader AS (
         SELECT procedure.oid, procedure.prosecdef, procedure.proowner, procedure.proconfig
         FROM pg_catalog.pg_proc AS procedure
         WHERE procedure.oid = pg_catalog.to_regprocedure(
           pg_catalog.format('%I.%I()', $1, 'read_production_schema_history')
         )
       )
       SELECT
         pg_catalog.has_schema_privilege(CURRENT_USER, $1, 'USAGE') AS has_usage,
         pg_catalog.has_schema_privilege(
           CURRENT_USER,
           $1,
           'USAGE WITH GRANT OPTION'
         ) AS has_usage_grant_option,
         pg_catalog.has_schema_privilege(CURRENT_USER, $1, 'CREATE') AS has_create,
         pg_catalog.coalesce(
           (
             SELECT pg_catalog.pg_has_role(SESSION_USER, role.oid, 'SET')
             FROM pg_catalog.pg_roles AS role
             WHERE role.rolname = 'fci_migration_owner'
           ),
           false
         ) AS can_set_migration_owner,
         pg_catalog.coalesce(
           (
             SELECT pg_catalog.pg_has_role(SESSION_USER, role.oid, 'SET')
             FROM pg_catalog.pg_roles AS role
             WHERE role.rolname = 'fci_rehearsal_importer'
           ),
           false
         ) AS can_set_rehearsal_importer,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_class AS sequence
           INNER JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = sequence.relnamespace
           WHERE namespace.nspname = $1
             AND sequence.relkind = 'S'
             AND (
               pg_catalog.has_sequence_privilege(CURRENT_USER, sequence.oid, 'USAGE')
               OR pg_catalog.has_sequence_privilege(CURRENT_USER, sequence.oid, 'SELECT')
               OR pg_catalog.has_sequence_privilege(CURRENT_USER, sequence.oid, 'UPDATE')
             )
         ) AS has_sequence_access,
         history_reader.oid IS NOT NULL AS history_reader_exists,
         pg_catalog.coalesce(history_reader.prosecdef, false)
           AS history_reader_security_definer,
         pg_catalog.coalesce(
           history_reader.proowner = (
             SELECT role.oid
             FROM pg_catalog.pg_roles AS role
             WHERE role.rolname = 'fci_migration_owner'
           ),
           false
         ) AS history_reader_owner,
         pg_catalog.coalesce(
           history_reader.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[],
           false
         ) AS history_reader_fixed_search_path,
         pg_catalog.coalesce(
           pg_catalog.has_function_privilege(
             CURRENT_USER,
             history_reader.oid,
             'EXECUTE'
           ),
           false
         ) AS has_history_reader_execute,
         pg_catalog.coalesce(
           pg_catalog.has_function_privilege(
             CURRENT_USER,
             history_reader.oid,
             'EXECUTE WITH GRANT OPTION'
           ),
           false
         ) AS has_history_reader_grant_option,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc AS unreviewed_procedure
           INNER JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = unreviewed_procedure.pronamespace
           WHERE namespace.nspname = $1
             AND unreviewed_procedure.oid <> history_reader.oid
             AND pg_catalog.has_function_privilege(
               CURRENT_USER,
               unreviewed_procedure.oid,
               'EXECUTE'
             )
         ) AS has_unreviewed_function_execute
       FROM (SELECT 1) AS one
       LEFT JOIN history_reader ON true`,
      [schema],
    );
    const permission = permissions.rows[0];
    let ready = !(
      permissions.rowCount !== 1 ||
      permission?.has_usage !== true ||
      permission.has_usage_grant_option !== false ||
      permission.has_create !== false ||
      permission.can_set_migration_owner !== false ||
      permission.can_set_rehearsal_importer !== false ||
      permission.has_sequence_access !== false ||
      permission.history_reader_exists !== true ||
      permission.history_reader_security_definer !== true ||
      permission.history_reader_owner !== true ||
      permission.history_reader_fixed_search_path !== true ||
      permission.has_history_reader_execute !== true ||
      permission.has_history_reader_grant_option !== false ||
      permission.has_unreviewed_function_execute !== false
    );

    if (ready) {
      const columnTableNames = RUNTIME_COLUMN_UPDATE_PRIVILEGE_EXPECTATIONS
        .map(({ tableName }) => tableName);
      const columnNames = RUNTIME_COLUMN_UPDATE_PRIVILEGE_EXPECTATIONS
        .map(({ columnName }) => columnName);
      const columnMatrixTables = EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS
        .map(({ table }) => table);
      const runtimeColumnUpdates = await client.query<RuntimeColumnUpdatePrivilegeRow>(
        `WITH expected_update_columns(table_name, column_name, ordinal) AS (
           SELECT *
           FROM pg_catalog.unnest($2::text[], $3::text[])
             WITH ORDINALITY
         ),
         schema_relations AS (
           SELECT relation.oid, relation.relname
           FROM pg_catalog.pg_class AS relation
           INNER JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = $1
             AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
             AND relation.relname = ANY($4::text[])
         ),
         schema_columns AS (
           SELECT relation.oid, relation.relname, attribute.attname
           FROM schema_relations AS relation
           INNER JOIN pg_catalog.pg_attribute AS attribute
             ON attribute.attrelid = relation.oid
           WHERE attribute.attnum > 0
             AND NOT attribute.attisdropped
         ),
         checked AS (
           SELECT
             expected.table_name AS "tableName",
             expected.column_name AS "columnName",
             true AS "shouldHave",
             relation.oid IS NOT NULL AS "relationExists",
             schema_column.attname IS NOT NULL AS "columnExists",
             pg_catalog.coalesce(
               pg_catalog.has_column_privilege(
                 CURRENT_USER,
                 relation.oid,
                 schema_column.attname,
                 'UPDATE'
               ),
               false
             ) AS "hasPrivilege",
             pg_catalog.coalesce(
               pg_catalog.has_column_privilege(
                 CURRENT_USER,
                 relation.oid,
                 schema_column.attname,
                 'UPDATE WITH GRANT OPTION'
               ),
               false
             ) AS "hasGrantOption",
             expected.ordinal AS sort_order
           FROM expected_update_columns AS expected
           LEFT JOIN schema_relations AS relation
             ON relation.relname = expected.table_name
           LEFT JOIN schema_columns AS schema_column
             ON schema_column.oid = relation.oid
            AND schema_column.attname = expected.column_name
         ),
         unexpected AS (
           SELECT
             schema_column.relname AS "tableName",
             schema_column.attname AS "columnName",
             false AS "shouldHave",
             true AS "relationExists",
             true AS "columnExists",
             pg_catalog.has_column_privilege(
               CURRENT_USER,
               schema_column.oid,
               schema_column.attname,
               'UPDATE'
             ) AS "hasPrivilege",
             pg_catalog.has_column_privilege(
               CURRENT_USER,
               schema_column.oid,
               schema_column.attname,
               'UPDATE WITH GRANT OPTION'
             ) AS "hasGrantOption",
             9223372036854775807::bigint AS sort_order
           FROM schema_columns AS schema_column
           LEFT JOIN expected_update_columns AS expected
             ON expected.table_name = schema_column.relname
            AND expected.column_name = schema_column.attname
           WHERE expected.column_name IS NULL
         )
         SELECT "tableName", "columnName", "shouldHave", "relationExists",
                "columnExists", "hasPrivilege", "hasGrantOption"
         FROM (
           SELECT * FROM checked
           UNION ALL
           SELECT * FROM unexpected
         ) AS complete_column_update_matrix
         ORDER BY sort_order, "tableName", "columnName"`,
        [schema, columnTableNames, columnNames, columnMatrixTables],
      );
      ready = runtimeColumnUpdatePrivilegeMatrixMatches(runtimeColumnUpdates.rows);
    }

    if (ready) {
      const tableNames = RUNTIME_TABLE_PRIVILEGE_EXPECTATIONS.map(({ tableName }) => tableName);
      const privileges = RUNTIME_TABLE_PRIVILEGE_EXPECTATIONS.map(({ privilege }) => privilege);
      const shouldHave = RUNTIME_TABLE_PRIVILEGE_EXPECTATIONS.map(({ shouldHave: value }) => value);
      const matrixTables = EXPECTED_RUNTIME_TABLE_ACCESS.map(({ table }) => table);
      const runtimePrivileges = await client.query<RuntimeTablePrivilegeRow>(
        `WITH expected(table_name, privilege, should_have, ordinal) AS (
           SELECT *
           FROM pg_catalog.unnest($2::text[], $3::text[], $4::boolean[])
             WITH ORDINALITY
         ),
         schema_relations AS (
           SELECT relation.oid, relation.relname
           FROM pg_catalog.pg_class AS relation
           INNER JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = $1
             AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
         ),
         checked AS (
           SELECT
             expected.table_name AS "tableName",
             expected.privilege AS "privilege",
             expected.should_have AS "shouldHave",
             relation.oid IS NOT NULL AS "relationExists",
             pg_catalog.coalesce(
               pg_catalog.has_table_privilege(CURRENT_USER, relation.oid, expected.privilege),
               false
             ) AS "hasPrivilege",
             CASE
               WHEN expected.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN
                 pg_catalog.coalesce(
                   pg_catalog.has_any_column_privilege(
                     CURRENT_USER,
                     relation.oid,
                     expected.privilege
                   ),
                   false
                 )
               ELSE false
             END AS "hasColumnPrivilege",
             pg_catalog.coalesce(
               pg_catalog.has_table_privilege(
                 CURRENT_USER,
                 relation.oid,
                 expected.privilege || ' WITH GRANT OPTION'
               ),
               false
             ) AS "hasGrantOption",
             CASE
               WHEN expected.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN
                 pg_catalog.coalesce(
                   pg_catalog.has_any_column_privilege(
                     CURRENT_USER,
                     relation.oid,
                     expected.privilege || ' WITH GRANT OPTION'
                   ),
                   false
                 )
               ELSE false
             END AS "hasColumnGrantOption",
             expected.ordinal AS sort_order
           FROM expected
           LEFT JOIN schema_relations AS relation
             ON relation.relname = expected.table_name
         ),
         unexpected AS (
           SELECT
             relation.relname AS "tableName",
             privilege AS "privilege",
             false AS "shouldHave",
             true AS "relationExists",
             pg_catalog.has_table_privilege(CURRENT_USER, relation.oid, privilege) AS "hasPrivilege",
             CASE
               WHEN privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN
                 pg_catalog.has_any_column_privilege(CURRENT_USER, relation.oid, privilege)
               ELSE false
             END AS "hasColumnPrivilege",
             pg_catalog.has_table_privilege(
               CURRENT_USER,
               relation.oid,
               privilege || ' WITH GRANT OPTION'
             ) AS "hasGrantOption",
             CASE
               WHEN privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN
                 pg_catalog.has_any_column_privilege(
                   CURRENT_USER,
                   relation.oid,
                   privilege || ' WITH GRANT OPTION'
                 )
               ELSE false
             END AS "hasColumnGrantOption",
             9223372036854775807::bigint AS sort_order
           FROM schema_relations AS relation
           CROSS JOIN pg_catalog.unnest($6::text[]) AS expected_privilege(privilege)
           WHERE NOT (relation.relname = ANY($5::text[]))
         )
         SELECT "tableName", "privilege", "shouldHave", "relationExists",
                "hasPrivilege", "hasColumnPrivilege", "hasGrantOption",
                "hasColumnGrantOption"
         FROM (
           SELECT * FROM checked
           UNION ALL
           SELECT * FROM unexpected
         ) AS complete_matrix
         ORDER BY sort_order, "tableName", "privilege"`,
        [schema, tableNames, privileges, shouldHave, matrixTables, DATABASE_TABLE_PRIVILEGES],
      );
      ready = runtimeTablePrivilegeMatrixMatches(runtimePrivileges.rows);
    }

    if (ready) {
      // The schema has passed a strict identifier allowlist. Runtime receives
      // EXECUTE only on this argument-free metadata reader and no direct
      // production_schema_migrations table privilege.
      const history = await client.query<ProductionMigrationHistoryRow>(
        `SELECT version, name, checksum
         FROM "${schema}".read_production_schema_history()
         ORDER BY version`,
      );
      ready = productionSchemaHistoryMatches(history.rows, expectedHistory);
    }

    ambiguousTransactionState = true;
    await client.query("COMMIT");
    ambiguousTransactionState = false;
    transactionStarted = false;
    return ready;
  } catch (error) {
    const mustDiscard = ambiguousTransactionState;
    if (transactionStarted || ambiguousTransactionState) {
      try {
        await client.query("ROLLBACK");
        transactionStarted = false;
      } catch (rollbackError) {
        releaseError = rollbackError instanceof Error
          ? rollbackError
          : new Error(String(rollbackError));
      }
    }
    if (mustDiscard) {
      releaseError ??= error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export function createDatabaseReadinessProbe(
  options: DatabaseReadinessOptions,
): DatabaseReadinessProbe {
  const schema = validatedSchema(options.schema);
  const cacheTtlMs = validatedCacheTtl(options.cacheTtlMs);
  const statementTimeoutMs = validatedStatementTimeout(options.statementTimeoutMs);
  const now = options.now ?? Date.now;
  const expectedHistory = options.expectedHistory ?? EXPECTED_PRODUCTION_SCHEMA_HISTORY;
  let cached: { ready: boolean; expiresAt: number } | undefined;
  let inFlight: Promise<boolean> | undefined;

  return {
    check() {
      const currentTime = now();
      if (cached && currentTime < cached.expiresAt) return Promise.resolve(cached.ready);
      if (inFlight) return inFlight;

      const currentCheck = readDatabaseReadiness(
        options.database,
        schema,
        expectedHistory,
        statementTimeoutMs,
      )
        .catch(() => false)
        .then((ready) => {
          cached = { ready, expiresAt: now() + cacheTtlMs };
          return ready;
        })
        .finally(() => {
          if (inFlight === currentCheck) inFlight = undefined;
        });
      inFlight = currentCheck;
      return currentCheck;
    },

    invalidate() {
      cached = undefined;
    },
  };
}
