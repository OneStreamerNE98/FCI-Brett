import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  CORE_REHEARSAL_ACKNOWLEDGMENT,
  CORE_REHEARSAL_SCHEMA_PATTERN,
  CoreRecordRehearsalError,
  runCoreRecordRehearsal,
} from "../../app/platform/migration/core-record-rehearsal.ts";
import {
  createProductionPostgresPool,
  type ProductionPostgresPoolHandle,
} from "../../app/platform/google-cloud/postgres-pool.ts";
import {
  loadProductionConfig,
  type ProductionConfig,
  type ProductionEnvironment,
} from "../../app/platform/google-cloud/production-config.ts";

export type CoreRehearsalEntryDependencies = Readonly<{
  loadConfig?: (environment: ProductionEnvironment) => ProductionConfig;
  createPool?: (config: ProductionConfig) => Promise<ProductionPostgresPoolHandle>;
}>;

export const CORE_REHEARSAL_MAX_SNAPSHOT_BYTES = 16 * 1_024 * 1_024;

function commandError(code: string, message: string): CoreRecordRehearsalError {
  return new CoreRecordRehearsalError(code, message);
}

function snapshotPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== "--snapshot" || !argv[1]?.trim()) {
    throw commandError(
      "invalid_command_arguments",
      "Usage: run-core-rehearsal --snapshot <test-snapshot.json>",
    );
  }
  return argv[1];
}

function requiredEnvironment(environment: ProductionEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw commandError("missing_rehearsal_configuration", `${name} is required`);
  return value;
}

async function loadSnapshot(path: string): Promise<unknown> {
  const handle = await open(path, "r").catch(() => {
    throw commandError("snapshot_read_failed", "The rehearsal snapshot could not be read");
  });

  let source: string;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw commandError("snapshot_read_failed", "The rehearsal snapshot must be a regular file");
    }
    if (metadata.size > CORE_REHEARSAL_MAX_SNAPSHOT_BYTES) {
      throw commandError(
        "snapshot_too_large",
        `The rehearsal snapshot exceeds ${CORE_REHEARSAL_MAX_SNAPSHOT_BYTES} bytes`,
      );
    }

    const chunks: Buffer[] = [];
    let bytesReadTotal = 0;
    while (true) {
      const remaining = CORE_REHEARSAL_MAX_SNAPSHOT_BYTES - bytesReadTotal + 1;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1_024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
      if (bytesReadTotal > CORE_REHEARSAL_MAX_SNAPSHOT_BYTES) {
        throw commandError(
          "snapshot_too_large",
          `The rehearsal snapshot exceeds ${CORE_REHEARSAL_MAX_SNAPSHOT_BYTES} bytes`,
        );
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    source = Buffer.concat(chunks, bytesReadTotal).toString("utf8");
  } catch (error) {
    if (error instanceof CoreRecordRehearsalError) throw error;
    throw commandError("snapshot_read_failed", "The rehearsal snapshot could not be read");
  } finally {
    await handle.close().catch(() => undefined);
  }

  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw commandError("snapshot_parse_failed", "The rehearsal snapshot is not valid JSON");
  }
}

export async function runCoreRehearsalCommand(
  argv: readonly string[] = process.argv.slice(2),
  environment: ProductionEnvironment = process.env,
  dependencies: CoreRehearsalEntryDependencies = {},
) {
  const path = snapshotPath(argv);
  const acknowledgment = requiredEnvironment(environment, "FCI_REHEARSAL_ACKNOWLEDGMENT");
  if (acknowledgment !== CORE_REHEARSAL_ACKNOWLEDGMENT) {
    throw commandError(
      "acknowledgment_required",
      "The exact core rehearsal acknowledgment is required",
    );
  }
  const config = (dependencies.loadConfig ?? loadProductionConfig)(environment);
  if (config.appEnvironment !== "production") {
    throw commandError("invalid_app_environment", "Google Cloud runtime environment selection is required");
  }
  if (config.deploymentStage === "production") {
    throw commandError("production_target_refused", "Core rehearsal cannot target the production deployment stage");
  }
  if (config.postgres.accessMode !== "rehearsal") {
    throw commandError("invalid_access_mode", "Core rehearsal requires PostgreSQL rehearsal access mode");
  }
  if (config.postgres.pool.max !== 1) {
    throw commandError("invalid_pool_size", "Core rehearsal requires a one-connection PostgreSQL pool");
  }
  if (!CORE_REHEARSAL_SCHEMA_PATTERN.test(config.postgres.schema)) {
    throw commandError(
      "unsafe_target_schema",
      "Core rehearsal requires a prefix-validated isolated PostgreSQL schema",
    );
  }
  const snapshot = await loadSnapshot(path);

  const handle = await (dependencies.createPool ?? createProductionPostgresPool)(config);
  let primaryError: unknown;
  try {
    return await runCoreRecordRehearsal(handle.pool, snapshot, {
      targetEnvironment: config.deploymentStage === "dev" ? "development" : "staging",
      targetSchema: config.postgres.schema,
      acknowledgment,
      lockTimeoutMs: config.postgres.pool.lockTimeoutMs,
      statementTimeoutMs: config.postgres.pool.statementTimeoutMs,
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (primaryError === undefined) throw error;
    }
  }
}

async function main() {
  try {
    const report = await runCoreRehearsalCommand();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    if (error instanceof CoreRecordRehearsalError) {
      process.stderr.write(`Core rehearsal refused [${error.code}]: ${error.message}\n`);
    } else {
      process.stderr.write("Core rehearsal failed without exposing configuration, database, or row details.\n");
    }
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  void main();
}
