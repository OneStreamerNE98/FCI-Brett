import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [d1Adapter, postgresAdapter, postgresSchema, repositoryPort] = await Promise.all([
  readFile(new URL("../app/adapters/d1/project-repository.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/adapters/postgres/project-repository.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/platform/postgres/flooring-kpi-schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/ports/project-repository.ts", import.meta.url), "utf8"),
]);

test("D1 and PostgreSQL project adapters map every flooring KPI field", () => {
  for (const field of [
    "flooring_category",
    "square_feet",
    "contract_value",
    "installation_started_at",
    "installation_completed_at",
    "had_callback",
    "callback_note",
  ]) {
    assert.match(d1Adapter, new RegExp(`\\b${field}\\b`), `D1 must map ${field}`);
    assert.match(postgresAdapter, new RegExp(`\\b${field}\\b`), `PostgreSQL must map ${field}`);
    assert.match(postgresSchema, new RegExp(`\\b${field}\\b`), `migration v9 must define ${field}`);
  }

  assert.match(
    d1Adapter,
    /flooring_category, square_feet, contract_value[\s\S]*project\.flooringCategory, project\.squareFeet, project\.contractValue/,
  );
  assert.match(
    postgresAdapter,
    /flooring_category, square_feet, contract_value[\s\S]*intent\.project\.flooringCategory,[\s\S]*intent\.project\.squareFeet,[\s\S]*intent\.project\.contractValue/,
  );
  assert.match(
    d1Adapter,
    /UPDATE projects SET installation_started_at = \?, installation_completed_at = \?/,
  );
  assert.match(
    postgresAdapter,
    /SET installation_started_at = \$1, installation_completed_at = \$2/,
  );
  assert.match(d1Adapter, /UPDATE projects SET had_callback = \?, callback_note = \?/);
  assert.match(postgresAdapter, /SET had_callback = \$1, callback_note = \$2/);
});

test("both project adapters implement the shared operation outcome contract", () => {
  assert.match(
    d1Adapter,
    /createD1ProjectRepository\(database: D1Database\): ProjectRepository & ProjectOperationsRepository/,
  );
  assert.match(
    postgresAdapter,
    /\): ProjectRepository & ProjectOperationsRepository \{/,
  );
  assert.match(
    repositoryPort,
    /ProjectOperationRepositoryResult =[\s\S]*\{ outcome: "updated" \}[\s\S]*\{ outcome: "project-not-found" \}[\s\S]*VersionConflict/,
  );
  for (const method of ["recordInstallationDates", "recordFollowUpResult"]) {
    assert.match(d1Adapter, new RegExp(`async ${method}\\(`));
    assert.match(postgresAdapter, new RegExp(`async ${method}\\(`));
  }
});
