import { pathToFileURL } from "node:url";
import {
  createProductionPostgresPool,
  type ProductionPostgresPoolHandle,
} from "../../app/platform/google-cloud/postgres-pool.ts";
import {
  loadProductionConfig,
  type ProductionConfig,
  type ProductionEnvironment,
} from "../../app/platform/google-cloud/production-config.ts";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
  type ProductionMigrationRunResult,
} from "../../app/platform/postgres/production-schema-migrations.ts";

export type MigrationEntryDependencies = Readonly<{
  loadConfig?: (environment: ProductionEnvironment) => ProductionConfig;
  createPool?: (config: ProductionConfig) => Promise<ProductionPostgresPoolHandle>;
}>;

function writeMigrationEvent(
  severity: "INFO" | "ERROR",
  event: string,
  result?: ProductionMigrationRunResult,
) {
  const stream = severity === "ERROR" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify({
    severity,
    event,
    ...(result
      ? {
          currentVersion: result.currentVersion,
          appliedVersions: result.appliedVersions,
        }
      : {}),
  })}\n`);
}

export async function runConfiguredProductionMigrations(
  environment: ProductionEnvironment = process.env,
  dependencies: MigrationEntryDependencies = {},
) {
  const config = (dependencies.loadConfig ?? loadProductionConfig)(environment);
  if (config.postgres.accessMode !== "migration") {
    throw new Error("Production migration entry requires PostgreSQL migration access mode");
  }
  if (config.postgres.pool.max !== 1) {
    throw new Error("Production migration entry requires a one-connection pool");
  }
  if (!config.postgres.migrationRole) {
    throw new Error("Production migration entry requires a validated migration role");
  }

  const handle = await (dependencies.createPool ?? createProductionPostgresPool)(config);
  let primaryError: unknown;
  try {
    return await runProductionSchemaMigrations(
      handle.pool,
      PRODUCTION_SCHEMA_MIGRATIONS,
      {
        schema: config.postgres.schema,
        lockTimeoutMs: config.postgres.pool.lockTimeoutMs,
        transactionLockTimeoutMs: config.postgres.pool.lockTimeoutMs,
        statementTimeoutMs: config.postgres.pool.statementTimeoutMs,
        role: config.postgres.migrationRole,
      },
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      // The pool handle ends the max-one pg pool before closing its connector.
      await handle.close();
    } catch (error) {
      if (primaryError === undefined) throw error;
    }
  }
}

async function main() {
  try {
    const result = await runConfiguredProductionMigrations();
    writeMigrationEvent("INFO", "production_migrations_complete", result);
  } catch {
    // Never serialize driver/configuration errors: they may include secret or
    // connection details. Operators receive a generic failure and nonzero exit.
    writeMigrationEvent("ERROR", "production_migrations_failed");
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (executedPath === import.meta.url) void main();
