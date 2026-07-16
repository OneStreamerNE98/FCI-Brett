import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS,
  EXPECTED_RUNTIME_TABLE_ACCESS,
} from "../app/platform/google-cloud/database-readiness.ts";

const sqlUrl = new URL("../infrastructure/postgres/least-privilege.sql", import.meta.url);
const rehearsalTemplateUrl = new URL(
  "../infrastructure/postgres/rehearsal-importer-template.sql",
  import.meta.url,
);
const readmeUrl = new URL("../infrastructure/postgres/README.md", import.meta.url);
const moduleUrl = new URL("../app/platform/migration/core-record-rehearsal.ts", import.meta.url);
const [sql, rehearsalTemplate, readme, rehearsalSource] = await Promise.all([
  readFile(sqlUrl, "utf8"),
  readFile(rehearsalTemplateUrl, "utf8"),
  readFile(readmeUrl, "utf8"),
  readFile(moduleUrl, "utf8"),
]);
const sqlWithoutComments = sql.replace(/^--.*$/gm, "");

test("least-privilege source defines credential-free capability roles and revokes PUBLIC", () => {
  for (const role of ["fci_migration_owner", "fci_runtime", "fci_rehearsal_importer"]) {
    assert.match(
      sql,
      new RegExp(
        `CREATE ROLE ${role}[\\s\\S]*?NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`,
      ),
    );
  }
  assert.match(sql, /CREATE SCHEMA fci_app AUTHORIZATION fci_migration_owner/);
  assert.match(sql, /REVOKE ALL ON SCHEMA fci_app FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON SCHEMA fci_app FROM fci_runtime/);
  assert.match(sql, /REVOKE ALL ON SCHEMA fci_app FROM fci_rehearsal_importer/);
  for (const objectType of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
    assert.match(
      sql,
      new RegExp(
        `ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner\\s+REVOKE ALL ON ${objectType} FROM PUBLIC, fci_runtime, fci_rehearsal_importer;`,
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `ALTER DEFAULT PRIVILEGES FOR ROLE fci_migration_owner IN SCHEMA fci_app\\s+REVOKE ALL ON ${objectType} FROM PUBLIC, fci_runtime, fci_rehearsal_importer;`,
      ),
    );
  }
  assert.doesNotMatch(sqlWithoutComments, /PASSWORD|postgresql:\/\/|GRANT ALL/i);
});

test("runtime grants are exact and explicitly exclude destructive or schema privileges", () => {
  const runtimeGrants = sql.match(/^GRANT .* TO fci_runtime;$/gm) ?? [];
  const columnUpdates = new Map(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.map(({ table, columns }) => [table, columns]),
  );
  const expectedTableGrants = EXPECTED_RUNTIME_TABLE_ACCESS
    .filter(({ privileges }) => privileges.length > 0)
    .flatMap(({ table, privileges }) => {
      const tableGrant = `GRANT ${privileges.join(", ")} ON TABLE fci_app.${table} TO fci_runtime;`;
      const columns = columnUpdates.get(table);
      return columns
        ? [tableGrant, `GRANT UPDATE (${columns.join(", ")}) ON TABLE fci_app.${table} TO fci_runtime;`]
        : [tableGrant];
    });
  assert.deepEqual(runtimeGrants, [
    "GRANT USAGE ON SCHEMA fci_app TO fci_runtime;",
    ...expectedTableGrants,
    "GRANT EXECUTE ON FUNCTION fci_app.read_production_schema_history() TO fci_runtime;",
  ]);
  assert.ok(runtimeGrants.every((grant) => !/TRUNCATE|REFERENCES|TRIGGER|CREATE/.test(grant)));
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS
      .filter(({ privileges }) => privileges.includes("DELETE"))
      .map(({ table }) => table),
    [],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "audit_events")?.privileges,
    ["INSERT"],
  );
  for (const deniedTable of [
    "production_schema_migrations",
    "integration_credentials",
    "integration_connection_scopes",
    "integration_cursors",
    "integration_events",
  ]) {
    assert.deepEqual(
      EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === deniedTable)?.privileges,
      [],
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`^GRANT .* ON TABLE fci_app\\.${deniedTable} TO fci_runtime;$`, "m"),
    );
  }
  assert.match(sql, /FOR SHARE on users[\s\S]*exact column grants/);
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "invitations")?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "user_roles")?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.doesNotMatch(
    sql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE fci_app\.(?:users|invitations|sessions|user_roles|project_memberships)/,
  );
  assert.doesNotMatch(
    sql,
    /GRANT .*INSERT.* ON TABLE fci_app\.(?:roles|capabilities|role_capabilities)/,
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(({ table }) => table === "users")?.columns,
    ["status", "disabled_at", "authorization_version", "sessions_valid_after", "updated_at", "version"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(({ table }) => table === "invitations")?.columns,
    ["token_hash", "status", "revoked_by_user_id", "revoked_at", "expired_at", "updated_at", "version"],
  );
  assert.equal(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS
      .find(({ table }) => table === "project_memberships")
      ?.columns.includes("expires_at"),
    false,
  );
  assert.doesNotMatch(sql, /GRANT UPDATE \(id,/);
  assert.doesNotMatch(sqlWithoutComments, /^GRANT .*DELETE.* TO fci_runtime;$/m);
  assert.match(sql, /integration_credentials intentionally has no runtime table grant/);
});

test("readiness gets migration metadata only through a fixed security-definer boundary", () => {
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION fci_app\.read_production_schema_history\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, pg_temp/,
  );
  assert.match(
    sql,
    /FROM fci_app\.production_schema_migrations AS history[\s\S]*ORDER BY history\.version/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION fci_app\.read_production_schema_history\(\)[\s\S]*FROM PUBLIC, fci_runtime, fci_rehearsal_importer;/,
  );
  assert.equal(
    (sql.match(/^GRANT EXECUTE ON FUNCTION .* TO fci_runtime;$/gm) ?? []).length,
    1,
  );
});

test("rehearsal importer is isolated from fci_app and receives only prefix-validated temporary grants", () => {
  assert.deepEqual(sql.match(/^GRANT .* TO fci_rehearsal_importer;$/gm) ?? [], []);
  const importerGrants = rehearsalTemplate.match(/^GRANT .* TO fci_rehearsal_importer;$/gm) ?? [];
  assert.deepEqual(importerGrants, [
    "GRANT USAGE ON SCHEMA :\"fci_rehearsal_schema\" TO fci_rehearsal_importer;",
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".clients TO fci_rehearsal_importer;",
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".contacts TO fci_rehearsal_importer;",
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".projects TO fci_rehearsal_importer;",
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".activity_events TO fci_rehearsal_importer;",
    "GRANT SELECT ON TABLE :\"fci_rehearsal_schema\".production_schema_migrations TO fci_rehearsal_importer;",
    "GRANT SELECT ON TABLE :\"fci_rehearsal_schema\".idempotency_requests TO fci_rehearsal_importer;",
    "GRANT SELECT ON TABLE :\"fci_rehearsal_schema\".outbox_events TO fci_rehearsal_importer;",
  ]);
  assert.ok(importerGrants.every((grant) => !/UPDATE|DELETE|TRUNCATE|CREATE|EXECUTE/.test(grant)));
  assert.match(rehearsalTemplate, /\^fci_rehearsal_\[a-z0-9_\]/);
  assert.match(rehearsalTemplate, /SET LOCAL ROLE fci_migration_owner/);
  assert.match(rehearsalTemplate, /owner_role\.rolname = 'fci_migration_owner'/);
  assert.doesNotMatch(rehearsalTemplate.replace(/^--.*$/gm, ""), /\bfci_app\b/);
  assert.doesNotMatch(rehearsalSource, /INSERT INTO (?:idempotency_requests|outbox_events)/);
});

test("migration ownership requires SET ROLE instead of relying on inherited membership", () => {
  assert.match(sql, /MUST execute `SET ROLE fci_migration_owner`/);
  assert.match(sql, /current_user <> 'fci_migration_owner'/);
  assert.match(readme, /SET ROLE fci_migration_owner/);
  assert.match(readme, /wrong\s+owner[\s\S]*default privileges/);
});
