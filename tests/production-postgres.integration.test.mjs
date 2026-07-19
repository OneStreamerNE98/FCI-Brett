import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  ADMIN_ACCESS_CAPABILITY_CATALOG,
  ADMIN_ACCESS_ROLE_CAPABILITY_KEYS,
  ADMIN_ACCESS_ROLE_CATALOG,
} from "../app/platform/postgres/admin-access-persistence-schema.ts";
import {
  calculateProductionMigrationChecksum,
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();

test(
  "GitHub CI supplies PostgreSQL instead of silently skipping integration coverage",
  { skip: process.env.GITHUB_ACTIONS !== "true" },
  () => {
    assert.ok(postgresTestUrl, "TEST_POSTGRES_URL must be configured in GitHub Actions");
  },
);

async function expectPostgresError(promise, code, constraint) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    if (constraint) assert.equal(error.constraint, constraint);
    return true;
  });
}

test(
  "PostgreSQL 16 applies every production migration and enforces core invariants",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 30_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 6 });
    const schema = `fci_schema_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const migrationOptions = { schema };

    try {
      const concurrentResults = await Promise.all([
        runProductionSchemaMigrations(
          pool,
          PRODUCTION_SCHEMA_MIGRATIONS,
          migrationOptions,
        ),
        runProductionSchemaMigrations(
          pool,
          PRODUCTION_SCHEMA_MIGRATIONS,
          migrationOptions,
        ),
      ]);
      assert.deepEqual(
        concurrentResults.flatMap(({ appliedVersions }) => appliedVersions).sort(),
        [1, 2, 3, 4, 5, 6],
      );
      assert.deepEqual(concurrentResults.map(({ currentVersion }) => currentVersion), [6, 6]);

      const rerun = await runProductionSchemaMigrations(
        pool,
        PRODUCTION_SCHEMA_MIGRATIONS,
        migrationOptions,
      );
      assert.deepEqual(rerun, { appliedVersions: [], currentVersion: 6 });

      const history = await pool.query(
        `SELECT version, name, checksum
         FROM ${schema}.production_schema_migrations
         ORDER BY version`,
      );
      assert.deepEqual(
        history.rows,
        PRODUCTION_SCHEMA_MIGRATIONS.map(({ version, name, checksum }) => ({
          version,
          name,
          checksum,
        })),
      );

      const tableNames = await pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schema],
      );
      assert.deepEqual(
        tableNames.rows.map(({ table_name }) => table_name),
        [
          "activity_events",
          "audit_activity_projection",
          "audit_events",
          "capabilities",
          "clients",
          "contacts",
          "external_identities",
          "file_links",
          "file_versions",
          "files",
          "idempotency_requests",
          "integration_connection_scopes",
          "integration_connections",
          "integration_credentials",
          "integration_cursors",
          "integration_events",
          "integration_oauth_attempts",
          "integration_resources",
          "invitation_project_assignments",
          "invitations",
          "leads",
          "outbox_events",
          "production_schema_migrations",
          "project_memberships",
          "project_meetings",
          "projects",
          "role_capabilities",
          "roles",
          "sessions",
          "storage_objects",
          "user_roles",
          "users",
        ],
      );

      const seededRoles = await pool.query(
        `SELECT role_key, display_name, version::text AS version
         FROM ${schema}.roles
         ORDER BY role_key`,
      );
      assert.deepEqual(
        seededRoles.rows,
        ADMIN_ACCESS_ROLE_CATALOG
          .map(({ key, displayName }) => ({
            role_key: key,
            display_name: displayName,
            version: "1",
          }))
          .sort((left, right) => left.role_key.localeCompare(right.role_key)),
      );

      const seededCapabilities = await pool.query(
        `SELECT capability_key
         FROM ${schema}.capabilities
         ORDER BY capability_key`,
      );
      assert.deepEqual(
        seededCapabilities.rows.map(({ capability_key }) => capability_key),
        ADMIN_ACCESS_CAPABILITY_CATALOG.map(({ key }) => key).sort(),
      );

      const seededRoleCapabilities = await pool.query(
        `SELECT role.role_key,
                pg_catalog.array_agg(capability.capability_key ORDER BY capability.capability_key)
                  AS capability_keys
         FROM ${schema}.role_capabilities AS role_capability
         JOIN ${schema}.roles AS role ON role.id = role_capability.role_id
         JOIN ${schema}.capabilities AS capability ON capability.id = role_capability.capability_id
         GROUP BY role.role_key
         ORDER BY role.role_key`,
      );
      assert.deepEqual(
        seededRoleCapabilities.rows,
        Object.entries(ADMIN_ACCESS_ROLE_CAPABILITY_KEYS)
          .map(([role_key, capabilityKeys]) => ({
            role_key,
            capability_keys: [...capabilityKeys].sort(),
          }))
          .sort((left, right) => left.role_key.localeCompare(right.role_key)),
      );

      const seededPrincipals = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM ${schema}.users) AS users,
           (SELECT count(*)::integer FROM ${schema}.invitations) AS invitations,
           (SELECT count(*)::integer FROM ${schema}.sessions) AS sessions`,
      );
      assert.deepEqual(seededPrincipals.rows, [{ users: 0, invitations: 0, sessions: 0 }]);

      const clientId = "11111111-1111-4111-8111-111111111111";
      const secondClientId = "22222222-2222-4222-8222-222222222222";
      await pool.query(
        `INSERT INTO ${schema}.clients (
           id, client_code, name, normalized_name_key, status, industry,
           created_by, updated_by, version
         ) VALUES ($1, 'CL-ABCD1234', 'Cherry Hill Test', 'cherry hill test',
           'active', 'flooring', 'actor-1', 'actor-1', $2)`,
        [clientId, "9007199254740991"],
      );
      await pool.query(
        `INSERT INTO ${schema}.clients (
           id, client_code, name, normalized_name_key, status,
           created_by, updated_by
         ) VALUES ($1, 'CL-EFGH5678', 'Second Test', 'second test',
           'prospect', 'actor-1', 'actor-1')`,
        [secondClientId],
      );

      const bigintResult = await pool.query(
        `SELECT version::text AS version FROM ${schema}.clients WHERE id = $1`,
        [clientId],
      );
      assert.equal(bigintResult.rows[0].version, "9007199254740991");

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.clients (
             id, client_code, name, normalized_name_key, status,
             created_by, updated_by
           ) VALUES ($1, 'CL-IJKL9012', 'Duplicate Name', 'cherry hill test',
             'active', 'actor-1', 'actor-1')`,
          ["33333333-3333-4333-8333-333333333333"],
        ),
        "23505",
        "clients_normalized_name_key_key",
      );
      await expectPostgresError(
        pool.query(
          `UPDATE ${schema}.clients SET status = 'unknown' WHERE id = $1`,
          [clientId],
        ),
        "23514",
        "clients_status_check",
      );

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.contacts (
             id, client_id, name, role
           ) VALUES ($1, $2, 'Missing client', 'Primary contact')`,
          [
            "44444444-4444-4444-8444-444444444444",
            "99999999-9999-4999-8999-999999999999",
          ],
        ),
        "23503",
        "contacts_client_id_fkey",
      );

      const projectId = "55555555-5555-4555-8555-555555555555";
      await pool.query(
        `INSERT INTO ${schema}.projects (
           id, project_number, client_id, name, status, estimated_value,
           created_by, updated_by
         ) VALUES ($1, 'CF-2026-ABCD1234', $2, 'Test Project', 'planning',
           9007199254740991, 'actor-1', 'actor-1')`,
        [projectId, clientId],
      );
      const estimatedValue = await pool.query(
        `SELECT estimated_value::text AS estimated_value
         FROM ${schema}.projects WHERE id = $1`,
        [projectId],
      );
      assert.equal(estimatedValue.rows[0].estimated_value, "9007199254740991");

      const leadId = randomUUID();
      await pool.query(
        `INSERT INTO ${schema}.leads (
           id, lead_number, company, contact_name, project_name, source, stage,
           site, estimated_value, next_action, owner_email, status,
           created_by, updated_by
         ) VALUES ($1, $2, 'FCI TEST — DO NOT USE', 'Test Contact',
           'FCI TEST — DO NOT USE Project', 'Referral', 'Qualified',
           'FCI TEST — DO NOT USE Site', 125000, 'Schedule site walk',
           'owner@example.test', 'active', 'actor-1', 'actor-1')`,
        [leadId, `L-2026-${leadId.replaceAll("-", "").slice(0, 8).toUpperCase()}`],
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.leads (
             id, lead_number, company, contact_name, project_name, source, stage,
             site, estimated_value, next_action, owner_email, status,
             created_by, updated_by
           ) VALUES ($1, $2, 'FCI TEST — DO NOT USE', 'Test Contact',
             'FCI TEST — DO NOT USE Project', 'Referral', 'Qualified',
             'FCI TEST — DO NOT USE Site', -1, 'Schedule site walk',
             'owner@example.test', 'active', 'actor-1', 'actor-1')`,
          [randomUUID(), `L-2026-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`],
        ),
        "23514",
        "leads_estimated_value_check",
      );

      const meetingId = randomUUID();
      await pool.query(
        `INSERT INTO ${schema}.project_meetings (
           id, project_id, title, meeting_at, meeting_type, source_provider,
           source_url, attendees, notes, action_items, created_by
         ) VALUES ($1, $2, 'FCI TEST — DO NOT USE kickoff', now(), 'client',
           'otter', 'https://otter.ai/u/fci-test', '["Test Contact"]'::jsonb,
           'FCI TEST — DO NOT USE notes', '["Schedule site walk"]'::jsonb, 'actor-1')`,
        [meetingId, projectId],
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.project_meetings (
             id, project_id, title, meeting_at, meeting_type, source_provider,
             attendees, action_items, created_by
           ) VALUES ($1, $2, 'FCI TEST — DO NOT USE empty evidence', now(),
             'internal', 'manual', '[]'::jsonb, '[]'::jsonb, 'actor-1')`,
          [randomUUID(), projectId],
        ),
        "23514",
        "project_meetings_evidence_check",
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.project_meetings (
             id, project_id, title, meeting_at, meeting_type, source_provider,
             attendees, notes, action_items, created_by
           ) VALUES ($1, $2, 'FCI TEST — DO NOT USE invalid attendees', now(),
             'internal', 'manual', '[1]'::jsonb, 'Test notes', '[]'::jsonb, 'actor-1')`,
          [randomUUID(), projectId],
        ),
        "23514",
        "project_meetings_attendees_check",
      );

      for (const invalidValue of ["-1", "12.5", "9007199254740992"]) {
        await expectPostgresError(
          pool.query(
            `INSERT INTO ${schema}.projects (
               id, project_number, client_id, name, status, estimated_value,
               created_by, updated_by
             ) VALUES ($1, $2, $3, 'Invalid Value', 'planning', $4,
               'actor-1', 'actor-1')`,
            [randomUUID(), `CF-2026-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`, clientId, invalidValue],
          ),
          "23514",
          "projects_estimated_value_check",
        );
      }

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.activity_events (
             id, action, actor_id, correlation_id, result, detail
           ) VALUES ($1, 'orphan event', 'actor-1', 'request-1', 'succeeded', '{}'::jsonb)`,
          [randomUUID()],
        ),
        "23514",
        "activity_events_record_check",
      );
      await pool.query(
        `INSERT INTO ${schema}.activity_events (
           id, project_id, action, actor_id, correlation_id, result, detail
         ) VALUES ($1, $2, 'Project created', 'actor-1', 'request-2',
           'succeeded', '{"source":"api"}'::jsonb)`,
        ["77777777-7777-4777-8777-777777777777", projectId],
      );
      await expectPostgresError(
        pool.query(
          `UPDATE ${schema}.activity_events SET action = 'changed' WHERE id = $1`,
          ["77777777-7777-4777-8777-777777777777"],
        ),
        "55000",
      );

      const idempotencyId = "66666666-6666-4666-8666-666666666666";
      const idempotencyValues = [
        idempotencyId,
        "actor-1",
        "clients.create",
        "retry-key",
        `sha256:${"a".repeat(64)}`,
      ];
      const firstIdempotency = await pool.query(
        `INSERT INTO ${schema}.idempotency_requests (
           id, actor_id, operation, idempotency_key, request_fingerprint, expires_at
         ) VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')
         ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
         RETURNING id`,
        idempotencyValues,
      );
      const retryIdempotency = await pool.query(
        `INSERT INTO ${schema}.idempotency_requests (
           id, actor_id, operation, idempotency_key, request_fingerprint, expires_at
         ) VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')
         ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
         RETURNING id`,
        [randomUUID(), ...idempotencyValues.slice(1)],
      );
      assert.equal(firstIdempotency.rowCount, 1);
      assert.equal(retryIdempotency.rowCount, 0);
      await pool.query(
        `INSERT INTO ${schema}.idempotency_requests (
           id, actor_id, operation, idempotency_key, request_fingerprint, expires_at
         ) VALUES ($1, 'actor-2', 'clients.create', 'retry-key', $2,
           now() + interval '1 hour')`,
        [randomUUID(), `sha256:${"a".repeat(64)}`],
      );

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.outbox_events (
             id, event_key, event_type, project_id, actor_id, correlation_id, payload
           ) VALUES ($1, 'client-created-wrong-target', 'client.created', $2,
             'actor-1', 'request-wrong-client', '{}'::jsonb)`,
          [randomUUID(), projectId],
        ),
        "23514",
        "outbox_events_type_record_check",
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.outbox_events (
             id, event_key, event_type, client_id, actor_id, correlation_id, payload
           ) VALUES ($1, 'project-created-wrong-target', 'project.created', $2,
             'actor-1', 'request-wrong-project', '{}'::jsonb)`,
          [randomUUID(), clientId],
        ),
        "23514",
        "outbox_events_type_record_check",
      );

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.outbox_events (
             id, event_key, event_type, project_id, actor_id, correlation_id, payload
           ) VALUES ($1, 'project-created-invalid', 'project.created', $2,
             'actor-1', 'request-3', '[]'::jsonb)`,
          [randomUUID(), projectId],
        ),
        "23514",
        "outbox_events_payload_check",
      );
      await pool.query(
        `INSERT INTO ${schema}.outbox_events (
           id, event_key, event_type, project_id, actor_id, correlation_id, payload
         ) VALUES ($1, 'project-created-1', 'project.created', $2,
           'actor-1', 'request-4', '{"projectId":"${projectId}"}'::jsonb)`,
        [randomUUID(), projectId],
      );

      const pendingIndex = await pool.query(
        `SELECT pg_get_expr(indexprs, indrelid) AS expressions,
                pg_get_expr(indpred, indrelid) AS predicate
         FROM pg_index
         WHERE indexrelid = '${schema}.outbox_events_pending_available_idx'::regclass`,
      );
      assert.match(pendingIndex.rows[0].predicate, /status = 'pending'/);

      const expiredLeaseIndex = await pool.query(
        `SELECT pg_get_expr(indpred, indrelid) AS predicate
         FROM pg_index
         WHERE indexrelid = '${schema}.outbox_events_expired_lease_idx'::regclass`,
      );
      assert.match(expiredLeaseIndex.rows[0].predicate, /status = 'processing'/);

      const firstUserId = randomUUID();
      const secondUserId = randomUUID();
      for (const [id, email, name] of [
        [firstUserId, "fci-test-one@example.com", "FCI TEST — DO NOT USE One"],
        [secondUserId, "fci-test-two@example.com", "FCI TEST — DO NOT USE Two"],
      ]) {
        await pool.query(
          `INSERT INTO ${schema}.users (
             id, email, email_key, display_name, status,
             authorization_version, sessions_valid_after,
             created_at, updated_at, version
           ) VALUES ($1, $2, lower($2), $3, 'active', 1, now(), now(), now(), 1)`,
          [id, email, name],
        );
      }
      await pool.query(
        `INSERT INTO ${schema}.external_identities (
           id, user_id, provider, issuer, subject, email, hosted_domain,
           email_verified, first_seen_at, last_authenticated_at, updated_at, version
         ) VALUES ($1, $2, 'google', 'https://accounts.google.com', 'stable-subject',
           'old-address@example.com', 'example.com', true, now(), now(), now(), 1)`,
        [randomUUID(), firstUserId],
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.external_identities (
             id, user_id, provider, issuer, subject, email, hosted_domain,
             email_verified, first_seen_at, last_authenticated_at, updated_at, version
           ) VALUES ($1, $2, 'google', 'https://accounts.google.com', 'stable-subject',
             'changed-address@example.com', 'example.com', true, now(), now(), now(), 1)`,
          [randomUUID(), secondUserId],
        ),
        "23505",
        "external_identities_issuer_subject_key",
      );

      await pool.query(
        `INSERT INTO ${schema}.user_roles (
           user_id, role_id, assigned_by_user_id, assigned_by_actor_key, assigned_at
         ) VALUES ($1, $2, $1, 'user:admin-access-test', now())`,
        [firstUserId, ADMIN_ACCESS_ROLE_CATALOG[0].id],
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.user_roles (
             user_id, role_id, assigned_by_user_id, assigned_by_actor_key, assigned_at
           ) VALUES ($1, $2, $1, 'user:admin-access-test', now())`,
          [firstUserId, ADMIN_ACCESS_ROLE_CATALOG[1].id],
        ),
        "23505",
        "user_roles_one_role_per_user_idx",
      );
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.user_roles (
             user_id, role_id, assigned_by_user_id, assigned_by_actor_key,
             assigned_at, expires_at
           ) VALUES ($1, $2, $3, 'user:admin-access-test', now(), now() + interval '1 day')`,
          [secondUserId, ADMIN_ACCESS_ROLE_CATALOG[2].id, firstUserId],
        ),
        "23514",
        "user_roles_permanent_check",
      );
      await pool.query(
        `INSERT INTO ${schema}.user_roles (
           user_id, role_id, assigned_by_user_id, assigned_by_actor_key, assigned_at
         ) VALUES ($1, $2, $3, 'user:admin-access-test', now())`,
        [secondUserId, ADMIN_ACCESS_ROLE_CATALOG[2].id, firstUserId],
      );

      await pool.query(
        `INSERT INTO ${schema}.project_memberships (
           project_id, user_id, assigned_by_user_id, assigned_by_actor_key, assigned_at
         ) VALUES ($1, $2, $3, 'user:admin-access-test', now())`,
        [projectId, secondUserId, firstUserId],
      );
      await expectPostgresError(
        pool.query(
          `UPDATE ${schema}.project_memberships
           SET revoked_by_user_id = $3,
               revoked_by_actor_key = 'user:admin-access-test',
               revoked_at = now(), revocation_reason_code = 'role_changed'
           WHERE project_id = $1 AND user_id = $2`,
          [projectId, secondUserId, firstUserId],
        ),
        "23514",
        "project_memberships_revocation_evidence_check",
      );
      await pool.query(
        `UPDATE ${schema}.project_memberships
         SET status = 'revoked', revoked_by_user_id = $3,
             revoked_by_actor_key = 'user:admin-access-test',
             revoked_at = now(), revocation_reason_code = 'role_changed',
             version = version + 1
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, secondUserId, firstUserId],
      );
      const revokedMembership = await pool.query(
        `SELECT status, version::text AS version
         FROM ${schema}.project_memberships
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, secondUserId],
      );
      assert.deepEqual(revokedMembership.rows, [{ status: "revoked", version: "2" }]);
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.project_memberships (
             project_id, user_id, assigned_by_user_id, assigned_by_actor_key,
             assigned_at, expires_at
           ) VALUES ($1, $2, $2, 'user:admin-access-test', now(), now() + interval '1 day')`,
          [projectId, firstUserId],
        ),
        "23514",
        "project_memberships_permanent_check",
      );

      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.invitations (
             id, email, email_key, token_hash, status,
             invited_by_actor_key, expires_at, purge_after, created_at, updated_at,
             role_id
           ) VALUES ($1, 'test@example.com', 'test@example.com', 'plaintext-token',
             'pending', 'system', now() + interval '1 hour',
             now() + interval '2 hours', now(), now(), $2)`,
          [randomUUID(), ADMIN_ACCESS_ROLE_CATALOG[2].id],
        ),
        "23514",
        "invitations_token_hash_check",
      );

      const auditId = randomUUID();
      await pool.query(
        `INSERT INTO ${schema}.audit_events (
           id, executor_type, executor_key, action, result,
           correlation_id, source, metadata, occurred_at,
           retention_policy_key
         ) VALUES ($1, 'system', 'migration-test', 'security.persistence_test',
           'succeeded', 'persistence-test', 'integration_test',
           '{"fixture":"FCI TEST — DO NOT USE"}'::jsonb, now(), 'security_audit')`,
        [auditId],
      );
      await expectPostgresError(
        pool.query(`UPDATE ${schema}.audit_events SET result = 'failed' WHERE id = $1`, [auditId]),
        "55000",
      );
      await expectPostgresError(
        pool.query(`DELETE FROM ${schema}.audit_events WHERE id = $1`, [auditId]),
        "55000",
      );

      const connectionId = randomUUID();
      await pool.query(
        `INSERT INTO ${schema}.integration_connections (
           id, provider, connection_key, status,
           created_by_actor_key, updated_by_actor_key,
           created_at, updated_at, version
         ) VALUES ($1, 'google_workspace', 'company_workspace', 'pending',
           'migration-test', 'migration-test', now(), now(), 1)`,
        [connectionId],
      );
      const integrationEventId = randomUUID();
      await pool.query(
        `INSERT INTO ${schema}.integration_events (
           id, connection_id, event_key, event_type,
           executor_type, executor_key, result, correlation_id,
           metadata, occurred_at, retention_policy_key
         ) VALUES ($1, $2, 'connection-created', 'connection.registered',
           'system', 'migration-test', 'succeeded', 'connector-test',
           '{}'::jsonb, now(), 'integration_event')`,
        [integrationEventId, connectionId],
      );
      await expectPostgresError(
        pool.query(`DELETE FROM ${schema}.integration_events WHERE id = $1`, [integrationEventId]),
        "55000",
      );

      const fileId = randomUUID();
      const fileVersionId = randomUUID();
      const fileClient = await pool.connect();
      try {
        await fileClient.query("BEGIN");
        await fileClient.query(
          `INSERT INTO ${schema}.files (
             id, category, status, current_version_number,
             retention_policy_key, created_by_actor_key,
             created_at, updated_at, version
           ) VALUES ($1, 'project_document', 'active', 1,
             'business_record', 'migration-test', now(), now(), 1)`,
          [fileId],
        );
        await fileClient.query(
          `INSERT INTO ${schema}.file_versions (
             id, file_id, version_number, status, source_key,
             original_filename, declared_media_type,
             created_by_actor_key, created_at, updated_at, row_version
           ) VALUES ($1, $2, 1, 'registered', $3,
             'FCI TEST — DO NOT USE.pdf', 'application/pdf',
             'migration-test', now(), now(), 1)`,
          [fileVersionId, fileId, `file/${fileId}`],
        );
        await fileClient.query("COMMIT");
      } catch (error) {
        await fileClient.query("ROLLBACK");
        throw error;
      } finally {
        fileClient.release();
      }
      await expectPostgresError(
        pool.query(
          `INSERT INTO ${schema}.file_links (
             id, file_id, relationship_key, linked_by_actor_key, linked_at
           ) VALUES ($1, $2, 'project_document', 'migration-test', now())`,
          [randomUUID(), fileId],
        ),
        "23514",
        "file_links_target_check",
      );

      const missingForeignKeyIndexes = await pool.query(
        `SELECT c.conname
         FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.connamespace = $1::regnamespace
           AND NOT EXISTS (
             SELECT 1
             FROM pg_index i
             WHERE i.indrelid = c.conrelid
               AND i.indisvalid
               AND i.indisready
               AND i.indnkeyatts >= cardinality(c.conkey)
               AND NOT EXISTS (
                 SELECT 1
                 FROM generate_subscripts(c.conkey, 1) AS key_position
                 WHERE c.conkey[key_position]
                   <> (i.indkey::smallint[])[key_position - 1]
               )
           )`,
        [schema],
      );
      assert.deepEqual(missingForeignKeyIndexes.rows, []);

      const rollbackProbe = {
        version: 7,
        name: "rollback_probe",
        checksum: "",
        statements: [
          "CREATE TABLE rollback_probe (id integer CONSTRAINT rollback_probe_pkey PRIMARY KEY)",
          "SELECT * FROM relation_that_does_not_exist",
        ],
      };
      rollbackProbe.checksum = calculateProductionMigrationChecksum(rollbackProbe);
      await assert.rejects(
        runProductionSchemaMigrations(
          pool,
          [...PRODUCTION_SCHEMA_MIGRATIONS, rollbackProbe],
          migrationOptions,
        ),
        /migration 7 \(rollback_probe\) did not complete cleanly/,
      );
      const rollbackState = await pool.query(
        `SELECT to_regclass('${schema}.rollback_probe') AS relation,
                (SELECT count(*)::integer
                 FROM ${schema}.production_schema_migrations) AS migration_count`,
      );
      assert.equal(rollbackState.rows[0].relation, null);
      assert.equal(rollbackState.rows[0].migration_count, 6);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);

test(
  "PostgreSQL 16 migration search path prevents a reused session's temp history shadow",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 30_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 1 });
    const schema = `fci_shadow_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const client = await pool.connect();
    try {
      await client.query(
        `CREATE TEMP TABLE production_schema_migrations (
           version integer PRIMARY KEY,
           name text NOT NULL,
           checksum text NOT NULL
         )`,
      );
    } finally {
      client.release();
    }

    try {
      const result = await runProductionSchemaMigrations(
        pool,
        PRODUCTION_SCHEMA_MIGRATIONS,
        { schema },
      );
      assert.deepEqual(result, { appliedVersions: [1, 2, 3, 4, 5, 6], currentVersion: 6 });

      const targetHistory = await pool.query(
        `SELECT count(*)::integer AS count FROM ${schema}.production_schema_migrations`,
      );
      const temporaryHistory = await pool.query(
        "SELECT count(*)::integer AS count FROM pg_temp.production_schema_migrations",
      );
      assert.equal(targetHistory.rows[0].count, 6);
      assert.equal(temporaryHistory.rows[0].count, 0);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);
