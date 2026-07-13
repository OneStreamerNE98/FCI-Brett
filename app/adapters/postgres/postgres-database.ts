import { postgresSchemaName } from "./postgres-values";

export interface PostgresQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  rows: Row[];
  rowCount: number | null;
}

export interface PostgresClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  release(error?: Error): void;
}

export interface PostgresPool {
  connect(): Promise<PostgresClient>;
}

export type PostgresTransactionOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const MAX_TRANSACTION_TIMEOUT_MS = 300_000;

function transactionTimeout(
  value: number | undefined,
  fallback: number,
  label: string,
) {
  const timeout = value ?? fallback;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > MAX_TRANSACTION_TIMEOUT_MS
  ) {
    throw new TypeError(`${label} must be an integer from 1 to ${MAX_TRANSACTION_TIMEOUT_MS} ms`);
  }
  return timeout;
}

function cleanupError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Runs only database work in a bounded transaction on one pooled connection.
 * Callers must complete provider and network operations after this promise has
 * committed. A lost BEGIN/COMMIT response discards the connection because its
 * transaction state or commit outcome cannot be proven locally.
 */
export async function withPostgresTransaction<T>(
  pool: PostgresPool,
  options: PostgresTransactionOptions,
  work: (client: PostgresClient) => Promise<T>,
): Promise<T> {
  const schema = postgresSchemaName(options.schema);
  const lockTimeoutMs = transactionTimeout(
    options.lockTimeoutMs,
    DEFAULT_LOCK_TIMEOUT_MS,
    "PostgreSQL lock timeout",
  );
  const statementTimeoutMs = transactionTimeout(
    options.statementTimeoutMs,
    DEFAULT_STATEMENT_TIMEOUT_MS,
    "PostgreSQL statement timeout",
  );

  const client = await pool.connect();
  let transactionStarted = false;
  let ambiguousTransactionState = false;
  let releaseError: Error | undefined;
  let primaryError: unknown;

  try {
    try {
      ambiguousTransactionState = true;
      await client.query("BEGIN");
      ambiguousTransactionState = false;
      transactionStarted = true;

      await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
      await client.query("SELECT pg_catalog.set_config('search_path', $1, true)", [
        `${schema}, pg_catalog, pg_temp`,
      ]);
      const effectiveSchema = await client.query<{ current_schema: unknown }>(
        "SELECT pg_catalog.current_schema() AS current_schema",
      );
      if (effectiveSchema.rowCount !== 1 || effectiveSchema.rows[0]?.current_schema !== schema) {
        throw new Error(`PostgreSQL transaction schema ${schema} is not available to the runtime role`);
      }

      const result = await work(client);

      ambiguousTransactionState = true;
      await client.query("COMMIT");
      ambiguousTransactionState = false;
      transactionStarted = false;
      return result;
    } catch (error) {
      primaryError = error;
      const mustDiscard = ambiguousTransactionState;
      if (transactionStarted || ambiguousTransactionState) {
        try {
          await client.query("ROLLBACK");
          transactionStarted = false;
        } catch (rollbackError) {
          releaseError = cleanupError(rollbackError);
        }
      }
      if (mustDiscard) releaseError ??= cleanupError(error);
      throw error;
    }
  } finally {
    try {
      client.release(releaseError);
    } catch (error) {
      if (primaryError === undefined) throw error;
    }
  }
}
