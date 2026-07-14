import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
} from "../app/platform/postgres/production-schema-migrations.ts";
import {
  runConfiguredProductionMigrations,
} from "../production-runtime/src/run-migrations.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");

async function readBuiltModuleGraph(outputRoot, entryName) {
  const visited = new Set();

  async function visit(modulePath) {
    const absolutePath = resolve(modulePath);
    const relativePath = relative(outputRoot, absolutePath);
    assert.ok(
      relativePath && !relativePath.startsWith("..") && !relativePath.includes(":\\"),
      `built import must stay inside the output directory: ${relativePath}`,
    );
    if (visited.has(absolutePath)) return "";
    visited.add(absolutePath);

    const source = await readFile(absolutePath, "utf8");
    const imports = [...source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)]
      .map((match) => resolve(dirname(absolutePath), match[1]));
    const dependencies = await Promise.all(imports.map(visit));
    return `${source}\n${dependencies.join("\n")}`;
  }

  return visit(join(outputRoot, entryName));
}

function migrationConfig(overrides = {}) {
  const { postgres: postgresOverrides = {}, ...topLevelOverrides } = overrides;
  return {
    appEnvironment: "production",
    deploymentStage: "staging",
    host: "0.0.0.0",
    port: 8080,
    postgres: {
      accessMode: "migration",
      connection: {
        mode: "cloud-sql-connector",
        instanceConnectionName: "fci-test:us-east4:fci-test",
        ipType: "PRIVATE",
      },
      database: "fci_operations",
      user: "fci_migrator_login",
      password: "test-only-password",
      passwordSource: "environment",
      schema: "fci_app",
      migrationRole: "fci_migration_owner",
      pool: {
        max: 1,
        connectionTimeoutMs: 1_000,
        idleTimeoutMs: 1_000,
        maxLifetimeSeconds: 60,
        statementTimeoutMs: 30_000,
        lockTimeoutMs: 5_000,
        idleInTransactionTimeoutMs: 30_000,
        queryTimeoutMs: 35_000,
        keepAliveInitialDelayMs: 0,
      },
      ...postgresOverrides,
    },
    ...topLevelOverrides,
  };
}

test("preserves Sites/Vinext commands while adding a physically separate Cloud Run build", async () => {
  const [packageSource, sitesConfig, cloudRunConfig, serverEntry, migrationEntry, rehearsalEntry] = await Promise.all([
    read("package.json"),
    read("vite.config.ts"),
    read("vite.cloud-run.config.ts"),
    read("production-runtime/src/cloud-run-server.ts"),
    read("production-runtime/src/run-migrations.ts"),
    read("production-runtime/src/run-core-rehearsal.ts"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(packageJson.scripts.dev, /vinext dev/);
  assert.match(packageJson.scripts.build, /vinext build/);
  assert.match(packageJson.scripts.start, /vinext start/);
  assert.match(packageJson.scripts["db:migrate:local"], /wrangler d1 migrations apply DB --local/);
  assert.match(sitesConfig, /sites\(\)/);
  assert.match(sitesConfig, /cloudflare\(/);

  assert.match(cloudRunConfig, /production-runtime\/src\/cloud-run-server\.ts/);
  assert.match(cloudRunConfig, /production-runtime\/src\/run-migrations\.ts/);
  assert.match(cloudRunConfig, /production-runtime\/src\/run-core-rehearsal\.ts/);
  assert.match(cloudRunConfig, /outDir: "work\/cloud-run"/);
  assert.doesNotMatch(cloudRunConfig, /from ["']\.\/vite\.config|sites\(\)|cloudflare\(|worker\/index|hosting\.json/);

  assert.doesNotMatch(
    serverEntry,
    /production-schema-migrations|runProductionSchemaMigrations|PRODUCTION_SCHEMA_MIGRATIONS|cloudflare:workers|vinext|worker\/index/,
  );
  assert.match(serverEntry, /createDatabaseReadinessProbe/);
  assert.match(serverEntry, /createFoundationServer/);
  assert.match(migrationEntry, /runProductionSchemaMigrations/);
  assert.match(migrationEntry, /role: config\.postgres\.migrationRole/);
  assert.match(migrationEntry, /transactionLockTimeoutMs: config\.postgres\.pool\.lockTimeoutMs/);
  assert.match(migrationEntry, /statementTimeoutMs: config\.postgres\.pool\.statementTimeoutMs/);
  assert.match(rehearsalEntry, /config\.deploymentStage === "production"/);
  assert.match(rehearsalEntry, /config\.postgres\.accessMode !== "rehearsal"/);
});

test("builds isolated service and job entries without migration SQL in the service graph", async () => {
  await build({
    root,
    configFile: join(root, "vite.cloud-run.config.ts"),
    logLevel: "silent",
  });

  const outputRoot = join(root, "work", "cloud-run");
  const names = await readdir(outputRoot);
  assert.ok(names.includes("cloud-run-server.mjs"));
  assert.ok(names.includes("run-migrations.mjs"));
  assert.ok(names.includes("run-core-rehearsal.mjs"));

  const [server, migrations, rehearsal, serviceGraph] = await Promise.all([
    readFile(join(outputRoot, "cloud-run-server.mjs"), "utf8"),
    readFile(join(outputRoot, "run-migrations.mjs"), "utf8"),
    readFile(join(outputRoot, "run-core-rehearsal.mjs"), "utf8"),
    readBuiltModuleGraph(outputRoot, "cloud-run-server.mjs"),
  ]);

  assert.match(server, /production_app_not_composed/);
  assert.doesNotMatch(
    serviceGraph,
    /cloudflare:workers|CREATE TABLE|runProductionSchemaMigrations|PRODUCTION_SCHEMA_HISTORY_SQL|runCoreRecordRehearsal|production_target_refused/,
  );
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS production_schema_migrations/);
  assert.match(migrations, /SET ROLE/);
  assert.match(migrations, /RESET ROLE/);
  assert.match(rehearsal, /production_target_refused/);
  assert.match(rehearsal, /FCI_REHEARSAL_ACKNOWLEDGMENT/);
});

test("uses a non-root allowlisted container context and one image for service or controlled jobs", async () => {
  const [dockerfile, dockerignore] = await Promise.all([
    read("Dockerfile.cloud-run"),
    read(".dockerignore"),
  ]);

  assert.match(dockerfile, /FROM node:22\.13\.0-bookworm-slim AS build/);
  assert.match(dockerfile, /tsc --project tsconfig\.cloud-run\.json --noEmit/);
  assert.match(dockerfile, /vite build --config vite\.cloud-run\.config\.ts/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /STOPSIGNAL SIGTERM/);
  assert.match(dockerfile, /run-migrations\.mjs/);
  assert.match(dockerfile, /run-core-rehearsal\.mjs/);
  assert.match(dockerfile, /refuses the production deployment stage/);
  assert.match(dockerfile, /CMD \["node", "runtime\/cloud-run-server\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /FCI_POSTGRES_PASSWORD|DATABASE_URL|COPY \. \./);

  assert.match(dockerignore, /^\*\*/);
  assert.match(dockerignore, /!production-runtime\/\*\*/);
  assert.doesNotMatch(dockerignore, /!\.env|!node_modules|!\.git/);
});

test("migration entry rejects the wrong mode or pool size before creating a pool", async () => {
  let createCalls = 0;
  const createPool = async () => {
    createCalls += 1;
    throw new Error("must not create");
  };

  await assert.rejects(
    runConfiguredProductionMigrations({}, {
      loadConfig: () => migrationConfig({ postgres: { accessMode: "runtime" } }),
      createPool,
    }),
    /migration access mode/,
  );
  await assert.rejects(
    runConfiguredProductionMigrations({}, {
      loadConfig: () => migrationConfig({ postgres: { pool: { ...migrationConfig().postgres.pool, max: 2 } } }),
      createPool,
    }),
    /one-connection pool/,
  );
  assert.equal(createCalls, 0);
});

test("migration entry activates the configured role and always closes its max-one pool", async () => {
  const queries = [];
  const releases = [];
  let closeCalls = 0;
  const expectedHistory = PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({
    version,
    name,
    checksum,
  }));
  const client = {
    async query(sql) {
      const normalized = sql.trim();
      queries.push(normalized);
      if (normalized === "SELECT CURRENT_USER AS current_user") {
        return { rows: [{ current_user: "fci_migration_owner" }], rowCount: 1 };
      }
      if (normalized.startsWith("SELECT pg_catalog.pg_try_advisory_lock")) {
        return { rows: [{ acquired: true }], rowCount: 1 };
      }
      if (normalized.startsWith("SELECT namespace.oid::text AS schema_oid")) {
        return {
          rows: [{ schema_oid: "16384", schema_owner: "fci_migration_owner" }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith("SELECT pg_catalog.current_setting")) {
        return { rows: [{ search_path: '"$user", public' }], rowCount: 1 };
      }
      if (normalized.startsWith("SELECT version, name, checksum")) {
        return { rows: expectedHistory, rowCount: expectedHistory.length };
      }
      if (normalized.startsWith("SELECT pg_catalog.pg_advisory_unlock")) {
        return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: null };
    },
    release(error) {
      releases.push(error);
    },
  };

  const result = await runConfiguredProductionMigrations({}, {
    loadConfig: () => migrationConfig(),
    createPool: async () => ({
      pool: { connect: async () => client },
      async close() { closeCalls += 1; },
    }),
  });

  assert.deepEqual(result, { appliedVersions: [], currentVersion: 2 });
  assert.equal(queries[0], 'SET ROLE "fci_migration_owner"');
  assert.ok(queries.indexOf("RESET ROLE") > queries.indexOf("SELECT pg_catalog.pg_advisory_unlock($1::bigint)"));
  assert.deepEqual(releases, [undefined]);
  assert.equal(closeCalls, 1);
});
