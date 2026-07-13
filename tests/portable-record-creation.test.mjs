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
  vite.ssrLoadModule("/app/adapters/google/pilot-directory-mirror.ts"),
]);

after(async () => {
  await vite.close();
});

const { createClient } = clientApplication;
const { createProject } = projectApplication;
const { creationAuthorizationFor, CREATION_CAPABILITIES } = authorizationModule;
const { normalizeClientCreation } = clientDomain;
const { normalizeProjectCreation } = projectDomain;
const { createPilotDirectoryMirror } = mirrorAdapterModule;

function sequence(values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, "ID generator was called more times than expected");
    return values[index++];
  };
}

function authorized(capability, actorId = "simulated-office-user") {
  return creationAuthorizationFor({ actorId, capabilities: [capability] });
}

function unusedDependencies() {
  return {
    repository: { create: async () => assert.fail("repository must not be called") },
    directoryMirror: { requestSync: async () => assert.fail("mirror must not be called") },
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
      projectManager: null,
      estimatedValue: null,
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
    authorized(CREATION_CAPABILITIES.createClient, "pilot-user@cherryhillfci.com"),
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
          assert.deepEqual(request, { actorId: "pilot-user@cherryhillfci.com", cause: "client-created", recordId: "12345678-aaaa-bbbb-cccc-000000000001" });
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
      createdBy: "pilot-user@cherryhillfci.com",
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
      actor: "pilot-user@cherryhillfci.com",
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
      projectManager: "  Morgan  ",
      estimatedValue: 125000,
    },
    authorized(CREATION_CAPABILITIES.createProject, "pilot-user@cherryhillfci.com"),
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
          assert.deepEqual(request, { actorId: "pilot-user@cherryhillfci.com", cause: "project-created", recordId: "abcdef12-aaaa-bbbb-cccc-000000000001" });
          return { status: "not-configured", message: "The Google Sheet mirror is not configured yet." };
        },
      },
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
      projectManager: "Morgan",
      estimatedValue: 125000,
      createdBy: "pilot-user@cherryhillfci.com",
      createdAt: Date.UTC(2026, 6, 13, 12),
      updatedAt: Date.UTC(2026, 6, 13, 12),
    },
    activity: {
      id: "activity-project-1",
      recordId: "abcdef12-aaaa-bbbb-cccc-000000000001",
      action: "Project created",
      actor: "pilot-user@cherryhillfci.com",
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
      createdAt: Date.UTC(2026, 6, 13, 12),
      sheetSync: { status: "not-configured", message: "The Google Sheet mirror is not configured yet." },
    },
  });
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
    { repository: { create: async () => ({ outcome: "client-not-found" }) }, directoryMirror: mirror, newId: sequence(["project-id", "activity-id"]), now: () => Date.UTC(2026, 0, 1) },
  );

  assert.deepEqual(duplicate, { ok: false, kind: "duplicate", message: "A client with this business name already exists." });
  assert.deepEqual(missingClient, { ok: false, kind: "client-not-found", message: "client not found" });
  assert.equal(mirrorCalls, 0);
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

test("the pilot mirror adapter exposes only JSON-safe discriminated results", async () => {
  const pending = createPilotDirectoryMirror(async () => ({
    status: "pending",
    message: "Saved; sync pending.",
    error: { code: "sheets_unavailable", message: "Try again later.", accessToken: "must-not-leak" },
    internalConnection: "must-not-leak",
  }));
  const synced = createPilotDirectoryMirror(async () => ({
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

  assert.deepEqual(await pending.requestSync({ actorId: "pilot-user", cause: "client-created", recordId: "client-1" }), {
    status: "pending",
    message: "Saved; sync pending.",
    error: { code: "sheets_unavailable", message: "Try again later." },
  });
  assert.deepEqual(await synced.requestSync({ actorId: "pilot-user", cause: "project-created", recordId: "project-1" }), {
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
