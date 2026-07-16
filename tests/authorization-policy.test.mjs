import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/authorization-policy",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24701 } },
});

const {
  AUTHORIZATION_ACCESS_DEFAULTS,
  AUTHORIZATION_CAPABILITIES,
  AUTHORIZATION_DOMAIN,
  AUTHORIZATION_INITIAL_ADMIN_EMAILS,
  AUTHORIZATION_OPERATIONS,
  AUTHORIZATION_ROLES,
  approvedCapabilitiesForRole,
  authorizeOperation,
  evaluateEmployeeAdmission,
  resolveEmployeeAccessContext,
  resolveFieldLinkAccess,
} = await vite.ssrLoadModule("/app/application/authorization-policy.ts");

after(async () => {
  await vite.close();
});

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function sessionSnapshot(overrides = {}) {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    sessionVersion: "4",
    userId: "33333333-3333-4333-8333-333333333333",
    email: " AdminCRM@CherryHillFCI.com ",
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

function allowedContext(overrides = {}) {
  const decision = resolveEmployeeAccessContext(sessionSnapshot(overrides), NOW);
  assert.equal(decision.allowed, true);
  return decision.context;
}

test("approved role matrix grants only owner-approved capabilities", () => {
  const adminCapabilities = [
    AUTHORIZATION_CAPABILITIES.recordsRead,
    AUTHORIZATION_CAPABILITIES.leadsCreate,
    AUTHORIZATION_CAPABILITIES.leadsUpdate,
    AUTHORIZATION_CAPABILITIES.clientsCreate,
    AUTHORIZATION_CAPABILITIES.clientsUpdate,
    AUTHORIZATION_CAPABILITIES.contactsCreate,
    AUTHORIZATION_CAPABILITIES.contactsUpdate,
    AUTHORIZATION_CAPABILITIES.financialRead,
    AUTHORIZATION_CAPABILITIES.projectsCreate,
    AUTHORIZATION_CAPABILITIES.projectsAssign,
    AUTHORIZATION_CAPABILITIES.projectsStatusUpdate,
    AUTHORIZATION_CAPABILITIES.tasksUpdate,
    AUTHORIZATION_CAPABILITIES.meetingsUpdate,
    AUTHORIZATION_CAPABILITIES.notesUpdate,
    AUTHORIZATION_CAPABILITIES.gmailFile,
    AUTHORIZATION_CAPABILITIES.calendarCreate,
    AUTHORIZATION_CAPABILITIES.filesRead,
    AUTHORIZATION_CAPABILITIES.filesUpload,
    AUTHORIZATION_CAPABILITIES.filesShare,
    AUTHORIZATION_CAPABILITIES.dataExport,
    AUTHORIZATION_CAPABILITIES.auditRead,
    AUTHORIZATION_CAPABILITIES.accessAdminRead,
    AUTHORIZATION_CAPABILITIES.invitationsCreate,
    AUTHORIZATION_CAPABILITIES.invitationsRevoke,
    AUTHORIZATION_CAPABILITIES.usersDisable,
    AUTHORIZATION_CAPABILITIES.rolesAssign,
    AUTHORIZATION_CAPABILITIES.sessionsRevoke,
    AUTHORIZATION_CAPABILITIES.fieldLinksCreate,
    AUTHORIZATION_CAPABILITIES.fieldLinksRevoke,
    AUTHORIZATION_CAPABILITIES.rolePermissionsUpdate,
  ].sort();
  const officeCapabilities = [
    AUTHORIZATION_CAPABILITIES.recordsRead,
    AUTHORIZATION_CAPABILITIES.leadsCreate,
    AUTHORIZATION_CAPABILITIES.leadsUpdate,
    AUTHORIZATION_CAPABILITIES.clientsCreate,
    AUTHORIZATION_CAPABILITIES.clientsUpdate,
    AUTHORIZATION_CAPABILITIES.contactsCreate,
    AUTHORIZATION_CAPABILITIES.contactsUpdate,
    AUTHORIZATION_CAPABILITIES.projectsStatusUpdate,
    AUTHORIZATION_CAPABILITIES.tasksUpdate,
    AUTHORIZATION_CAPABILITIES.meetingsUpdate,
    AUTHORIZATION_CAPABILITIES.notesUpdate,
    AUTHORIZATION_CAPABILITIES.filesRead,
    AUTHORIZATION_CAPABILITIES.filesUpload,
  ];
  const projectManagerCapabilities = [
    AUTHORIZATION_CAPABILITIES.recordsRead,
    AUTHORIZATION_CAPABILITIES.projectsStatusUpdate,
    AUTHORIZATION_CAPABILITIES.tasksUpdate,
    AUTHORIZATION_CAPABILITIES.meetingsUpdate,
    AUTHORIZATION_CAPABILITIES.notesUpdate,
    AUTHORIZATION_CAPABILITIES.filesRead,
    AUTHORIZATION_CAPABILITIES.filesUpload,
  ];

  assert.deepEqual(
    [...approvedCapabilitiesForRole(AUTHORIZATION_ROLES.administrator)].sort(),
    adminCapabilities,
  );
  assert.deepEqual(
    approvedCapabilitiesForRole(AUTHORIZATION_ROLES.officeOperations),
    officeCapabilities,
  );
  assert.deepEqual(
    approvedCapabilitiesForRole(AUTHORIZATION_ROLES.projectManager),
    projectManagerCapabilities,
  );

  const explicitlyUnapproved = [
    AUTHORIZATION_CAPABILITIES.gmailRead,
    AUTHORIZATION_CAPABILITIES.calendarRead,
    AUTHORIZATION_CAPABILITIES.recordsWrite,
    AUTHORIZATION_CAPABILITIES.jobsRetry,
    AUTHORIZATION_CAPABILITIES.recoveryManage,
    AUTHORIZATION_CAPABILITIES.usersManage,
    AUTHORIZATION_CAPABILITIES.connectorsManage,
    AUTHORIZATION_CAPABILITIES.fieldAssignmentRead,
  ];
  for (const capability of explicitlyUnapproved) {
    assert.equal(adminCapabilities.includes(capability), false, capability);
  }
});

test("approved access defaults fix initial administrators and bounded credential lifetimes", () => {
  assert.deepEqual(AUTHORIZATION_INITIAL_ADMIN_EMAILS, [
    "admincrm@cherryhillfci.com",
    "brett@cherryhillfci.com",
  ]);
  assert.deepEqual(AUTHORIZATION_ACCESS_DEFAULTS, {
    invitationLifetimeMs: 7 * 24 * 60 * 60 * 1_000,
    sessionIdleLifetimeMs: 30 * 60 * 1_000,
    sessionAbsoluteLifetimeMs: 8 * 60 * 60 * 1_000,
    fieldLinkDefaultLifetimeMs: 7 * 24 * 60 * 60 * 1_000,
    fieldLinkMaximumLifetimeMs: 14 * 24 * 60 * 60 * 1_000,
    invitationSingleUse: true,
    fieldLinksReadOnly: true,
    perUserCapabilityOverrides: false,
  });
});

test("employee admission requires the exact Workspace domain, verification, invitation, and approved role", () => {
  assert.deepEqual(evaluateEmployeeAdmission({
    email: " AdminCRM@CherryHillFCI.com ",
    emailVerified: true,
    hostedDomain: "CHERRYHILLFCI.COM",
    explicitlyInvited: true,
    requestedRole: AUTHORIZATION_ROLES.administrator,
  }), {
    allowed: true,
    email: "admincrm@cherryhillfci.com",
    role: AUTHORIZATION_ROLES.administrator,
  });

  const deniedCases = [
    ["outside email domain", { email: "admin@example.com" }, "outside_domain"],
    ["outside hosted domain", { hostedDomain: "example.com" }, "outside_domain"],
    ["missing hosted domain", { hostedDomain: null }, "outside_domain"],
    ["unverified email", { emailVerified: false }, "email_unverified"],
    ["uninvited employee", { explicitlyInvited: false }, "invitation_required"],
    ["Field Lead account", { requestedRole: "field_lead" }, "employee_account_not_allowed"],
    ["subcontractor account", { requestedRole: "subcontractor" }, "employee_account_not_allowed"],
    ["excluded Sales/Estimator role", { requestedRole: "sales_estimator" }, "role_not_approved"],
  ];

  for (const [label, overrides, reason] of deniedCases) {
    const input = {
      email: `employee@${AUTHORIZATION_DOMAIN}`,
      emailVerified: true,
      hostedDomain: AUTHORIZATION_DOMAIN,
      explicitlyInvited: true,
      requestedRole: AUTHORIZATION_ROLES.officeOperations,
      ...overrides,
    };
    assert.deepEqual(evaluateEmployeeAdmission(input), { allowed: false, reason }, label);
  }
});

test("session resolution rejects missing, revoked, disabled, stale, invalidated, and expired sessions", () => {
  const deniedCases = [
    ["missing", null, "invalid_session"],
    ["no employee role", sessionSnapshot({ roleGrants: [] }), "role_not_approved"],
    ["revoked", sessionSnapshot({ revokedAt: NOW - 1 }), "session_revoked"],
    ["disabled", sessionSnapshot({ userStatus: "disabled" }), "user_disabled"],
    ["outside-domain session", sessionSnapshot({ email: "user@example.com" }), "outside_domain"],
    [
      "authorization version changed",
      sessionSnapshot({ sessionAuthorizationVersion: "8" }),
      "authorization_changed",
    ],
    ["sessions invalidated", sessionSnapshot({ sessionsValidAfter: NOW - 4_000 }), "session_invalidated"],
    ["issued in the future", sessionSnapshot({ issuedAt: NOW + 1 }), "invalid_session"],
    [
      "last seen before issue",
      sessionSnapshot({ lastSeenAt: NOW - 6_000 }),
      "invalid_session",
    ],
    [
      "idle deadline before last seen",
      sessionSnapshot({ idleExpiresAt: NOW - 2_000 }),
      "invalid_session",
    ],
    [
      "absolute deadline before issue",
      sessionSnapshot({ absoluteExpiresAt: NOW - 6_000 }),
      "invalid_session",
    ],
    [
      "absolute expiry boundary",
      sessionSnapshot({ idleExpiresAt: NOW, absoluteExpiresAt: NOW }),
      "absolute_expired",
    ],
    [
      "idle expiry boundary",
      sessionSnapshot({ idleExpiresAt: NOW, absoluteExpiresAt: NOW + 1 }),
      "idle_expired",
    ],
    [
      "no approved role",
      sessionSnapshot({
        roleGrants: [{
          roleKey: "sales_estimator",
          capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
        }],
      }),
      "role_not_approved",
    ],
    [
      "approved role mixed with an unknown role",
      sessionSnapshot({
        roleGrants: [
          {
            roleKey: AUTHORIZATION_ROLES.projectManager,
            capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
          },
          {
            roleKey: "future_role",
            capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
          },
        ],
      }),
      "role_not_approved",
    ],
    [
      "duplicate role grant",
      sessionSnapshot({
        roleGrants: [
          {
            roleKey: AUTHORIZATION_ROLES.projectManager,
            capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
          },
          {
            roleKey: AUTHORIZATION_ROLES.projectManager,
            capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
          },
        ],
      }),
      "role_not_approved",
    ],
    [
      "multiple supported employee roles",
      sessionSnapshot({
        roleGrants: [
          {
            roleKey: AUTHORIZATION_ROLES.officeOperations,
            capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
          },
          {
            roleKey: AUTHORIZATION_ROLES.projectManager,
            capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
          },
        ],
      }),
      "role_not_approved",
    ],
  ];

  for (const [label, snapshot, reason] of deniedCases) {
    assert.deepEqual(resolveEmployeeAccessContext(snapshot, NOW), {
      allowed: false,
      reason,
    }, label);
  }
});

test("session context intersects persisted grants with policy and applies role-specific record scope", () => {
  const admin = allowedContext();
  assert.equal(admin.email, "admincrm@cherryhillfci.com");
  assert.equal(admin.recordScope.kind, "company");
  assert.equal(admin.recordScope.sessionId, admin.sessionId);
  assert.equal(admin.recordScope.sessionVersion, admin.sessionVersion);
  assert.equal(admin.recordScope.includeFinancial, true);
  assert.equal(admin.capabilities.has(AUTHORIZATION_CAPABILITIES.gmailRead), false);
  assert.equal(admin.capabilities.has(AUTHORIZATION_CAPABILITIES.clientsCreate), true);
  assert.equal(admin.capabilities.has(AUTHORIZATION_CAPABILITIES.rolePermissionsUpdate), true);
  assert.equal(typeof admin.capabilities.add, "undefined");

  const office = allowedContext({
    roleGrants: [{
      roleKey: AUTHORIZATION_ROLES.officeOperations,
      capabilityKeys: Object.values(AUTHORIZATION_CAPABILITIES),
    }],
  });
  assert.equal(office.recordScope.kind, "company");
  assert.equal(office.recordScope.includeFinancial, false);
  assert.deepEqual(
    [...office.capabilities],
    approvedCapabilitiesForRole(AUTHORIZATION_ROLES.officeOperations),
  );
  assert.equal(office.capabilities.has(AUTHORIZATION_CAPABILITIES.projectsCreate), false);
  assert.equal(office.capabilities.has(AUTHORIZATION_CAPABILITIES.accessAdminRead), false);

  const projectManager = allowedContext({
    roleGrants: [{
      roleKey: AUTHORIZATION_ROLES.projectManager,
      capabilityKeys: Object.values(AUTHORIZATION_CAPABILITIES),
    }],
  });
  assert.equal(projectManager.recordScope.kind, "assigned_projects");
  assert.equal(projectManager.recordScope.includeFinancial, false);
  assert.deepEqual(
    [...projectManager.capabilities],
    approvedCapabilitiesForRole(AUTHORIZATION_ROLES.projectManager),
  );
  assert.equal(projectManager.capabilities.has(AUTHORIZATION_CAPABILITIES.clientsUpdate), false);
  assert.equal(projectManager.capabilities.has(AUTHORIZATION_CAPABILITIES.filesShare), false);

  const missingPersistedGrant = allowedContext({
    roleGrants: [{
      roleKey: AUTHORIZATION_ROLES.administrator,
      capabilityKeys: [AUTHORIZATION_CAPABILITIES.recordsRead],
    }],
  });
  assert.deepEqual([...missingPersistedGrant.capabilities], [AUTHORIZATION_CAPABILITIES.recordsRead]);
  assert.equal(missingPersistedGrant.recordScope.includeFinancial, false);
});

test("a single role cannot gain capabilities outside its approved matrix", () => {
  const misgrantedFinancial = allowedContext({
    roleGrants: [{
      roleKey: AUTHORIZATION_ROLES.officeOperations,
      capabilityKeys: [
        AUTHORIZATION_CAPABILITIES.recordsRead,
        AUTHORIZATION_CAPABILITIES.financialRead,
        AUTHORIZATION_CAPABILITIES.projectsCreate,
        AUTHORIZATION_CAPABILITIES.rolePermissionsUpdate,
      ],
    }],
  });
  assert.equal(misgrantedFinancial.recordScope.kind, "company");
  assert.equal(misgrantedFinancial.recordScope.includeFinancial, false);
  assert.equal(
    misgrantedFinancial.capabilities.has(AUTHORIZATION_CAPABILITIES.financialRead),
    false,
  );
  assert.equal(
    misgrantedFinancial.capabilities.has(AUTHORIZATION_CAPABILITIES.projectsCreate),
    false,
  );
  assert.equal(
    misgrantedFinancial.capabilities.has(AUTHORIZATION_CAPABILITIES.rolePermissionsUpdate),
    false,
  );
});

test("operations enforce required targets, approved capabilities, and deny unknown or unapproved actions", () => {
  const admin = allowedContext();
  const projectManager = allowedContext({
    roleGrants: [{
      roleKey: AUTHORIZATION_ROLES.projectManager,
      capabilityKeys: Object.values(AUTHORIZATION_CAPABILITIES),
    }],
  });

  assert.deepEqual(authorizeOperation(admin, AUTHORIZATION_OPERATIONS.gmailFile, "project-1"), {
    allowed: true,
    sensitive: true,
    requiresProjectCheck: true,
    capability: AUTHORIZATION_CAPABILITIES.gmailFile,
  });
  assert.deepEqual(authorizeOperation(admin, AUTHORIZATION_OPERATIONS.gmailFile), {
    allowed: false,
    reason: "project_required",
    sensitive: true,
  });
  assert.deepEqual(authorizeOperation(projectManager, AUTHORIZATION_OPERATIONS.projectView, "project-1"), {
    allowed: true,
    sensitive: false,
    requiresProjectCheck: true,
    capability: AUTHORIZATION_CAPABILITIES.recordsRead,
  });
  assert.deepEqual(authorizeOperation(projectManager, AUTHORIZATION_OPERATIONS.filesView, "project-1"), {
    allowed: true,
    sensitive: true,
    requiresProjectCheck: true,
    capability: AUTHORIZATION_CAPABILITIES.filesRead,
  });

  for (const operation of [
    AUTHORIZATION_OPERATIONS.financialsView,
    AUTHORIZATION_OPERATIONS.projectCreate,
    AUTHORIZATION_OPERATIONS.projectAssign,
    AUTHORIZATION_OPERATIONS.gmailFile,
    AUTHORIZATION_OPERATIONS.calendarCreate,
    AUTHORIZATION_OPERATIONS.filesShare,
    AUTHORIZATION_OPERATIONS.dataExport,
    AUTHORIZATION_OPERATIONS.auditView,
  ]) {
    const projectId = [
      AUTHORIZATION_OPERATIONS.gmailFile,
      AUTHORIZATION_OPERATIONS.filesShare,
      AUTHORIZATION_OPERATIONS.projectAssign,
    ].includes(operation) ? "project-1" : null;
    assert.deepEqual(authorizeOperation(projectManager, operation, projectId), {
      allowed: false,
      reason: "missing_capability",
      sensitive: true,
    }, operation);
  }

  for (const operation of [
    AUTHORIZATION_OPERATIONS.gmailRead,
    AUTHORIZATION_OPERATIONS.calendarRead,
    AUTHORIZATION_OPERATIONS.recordsWrite,
    AUTHORIZATION_OPERATIONS.jobsRetry,
    AUTHORIZATION_OPERATIONS.recoveryManage,
    AUTHORIZATION_OPERATIONS.usersManage,
    AUTHORIZATION_OPERATIONS.connectorsManage,
  ]) {
    const projectId = [
      AUTHORIZATION_OPERATIONS.filesView,
      AUTHORIZATION_OPERATIONS.recordsWrite,
    ].includes(operation) ? "project-1" : null;
    assert.deepEqual(authorizeOperation(admin, operation, projectId), {
      allowed: false,
      reason: "missing_capability",
      sensitive: true,
    }, operation);
  }

  assert.deepEqual(authorizeOperation(admin, "provider.delete_everything"), {
    allowed: false,
    reason: "unknown_operation",
    sensitive: true,
  });
});

test("Field Lead links expire or revoke and authorize only their exact project assignment", () => {
  const active = resolveFieldLinkAccess({
    linkId: "77777777-7777-4777-8777-777777777777",
    projectId: "55555555-5555-4555-8555-555555555555",
    expiresAt: NOW + 1,
    revokedAt: null,
  }, NOW);
  assert.equal(active.allowed, true);
  assert.deepEqual([...active.context.capabilities], [AUTHORIZATION_CAPABILITIES.fieldAssignmentRead]);
  assert.deepEqual(
    authorizeOperation(
      active.context,
      AUTHORIZATION_OPERATIONS.fieldAssignmentOpen,
      "55555555-5555-4555-8555-555555555555",
    ),
    {
      allowed: true,
      sensitive: true,
      requiresProjectCheck: false,
      capability: AUTHORIZATION_CAPABILITIES.fieldAssignmentRead,
    },
  );
  assert.deepEqual(
    authorizeOperation(
      active.context,
      AUTHORIZATION_OPERATIONS.fieldAssignmentOpen,
      "66666666-6666-4666-8666-666666666666",
    ),
    { allowed: false, reason: "outside_project_scope", sensitive: true },
  );
  assert.deepEqual(
    authorizeOperation(active.context, AUTHORIZATION_OPERATIONS.projectsList),
    { allowed: false, reason: "missing_capability", sensitive: false },
  );

  assert.deepEqual(resolveFieldLinkAccess({
    linkId: "77777777-7777-4777-8777-777777777777",
    projectId: "55555555-5555-4555-8555-555555555555",
    expiresAt: NOW,
    revokedAt: null,
  }, NOW), { allowed: false, reason: "link_expired" });
  assert.deepEqual(resolveFieldLinkAccess({
    linkId: "77777777-7777-4777-8777-777777777777",
    projectId: "55555555-5555-4555-8555-555555555555",
    expiresAt: NOW + 1,
    revokedAt: NOW - 1,
  }, NOW), { allowed: false, reason: "link_revoked" });
});
