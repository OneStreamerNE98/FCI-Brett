import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CORE_REHEARSAL_ACKNOWLEDGMENT,
  CORE_REHEARSAL_IMPORTER_ROLE,
  runCoreRecordRehearsal,
} from "../app/platform/migration/core-record-rehearsal.ts";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();
const fixture = JSON.parse(
  await readFile(new URL("fixtures/production-core-rehearsal.json", import.meta.url), "utf8"),
);
const TEST_DATABASE_NAME_PATTERN = /(?:^|[_-])test(?:$|[_-])/i;
const ROLE_SETUP_LOCK_ID = "7314269172071304";
const MIGRATION_OWNER_ROLE = "fci_migration_owner";
const RUNTIME_ROLE = "fci_runtime";
const REQUIRED_ROLES = [MIGRATION_OWNER_ROLE, RUNTIME_ROLE, CORE_REHEARSAL_IMPORTER_ROLE];
const IMPORT_TABLES = [
  "activity_events",
  "clients",
  "contacts",
  "leads",
  "project_meetings",
  "projects",
];
const CONTROL_TABLES = [
  "idempotency_requests",
  "outbox_events",
  "production_schema_migrations",
];

function configuredDatabaseName(connectionString) {
  const parsed = new URL(connectionString);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

async function assertSafePostgres16TestDatabase(client, connectionString) {
  const configuredDatabase = configuredDatabaseName(connectionString);
  assert.match(
    configuredDatabase,
    TEST_DATABASE_NAME_PATTERN,
    "core rehearsal integration refuses a configured database name that is not explicitly test-only",
  );

  const result = await client.query(
    `SELECT current_database() AS "databaseName",
            current_setting('server_version_num')::integer AS "serverVersionNumber",
            role.rolsuper AS "isSuperuser"
     FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user`,
  );
  assert.equal(result.rowCount, 1);
  const row = result.rows[0];
  assert.equal(row.databaseName, configuredDatabase);
  assert.match(
    row.databaseName,
    TEST_DATABASE_NAME_PATTERN,
    "core rehearsal integration refuses a connected database that is not explicitly test-only",
  );
  assert.equal(
    Math.floor(row.serverVersionNumber / 10_000),
    16,
    `core rehearsal integration requires PostgreSQL 16, received ${row.serverVersionNumber}`,
  );
  assert.equal(
    row.isSuperuser,
    true,
    "core rehearsal integration requires a disposable test-database bootstrap principal",
  );
}

async function ensureCapabilityRole(client, role) {
  assert.match(role, /^[a-z][a-z0-9_]*$/);
  const existing = await client.query(
    `SELECT rolname,
            rolcanlogin AS "canLogin",
            rolsuper AS "isSuperuser",
            rolcreatedb AS "canCreateDatabase",
            rolcreaterole AS "canCreateRole",
            rolinherit AS "inheritsPrivileges",
            rolreplication AS "canReplicate",
            rolbypassrls AS "canBypassRls"
     FROM pg_catalog.pg_roles
     WHERE rolname = $1`,
    [role],
  );
  if (existing.rowCount === 0) {
    await client.query(
      `CREATE ROLE ${role}
       NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
    );
    return true;
  }

  assert.deepEqual(existing.rows[0], {
    rolname: role,
    canLogin: false,
    isSuperuser: false,
    canCreateDatabase: false,
    canCreateRole: false,
    inheritsPrivileges: false,
    canReplicate: false,
    canBypassRls: false,
  });
  return false;
}

async function applyExactImporterGrants(client, schema) {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${MIGRATION_OWNER_ROLE}`);
    for (const grantee of ["PUBLIC", RUNTIME_ROLE, CORE_REHEARSAL_IMPORTER_ROLE]) {
      await client.query(`REVOKE ALL ON SCHEMA ${schema} FROM ${grantee}`);
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${grantee}`);
      await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${grantee}`);
      await client.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${grantee}`);
    }
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${CORE_REHEARSAL_IMPORTER_ROLE}`);
    for (const table of IMPORT_TABLES) {
      await client.query(
        `GRANT SELECT, INSERT ON TABLE ${schema}.${table} TO ${CORE_REHEARSAL_IMPORTER_ROLE}`,
      );
    }
    for (const table of CONTROL_TABLES) {
      await client.query(
        `GRANT SELECT ON TABLE ${schema}.${table} TO ${CORE_REHEARSAL_IMPORTER_ROLE}`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function assertExactImporterPrivileges(client, schema) {
  const schemaPrivileges = await client.query(
    `SELECT privilege.privilege_type AS "privilegeType",
            privilege.is_grantable AS "isGrantable"
     FROM pg_catalog.pg_namespace AS namespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) AS privilege
     JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
     WHERE namespace.nspname = $1
       AND grantee.rolname = $2
     ORDER BY privilege.privilege_type`,
    [schema, CORE_REHEARSAL_IMPORTER_ROLE],
  );
  assert.deepEqual(schemaPrivileges.rows, [{ privilegeType: "USAGE", isGrantable: false }]);

  const tablePrivileges = await client.query(
    `SELECT relation.relname AS "tableName",
            privilege.privilege_type AS "privilegeType",
            privilege.is_grantable AS "isGrantable"
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS privilege
     JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
     WHERE namespace.nspname = $1
       AND relation.relkind IN ('r', 'p')
       AND grantee.rolname = $2
     ORDER BY relation.relname, privilege.privilege_type`,
    [schema, CORE_REHEARSAL_IMPORTER_ROLE],
  );
  const expected = [
    ...IMPORT_TABLES.flatMap((tableName) => [
      { tableName, privilegeType: "INSERT", isGrantable: false },
      { tableName, privilegeType: "SELECT", isGrantable: false },
    ]),
    ...CONTROL_TABLES.map((tableName) => ({
      tableName,
      privilegeType: "SELECT",
      isGrantable: false,
    })),
  ].sort((left, right) => (
    left.tableName.localeCompare(right.tableName)
      || left.privilegeType.localeCompare(right.privilegeType)
  ));
  assert.deepEqual(
    tablePrivileges.rows.sort((left, right) => (
      left.tableName.localeCompare(right.tableName)
        || left.privilegeType.localeCompare(right.privilegeType)
    )),
    expected,
  );

  const objectPrivilegeLeak = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS privilege
         JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
         WHERE namespace.nspname = $1
           AND relation.relkind = 'S'
           AND grantee.rolname = $2
       ) AS "hasSequencePrivilege",
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS privilege
         JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = privilege.grantee
         WHERE namespace.nspname = $1
           AND grantee.rolname = $2
       ) AS "hasFunctionPrivilege"`,
    [schema, CORE_REHEARSAL_IMPORTER_ROLE],
  );
  assert.deepEqual(objectPrivilegeLeak.rows, [{
    hasSequencePrivilege: false,
    hasFunctionPrivilege: false,
  }]);
}

test(
  "PostgreSQL 16 runs the bounded rehearsal with exact importer grants and lead references",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 90_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 4 });
    const client = await pool.connect();
    const schema = `fci_rehearsal_${randomUUID().replaceAll("-", "")}`;
    const createdRoles = [];
    let roleSetupLockHeld = false;
    let schemaCreated = false;

    try {
      await assertSafePostgres16TestDatabase(client, postgresTestUrl);
      await client.query("SELECT pg_catalog.pg_advisory_lock($1::bigint)", [ROLE_SETUP_LOCK_ID]);
      roleSetupLockHeld = true;

      for (const role of REQUIRED_ROLES) {
        if (await ensureCapabilityRole(client, role)) createdRoles.push(role);
      }

      await client.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${MIGRATION_OWNER_ROLE}`);
      schemaCreated = true;
      await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, {
        schema,
        role: MIGRATION_OWNER_ROLE,
      });
      await applyExactImporterGrants(client, schema);
      await assertExactImporterPrivileges(client, schema);

      const report = await runCoreRecordRehearsal(pool, fixture, {
        targetEnvironment: "staging",
        targetSchema: schema,
        acknowledgment: CORE_REHEARSAL_ACKNOWLEDGMENT,
      });
      assert.equal(report.status, "reconciled");
      assert.equal(report.targetSchema, schema);
      assert.equal(report.tables.leads.sourceCount, fixture.leads.length);
      assert.equal(report.tables.leads.destinationCount, fixture.leads.length);
      assert.equal(report.tables.projectMeetings.destinationCount, fixture.projectMeetings.length);
      assert.equal(report.tables.activityEvents.destinationCount, fixture.activityEvents.length);
      assert.ok(Object.values(report.tables).every((tableEvidence) => tableEvidence.matched));
      assert.deepEqual(report.sideEffects, {
        idempotencyRequestsInserted: 0,
        outboxEventsInserted: 0,
        providerCalls: 0,
      });

      const activityReferences = await client.query(
        `SELECT id::text,
                client_id::text AS "clientId",
                project_id::text AS "projectId",
                lead_id::text AS "leadId"
         FROM ${schema}.activity_events
         ORDER BY id`,
      );
      assert.deepEqual(
        activityReferences.rows,
        fixture.activityEvents
          .map((event) => ({
            id: event.id,
            clientId: event.recordType === "client" ? event.recordId : null,
            projectId: event.recordType === "project" ? event.recordId : null,
            leadId: event.recordType === "lead" ? event.recordId : null,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      );

      const meetingReadback = await client.query(
        `SELECT attendees, action_items AS "actionItems"
         FROM ${schema}.project_meetings
         WHERE id = $1`,
        [fixture.projectMeetings[0].id],
      );
      assert.deepEqual(meetingReadback.rows, [{
        attendees: fixture.projectMeetings[0].attendees,
        actionItems: fixture.projectMeetings[0].actionItems,
      }]);

      const deliveryControls = await client.query(
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.idempotency_requests) AS "idempotencyRequests",
           (SELECT count(*)::integer FROM ${schema}.outbox_events) AS "outboxEvents"`,
      );
      assert.deepEqual(deliveryControls.rows, [{ idempotencyRequests: 0, outboxEvents: 0 }]);
    } finally {
      let cleanupError;
      if (schemaCreated) {
        try {
          await client.query(`DROP SCHEMA ${schema} CASCADE`);
        } catch (error) {
          cleanupError = error;
        }
      }
      for (const role of createdRoles.reverse()) {
        try {
          await client.query(`DROP ROLE ${role}`);
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (roleSetupLockHeld) {
        try {
          await client.query("SELECT pg_catalog.pg_advisory_unlock($1::bigint)", [ROLE_SETUP_LOCK_ID]);
        } catch (error) {
          cleanupError ??= error;
        }
      }
      client.release(cleanupError instanceof Error ? cleanupError : undefined);
      await pool.end();
      if (cleanupError) throw cleanupError;
    }
  },
);
