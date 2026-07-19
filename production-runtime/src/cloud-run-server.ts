import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  createAuthorizationService,
} from "../../app/application/authorization-service.ts";
import {
  createDatabaseReadinessProbe,
} from "../../app/platform/google-cloud/database-readiness.ts";
import {
  createFoundationServer,
  type FoundationServerController,
} from "../../app/platform/google-cloud/foundation-server.ts";
import {
  createEmployeeRequestRouter,
} from "../../app/platform/google-cloud/employee-request-router.ts";
import {
  createEmployeeOidcClient,
} from "../../app/platform/google-cloud/employee-oidc.ts";
import {
  createProductionComposition,
  type ProductionComposition,
} from "../../app/platform/google-cloud/production-composition.ts";
import {
  loadProductionConfig,
  type ProductionConfig,
  type ProductionEnvironment,
} from "../../app/platform/google-cloud/production-config.ts";

export type CloudRunFoundationDependencies = Readonly<{
  loadConfig?: (environment: ProductionEnvironment) => ProductionConfig;
  createComposition?: (config: ProductionConfig) => Promise<ProductionComposition>;
}>;

export type RunningCloudRunFoundation = Readonly<{
  config: ProductionConfig;
  controller: FoundationServerController;
}>;

function writeOperationalEvent(
  severity: "INFO" | "ERROR",
  event: string,
) {
  const stream = severity === "ERROR" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify({ severity, event })}\n`);
}

export async function startCloudRunFoundation(
  environment: ProductionEnvironment = process.env,
  dependencies: CloudRunFoundationDependencies = {},
): Promise<RunningCloudRunFoundation> {
  const config = (dependencies.loadConfig ?? loadProductionConfig)(environment);
  if (config.postgres.accessMode !== "runtime") {
    throw new Error("Cloud Run foundation service requires PostgreSQL runtime access mode");
  }

  const composition = await (
    dependencies.createComposition ?? createProductionComposition
  )(config);
  const readiness = createDatabaseReadinessProbe({
    database: composition.postgres,
    schema: config.postgres.schema,
  });
  const authorization = createAuthorizationService({
    repository: composition.repositories.authorization,
    sessions: composition.repositories.identity,
    audit: composition.repositories.securityAudit,
    newId: randomUUID,
  });
  const applicationHandler = createEmployeeRequestRouter({
    authorization,
    repository: composition.repositories.authorization,
    adminAudit: composition.repositories.adminAudit,
    adminAccess: composition.repositories.adminAccess,
    audit: composition.repositories.securityAudit,
    ...(config.employeeOidc
      ? {
          oidc: createEmployeeOidcClient(config.employeeOidc),
          identity: composition.repositories.identity,
        }
      : {}),
  });
  const controller = createFoundationServer({
    readiness,
    closeDatabase: composition.close,
    applicationHandler,
  });

  try {
    await controller.listen({ host: config.host, port: config.port });
  } catch (error) {
    try {
      await controller.shutdown();
    } catch {
      // Preserve the listen failure. Shutdown reports only generic operational
      // state and must not replace the primary startup error.
    }
    throw error;
  }

  return Object.freeze({ config, controller });
}

async function main() {
  let running: RunningCloudRunFoundation;
  try {
    running = await startCloudRunFoundation();
    writeOperationalEvent("INFO", "cloud_run_foundation_listening");
  } catch {
    writeOperationalEvent("ERROR", "cloud_run_foundation_start_failed");
    process.exitCode = 1;
    return;
  }

  let signalHandled = false;
  const handleSignal = () => {
    if (signalHandled) return;
    signalHandled = true;
    // shutdown() marks readiness unavailable before closing HTTP and then
    // closes the process-owned pool/connector handle within a hard deadline.
    void running.controller.shutdown()
      .then(() => {
        writeOperationalEvent("INFO", "cloud_run_foundation_stopped");
      })
      .catch(() => {
        writeOperationalEvent("ERROR", "cloud_run_foundation_shutdown_failed");
        process.exitCode = 1;
      });
  };
  process.once("SIGTERM", handleSignal);
  process.once("SIGINT", handleSignal);
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (executedPath === import.meta.url) void main();
