import {
  createPostgresClientRepository,
} from "../../adapters/postgres/client-repository";
import {
  createPostgresOutboxRepository,
} from "../../adapters/postgres/outbox-repository";
import type { PostgresPool } from "../../adapters/postgres/postgres-database";
import {
  createPostgresProjectRepository,
} from "../../adapters/postgres/project-repository";
import type { PostgresCreationRequestMetadata } from "../../adapters/postgres/creation-idempotency";
import type { ClientRepository } from "../../ports/client-repository";
import type { OutboxRepository } from "../../ports/outbox-repository";
import type { ProjectRepository } from "../../ports/project-repository";
import {
  createProductionPostgresPool,
  type ProductionPostgresPoolDependencies,
  type ProductionPostgresPoolHandle,
} from "./postgres-pool";
import type { ProductionConfig } from "./production-config";

export type ProductionRepositoryFactories = Readonly<{
  outbox: OutboxRepository;
  clients(request: PostgresCreationRequestMetadata): ClientRepository;
  projects(request?: PostgresCreationRequestMetadata): ProjectRepository;
}>;

export type ProductionComposition = Readonly<{
  config: ProductionConfig;
  postgres: PostgresPool;
  repositories: ProductionRepositoryFactories;
  close(): Promise<void>;
}>;

/**
 * Composes repository adapters around one process-owned pool. Creation
 * repositories are factories because their idempotency metadata belongs to one
 * authenticated request and must never be retained in a shared singleton.
 */
export function composeProductionRepositories(
  config: ProductionConfig,
  poolHandle: ProductionPostgresPoolHandle,
): ProductionComposition {
  if (config.postgres.accessMode !== "runtime") {
    throw new Error("Production repository composition requires PostgreSQL runtime access mode");
  }

  const postgres = poolHandle.pool;
  const outbox = createPostgresOutboxRepository(postgres, {
    schema: config.postgres.schema,
    lockTimeoutMs: config.postgres.pool.lockTimeoutMs,
    statementTimeoutMs: config.postgres.pool.statementTimeoutMs,
  });
  const repositories: ProductionRepositoryFactories = Object.freeze({
    outbox,
    clients(request) {
      return createPostgresClientRepository(postgres, {
        schema: config.postgres.schema,
        request: { ...request },
      });
    },
    projects(request) {
      return createPostgresProjectRepository(postgres, {
        schema: config.postgres.schema,
        ...(request ? { request: { ...request } } : {}),
      });
    },
  });

  return Object.freeze({
    config,
    postgres,
    repositories,
    close: poolHandle.close,
  });
}

export async function createProductionComposition(
  config: ProductionConfig,
  dependencies: ProductionPostgresPoolDependencies = {},
): Promise<ProductionComposition> {
  if (config.postgres.accessMode !== "runtime") {
    throw new Error("Production repository composition requires PostgreSQL runtime access mode");
  }
  const poolHandle = await createProductionPostgresPool(config, dependencies);
  try {
    return composeProductionRepositories(config, poolHandle);
  } catch (error) {
    try {
      await poolHandle.close();
    } catch {
      // Preserve the composition failure; the handle already attempted both
      // pool and connector cleanup without exposing either error here.
    }
    throw error;
  }
}
