import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { after, test } from "node:test";
import { createServer as createViteServer } from "vite";

import {
  CLEAR_SESSION_COOKIE,
  SESSION_COOKIE_NAME,
  SESSION_CSRF_HEADER,
} from "../app/platform/google-cloud/secure-session-transport.ts";

const vite = await createViteServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  cacheDir: "work/vite-tests/cloud-run-employee-routes",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24709 } },
});
const { createAuthorizationService } = await vite.ssrLoadModule(
  "/app/application/authorization-service.ts",
);
const {
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_ROLES,
} = await vite.ssrLoadModule("/app/application/authorization-policy.ts");
const { createEmployeeRequestRouter } = await vite.ssrLoadModule(
  "/app/platform/google-cloud/employee-request-router.ts",
);

after(async () => {
  await vite.close();
});

const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);
const PROJECT_A = "55555555-5555-4555-8555-555555555555";
const PROJECT_B = "66666666-6666-4666-8666-666666666666";
const UNKNOWN_PROJECT = "77777777-7777-4777-8777-777777777777";
const FILE_ID = "88888888-8888-4888-8888-888888888888";
const INVITATION_ID = "99999999-9999-4999-8999-999999999999";
const TARGET_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_CREDENTIAL = Buffer.alloc(32, 0x41).toString("base64url");
const CSRF_CREDENTIAL = Buffer.alloc(32, 0x42).toString("base64url");
const INVITATION_CREDENTIAL = Buffer.alloc(32, 0x43).toString("base64url");

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

const SESSION_HASH = sha256(SESSION_CREDENTIAL);
const CSRF_HASH = sha256(CSRF_CREDENTIAL);

const ROLE_IDENTITIES = Object.freeze({
  [AUTHORIZATION_ROLES.administrator]: {
    userId: "11111111-1111-4111-8111-111111111111",
    sessionId: "12111111-1111-4111-8111-111111111111",
    email: "admincrm@cherryhillfci.com",
  },
  [AUTHORIZATION_ROLES.officeOperations]: {
    userId: "22222222-2222-4222-8222-222222222222",
    sessionId: "23222222-2222-4222-8222-222222222222",
    email: "office@cherryhillfci.com",
  },
  [AUTHORIZATION_ROLES.projectManager]: {
    userId: "33333333-3333-4333-8333-333333333333",
    sessionId: "34333333-3333-4333-8333-333333333333",
    email: "pm@cherryhillfci.com",
  },
});

function sessionSnapshot(role = AUTHORIZATION_ROLES.administrator, overrides = {}) {
  const identity = ROLE_IDENTITIES[role];
  return {
    sessionId: identity.sessionId,
    sessionVersion: "1",
    userId: identity.userId,
    email: identity.email,
    userStatus: "active",
    userAuthorizationVersion: "1",
    sessionAuthorizationVersion: "1",
    sessionsValidAfter: NOW - 60_000,
    issuedAt: NOW - 30_000,
    lastSeenAt: NOW - 5_000,
    idleExpiresAt: NOW + 30 * 60_000,
    absoluteExpiresAt: NOW + 8 * 60 * 60_000,
    revokedAt: null,
    roleGrants: [{
      roleKey: role,
      capabilityKeys: Object.values(AUTHORIZATION_CAPABILITIES),
    }],
    ...overrides,
  };
}

const PROJECT_FIXTURES = Object.freeze([
  Object.freeze({
    id: PROJECT_A,
    projectNumber: "CF-2026-AAAAAAAA",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientName: "FCI TEST — DO NOT USE Client A",
    name: "FCI TEST — DO NOT USE Project A",
    status: "planning",
    site: "FCI TEST — DO NOT USE Site A",
    projectManagerId: ROLE_IDENTITIES[AUTHORIZATION_ROLES.projectManager].email,
    estimatedValue: 100_000,
    updatedAt: NOW - 1_000,
    version: "3",
  }),
  Object.freeze({
    id: PROJECT_B,
    projectNumber: "CF-2026-BBBBBBBB",
    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    clientName: "FCI TEST — DO NOT USE Client B",
    name: "FCI TEST — DO NOT USE Project B",
    status: "completed",
    site: "FCI TEST — DO NOT USE Site B",
    projectManagerId: ROLE_IDENTITIES[AUTHORIZATION_ROLES.officeOperations].email,
    estimatedValue: 250_000,
    updatedAt: NOW - 2_000,
    version: "5",
  }),
]);

const CLIENT_FIXTURES = Object.freeze([
  Object.freeze({
    id: PROJECT_FIXTURES[0].clientId,
    clientCode: "CL-AAAAAAAA",
    name: PROJECT_FIXTURES[0].clientName,
    status: "active",
    primaryContact: Object.freeze({
      name: "FCI TEST — DO NOT USE Contact A",
      email: "contact-a@example.test",
      phone: null,
    }),
  }),
  Object.freeze({
    id: PROJECT_FIXTURES[1].clientId,
    clientCode: "CL-BBBBBBBB",
    name: PROJECT_FIXTURES[1].clientName,
    status: "active",
    primaryContact: Object.freeze({
      name: "FCI TEST — DO NOT USE Contact B",
      email: "contact-b@example.test",
      phone: null,
    }),
  }),
]);

const ACCESS_OVERVIEW_FIXTURE = Object.freeze({
  summary: Object.freeze({
    activePeopleCount: 2,
    activeAdministratorCount: 1,
    pendingInvitationCount: 1,
  }),
  roles: Object.freeze([
    Object.freeze({ key: "administrator", displayName: "Administrator", description: "Company-wide administration." }),
    Object.freeze({ key: "office_operations", displayName: "Office Operations", description: "Company-wide nonfinancial operations." }),
    Object.freeze({ key: "project_manager", displayName: "Project Manager", description: "Assigned-project nonfinancial operations." }),
  ]),
  people: Object.freeze([
    Object.freeze({
      id: ROLE_IDENTITIES.administrator.userId,
      displayName: "FCI TEST — DO NOT USE Administrator",
      email: ROLE_IDENTITIES.administrator.email,
      role: "administrator",
      status: "active",
      projectIds: Object.freeze([]),
      lastSignedInAt: NOW - 30_000,
      version: "1",
    }),
    Object.freeze({
      id: TARGET_USER_ID,
      displayName: "FCI TEST — DO NOT USE Office",
      email: "office.person@cherryhillfci.com",
      role: "office_operations",
      status: "active",
      projectIds: Object.freeze([]),
      lastSignedInAt: null,
      version: "2",
    }),
  ]),
  invitations: Object.freeze([
    Object.freeze({
      id: INVITATION_ID,
      email: "pending.pm@cherryhillfci.com",
      role: "project_manager",
      status: "pending",
      projectIds: Object.freeze([PROJECT_A]),
      createdAt: NOW - 60_000,
      expiresAt: NOW + 7 * 24 * 60 * 60_000,
      version: "1",
    }),
  ]),
  projects: Object.freeze(PROJECT_FIXTURES.map(({ id, projectNumber, name, status }) =>
    Object.freeze({ id, projectNumber, name, status }))),
  generatedAt: NOW,
});

function visibleProjectIds(scope) {
  return scope.kind === "company" ? [PROJECT_A, PROJECT_B] : [PROJECT_A];
}

function projectForScope(scope, source) {
  const {
    estimatedValue,
    ...nonfinancial
  } = source;
  return scope.includeFinancial
    ? { ...nonfinancial, financialVisible: true, estimatedValue }
    : { ...nonfinancial, financialVisible: false };
}

function recordedActions(calls) {
  const action = (name) => async (input) => {
    calls.push({ name, input });
    return {
      action: name,
      projectId: input.projectId,
      fileId: input.fileId,
      body: input.body,
    };
  };
  return {
    listFiles: action("listFiles"),
    uploadFile: action("uploadFile"),
    shareFile: action("shareFile"),
    fileGmailMessage: action("fileGmailMessage"),
    createCalendarEvent: action("createCalendarEvent"),
  };
}

async function startHarness(options = {}) {
  let currentSnapshot = options.snapshot === undefined
    ? sessionSnapshot(options.role)
    : options.snapshot;
  const audits = [];
  const revocations = [];
  const adminAccessCalls = [];
  const adminAuditCalls = [];
  const repositoryCalls = {
    sessionHashes: [],
    csrf: [],
    projectChecks: [],
    capabilityChecks: [],
    dashboards: [],
    searches: [],
    projectLists: [],
    projectReads: [],
    clientLists: [],
  };

  const repository = {
    async findSessionByTokenHash(tokenHash) {
      repositoryCalls.sessionHashes.push(tokenHash);
      return tokenHash === SESSION_HASH ? currentSnapshot : null;
    },
    async sessionCsrfHashMatches(tokenHash, csrfHash, checkedAt) {
      repositoryCalls.csrf.push({ tokenHash, csrfHash, checkedAt });
      return (options.csrfMatches ?? true) &&
        tokenHash === SESSION_HASH &&
        csrfHash === CSRF_HASH &&
        currentSnapshot !== null &&
        currentSnapshot.revokedAt === null;
    },
    async projectExistsForScope(scope, projectId, checkedAt) {
      repositoryCalls.projectChecks.push({ scope, projectId, checkedAt });
      if (options.projectAllowed !== undefined) return options.projectAllowed;
      return visibleProjectIds(scope).includes(projectId);
    },
    async capabilityIsCurrentForScope(scope, capabilityKey, projectId, checkedAt) {
      repositoryCalls.capabilityChecks.push({ scope, capabilityKey, projectId, checkedAt });
      return options.capabilityCurrent ?? true;
    },
    async listProjectsForScope(scope, checkedAt, limit) {
      repositoryCalls.projectLists.push({ scope, checkedAt, limit });
      return PROJECT_FIXTURES
        .filter(({ id }) => visibleProjectIds(scope).includes(id))
        .map((project) => projectForScope(scope, project));
    },
    async getProjectForScope(scope, projectId, checkedAt) {
      repositoryCalls.projectReads.push({ scope, projectId, checkedAt });
      if (!visibleProjectIds(scope).includes(projectId)) return null;
      const project = PROJECT_FIXTURES.find(({ id }) => id === projectId);
      return project ? projectForScope(scope, project) : null;
    },
    async listClientsForScope(scope, checkedAt, limit) {
      repositoryCalls.clientLists.push({ scope, checkedAt, limit });
      const allowedClientIds = new Set(
        PROJECT_FIXTURES
          .filter(({ id }) => visibleProjectIds(scope).includes(id))
          .map(({ clientId }) => clientId),
      );
      return CLIENT_FIXTURES.filter(({ id }) => allowedClientIds.has(id));
    },
    async searchProjectsForScope(scope, query, checkedAt, limit) {
      repositoryCalls.searches.push({ scope, query, checkedAt, limit });
      return PROJECT_FIXTURES
        .filter(({ id }) => visibleProjectIds(scope).includes(id))
        .filter(({ name, projectNumber, clientName }) =>
          `${name} ${projectNumber} ${clientName}`.toLowerCase().includes(query.toLowerCase()))
        .map((project) => projectForScope(scope, project));
    },
    async getDashboardForScope(scope, checkedAt) {
      repositoryCalls.dashboards.push({ scope, checkedAt });
      const projects = PROJECT_FIXTURES.filter(({ id }) => visibleProjectIds(scope).includes(id));
      return {
        projectCount: projects.length,
        activeProjectCount: projects.filter(({ status }) => status !== "completed").length,
        completedProjectCount: projects.filter(({ status }) => status === "completed").length,
        financialVisible: scope.includeFinancial,
        ...(scope.includeFinancial
          ? { estimatedValueTotal: projects.reduce((total, project) => total + project.estimatedValue, 0) }
          : {}),
      };
    },
  };

  const audit = {
    async append(event) {
      if (options.auditError) throw options.auditError;
      audits.push(event);
      return { id: event.id };
    },
  };
  const sessions = {
    async revokeSession(intent) {
      revocations.push(intent);
      if (options.revocationError) throw options.revocationError;
      const result = options.revocationResult ?? { outcome: "accepted", version: "2" };
      if (result.outcome === "accepted" && currentSnapshot) {
        currentSnapshot = { ...currentSnapshot, revokedAt: intent.revokedAt };
      }
      return result;
    },
  };
  const authorization = createAuthorizationService({
    repository,
    audit,
    sessions,
    now: () => NOW,
    newId: randomUUID,
  });
  const adminAccess = {
    async getAccessOverview(scope, checkedAt) {
      adminAccessCalls.push({ method: "getAccessOverview", scope, checkedAt });
      return options.adminResults?.getAccessOverview ?? {
        outcome: "accepted",
        overview: ACCESS_OVERVIEW_FIXTURE,
      };
    },
    async createInvitation(intent) {
      adminAccessCalls.push({ method: "createInvitation", intent });
      return options.adminResults?.createInvitation ?? {
        outcome: "accepted",
        version: "1",
        authorizationVersion: null,
      };
    },
    async revokeInvitation(intent) {
      adminAccessCalls.push({ method: "revokeInvitation", intent });
      return options.adminResults?.revokeInvitation ?? {
        outcome: "accepted",
        version: "2",
        authorizationVersion: null,
      };
    },
    async setUserAccess(intent) {
      adminAccessCalls.push({ method: "setUserAccess", intent });
      return options.adminResults?.setUserAccess ?? {
        outcome: "accepted",
        version: "2",
        authorizationVersion: "2",
      };
    },
    async disableUser(intent) {
      adminAccessCalls.push({ method: "disableUser", intent });
      return options.adminResults?.disableUser ?? {
        outcome: "accepted",
        version: "2",
        authorizationVersion: "2",
      };
    },
    async invalidateUserSessions(intent) {
      adminAccessCalls.push({ method: "invalidateUserSessions", intent });
      return options.adminResults?.invalidateUserSessions ?? {
        outcome: "accepted",
        version: "2",
        authorizationVersion: "2",
      };
    },
  };
  const adminAudit = {
    async listActivity(scope, query, checkedAt) {
      adminAuditCalls.push({ scope, query, checkedAt });
      return options.adminAuditResult ?? {
        outcome: "accepted",
        page: {
          events: [{
            actorLabel: "FCI TEST — DO NOT USE Administrator",
            actionLabel: "Access denied",
            targetLabel: "Security activity",
            result: "denied",
            reason: "Session expired after inactivity",
            occurredAt: NOW - 1_000,
          }],
          next: null,
          generatedAt: NOW,
        },
      };
    },
  };
  const actionCalls = [];
  const actions = options.actions === true ? recordedActions(actionCalls) : options.actions;
  const router = createEmployeeRequestRouter({
    authorization,
    repository,
    adminAudit,
    adminAccess,
    audit,
    testActions: actions,
    testMode: true,
    now: () => NOW,
    newId: randomUUID,
    newInvitationCredential: () => options.invitationCredential ?? INVITATION_CREDENTIAL,
  });
  const server = createHttpServer((request, response) => {
    void router(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end('{"error":"test_router_rejected"}');
      } else {
        response.destroy();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  async function request(path, requestOptions = {}) {
    const headers = new Headers(requestOptions.headers);
    if (requestOptions.authenticated !== false) {
      headers.set("Cookie", `${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}`);
    }
    if (requestOptions.sameOrigin) headers.set("Origin", origin);
    if (requestOptions.csrf) headers.set(SESSION_CSRF_HEADER, CSRF_CREDENTIAL);

    let body = requestOptions.body;
    if (Object.hasOwn(requestOptions, "json")) {
      headers.set("Content-Type", "application/json");
      body = typeof requestOptions.json === "string"
        ? requestOptions.json
        : JSON.stringify(requestOptions.json);
    }
    return fetch(origin + path, {
      method: requestOptions.method ?? "GET",
      headers,
      ...(body === undefined ? {} : { body }),
    });
  }

  async function close() {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }

  return {
    actionCalls,
    adminAccessCalls,
    adminAuditCalls,
    audits,
    close,
    origin,
    repositoryCalls,
    request,
    revocations,
  };
}

async function json(response) {
  const body = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  return body;
}

function assertSessionCleared(response) {
  assert.equal(response.headers.get("set-cookie"), CLEAR_SESSION_COOKIE);
}

function assertSessionNotCleared(response) {
  assert.equal(response.headers.get("set-cookie"), null);
}

test("functional read routes use the named authorization gateways and PM-scoped repository queries", async () => {
  const running = await startHarness({ role: AUTHORIZATION_ROLES.projectManager });
  try {
    const cases = [
      ["/api/v1/dashboard", "dashboard", 1],
      ["/api/v1/search?q=FCI%20TEST", "search", 1],
      ["/api/v1/projects", "projects", 1],
      [`/api/v1/projects/${PROJECT_A}`, "project", PROJECT_A],
      ["/api/v1/clients", "clients", 1],
    ];
    for (const [path, label, expectation] of cases) {
      const response = await running.request(path);
      assert.equal(response.status, 200, label);
      const body = await json(response);
      if (label === "project") assert.equal(body.data.id, expectation);
      else if (label === "dashboard") assert.equal(body.data.projectCount, expectation);
      else assert.equal(body.data.length, expectation);
      assert.equal(JSON.stringify(body).includes("estimatedValue"), false, label);
    }

    assert.equal(running.repositoryCalls.searches[0].query, "FCI TEST");
    assert.equal(running.repositoryCalls.searches[0].limit, 50);
    assert.equal(running.repositoryCalls.projectLists[0].limit, 100);
    assert.equal(running.repositoryCalls.clientLists[0].limit, 100);
    assert.ok(running.repositoryCalls.sessionHashes.every((hash) => hash === SESSION_HASH));
    assert.equal(JSON.stringify(running.repositoryCalls).includes(SESSION_CREDENTIAL), false);
  } finally {
    await running.close();
  }
});

test("forwarded identity and Authorization headers never replace the host-only session cookie", async () => {
  const running = await startHarness();
  try {
    for (const headers of [
      { Authorization: `Bearer ${SESSION_CREDENTIAL}` },
      { "oai-authenticated-user-email": "admincrm@cherryhillfci.com" },
    ]) {
      const response = await running.request("/api/v1/dashboard", {
        authenticated: false,
        headers,
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await json(response), { error: "authentication_required" });
      assert.equal(running.repositoryCalls.sessionHashes.length, 0);
    }
  } finally {
    await running.close();
  }
});

test("Administrator reads include financial values while Office reads omit the columns entirely", async () => {
  for (const [role, financialVisible] of [
    [AUTHORIZATION_ROLES.administrator, true],
    [AUTHORIZATION_ROLES.officeOperations, false],
  ]) {
    const running = await startHarness({ role });
    try {
      const projectsResponse = await running.request("/api/v1/projects");
      assert.equal(projectsResponse.status, 200);
      const projects = (await json(projectsResponse)).data;
      assert.equal(projects.length, 2);
      assert.ok(projects.every((project) => project.financialVisible === financialVisible));
      assert.equal(projects.every((project) => Object.hasOwn(project, "estimatedValue")), financialVisible);

      const dashboardResponse = await running.request("/api/v1/dashboard");
      assert.equal(dashboardResponse.status, 200);
      const dashboard = (await json(dashboardResponse)).data;
      assert.equal(dashboard.financialVisible, financialVisible);
      assert.equal(Object.hasOwn(dashboard, "estimatedValueTotal"), financialVisible);
      if (financialVisible) assert.equal(dashboard.estimatedValueTotal, 350_000);
    } finally {
      await running.close();
    }
  }
});

test("cross-project record and file routes are non-enumerating and never invoke protected work", async () => {
  const running = await startHarness({
    role: AUTHORIZATION_ROLES.projectManager,
    actions: true,
  });
  try {
    const deniedProject = await running.request(`/api/v1/projects/${PROJECT_B}`);
    const missingProject = await running.request(`/api/v1/projects/${UNKNOWN_PROJECT}`);
    const deniedFiles = await running.request(`/api/v1/projects/${PROJECT_B}/files`);

    for (const response of [deniedProject, missingProject, deniedFiles]) {
      assert.equal(response.status, 404);
      assert.deepEqual(await json(response), { error: "not_found" });
    }
    assert.equal(running.repositoryCalls.projectReads.length, 0);
    assert.equal(running.actionCalls.length, 0);
    assert.ok(running.audits.some(({ reasonCode }) => reasonCode === "outside_project_scope"));
  } finally {
    await running.close();
  }
});

test("revoked, disabled, idle-expired, and absolute-expired sessions return one generic 401", async () => {
  const cases = [
    ["revoked", { revokedAt: NOW - 1 }],
    ["disabled", { userStatus: "disabled" }],
    ["idle expired", { idleExpiresAt: NOW, absoluteExpiresAt: NOW + 1 }],
    ["absolute expired", { idleExpiresAt: NOW, absoluteExpiresAt: NOW }],
  ];

  for (const [label, overrides] of cases) {
    const running = await startHarness({
      snapshot: sessionSnapshot(AUTHORIZATION_ROLES.administrator, overrides),
    });
    try {
      const response = await running.request("/api/v1/dashboard");
      assert.equal(response.status, 401, label);
      assert.deepEqual(await json(response), { error: "authentication_required" }, label);
      assertSessionCleared(response);
      assert.equal(running.repositoryCalls.dashboards.length, 0, label);
      assert.equal(running.audits.length, 1, label);
      const serializedAudit = JSON.stringify(running.audits[0]);
      assert.equal(serializedAudit.includes(SESSION_CREDENTIAL), false, label);
      assert.equal(serializedAudit.includes(SESSION_HASH), false, label);
    } finally {
      await running.close();
    }
  }
});

test("Administrator-only Gmail, Calendar, and share actions deny Office before callbacks", async () => {
  const running = await startHarness({
    role: AUTHORIZATION_ROLES.officeOperations,
    actions: true,
  });
  try {
    const paths = [
      [`/api/v1/projects/${PROJECT_A}/gmail/file`, { messageId: "message-1" }],
      [`/api/v1/projects/${PROJECT_A}/calendar/events`, { title: "FCI TEST — DO NOT USE" }],
      [`/api/v1/projects/${PROJECT_A}/files/${FILE_ID}/share`, { recipient: "test@example.test" }],
    ];
    for (const [path, payload] of paths) {
      const response = await running.request(path, {
        method: "POST",
        sameOrigin: true,
        csrf: true,
        json: payload,
      });
      assert.equal(response.status, 403, path);
      assert.deepEqual(await json(response), { error: "forbidden" }, path);
    }
    assert.equal(running.actionCalls.length, 0);
    assert.equal(running.audits.length, 3);
    assert.ok(running.audits.every(({ action }) => action === "authorization.access_denied"));
  } finally {
    await running.close();
  }
});

test("Administrator access projection is bounded, capability-gated, and race-fenced", async () => {
  const running = await startHarness({ role: AUTHORIZATION_ROLES.administrator });
  try {
    const response = await running.request("/api/v1/admin/access");
    assert.equal(response.status, 200);
    assert.deepEqual((await json(response)).data, ACCESS_OVERVIEW_FIXTURE);
    assert.deepEqual(running.adminAccessCalls.map(({ method }) => method), ["getAccessOverview"]);
    assert.equal(running.adminAccessCalls[0].checkedAt, NOW);
    assert.equal(running.adminAccessCalls[0].scope.kind, "company");
    assert.equal(running.adminAccessCalls[0].scope.includeFinancial, true);
    assert.deepEqual(
      running.repositoryCalls.capabilityChecks.map(({ capabilityKey }) => capabilityKey),
      [AUTHORIZATION_CAPABILITIES.accessAdminRead],
    );
    assert.equal(running.repositoryCalls.csrf.length, 0);

    const query = await running.request("/api/v1/admin/access?section=roles");
    assert.equal(query.status, 400);
    assert.deepEqual(await json(query), { error: "invalid_query" });

    const wrongMethod = await running.request("/api/v1/admin/access", {
      method: "POST",
      sameOrigin: true,
      csrf: true,
    });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "GET");
    assert.deepEqual(await json(wrongMethod), { error: "method_not_allowed" });
  } finally {
    await running.close();
  }

  for (const role of [AUTHORIZATION_ROLES.officeOperations, AUTHORIZATION_ROLES.projectManager]) {
    const denied = await startHarness({ role });
    try {
      const response = await denied.request("/api/v1/admin/access");
      assert.equal(response.status, 403, role);
      assert.deepEqual(await json(response), { error: "forbidden" });
      assert.equal(denied.adminAccessCalls.length, 0);
    } finally {
      await denied.close();
    }
  }

  const changed = await startHarness({
    role: AUTHORIZATION_ROLES.administrator,
    adminResults: { getAccessOverview: { outcome: "actor_authorization_changed" } },
  });
  try {
    const response = await changed.request("/api/v1/admin/access");
    assert.equal(response.status, 401);
    assert.deepEqual(await json(response), { error: "authentication_required" });
    assertSessionCleared(response);
  } finally {
    await changed.close();
  }
});

test("Administrator audit Activity uses strict filters, a one-way cursor, and minimized DTOs", async () => {
  const next = { occurredAt: NOW - 1_000, cursorKey: "a".repeat(64) };
  const running = await startHarness({
    role: AUTHORIZATION_ROLES.administrator,
    adminAuditResult: {
      outcome: "accepted",
      page: {
        events: [{
          actorLabel: "FCI TEST — DO NOT USE Administrator",
          actionLabel: "Access denied",
          targetLabel: "Security activity",
          result: "denied",
          reason: "Session expired after inactivity",
          occurredAt: NOW - 1_000,
        }],
        next,
        generatedAt: NOW,
      },
    },
  });
  try {
    const filters = "limit=25&from=2026-07-15T16%3A00%3A00.000Z&before=2026-07-16T16%3A00%3A00.000Z&result=denied&category=access";
    const response = await running.request(`/api/v1/admin/audit?${filters}`);
    assert.equal(response.status, 200);
    const payload = await json(response);
    assert.deepEqual(payload.data.events, [{
      actorLabel: "FCI TEST — DO NOT USE Administrator",
      actionLabel: "Access denied",
      targetLabel: "Security activity",
      result: "denied",
      reason: "Session expired after inactivity",
      occurredAt: NOW - 1_000,
    }]);
    assert.equal(payload.data.generatedAt, NOW);
    assert.match(payload.data.nextCursor, /^v2\.[A-Za-z0-9_-]+$/);
    const decodedCursor = Buffer.from(payload.data.nextCursor.split(".")[1], "base64url")
      .toString("utf8");
    assert.doesNotMatch(decodedCursor, new RegExp(INVITATION_ID, "i"));
    assert.match(decodedCursor, /"k":"[0-9a-f]{64}"/);
    assert.doesNotMatch(JSON.stringify(payload.data), new RegExp(INVITATION_ID, "i"));
    assert.deepEqual(running.adminAuditCalls[0].query, {
      from: Date.parse("2026-07-15T16:00:00.000Z"),
      before: Date.parse("2026-07-16T16:00:00.000Z"),
      result: "denied",
      category: "access",
      cursor: null,
      limit: 25,
    });

    const nextResponse = await running.request(
      `/api/v1/admin/audit?${filters}&cursor=${encodeURIComponent(payload.data.nextCursor)}`,
    );
    assert.equal(nextResponse.status, 200);
    await json(nextResponse);
    assert.deepEqual(running.adminAuditCalls[1].query.cursor, next);
    assert.ok(running.repositoryCalls.capabilityChecks
      .slice(-2)
      .every(({ capabilityKey }) => capabilityKey === AUTHORIZATION_CAPABILITIES.auditRead));

    const callsBeforeInvalid = running.adminAuditCalls.length;
    for (const path of [
      "/api/v1/admin/audit?unknown=value",
      "/api/v1/admin/audit?result=all&result=denied",
      "/api/v1/admin/audit?from=2026-07-15",
      "/api/v1/admin/audit?limit=51",
      "/api/v1/admin/audit?category=unknown",
      "/api/v1/admin/audit?cursor=v2.invalid",
      `/api/v1/admin/audit?category=people&cursor=${encodeURIComponent(payload.data.nextCursor)}`,
    ]) {
      const invalid = await running.request(path);
      assert.equal(invalid.status, 400, path);
      assert.deepEqual(await json(invalid), { error: "invalid_query" }, path);
    }
    assert.equal(running.adminAuditCalls.length, callsBeforeInvalid);
  } finally {
    await running.close();
  }

  for (const role of [
    AUTHORIZATION_ROLES.officeOperations,
    AUTHORIZATION_ROLES.projectManager,
  ]) {
    const denied = await startHarness({ role });
    try {
      const response = await denied.request("/api/v1/admin/audit");
      assert.equal(response.status, 403, role);
      assert.deepEqual(await json(response), { error: "forbidden" }, role);
      assert.equal(denied.adminAuditCalls.length, 0, role);
    } finally {
      await denied.close();
    }
  }

  const changed = await startHarness({
    role: AUTHORIZATION_ROLES.administrator,
    adminAuditResult: { outcome: "actor_authorization_changed" },
  });
  try {
    const response = await changed.request("/api/v1/admin/audit");
    assert.equal(response.status, 401);
    assert.deepEqual(await json(response), { error: "authentication_required" });
    assertSessionCleared(response);
  } finally {
    await changed.close();
  }
});

test("Administrator access routes expose only the five fixed workflows with transactional intents", async () => {
  const running = await startHarness({ role: AUTHORIZATION_ROLES.administrator });
  try {
    const invitationResponse = await running.request("/api/v1/admin/invitations", {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      json: {
        email: "New.PM@CherryHillFCI.com",
        role: "project_manager",
        projectIds: [PROJECT_A],
      },
    });
    assert.equal(invitationResponse.status, 201);
    const invitation = (await json(invitationResponse)).data;
    assert.match(invitation.id, /^[0-9a-f-]{36}$/i);
    assert.equal(invitation.email, "new.pm@cherryhillfci.com");
    assert.equal(invitation.role, "project_manager");
    assert.deepEqual(invitation.projectIds, [PROJECT_A]);
    assert.equal(invitation.invitationCredential, INVITATION_CREDENTIAL);
    assert.equal(invitation.expiresAt, NOW + 7 * 24 * 60 * 60_000);

    const revokeResponse = await running.request(
      `/api/v1/admin/invitations/${INVITATION_ID}/revoke`,
      {
        method: "POST",
        sameOrigin: true,
        csrf: true,
        json: { expectedVersion: "1", reason: "Position was not approved" },
      },
    );
    assert.equal(revokeResponse.status, 200);
    assert.deepEqual((await json(revokeResponse)).data, {
      id: INVITATION_ID,
      version: "2",
      status: "revoked",
    });

    const accessResponse = await running.request(
      `/api/v1/admin/users/${TARGET_USER_ID}/access`,
      {
        method: "POST",
        sameOrigin: true,
        csrf: true,
        json: {
          expectedVersion: "1",
          role: "office_operations",
          projectIds: [],
          reason: "Moved into the office team",
        },
      },
    );
    assert.equal(accessResponse.status, 200);
    assert.deepEqual((await json(accessResponse)).data, {
      id: TARGET_USER_ID,
      role: "office_operations",
      projectIds: [],
      version: "2",
      authorizationVersion: "2",
    });

    const disableResponse = await running.request(
      `/api/v1/admin/users/${TARGET_USER_ID}/disable`,
      {
        method: "POST",
        sameOrigin: true,
        csrf: true,
        json: { expectedVersion: "2", reason: "Employment ended" },
      },
    );
    assert.equal(disableResponse.status, 200);
    assert.equal((await json(disableResponse)).data.status, "disabled");

    const signOutResponse = await running.request(
      `/api/v1/admin/users/${TARGET_USER_ID}/sign-out`,
      {
        method: "POST",
        sameOrigin: true,
        csrf: true,
        json: { expectedVersion: "2", reason: "Security review" },
      },
    );
    assert.equal(signOutResponse.status, 200);
    assert.equal((await json(signOutResponse)).data.status, "signed_out");

    assert.deepEqual(running.adminAccessCalls.map(({ method }) => method), [
      "createInvitation",
      "revokeInvitation",
      "setUserAccess",
      "disableUser",
      "invalidateUserSessions",
    ]);
    const createIntent = running.adminAccessCalls[0].intent;
    assert.equal(createIntent.tokenHash, sha256(INVITATION_CREDENTIAL));
    assert.equal(createIntent.invitedByUserId, ROLE_IDENTITIES.administrator.userId);
    assert.equal(createIntent.actorSessionId, ROLE_IDENTITIES.administrator.sessionId);
    assert.equal(createIntent.actorSessionVersion, "1");
    assert.equal(createIntent.actorAuthorizationVersion, "1");
    assert.deepEqual(createIntent.projectIds, [PROJECT_A]);
    assert.equal(createIntent.audit.metadata.project_count, 1);
    assert.equal(running.adminAccessCalls[1].intent.audit.metadata.reason, "Position was not approved");
    assert.equal(running.adminAccessCalls[2].intent.reasonCode, "administrator_request");
    assert.equal(running.adminAccessCalls[2].intent.audit.metadata.reason, "Moved into the office team");
    assert.doesNotMatch(JSON.stringify(running.adminAccessCalls), new RegExp(INVITATION_CREDENTIAL));
    assert.doesNotMatch(JSON.stringify(running.audits), new RegExp(INVITATION_CREDENTIAL));
    assert.deepEqual(
      running.repositoryCalls.capabilityChecks.map(({ capabilityKey }) => capabilityKey),
      [
        AUTHORIZATION_CAPABILITIES.invitationsCreate,
        AUTHORIZATION_CAPABILITIES.invitationsRevoke,
        AUTHORIZATION_CAPABILITIES.rolesAssign,
        AUTHORIZATION_CAPABILITIES.usersDisable,
        AUTHORIZATION_CAPABILITIES.sessionsRevoke,
      ],
    );
  } finally {
    await running.close();
  }
});

test("Office and Project Manager sessions cannot invoke any access-administration command", async () => {
  const cases = [
    ["/api/v1/admin/invitations", {
      email: "new.person@cherryhillfci.com",
      role: "office_operations",
      projectIds: [],
    }],
    [`/api/v1/admin/invitations/${INVITATION_ID}/revoke`, {
      expectedVersion: "1",
      reason: "Not approved",
    }],
    [`/api/v1/admin/users/${TARGET_USER_ID}/access`, {
      expectedVersion: "1",
      role: "office_operations",
      projectIds: [],
      reason: "Test",
    }],
    [`/api/v1/admin/users/${TARGET_USER_ID}/disable`, {
      expectedVersion: "1",
      reason: "Test",
    }],
    [`/api/v1/admin/users/${TARGET_USER_ID}/sign-out`, {
      expectedVersion: "1",
      reason: "Test",
    }],
  ];

  for (const role of [AUTHORIZATION_ROLES.officeOperations, AUTHORIZATION_ROLES.projectManager]) {
    const running = await startHarness({ role });
    try {
      for (const [path, body] of cases) {
        const response = await running.request(path, {
          method: "POST",
          sameOrigin: true,
          csrf: true,
          json: body,
        });
        assert.equal(response.status, 403, `${role} ${path}`);
        assert.deepEqual(await json(response), { error: "forbidden" });
      }
      assert.equal(running.adminAccessCalls.length, 0);
    } finally {
      await running.close();
    }
  }
});

test("access-administration routes enforce origin, CSRF, closed bodies, and safe conflict responses", async () => {
  const running = await startHarness({ role: AUTHORIZATION_ROLES.administrator });
  try {
    for (const options of [
      {
        csrf: true,
        json: { expectedVersion: "1", reason: "Test" },
      },
      {
        sameOrigin: true,
        json: { expectedVersion: "1", reason: "Test" },
      },
    ]) {
      const response = await running.request(
        `/api/v1/admin/users/${TARGET_USER_ID}/disable`,
        { method: "POST", ...options },
      );
      assert.equal(response.status, 403);
      assert.deepEqual(await json(response), { error: "request_not_authorized" });
    }
    assert.equal(running.adminAccessCalls.length, 0);

    const malformedEmail = await running.request("/api/v1/admin/invitations", {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      json: {
        email: "a@b@cherryhillfci.com",
        role: "office_operations",
        projectIds: [],
      },
    });
    assert.equal(malformedEmail.status, 400);
    assert.deepEqual(await json(malformedEmail), { error: "invalid_admin_request" });
    assert.equal(running.adminAccessCalls.length, 0);

    for (const body of [
      { expectedVersion: "0", reason: "Test" },
      { expectedVersion: "1", reason: "" },
      { expectedVersion: "1", reason: "Test", extra: true },
    ]) {
      const response = await running.request(
        `/api/v1/admin/users/${TARGET_USER_ID}/disable`,
        {
          method: "POST",
          sameOrigin: true,
          csrf: true,
          json: body,
        },
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await json(response), { error: "invalid_admin_request" });
    }
    assert.equal(running.adminAccessCalls.length, 0);

    const wrongMethod = await running.request("/api/v1/admin/invitations");
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");
    assert.deepEqual(await json(wrongMethod), { error: "method_not_allowed" });
  } finally {
    await running.close();
  }

  for (const [label, adminResults, path, body, code] of [
    ["conflict", { createInvitation: { outcome: "conflict" } },
      "/api/v1/admin/invitations", {
        email: "new.person@cherryhillfci.com",
        role: "office_operations",
        projectIds: [],
      }, "access_conflict"],
    ["stale", { setUserAccess: { outcome: "stale" } },
      `/api/v1/admin/users/${TARGET_USER_ID}/access`, {
        expectedVersion: "1",
        role: "office_operations",
        projectIds: [],
        reason: "Test",
      }, "access_state_stale"],
    ["unchanged access", { setUserAccess: { outcome: "conflict" } },
      `/api/v1/admin/users/${TARGET_USER_ID}/access`, {
        expectedVersion: "1",
        role: "office_operations",
        projectIds: [],
        reason: "No-op test",
      }, "access_conflict"],
    ["final admin", { disableUser: { outcome: "final_active_administrator" } },
      `/api/v1/admin/users/${TARGET_USER_ID}/disable`, {
        expectedVersion: "1",
        reason: "Test",
      }, "final_active_administrator"],
  ]) {
    const failed = await startHarness({ role: AUTHORIZATION_ROLES.administrator, adminResults });
    try {
      const response = await failed.request(path, {
        method: "POST",
        sameOrigin: true,
        csrf: true,
        json: body,
      });
      assert.equal(response.status, 409, label);
      const responseBody = await json(response);
      assert.deepEqual(responseBody, { error: code }, label);
      assert.equal(JSON.stringify(responseBody).includes(INVITATION_CREDENTIAL), false);
    } finally {
      await failed.close();
    }
  }

  const actorChanged = await startHarness({
    role: AUTHORIZATION_ROLES.administrator,
    adminResults: { createInvitation: { outcome: "actor_authorization_changed" } },
  });
  try {
    const response = await actorChanged.request("/api/v1/admin/invitations", {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      json: {
        email: "new.person@cherryhillfci.com",
        role: "office_operations",
        projectIds: [],
      },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await json(response), { error: "authentication_required" });
    assert.equal(response.headers.get("set-cookie"), CLEAR_SESSION_COOKIE);
  } finally {
    await actorChanged.close();
  }
});

test("authorized project file and provider routes receive only server-derived context and bounded inputs", async () => {
  const running = await startHarness({
    role: AUTHORIZATION_ROLES.administrator,
    actions: true,
  });
  try {
    const cases = [
      ["GET", `/api/v1/projects/${PROJECT_A}/files`, undefined, "listFiles"],
      ["POST", `/api/v1/projects/${PROJECT_A}/files`, { filename: "test.pdf" }, "uploadFile"],
      ["POST", `/api/v1/projects/${PROJECT_A}/files/${FILE_ID}/share`, { recipient: "test@example.test" }, "shareFile"],
      ["POST", `/api/v1/projects/${PROJECT_A}/gmail/file`, { messageId: "message-1" }, "fileGmailMessage"],
      ["POST", `/api/v1/projects/${PROJECT_A}/calendar/events`, { title: "FCI TEST — DO NOT USE" }, "createCalendarEvent"],
    ];

    for (const [method, path, payload, action] of cases) {
      const response = await running.request(path, {
        method,
        ...(method === "POST"
          ? { sameOrigin: true, csrf: true, json: payload }
          : {}),
      });
      assert.equal(response.status, 200, action);
      const body = await json(response);
      assert.equal(body.data.action, action);
      assert.equal(body.data.projectId, PROJECT_A);
    }

    assert.deepEqual(running.actionCalls.map(({ name }) => name), cases.map((entry) => entry[3]));
    for (const { input } of running.actionCalls) {
      assert.equal(input.context.email, "admincrm@cherryhillfci.com");
      assert.equal(input.projectId, PROJECT_A);
      assert.match(input.requestId, /^[0-9a-f-]{36}$/i);
      assert.match(input.correlationId, /^[0-9a-f-]{36}$/i);
      assert.equal(Object.isFrozen(input), true);
      assert.equal(JSON.stringify(input).includes(SESSION_CREDENTIAL), false);
      assert.equal(JSON.stringify(input).includes(CSRF_CREDENTIAL), false);
    }
    assert.equal(running.actionCalls[2].input.fileId, FILE_ID);
  } finally {
    await running.close();
  }
});

test("authorized routes without production provider actions fail closed after authorization", async () => {
  const running = await startHarness({ role: AUTHORIZATION_ROLES.administrator });
  try {
    const response = await running.request(`/api/v1/projects/${PROJECT_A}/gmail/file`, {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      json: { messageId: "message-1" },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await json(response), { error: "feature_unavailable" });
    assert.ok(running.repositoryCalls.capabilityChecks.some(
      ({ capabilityKey }) => capabilityKey === AUTHORIZATION_CAPABILITIES.gmailFile,
    ));
    assert.equal(running.audits.at(-1)?.action, "authorization.access_allowed");
  } finally {
    await running.close();
  }
});

test("audit persistence failure fails closed before an authorized sensitive callback", async () => {
  const running = await startHarness({
    role: AUTHORIZATION_ROLES.administrator,
    actions: true,
    auditError: new Error("test-only audit unavailable secret-detail"),
  });
  try {
    const response = await running.request(`/api/v1/projects/${PROJECT_A}/gmail/file`, {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      json: { messageId: "message-1" },
    });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: "service_unavailable" });
    assert.doesNotMatch(body, /secret-detail|audit unavailable/i);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(running.actionCalls.length, 0);
  } finally {
    await running.close();
  }
});

test("logout requires same origin, revokes once, and clears only confirmed or unusable sessions", async () => {
  const running = await startHarness();
  try {
    const crossOrigin = await running.request("/api/v1/session/logout", {
      method: "POST",
      csrf: true,
    });
    assert.equal(crossOrigin.status, 403);
    assert.deepEqual(await json(crossOrigin), { error: "request_not_authorized" });
    assertSessionNotCleared(crossOrigin);
    assert.equal(running.revocations.length, 0);

    const first = await running.request("/api/v1/session/logout", {
      method: "POST",
      sameOrigin: true,
      csrf: true,
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await json(first), { outcome: "logged_out" });
    assertSessionCleared(first);
    assert.equal(running.revocations.length, 1);

    const repeated = await running.request("/api/v1/session/logout", {
      method: "POST",
      sameOrigin: true,
      csrf: true,
    });
    assert.equal(repeated.status, 200);
    assert.deepEqual(await json(repeated), { outcome: "logged_out" });
    assertSessionCleared(repeated);
    assert.equal(running.revocations.length, 1);

    const missingCredentials = await running.request("/api/v1/session/logout", {
      method: "POST",
      sameOrigin: true,
      authenticated: false,
    });
    assert.equal(missingCredentials.status, 200);
    assert.deepEqual(await json(missingCredentials), { outcome: "logged_out" });
    assertSessionCleared(missingCredentials);
    assert.equal(running.revocations.length, 1);
  } finally {
    await running.close();
  }
});

test("active logout CSRF mismatch and revocation failures retain the retryable cookie", async () => {
  const missingCsrf = await startHarness();
  try {
    const response = await missingCsrf.request("/api/v1/session/logout", {
      method: "POST",
      sameOrigin: true,
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await json(response), { error: "request_not_authorized" });
    assertSessionNotCleared(response);
    assert.equal(missingCsrf.revocations.length, 0);
    assert.equal(missingCsrf.audits.at(-1)?.reasonCode, "csrf_missing");
    assert.doesNotMatch(JSON.stringify(missingCsrf.audits.at(-1)), /__Host|sha256:|x-fci-csrf/i);
  } finally {
    await missingCsrf.close();
  }

  const mismatchedCsrf = await startHarness({ csrfMatches: false });
  try {
    const response = await mismatchedCsrf.request("/api/v1/session/logout", {
      method: "POST",
      sameOrigin: true,
      csrf: true,
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await json(response), { error: "request_not_authorized" });
    assertSessionNotCleared(response);
    assert.equal(mismatchedCsrf.revocations.length, 0);
    assert.equal(mismatchedCsrf.audits.at(-1)?.reasonCode, "csrf_mismatch");
  } finally {
    await mismatchedCsrf.close();
  }

  for (const [label, options] of [
    ["revocation write failure", { revocationError: new Error("test-only revoke failure") }],
    ["unconfirmed conflict", { revocationResult: { outcome: "conflict" } }],
  ]) {
    const failed = await startHarness(options);
    try {
      const response = await failed.request("/api/v1/session/logout", {
        method: "POST",
        sameOrigin: true,
        csrf: true,
      });
      assert.equal(response.status, 503, label);
      assert.deepEqual(await json(response), { error: "service_unavailable" }, label);
      assertSessionNotCleared(response);
      assert.equal(failed.revocations.length, 1);
    } finally {
      await failed.close();
    }
  }
});

test("transport-denial evidence fails closed without exposing or clearing credentials", async () => {
  const running = await startHarness({
    auditError: new Error("test-only transport audit unavailable secret-detail"),
  });
  try {
    const response = await running.request("/api/v1/session/logout", {
      method: "POST",
      csrf: true,
    });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: "service_unavailable" });
    assert.doesNotMatch(body, /secret-detail|audit unavailable/i);
    assertSessionNotCleared(response);
    assert.equal(running.revocations.length, 0);
  } finally {
    await running.close();
  }
});

test("query, body, URL, and method bounds reject before protected callbacks", async () => {
  const running = await startHarness({
    role: AUTHORIZATION_ROLES.administrator,
    actions: true,
  });
  try {
    const invalidSearches = [
      "/api/v1/search",
      "/api/v1/search?q=one&q=two",
      `/api/v1/search?q=${"a".repeat(201)}`,
      "/api/v1/search?q=test&extra=value",
    ];
    for (const path of invalidSearches) {
      const response = await running.request(path);
      assert.equal(response.status, 400, path);
      assert.deepEqual(await json(response), { error: "invalid_query" });
    }

    const unrelatedQuery = await running.request("/api/v1/projects?limit=10");
    assert.equal(unrelatedQuery.status, 400);
    assert.deepEqual(await json(unrelatedQuery), { error: "invalid_query" });

    const longUrl = await running.request(`/api/v1/search?q=${"a".repeat(2_100)}`);
    assert.equal(longUrl.status, 414);
    assert.deepEqual(await json(longUrl), { error: "uri_too_long" });

    const wrongMethod = await running.request("/api/v1/dashboard", { method: "POST" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "GET");
    assert.deepEqual(await json(wrongMethod), { error: "method_not_allowed" });

    const logoutGet = await running.request("/api/v1/session/logout");
    assert.equal(logoutGet.status, 405);
    assert.equal(logoutGet.headers.get("allow"), "POST");
    assert.deepEqual(await json(logoutGet), { error: "method_not_allowed" });

    const unsupportedType = await running.request(`/api/v1/projects/${PROJECT_A}/calendar/events`, {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      headers: { "Content-Type": "text/plain" },
      body: "not-json",
    });
    assert.equal(unsupportedType.status, 415);
    assert.deepEqual(await json(unsupportedType), { error: "unsupported_media_type" });

    const tooLarge = await running.request(`/api/v1/projects/${PROJECT_A}/calendar/events`, {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      json: { value: "a".repeat(70_000) },
    });
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(await json(tooLarge), { error: "request_too_large" });

    const malformed = await running.request(`/api/v1/projects/${PROJECT_A}/calendar/events`, {
      method: "POST",
      sameOrigin: true,
      csrf: true,
      json: "{not-json",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await json(malformed), { error: "invalid_json" });

    assert.equal(running.actionCalls.length, 0);
  } finally {
    await running.close();
  }
});
