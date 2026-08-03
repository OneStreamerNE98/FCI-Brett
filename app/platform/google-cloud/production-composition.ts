import {
  createPostgresAuthorizationRepository,
} from "../../adapters/postgres/authorization-repository";
import {
  createPostgresAdminAuditReader,
} from "../../adapters/postgres/admin-audit-reader-repository";
import {
  createPostgresAdminAccessPersistenceRepository,
} from "../../adapters/postgres/admin-access-persistence-repository";
import {
  createPostgresClientRepository,
} from "../../adapters/postgres/client-repository";
import {
  createPostgresFileMetadataRepository,
} from "../../adapters/postgres/file-metadata-repository";
import {
  createPostgresIdentityPersistenceRepository,
} from "../../adapters/postgres/identity-persistence-repository";
import {
  createPostgresIntegrationMetadataRepository,
} from "../../adapters/postgres/integration-metadata-repository";
import {
  createPostgresLeadRepository,
} from "../../adapters/postgres/lead-repository";
import {
  createPostgresMailItemRepository,
} from "../../adapters/postgres/mail-item-repository";
import {
  createPostgresOutboxRepository,
} from "../../adapters/postgres/outbox-repository";
import type { PostgresPool } from "../../adapters/postgres/postgres-database";
import {
  createPostgresProjectRepository,
} from "../../adapters/postgres/project-repository";
import {
  createPostgresProjectMeetingRepository,
} from "../../adapters/postgres/project-meeting-repository";
import {
  createPostgresSecurityAuditRepository,
} from "../../adapters/postgres/security-audit-repository";
import {
  createPostgresFilingRuleRepository,
} from "../../adapters/postgres/filing-rule-repository";
import {
  createPostgresUserPreferencesRepository,
} from "../../adapters/postgres/user-preferences-repository";
import {
  createPostgresWorkspaceSettingsRepository,
} from "../../adapters/postgres/workspace-settings-repository";
import type { PostgresCreationRequestMetadata } from "../../adapters/postgres/creation-idempotency";
import type { AuthorizationRepository } from "../../ports/authorization";
import type { AdminAuditReader } from "../../ports/admin-audit-reader";
import type { AdminAccessPersistenceRepository } from "../../ports/admin-access-persistence";
import type { ClientRepository } from "../../ports/client-repository";
import type { FileMetadataRepository } from "../../ports/file-metadata";
import type { FilingRuleRepository } from "../../ports/filing-rule-repository";
import type { IdentityPersistenceRepository } from "../../ports/identity-persistence";
import type { IntegrationMetadataRepository } from "../../ports/integration-metadata";
import type { LeadRepository } from "../../ports/lead-repository";
import type { MailItemRepository } from "../../ports/mail-item-repository";
import type { OutboxRepository } from "../../ports/outbox-repository";
import type { ProjectRepository } from "../../ports/project-repository";
import type { ProjectMeetingRepository } from "../../ports/project-meeting-repository";
import type { SecurityAuditRepository } from "../../ports/security-audit";
import type { UserPreferencesRepository } from "../../ports/user-preferences-repository";
import type { WorkspaceSettingsRepository } from "../../ports/workspace-settings-repository";
import {
  createProductionPostgresPool,
  type ProductionPostgresPoolDependencies,
  type ProductionPostgresPoolHandle,
} from "./postgres-pool";
import type { ProductionConfig } from "./production-config";

export type ProductionRepositoryFactories = Readonly<{
  outbox: OutboxRepository;
  securityAudit: SecurityAuditRepository;
  authorization: AuthorizationRepository;
  adminAudit: AdminAuditReader;
  adminAccess: AdminAccessPersistenceRepository;
  identity: IdentityPersistenceRepository;
  integrations: IntegrationMetadataRepository;
  files: FileMetadataRepository;
  workspaceSettings: WorkspaceSettingsRepository;
  userPreferences: UserPreferencesRepository;
  filingRules: FilingRuleRepository;
  mailItems: MailItemRepository;
  clients(request: PostgresCreationRequestMetadata): ClientRepository;
  projects(request?: PostgresCreationRequestMetadata): ProjectRepository;
  leads(request?: PostgresCreationRequestMetadata): LeadRepository;
  projectMeetings(request?: PostgresCreationRequestMetadata): ProjectMeetingRepository;
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
  const sharedRepositoryOptions = {
    schema: config.postgres.schema,
    lockTimeoutMs: config.postgres.pool.lockTimeoutMs,
    statementTimeoutMs: config.postgres.pool.statementTimeoutMs,
  };
  const securityAudit = createPostgresSecurityAuditRepository(postgres, sharedRepositoryOptions);
  const authorization = createPostgresAuthorizationRepository(postgres, sharedRepositoryOptions);
  const adminAudit = createPostgresAdminAuditReader(postgres, sharedRepositoryOptions);
  const adminAccess = createPostgresAdminAccessPersistenceRepository(
    postgres,
    sharedRepositoryOptions,
  );
  const identity = createPostgresIdentityPersistenceRepository(postgres, sharedRepositoryOptions);
  const integrations = createPostgresIntegrationMetadataRepository(postgres, sharedRepositoryOptions);
  const files = createPostgresFileMetadataRepository(postgres, sharedRepositoryOptions);
  // These adapters carry no actor or request metadata, so one process-scoped
  // instance is safe. Authorization still happens before repository access.
  const workspaceSettings = createPostgresWorkspaceSettingsRepository(
    postgres,
    sharedRepositoryOptions,
  );
  const userPreferences = createPostgresUserPreferencesRepository(
    postgres,
    sharedRepositoryOptions,
  );
  const filingRules = createPostgresFilingRuleRepository(postgres, sharedRepositoryOptions);
  const mailItems = createPostgresMailItemRepository(postgres, sharedRepositoryOptions);
  const repositories: ProductionRepositoryFactories = Object.freeze({
    outbox,
    securityAudit,
    authorization,
    adminAudit,
    adminAccess,
    identity,
    integrations,
    files,
    workspaceSettings,
    userPreferences,
    filingRules,
    mailItems,
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
    leads(request) {
      return createPostgresLeadRepository(postgres, {
        schema: config.postgres.schema,
        ...(request ? { request: { ...request } } : {}),
      });
    },
    projectMeetings(request) {
      return createPostgresProjectMeetingRepository(postgres, {
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
