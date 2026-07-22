import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import { ADMIN_ACCESS_ROLE_CATALOG } from "../app/platform/postgres/admin-access-persistence-schema.ts";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const vite = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  cacheDir: "work/vite-tests/postgres-employee-login-integration",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24728 } },
});
const [identityModule, authorizationModule, auditModule, serviceModule] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/postgres/identity-persistence-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/authorization-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/security-audit-repository.ts"),
  vite.ssrLoadModule("/app/application/authorization-service.ts"),
]);
const { createPostgresIdentityPersistenceRepository } = identityModule;
const { createPostgresAuthorizationRepository } = authorizationModule;
const { createPostgresSecurityAuditRepository } = auditModule;
const { createAuthorizationService } = serviceModule;

after(async () => {
  await vite.close();
});

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const IDLE_LIFETIME = 30 * MINUTE;
const ABSOLUTE_LIFETIME = 8 * 60 * MINUTE;
const EMAIL = "oidc03-integration@cherryhillfci.com";
const SUBJECT = "fci-test-oidc03-google-subject";
const APPLICATION_NAME = "fci_oidc03_employee_login";

function hash(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function auditEvent(id, correlationId, occurredAt) {
  return {
    id,
    executorType: "anonymous",
    executorUserId: null,
    executorKey: "anonymous",
    originatingUserId: null,
    originatingActorKey: null,
    action: "identity.login_failed",
    targetType: "login_attempt",
    targetId: correlationId,
    result: "denied",
    reasonCode: "login_not_authorized",
    requestId: randomUUID(),
    correlationId,
    source: "employee_oidc_callback",
    metadata: { fixture: "FCI TEST — DO NOT USE" },
    occurredAt,
    retentionPolicyKey: "security_audit",
    retentionUntil: null,
  };
}

function authenticationIntent(label, issuedAt, invitationTokenHash) {
  const correlationId = randomUUID();
  const sessionId = randomUUID();
  return {
    identity: {
      provider: "google_oidc",
      issuer: "https://accounts.google.com",
      subject: SUBJECT,
      email: EMAIL,
      hostedDomain: "cherryhillfci.com",
      emailVerified: true,
      displayName: "FCI TEST — DO NOT USE OIDC-03 Employee",
    },
    invitationTokenHash,
    newUserId: randomUUID(),
    newExternalIdentityId: randomUUID(),
    session: {
      id: sessionId,
      tokenHash: hash(`${label}:session:${sessionId}`),
      csrfHash: hash(`${label}:csrf:${sessionId}`),
      issuedAt,
      idleExpiresAt: issuedAt + IDLE_LIFETIME,
      absoluteExpiresAt: issuedAt + ABSOLUTE_LIFETIME,
      purgeAfter: issuedAt + ABSOLUTE_LIFETIME + 7 * DAY,
    },
    loginAudit: auditEvent(randomUUID(), correlationId, issuedAt),
    invitationAudit: auditEvent(randomUUID(), correlationId, issuedAt),
  };
}

async function waitForInvitationLockWaiters(pool, applicationName, expectedCount = 2) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(
      `SELECT pg_catalog.count(*)::integer AS count
       FROM pg_catalog.pg_stat_activity
       WHERE datname = pg_catalog.current_database()
         AND application_name = $1
         AND pid <> pg_catalog.pg_backend_pid()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND query LIKE $2`,
      [applicationName, "%SELECT invitation.id::text AS invitation_id%"],
    );
    if (waiting.rows[0]?.count === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`expected ${expectedCount} employee-login transactions to wait on the invitation lock`);
}

async function raceInvitationRedemption(
  pool,
  schema,
  repository,
  tokenHash,
  intents,
  applicationName,
) {
  const blocker = await pool.connect();
  let transactionOpen = false;
  let raceSettled = Promise.resolve([]);
  let primaryError = null;
  try {
    await blocker.query("BEGIN");
    transactionOpen = true;
    await blocker.query(
      `SELECT id FROM ${schema}.invitations WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const racePromises = intents.map(async (intent) => ({
      intent,
      result: await repository.authenticateEmployeeSession(intent),
    }));
    raceSettled = Promise.allSettled(racePromises);
    await waitForInvitationLockWaiters(pool, applicationName);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (transactionOpen) await blocker.query(primaryError ? "ROLLBACK" : "COMMIT");
    } catch (error) {
      primaryError ??= error;
    } finally {
      blocker.release(primaryError instanceof Error ? primaryError : undefined);
    }
  }

  const settled = await raceSettled;
  if (primaryError) throw primaryError;
  const rejected = settled.find((entry) => entry.status === "rejected");
  if (rejected) throw rejected.reason;
  return settled.map((entry) => entry.value);
}

async function expectDeniedDashboard(service, tokenHash, reason) {
  const result = await service.performDashboardView({
    tokenHash,
    requestId: randomUUID(),
    correlationId: randomUUID(),
  }, async () => {
    assert.fail(`protected dashboard work ran for ${reason}`);
  });
  assert.deepEqual(result, { allowed: false, reason });
}

test(
  "real PostgreSQL consumes one raced invitation and enforces idle, absolute, and logout session endings",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 90_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const runId = randomUUID().replaceAll("-", "");
    const applicationName = `${APPLICATION_NAME}_${runId}`;
    const pool = new Pool({
      connectionString: postgresTestUrl,
      application_name: applicationName,
      max: 6,
    });
    const schema = `fci_employee_login_${runId}`;
    let schemaCreated = false;

    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema });

      const officeRole = ADMIN_ACCESS_ROLE_CATALOG.find(
        ({ key }) => key === "office_operations",
      );
      assert.ok(officeRole);
      const invitationId = randomUUID();
      const invitationTokenHash = hash("oidc03:invitation");
      await pool.query(
        `INSERT INTO ${schema}.invitations (
           id, email, email_key, token_hash, role_id, status,
           invited_by_user_id, invited_by_actor_key, expires_at, purge_after,
           created_at, updated_at, version
         ) VALUES ($1, $2, $2, $3, $4, 'pending', NULL,
           'system:oidc03_integration', $5, $6, $7, $7, 1)`,
        [
          invitationId,
          EMAIL,
          invitationTokenHash,
          officeRole.id,
          new Date(NOW + 6 * DAY),
          new Date(NOW + 13 * DAY),
          new Date(NOW - DAY),
        ],
      );

      const identity = createPostgresIdentityPersistenceRepository(pool, { schema });
      const raceIntents = [
        authenticationIntent("race-a", NOW, invitationTokenHash),
        authenticationIntent("race-b", NOW, invitationTokenHash),
      ];

      // Holding the row until both transactions report a lock wait makes the
      // FOR UPDATE proof independent of which Promise the JavaScript scheduler starts first.
      const raced = await raceInvitationRedemption(
        pool,
        schema,
        identity,
        invitationTokenHash,
        raceIntents,
        applicationName,
      );
      assert.deepEqual(raced.map(({ result }) =>
        result.outcome === "denied" ? `denied:${result.reason}` : result.outcome).sort(), [
        "accepted",
        "denied:invitation_invalid",
      ]);
      const acceptedRace = raced.find(({ result }) => result.outcome === "accepted");
      assert.ok(acceptedRace);
      assert.equal(acceptedRace.result.invitationRedeemed, true);

      const raceState = await pool.query(
        `SELECT
           (SELECT pg_catalog.count(*)::integer FROM ${schema}.users) AS users,
           (SELECT pg_catalog.count(*)::integer FROM ${schema}.external_identities) AS identities,
           (SELECT pg_catalog.count(*)::integer FROM ${schema}.user_roles) AS roles,
           (SELECT pg_catalog.count(*)::integer FROM ${schema}.sessions) AS sessions,
           invitation.status,
           invitation.token_hash,
           invitation.accepted_user_id::text AS accepted_user_id
         FROM ${schema}.invitations AS invitation
         WHERE invitation.id = $1`,
        [invitationId],
      );
      assert.deepEqual(raceState.rows, [{
        users: 1,
        identities: 1,
        roles: 1,
        sessions: 1,
        status: "accepted",
        token_hash: null,
        accepted_user_id: acceptedRace.result.userId,
      }]);

      const absoluteIntent = authenticationIntent("absolute", NOW + 1_000, null);
      const logoutIntent = authenticationIntent("logout", NOW + 2_000, null);
      for (const intent of [absoluteIntent, logoutIntent]) {
        assert.deepEqual(await identity.authenticateEmployeeSession(intent), {
          outcome: "accepted",
          userId: acceptedRace.result.userId,
          email: EMAIL,
          authorizationVersion: "1",
          sessionVersion: "1",
          invitationRedeemed: false,
        });
      }

      const authorization = createPostgresAuthorizationRepository(pool, { schema });
      const securityAudit = createPostgresSecurityAuditRepository(pool, { schema });
      let checkedAt = NOW + 3_000;
      const service = createAuthorizationService({
        repository: authorization,
        sessions: identity,
        audit: securityAudit,
        now: () => checkedAt,
        newId: randomUUID,
      });

      assert.deepEqual(await service.logoutSession({
        tokenHash: logoutIntent.session.tokenHash,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      }), { outcome: "logged_out" });
      await expectDeniedDashboard(service, logoutIntent.session.tokenHash, "invalid_session");

      checkedAt = acceptedRace.intent.session.idleExpiresAt;
      await expectDeniedDashboard(service, acceptedRace.intent.session.tokenHash, "idle_expired");

      checkedAt = absoluteIntent.session.absoluteExpiresAt;
      await expectDeniedDashboard(service, absoluteIntent.session.tokenHash, "absolute_expired");

      const sessionState = await pool.query(
        `SELECT id::text AS id, token_hash, csrf_hash,
                revoked_at IS NOT NULL AS revoked,
                revocation_reason_code, version::text AS version
         FROM ${schema}.sessions
         ORDER BY id`,
      );
      assert.equal(sessionState.rows.length, 3);
      const loggedOut = sessionState.rows.find(({ id }) => id === logoutIntent.session.id);
      assert.deepEqual(loggedOut, {
        id: logoutIntent.session.id,
        token_hash: null,
        csrf_hash: null,
        revoked: true,
        revocation_reason_code: "logout",
        version: "2",
      });

      const denialAudit = await pool.query(
        `SELECT reason_code
         FROM ${schema}.audit_events
         WHERE reason_code = ANY($1::text[])`,
        [["invitation_invalid", "invalid_session", "idle_expired", "absolute_expired"]],
      );
      assert.deepEqual(denialAudit.rows.map(({ reason_code }) => reason_code).sort(), [
        "absolute_expired",
        "idle_expired",
        "invalid_session",
        "invitation_invalid",
      ]);

      const logoutAudit = await pool.query(
        `SELECT action, target_type, target_id, result, reason_code, metadata
         FROM ${schema}.audit_events
         WHERE action = 'identity.session_revoked' AND target_id = $1`,
        [logoutIntent.session.id],
      );
      assert.deepEqual(logoutAudit.rows, [{
        action: "identity.session_revoked",
        target_type: "session",
        target_id: logoutIntent.session.id,
        result: "succeeded",
        reason_code: null,
        metadata: { trigger: "user_logout" },
      }]);
    } finally {
      try {
        if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await pool.end();
      }
    }
  },
);
