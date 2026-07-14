import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.deepEqual(runtimeGrants, [
    "GRANT USAGE ON SCHEMA fci_app TO fci_runtime;",
    "GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.clients TO fci_runtime;",
    "GRANT INSERT ON TABLE fci_app.contacts TO fci_runtime;",
    "GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.projects TO fci_runtime;",
    "GRANT INSERT ON TABLE fci_app.activity_events TO fci_runtime;",
    "GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.idempotency_requests TO fci_runtime;",
    "GRANT SELECT, INSERT, UPDATE ON TABLE fci_app.outbox_events TO fci_runtime;",
    "GRANT SELECT ON TABLE fci_app.production_schema_migrations TO fci_runtime;",
  ]);
  assert.ok(runtimeGrants.every((grant) => !/DELETE|TRUNCATE|REFERENCES|TRIGGER|CREATE|EXECUTE/.test(grant)));
  assert.match(sql, /FOR KEY SHARE[\s\S]*requires UPDATE privilege/);
  assert.match(sql, /sole migration-history privilege/);
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
