import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import {
  ADMIN_ACCESS_ROLE_CATALOG,
} from "../app/platform/postgres/admin-access-persistence-schema.ts";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/postgres-authorization-integration",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24692 } },
});
const { createPostgresAuthorizationRepository } = await vite.ssrLoadModule(
  "/app/adapters/postgres/authorization-repository.ts",
);

after(async () => {
  await vite.close();
});

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();

function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

function clientCode(id) {
  return `CL-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function projectNumber(id) {
  return `CF-2026-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function sortedIds(records) {
  return records.map(({ id }) => id).sort();
}

function assertNoFinancialProjection(records) {
  assert.ok(records.every(({ financialVisible }) => financialVisible === false));
  assert.ok(records.every((record) => !Object.hasOwn(record, "estimatedValue")));
}

async function seedAuthorizationFixture(pool, schema, now) {
  const createdAt = new Date(now - 3 * 24 * 60 * 60_000);
  const assignedAt = new Date(now - 2 * 60 * 60_000);
  const ids = {
    adminUser: randomUUID(),
    officeUser: randomUUID(),
    projectManagerUser: randomUUID(),
    administratorRole: ADMIN_ACCESS_ROLE_CATALOG[0].id,
    officeRole: ADMIN_ACCESS_ROLE_CATALOG[1].id,
    projectManagerRole: ADMIN_ACCESS_ROLE_CATALOG[2].id,
    adminSession: randomUUID(),
    officeSession: randomUUID(),
    projectManagerSession: randomUUID(),
    clientA: randomUUID(),
    clientB: randomUUID(),
    contactA: randomUUID(),
    contactB: randomUUID(),
    projectA: randomUUID(),
    projectB: randomUUID(),
  };
  const emails = {
    admin: "admincrm@cherryhillfci.com",
    office: "office-test@cherryhillfci.com",
    projectManager: "pm-test@cherryhillfci.com",
  };

  await pool.query(
    `INSERT INTO ${schema}.users (
       id, email, email_key, display_name, status, authorization_version,
       sessions_valid_after, created_at, updated_at
     ) VALUES
       ($1, $2, $2, 'FCI TEST — DO NOT USE Administrator', 'active', 1, $7, $7, $8),
       ($3, $4, $4, 'FCI TEST — DO NOT USE Office', 'active', 1, $7, $7, $8),
       ($5, $6, $6, 'FCI TEST — DO NOT USE Project Manager', 'active', 1, $7, $7, $8)`,
    [
      ids.adminUser,
      emails.admin,
      ids.officeUser,
      emails.office,
      ids.projectManagerUser,
      emails.projectManager,
      createdAt,
      new Date(now),
    ],
  );

  await pool.query(
    `INSERT INTO ${schema}.user_roles (
       user_id, role_id, assigned_by_user_id, assigned_by_actor_key, assigned_at
     ) VALUES
       ($1, $4, $1, 'user:authorization-integration-admin', $7),
       ($2, $5, $1, 'user:authorization-integration-admin', $7),
       ($3, $6, $1, 'user:authorization-integration-admin', $7)`,
    [
      ids.adminUser,
      ids.officeUser,
      ids.projectManagerUser,
      ids.administratorRole,
      ids.officeRole,
      ids.projectManagerRole,
      assignedAt,
    ],
  );

  const issuedAt = new Date(now - 60 * 60_000);
  const lastSeenAt = new Date(now - 5 * 60_000);
  const idleExpiresAt = new Date(now + 30 * 60_000);
  const absoluteExpiresAt = new Date(now + 8 * 60 * 60_000);
  const purgeAfter = new Date(now + 9 * 60 * 60_000);
  await pool.query(
    `INSERT INTO ${schema}.sessions (
       id, user_id, token_hash, csrf_hash, authorization_version,
       issued_at, last_seen_at, idle_expires_at, absolute_expires_at, purge_after
     ) VALUES
       ($1, $2, $7, $10, 1, $13, $14, $15, $16, $17),
       ($3, $4, $8, $11, 1, $13, $14, $15, $16, $17),
       ($5, $6, $9, $12, 1, $13, $14, $15, $16, $17)`,
    [
      ids.adminSession,
      ids.adminUser,
      ids.officeSession,
      ids.officeUser,
      ids.projectManagerSession,
      ids.projectManagerUser,
      hash("a"),
      hash("b"),
      hash("c"),
      hash("d"),
      hash("e"),
      hash("f"),
      issuedAt,
      lastSeenAt,
      idleExpiresAt,
      absoluteExpiresAt,
      purgeAfter,
    ],
  );

  await pool.query(
    `INSERT INTO ${schema}.clients (
       id, client_code, name, normalized_name_key, status,
       created_by, updated_by, created_at, updated_at
     ) VALUES
       ($1, $3, 'FCI TEST — DO NOT USE Client A', 'fci test — do not use client a',
        'active', $5, $5, $6, $7),
       ($2, $4, 'FCI TEST — DO NOT USE Client B', 'fci test — do not use client b',
        'active', $5, $5, $6, $7)`,
    [
      ids.clientA,
      ids.clientB,
      clientCode(ids.clientA),
      clientCode(ids.clientB),
      emails.admin,
      createdAt,
      new Date(now),
    ],
  );
  await pool.query(
    `INSERT INTO ${schema}.contacts (
       id, client_id, name, email, role, is_primary, created_at, updated_at
     ) VALUES
       ($1, $3, 'FCI TEST — DO NOT USE Contact A', 'contact-a@example.test',
        'Primary contact', true, $5, $5),
       ($2, $4, 'FCI TEST — DO NOT USE Contact B', 'contact-b@example.test',
        'Primary contact', true, $5, $5)`,
    [ids.contactA, ids.contactB, ids.clientA, ids.clientB, createdAt],
  );
  await pool.query(
    `INSERT INTO ${schema}.projects (
       id, project_number, client_id, name, status, site, project_manager,
       estimated_value, created_by, updated_by, created_at, updated_at
     ) VALUES
       ($1, $3, $5, 'FCI TEST — DO NOT USE Project A', 'planning',
        'FCI TEST — DO NOT USE Site A', $7, 100000, $8, $8, $9, $10),
       ($2, $4, $6, 'FCI TEST — DO NOT USE Project B', 'completed',
        'FCI TEST — DO NOT USE Site B', $7, 250000, $8, $8, $9, $10)`,
    [
      ids.projectA,
      ids.projectB,
      projectNumber(ids.projectA),
      projectNumber(ids.projectB),
      ids.clientA,
      ids.clientB,
      emails.projectManager,
      emails.admin,
      createdAt,
      new Date(now),
    ],
  );

  await pool.query(
    `INSERT INTO ${schema}.project_memberships (
       project_id, user_id, assigned_by_user_id, assigned_by_actor_key,
       assigned_at, status, revoked_by_user_id, revoked_by_actor_key,
       revoked_at, revocation_reason_code
     ) VALUES
       ($1, $3, $4, 'user:authorization-integration-admin', $5,
        'active', NULL, NULL, NULL, NULL),
       ($2, $3, $4, 'user:authorization-integration-admin', $5,
        'revoked', $4, 'user:authorization-integration-admin', $6, 'assignment_removed')`,
    [
      ids.projectA,
      ids.projectB,
      ids.projectManagerUser,
      ids.adminUser,
      assignedAt,
      new Date(now - 60 * 60_000),
    ],
  );

  return { ids, emails };
}

test(
  "PostgreSQL authorization queries enforce project scope and financial separation",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 60_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 6 });
    const schema = `fci_authorization_${randomUUID().replaceAll("-", "")}`;
    let schemaCreated = false;

    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema });

      const now = Date.now();
      const { ids } = await seedAuthorizationFixture(pool, schema, now);
      const repository = createPostgresAuthorizationRepository(pool, { schema });
      const projectIds = [ids.projectA, ids.projectB].sort();
      const clientIds = [ids.clientA, ids.clientB].sort();
      const projectManagerScope = {
        kind: "assigned_projects",
        sessionId: ids.projectManagerSession,
        sessionVersion: "1",
        userId: ids.projectManagerUser,
        authorizationVersion: "1",
        includeFinancial: false,
      };
      const officeScope = {
        kind: "company",
        sessionId: ids.officeSession,
        sessionVersion: "1",
        userId: ids.officeUser,
        authorizationVersion: "1",
        includeFinancial: false,
      };
      const administratorScope = {
        kind: "company",
        sessionId: ids.adminSession,
        sessionVersion: "1",
        userId: ids.adminUser,
        authorizationVersion: "1",
        includeFinancial: true,
      };

      const [adminSession, officeSession, projectManagerSession] = await Promise.all([
        repository.findSessionByTokenHash(hash("a"), now),
        repository.findSessionByTokenHash(hash("b"), now),
        repository.findSessionByTokenHash(hash("c"), now),
      ]);
      assert.deepEqual(adminSession?.roleGrants, [{
        roleKey: "administrator",
        capabilityKeys: ["financials.read", "records.read"],
      }]);
      assert.deepEqual(officeSession?.roleGrants, [{
        roleKey: "office_operations",
        capabilityKeys: ["records.read"],
      }]);
      assert.deepEqual(projectManagerSession?.roleGrants, [{
        roleKey: "project_manager",
        capabilityKeys: ["records.read"],
      }]);
      assert.equal(
        await repository.sessionCsrfHashMatches(hash("a"), hash("d"), now),
        true,
      );
      assert.equal(
        await repository.sessionCsrfHashMatches(hash("a"), hash("e"), now),
        false,
      );

      const projectManagerProjects = await repository.listProjectsForScope(
        projectManagerScope,
        now,
        20,
      );
      assert.deepEqual(sortedIds(projectManagerProjects), [ids.projectA]);
      assertNoFinancialProjection(projectManagerProjects);

      const projectManagerSearch = await repository.searchProjectsForScope(
        projectManagerScope,
        "FCI TEST",
        now,
        20,
      );
      assert.deepEqual(sortedIds(projectManagerSearch), [ids.projectA]);
      assertNoFinancialProjection(projectManagerSearch);
      assert.deepEqual(
        sortedIds(await repository.listClientsForScope(projectManagerScope, now, 20)),
        [ids.clientA],
      );
      assert.equal(
        await repository.projectExistsForScope(projectManagerScope, ids.projectA, now),
        true,
      );
      assert.equal(
        await repository.projectExistsForScope(projectManagerScope, ids.projectB, now),
        false,
      );
      const exactAssignedProject = await repository.getProjectForScope(
        projectManagerScope,
        ids.projectA,
        now,
      );
      assert.equal(exactAssignedProject?.id, ids.projectA);
      assertNoFinancialProjection([exactAssignedProject]);
      assert.equal(
        await repository.getProjectForScope(projectManagerScope, ids.projectB, now),
        null,
      );
      assert.equal(
        await repository.capabilityIsCurrentForScope(
          projectManagerScope,
          "records.read",
          ids.projectA,
          now,
        ),
        true,
      );
      assert.equal(
        await repository.capabilityIsCurrentForScope(
          projectManagerScope,
          "records.read",
          ids.projectB,
          now,
        ),
        false,
      );
      assert.deepEqual(await repository.getDashboardForScope(projectManagerScope, now), {
        projectCount: 1,
        activeProjectCount: 1,
        completedProjectCount: 0,
        financialVisible: false,
      });

      const officeProjects = await repository.listProjectsForScope(officeScope, now, 20);
      assert.deepEqual(sortedIds(officeProjects), projectIds);
      assertNoFinancialProjection(officeProjects);
      assert.deepEqual(
        sortedIds(await repository.listClientsForScope(officeScope, now, 20)),
        clientIds,
      );
      assert.deepEqual(await repository.getDashboardForScope(officeScope, now), {
        projectCount: 2,
        activeProjectCount: 1,
        completedProjectCount: 1,
        financialVisible: false,
      });

      const administratorProjects = await repository.listProjectsForScope(
        administratorScope,
        now,
        20,
      );
      assert.deepEqual(sortedIds(administratorProjects), projectIds);
      assert.deepEqual(
        new Map(administratorProjects.map(({ id, estimatedValue }) => [id, estimatedValue])),
        new Map([
          [ids.projectA, 100000],
          [ids.projectB, 250000],
        ]),
      );
      assert.deepEqual(await repository.getDashboardForScope(administratorScope, now), {
        projectCount: 2,
        activeProjectCount: 1,
        completedProjectCount: 1,
        financialVisible: true,
        estimatedValueTotal: 350000,
      });
      assert.equal(
        await repository.capabilityIsCurrentForScope(
          administratorScope,
          "financials.read",
          null,
          now,
        ),
        true,
      );

      const forgedProjectManagerCompanyScope = {
        ...projectManagerScope,
        kind: "company",
      };
      assert.deepEqual(
        await repository.listProjectsForScope(forgedProjectManagerCompanyScope, now, 20),
        [],
      );

      const forgedOfficeFinancialScope = {
        ...officeScope,
        includeFinancial: true,
      };
      assert.deepEqual(
        await repository.listProjectsForScope(forgedOfficeFinancialScope, now, 20),
        [],
      );
      assert.equal(
        await repository.capabilityIsCurrentForScope(
          forgedOfficeFinancialScope,
          "financials.read",
          null,
          now,
        ),
        false,
      );

      const staleProjectManagerScope = {
        ...projectManagerScope,
        authorizationVersion: "2",
      };
      assert.deepEqual(
        await repository.listProjectsForScope(staleProjectManagerScope, now, 20),
        [],
      );
      assert.equal(
        await repository.projectExistsForScope(staleProjectManagerScope, ids.projectA, now),
        false,
      );

      await pool.query(
        `UPDATE ${schema}.sessions
         SET token_hash = NULL,
             csrf_hash = NULL,
             revoked_at = $2,
             revoked_by_actor_key = 'user:authorization-integration-admin',
             revocation_reason_code = 'authorization_integration_test',
             version = version + 1
         WHERE id = $1`,
        [ids.projectManagerSession, new Date(now)],
      );
      assert.deepEqual(
        await repository.listProjectsForScope(projectManagerScope, now, 20),
        [],
      );
      assert.equal(
        await repository.projectExistsForScope(projectManagerScope, ids.projectA, now),
        false,
      );
    } finally {
      try {
        if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await pool.end();
      }
    }
  },
);
