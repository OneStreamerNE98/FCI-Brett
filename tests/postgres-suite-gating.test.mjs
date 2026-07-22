import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const postgresSuites = [
  {
    file: "tests/production-postgres.integration.test.mjs",
    testName: "PostgreSQL 16 applies every production migration",
  },
  {
    file: "tests/postgres-repositories.integration.test.mjs",
    testName: "PostgreSQL 16 repositories preserve idempotency",
  },
  {
    file: "tests/postgres-employee-login.integration.test.mjs",
    testName: "real PostgreSQL consumes one raced invitation",
  },
];

for (const suite of postgresSuites) {
  test(`TEST_POSTGRES_URL enables ${suite.file} locally without GITHUB_ACTIONS`, () => {
    const environment = { ...process.env };
    delete environment.GITHUB_ACTIONS;
    delete environment.NODE_TEST_CONTEXT;
    environment.TEST_POSTGRES_URL = "postgresql://fci_test:test-only@127.0.0.1:1/fci_test?connect_timeout=1";

    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--test", `--test-name-pattern=${suite.testName}`, suite.file],
      { cwd: repositoryRoot, encoding: "utf8", env: environment, timeout: 30_000 },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    assert.equal(result.signal, null, output);
    assert.equal(result.status, 1, output);
    assert.match(output, new RegExp(suite.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(output, /ECONNREFUSED 127\.0\.0\.1:1/);
    assert.match(output, /skipped 0/);
  });
}
