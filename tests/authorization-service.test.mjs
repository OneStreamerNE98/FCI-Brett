import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/authorization-service",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24702 } },
});

const {
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_OPERATIONS,
  AUTHORIZATION_ROLES,
  resolveFieldLinkAccess,
} = await vite.ssrLoadModule("/app/application/authorization-policy.ts");
const { createAuthorizationService } = await vite.ssrLoadModule(
  "/app/application/authorization-service.ts",
);

after(async () => {
  await vite.close();
});

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const CORRELATION_ID = "88888888-8888-4888-8888-888888888888";
const FIELD_LINK_ID = "99999999-9999-4999-8999-999999999999";

function sessionSnapshot(overrides = {}) {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    sessionVersion: "4",
    userId: "33333333-3333-4333-8333-333333333333",
    email: "admincrm@cherryhillfci.com",
    userStatus: "active",
    userAuthorizationVersion: "7",
    sessionAuthorizationVersion: "7",
    sessionsValidAfter: NOW - 10_000,
    issuedAt: NOW - 5_000,
    lastSeenAt: NOW - 1_000,
    idleExpiresAt: NOW + 30_000,
    absoluteExpiresAt: NOW + 60_000,
    revokedAt: null,
    roleGrants: [{
      roleKey: AUTHORIZATION_ROLES.administrator,
      capabilityKeys: Object.values(AUTHORIZATION_CAPABILITIES),
    }],
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    tokenHash: `sha256:${"a".repeat(64)}`,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

function fieldRequest(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

function harness(options = {}) {
  const audits = [];
  const capabilityChecks = [];
  const projectChecks = [];
  const timeline = [];
  const snapshot = options.snapshot === undefined ? sessionSnapshot() : options.snapshot;
  const repository = {
    async findSessionByTokenHash(tokenHash, checkedAt) {
      assert.equal(tokenHash, request().tokenHash);
      assert.equal(checkedAt, NOW);
      timeline.push("session");
      return snapshot;
    },
    async sessionCsrfHashMatches() { throw new Error("not used"); },
    async projectExistsForScope(scope, projectId, checkedAt) {
      projectChecks.push({ scope, projectId, checkedAt });
      timeline.push("project-scope");
      return options.projectAllowed ?? true;
    },
    async capabilityIsCurrentForScope(scope, capabilityKey, projectId, checkedAt) {
      capabilityChecks.push({ scope, capabilityKey, projectId, checkedAt });
      timeline.push("capability-current");
      return options.capabilityCurrent ?? true;
    },
    async listProjectsForScope() { throw new Error("not used"); },
    async getProjectForScope() { throw new Error("not used"); },
    async listClientsForScope() { throw new Error("not used"); },
    async searchProjectsForScope() { throw new Error("not used"); },
    async getDashboardForScope() { throw new Error("not used"); },
  };
  const audit = {
    async append(event) {
      timeline.push("audit");
      if (options.auditError) throw options.auditError;
      audits.push(event);
      return { id: event.id };
    },
  };
  const revocations = [];
  const sessions = {
    async revokeSession(intent) {
      timeline.push("revoke");
      revocations.push(intent);
      if (options.revokeError) throw options.revokeError;
      return options.revokeResult ?? { outcome: "accepted", version: "5" };
    },
  };
  let id = 0;
  const service = createAuthorizationService({
    repository,
    sessions,
    audit,
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  });
  return { audits, capabilityChecks, projectChecks, revocations, service, timeline };
}

test("sensitive Administrator actions are audited before provider work runs", async () => {
  const fake = harness();
  let workCalls = 0;
  const decision = await fake.service.performGmailFile(request({
    projectId: PROJECT_ID,
  }), async (context) => {
    fake.timeline.push("work");
    workCalls += 1;
    assert.equal(context.recordScope.kind, "company");
    assert.equal(context.recordScope.sessionId, context.sessionId);
    assert.equal(context.recordScope.sessionVersion, context.sessionVersion);
    assert.equal(context.recordScope.includeFinancial, true);
    return "filed";
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.value, "filed");
  assert.equal(workCalls, 1);
  assert.deepEqual(fake.timeline, [
    "session",
    "project-scope",
    "capability-current",
    "audit",
    "work",
  ]);
  assert.equal(fake.projectChecks.length, 1);
  assert.equal(fake.projectChecks[0].projectId, PROJECT_ID);
  assert.deepEqual(fake.capabilityChecks, [{
    scope: fake.projectChecks[0].scope,
    capabilityKey: AUTHORIZATION_CAPABILITIES.gmailFile,
    projectId: PROJECT_ID,
    checkedAt: NOW,
  }]);
  assert.equal(fake.audits.length, 1);
  assert.deepEqual(fake.audits[0], {
    id: "00000000-0000-4000-8000-000000000001",
    executorType: "user",
    executorUserId: "33333333-3333-4333-8333-333333333333",
    executorKey: "admincrm@cherryhillfci.com",
    originatingUserId: null,
    originatingActorKey: null,
    action: "authorization.access_allowed",
    targetType: "project",
    targetId: PROJECT_ID,
    result: "succeeded",
    reasonCode: null,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    source: "authorization",
    metadata: {
      operation: AUTHORIZATION_OPERATIONS.gmailFile,
      principal_kind: "employee",
      project_scoped: true,
    },
    occurredAt: NOW,
    retentionPolicyKey: "security_audit",
    retentionUntil: null,
  });
});

test("routine authorized reads use scoped queries without writing sensitive-action audit rows", async () => {
  const fake = harness({
    snapshot: sessionSnapshot({
      roleGrants: [{
        roleKey: AUTHORIZATION_ROLES.projectManager,
        capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
      }],
    }),
  });
  const decision = await fake.service.performProjectView(request({
    projectId: PROJECT_ID,
  }), async () => "project");

  assert.equal(decision.allowed, true);
  assert.equal(decision.context.recordScope.kind, "assigned_projects");
  assert.equal(decision.context.recordScope.includeFinancial, false);
  assert.deepEqual(fake.timeline, ["session", "project-scope"]);
  assert.equal(fake.audits.length, 0);
  assert.equal(fake.projectChecks.length, 1);
  assert.equal(fake.projectChecks[0].scope.userId, decision.context.userId);
  assert.equal(fake.projectChecks[0].checkedAt, NOW);
});

test("Office and Project Manager file reads retain role scope and recheck the current capability", async () => {
  for (const [roleKey, expectedScope] of [
    [AUTHORIZATION_ROLES.officeOperations, "company"],
    [AUTHORIZATION_ROLES.projectManager, "assigned_projects"],
  ]) {
    const fake = harness({
      snapshot: sessionSnapshot({
        roleGrants: [{
          roleKey,
          capabilityKeys: [
            AUTHORIZATION_CAPABILITIES.recordsRead,
            AUTHORIZATION_CAPABILITIES.filesRead,
          ],
        }],
      }),
    });
    const decision = await fake.service.performFilesView(request({
      projectId: PROJECT_ID,
    }), async () => "file metadata");

    assert.equal(decision.allowed, true, roleKey);
    assert.equal(decision.value, "file metadata", roleKey);
    assert.equal(decision.context.recordScope.kind, expectedScope, roleKey);
    assert.equal(decision.context.recordScope.includeFinancial, false, roleKey);
    assert.deepEqual(fake.timeline, [
      "session",
      "project-scope",
      "capability-current",
      "audit",
    ], roleKey);
    assert.deepEqual(fake.capabilityChecks, [{
      scope: fake.projectChecks[0].scope,
      capabilityKey: AUTHORIZATION_CAPABILITIES.filesRead,
      projectId: PROJECT_ID,
      checkedAt: NOW,
    }], roleKey);
  }
});

test("named gateways cannot be relabeled by a caller-supplied operation property", async () => {
  const fake = harness({
    snapshot: sessionSnapshot({
      roleGrants: [{
        roleKey: AUTHORIZATION_ROLES.officeOperations,
        capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
      }],
    }),
  });
  let workCalls = 0;
  const decision = await fake.service.performCalendarCreate(request({
    projectId: null,
    operation: AUTHORIZATION_OPERATIONS.dashboardView,
  }), async () => {
    workCalls += 1;
    return "must not run";
  });

  assert.deepEqual(decision, { allowed: false, reason: "missing_capability" });
  assert.equal(workCalls, 0);
  assert.deepEqual(fake.timeline, ["session", "audit"]);
  assert.equal(fake.audits[0].metadata.operation, AUTHORIZATION_OPERATIONS.calendarCreate);
  assert.equal(fake.audits[0].targetId, AUTHORIZATION_OPERATIONS.calendarCreate);
});

test("named gateways reject non-UUID trace and field-link identifiers before dependencies run", async () => {
  const bearerLikeValue = `sha256:${"b".repeat(64)}`;
  const cases = [
    {
      label: "request ID",
      invoke: (service, work) => service.performDashboardView(
        request({ requestId: bearerLikeValue }),
        work,
      ),
    },
    {
      label: "correlation ID",
      invoke: (service, work) => service.performDashboardView(
        request({ correlationId: bearerLikeValue }),
        work,
      ),
    },
    {
      label: "project ID",
      invoke: (service, work) => service.performProjectView(
        request({ projectId: bearerLikeValue }),
        work,
      ),
    },
    {
      label: "field-link ID",
      invoke: (service, work) => service.performFieldAssignmentOpen(
        {
          linkId: bearerLikeValue,
          projectId: PROJECT_ID,
          expiresAt: NOW + 1,
          revokedAt: null,
        },
        fieldRequest({ projectId: PROJECT_ID }),
        work,
      ),
    },
  ];

  for (const item of cases) {
    const fake = harness();
    let workCalls = 0;
    await assert.rejects(item.invoke(fake.service, async () => {
      workCalls += 1;
      return "must not run";
    }), TypeError, item.label);
    assert.equal(workCalls, 0, item.label);
    assert.deepEqual(fake.timeline, [], item.label);
  }
});

test("non-Administrator and cross-project named gateways deny before work", async () => {
  const cases = [
    {
      label: "non-Administrator sensitive action",
      snapshot: sessionSnapshot({
        roleGrants: [{
          roleKey: AUTHORIZATION_ROLES.officeOperations,
          capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
        }],
      }),
      invoke: (service, work) => service.performCalendarCreate(
        request({ projectId: null }),
        work,
      ),
      reason: "missing_capability",
      projectAllowed: true,
    },
    {
      label: "non-Administrator project creation",
      snapshot: sessionSnapshot({
        roleGrants: [{
          roleKey: AUTHORIZATION_ROLES.officeOperations,
          capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
        }],
      }),
      invoke: (service, work) => service.performProjectCreate(request(), work),
      reason: "missing_capability",
      projectAllowed: true,
    },
    {
      label: "non-Administrator project assignment",
      snapshot: sessionSnapshot({
        roleGrants: [{
          roleKey: AUTHORIZATION_ROLES.projectManager,
          capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
        }],
      }),
      invoke: (service, work) => service.performProjectAssign(
        request({ projectId: PROJECT_ID }),
        work,
      ),
      reason: "missing_capability",
      projectAllowed: true,
    },
    {
      label: "cross-project Project Manager read",
      snapshot: sessionSnapshot({
        roleGrants: [{
          roleKey: AUTHORIZATION_ROLES.projectManager,
          capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
        }],
      }),
      invoke: (service, work) => service.performProjectView(
        request({ projectId: OTHER_PROJECT_ID }),
        work,
      ),
      reason: "outside_project_scope",
      projectAllowed: false,
    },
  ];

  for (const item of cases) {
    const fake = harness(item);
    let workCalls = 0;
    const decision = await item.invoke(fake.service, async () => {
      workCalls += 1;
      return "must not run";
    });
    assert.deepEqual(decision, { allowed: false, reason: item.reason }, item.label);
    assert.equal(workCalls, 0, item.label);
    assert.equal(fake.audits.length, 1, item.label);
    assert.equal(fake.audits[0].result, "denied", item.label);
    assert.equal(fake.audits[0].reasonCode, item.reason, item.label);
    assert.equal(
      fake.projectChecks.length,
      item.reason === "outside_project_scope" ? 1 : 0,
      item.label,
    );
  }
});

test("invalid, revoked, disabled, changed, invalidated, and expired sessions deny and produce minimized audit evidence", async () => {
  const cases = [
    ["invalid_session", null],
    ["session_revoked", sessionSnapshot({ revokedAt: NOW - 1 })],
    ["user_disabled", sessionSnapshot({ userStatus: "disabled" })],
    ["outside_domain", sessionSnapshot({ email: "user@example.com" })],
    [
      "authorization_changed",
      sessionSnapshot({ sessionAuthorizationVersion: "8" }),
    ],
    ["session_invalidated", sessionSnapshot({ sessionsValidAfter: NOW - 4_000 })],
    ["invalid_session", sessionSnapshot({ issuedAt: NOW + 1 })],
    ["invalid_session", sessionSnapshot({ lastSeenAt: NOW - 6_000 })],
    ["invalid_session", sessionSnapshot({ idleExpiresAt: NOW - 2_000 })],
    ["invalid_session", sessionSnapshot({ absoluteExpiresAt: NOW - 6_000 })],
    ["absolute_expired", sessionSnapshot({ idleExpiresAt: NOW, absoluteExpiresAt: NOW })],
    ["idle_expired", sessionSnapshot({ idleExpiresAt: NOW, absoluteExpiresAt: NOW + 1 })],
  ];

  for (const [reason, snapshot] of cases) {
    const fake = harness({ snapshot });
    let workCalls = 0;
    const authorizationRequest = request();
    const decision = await fake.service.performDashboardView(authorizationRequest, async () => {
      workCalls += 1;
      return "must not run";
    });
    assert.deepEqual(decision, { allowed: false, reason });
    assert.equal(workCalls, 0);
    assert.equal(fake.audits.length, 1);
    assert.deepEqual(fake.audits[0].metadata, {
      operation: AUTHORIZATION_OPERATIONS.dashboardView,
      principal_kind: snapshot ? "employee" : "anonymous",
      project_scoped: false,
    });
    assert.equal(fake.audits[0].executorType, snapshot ? "user" : "anonymous");
    assert.equal(fake.audits[0].reasonCode, reason);
    const serialized = JSON.stringify(fake.audits[0]);
    assert.equal(serialized.includes(authorizationRequest.tokenHash), false);
    assert.doesNotMatch(serialized, /token|session_hash|request_body/i);
  }
});

test("audit persistence failure fails closed before sensitive or denied work", async () => {
  const auditError = new Error("FCI TEST — DO NOT USE audit unavailable");
  const sensitive = harness({ auditError });
  let sensitiveWorkCalls = 0;
  await assert.rejects(
    sensitive.service.performDataExport(request({ projectId: null }), async () => {
      sensitiveWorkCalls += 1;
      return "must not run";
    }),
    auditError,
  );
  assert.equal(sensitiveWorkCalls, 0);
  assert.deepEqual(sensitive.timeline, ["session", "capability-current", "audit"]);

  const denied = harness({
    auditError,
    snapshot: sessionSnapshot({ userStatus: "disabled" }),
  });
  let deniedWorkCalls = 0;
  await assert.rejects(
    denied.service.performDashboardView(request(), async () => {
      deniedWorkCalls += 1;
      return "must not run";
    }),
    auditError,
  );
  assert.equal(deniedWorkCalls, 0);
  assert.deepEqual(denied.timeline, ["session", "audit"]);
});

test("a stale persisted capability denies before audit-complete work can run", async () => {
  const fake = harness({ capabilityCurrent: false });
  let workCalls = 0;
  const decision = await fake.service.performDataExport(request({ projectId: null }), async () => {
    workCalls += 1;
    return "must not run";
  });

  assert.deepEqual(decision, { allowed: false, reason: "missing_capability" });
  assert.equal(workCalls, 0);
  assert.deepEqual(fake.timeline, ["session", "capability-current", "audit"]);
  assert.deepEqual(fake.capabilityChecks, [{
    scope: fake.capabilityChecks[0].scope,
    capabilityKey: AUTHORIZATION_CAPABILITIES.dataExport,
    projectId: null,
    checkedAt: NOW,
  }]);
  assert.equal(fake.audits.length, 1);
  assert.equal(fake.audits[0].reasonCode, "missing_capability");
});

test("Field Lead service evaluates one supplied link snapshot and never calls work across projects", async () => {
  const snapshot = {
    linkId: FIELD_LINK_ID,
    projectId: PROJECT_ID,
    expiresAt: NOW + 1,
    revokedAt: null,
  };
  const active = resolveFieldLinkAccess(snapshot, NOW);
  assert.equal(active.allowed, true);

  const allowed = harness();
  let allowedCalls = 0;
  const allowedDecision = await allowed.service.performFieldAssignmentOpen(
    snapshot,
    fieldRequest({
      projectId: PROJECT_ID,
    }),
    async () => {
      allowedCalls += 1;
      return "assignment";
    },
  );
  assert.equal(allowedDecision.allowed, true);
  assert.equal(allowedDecision.value, "assignment");
  assert.equal(allowedCalls, 1);
  assert.deepEqual(allowed.timeline, ["audit"]);
  assert.equal(allowed.audits[0].executorType, "external");
  assert.equal(allowed.audits[0].executorKey, `field_link:${FIELD_LINK_ID}`);

  const denied = harness();
  let deniedCalls = 0;
  const deniedDecision = await denied.service.performFieldAssignmentOpen(
    snapshot,
    fieldRequest({
      projectId: OTHER_PROJECT_ID,
    }),
    async () => {
      deniedCalls += 1;
      return "must not run";
    },
  );
  assert.deepEqual(deniedDecision, { allowed: false, reason: "outside_project_scope" });
  assert.equal(deniedCalls, 0);
  assert.deepEqual(denied.timeline, ["audit"]);
  assert.equal(denied.audits[0].result, "denied");
});

test("logout revokes the resolved session atomically and is externally idempotent", async () => {
  const fake = harness();
  const logoutRequest = {
    tokenHash: request().tokenHash,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  };

  assert.deepEqual(await fake.service.logoutSession(logoutRequest), { outcome: "logged_out" });
  assert.deepEqual(fake.timeline, ["session", "revoke"]);
  assert.equal(fake.revocations.length, 1);
  assert.deepEqual(fake.revocations[0], {
    sessionId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: "4",
    revokedAt: NOW,
    revokedByActorKey: "admincrm@cherryhillfci.com",
    reasonCode: "logout",
    audit: {
      id: "00000000-0000-4000-8000-000000000001",
      executorType: "user",
      executorUserId: "33333333-3333-4333-8333-333333333333",
      executorKey: "admincrm@cherryhillfci.com",
      originatingUserId: null,
      originatingActorKey: null,
      action: "identity.session_revoked",
      targetType: "session",
      targetId: "11111111-1111-4111-8111-111111111111",
      result: "succeeded",
      reasonCode: "logout",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      source: "authorization",
      metadata: { trigger: "user_logout" },
      occurredAt: NOW,
      retentionPolicyKey: "security_audit",
      retentionUntil: null,
    },
  });
  assert.equal(JSON.stringify(fake.revocations[0]).includes(logoutRequest.tokenHash), false);

  for (const snapshot of [null, sessionSnapshot({ revokedAt: NOW - 1 })]) {
    const idempotent = harness({ snapshot });
    assert.deepEqual(await idempotent.service.logoutSession(logoutRequest), {
      outcome: "logged_out",
    });
    assert.deepEqual(idempotent.timeline, ["session"]);
    assert.equal(idempotent.revocations.length, 0);
  }
});

test("Field Lead snapshot expiry and revocation are evaluated inside the service", async () => {
  for (const [reason, snapshot] of [
    ["link_expired", {
      linkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectId: PROJECT_ID,
      expiresAt: NOW,
      revokedAt: null,
    }],
    ["link_revoked", {
      linkId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      projectId: PROJECT_ID,
      expiresAt: NOW + 1,
      revokedAt: NOW - 1,
    }],
  ]) {
    const fake = harness();
    let workCalls = 0;
    const decision = await fake.service.performFieldAssignmentOpen(
      snapshot,
      fieldRequest({
        projectId: PROJECT_ID,
      }),
      async () => {
        workCalls += 1;
        return "must not run";
      },
    );
    assert.deepEqual(decision, { allowed: false, reason });
    assert.equal(workCalls, 0);
    assert.deepEqual(fake.timeline, ["audit"]);
    assert.equal(fake.audits[0].reasonCode, reason);
  }
});
