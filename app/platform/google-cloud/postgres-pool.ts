import {
  Connector,
  IpAddressTypes,
  type DriverOptions,
} from "@google-cloud/cloud-sql-connector";
import { Pool, type PoolConfig } from "pg";
import type { PostgresPool } from "../../adapters/postgres/postgres-database";
import type { PostgresMigrationPool } from "../postgres/production-schema-migrations";
import type { ProductionConfig } from "./production-config";

type PostgresDatabasePool = PostgresPool & PostgresMigrationPool;

export type SafePostgresPoolLogEvent = Readonly<{
  severity: "ERROR";
  event: "postgres_pool_idle_client_error";
  deploymentStage: ProductionConfig["deploymentStage"];
  accessMode: ProductionConfig["postgres"]["accessMode"];
  code: string;
}>;

export interface CloudSqlConnectorLike {
  getOptions(input: {
    instanceConnectionName: string;
    ipType: IpAddressTypes;
  }): Promise<DriverOptions>;
  close(): void;
}

export interface PgClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
  release(error?: Error): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  on(event: "error", listener: (error: unknown) => void): unknown;
  end(): Promise<void>;
}

export type ProductionPostgresPoolDependencies = Readonly<{
  createConnector?: () => CloudSqlConnectorLike;
  createPool?: (config: PoolConfig) => PgPoolLike;
  log?: (event: SafePostgresPoolLogEvent) => void;
}>;

export type ProductionPostgresPoolHandle = Readonly<{
  pool: PostgresDatabasePool;
  close(): Promise<void>;
}>;

function defaultLog(event: SafePostgresPoolLogEvent) {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

const SAFE_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return "unknown";
  return /^[A-Z0-9]{5}$/.test(code) || SAFE_NETWORK_ERROR_CODES.has(code) ? code : "unknown";
}

function applicationName(accessMode: ProductionConfig["postgres"]["accessMode"]) {
  if (accessMode === "runtime") return "fci-operations-runtime";
  if (accessMode === "migration") return "fci-operations-migrator";
  return "fci-operations-rehearsal";
}

function basePoolConfig(config: ProductionConfig): PoolConfig {
  const postgres = config.postgres;
  return {
    user: postgres.user,
    password: postgres.password,
    database: postgres.database,
    max: postgres.pool.max,
    connectionTimeoutMillis: postgres.pool.connectionTimeoutMs,
    idleTimeoutMillis: postgres.pool.idleTimeoutMs,
    maxLifetimeSeconds: postgres.pool.maxLifetimeSeconds,
    allowExitOnIdle: postgres.accessMode !== "runtime",
    keepAlive: true,
    keepAliveInitialDelayMillis: postgres.pool.keepAliveInitialDelayMs,
    statement_timeout: postgres.pool.statementTimeoutMs,
    lock_timeout: postgres.pool.lockTimeoutMs,
    idle_in_transaction_session_timeout: postgres.pool.idleInTransactionTimeoutMs,
    query_timeout: postgres.pool.queryTimeoutMs,
    application_name: applicationName(postgres.accessMode),
  };
}

function wrappedPool(rawPool: PgPoolLike): PostgresDatabasePool {
  return {
    async connect() {
      const rawClient = await rawPool.connect();
      return {
        async query<Row extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          values?: readonly unknown[],
        ) {
          const result = await rawClient.query<Row>(sql, values ? [...values] : undefined);
          return { rows: result.rows, rowCount: result.rowCount };
        },
        release(error?: Error) {
          rawClient.release(error);
        },
      };
    },
  };
}

async function closeCreatedResources(
  rawPool: PgPoolLike | undefined,
  connector: CloudSqlConnectorLike | undefined,
) {
  let primaryError: unknown;
  if (rawPool) {
    try {
      await rawPool.end();
    } catch (error) {
      primaryError = error;
    }
  }
  if (connector) {
    try {
      connector.close();
    } catch (error) {
      primaryError ??= error;
    }
  }
  if (primaryError !== undefined) throw primaryError;
}

/**
 * Creates one bounded node-postgres pool for a process. The returned adapter is
 * the only object repository code receives; raw driver clients and connector
 * state cannot leak into request composition.
 */
export async function createProductionPostgresPool(
  config: ProductionConfig,
  dependencies: ProductionPostgresPoolDependencies = {},
): Promise<ProductionPostgresPoolHandle> {
  const createConnector = dependencies.createConnector ?? (() => new Connector());
  const createPool = dependencies.createPool
    ?? ((poolConfig: PoolConfig) => new Pool(poolConfig) as unknown as PgPoolLike);
  const log = dependencies.log ?? defaultLog;
  let connector: CloudSqlConnectorLike | undefined;
  let rawPool: PgPoolLike | undefined;

  try {
    let connectionConfig: Pick<PoolConfig, "stream" | "host" | "port" | "ssl">;
    if (config.postgres.connection.mode === "cloud-sql-connector") {
      connector = createConnector();
      const connectorOptions = await connector.getOptions({
        instanceConnectionName: config.postgres.connection.instanceConnectionName,
        ipType: IpAddressTypes.PRIVATE,
      });
      connectionConfig = { stream: connectorOptions.stream };
    } else {
      connectionConfig = {
        host: config.postgres.connection.host,
        port: config.postgres.connection.port,
        ssl: false,
      };
    }

    rawPool = createPool({ ...basePoolConfig(config), ...connectionConfig });
    rawPool.on("error", (error) => {
      const event: SafePostgresPoolLogEvent = Object.freeze({
        severity: "ERROR",
        event: "postgres_pool_idle_client_error",
        deploymentStage: config.deploymentStage,
        accessMode: config.postgres.accessMode,
        code: safeErrorCode(error),
      });
      try {
        log(event);
      } catch {
        // A logging sink must never turn an idle-client error into a process
        // crash or expose the original driver error through a fallback log.
      }
    });
  } catch (error) {
    try {
      await closeCreatedResources(rawPool, connector);
    } catch {
      // Preserve the construction error, which contains no configuration
      // values from this module. Cleanup errors are secondary here.
    }
    throw error;
  }

  const pool = wrappedPool(rawPool);
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    pool,
    close() {
      closePromise ??= closeCreatedResources(rawPool, connector);
      return closePromise;
    },
  });
}
