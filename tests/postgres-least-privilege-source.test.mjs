import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPECTED_RUNTIME_COLUMN_SELECT_ACCESS,
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
  const columnSelects = new Map(
    EXPECTED_RUNTIME_COLUMN_SELECT_ACCESS.map(({ table, columns }) => [table, columns]),
  );
  const expectedTableGrants = EXPECTED_RUNTIME_TABLE_ACCESS
    .flatMap(({ table, privileges }) => {
      const grants = [];
      if (privileges.length > 0) {
        grants.push(`GRANT ${privileges.join(", ")} ON TABLE fci_app.${table} TO fci_runtime;`);
      }
      const selectColumns = columnSelects.get(table);
      if (selectColumns) {
        grants.push(
          `GRANT SELECT (${selectColumns.join(", ")}) ON TABLE fci_app.${table} TO fci_runtime;`,
        );
      }
      const updateColumns = columnUpdates.get(table);
      if (updateColumns) {
        grants.push(
          `GRANT UPDATE (${updateColumns.join(", ")}) ON TABLE fci_app.${table} TO fci_runtime;`,
        );
      }
      return grants;
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
    ["filing_rules", "assistant_label_definitions", "address_validation_reviews"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "audit_events")?.privileges,
    ["INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "leads")?.privileges,
    ["SELECT", "INSERT", "UPDATE"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "project_meetings")?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "projects")?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(({ table }) => table === "projects")?.columns,
    [
      "client_id",
      "name",
      "status",
      "site",
      "latitude",
      "longitude",
      "address_validation_verdict",
      "project_manager",
      "estimated_value",
      "flooring_category",
      "square_feet",
      "contract_value",
      "segment",
      "installation_started_at",
      "installation_completed_at",
      "had_callback",
      "callback_note",
      "updated_by",
      "updated_at",
      "version",
    ],
  );
  assert.match(
    sql,
    /GRANT UPDATE \(client_id, name, status, site, latitude, longitude, address_validation_verdict, project_manager, estimated_value, flooring_category, square_feet, contract_value, segment, installation_started_at, installation_completed_at, had_callback, callback_note, updated_by, updated_at, version\) ON TABLE fci_app\.projects TO fci_runtime;/,
  );
  assert.doesNotMatch(
    sql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE fci_app\.projects TO fci_runtime;/,
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(
      ({ table }) => table === "google_form_lead_intake_watermarks",
    )?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(
      ({ table }) => table === "google_form_lead_intake_watermarks",
    )?.columns,
    [
      "last_processed_row",
      "last_processed_submission_key",
      "last_processed_at",
      "updated_by",
    ],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(
      ({ table }) => table === "google_form_lead_reviews",
    )?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(
      ({ table }) => table === "google_form_lead_reviews",
    )?.columns,
    ["source_row", "status", "reviewed_by", "reviewed_at", "updated_at", "accepted_lead_id"],
  );
  assert.match(
    sql,
    /GRANT UPDATE \(last_processed_row, last_processed_submission_key, last_processed_at, updated_by\) ON TABLE fci_app\.google_form_lead_intake_watermarks TO fci_runtime;/,
  );
  assert.match(
    sql,
    /GRANT UPDATE \(source_row, status, reviewed_by, reviewed_at, updated_at, accepted_lead_id\) ON TABLE fci_app\.google_form_lead_reviews TO fci_runtime;/,
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(
      ({ table }) => table === "address_validation_reviews",
    )?.privileges,
    ["SELECT", "INSERT", "DELETE"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(
      ({ table }) => table === "address_validation_reviews",
    )?.columns,
    ["consumed_at"],
  );
  assert.match(
    sql,
    /GRANT UPDATE \(consumed_at\) ON TABLE fci_app\.address_validation_reviews TO fci_runtime;/,
  );
  assert.doesNotMatch(
    sql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE fci_app\.google_form_lead_(?:intake_watermarks|reviews) TO fci_runtime;/,
  );
  for (const deniedTable of [
    "production_schema_migrations",
    "integration_connection_scopes",
    "integration_cursors",
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
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "integration_connections")
      ?.privileges,
    ["INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "integration_credentials")
      ?.privileges,
    [],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "integration_events")
      ?.privileges,
    ["INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_SELECT_ACCESS.find(
      ({ table }) => table === "integration_connections",
    )?.columns,
    ["id", "status", "version"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_SELECT_ACCESS.find(
      ({ table }) => table === "integration_credentials",
    )?.columns,
    ["connection_id", "status", "version"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(
      ({ table }) => table === "integration_connections",
    )?.columns,
    [
      "status",
      "updated_by_user_id",
      "updated_by_actor_key",
      "revoked_at",
      "updated_at",
      "version",
    ],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(
      ({ table }) => table === "integration_credentials",
    )?.columns,
    ["ciphertext", "key_version", "status", "revoked_at", "updated_at", "version"],
  );
  assert.doesNotMatch(
    sql,
    /GRANT SELECT \([^)]*\bciphertext\b[^)]*\) ON TABLE fci_app\.integration_credentials/,
  );
  assert.doesNotMatch(
    sql,
    /GRANT (?:SELECT|UPDATE|DELETE).* ON TABLE fci_app\.integration_connection_scopes/,
  );
  assert.doesNotMatch(
    sql,
    /GRANT .*DELETE.* ON TABLE fci_app\.integration_(?:connections|credentials|events)/,
  );
  assert.match(sql, /FOR SHARE on users[\s\S]*exact column grants/);
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "invitations")?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "external_identities")?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_TABLE_ACCESS.find(({ table }) => table === "user_roles")?.privileges,
    ["SELECT", "INSERT"],
  );
  assert.doesNotMatch(
    sql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE fci_app\.(?:users|external_identities|invitations|sessions|user_roles|project_memberships)/,
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
    [
      "token_hash",
      "status",
      "accepted_user_id",
      "accepted_at",
      "revoked_by_user_id",
      "revoked_at",
      "expired_at",
      "updated_at",
      "version",
    ],
  );
  assert.deepEqual(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS.find(({ table }) => table === "external_identities")?.columns,
    [
      "email",
      "hosted_domain",
      "email_verified",
      "last_authenticated_at",
      "updated_at",
      "version",
    ],
  );
  assert.equal(
    EXPECTED_RUNTIME_COLUMN_UPDATE_ACCESS
      .find(({ table }) => table === "project_memberships")
      ?.columns.includes("expires_at"),
    false,
  );
  assert.doesNotMatch(sql, /GRANT UPDATE \(id,/);
  assert.deepEqual(
    sqlWithoutComments.match(/^GRANT .*DELETE.* TO fci_runtime;$/gm) ?? [],
    [
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fci_app.filing_rules TO fci_runtime;",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fci_app.assistant_label_definitions TO fci_runtime;",
      "GRANT SELECT, INSERT, DELETE ON TABLE fci_app.address_validation_reviews TO fci_runtime;",
    ],
  );
  for (const [table, privileges] of [
    ["workspace_settings", ["SELECT", "INSERT", "UPDATE"]],
    ["user_preferences", ["SELECT", "INSERT", "UPDATE"]],
    ["filing_rules", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ["assistant_label_definitions", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ["mail_items", ["SELECT", "INSERT", "UPDATE"]],
    ["tasks", ["SELECT", "INSERT", "UPDATE"]],
    ["google_form_lead_intake_watermarks", ["SELECT", "INSERT"]],
    ["google_form_lead_reviews", ["SELECT", "INSERT"]],
    ["address_validation_reviews", ["SELECT", "INSERT", "DELETE"]],
  ]) {
    assert.deepEqual(
      EXPECTED_RUNTIME_TABLE_ACCESS.find((entry) => entry.table === table)?.privileges,
      privileges,
    );
  }
  assert.match(sql, /integration_credentials intentionally has no table-wide runtime grant/);
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
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".leads TO fci_rehearsal_importer;",
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".projects TO fci_rehearsal_importer;",
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".project_meetings TO fci_rehearsal_importer;",
    "GRANT SELECT, INSERT ON TABLE :\"fci_rehearsal_schema\".activity_events TO fci_rehearsal_importer;",
    "GRANT SELECT ON TABLE :\"fci_rehearsal_schema\".production_schema_migrations TO fci_rehearsal_importer;",
    "GRANT SELECT ON TABLE :\"fci_rehearsal_schema\".idempotency_requests TO fci_rehearsal_importer;",
    "GRANT SELECT ON TABLE :\"fci_rehearsal_schema\".outbox_events TO fci_rehearsal_importer;",
  ]);
  assert.ok(importerGrants.every((grant) => !/UPDATE|DELETE|TRUNCATE|CREATE|EXECUTE/.test(grant)));
  assert.match(rehearsalTemplate, /\^fci_rehearsal_\[a-z0-9_\]/);
  assert.match(rehearsalTemplate, /SET LOCAL ROLE fci_migration_owner/);
  assert.match(rehearsalTemplate, /owner_role\.rolname = 'fci_migration_owner'/);
  assert.match(rehearsalTemplate, /SELECT count\(\*\) = 9 AS fci_rehearsal_schema_has_required_tables/);
  assert.doesNotMatch(rehearsalTemplate.replace(/^--.*$/gm, ""), /\bfci_app\b/);
  assert.doesNotMatch(rehearsalSource, /INSERT INTO (?:idempotency_requests|outbox_events)/);
});

test("migration ownership requires SET ROLE instead of relying on inherited membership", () => {
  assert.match(sql, /MUST execute `SET ROLE fci_migration_owner`/);
  assert.match(sql, /current_user <> 'fci_migration_owner'/);
  assert.match(readme, /SET ROLE fci_migration_owner/);
  assert.match(readme, /wrong\s+owner[\s\S]*default privileges/);
});
