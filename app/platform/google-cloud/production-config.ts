import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export type DeploymentStage = "dev" | "staging" | "production";
export type PostgresAccessMode = "runtime" | "migration" | "rehearsal";
export type PostgresPasswordSource = "environment" | "file";
export type ProductionSecretSource = "environment" | "file";

export type CloudSqlConnectorConnection = Readonly<{
  mode: "cloud-sql-connector";
  instanceConnectionName: string;
  ipType: "PRIVATE";
}>;

export type DirectTcpConnection = Readonly<{
  mode: "direct-tcp";
  host: "127.0.0.1" | "::1" | "localhost";
  port: number;
}>;

export type PostgresConnection = CloudSqlConnectorConnection | DirectTcpConnection;

export type ProductionPostgresPoolConfig = Readonly<{
  max: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  maxLifetimeSeconds: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
  queryTimeoutMs: number;
  keepAliveInitialDelayMs: number;
}>;

export type ProductionPostgresConfig = Readonly<{
  accessMode: PostgresAccessMode;
  connection: PostgresConnection;
  database: string;
  user: string;
  /** Deliberately non-enumerable on the returned object. Never log this value. */
  password: string;
  passwordSource: PostgresPasswordSource;
  schema: string;
  migrationRole: string | null;
  pool: ProductionPostgresPoolConfig;
}>;

export type ProductionEmployeeOidcConfig = Readonly<{
  clientId: string;
  /** Deliberately non-enumerable on the returned object. Never log this value. */
  clientSecret: string;
  clientSecretSource: ProductionSecretSource;
  /** Encrypts the short-lived OIDC transaction cookie; never sent to Google. */
  sessionSecret: string;
  sessionSecretSource: ProductionSecretSource;
  redirectUri: string;
  allowedHostedDomain: "cherryhillfci.com";
}>;

export type ProductionConfig = Readonly<{
  appEnvironment: "production";
  deploymentStage: DeploymentStage;
  host: "0.0.0.0";
  port: number;
  postgres: ProductionPostgresConfig;
  /** Null preserves the pre-login fail-closed router when no OIDC values exist. */
  employeeOidc: ProductionEmployeeOidcConfig | null;
}>;

export type ProductionEnvironment = Readonly<Record<string, string | undefined>>;

export type ProductionConfigDependencies = Readonly<{
  readPasswordFile?: (path: string) => string;
  readSecretFile?: (path: string) => string;
}>;

const LOWER_POSTGRES_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const CLOUD_SQL_COMPONENT = /^[a-z0-9][a-z0-9.-]{0,126}$/;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/;
const REHEARSAL_SCHEMA = /^fci_rehearsal_[a-z0-9_]{1,49}$/;
const LOOPBACK_HOSTS = ["127.0.0.1", "::1", "localhost"] as const;
const EMPLOYEE_OIDC_VARIABLES = [
  "FCI_EMPLOYEE_OIDC_CLIENT_ID",
  "FCI_EMPLOYEE_OIDC_CLIENT_SECRET",
  "FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE",
  "FCI_EMPLOYEE_OIDC_REDIRECT_URI",
  "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN",
  "FCI_SESSION_SECRET",
  "FCI_SESSION_SECRET_FILE",
] as const;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

function configuredValue(environment: ProductionEnvironment, name: string) {
  const value = environment[name];
  if (value === undefined || value === "" || value !== value.trim()) {
    throw new Error(`${name} must be configured as trimmed, nonempty text`);
  }
  return value;
}

function exactValue<const Value extends string>(
  environment: ProductionEnvironment,
  name: string,
  values: readonly Value[],
): Value {
  const value = configuredValue(environment, name);
  if (!values.includes(value as Value)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}`);
  }
  return value as Value;
}

function optionalInteger(
  environment: ProductionEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function postgresIdentifier(environment: ProductionEnvironment, name: string) {
  const value = configuredValue(environment, name);
  if (!LOWER_POSTGRES_IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`);
  }
  return value;
}

function boundedSafeText(environment: ProductionEnvironment, name: string, maximumLength: number) {
  const value = configuredValue(environment, name);
  if (value.length > maximumLength || !SAFE_TEXT.test(value)) {
    throw new Error(`${name} must contain safe text no longer than ${maximumLength} characters`);
  }
  return value;
}

function cloudSqlInstanceConnectionName(environment: ProductionEnvironment) {
  const value = configuredValue(environment, "FCI_CLOUD_SQL_INSTANCE_CONNECTION_NAME");
  const components = value.split(":");
  if (components.length !== 3 || components.some((component) => !CLOUD_SQL_COMPONENT.test(component))) {
    throw new Error(
      "FCI_CLOUD_SQL_INSTANCE_CONNECTION_NAME must use the project:region:instance format",
    );
  }
  return value;
}

function resolvePassword(
  environment: ProductionEnvironment,
  dependencies: ProductionConfigDependencies,
): { password: string; passwordSource: PostgresPasswordSource } {
  const environmentPassword = environment.FCI_POSTGRES_PASSWORD;
  const passwordFile = environment.FCI_POSTGRES_PASSWORD_FILE;
  const hasEnvironmentPassword = environmentPassword !== undefined && environmentPassword !== "";
  const hasPasswordFile = passwordFile !== undefined && passwordFile !== "";

  if (hasEnvironmentPassword === hasPasswordFile) {
    throw new Error(
      "Configure exactly one of FCI_POSTGRES_PASSWORD or FCI_POSTGRES_PASSWORD_FILE",
    );
  }
  if (hasEnvironmentPassword) {
    if (environmentPassword.includes("\u0000")) {
      throw new Error("FCI_POSTGRES_PASSWORD contains an unsupported null byte");
    }
    return { password: environmentPassword, passwordSource: "environment" };
  }

  const path = configuredValue(environment, "FCI_POSTGRES_PASSWORD_FILE");
  if (!isAbsolute(path)) {
    throw new Error("FCI_POSTGRES_PASSWORD_FILE must be an absolute path");
  }
  let password: string;
  try {
    password = (dependencies.readPasswordFile ?? ((filePath) => readFileSync(filePath, "utf8")))(path);
  } catch {
    throw new Error("FCI_POSTGRES_PASSWORD_FILE could not be read");
  }
  if (!password || password.includes("\u0000")) {
    throw new Error("FCI_POSTGRES_PASSWORD_FILE did not contain a supported password");
  }
  return { password, passwordSource: "file" };
}

function resolveSecret(
  environment: ProductionEnvironment,
  dependencies: ProductionConfigDependencies,
  environmentName: string,
  fileName: string,
  label: string,
): { value: string; source: ProductionSecretSource } {
  const environmentSecret = environment[environmentName];
  const secretFile = environment[fileName];
  const hasEnvironmentSecret = environmentSecret !== undefined && environmentSecret !== "";
  const hasSecretFile = secretFile !== undefined && secretFile !== "";
  if (hasEnvironmentSecret === hasSecretFile) {
    throw new Error(`Configure exactly one of ${environmentName} or ${fileName}`);
  }
  if (hasEnvironmentSecret) {
    if (
      environmentSecret !== environmentSecret.trim()
      || environmentSecret.length > 4_096
      || /[\u0000-\u001f\u007f]/.test(environmentSecret)
    ) {
      throw new Error(`${environmentName} did not contain a supported ${label}`);
    }
    return { value: environmentSecret, source: "environment" };
  }

  const path = configuredValue(environment, fileName);
  if (!isAbsolute(path)) throw new Error(`${fileName} must be an absolute path`);
  let value: string;
  try {
    value = (dependencies.readSecretFile ?? ((filePath) => readFileSync(filePath, "utf8")))(path);
  } catch {
    throw new Error(`${fileName} could not be read`);
  }
  if (
    !value
    || value !== value.trim()
    || value.length > 4_096
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${fileName} did not contain a supported ${label}`);
  }
  return { value, source: "file" };
}

function employeeOidcRedirectUri(environment: ProductionEnvironment) {
  const value = boundedSafeText(environment, "FCI_EMPLOYEE_OIDC_REDIRECT_URI", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("FCI_EMPLOYEE_OIDC_REDIRECT_URI must be an absolute HTTPS callback URI");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== "/api/v1/session/google/callback"
    || parsed.toString() !== value
  ) {
    throw new Error(
      "FCI_EMPLOYEE_OIDC_REDIRECT_URI must be an exact HTTPS /api/v1/session/google/callback URI",
    );
  }
  return value;
}

function employeeOidcConfig(
  environment: ProductionEnvironment,
  dependencies: ProductionConfigDependencies,
): ProductionEmployeeOidcConfig | null {
  const configured = EMPLOYEE_OIDC_VARIABLES.filter((name) => {
    const value = environment[name];
    return value !== undefined && value !== "";
  });
  if (configured.length === 0) return null;

  const clientId = boundedSafeText(environment, "FCI_EMPLOYEE_OIDC_CLIENT_ID", 512);
  const redirectUri = employeeOidcRedirectUri(environment);
  const allowedHostedDomain = exactValue(
    environment,
    "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN",
    ["cherryhillfci.com"] as const,
  );
  const clientSecret = resolveSecret(
    environment,
    dependencies,
    "FCI_EMPLOYEE_OIDC_CLIENT_SECRET",
    "FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE",
    "client secret",
  );
  const sessionSecret = resolveSecret(
    environment,
    dependencies,
    "FCI_SESSION_SECRET",
    "FCI_SESSION_SECRET_FILE",
    "session secret",
  );
  if (
    sessionSecret.value.length !== 43
    || !BASE64URL_32_BYTES.test(sessionSecret.value)
    || Buffer.from(sessionSecret.value, "base64url").length !== 32
    || Buffer.from(sessionSecret.value, "base64url").toString("base64url") !== sessionSecret.value
  ) {
    throw new Error("Employee session secret must be a canonical 32-byte base64url value");
  }

  const properties = {
    clientId,
    clientSecretSource: clientSecret.source,
    sessionSecretSource: sessionSecret.source,
    redirectUri,
    allowedHostedDomain,
  };
  Object.defineProperty(properties, "clientSecret", {
    value: clientSecret.value,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(properties, "sessionSecret", {
    value: sessionSecret.value,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(properties) as ProductionEmployeeOidcConfig;
}

function resolveConnection(
  environment: ProductionEnvironment,
  deploymentStage: DeploymentStage,
  accessMode: PostgresAccessMode,
): PostgresConnection {
  const mode = exactValue(
    environment,
    "FCI_POSTGRES_CONNECTION_MODE",
    ["cloud-sql-connector", "direct-tcp"] as const,
  );

  if (mode === "cloud-sql-connector") {
    if (accessMode === "rehearsal" && deploymentStage === "production") {
      throw new Error("Rehearsal access cannot target the production deployment stage");
    }
    exactValue(environment, "FCI_CLOUD_SQL_IP_TYPE", ["PRIVATE"] as const);
    return Object.freeze({
      mode,
      instanceConnectionName: cloudSqlInstanceConnectionName(environment),
      ipType: "PRIVATE" as const,
    });
  }

  if (accessMode !== "rehearsal" || deploymentStage !== "dev") {
    throw new Error("Direct TCP is allowed only for rehearsal access in the dev stage");
  }
  const host = exactValue(environment, "FCI_POSTGRES_HOST", LOOPBACK_HOSTS);
  return Object.freeze({
    mode,
    host,
    port: optionalInteger(environment, "FCI_POSTGRES_PORT", 5432, 1, 65_535),
  });
}

function resolvePoolConfig(environment: ProductionEnvironment, accessMode: PostgresAccessMode) {
  const singleConnection = accessMode !== "runtime";
  const max = optionalInteger(
    environment,
    "FCI_POSTGRES_POOL_MAX",
    singleConnection ? 1 : 5,
    1,
    singleConnection ? 1 : 10,
  );
  const statementTimeoutMs = optionalInteger(
    environment,
    "FCI_POSTGRES_STATEMENT_TIMEOUT_MS",
    30_000,
    1_000,
    300_000,
  );
  const queryTimeoutMs = optionalInteger(
    environment,
    "FCI_POSTGRES_QUERY_TIMEOUT_MS",
    35_000,
    1_001,
    310_000,
  );
  if (queryTimeoutMs <= statementTimeoutMs) {
    throw new Error(
      "FCI_POSTGRES_QUERY_TIMEOUT_MS must be greater than FCI_POSTGRES_STATEMENT_TIMEOUT_MS",
    );
  }

  return Object.freeze({
    max,
    connectionTimeoutMs: optionalInteger(
      environment,
      "FCI_POSTGRES_CONNECTION_TIMEOUT_MS",
      accessMode === "runtime" ? 5_000 : 10_000,
      1_000,
      30_000,
    ),
    idleTimeoutMs: optionalInteger(
      environment,
      "FCI_POSTGRES_IDLE_TIMEOUT_MS",
      accessMode === "runtime" ? 30_000 : 1_000,
      1_000,
      600_000,
    ),
    maxLifetimeSeconds: optionalInteger(
      environment,
      "FCI_POSTGRES_MAX_LIFETIME_SECONDS",
      1_800,
      60,
      3_600,
    ),
    statementTimeoutMs,
    lockTimeoutMs: optionalInteger(
      environment,
      "FCI_POSTGRES_LOCK_TIMEOUT_MS",
      5_000,
      100,
      30_000,
    ),
    idleInTransactionTimeoutMs: optionalInteger(
      environment,
      "FCI_POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
    queryTimeoutMs,
    keepAliveInitialDelayMs: optionalInteger(
      environment,
      "FCI_POSTGRES_KEEPALIVE_INITIAL_DELAY_MS",
      10_000,
      0,
      60_000,
    ),
  });
}

/**
 * Loads only the Google Cloud production boundary. Unlike the development UI
 * helper, every environment and access selector here is explicit and invalid
 * input fails closed before a database connection can be attempted.
 */
export function loadProductionConfig(
  environment: ProductionEnvironment = process.env,
  dependencies: ProductionConfigDependencies = {},
): ProductionConfig {
  const appEnvironment = exactValue(
    environment,
    "FCI_APP_ENVIRONMENT",
    ["production"] as const,
  );
  const deploymentStage = exactValue(
    environment,
    "FCI_DEPLOYMENT_STAGE",
    ["dev", "staging", "production"] as const,
  );
  const accessMode = exactValue(
    environment,
    "FCI_POSTGRES_ACCESS_MODE",
    ["runtime", "migration", "rehearsal"] as const,
  );
  const connection = resolveConnection(environment, deploymentStage, accessMode);
  const database = postgresIdentifier(environment, "FCI_POSTGRES_DATABASE");
  const user = boundedSafeText(environment, "FCI_POSTGRES_USER", 255);
  const schema = postgresIdentifier(environment, "FCI_POSTGRES_SCHEMA");
  if (accessMode === "rehearsal" && !REHEARSAL_SCHEMA.test(schema)) {
    throw new Error(
      "FCI_POSTGRES_SCHEMA must use fci_rehearsal_ plus 1 to 49 lowercase letters, digits, or underscores in rehearsal mode",
    );
  }
  const migrationRole = accessMode === "migration"
    ? postgresIdentifier(environment, "FCI_POSTGRES_MIGRATION_ROLE")
    : null;
  const pool = resolvePoolConfig(environment, accessMode);
  // Read the secret only after all non-secret selectors and bounds have passed.
  const { password, passwordSource } = resolvePassword(environment, dependencies);
  const employeeOidc = employeeOidcConfig(environment, dependencies);

  const postgresProperties = {
    accessMode,
    connection,
    database,
    user,
    passwordSource,
    schema,
    migrationRole,
    pool,
  };
  const postgres = Object.defineProperty(postgresProperties, "password", {
    value: password,
    enumerable: false,
    configurable: false,
    writable: false,
  }) as ProductionPostgresConfig;
  Object.freeze(postgres);

  return Object.freeze({
    appEnvironment,
    deploymentStage,
    host: "0.0.0.0" as const,
    port: optionalInteger(environment, "PORT", 8080, 1, 65_535),
    postgres,
    employeeOidc,
  });
}
