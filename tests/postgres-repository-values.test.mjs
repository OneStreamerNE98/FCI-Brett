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

const [clientNameModule, postgresValuesModule, postgresDatabaseModule] = await Promise.all([
  vite.ssrLoadModule("/app/domain/client-name-key.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/postgres-values.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/postgres-database.ts"),
]);

after(async () => {
  await vite.close();
});

const { normalizeClientNameKey } = clientNameModule;
const {
  isPostgresUuid,
  parsePostgresBigint,
  parsePostgresJsonObject,
  parsePostgresNumericSafeInteger,
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
  parsePostgresUuid,
  postgresSchemaName,
  qualifiedPostgresName,
} = postgresValuesModule;
const { withPostgresTransaction } = postgresDatabaseModule;

test("normalizes client-name keys with the documented Unicode algorithm", () => {
  assert.equal(normalizeClientNameKey("  FCI\t\u00a0Operations  "), "fci operations");
  assert.equal(normalizeClientNameKey("Ｃａｆｅ\u0301\u2003FLOORS"), "café floors");
  assert.equal(normalizeClientNameKey("CAFÉ FLOORS"), "café floors");
  assert.equal(normalizeClientNameKey("\u212Aelvin Flooring"), "kelvin flooring");
  assert.equal(normalizeClientNameKey("  \n\t  "), "");
  assert.throws(() => normalizeClientNameKey(null), /Client name must be a string/);
});

test("validates schema names and UUIDs before SQL use", () => {
  assert.equal(postgresSchemaName(), "public");
  assert.equal(postgresSchemaName("fci_repository_test"), "fci_repository_test");
  assert.equal(
    qualifiedPostgresName("fci_repository_test", "outbox_events"),
    '"fci_repository_test"."outbox_events"',
  );

  for (const invalid of ["FCI", "fci-test", "public;drop table clients", "a".repeat(64), "", null]) {
    assert.throws(() => postgresSchemaName(invalid), /lowercase PostgreSQL identifier/);
  }

  const uppercaseUuid = "ABCDEF12-3456-4789-ABCD-EF1234567890";
  assert.equal(isPostgresUuid(uppercaseUuid), true);
  assert.equal(parsePostgresUuid(uppercaseUuid), uppercaseUuid.toLowerCase());
  for (const invalid of ["project-1", "abcdef1234564789abcdef1234567890", "", null]) {
    assert.equal(isPostgresUuid(invalid), false);
    assert.throws(() => parsePostgresUuid(invalid), /canonical UUID/);
  }
});

test("keeps bigint values canonical and never coerces unsafe versions", () => {
  assert.equal(parsePostgresBigint("0"), "0");
  assert.equal(parsePostgresBigint(-9_223_372_036_854_775_808n), "-9223372036854775808");
  assert.equal(parsePostgresBigint("-9223372036854775808"), "-9223372036854775808");
  assert.equal(parsePostgresBigint("9223372036854775807"), "9223372036854775807");
  assert.equal(parsePostgresBigint(42), "42");
  assert.equal(parsePostgresPositiveBigint("9007199254740992"), "9007199254740992");

  for (const invalid of [
    "01",
    "+1",
    "1.0",
    "1e3",
    " 1",
    "-9223372036854775809",
    "9223372036854775808",
    "1".repeat(1_000),
    Number.MIN_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => parsePostgresBigint(invalid), /signed 64-bit integer/);
  }
  for (const invalid of ["0", "-1"]) {
    assert.throws(() => parsePostgresPositiveBigint(invalid), /positive signed 64-bit integer/);
  }
});

test("parses only nonnegative JavaScript-safe whole numeric values", () => {
  assert.equal(parsePostgresNumericSafeInteger("0"), 0);
  assert.equal(parsePostgresNumericSafeInteger("125000.000"), 125000);
  assert.equal(parsePostgresNumericSafeInteger("9007199254740991.0"), Number.MAX_SAFE_INTEGER);
  assert.equal(parsePostgresNumericSafeInteger(42n), 42);
  assert.equal(parsePostgresNumericSafeInteger(null, "estimated value", { nullable: true }), null);

  for (const invalid of [null, "-1", "1.5", "01", "1e3", " 1", "9007199254740992", Number.NaN]) {
    assert.throws(
      () => parsePostgresNumericSafeInteger(invalid),
      /nonnegative JavaScript-safe whole number/,
    );
  }
});

test("parses timestamptz and JSONB object values without accepting loose shapes", () => {
  const expected = Date.UTC(2026, 6, 13, 12, 30, 45, 123);
  assert.equal(parsePostgresTimestamp(new Date(expected)), expected);
  assert.equal(parsePostgresTimestamp("2026-07-13T08:30:45.123-04:00"), expected);

  for (const invalid of ["2026-07-13T12:30:45", "not-a-date", new Date(Number.NaN), expected]) {
    assert.throws(() => parsePostgresTimestamp(invalid), /timezone-aware timestamp/);
  }

  const object = { projectId: "11111111-1111-4111-8111-111111111111" };
  assert.equal(parsePostgresJsonObject(object), object);
  const nullPrototype = Object.assign(Object.create(null), { safe: true });
  assert.equal(parsePostgresJsonObject(nullPrototype), nullPrototype);
  for (const invalid of [null, [], "{}", new Date()]) {
    assert.throws(() => parsePostgresJsonObject(invalid), /JSON object/);
  }
});

class FakePostgresClient {
  constructor(failOn) {
    this.failOn = failOn;
    this.queries = [];
    this.releaseError = undefined;
    this.currentSchema = "public";
  }

  async query(sql, values = []) {
    this.queries.push({ sql, values: [...values] });
    if (this.failOn === sql) throw new Error(`simulated ${sql} failure`);
    if (sql.includes("set_config('search_path'")) {
      this.currentSchema = values[0].split(",", 1)[0];
    }
    if (sql.includes("current_schema()")) {
      return { rows: [{ current_schema: this.currentSchema }], rowCount: 1 };
    }
    return { rows: [], rowCount: null };
  }

  release(error) {
    this.releaseError = error;
  }
}

class FakePostgresPool {
  constructor(client) {
    this.client = client;
    this.connectCount = 0;
  }

  async connect() {
    this.connectCount += 1;
    return this.client;
  }
}

test("runs short PostgreSQL transactions with local timeouts and a local search path", async () => {
  const client = new FakePostgresClient();
  const pool = new FakePostgresPool(client);
  const result = await withPostgresTransaction(
    pool,
    { schema: "fci_repository_test", lockTimeoutMs: 1_250, statementTimeoutMs: 9_000 },
    async (transaction) => {
      await transaction.query("INSERT INTO clients (id) VALUES ($1)", ["client-id"]);
      return "created";
    },
  );

  assert.equal(result, "created");
  assert.equal(pool.connectCount, 1);
  assert.deepEqual(client.queries, [
    { sql: "BEGIN", values: [] },
    { sql: "SET LOCAL lock_timeout = '1250ms'", values: [] },
    { sql: "SET LOCAL statement_timeout = '9000ms'", values: [] },
    {
      sql: "SELECT pg_catalog.set_config('search_path', $1, true)",
      values: ["fci_repository_test, pg_catalog, pg_temp"],
    },
    { sql: "SELECT pg_catalog.current_schema() AS current_schema", values: [] },
    { sql: "INSERT INTO clients (id) VALUES ($1)", values: ["client-id"] },
    { sql: "COMMIT", values: [] },
  ]);
  assert.equal(client.releaseError, undefined);
});

test("rolls back ordinary failures and discards ambiguous commit connections", async () => {
  const workClient = new FakePostgresClient();
  const workFailure = new Error("simulated repository failure");
  await assert.rejects(
    withPostgresTransaction(new FakePostgresPool(workClient), {}, async () => {
      throw workFailure;
    }),
    (error) => error === workFailure,
  );
  assert.equal(workClient.queries.at(-1).sql, "ROLLBACK");
  assert.equal(workClient.releaseError, undefined);

  const commitClient = new FakePostgresClient("COMMIT");
  await assert.rejects(
    withPostgresTransaction(new FakePostgresPool(commitClient), {}, async () => "accepted"),
    /simulated COMMIT failure/,
  );
  assert.equal(commitClient.queries.at(-1).sql, "ROLLBACK");
  assert.match(commitClient.releaseError.message, /simulated COMMIT failure/);
});

test("rejects unsafe transaction settings before acquiring a connection", async () => {
  const pool = new FakePostgresPool(new FakePostgresClient());
  await assert.rejects(
    withPostgresTransaction(pool, { schema: "unsafe-schema" }, async () => undefined),
    /lowercase PostgreSQL identifier/,
  );
  await assert.rejects(
    withPostgresTransaction(pool, { lockTimeoutMs: 0 }, async () => undefined),
    /lock timeout must be an integer/,
  );
  assert.equal(pool.connectCount, 0);
});

test("fails closed when the requested transaction schema is unavailable", async () => {
  const client = new FakePostgresClient();
  client.currentSchema = "public";
  const originalQuery = client.query.bind(client);
  client.query = async (sql, values = []) => {
    if (sql.includes("set_config('search_path'")) {
      client.queries.push({ sql, values: [...values] });
      return { rows: [], rowCount: 1 };
    }
    return originalQuery(sql, values);
  };

  await assert.rejects(
    withPostgresTransaction(
      new FakePostgresPool(client),
      { schema: "missing_runtime_schema" },
      async () => assert.fail("work must not run"),
    ),
    /schema missing_runtime_schema is not available/,
  );
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
});
