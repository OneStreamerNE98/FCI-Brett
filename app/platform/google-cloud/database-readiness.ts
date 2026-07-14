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
  ]);

type PermissionRow = Record<string, unknown> & {
  has_usage: unknown;
  has_create: unknown;
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

    // Both data statements are deliberately read-only. Runtime readiness must
    // never bootstrap schema, change roles, or apply migrations.
    const permissions = await client.query<PermissionRow>(
      `SELECT
         pg_catalog.has_schema_privilege(CURRENT_USER, $1, 'USAGE') AS has_usage,
         pg_catalog.has_schema_privilege(CURRENT_USER, $1, 'CREATE') AS has_create`,
      [schema],
    );
    const permission = permissions.rows[0];
    let ready = !(
      permissions.rowCount !== 1 ||
      permission?.has_usage !== true ||
      permission.has_create !== false
    );

    if (ready) {
      // The schema has already passed a strict identifier allowlist, so quoting
      // it here is deterministic and cannot introduce SQL syntax.
      const history = await client.query<ProductionMigrationHistoryRow>(
        `SELECT version, name, checksum
         FROM "${schema}".production_schema_migrations
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
