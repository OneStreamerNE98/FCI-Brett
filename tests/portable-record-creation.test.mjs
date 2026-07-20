import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
});

const [clientApplication, projectApplication, authorizationModule, clientDomain, projectDomain, mirrorAdapterModule] = await Promise.all([
  vite.ssrLoadModule("/app/application/create-client.ts"),
  vite.ssrLoadModule("/app/application/create-project.ts"),
  vite.ssrLoadModule("/app/application/creation-authorization.ts"),
  vite.ssrLoadModule("/app/domain/client-creation.ts"),
  vite.ssrLoadModule("/app/domain/project-creation.ts"),
  vite.ssrLoadModule("/app/adapters/google/directory-mirror.ts"),
]);

after(async () => {
  await vite.close();
});

const { createClient } = clientApplication;
const { assignProjectManager, createProject } = projectApplication;
const { creationAuthorizationFor, CREATION_CAPABILITIES } = authorizationModule;
const { normalizeClientCreation } = clientDomain;
const { normalizeProjectCreation, normalizeProjectManagerAssignment, normalizeProjectManagerId, PROJECT_MANAGER_IDENTITY_ERROR } = projectDomain;
const { createDirectoryMirror } = mirrorAdapterModule;

function sequence(values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, "ID generator was called more times than expected");
    return values[index++];
  };
}

function authorized(capability, actorId = "simulated-office-user@example.test") {
  return creationAuthorizationFor({ actorId, capabilities: [capability] });
}

function unusedDependencies() {
  return {
    repository: { create: async () => assert.fail("repository must not be called") },
    directoryMirror: { requestSync: async () => assert.fail("mirror must not be called") },
    resolveProjectManagerId: async () => assert.fail("manager resolver must not be called"),
    newId: () => assert.fail("ID generator must not be called"),
    now: () => assert.fail("clock must not be called"),
  };
}

test("portable domain validation preserves the client and project API messages", () => {
  assert.deepEqual(normalizeClientCreation(null), { ok: false, message: "Client details must be valid JSON." });
  assert.deepEqual(normalizeClientCreation({ name: 42 }), { ok: false, message: "Client details must be valid JSON." });
  assert.deepEqual(normalizeClientCreation({ name: "  " }), { ok: false, message: "client name is required" });
  assert.deepEqual(normalizeClientCreation({ name: "x".repeat(181) }), { ok: false, message: "client name is too long" });
  assert.deepEqual(normalizeClientCreation({ name: "FCI Test", status: "unknown" }), { ok: false, message: "client status is invalid" });

  assert.deepEqual(normalizeProjectCreation([]), { ok: false, message: "Project details must be valid JSON." });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", estimatedValue: "100" }), { ok: false, message: "Project details must be valid JSON." });
  assert.deepEqual(normalizeProjectCreation({ clientId: "", name: "Test" }), { ok: false, message: "clientId and project name are required" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "x".repeat(181) }), { ok: false, message: "project name is too long" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", status: "unknown" }), { ok: false, message: "project status is invalid" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", estimatedValue: -1 }), { ok: false, message: "estimated value must be a non-negative whole number" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", flooringCategory: "vinyl" }), { ok: false, message: "flooring category is invalid" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", squareFeet: 0 }), { ok: false, message: "square feet must be a positive whole number" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", squareFeet: 12.5 }), { ok: false, message: "square feet must be a positive whole number" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", contractValue: -1 }), { ok: false, message: "contract value must be a non-negative whole number" });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", contractValue: "100" }), { ok: false, message: "Project details must be valid JSON." });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", projectManager: "Morgan" }), { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", projectManagerId: "manager@example.test", projectManager: "other@example.test" }), { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR });
  assert.deepEqual(normalizeProjectManagerId("  Manager@CherryHillFCI.com  "), { ok: true, value: "manager@cherryhillfci.com" });
  assert.deepEqual(normalizeProjectManagerId("manager name"), { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR });
  assert.deepEqual(normalizeProjectManagerId(`${"x".repeat(65)}@example.test`), { ok: false, message: PROJECT_MANAGER_IDENTITY_ERROR });
  assert.deepEqual(normalizeProjectManagerAssignment({ projectId: "project-1", projectManagerId: " MANAGER@Example.Test " }), {
    ok: true,
    value: { projectId: "project-1", projectManagerId: "manager@example.test" },
  });
  assert.deepEqual(normalizeProjectManagerAssignment({ projectId: "project-1", projectManagerId: "manager@example.test", name: "must not change" }), {
    ok: false,
    message: "Only projectId and projectManagerId can be changed here.",
  });

  assert.deepEqual(normalizeClientCreation({ name: "  FCI Test  " }), {
    ok: true,
    value: { name: "FCI Test", industry: null, status: "active", primaryContact: null },
  });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "  FCI Test Project  " }), {
    ok: true,
    value: {
      clientId: "client-1",
      name: "FCI Test Project",
      status: "planning",
      site: null,
      projectManagerId: null,
      estimatedValue: null,
      flooringCategory: null,
      squareFeet: null,
      contractValue: null,
    },
  });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "Test", projectManager: "  MANAGER@Example.Test " }), {
    ok: true,
    value: {
      clientId: "client-1",
      name: "Test",
      status: "planning",
      site: null,
      projectManagerId: "manager@example.test",
      estimatedValue: null,
      flooringCategory: null,
      squareFeet: null,
      contractValue: null,
    },
  });
  assert.deepEqual(normalizeProjectCreation({ clientId: "client-1", name: "KPI fields", flooringCategory: " LUXURY-VINYL ", squareFeet: 2_500, contractValue: 0 }), {
    ok: true,
    value: {
      clientId: "client-1",
      name: "KPI fields",
      status: "planning",
      site: null,
      projectManagerId: null,
      estimatedValue: null,
      flooringCategory: "luxury-vinyl",
      squareFeet: 2_500,
      contractValue: 0,
    },
  });
});

test("simulated identities need the explicit capability before validation or persistence", async () => {
  const noCapabilities = creationAuthorizationFor({ actorId: "simulated-read-only-user", capabilities: [] });
  const client = await createClient({ name: "Test" }, noCapabilities, unusedDependencies());
  const project = await createProject({ clientId: "client-1", name: "Test" }, noCapabilities, unusedDependencies());

  assert.deepEqual(client, { ok: false, kind: "forbidden", message: "You do not have permission to create clients." });
  assert.deepEqual(project, { ok: false, kind: "forbidden", message: "You do not have permission to create projects." });
});

test("client creation sends one atomic client, contact, and activity intent before mirroring", async () => {
  const events = [];
  const intents = [];
  const sheetSync = {
    status: "synced",
    message: "Saved and synced.",
    result: {
      clients: { inserted: 0, updated: 1, total: 1 },
      projects: { total: 0 },
      spreadsheetUrl: null,
      completedAt: 1_783_914_000_000,
    },
  };
  const result = await createClient(
    {
      name: "  FCI TEST Client  ",
      industry: "  Healthcare  ",
      status: " Prospect ",
      primaryContact: { name: "  Pat Person  ", email: " pat@example.test ", phone: "555-0100" },
    },
    authorized(CREATION_CAPABILITIES.createClient, "development-user@cherryhillfci.com"),
    {
      repository: {
        async create(intent) {
          events.push("durable-client");
          intents.push(intent);
          return { outcome: "created" };
        },
      },
      directoryMirror: {
        async requestSync(request) {
          assert.deepEqual(events, ["durable-client"]);
          events.push("mirror");
          assert.deepEqual(request, { actorId: "development-user@cherryhillfci.com", cause: "client-created", recordId: "12345678-aaaa-bbbb-cccc-000000000001" });
          return sheetSync;
        },
      },
      newId: sequence([
        "12345678-aaaa-bbbb-cccc-000000000001",
        "activity-client-1",
        "contact-client-1",
      ]),
      now: () => 1_783_914_000_000,
    },
  );

  assert.equal(intents.length, 1);
  assert.deepEqual(intents[0], {
    client: {
      id: "12345678-aaaa-bbbb-cccc-000000000001",
      clientCode: "CL-12345678",
      name: "FCI TEST Client",
      status: "prospect",
      industry: "Healthcare",
      createdBy: "development-user@cherryhillfci.com",
      createdAt: 1_783_914_000_000,
      updatedAt: 1_783_914_000_000,
    },
    primaryContact: {
      id: "contact-client-1",
      clientId: "12345678-aaaa-bbbb-cccc-000000000001",
      name: "Pat Person",
      email: " pat@example.test ",
      phone: "555-0100",
      role: "Primary contact",
      isPrimary: true,
      createdAt: 1_783_914_000_000,
      updatedAt: 1_783_914_000_000,
    },
    activity: {
      id: "activity-client-1",
      recordId: "12345678-aaaa-bbbb-cccc-000000000001",
      action: "Client created",
      actor: "development-user@cherryhillfci.com",
      detail: "CL-12345678 · FCI TEST Client",
      createdAt: 1_783_914_000_000,
    },
  });
  assert.deepEqual(events, ["durable-client", "mirror"]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      id: "12345678-aaaa-bbbb-cccc-000000000001",
      clientCode: "CL-12345678",
      name: "FCI TEST Client",
      createdAt: 1_783_914_000_000,
      sheetSync,
    },
  });
});

test("project creation sends one atomic project and activity intent before mirroring", async () => {
  const events = [];
  let intent;
  const result = await createProject(
    {
      clientId: "client-1",
      name: "  Lobby Flooring  ",
      status: " Mobilizing ",
      site: "  Cherry Hill, NJ  ",
      projectManagerId: "  Manager@CherryHillFCI.com  ",
      estimatedValue: 125000,
      flooringCategory: "tile-stone",
      squareFeet: 5_000,
      contractValue: 130000,
    },
    authorized(CREATION_CAPABILITIES.createProject, "development-user@cherryhillfci.com"),
    {
      repository: {
        async create(value) {
          events.push("durable-project");
          intent = value;
          return { outcome: "created" };
        },
      },
      directoryMirror: {
        async requestSync(request) {
          assert.deepEqual(events, ["durable-project"]);
          events.push("mirror");
          assert.deepEqual(request, { actorId: "development-user@cherryhillfci.com", cause: "project-created", recordId: "abcdef12-aaaa-bbbb-cccc-000000000001" });
          return { status: "not-configured", message: "The Google Sheet mirror is not configured yet." };
        },
      },
      resolveProjectManagerId: async (candidateId) => candidateId === "manager@cherryhillfci.com" ? candidateId : null,
      newId: sequence(["abcdef12-aaaa-bbbb-cccc-000000000001", "activity-project-1"]),
      now: () => Date.UTC(2026, 6, 13, 12),
    },
  );

  assert.deepEqual(intent, {
    project: {
      id: "abcdef12-aaaa-bbbb-cccc-000000000001",
      projectNumber: "CF-2026-ABCDEF12",
      clientId: "client-1",
      name: "Lobby Flooring",
      status: "mobilizing",
      site: "Cherry Hill, NJ",
      projectManagerId: "manager@cherryhillfci.com",
      estimatedValue: 125000,
      flooringCategory: "tile-stone",
      squareFeet: 5000,
      contractValue: 130000,
      createdBy: "development-user@cherryhillfci.com",
      createdAt: Date.UTC(2026, 6, 13, 12),
      updatedAt: Date.UTC(2026, 6, 13, 12),
    },
    activity: {
      id: "activity-project-1",
      recordId: "abcdef12-aaaa-bbbb-cccc-000000000001",
      action: "Project created",
      actor: "development-user@cherryhillfci.com",
      detail: "CF-2026-ABCDEF12 · Lobby Flooring",
      createdAt: Date.UTC(2026, 6, 13, 12),
    },
  });
  assert.deepEqual(events, ["durable-project", "mirror"]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      id: "abcdef12-aaaa-bbbb-cccc-000000000001",
      projectNumber: "CF-2026-ABCDEF12",
      projectManagerId: "manager@cherryhillfci.com",
      createdAt: Date.UTC(2026, 6, 13, 12),
      sheetSync: { status: "not-configured", message: "The Google Sheet mirror is not configured yet." },
    },
  });
});

test("project creation rejects an unlisted manager and defaults an omitted manager to the authorized actor", async () => {
  const rejected = await createProject(
    { clientId: "client-1", name: "Rejected", projectManagerId: "outsider@example.test" },
    authorized(CREATION_CAPABILITIES.createProject, "creator@example.test"),
    {
      repository: { create: async () => assert.fail("repository must not be called") },
      directoryMirror: { requestSync: async () => assert.fail("mirror must not be called") },
      resolveProjectManagerId: async () => null,
      newId: () => assert.fail("ID generator must not be called"),
      now: () => assert.fail("clock must not be called"),
    },
  );
  assert.deepEqual(rejected, { ok: false, kind: "project-manager-not-authorized", message: PROJECT_MANAGER_IDENTITY_ERROR });

  let createdIntent;
  const defaulted = await createProject(
    { clientId: "client-1", name: "Creator-managed" },
    authorized(CREATION_CAPABILITIES.createProject, "CREATOR@Example.Test"),
    {
      repository: { create: async (intent) => { createdIntent = intent; return { outcome: "created" }; } },
      directoryMirror: { requestSync: async () => ({ status: "not-configured", message: "Not configured." }) },
      resolveProjectManagerId: async (candidateId) => candidateId === "creator@example.test" ? candidateId : null,
      newId: sequence(["project-default", "activity-default"]),
      now: () => Date.UTC(2026, 6, 13),
    },
  );
  assert.equal(createdIntent.project.projectManagerId, "creator@example.test");
  assert.equal(defaulted.ok, true);
  assert.equal(defaulted.value.projectManagerId, "creator@example.test");
});

test("admin project-manager correction is narrow, authorized, and audited", async () => {
  let assignment;
  const result = await assignProjectManager(
    { projectId: "project-1", projectManagerId: " MANAGER@Example.Test " },
    { actorId: "admin@example.test", canManageProjects: true },
    {
      repository: { assignManager: async (intent) => { assignment = intent; return { outcome: "updated" }; } },
      resolveProjectManagerId: async (candidateId) => candidateId === "manager@example.test" ? candidateId : null,
      newId: () => "manager-activity-1",
      now: () => 1_784_000_000_000,
    },
  );
  assert.deepEqual(assignment, {
    projectId: "project-1",
    projectManagerId: "manager@example.test",
    updatedAt: 1_784_000_000_000,
    activity: {
      id: "manager-activity-1",
      recordId: "project-1",
      action: "Project manager assigned",
      actor: "admin@example.test",
      detail: "Project manager assigned to manager@example.test",
      createdAt: 1_784_000_000_000,
    },
  });
  assert.deepEqual(result, {
    ok: true,
    value: { projectId: "project-1", projectManagerId: "manager@example.test", updatedAt: 1_784_000_000_000 },
  });

  const forbidden = await assignProjectManager(
    { projectId: "project-1", projectManagerId: "manager@example.test" },
    { actorId: "office@example.test", canManageProjects: false },
    {
      repository: { assignManager: async () => assert.fail("repository must not be called") },
      resolveProjectManagerId: async () => assert.fail("manager resolver must not be called"),
      newId: () => assert.fail("ID generator must not be called"),
      now: () => assert.fail("clock must not be called"),
    },
  );
  assert.deepEqual(forbidden, { ok: false, kind: "forbidden", message: "You do not have permission to change project managers." });

  const unlisted = await assignProjectManager(
    { projectId: "project-1", projectManagerId: "outsider@example.test" },
    { actorId: "admin@example.test", canManageProjects: true },
    {
      repository: { assignManager: async () => assert.fail("repository must not be called") },
      resolveProjectManagerId: async () => null,
      newId: () => assert.fail("ID generator must not be called"),
      now: () => assert.fail("clock must not be called"),
    },
  );
  assert.deepEqual(unlisted, { ok: false, kind: "project-manager-not-authorized", message: PROJECT_MANAGER_IDENTITY_ERROR });

  const missing = await assignProjectManager(
    { projectId: "missing-project", projectManagerId: "manager@example.test" },
    { actorId: "admin@example.test", canManageProjects: true },
    {
      repository: { assignManager: async () => ({ outcome: "project-not-found" }) },
      resolveProjectManagerId: async (candidateId) => candidateId,
      newId: () => "missing-activity",
      now: () => 1_784_000_000_001,
    },
  );
  assert.deepEqual(missing, { ok: false, kind: "project-not-found", message: "project not found" });
});

test("duplicate clients and missing project clients map exactly and never request a mirror", async () => {
  let mirrorCalls = 0;
  const mirror = { requestSync: async () => { mirrorCalls += 1; return { status: "synced", message: "unexpected" }; } };
  const duplicate = await createClient(
    { name: "FCI TEST Client" },
    authorized(CREATION_CAPABILITIES.createClient),
    { repository: { create: async () => ({ outcome: "duplicate" }) }, directoryMirror: mirror, newId: sequence(["client-id", "activity-id"]), now: () => 1 },
  );
  const missingClient = await createProject(
    { clientId: "missing", name: "FCI TEST Project" },
    authorized(CREATION_CAPABILITIES.createProject),
    { repository: { create: async () => ({ outcome: "client-not-found" }) }, directoryMirror: mirror, resolveProjectManagerId: async (candidateId) => candidateId, newId: sequence(["project-id", "activity-id"]), now: () => Date.UTC(2026, 0, 1) },
  );

  assert.deepEqual(duplicate, { ok: false, kind: "duplicate", message: "A client with this business name already exists." });
  assert.deepEqual(missingClient, { ok: false, kind: "client-not-found", message: "client not found" });
  assert.equal(mirrorCalls, 0);
});

test("generated PostgreSQL identifier collisions return a safe retry result without mirroring", async () => {
  const mirror = { requestSync: async () => assert.fail("identifier collisions must not request a mirror") };
  const client = await createClient(
    { name: "FCI TEST Client" },
    authorized(CREATION_CAPABILITIES.createClient),
    {
      repository: { create: async () => ({ outcome: "identifier-collision" }) },
      directoryMirror: mirror,
      newId: sequence(["client-id", "activity-id"]),
      now: () => 1,
    },
  );
  const project = await createProject(
    { clientId: "client-id", name: "FCI TEST Project" },
    authorized(CREATION_CAPABILITIES.createProject),
    {
      repository: { create: async () => ({ outcome: "identifier-collision" }) },
      directoryMirror: mirror,
      resolveProjectManagerId: async (candidateId) => candidateId,
      newId: sequence(["project-id", "activity-id"]),
      now: () => Date.UTC(2026, 0, 1),
    },
  );

  assert.deepEqual(client, {
    ok: false,
    kind: "identifier-collision",
    message: "A client identifier collision occurred. Retry the request.",
  });
  assert.deepEqual(project, {
    ok: false,
    kind: "identifier-collision",
    message: "A project identifier collision occurred. Retry the request.",
  });
});

test("a thrown optional mirror leaves both durable creates successful with a truthful pending result", async () => {
  const events = [];
  const throwingMirror = {
    async requestSync() {
      assert.match(events.at(-1), /^durable-/);
      events.push("mirror-threw");
      throw new Error("provider unavailable");
    },
  };
  const client = await createClient(
    { name: "FCI TEST Client" },
    authorized(CREATION_CAPABILITIES.createClient),
    {
      repository: { create: async () => { events.push("durable-client"); return { outcome: "created" }; } },
      directoryMirror: throwingMirror,
      newId: sequence(["client-id", "client-activity"]),
      now: () => 1,
    },
  );
  const project = await createProject(
    { clientId: "client-id", name: "FCI TEST Project" },
    authorized(CREATION_CAPABILITIES.createProject),
    {
      repository: { create: async () => { events.push("durable-project"); return { outcome: "created" }; } },
      directoryMirror: throwingMirror,
      resolveProjectManagerId: async (candidateId) => candidateId,
      newId: sequence(["project-id", "project-activity"]),
      now: () => Date.UTC(2026, 0, 1),
    },
  );

  for (const result of [client, project]) {
    assert.equal(result.ok, true);
    assert.equal(result.value.sheetSync.status, "pending");
    assert.match(result.value.sheetSync.message, /Saved in FCI Operations/);
    assert.deepEqual(result.value.sheetSync.error, {
      code: "directory_mirror_failed",
      message: "The optional directory mirror request did not complete; the FCI Operations record is saved.",
    });
  }
  assert.deepEqual(events, ["durable-client", "mirror-threw", "durable-project", "mirror-threw"]);
});

test("an idempotent PostgreSQL replay returns the stored record without repeating the mirror", async () => {
  const mirror = { requestSync: async () => assert.fail("a replayed outbox request must not call the development mirror") };
  const client = await createClient(
    { name: "Retry generated name" },
    authorized(CREATION_CAPABILITIES.createClient),
    {
      repository: {
        create: async () => ({
          outcome: "accepted",
          replayed: true,
          value: {
            id: "11111111-1111-4111-8111-111111111111",
            clientCode: "CL-11111111",
            name: "Original accepted client",
            createdAt: 1_784_100_000_000,
            version: "2",
          },
        }),
      },
      directoryMirror: mirror,
      newId: sequence(["retry-client-id", "retry-client-activity"]),
      now: () => 1_784_200_000_000,
    },
  );
  const project = await createProject(
    { clientId: "retry-client-id", name: "Retry generated project" },
    authorized(CREATION_CAPABILITIES.createProject),
    {
      repository: {
        create: async () => ({
          outcome: "accepted",
          replayed: true,
          value: {
            id: "22222222-2222-4222-8222-222222222222",
            projectNumber: "CF-2026-22222222",
            projectManagerId: "simulated-office-user@example.test",
            createdAt: 1_784_100_000_000,
            estimatedValue: 125000,
            version: "3",
          },
        }),
      },
      directoryMirror: mirror,
      resolveProjectManagerId: async (candidateId) => candidateId,
      newId: sequence(["retry-project-id", "retry-project-activity"]),
      now: () => 1_784_200_000_000,
    },
  );

  assert.deepEqual(client, {
    ok: true,
    value: {
      id: "11111111-1111-4111-8111-111111111111",
      clientCode: "CL-11111111",
      name: "Original accepted client",
      createdAt: 1_784_100_000_000,
      version: "2",
      sheetSync: {
        status: "queued",
        message: "Saved in FCI Operations; directory synchronization is queued for background processing.",
      },
    },
  });
  assert.deepEqual(project, {
    ok: true,
    value: {
      id: "22222222-2222-4222-8222-222222222222",
      projectNumber: "CF-2026-22222222",
      projectManagerId: "simulated-office-user@example.test",
      createdAt: 1_784_100_000_000,
      version: "3",
      sheetSync: {
        status: "queued",
        message: "Saved in FCI Operations; directory synchronization is queued for background processing.",
      },
    },
  });
});

test("creation services expose typed idempotency conflict and in-progress outcomes", async () => {
  const mirror = { requestSync: async () => assert.fail("idempotency failures must not mirror") };
  const client = await createClient(
    { name: "Conflict" },
    authorized(CREATION_CAPABILITIES.createClient),
    {
      repository: { create: async () => ({ outcome: "idempotency-conflict" }) },
      directoryMirror: mirror,
      newId: sequence(["client-id", "activity-id"]),
      now: () => 1,
    },
  );
  const project = await createProject(
    { clientId: "client-id", name: "In progress" },
    authorized(CREATION_CAPABILITIES.createProject),
    {
      repository: { create: async () => ({ outcome: "in-progress" }) },
      directoryMirror: mirror,
      resolveProjectManagerId: async (candidateId) => candidateId,
      newId: sequence(["project-id", "activity-id"]),
      now: () => Date.UTC(2026, 0, 1),
    },
  );

  assert.deepEqual(client, {
    ok: false,
    kind: "idempotency-conflict",
    message: "This request key was already used for different client details.",
  });
  assert.deepEqual(project, {
    ok: false,
    kind: "in-progress",
    message: "This project request is already being processed. Retry with the same request key.",
  });
});

test("the directory mirror adapter exposes only JSON-safe discriminated results", async () => {
  const pending = createDirectoryMirror(async () => ({
    status: "pending",
    message: "Saved; sync pending.",
    error: { code: "sheets_unavailable", message: "Try again later.", accessToken: "must-not-leak" },
    internalConnection: "must-not-leak",
  }));
  const synced = createDirectoryMirror(async () => ({
    status: "synced",
    message: "Saved and synced.",
    result: {
      clients: { inserted: 0, updated: 1, total: 1, internalRows: ["must-not-leak"] },
      projects: { total: 2, internalRows: ["must-not-leak"] },
      spreadsheetUrl: "https://docs.google.test/spreadsheets/d/test",
      completedAt: 1_783_914_000_000,
      accessToken: "must-not-leak",
    },
  }));

  assert.deepEqual(await pending.requestSync({ actorId: "development-user", cause: "client-created", recordId: "client-1" }), {
    status: "pending",
    message: "Saved; sync pending.",
    error: { code: "sheets_unavailable", message: "Try again later." },
  });
  assert.deepEqual(await synced.requestSync({ actorId: "development-user", cause: "project-created", recordId: "project-1" }), {
    status: "synced",
    message: "Saved and synced.",
    result: {
      clients: { inserted: 0, updated: 1, total: 1 },
      projects: { total: 2 },
      spreadsheetUrl: "https://docs.google.test/spreadsheets/d/test",
      completedAt: 1_783_914_000_000,
    },
  });
});

test("domain and application services have no framework or provider imports", async () => {
  const paths = [
    "app/application/create-client.ts",
    "app/application/create-project.ts",
    "app/application/creation-authorization.ts",
    "app/application/mirror-after-create.ts",
    "app/domain/client-creation.ts",
    "app/domain/project-creation.ts",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(path, rootUrl), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /next\/server|cloudflare:workers|google-/i);
  }
});
