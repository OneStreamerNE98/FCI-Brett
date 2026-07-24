import { pathToFileURL } from "node:url";
import {
  drainOutbox,
  NOOP_OUTBOX_DISPATCHER_REGISTRY,
  type OutboxDispatcherRegistry,
  type OutboxDrainResult,
} from "../../app/application/outbox-drain.ts";
import {
  createProductionPostgresPool,
  type ProductionPostgresPoolHandle,
} from "../../app/platform/google-cloud/postgres-pool.ts";
import {
  loadProductionConfig,
  type ProductionConfig,
  type ProductionEnvironment,
} from "../../app/platform/google-cloud/production-config.ts";
import type { OutboxRepository } from "../../app/ports/outbox-repository.ts";

export type OutboxDrainEntryDependencies = Readonly<{
  dispatchers?: OutboxDispatcherRegistry;
  loadConfig?: (environment: ProductionEnvironment) => ProductionConfig;
  createPool?: (config: ProductionConfig) => Promise<ProductionPostgresPoolHandle>;
  createRepository?: (
    pool: ProductionPostgresPoolHandle["pool"],
    options: Readonly<{
      schema: string;
      lockTimeoutMs: number;
      statementTimeoutMs: number;
    }>,
  ) => OutboxRepository;
}>;

function writeDrainEvent(
  severity: "INFO" | "ERROR",
  event: string,
  result?: OutboxDrainResult,
) {
  const stream = severity === "ERROR" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify({
    severity,
    event,
    ...(result ? { result } : {}),
  })}\n`);
}

export async function runConfiguredOutboxDrain(
  environment: ProductionEnvironment = process.env,
  dependencies: OutboxDrainEntryDependencies = {},
) {
  const dispatchers = dependencies.dispatchers ?? NOOP_OUTBOX_DISPATCHER_REGISTRY;
  // The shipped registry is empty. Do not even load provider/database
  // configuration until a later reviewed packet composes every dispatcher.
  if (dispatchers.isEmpty) {
    return drainOutbox(
      {
        claimAvailable: async () => {
          throw new Error("The inert outbox drain must not claim work");
        },
        complete: async () => {
          throw new Error("The inert outbox drain must not complete work");
        },
        retryOrDeadLetter: async () => {
          throw new Error("The inert outbox drain must not fail work");
        },
        recoverExpiredLeases: async () => {
          throw new Error("The inert outbox drain must not recover work");
        },
      },
      dispatchers,
    );
  }

  const config = (dependencies.loadConfig ?? loadProductionConfig)(environment);
  if (config.postgres.accessMode !== "runtime") {
    throw new Error("Outbox drain requires PostgreSQL runtime access mode");
  }
  if (config.postgres.pool.max !== 1) {
    throw new Error("Outbox drain requires a one-connection PostgreSQL pool");
  }

  const handle = await (
    dependencies.createPool ?? createProductionPostgresPool
  )(config);
  let primaryError: unknown;
  try {
    const createRepository = dependencies.createRepository
      ?? (await import("../../app/adapters/postgres/outbox-repository.ts"))
        .createPostgresOutboxRepository;
    const repository = createRepository(handle.pool, {
      schema: config.postgres.schema,
      lockTimeoutMs: config.postgres.pool.lockTimeoutMs,
      statementTimeoutMs: config.postgres.pool.statementTimeoutMs,
    });
    return await drainOutbox(repository, dispatchers);
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
    const result = await runConfiguredOutboxDrain();
    writeDrainEvent(
      "INFO",
      result.active ? "outbox_drain_complete" : "outbox_drain_inert",
      result,
    );
  } catch {
    writeDrainEvent("ERROR", "outbox_drain_failed");
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (executedPath === import.meta.url) void main();
