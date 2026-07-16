import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24683 } },
});

const [configModule, poolModule, compositionModule] = await Promise.all([
  vite.ssrLoadModule("/app/platform/google-cloud/production-config.ts"),
  vite.ssrLoadModule("/app/platform/google-cloud/postgres-pool.ts"),
  vite.ssrLoadModule("/app/platform/google-cloud/production-composition.ts"),
]);

after(async () => {
  await vite.close();
});

const { loadProductionConfig } = configModule;
const { createProductionPostgresPool } = poolModule;
const { composeProductionRepositories, createProductionComposition } = compositionModule;

const TEST_PASSWORD = "pool-test-secret-that-must-not-be-logged";

function cloudEnvironment(overrides = {}) {
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

class FakeRawClient {
  constructor(result = { rows: [{ ok: true }], rowCount: 1 }) {
    this.result = result;
    this.queries = [];
    this.releaseErrors = [];
  }

  async query(sql, values) {
    this.queries.push({ sql, values });
    return this.result;
  }

  release(error) {
    this.releaseErrors.push(error);
  }
}

class FakeRawPool {
  constructor(events, client = new FakeRawClient()) {
    this.events = events;
    this.client = client;
    this.errorListener = undefined;
    this.endCalls = 0;
  }

  async connect() {
    return this.client;
  }

  on(event, listener) {
    assert.equal(event, "error");
    this.errorListener = listener;
    return this;
  }

  async end() {
    this.endCalls += 1;
    this.events.push("pool.end");
  }
}

class FakeConnector {
  constructor(events, stream) {
    this.events = events;
    this.stream = stream;
    this.options = [];
    this.closeCalls = 0;
  }

  async getOptions(options) {
    this.options.push(options);
    return { stream: this.stream };
  }

  close() {
    this.closeCalls += 1;
    this.events.push("connector.close");
  }
}

test("builds one bounded private connector pool and adapts readonly query values", async () => {
  const config = loadProductionConfig(cloudEnvironment());
  const events = [];
  const stream = () => ({ test: "tls-stream" });
  const connector = new FakeConnector(events, stream);
  const rawClient = new FakeRawClient();
  const rawPool = new FakeRawPool(events, rawClient);
  let capturedPoolConfig;

  const handle = await createProductionPostgresPool(config, {
    createConnector: () => connector,
    createPool(poolConfig) {
      capturedPoolConfig = poolConfig;
      return rawPool;
    },
    log: () => assert.fail("no pool error was expected"),
  });

  assert.deepEqual(connector.options, [{
    instanceConnectionName: "fci-project:us-east1:fci-staging",
    ipType: "PRIVATE",
  }]);
  assert.equal(capturedPoolConfig.stream, stream);
  assert.equal(capturedPoolConfig.host, undefined);
  assert.equal(capturedPoolConfig.ssl, undefined);
  assert.equal(capturedPoolConfig.user, "fci_runtime");
  assert.equal(capturedPoolConfig.password, TEST_PASSWORD);
  assert.equal(capturedPoolConfig.database, "fci_operations");
  assert.equal(capturedPoolConfig.max, 5);
  assert.equal(capturedPoolConfig.connectionTimeoutMillis, 5_000);
  assert.equal(capturedPoolConfig.idleTimeoutMillis, 30_000);
  assert.equal(capturedPoolConfig.maxLifetimeSeconds, 1_800);
  assert.equal(capturedPoolConfig.allowExitOnIdle, false);
  assert.equal(capturedPoolConfig.keepAlive, true);
  assert.equal(capturedPoolConfig.keepAliveInitialDelayMillis, 10_000);
  assert.equal(capturedPoolConfig.statement_timeout, 30_000);
  assert.equal(capturedPoolConfig.lock_timeout, 5_000);
  assert.equal(capturedPoolConfig.idle_in_transaction_session_timeout, 30_000);
  assert.equal(capturedPoolConfig.query_timeout, 35_000);
  assert.equal(capturedPoolConfig.application_name, "fci-operations-runtime");

  const client = await handle.pool.connect();
  const readonlyValues = Object.freeze(["value", 42]);
  const result = await client.query("SELECT $1, $2", readonlyValues);
  assert.deepEqual(result, { rows: [{ ok: true }], rowCount: 1 });
  assert.deepEqual(rawClient.queries, [{ sql: "SELECT $1, $2", values: ["value", 42] }]);
  assert.notEqual(rawClient.queries[0].values, readonlyValues);
  assert.equal(Object.isFrozen(rawClient.queries[0].values), false);
  const releaseError = new Error("discard this test connection");
  client.release(releaseError);
  assert.deepEqual(rawClient.releaseErrors, [releaseError]);

  const firstClose = handle.close();
  const secondClose = handle.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
  assert.deepEqual(events, ["pool.end", "connector.close"]);
  assert.equal(rawPool.endCalls, 1);
  assert.equal(connector.closeCalls, 1);
});

test("logs only allowlisted pool error evidence and tolerates a broken logging sink", async () => {
  const config = loadProductionConfig(cloudEnvironment());
  const events = [];
  const connector = new FakeConnector(events, () => ({}));
  const rawPool = new FakeRawPool(events);
  const logged = [];
  const handle = await createProductionPostgresPool(config, {
    createConnector: () => connector,
    createPool: () => rawPool,
    log(event) {
      logged.push(event);
    },
  });

  const driverError = Object.assign(new Error(TEST_PASSWORD), {
    code: "57P01",
    host: TEST_PASSWORD,
    connectionString: TEST_PASSWORD,
  });
  rawPool.errorListener(driverError);
  assert.deepEqual(logged, [{
    severity: "ERROR",
    event: "postgres_pool_idle_client_error",
    deploymentStage: "staging",
    accessMode: "runtime",
    code: "57P01",
  }]);
  assert.doesNotMatch(JSON.stringify(logged), new RegExp(TEST_PASSWORD));

  const secondRawPool = new FakeRawPool([]);
  const secondHandle = await createProductionPostgresPool(config, {
    createConnector: () => new FakeConnector([], () => ({})),
    createPool: () => secondRawPool,
    log: () => { throw new Error(TEST_PASSWORD); },
  });
  assert.doesNotThrow(() => secondRawPool.errorListener({ code: "unsafe/code", message: TEST_PASSWORD }));

  await handle.close();
  await secondHandle.close();
});

test("uses a one-connection direct pool only for the validated dev rehearsal", async () => {
  const config = loadProductionConfig(cloudEnvironment({
    FCI_DEPLOYMENT_STAGE: "dev",
    FCI_POSTGRES_ACCESS_MODE: "rehearsal",
    FCI_POSTGRES_CONNECTION_MODE: "direct-tcp",
    FCI_POSTGRES_HOST: "localhost",
    FCI_POSTGRES_PORT: "55432",
    FCI_POSTGRES_SCHEMA: "fci_rehearsal_pool",
  }));
  const events = [];
  const rawPool = new FakeRawPool(events);
  let capturedPoolConfig;
  const handle = await createProductionPostgresPool(config, {
    createConnector: () => assert.fail("direct rehearsal must not create a Cloud SQL connector"),
    createPool(poolConfig) {
      capturedPoolConfig = poolConfig;
      return rawPool;
    },
  });

  assert.equal(capturedPoolConfig.host, "localhost");
  assert.equal(capturedPoolConfig.port, 55_432);
  assert.equal(capturedPoolConfig.ssl, false);
  assert.equal(capturedPoolConfig.stream, undefined);
  assert.equal(capturedPoolConfig.max, 1);
  assert.equal(capturedPoolConfig.connectionTimeoutMillis, 10_000);
  assert.equal(capturedPoolConfig.idleTimeoutMillis, 1_000);
  assert.equal(capturedPoolConfig.allowExitOnIdle, true);
  assert.equal(capturedPoolConfig.application_name, "fci-operations-rehearsal");
  await handle.close();
  assert.deepEqual(events, ["pool.end"]);
});

test("closes connector state when connector or pool construction fails", async () => {
  const config = loadProductionConfig(cloudEnvironment());
  const events = [];
  const connectorFailure = new FakeConnector(events, () => ({}));
  connectorFailure.getOptions = async () => { throw new Error("connector unavailable"); };
  await assert.rejects(
    createProductionPostgresPool(config, { createConnector: () => connectorFailure }),
    /connector unavailable/,
  );
  assert.deepEqual(events, ["connector.close"]);

  const poolFailureEvents = [];
  const poolFailureConnector = new FakeConnector(poolFailureEvents, () => ({}));
  await assert.rejects(
    createProductionPostgresPool(config, {
      createConnector: () => poolFailureConnector,
      createPool: () => { throw new Error("pool construction failed"); },
    }),
    /pool construction failed/,
  );
  assert.deepEqual(poolFailureEvents, ["connector.close"]);
});

test("composes singleton persistence repositories and request-scoped creation factories", async () => {
  const config = loadProductionConfig(cloudEnvironment());
  const events = [];
  const rawPool = new FakeRawPool(events);
  const handle = await createProductionPostgresPool(config, {
    createConnector: () => new FakeConnector(events, () => ({})),
    createPool: () => rawPool,
  });
  const composition = composeProductionRepositories(config, handle);
  const firstRequest = {
    idempotencyRequestId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "first-request",
    correlationId: "first-correlation",
    expiresAt: Date.UTC(2026, 6, 14),
    outboxEventId: "22222222-2222-4222-8222-222222222222",
  };
  const secondRequest = {
    ...firstRequest,
    idempotencyRequestId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "second-request",
    outboxEventId: "44444444-4444-4444-8444-444444444444",
  };

  assert.equal(composition.repositories.outbox, composition.repositories.outbox);
  assert.equal(composition.repositories.securityAudit, composition.repositories.securityAudit);
  assert.equal(composition.repositories.authorization, composition.repositories.authorization);
  assert.equal(typeof composition.repositories.authorization.findSessionByTokenHash, "function");
  assert.equal(composition.repositories.adminAccess, composition.repositories.adminAccess);
  assert.equal(typeof composition.repositories.adminAccess.setUserAccess, "function");
  assert.equal(composition.repositories.identity, composition.repositories.identity);
  assert.equal(composition.repositories.integrations, composition.repositories.integrations);
  assert.equal(composition.repositories.files, composition.repositories.files);
  assert.notEqual(composition.repositories.clients(firstRequest), composition.repositories.clients(firstRequest));
  assert.notEqual(composition.repositories.clients(firstRequest), composition.repositories.clients(secondRequest));
  assert.notEqual(composition.repositories.projects(firstRequest), composition.repositories.projects(secondRequest));
  assert.equal(typeof composition.repositories.projects().assignManager, "function");
  assert.equal(composition.postgres, handle.pool);
  await composition.close();
  assert.deepEqual(events, ["pool.end", "connector.close"]);

  const migrationConfig = loadProductionConfig(cloudEnvironment({
    FCI_POSTGRES_ACCESS_MODE: "migration",
    FCI_POSTGRES_MIGRATION_ROLE: "fci_migration",
  }));
  assert.throws(
    () => composeProductionRepositories(migrationConfig, handle),
    /requires PostgreSQL runtime access mode/,
  );
});

test("creates and closes a runtime composition through injected pool dependencies", async () => {
  const config = loadProductionConfig(cloudEnvironment());
  const events = [];
  const composition = await createProductionComposition(config, {
    createConnector: () => new FakeConnector(events, () => ({})),
    createPool: () => new FakeRawPool(events),
  });
  assert.equal(config.postgres.accessMode, "runtime");
  assert.equal(typeof composition.repositories.clients, "function");
  assert.equal(typeof composition.repositories.projects, "function");
  assert.equal(typeof composition.repositories.outbox.claimAvailable, "function");
  assert.equal(typeof composition.repositories.securityAudit.append, "function");
  assert.equal(typeof composition.repositories.adminAccess.createInvitation, "function");
  assert.equal(typeof composition.repositories.identity.registerExternalIdentity, "function");
  assert.equal(typeof composition.repositories.integrations.registerConnection, "function");
  assert.equal(typeof composition.repositories.files.reserveProjectUpload, "function");
  await composition.close();
  assert.deepEqual(events, ["pool.end", "connector.close"]);
});
