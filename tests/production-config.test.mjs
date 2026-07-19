import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  loadProductionConfig,
  PUBLIC_POSTGRES_SCHEMA_ACKNOWLEDGMENT,
} from "../app/platform/google-cloud/production-config.ts";

const TEST_PASSWORD = "test-only-secret-that-must-not-be-logged";
const TEST_OIDC_CLIENT_SECRET = "test-only-oidc-client-secret";
const TEST_SESSION_SECRET = Buffer.alloc(32, 0x51).toString("base64url");

function runtimeEnvironment(overrides = {}) {
  return {
    FCI_APP_ENVIRONMENT: "production",
    FCI_DEPLOYMENT_STAGE: "staging",
    FCI_POSTGRES_ACCESS_MODE: "runtime",
    FCI_POSTGRES_CONNECTION_MODE: "cloud-sql-connector",
    FCI_CLOUD_SQL_IP_TYPE: "PRIVATE",
    FCI_CLOUD_SQL_INSTANCE_CONNECTION_NAME: "fci-project:us-east1:fci-staging",
    FCI_POSTGRES_DATABASE: "fci_operations",
    FCI_POSTGRES_USER: "fci_runtime",
    FCI_POSTGRES_PASSWORD: TEST_PASSWORD,
    FCI_POSTGRES_SCHEMA: "fci",
    ...overrides,
  };
}

test("loads an explicit private Cloud SQL runtime configuration with bounded defaults", () => {
  const config = loadProductionConfig(runtimeEnvironment());

  assert.equal(config.appEnvironment, "production");
  assert.equal(config.deploymentStage, "staging");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.deepEqual(config.postgres.connection, {
    mode: "cloud-sql-connector",
    instanceConnectionName: "fci-project:us-east1:fci-staging",
    ipType: "PRIVATE",
  });
  assert.equal(config.postgres.accessMode, "runtime");
  assert.equal(config.postgres.migrationRole, null);
  assert.equal(config.postgres.password, TEST_PASSWORD);
  assert.equal(config.postgres.passwordSource, "environment");
  assert.deepEqual(config.postgres.pool, {
    max: 5,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
    maxLifetimeSeconds: 1_800,
    statementTimeoutMs: 30_000,
    lockTimeoutMs: 5_000,
    idleInTransactionTimeoutMs: 30_000,
    queryTimeoutMs: 35_000,
    keepAliveInitialDelayMs: 10_000,
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.postgres), true);
  assert.equal(Object.isFrozen(config.postgres.pool), true);
  assert.equal(Object.keys(config.postgres).includes("password"), false);
  assert.doesNotMatch(JSON.stringify(config), new RegExp(TEST_PASSWORD));
});

test("fails closed on missing or approximate environment and access selectors", () => {
  for (const [name, value, pattern] of [
    ["FCI_APP_ENVIRONMENT", undefined, /FCI_APP_ENVIRONMENT/],
    ["FCI_APP_ENVIRONMENT", "Production", /must be one of: production/],
    ["FCI_DEPLOYMENT_STAGE", "development", /dev, staging, production/],
    ["FCI_POSTGRES_ACCESS_MODE", "app", /runtime, migration, rehearsal/],
    ["FCI_CLOUD_SQL_IP_TYPE", "PUBLIC", /must be one of: PRIVATE/],
    ["FCI_CLOUD_SQL_INSTANCE_CONNECTION_NAME", "not-an-instance", /project:region:instance/],
  ]) {
    assert.throws(
      () => loadProductionConfig(runtimeEnvironment({ [name]: value })),
      pattern,
    );
  }
});

test("requires an explicit schema for every valid staging and production access-mode combination", () => {
  const validCombinations = [
    ["staging", "runtime"],
    ["staging", "migration"],
    ["staging", "rehearsal"],
    ["production", "runtime"],
    ["production", "migration"],
  ];

  for (const [deploymentStage, accessMode] of validCombinations) {
    const environment = runtimeEnvironment({
      FCI_DEPLOYMENT_STAGE: deploymentStage,
      FCI_POSTGRES_ACCESS_MODE: accessMode,
      FCI_POSTGRES_SCHEMA: undefined,
      ...(accessMode === "migration" ? { FCI_POSTGRES_MIGRATION_ROLE: "fci_migration" } : {}),
    });
    assert.throws(
      () => loadProductionConfig(environment),
      /FCI_POSTGRES_SCHEMA must be configured/,
      `${deploymentStage}/${accessMode}`,
    );
  }
});

test("requires the exact public-schema acknowledgment in staging and production", () => {
  for (const deploymentStage of ["staging", "production"]) {
    const publicEnvironment = runtimeEnvironment({
      FCI_DEPLOYMENT_STAGE: deploymentStage,
      FCI_POSTGRES_SCHEMA: "public",
    });
    assert.throws(
      () => loadProductionConfig(publicEnvironment),
      /FCI_POSTGRES_PUBLIC_SCHEMA_ACKNOWLEDGMENT must contain the exact documented acknowledgment/,
    );
    assert.throws(
      () => loadProductionConfig({
        ...publicEnvironment,
        FCI_POSTGRES_PUBLIC_SCHEMA_ACKNOWLEDGMENT: "yes",
      }),
      /FCI_POSTGRES_PUBLIC_SCHEMA_ACKNOWLEDGMENT must contain the exact documented acknowledgment/,
    );

    const acknowledged = loadProductionConfig({
      ...publicEnvironment,
      FCI_POSTGRES_PUBLIC_SCHEMA_ACKNOWLEDGMENT: PUBLIC_POSTGRES_SCHEMA_ACKNOWLEDGMENT,
    });
    assert.equal(acknowledged.postgres.schema, "public");
  }

  assert.throws(
    () => loadProductionConfig(
      runtimeEnvironment({
        FCI_POSTGRES_SCHEMA: "public",
        FCI_POSTGRES_PASSWORD: undefined,
        FCI_POSTGRES_PASSWORD_FILE: resolve("work", "must-not-be-read"),
      }),
      {
        readPasswordFile() {
          assert.fail("public-schema acknowledgment must fail before secret file access");
        },
      },
    ),
    /FCI_POSTGRES_PUBLIC_SCHEMA_ACKNOWLEDGMENT must contain the exact documented acknowledgment/,
  );

  assert.throws(
    () => loadProductionConfig(runtimeEnvironment({
      FCI_POSTGRES_PUBLIC_SCHEMA_ACKNOWLEDGMENT: PUBLIC_POSTGRES_SCHEMA_ACKNOWLEDGMENT,
    })),
    /must be unset unless staging or production targets the public schema/,
  );
});

test("keeps dev-stage schema requirements and public-schema behavior unchanged", () => {
  assert.throws(
    () => loadProductionConfig(runtimeEnvironment({
      FCI_DEPLOYMENT_STAGE: "dev",
      FCI_POSTGRES_SCHEMA: undefined,
    })),
    /FCI_POSTGRES_SCHEMA must be configured/,
  );

  const config = loadProductionConfig(runtimeEnvironment({
    FCI_DEPLOYMENT_STAGE: "dev",
    FCI_POSTGRES_SCHEMA: "public",
  }));
  assert.equal(config.postgres.schema, "public");
});

test("validates runtime pool caps, timeouts, identifiers, and service port", () => {
  const config = loadProductionConfig(runtimeEnvironment({
    PORT: "9090",
    FCI_POSTGRES_POOL_MAX: "10",
    FCI_POSTGRES_CONNECTION_TIMEOUT_MS: "7000",
    FCI_POSTGRES_IDLE_TIMEOUT_MS: "45000",
    FCI_POSTGRES_MAX_LIFETIME_SECONDS: "900",
    FCI_POSTGRES_STATEMENT_TIMEOUT_MS: "20000",
    FCI_POSTGRES_QUERY_TIMEOUT_MS: "25000",
    FCI_POSTGRES_LOCK_TIMEOUT_MS: "3000",
    FCI_POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS: "22000",
    FCI_POSTGRES_KEEPALIVE_INITIAL_DELAY_MS: "5000",
  }));
  assert.equal(config.port, 9090);
  assert.deepEqual(config.postgres.pool, {
    max: 10,
    connectionTimeoutMs: 7_000,
    idleTimeoutMs: 45_000,
    maxLifetimeSeconds: 900,
    statementTimeoutMs: 20_000,
    lockTimeoutMs: 3_000,
    idleInTransactionTimeoutMs: 22_000,
    queryTimeoutMs: 25_000,
    keepAliveInitialDelayMs: 5_000,
  });

  for (const overrides of [
    { FCI_POSTGRES_POOL_MAX: "0" },
    { FCI_POSTGRES_POOL_MAX: "11" },
    { FCI_POSTGRES_POOL_MAX: "1.5" },
    { FCI_POSTGRES_SCHEMA: "unsafe-schema" },
    { FCI_POSTGRES_DATABASE: "FCI" },
    { PORT: "65536" },
    {
      FCI_POSTGRES_STATEMENT_TIMEOUT_MS: "30000",
      FCI_POSTGRES_QUERY_TIMEOUT_MS: "30000",
    },
  ]) {
    assert.throws(() => loadProductionConfig(runtimeEnvironment(overrides)));
  }
});

test("requires an explicit validated migration owner and fixes migration pools at one connection", () => {
  const environment = runtimeEnvironment({
    FCI_POSTGRES_ACCESS_MODE: "migration",
    FCI_POSTGRES_MIGRATION_ROLE: "fci_migration",
  });
  const config = loadProductionConfig(environment);

  assert.equal(config.postgres.accessMode, "migration");
  assert.equal(config.postgres.migrationRole, "fci_migration");
  assert.equal(config.postgres.pool.max, 1);
  assert.equal(config.postgres.pool.connectionTimeoutMs, 10_000);
  assert.equal(config.postgres.pool.idleTimeoutMs, 1_000);

  assert.throws(
    () => loadProductionConfig({ ...environment, FCI_POSTGRES_MIGRATION_ROLE: undefined }),
    /FCI_POSTGRES_MIGRATION_ROLE/,
  );
  assert.throws(
    () => loadProductionConfig({ ...environment, FCI_POSTGRES_MIGRATION_ROLE: "schema-owner" }),
    /lowercase PostgreSQL identifier/,
  );
  assert.throws(
    () => loadProductionConfig({ ...environment, FCI_POSTGRES_POOL_MAX: "2" }),
    /integer from 1 to 1/,
  );
});

test("bounds rehearsal connections to private non-production Cloud SQL or loopback dev TCP", () => {
  const environment = runtimeEnvironment({
    FCI_DEPLOYMENT_STAGE: "dev",
    FCI_POSTGRES_ACCESS_MODE: "rehearsal",
    FCI_POSTGRES_CONNECTION_MODE: "direct-tcp",
    FCI_POSTGRES_HOST: "127.0.0.1",
    FCI_POSTGRES_PORT: "55432",
    FCI_POSTGRES_SCHEMA: "fci_rehearsal_core",
  });
  const config = loadProductionConfig(environment);
  assert.deepEqual(config.postgres.connection, {
    mode: "direct-tcp",
    host: "127.0.0.1",
    port: 55_432,
  });
  assert.equal(config.postgres.pool.max, 1);

  assert.throws(
    () => loadProductionConfig({ ...environment, FCI_DEPLOYMENT_STAGE: "staging" }),
    /Direct TCP is allowed only/,
  );
  assert.throws(
    () => loadProductionConfig({ ...environment, FCI_POSTGRES_ACCESS_MODE: "runtime" }),
    /Direct TCP is allowed only/,
  );
  assert.throws(
    () => loadProductionConfig({ ...environment, FCI_POSTGRES_HOST: "10.1.2.3" }),
    /FCI_POSTGRES_HOST/,
  );

  const stagingCloudConfig = loadProductionConfig(runtimeEnvironment({
    FCI_POSTGRES_ACCESS_MODE: "rehearsal",
    FCI_POSTGRES_SCHEMA: "fci_rehearsal_core",
  }));
  assert.deepEqual(stagingCloudConfig.postgres.connection, {
    mode: "cloud-sql-connector",
    instanceConnectionName: "fci-project:us-east1:fci-staging",
    ipType: "PRIVATE",
  });
  assert.equal(stagingCloudConfig.postgres.pool.max, 1);

  assert.throws(
    () => loadProductionConfig(runtimeEnvironment({
      FCI_POSTGRES_ACCESS_MODE: "rehearsal",
      FCI_POSTGRES_SCHEMA: "fci_rehearsal_",
    })),
    /FCI_POSTGRES_SCHEMA must use fci_rehearsal_/,
  );

  assert.throws(
    () => loadProductionConfig(
      runtimeEnvironment({
        FCI_DEPLOYMENT_STAGE: "production",
        FCI_POSTGRES_ACCESS_MODE: "rehearsal",
        FCI_POSTGRES_PASSWORD: undefined,
        FCI_POSTGRES_PASSWORD_FILE: resolve("work", "must-not-be-read"),
      }),
      {
        readPasswordFile() {
          assert.fail("invalid production rehearsal selectors must fail before secret file access");
        },
      },
    ),
    /Rehearsal access cannot target the production deployment stage/,
  );
});

test("loads exactly one password source without echoing secret values or file paths", () => {
  const passwordPath = resolve("work", "test-postgres-password");
  const fileSecret = "file-secret-that-must-not-be-logged";
  const environment = runtimeEnvironment({
    FCI_POSTGRES_PASSWORD: undefined,
    FCI_POSTGRES_PASSWORD_FILE: passwordPath,
  });
  const config = loadProductionConfig(environment, {
    readPasswordFile(path) {
      assert.equal(path, passwordPath);
      return fileSecret;
    },
  });

  assert.equal(config.postgres.password, fileSecret);
  assert.equal(config.postgres.passwordSource, "file");
  assert.doesNotMatch(JSON.stringify(config), /file-secret|test-postgres-password/);

  assert.throws(
    () => loadProductionConfig(runtimeEnvironment({ FCI_POSTGRES_PASSWORD_FILE: passwordPath })),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(TEST_PASSWORD));
      assert.doesNotMatch(error.message, /test-postgres-password/);
      return /exactly one/.test(error.message);
    },
  );
  assert.throws(
    () => loadProductionConfig(environment, { readPasswordFile: () => { throw new Error(fileSecret); } }),
    (error) => {
      assert.equal(error.message, "FCI_POSTGRES_PASSWORD_FILE could not be read");
      assert.doesNotMatch(error.message, /file-secret|test-postgres-password/);
      return true;
    },
  );
});

test("keeps employee OIDC absent by default and loads complete environment secrets without enumeration", () => {
  const absent = loadProductionConfig(runtimeEnvironment());
  assert.equal(absent.employeeOidc, null);

  const config = loadProductionConfig(runtimeEnvironment({
    FCI_EMPLOYEE_OIDC_CLIENT_ID: "employee-login.apps.googleusercontent.com",
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET: TEST_OIDC_CLIENT_SECRET,
    FCI_EMPLOYEE_OIDC_REDIRECT_URI:
      "https://ops.example.test/api/v1/session/google/callback",
    FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN: "cherryhillfci.com",
    FCI_SESSION_SECRET: TEST_SESSION_SECRET,
  }));
  assert.deepEqual(config.employeeOidc, {
    clientId: "employee-login.apps.googleusercontent.com",
    clientSecretSource: "environment",
    sessionSecretSource: "environment",
    redirectUri: "https://ops.example.test/api/v1/session/google/callback",
    allowedHostedDomain: "cherryhillfci.com",
  });
  assert.equal(config.employeeOidc.clientSecret, TEST_OIDC_CLIENT_SECRET);
  assert.equal(config.employeeOidc.sessionSecret, TEST_SESSION_SECRET);
  assert.equal(Object.keys(config.employeeOidc).includes("clientSecret"), false);
  assert.equal(Object.keys(config.employeeOidc).includes("sessionSecret"), false);
  assert.doesNotMatch(
    JSON.stringify(config),
    new RegExp(`${TEST_OIDC_CLIENT_SECRET}|${TEST_SESSION_SECRET}`),
  );
});

test("employee OIDC configuration fails closed on partial, mixed, or unsafe values", () => {
  const complete = {
    FCI_EMPLOYEE_OIDC_CLIENT_ID: "employee-login.apps.googleusercontent.com",
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET: TEST_OIDC_CLIENT_SECRET,
    FCI_EMPLOYEE_OIDC_REDIRECT_URI:
      "https://ops.example.test/api/v1/session/google/callback",
    FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN: "cherryhillfci.com",
    FCI_SESSION_SECRET: TEST_SESSION_SECRET,
  };
  for (const [overrides, pattern] of [
    [{ FCI_EMPLOYEE_OIDC_CLIENT_ID: "employee-login.apps.googleusercontent.com" }, /FCI_EMPLOYEE_OIDC_REDIRECT_URI/],
    [{ ...complete, FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE: resolve("work", "client-secret") }, /exactly one/],
    [{ ...complete, FCI_SESSION_SECRET_FILE: resolve("work", "session-secret") }, /exactly one/],
    [{ ...complete, FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN: "example.com" }, /cherryhillfci.com/],
    [{ ...complete, FCI_EMPLOYEE_OIDC_REDIRECT_URI: "http://ops.example.test/api/v1/session/google/callback" }, /exact HTTPS/],
    [{ ...complete, FCI_EMPLOYEE_OIDC_REDIRECT_URI: "https://ops.example.test/wrong" }, /exact HTTPS/],
    [{ ...complete, FCI_EMPLOYEE_OIDC_CLIENT_SECRET: " test-secret " }, /supported client secret/],
    [{ ...complete, FCI_EMPLOYEE_OIDC_CLIENT_SECRET: "test-secret\n" }, /supported client secret/],
    [{ ...complete, FCI_SESSION_SECRET: "not-a-32-byte-secret" }, /canonical 32-byte base64url/],
  ]) {
    assert.throws(() => loadProductionConfig(runtimeEnvironment(overrides)), pattern);
  }
});

test("loads employee OIDC secrets from absolute files without exposing paths or contents", () => {
  const clientPath = resolve("work", "employee-oidc-client-secret");
  const sessionPath = resolve("work", "employee-session-secret");
  const reads = [];
  const config = loadProductionConfig(runtimeEnvironment({
    FCI_EMPLOYEE_OIDC_CLIENT_ID: "employee-login.apps.googleusercontent.com",
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE: clientPath,
    FCI_EMPLOYEE_OIDC_REDIRECT_URI:
      "https://ops.example.test/api/v1/session/google/callback",
    FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN: "cherryhillfci.com",
    FCI_SESSION_SECRET_FILE: sessionPath,
  }), {
    readSecretFile(path) {
      reads.push(path);
      return path === clientPath ? TEST_OIDC_CLIENT_SECRET : TEST_SESSION_SECRET;
    },
  });
  assert.deepEqual(reads, [clientPath, sessionPath]);
  assert.equal(config.employeeOidc.clientSecretSource, "file");
  assert.equal(config.employeeOidc.sessionSecretSource, "file");
  assert.doesNotMatch(
    JSON.stringify(config),
    /employee-oidc-client-secret|employee-session-secret|test-only-oidc/,
  );
});
