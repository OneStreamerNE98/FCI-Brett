import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { NextRequest } from "next/server.js";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const cloudflareEnv = {
  DB: null,
  FCI_OFFICE_EMAILS: "admin@example.test,office@example.test",
  FCI_OFFICE_DOMAINS: "",
  FCI_ADMIN_EMAILS: "admin@example.test",
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = cloudflareEnv;

const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/edit06-client-contact-editing",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("fixtures/cloudflare-workers.mjs", import.meta.url),
      ),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24806 } },
});

const [
  clientRoute,
  contactRoute,
  clientPatchModule,
  contactPatchModule,
  clientCreationModule,
  createClientModule,
  d1ClientRepositoryModule,
] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/clients/[clientId]/route.ts"),
  vite.ssrLoadModule("/app/api/v1/contacts/[contactId]/route.ts"),
  vite.ssrLoadModule("/app/domain/client-patch.ts"),
  vite.ssrLoadModule("/app/domain/contact-patch.ts"),
  vite.ssrLoadModule("/app/domain/client-creation.ts"),
  vite.ssrLoadModule("/app/application/create-client.ts"),
  vite.ssrLoadModule("/app/adapters/d1/client-repository.ts"),
]);

const { CLIENT_PATCH_KEYS, normalizeClientPatch } = clientPatchModule;
const { CONTACT_PATCH_KEYS, normalizeContactPatch } = contactPatchModule;
const { normalizeClientCreation } = clientCreationModule;
const { createClient } = createClientModule;
const { createD1ClientRepository } = d1ClientRepositoryModule;

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

const CLIENT_ID = "client-edit-fixture";
const OTHER_CLIENT_ID = "client-edit-other";
const CONTACT_ID = "contact-edit-fixture";
const UPDATED_AT = Date.UTC(2026, 6, 29, 16, 0, 0);

class SqliteD1Statement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class ClientD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.preparedSql = [];
    this.batchTail = Promise.resolve();
    this.database.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        client_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL UNIQUE,
        normalized_name_key TEXT,
        status TEXT NOT NULL,
        industry TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX clients_normalized_name_key_unique_idx
        ON clients (normalized_name_key)
        WHERE normalized_name_key IS NOT NULL;
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        role TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.database.prepare(`
      INSERT INTO clients (
        id, client_code, name, status, industry, created_by,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1), (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      CLIENT_ID,
      "CL-EDIT0001",
      "FCI TEST — DO NOT USE Alpha",
      "active",
      "Commercial",
      "admin@example.test",
      UPDATED_AT - 1_000,
      UPDATED_AT - 1_000,
      OTHER_CLIENT_ID,
      "CL-EDIT0002",
      "FCI TEST — DO NOT USE Beta",
      "active",
      "Residential",
      "admin@example.test",
      UPDATED_AT - 1_000,
      UPDATED_AT - 1_000,
    );
    this.database.prepare(`
      INSERT INTO contacts (
        id, client_id, name, email, phone, role, is_primary,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 1)
    `).run(
      CONTACT_ID,
      CLIENT_ID,
      "Original Contact",
      "original@example.test",
      null,
      "Primary contact",
      UPDATED_AT - 1_000,
      UPDATED_AT - 1_000,
    );
  }

  prepare(sql) {
    this.preparedSql.push(sql);
    return new SqliteD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    const previousBatch = this.batchTail;
    let releaseBatch;
    this.batchTail = new Promise((resolve) => {
      releaseBatch = resolve;
    });
    await previousBatch;
    const results = [];
    try {
      this.database.exec("BEGIN");
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      releaseBatch();
    }
  }

  client(id = CLIENT_ID) {
    return {
      ...this.database.prepare(
        "SELECT name, status, industry, version FROM clients WHERE id = ?",
      ).get(id),
    };
  }

  contact() {
    return {
      ...this.database.prepare(
        "SELECT name, email, phone, role, version FROM contacts WHERE id = ?",
      ).get(CONTACT_ID),
    };
  }

  normalizedNameKey(id = CLIENT_ID) {
    return this.database.prepare(
      "SELECT normalized_name_key FROM clients WHERE id = ?",
    ).get(id)?.normalized_name_key ?? null;
  }

  activities() {
    return this.database
      .prepare("SELECT record_id, action, actor, detail FROM activity_events ORDER BY rowid")
      .all()
      .map((row) => ({ ...row }));
  }

  close() {
    this.database.close();
  }
}

function patchRequest(route, database, id, body, email = "office@example.test") {
  cloudflareEnv.DB = database;
  const resource = route === clientRoute ? "clients" : "contacts";
  const parameter = route === clientRoute ? "clientId" : "contactId";
  return route.PATCH(
    new NextRequest(`https://fci.example.test/api/v1/${resource}/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://fci.example.test",
        "oai-authenticated-user-email": email,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ [parameter]: id }) },
  );
}

test("client and contact patch validators are closed, partial, and version-fenced", () => {
  assert.deepEqual([...CLIENT_PATCH_KEYS], ["name", "status", "industry"]);
  assert.deepEqual([...CONTACT_PATCH_KEYS], ["name", "email", "phone", "role"]);
  assert.deepEqual(normalizeClientPatch({ status: " ARCHIVED ", version: "7" }), {
    ok: true,
    value: { version: "7", status: "archived" },
  });
  assert.deepEqual(normalizeContactPatch({
    phone: " 555-0100 ",
    role: " Account owner ",
    version: "8",
  }), {
    ok: true,
    value: { version: "8", phone: "555-0100", role: "Account owner" },
  });
  for (const outcome of [
    normalizeClientPatch({ version: "1" }),
    normalizeClientPatch({ name: "Changed", future: true, version: "1" }),
    normalizeContactPatch({ version: "1" }),
    normalizeContactPatch({ phone: "555-0100", future: true, version: "1" }),
  ]) {
    assert.equal(outcome.ok, false);
  }
});

test("client creation and contact patch share contact normalization, limits, and empty semantics", () => {
  const contactInput = {
    name: "  Primary\t Contact  ",
    email: "  CONTACT@Example.Test  ",
    phone: "  555-0100  ",
    role: "  Account\n owner  ",
  };
  const creation = normalizeClientCreation({
    name: "FCI TEST — DO NOT USE Shared Contact Fields",
    primaryContact: contactInput,
  });
  const patch = normalizeContactPatch({ ...contactInput, version: "1" });
  assert.equal(creation.ok, true);
  assert.equal(patch.ok, true);
  assert.deepEqual(creation.value.primaryContact, {
    name: patch.value.name,
    email: patch.value.email,
    phone: patch.value.phone,
    role: patch.value.role,
  });
  assert.deepEqual(creation.value.primaryContact, {
    name: "Primary Contact",
    email: "CONTACT@Example.Test",
    phone: "555-0100",
    role: "Account owner",
  });

  const nullableCreation = normalizeClientCreation({
    name: "FCI TEST — DO NOT USE Nullable Contact Fields",
    primaryContact: {
      name: "Primary Contact",
      email: "",
      phone: null,
    },
  });
  assert.equal(nullableCreation.ok, true);
  assert.deepEqual(nullableCreation.value.primaryContact, {
    name: "Primary Contact",
    email: null,
    phone: null,
    role: "Primary contact",
  });
  assert.deepEqual(normalizeContactPatch({
    email: "",
    phone: null,
    version: "1",
  }), {
    ok: true,
    value: { version: "1", email: null, phone: null },
  });

  for (const [field, value] of [
    ["email", " ".repeat(3)],
    ["email", "x".repeat(255)],
    ["phone", "x".repeat(81)],
    ["role", ""],
    ["role", "x".repeat(121)],
    ["phone", "555\u0000-0100"],
  ]) {
    const creationResult = normalizeClientCreation({
      name: "FCI TEST — DO NOT USE Invalid Contact Field",
      primaryContact: { name: "Primary Contact", [field]: value },
    });
    const patchResult = normalizeContactPatch({ [field]: value, version: "1" });
    assert.equal(creationResult.ok, false, `creation must reject ${field}`);
    assert.equal(patchResult.ok, false, `patch must reject ${field}`);
  }
});

test("client creation and edit share the optional industry contract", () => {
  for (const [input, expected] of [
    [null, null],
    ["", null],
    ["   ", null],
    ["  Commercial   flooring  ", "Commercial flooring"],
    ["x".repeat(120), "x".repeat(120)],
  ]) {
    const creation = normalizeClientCreation({
      name: "FCI TEST — DO NOT USE Shared Industry",
      industry: input,
    });
    const patch = normalizeClientPatch({ industry: input, version: "1" });
    assert.equal(creation.ok, true);
    assert.equal(patch.ok, true);
    assert.equal(creation.value.industry, expected);
    assert.equal(patch.value.industry, expected);
  }

  for (const input of ["x".repeat(121), "Commercial\u0000Flooring", 42]) {
    assert.equal(normalizeClientCreation({
      name: "FCI TEST — DO NOT USE Invalid Industry",
      industry: input,
    }).ok, false);
    assert.equal(normalizeClientPatch({ industry: input, version: "1" }).ok, false);
  }
});

test("client create accepts archived plus primary-contact phone and role and echoes a D1 version", async () => {
  let captured;
  const result = await createClient(
    {
      name: "FCI TEST — DO NOT USE Created Client",
      industry: "Residential",
      status: "archived",
      primaryContact: {
        name: "  Created\tContact ",
        email: " created@example.test ",
        phone: " 555-0199 ",
        role: " Account  owner ",
      },
    },
    {
      actorId: "office@example.test",
      capabilities: new Set(["clients.create"]),
    },
    {
      repository: {
        async create(intent) {
          captured = intent;
          return { outcome: "created" };
        },
      },
      directoryMirror: {
        async requestSync() {
          return { status: "not-configured", message: "Not configured." };
        },
      },
      newId: (() => {
        const values = ["12345678-aaaa-bbbb-cccc-000000000001", "activity-1", "contact-1"];
        return () => values.shift();
      })(),
      now: () => UPDATED_AT,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.version, "1");
  assert.equal(captured.client.status, "archived");
  assert.equal(captured.primaryContact.name, "Created Contact");
  assert.equal(captured.primaryContact.email, "created@example.test");
  assert.equal(captured.primaryContact.phone, "555-0199");
  assert.equal(captured.primaryContact.role, "Account owner");
});

test("office client PATCH persists all fields, archives and restores, and writes one audit per edit", async () => {
  const database = new ClientD1Database();
  try {
    const archived = await patchRequest(clientRoute, database, CLIENT_ID, {
      name: "FCI TEST — DO NOT USE Alpha Updated",
      status: "archived",
      industry: "Residential",
      version: "1",
    });
    assert.equal(archived.status, 200);
    assert.deepEqual(database.client(), {
      name: "FCI TEST — DO NOT USE Alpha Updated",
      status: "archived",
      industry: "Residential",
      version: 2,
    });
    assert.equal(
      database.normalizedNameKey(),
      "fci test — do not use alpha updated",
    );
    assert.deepEqual(database.activities(), [{
      record_id: CLIENT_ID,
      action: "Client fields updated",
      actor: "office@example.test",
      detail: "Name: FCI TEST — DO NOT USE Alpha → FCI TEST — DO NOT USE Alpha Updated; Status: active → archived; Industry: Commercial → Residential",
    }]);
    assert.equal((await archived.json()).client.version, "2");

    const restored = await patchRequest(clientRoute, database, CLIENT_ID, {
      status: "active",
      version: "2",
    });
    assert.equal(restored.status, 200);
    assert.equal(database.client().status, "active");
    assert.equal(database.client().version, 3);
    assert.equal(database.activities().length, 2);
  } finally {
    database.close();
  }
});

test("contact PATCH persists name, email, phone, and role with one client-scoped audit", async () => {
  const database = new ClientD1Database();
  try {
    const response = await patchRequest(contactRoute, database, CONTACT_ID, {
      name: "Updated Contact",
      email: "updated@example.test",
      phone: "555-0123",
      role: "Account owner",
      version: "1",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(database.contact(), {
      name: "Updated Contact",
      email: "updated@example.test",
      phone: "555-0123",
      role: "Account owner",
      version: 2,
    });
    const [activity] = database.activities();
    assert.equal(activity.record_id, CLIENT_ID);
    assert.equal(activity.action, "Contact fields updated");
    assert.match(activity.detail, /Phone: Not set → 555-0123/u);
    assert.match(activity.detail, /Role: Primary contact → Account owner/u);
    const body = await response.json();
    assert.equal(body.contact.clientId, CLIENT_ID);
    assert.equal(body.contact.isPrimary, true);
    assert.equal(body.contact.version, "2");
  } finally {
    database.close();
  }
});

test("stale client and contact writes return scoped saved values and append no audit", async () => {
  const database = new ClientD1Database();
  try {
    const firstClient = await patchRequest(clientRoute, database, CLIENT_ID, {
      industry: "Hospitality",
      version: "1",
    });
    assert.equal(firstClient.status, 200);
    const staleClient = await patchRequest(clientRoute, database, CLIENT_ID, {
      name: "Must not persist",
      version: "1",
    });
    assert.equal(staleClient.status, 409);
    assert.deepEqual(await staleClient.json(), {
      error: "Client changed since it was loaded.",
      currentVersion: "2",
      currentValues: { name: "FCI TEST — DO NOT USE Alpha" },
    });

    const firstContact = await patchRequest(contactRoute, database, CONTACT_ID, {
      phone: "555-0100",
      version: "1",
    });
    assert.equal(firstContact.status, 200);
    const staleContact = await patchRequest(contactRoute, database, CONTACT_ID, {
      role: "Must not persist",
      version: "1",
    });
    assert.equal(staleContact.status, 409);
    assert.deepEqual(await staleContact.json(), {
      error: "Contact changed since it was loaded.",
      currentVersion: "2",
      currentValues: { role: "Primary contact" },
    });
    assert.equal(database.activities().length, 2);
  } finally {
    database.close();
  }
});

test("overlapping D1 normalized-name candidates admit one client and one typed duplicate", async () => {
  const database = new ClientD1Database();
  try {
    const repository = createD1ClientRepository(database);
    const intent = (suffix, name) => ({
      client: {
        id: `client-concurrent-${suffix}`,
        clientCode: `CL-CONCUR0${suffix}`,
        name,
        status: "active",
        industry: null,
        createdBy: "office@example.test",
        createdAt: UPDATED_AT + Number(suffix),
        updatedAt: UPDATED_AT + Number(suffix),
      },
      primaryContact: null,
      activity: {
        id: `activity-concurrent-${suffix}`,
        recordId: `client-concurrent-${suffix}`,
        action: "Client created",
        actor: "office@example.test",
        detail: `Concurrent candidate ${suffix}`,
        createdAt: UPDATED_AT + Number(suffix),
      },
    });
    const results = await Promise.all([
      repository.create(intent("1", "FCI TEST — DO NOT USE Concurrent Identity")),
      repository.create(intent("2", "ＦＣＩ TEST — DO NOT USE Concurrent Identity")),
    ]);
    assert.deepEqual(
      results.map(({ outcome }) => outcome).sort(),
      ["created", "duplicate"],
    );
    assert.equal(
      database.database.prepare(
        "SELECT count(*) AS count FROM clients WHERE normalized_name_key = ?",
      ).get("fci test — do not use concurrent identity").count,
      1,
    );
    assert.deepEqual(
      database.activities().map(({ action }) => action),
      ["Client created"],
    );

    const [clientSource, importSource] = await Promise.all([
      read("app/adapters/d1/client-repository.ts"),
      read("app/adapters/d1/first-run-import-repository.ts"),
    ]);
    assert.match(
      clientSource,
      /INSERT INTO clients \(id, client_code, name, normalized_name_key,[\s\S]*normalizedNameKey/u,
    );
    assert.match(
      clientSource,
      /UPDATE clients SET name = \?, normalized_name_key = \?[\s\S]*normalizeClientNameKey\(values\.name\)/u,
    );
    assert.match(
      importSource,
      /normalizeClientNameKey\(row\.name\)[\s\S]*INSERT INTO clients \(id, client_code, name, normalized_name_key,/u,
    );
  } finally {
    database.close();
  }
});

test("a legacy near-duplicate client stays editable when its name does not change", async () => {
  // Rows created under the old LOWER(name) uniqueness could differ only by whitespace, so
  // they carry a NULL normalized_name_key and collapse to ONE key under the 0022 rules.
  // An unconditional duplicate scan on update would report each as a duplicate of the
  // other forever — locking out the archive transition this packet exists to deliver.
  const database = new ClientD1Database();
  try {
    const repository = createD1ClientRepository(database);
    const seed = database.database.prepare(`
      INSERT INTO clients (
        id, client_code, name, normalized_name_key, status, industry,
        created_by, created_at, updated_at, version
      ) VALUES (?, ?, ?, NULL, 'active', NULL, 'office@example.test', ?, ?, 1)
    `);
    seed.run("client-legacy-a", "CL-LEGACY01", "FCI TEST — DO NOT USE Legacy  Twin", UPDATED_AT, UPDATED_AT);
    seed.run("client-legacy-b", "CL-LEGACY02", "FCI TEST — DO NOT USE Legacy Twin", UPDATED_AT, UPDATED_AT);

    const archived = await repository.update({
      clientId: "client-legacy-a",
      expectedVersion: "1",
      values: {
        name: "FCI TEST — DO NOT USE Legacy  Twin",
        status: "archived",
        industry: null,
      },
      updatedAt: UPDATED_AT + 1,
      updatedBy: "office@example.test",
      activity: {
        id: "activity-legacy-archive",
        recordId: "client-legacy-a",
        action: "Client fields updated",
        actor: "office@example.test",
        detail: "Status: active → archived",
        createdAt: UPDATED_AT + 1,
      },
    });
    assert.equal(archived.outcome, "updated");
    assert.equal(archived.value.status, "archived");

    // A genuine rename into the sibling's key is still rejected.
    const collision = await repository.update({
      clientId: "client-legacy-b",
      expectedVersion: "1",
      values: {
        name: "FCI TEST — DO NOT USE Legacy  Twin",
        status: "active",
        industry: null,
      },
      updatedAt: UPDATED_AT + 2,
      updatedBy: "office@example.test",
      activity: {
        id: "activity-legacy-collision",
        recordId: "client-legacy-b",
        action: "Client fields updated",
        actor: "office@example.test",
        detail: "Name: b → a",
        createdAt: UPDATED_AT + 2,
      },
    });
    assert.equal(collision.outcome, "duplicate");
  } finally {
    database.close();
  }
});

test("malformed D1 client update evidence is rejected before any write", async () => {
  const database = new ClientD1Database();
  try {
    const repository = createD1ClientRepository(database);
    const baseIntent = {
      clientId: CLIENT_ID,
      expectedVersion: "1",
      values: {
        name: "FCI TEST — DO NOT USE Alpha Updated",
        status: "active",
        industry: "Commercial",
      },
      updatedAt: UPDATED_AT,
      updatedBy: "office@example.test",
      activity: {
        id: "activity-malformed",
        recordId: CLIENT_ID,
        action: "Client fields updated",
        actor: "office@example.test",
        detail: "Name: old → new",
        createdAt: UPDATED_AT,
      },
    };
    for (const intent of [
      {
        ...baseIntent,
        activity: { ...baseIntent.activity, recordId: OTHER_CLIENT_ID },
      },
      {
        ...baseIntent,
        activity: { ...baseIntent.activity, actor: "different@example.test" },
      },
      {
        ...baseIntent,
        activity: { ...baseIntent.activity, createdAt: UPDATED_AT + 1 },
      },
    ]) {
      await assert.rejects(
        repository.update(intent),
        /D1 client update evidence must match the client and actor/u,
      );
    }
    assert.equal(database.client().name, "FCI TEST — DO NOT USE Alpha");
    assert.equal(database.client().version, 1);
    assert.deepEqual(database.activities(), []);
  } finally {
    database.close();
  }
});

test("D1 client duplicate identity matches PostgreSQL across case, whitespace, and Unicode", async () => {
  for (const candidate of [
    "fci test — do not use beta",
    "FCI  TEST — DO NOT USE   Beta",
    "ＦＣＩ TEST — DO NOT USE Beta",
  ]) {
    const database = new ClientD1Database();
    try {
      const response = await patchRequest(clientRoute, database, CLIENT_ID, {
        name: candidate,
        version: "1",
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "A client with this business name already exists.",
        outcome: "duplicate",
      });
      assert.equal(database.client().name, "FCI TEST — DO NOT USE Alpha");
      assert.equal(database.client().version, 1);
      assert.deepEqual(database.activities(), []);
    } finally {
      database.close();
    }
  }

  const source = await read("app/adapters/d1/client-repository.ts");
  assert.match(source, /normalizeClientNameKey\(row\.name\) === candidateKey/u);
  assert.match(
    source,
    /UPDATE clients[\s\S]*NOT EXISTS[\s\S]*LOWER\(duplicate\.name\) = LOWER\(\?\)/u,
  );
});

test("D1 client creation rejects a legacy Unicode-equivalent name on the production schema shape", async () => {
  const database = new ClientD1Database();
  try {
    const result = await createD1ClientRepository(database).create({
      client: {
        id: "client-edit-new",
        clientCode: "CL-EDIT0003",
        name: "ＦＣＩ TEST — DO NOT USE Beta",
        status: "active",
        industry: null,
        createdBy: "office@example.test",
        createdAt: UPDATED_AT,
        updatedAt: UPDATED_AT,
      },
      primaryContact: null,
      activity: {
        id: "activity-edit-new",
        recordId: "client-edit-new",
        action: "Client created",
        actor: "office@example.test",
        detail: "CL-EDIT0003 · ＦＣＩ TEST — DO NOT USE Beta",
        createdAt: UPDATED_AT,
      },
    });
    assert.deepEqual(result, { outcome: "duplicate" });
    assert.equal(database.client("client-edit-new").name, undefined);
    assert.deepEqual(database.activities(), []);
  } finally {
    database.close();
  }
});

test("both editing routes return 401/403 before parsing or database work", async () => {
  for (const [route, resource, parameter, id] of [
    [clientRoute, "clients", "clientId", CLIENT_ID],
    [contactRoute, "contacts", "contactId", CONTACT_ID],
  ]) {
    for (const [email, status, error] of [
      [null, 401, "Sign in with ChatGPT to use this workspace."],
      ["outsider@example.test", 403, "Your account is not allowed to access this workspace."],
    ]) {
      let databaseCalls = 0;
      cloudflareEnv.DB = {
        prepare() {
          databaseCalls += 1;
          throw new Error("Denied requests must not prepare database work.");
        },
        batch() {
          databaseCalls += 1;
          throw new Error("Denied requests must not batch database work.");
        },
      };
      const headers = new Headers({
        "content-type": "application/json",
        origin: "https://fci.example.test",
      });
      if (email) headers.set("oai-authenticated-user-email", email);
      const response = await route.PATCH(
        new NextRequest(`https://fci.example.test/api/v1/${resource}/${id}`, {
          method: "PATCH",
          headers,
          body: "{not-json",
        }),
        { params: Promise.resolve({ [parameter]: id }) },
      );
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(databaseCalls, 0);
    }
  }
});

test("both editing routes reject cross-origin requests before parsing or database work", async () => {
  for (const [route, resource, parameter, id] of [
    [clientRoute, "clients", "clientId", CLIENT_ID],
    [contactRoute, "contacts", "contactId", CONTACT_ID],
  ]) {
    let databaseCalls = 0;
    cloudflareEnv.DB = {
      prepare() {
        databaseCalls += 1;
        throw new Error("Cross-origin requests must not prepare database work.");
      },
      batch() {
        databaseCalls += 1;
        throw new Error("Cross-origin requests must not batch database work.");
      },
    };
    const response = await route.PATCH(
      new NextRequest(`https://fci.example.test/api/v1/${resource}/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.test",
          "oai-authenticated-user-email": "office@example.test",
        },
        body: "{not-json",
      }),
      { params: Promise.resolve({ [parameter]: id }) },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Cross-origin requests are not allowed.",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(databaseCalls, 0);
  }
});

test("new editing routes expose no core-record DELETE and authenticate before parsing", async () => {
  const [clientSource, contactSource] = await Promise.all([
    read("app/api/v1/clients/[clientId]/route.ts"),
    read("app/api/v1/contacts/[contactId]/route.ts"),
  ]);
  for (const source of [clientSource, contactSource]) {
    assert.doesNotMatch(source, /export\s+(?:async\s+function|function|const)\s+DELETE\b/u);
    const authIndex = source.indexOf("requireOfficeUser(request)");
    const parserIndex = source.indexOf("parseBoundedJsonObject(request");
    assert.ok(authIndex >= 0);
    assert.ok(parserIndex >= 0);
    assert.ok(authIndex < parserIndex);
  }
});

test("FloorOps composes create plus independent changed-key client and contact editors", async () => {
  const app = await read("app/FloorOpsApp.tsx");
  assert.match(
    app,
    /function mapClientRecord[\s\S]*primary_contact_phone[\s\S]*primary_contact_role[\s\S]*primary_contact_version[\s\S]*normalizeRecordVersion\(record\.version\)/u,
  );
  assert.match(
    app,
    // "Commercial" is the shipped DES-08a1 row-chip default and is also pinned by
    // tests/e2e/des08a1-industry-surfacing.spec.ts ("UNSPEC-001 · Commercial"). Pinned
    // here too so a regression fails in seconds on Node rather than only in Playwright.
    /industry:\s*industryRaw \?\? "Commercial",[\s\S]*industryRaw,/u,
  );
  assert.match(
    app,
    /primaryContact:\s*\{[\s\S]*name: client\.contact,[\s\S]*email: client\.email,[\s\S]*phone: client\.contactPhone,[\s\S]*role: client\.contactRole/u,
  );
  assert.match(
    app,
    /<input name="phone" type="tel" maxLength=\{80\}[\s\S]*<input name="role" required maxLength=\{120\}[\s\S]*CLIENT_STATUSES\.map/u,
  );
  assert.match(
    app,
    /function ClientEditModal[\s\S]*const patch: ClientEditPatch = \{\};[\s\S]*if \(name !== client\.name\) patch\.name = name;[\s\S]*if \(nextIndustry !== industry\) patch\.industry = nextIndustry;[\s\S]*if \(status !== client\.status\.toLowerCase\(\)\) patch\.status = status;/u,
  );
  assert.match(
    app,
    /function ContactEditModal[\s\S]*const patch: ContactEditPatch = \{\};[\s\S]*if \(name !== client\.contact\) patch\.name = name;[\s\S]*if \(email !== \(client\.email \|\| null\)\) patch\.email = email;[\s\S]*if \(phone !== client\.contactPhone\) patch\.phone = phone;[\s\S]*if \(role !== client\.contactRole\) patch\.role = role;/u,
  );
  assert.match(
    app,
    /new ClientEditConflictError\([\s\S]*data\.currentVersion,[\s\S]*data\.currentValues \?\? \{\}/u,
  );
  assert.match(
    app,
    /new ContactEditConflictError\([\s\S]*data\.currentVersion,[\s\S]*data\.currentValues \?\? \{\}/u,
  );
  assert.match(
    app,
    /Saved value: \{displayValue\}[\s\S]*Saved value: \{value === null \|\| value === "" \? "Not set" : String\(value\)\}/u,
  );
  assert.match(
    app,
    /<ClientDrawer[\s\S]*onSaveClient=\{saveClientEdits\} onSaveContact=\{saveContactEdits\}/u,
  );
  assert.match(
    app,
    /item\.clientId === saved\.id \? \{ \.\.\.item, client: saved\.name \} : item/u,
  );
  assert.match(
    app,
    /industry:\s*saved\.industry \?\? "Commercial",[\s\S]*industryRaw:\s*saved\.industry/u,
  );
  assert.doesNotMatch(
    app,
    /fetch\(`\/api\/v1\/(?:clients|contacts)\/\$\{[^}]+\}`,\s*\{\s*method:\s*"DELETE"/u,
  );
});
