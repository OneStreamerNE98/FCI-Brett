import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const BASE_URL = "https://fci.example.test";
const originalFetch = globalThis.fetch;
const originalNodeEnvironment = process.env.NODE_ENV;
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;
process.env.NODE_ENV = "test";

const CLIENT_HEADERS = Object.freeze([
  "Client Code",
  "Client / Company",
  "Status",
  "Industry",
  "Primary Contact",
  "Email",
  "Phone",
  "Address",
]);
const PROJECT_HEADERS = Object.freeze([
  "Project Name",
  "Client Code",
  "Client / Company",
  "Client Email",
  "Site",
  "Status",
  "Estimated Value",
  "Flooring Category",
  "Square Feet",
  "Contract Value",
  "Segment",
]);

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(
    new URL("../node_modules/.vite-set25-first-run-import", import.meta.url),
  ),
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
  server: { middlewareMode: true, hmr: { port: 24789 } },
});

const [
  domain,
  application,
  blueprintModule,
  statusRoute,
  previewRoute,
  confirmRoute,
  clientLookupRoute,
] = await Promise.all([
  vite.ssrLoadModule("/app/domain/first-run-import.ts"),
  vite.ssrLoadModule("/app/application/first-run-import.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
  vite.ssrLoadModule("/app/api/v1/settings/first-run-import/route.ts"),
  vite.ssrLoadModule("/app/api/v1/settings/first-run-import/preview/route.ts"),
  vite.ssrLoadModule("/app/api/v1/settings/first-run-import/confirm/route.ts"),
  vite.ssrLoadModule("/app/api/v1/settings/first-run-import/clients/route.ts"),
]);

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function csv(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    return /[",\r\n]/u.test(value)
      ? `"${value.replaceAll("\"", "\"\"")}"`
      : value;
  }).join(",")).join("\n");
}

function csvSource(content, fileName = "first-run.csv") {
  return { kind: "csv", fileName, content };
}

function request(path, {
  email = ADMIN_EMAIL,
  method = "GET",
  body,
  origin = BASE_URL,
} = {}) {
  const url = new URL(path, BASE_URL);
  const result = new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : {
        origin,
        "content-type": "application/json",
      }),
      ...(email ? { "oai-authenticated-user-email": email } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  Object.defineProperty(result, "nextUrl", { value: url });
  return result;
}

function importBlueprint() {
  const blueprint = structuredClone(blueprintModule.seedWorkspaceBlueprint());
  blueprint.spreadsheets.push({
    key: "first-run-import",
    name: "FCI First-run Import",
    targetFolderKey: "company-admin",
    management: "owner",
    role: "import",
  });
  return blueprint;
}

function importResource() {
  return {
    id: "resource-import-sheet",
    connection_key: "workspace-simulation",
    resource_type: "sheets.spreadsheet",
    resource_key: "first-run-import",
    external_id: "simulation-import-sheet",
    parent_external_id: null,
    external_url: null,
    origin: "created",
    metadata_json: "{}",
    created_by: ADMIN_EMAIL,
    created_at: 1,
    updated_at: 1,
  };
}

function fakeDatabase({
  clients = [],
  projects = [],
  blueprint = null,
  resources = [],
} = {}) {
  const state = {
    clients: structuredClone(clients),
    projects: structuredClone(projects),
    activities: [],
    blueprint: blueprint ? structuredClone(blueprint) : null,
    resources: structuredClone(resources),
    leases: new Map(),
    beforeNextClientSnapshot: null,
    beforeNextBatch: null,
  };
  const reads = [];
  const writes = [];
  const batches = [];

  const execute = async (statement, createdClientIds, createdProjectIds) => {
    const { sql, values } = statement;
    writes.push({ sql, values: [...values] });
    if (/^INSERT INTO google_drive_operations /u.test(sql)) {
      const operationKey = values[2];
      const current = state.leases.get(operationKey);
      const reclaimNow = values[8];
      if (
        current?.status === "in-progress"
        && current.leaseExpiresAt >= reclaimNow
      ) {
        return { meta: { changes: 0 } };
      }
      state.leases.set(operationKey, {
        status: "in-progress",
        leaseExpiresAt: values[4],
        errorCode: null,
      });
      return { meta: { changes: 1 } };
    }
    if (/^UPDATE google_drive_operations SET status = 'completed'/u.test(sql)) {
      const current = state.leases.get(values[1]);
      if (
        current?.status !== "committing"
        || current.leaseExpiresAt !== values[2]
      ) return { meta: { changes: 0 } };
      state.leases.set(values[1], {
        status: "completed",
        leaseExpiresAt: null,
        errorCode: null,
      });
      return { meta: { changes: 1 } };
    }
    if (/^UPDATE google_drive_operations SET status = 'committing'/u.test(sql)) {
      const current = state.leases.get(values[1]);
      if (
        current?.status !== "in-progress"
        || current.leaseExpiresAt !== values[2]
        || current.leaseExpiresAt <= values[0]
      ) return { meta: { changes: 0 } };
      state.leases.set(values[1], {
        status: "committing",
        leaseExpiresAt: current.leaseExpiresAt,
        errorCode: null,
      });
      return { meta: { changes: 1 } };
    }
    if (/^UPDATE google_drive_operations SET status = 'failed'/u.test(sql)) {
      const current = state.leases.get(values[2]);
      if (
        current?.status !== "in-progress"
        || current.leaseExpiresAt !== values[3]
      ) return { meta: { changes: 0 } };
      state.leases.set(values[2], {
        status: "failed",
        leaseExpiresAt: null,
        errorCode: values[0],
      });
      return { meta: { changes: 1 } };
    }
    if (/^INSERT INTO clients /u.test(sql)) {
      const normalizedPhone = (value) => String(value ?? "").replace(/\D/gu, "");
      const normalizedAddress = (value) => String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/gu, " ");
      const duplicateIdentity = state.clients.some((client) => (
        client.name.trim().toLowerCase() === String(values[2]).trim().toLowerCase()
        || client.client_code === values[1]
      ));
      const duplicateEmail = values[10] !== null && state.clients.some((client) => (
        String(client.email ?? "").trim().toLowerCase() === values[10]
      ));
      const duplicatePhone = values[12] !== null && state.clients.some((client) => (
        normalizedPhone(client.phone) === values[12]
      ));
      const duplicateAddress = values[14] !== null && state.projects.some((project) => (
        normalizedAddress(project.site) === normalizedAddress(values[14])
      ));
      const duplicateSourceClientCode = values[16] !== null
        && state.activities.some(({ action, detail }) => (
          action === "Client imported"
          && String(detail ?? "").includes(`sourceClientCode=${values[16]}`)
        ));
      const duplicateAddressDigest = values[18] !== null
        && state.activities.some(({ action, detail }) => (
          action === "Client imported"
          && String(detail ?? "").includes(`sourceAddressDigest=${values[18]}`)
        ));
      const fence = state.leases.get(values[20]);
      const fenceAllowsWrite = fence?.status === "committing"
        && fence.leaseExpiresAt === values[21];
      if (
        duplicateIdentity
        || duplicateEmail
        || duplicatePhone
        || duplicateAddress
        || duplicateSourceClientCode
        || duplicateAddressDigest
        || !fenceAllowsWrite
      ) return { meta: { changes: 0 } };
      state.clients.push({
        id: values[0],
        client_code: values[1],
        name: values[2],
        status: values[3],
        industry: values[4],
        email: null,
        phone: null,
      });
      createdClientIds.add(values[0]);
      return { meta: { changes: 1 } };
    }
    if (/^INSERT INTO contacts /u.test(sql)) {
      const client = state.clients.find(({ id }) => id === values[1]);
      if (!client || !createdClientIds.has(values[1])) {
        return { meta: { changes: 0 } };
      }
      client.email = values[3];
      client.phone = values[4];
      return { meta: { changes: 1 } };
    }
    if (/^INSERT INTO projects /u.test(sql)) {
      const client = state.clients.find(({ id }) => id === values[15]);
      const fence = state.leases.get(values[16]);
      const duplicate = state.projects.some((project) => (
        project.client_id === values[15]
        && project.name.trim().toLowerCase() === String(values[18]).trim().toLowerCase()
        && String(project.site ?? "").trim().toLowerCase()
          === String(values[19] ?? "").trim().toLowerCase()
      ));
      const fenceAllowsWrite = fence?.status === "committing"
        && fence.leaseExpiresAt === values[17];
      if (!client || duplicate || !fenceAllowsWrite) {
        return { meta: { changes: 0 } };
      }
      const explicitSegment = values[10] === "commercial" || values[10] === "residential"
        ? values[10]
        : null;
      state.projects.push({
        id: values[0],
        project_number: values[1],
        client_id: values[15],
        name: values[2],
        status: values[3],
        site: values[4],
        segment: explicitSegment
          ?? (String(client.industry).trim().toLowerCase() === "residential"
            ? "residential"
            : "commercial"),
      });
      createdProjectIds.add(values[0]);
      return { meta: { changes: 1 } };
    }
    if (/^INSERT INTO activity_events /u.test(sql)) {
      const recordId = values[1];
      const created = createdClientIds.has(recordId) || createdProjectIds.has(recordId);
      if (!created) return { meta: { changes: 0 } };
      const action = sql.includes("'Client imported'")
        ? "Client imported"
        : "Project imported";
      state.activities.push({
        id: values[0],
        record_id: recordId,
        action,
        actor: values[2],
        detail: values[3],
        created_at: values[4],
      });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected SET-25 write: ${sql}`);
  };

  const database = {
    state,
    reads,
    writes,
    batches,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async first() {
          reads.push({ sql, values: [...statement.values], kind: "first" });
          if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) {
            return state.blueprint
              ? {
                  id: "blueprint-set25",
                  connection_key: statement.values[0],
                  version: 1,
                  blueprint_json: JSON.stringify(state.blueprint),
                  created_by: ADMIN_EMAIL,
                  created_at: 1,
                  updated_by: ADMIN_EMAIL,
                  updated_at: 1,
                }
              : null;
          }
          if (/FROM workspace_settings WHERE id = \?/u.test(sql)) return null;
          if (/^SELECT id FROM clients WHERE id = \? LIMIT 1$/u.test(sql)) {
            const client = state.clients.find(({ id }) => id === statement.values[0]);
            return client ? { id: client.id } : null;
          }
          throw new Error(`Unexpected SET-25 first query: ${sql}`);
        },
        async all() {
          reads.push({ sql, values: [...statement.values], kind: "all" });
          if (/FROM clients c LEFT JOIN contacts ct/u.test(sql)) {
            const gate = state.beforeNextClientSnapshot;
            state.beforeNextClientSnapshot = null;
            if (typeof gate === "function") await gate();
            else if (gate) await gate;
            return {
              results: state.clients.map((client) => ({
                id: client.id,
                client_code: client.client_code,
                name: client.name,
                industry: client.industry ?? null,
                email: client.email ?? null,
                phone: client.phone ?? null,
              })),
            };
          }
          if (/SELECT client_id, site FROM projects/u.test(sql)) {
            return {
              results: state.projects
                .filter(({ site }) => typeof site === "string" && site.trim())
                .map(({ client_id, site }) => ({ client_id, site })),
            };
          }
          if (/SELECT id, client_id, name, site FROM projects/u.test(sql)) {
            return {
              results: state.projects.map((project) => ({
                id: project.id,
                client_id: project.client_id,
                name: project.name,
                site: project.site ?? null,
              })),
            };
          }
          if (/FROM activity_events/u.test(sql) && /Client imported/u.test(sql)) {
            return {
              results: state.activities
                .filter(({ action }) => action === "Client imported")
                .map(({ record_id, detail }) => ({ record_id, detail })),
            };
          }
          if (/FROM workspace_resources/u.test(sql)) {
            return { results: structuredClone(state.resources) };
          }
          throw new Error(`Unexpected SET-25 all query: ${sql}`);
        },
        async run() {
          return execute(statement, new Set(), new Set());
        },
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements.map(({ sql, values }) => ({
        sql,
        values: [...values],
      })));
      const beforeBatch = state.beforeNextBatch;
      state.beforeNextBatch = null;
      if (typeof beforeBatch === "function") await beforeBatch();
      else if (beforeBatch) await beforeBatch;
      const createdClientIds = new Set();
      const createdProjectIds = new Set();
      const results = [];
      for (const statement of statements) {
        results.push(await execute(
          statement,
          createdClientIds,
          createdProjectIds,
        ));
      }
      return results;
    },
  };
  return database;
}

function setEnvironment(database, overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: database,
    ...overrides,
  });
}

function storedClient({
  id,
  code,
  name,
  email,
  phone,
  address,
  aliases = [],
}) {
  return {
    id,
    clientCode: code,
    sourceClientCodes: aliases,
    name,
    emails: email ? [email] : [],
    phones: phone ? [phone] : [],
    addresses: address ? [address] : [],
    addressDigests: [],
  };
}

function emptySnapshot(clients = [], projects = []) {
  return { clients, projects };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("SET-25 client preview detects email, phone, and address duplicates without writing", async () => {
  const existing = storedClient({
    id: "client-existing",
    code: "CL-EXIST01",
    name: "Existing account",
    email: "match@example.test",
    phone: "(856) 555-0111",
    address: "25 Existing Way, Cherry Hill, NJ",
  });
  const preview = await domain.previewFirstRunImport({
    entity: "clients",
    expectedHeaders: CLIENT_HEADERS,
    snapshot: emptySnapshot([existing]),
    values: [
      CLIENT_HEADERS,
      [
        "LEGACY-EMAIL",
        "FCI TEST — DO NOT USE — email match",
        "active",
        "Commercial",
        "Email Contact",
        "MATCH@example.test",
        "555-1001",
        "1 New Street",
      ],
      [
        "LEGACY-PHONE",
        "FCI TEST — DO NOT USE — phone match",
        "active",
        "Commercial",
        "Phone Contact",
        "phone@example.test",
        "856.555.0111",
        "2 New Street",
      ],
      [
        "LEGACY-ADDRESS",
        "FCI TEST — DO NOT USE — address match",
        "active",
        "Commercial",
        "",
        "",
        "",
        " 25   EXISTING Way, Cherry Hill, NJ ",
      ],
    ],
  });

  assert.deepEqual(preview.rows.map(({ state }) => state), [
    "duplicate",
    "duplicate",
    "duplicate",
  ]);
  assert.deepEqual(
    preview.rows.map(({ issues }) => issues.map(({ code }) => code)),
    [["duplicate_email"], ["duplicate_phone"], ["duplicate_address"]],
  );
  assert.equal(preview.confirmable, 0);
});

test("SET-25 blank optional client and project fields remain ready", async () => {
  const clients = await domain.previewFirstRunImport({
    entity: "clients",
    expectedHeaders: CLIENT_HEADERS,
    snapshot: emptySnapshot(),
    values: [
      CLIENT_HEADERS,
      [
        "OPTIONAL-INDUSTRY",
        "FCI TEST — DO NOT USE — blank industry",
        "active",
        "",
        "",
        "",
        "",
        "",
      ],
      [
        "OPTIONAL-EMAIL",
        "FCI TEST — DO NOT USE — email only",
        "active",
        "",
        "Email Contact",
        "email-only@example.test",
        "",
        "",
      ],
      [
        "OPTIONAL-PHONE",
        "FCI TEST — DO NOT USE — phone only",
        "active",
        "",
        "Phone Contact",
        "",
        "856-555-0188",
        "",
      ],
    ],
  });
  assert.deepEqual(clients.rows.map(({ state }) => state), [
    "ready",
    "ready",
    "ready",
  ]);
  assert.equal(clients.rows[0].values.client.industry, null);
  assert.equal(clients.rows[1].values.client.primaryContact.phone, null);
  assert.equal(clients.rows[2].values.client.primaryContact.email, null);

  const existing = storedClient({
    id: "client-optional",
    code: "CL-OPTION1",
    name: "Optional fields client",
    email: "optional@example.test",
  });
  const projects = await domain.previewFirstRunImport({
    entity: "projects",
    expectedHeaders: PROJECT_HEADERS,
    snapshot: emptySnapshot([existing]),
    values: [
      PROJECT_HEADERS,
      [
        "FCI TEST — DO NOT USE — blank site",
        existing.clientCode,
        existing.name,
        "optional@example.test",
        "",
        "planning",
        "",
        "",
        "",
        "",
        "",
      ],
    ],
  });
  assert.equal(projects.rows[0].state, "ready");
  assert.equal(projects.rows[0].values.project.site, null);
});

test("SET-25 project preview detects tuple duplicates, unmatched and ambiguous clients, and reviewed overrides", async () => {
  const clientOne = storedClient({
    id: "client-one",
    code: "CL-ONE0001",
    name: "First saved client",
    email: "first@example.test",
  });
  const clientTwo = storedClient({
    id: "client-two",
    code: "CL-TWO0002",
    name: "Second saved client",
    email: "second@example.test",
  });
  const values = [
    PROJECT_HEADERS,
    [
      "FCI TEST — DO NOT USE — duplicate project",
      "CL-ONE0001",
      "First saved client",
      "first@example.test",
      "100 Main Street",
      "planning",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "FCI TEST — DO NOT USE — unmatched project",
      "UNKNOWN",
      "",
      "",
      "200 Main Street",
      "planning",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "FCI TEST — DO NOT USE — ambiguous project",
      "CL-ONE0001",
      "",
      "second@example.test",
      "300 Main Street",
      "planning",
      "",
      "",
      "",
      "",
      "",
    ],
  ];
  const snapshot = emptySnapshot(
    [clientOne, clientTwo],
    [{
      id: "project-existing",
      clientId: clientOne.id,
      name: "FCI TEST — DO NOT USE — duplicate project",
      site: "100 Main Street",
    }],
  );
  const preview = await domain.previewFirstRunImport({
    entity: "projects",
    expectedHeaders: PROJECT_HEADERS,
    snapshot,
    values,
  });
  assert.deepEqual(preview.rows.map(({ state }) => state), [
    "duplicate",
    "unmatched-client",
    "ambiguous-client",
  ]);

  const unmatched = preview.rows[1];
  const overridden = await domain.previewFirstRunImport({
    entity: "projects",
    expectedHeaders: PROJECT_HEADERS,
    snapshot,
    values,
    clientOverrides: { [unmatched.rowKey]: clientOne.id },
  });
  assert.equal(overridden.rows[1].state, "ready");
  assert.deepEqual(overridden.rows[1].values.resolvedClient, {
    id: clientOne.id,
    clientCode: clientOne.clientCode,
    name: clientOne.name,
    industry: null,
    resolution: "reviewed-override",
  });
});

test("SET-25 gate and bounded batch fail closed before confirmation", async () => {
  const gated = await domain.previewFirstRunImport({
    entity: "clients",
    expectedHeaders: CLIENT_HEADERS,
    snapshot: emptySnapshot(),
    values: [
      CLIENT_HEADERS,
      ["REAL-1", "Real Client LLC", "active", "", "", "", "", ""],
    ],
  });
  assert.equal(
    gated.rows[0].state,
    "blocked-real-data",
    JSON.stringify(gated.rows[0]),
  );
  assert.match(
    gated.rows[0].issues[0].message,
    /until WS-11 is approved/u,
  );
  assert.equal(domain.FIRST_RUN_IMPORT_REAL_DATA_ALLOWED, false);
  assert.match(domain.FIRST_RUN_IMPORT_GATE_NOTICE, /Test data only/u);

  const tooMany = [
    CLIENT_HEADERS,
    ...Array.from({ length: domain.FIRST_RUN_IMPORT_MAX_ROWS + 1 }, (_, index) => [
      `LEGACY-${index}`,
      `FCI TEST — DO NOT USE — bounded ${index}`,
      "active",
      "",
      "",
      "",
      "",
      "",
    ]),
  ];
  await assert.rejects(
    domain.previewFirstRunImport({
      entity: "clients",
      expectedHeaders: CLIENT_HEADERS,
      snapshot: emptySnapshot(),
      values: tooMany,
    }),
    (error) => error?.code === "import_batch_too_large",
  );

  await assert.rejects(
    domain.previewFirstRunImport({
      entity: "clients",
      expectedHeaders: CLIENT_HEADERS,
      snapshot: emptySnapshot(),
      values: [
        CLIENT_HEADERS,
        [
          "CLOSED-COLUMNS",
          "FCI TEST — DO NOT USE — closed columns",
          "active",
          "",
          "",
          "",
          "",
          "",
          "Unexpected value",
        ],
      ],
    }),
    (error) => error?.code === "import_source_rows_invalid",
  );
});

test("SET-25 confirmation writes selected rows only with provenance and never creates clients on a project path", async () => {
  const clientPreview = await domain.previewFirstRunImport({
    entity: "clients",
    expectedHeaders: CLIENT_HEADERS,
    snapshot: emptySnapshot(),
    values: [
      CLIENT_HEADERS,
      [
        "LEGACY-A",
        "FCI TEST — DO NOT USE — selected",
        "active",
        "Commercial",
        "Selected Contact",
        "selected@example.test",
        "555-0191",
        "",
      ],
      [
        "LEGACY-B",
        "FCI TEST — DO NOT USE — unselected",
        "active",
        "",
        "",
        "",
        "",
        "",
      ],
    ],
  });
  let capturedClients = null;
  const repository = {
    async snapshot() {
      return emptySnapshot();
    },
    async createClients(rows) {
      capturedClients = rows;
      return rows.map((row) => ({
        id: row.id,
        identifier: row.clientCode,
        outcome: "created",
      }));
    },
    async createProjects() {
      throw new Error("The client confirmation path must not create projects.");
    },
  };
  let id = 0;
  const confirmation = await application.confirmFirstRunImport({
    preview: clientPreview,
    selected: [{ rowKey: clientPreview.rows[0].rowKey }],
    actor: ADMIN_EMAIL,
    sourceKind: "csv",
    repository,
    newId: () => `generated-${++id}`,
    now: () => 1_795_000_000_000,
  });
  assert.equal(confirmation.created, 1);
  assert.equal(capturedClients.length, 1);
  assert.equal(capturedClients[0].name, "FCI TEST — DO NOT USE — selected");
  assert.deepEqual(capturedClients[0].provenance, {
    sourceKind: "csv",
    sourceRow: 2,
    sourceClientCode: "LEGACY-A",
    sourceAddressDigest: null,
  });

  const savedClient = storedClient({
    id: "saved-client",
    code: "CL-SAVED01",
    name: "Saved client",
    email: "saved@example.test",
  });
  const projectPreview = await domain.previewFirstRunImport({
    entity: "projects",
    expectedHeaders: PROJECT_HEADERS,
    snapshot: emptySnapshot([savedClient]),
    values: [
      PROJECT_HEADERS,
      [
        "FCI TEST — DO NOT USE — project only",
        savedClient.clientCode,
        savedClient.name,
        "saved@example.test",
        "500 Project Way",
        "planning",
        "",
        "",
        "",
        "",
        "",
      ],
    ],
  });
  let projectsCreated = 0;
  const projectRepository = {
    async snapshot() {
      return emptySnapshot([savedClient]);
    },
    async createClients() {
      throw new Error("A project import must never create a client.");
    },
    async createProjects(rows) {
      projectsCreated += rows.length;
      return rows.map((row) => ({
        id: row.id,
        identifier: row.projectNumber,
        outcome: "created",
      }));
    },
  };
  await application.confirmFirstRunImport({
    preview: projectPreview,
    selected: [{
      rowKey: projectPreview.rows[0].rowKey,
      clientId: savedClient.id,
      effectiveSegment: "commercial",
    }],
    actor: ADMIN_EMAIL,
    sourceKind: "spreadsheet",
    repository: projectRepository,
    newId: () => `project-generated-${++id}`,
    now: () => 1_795_000_000_000,
  });
  assert.equal(projectsCreated, 1);
});

test("SET-25 confirmation rejects within-file-only client and project duplicates", async () => {
  const clientPreview = await domain.previewFirstRunImport({
    entity: "clients",
    expectedHeaders: CLIENT_HEADERS,
    snapshot: emptySnapshot(),
    values: [
      CLIENT_HEADERS,
      [
        "WITHIN-FILE-A",
        "FCI TEST — DO NOT USE — within-file duplicate",
        "active",
        "Commercial",
        "",
        "",
        "",
        "10 First Address",
      ],
      [
        "WITHIN-FILE-B",
        "FCI TEST — DO NOT USE — within-file duplicate",
        "active",
        "Commercial",
        "",
        "",
        "",
        "20 Second Address",
      ],
    ],
  });
  assert.equal(clientPreview.rows[0].state, "duplicate");
  assert.deepEqual(
    clientPreview.rows[0].issues.map(({ code }) => code),
    ["duplicate_import_name"],
  );
  const mustNotWrite = {
    async snapshot() {
      return emptySnapshot();
    },
    async createClients() {
      throw new Error("Within-file-only duplicates must not reach a client write.");
    },
    async createProjects() {
      throw new Error("Within-file-only duplicates must not reach a project write.");
    },
  };
  await assert.rejects(
    application.confirmFirstRunImport({
      preview: clientPreview,
      selected: [{ rowKey: clientPreview.rows[0].rowKey }],
      actor: ADMIN_EMAIL,
      sourceKind: "csv",
      repository: mustNotWrite,
      newId: () => "must-not-create",
      now: () => 1_795_000_000_000,
    }),
    (error) => error?.code === "import_row_not_ready",
  );

  const savedClient = storedClient({
    id: "client-within-file",
    code: "CL-WITHIN01",
    name: "FCI TEST — DO NOT USE — Within-file client",
    email: "within-file@example.test",
  });
  const projectRow = [
    "FCI TEST — DO NOT USE — repeated project",
    savedClient.clientCode,
    savedClient.name,
    "within-file@example.test",
    "30 Repeated Site",
    "planning",
    "",
    "",
    "",
    "",
    "",
  ];
  const projectPreview = await domain.previewFirstRunImport({
    entity: "projects",
    expectedHeaders: PROJECT_HEADERS,
    snapshot: emptySnapshot([savedClient]),
    values: [PROJECT_HEADERS, projectRow, projectRow],
  });
  assert.equal(projectPreview.rows[0].state, "duplicate");
  assert.deepEqual(
    projectPreview.rows[0].issues.map(({ code }) => code),
    ["duplicate_import_project"],
  );
  await assert.rejects(
    application.confirmFirstRunImport({
      preview: projectPreview,
      selected: [{
        rowKey: projectPreview.rows[0].rowKey,
        clientId: savedClient.id,
        effectiveSegment: "commercial",
      }],
      actor: ADMIN_EMAIL,
      sourceKind: "csv",
      repository: mustNotWrite,
      newId: () => "must-not-create",
      now: () => 1_795_000_000_000,
    }),
    (error) => error?.code === "import_row_not_ready",
  );
});

test("SET-25 endpoints are admin/origin/bounds gated and every response is no-store", async () => {
  const deniedDatabase = {
    prepare() {
      throw new Error("Denied import requests must not touch D1.");
    },
  };
  setEnvironment(deniedDatabase);

  const deniedGet = await statusRoute.GET(request(
    "/api/v1/settings/first-run-import",
    { email: OFFICE_EMAIL },
  ));
  assert.equal(deniedGet.status, 403);
  assert.equal(deniedGet.headers.get("cache-control"), "no-store");

  for (const route of [previewRoute, confirmRoute]) {
    const denied = await route.POST(request(
      route === previewRoute
        ? "/api/v1/settings/first-run-import/preview"
        : "/api/v1/settings/first-run-import/confirm",
      {
        email: OFFICE_EMAIL,
        method: "POST",
        body: {},
      },
    ));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("cache-control"), "no-store");

    const crossOrigin = await route.POST(request(
      route === previewRoute
        ? "/api/v1/settings/first-run-import/preview"
        : "/api/v1/settings/first-run-import/confirm",
      {
        method: "POST",
        origin: "https://attacker.example",
        body: {},
      },
    ));
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get("cache-control"), "no-store");
  }

  const oversized = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: JSON.stringify({ padding: "x".repeat(600_100) }),
    },
  ));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store");
  assert.deepEqual(await oversized.json(), {
    error: "First-run import details are too large.",
  });
});

test("SET-25 preview is read-only and exposes only the finalized public response shape", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const source = csvSource(csv([
    CLIENT_HEADERS,
    [
      "LEGACY-PUBLIC",
      "FCI TEST — DO NOT USE — public preview",
      "active",
      "Commercial",
      "Public Contact",
      "public@example.test",
      "555-0161",
      "16 Public Way",
    ],
  ]));
  const response = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source },
    },
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(body), [
    "entity",
    "source",
    "rows",
    "summary",
    "clientOptions",
    "clientOptionsTruncated",
  ]);
  assert.deepEqual(body.source, {
    kind: "csv",
    fileName: "first-run.csv",
  });
  assert.deepEqual(Object.keys(body.rows[0]), [
    "rowKey",
    "rowNumber",
    "state",
    "reasons",
    "values",
  ]);
  assert.deepEqual(body.rows[0].values, {
    name: "FCI TEST — DO NOT USE — public preview",
    code: "LEGACY-PUBLIC",
    codeDisposition: "import-alias",
    status: "active",
    industry: "Commercial",
    primaryContact: "Public Contact",
    email: "public@example.test",
    phone: "555-0161",
    address: "16 Public Way",
    addressReviewOnly: true,
  });
  assert.equal(body.clientOptionsTruncated, false);
  assert.equal(body.rows[0].state, "ready");
  assert.deepEqual(body.summary, {
    total: 1,
    ready: 1,
    duplicates: 0,
    invalid: 0,
    blockedRealData: 0,
    unmatchedClients: 0,
    ambiguousClients: 0,
  });
  assert.equal(database.writes.length, 0);
  assert.equal(JSON.stringify(body).includes(source.content), false);
});

test("SET-25 confirm re-previews server-side, creates selected rows with provenance, and reruns idempotently", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const originalContent = csv([
    CLIENT_HEADERS,
    [
      "LEGACY-ONE",
      "FCI TEST — DO NOT USE — imported one",
      "active",
      "Commercial",
      "First Contact",
      "one@example.test",
      "555-0110",
      "44 Private Import Way, Cherry Hill, NJ",
    ],
    [
      "LEGACY-TWO",
      "FCI TEST — DO NOT USE — imported two",
      "active",
      "",
      "",
      "",
      "",
      "",
    ],
  ]);
  const source = csvSource(originalContent, "clients.csv");
  const previewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source },
    },
  ));
  const preview = await previewResponse.json();
  const selected = preview.rows[0];

  const staleSource = csvSource(originalContent.replace(
    "FCI TEST — DO NOT USE — imported one",
    "FCI TEST — DO NOT USE — source changed",
  ), "clients.csv");
  const stale = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source: staleSource,
        rows: [{ rowKey: selected.rowKey }],
      },
    },
  ));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "import_review_stale");
  assert.equal(database.state.clients.length, 0);

  const confirmedResponse = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source,
        rows: [{ rowKey: selected.rowKey }],
      },
    },
  ));
  const confirmed = await confirmedResponse.json();
  assert.equal(confirmedResponse.status, 201);
  assert.equal(confirmedResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(confirmed), [
    "entity",
    "created",
    "duplicates",
    "rejected",
    "results",
  ]);
  assert.equal(confirmed.created, 1);
  assert.equal(confirmed.duplicates, 0);
  assert.equal(database.state.clients.length, 1);
  assert.equal(
    database.state.clients[0].name,
    "FCI TEST — DO NOT USE — imported one",
  );
  assert.equal(database.state.activities.length, 1);
  assert.equal(database.state.activities[0].action, "Client imported");
  assert.match(database.state.activities[0].detail, /SET-25 first-run import/u);
  assert.match(database.state.activities[0].detail, /source=csv/u);
  assert.match(
    database.state.activities[0].detail,
    /sourceClientCode=legacy-one/u,
  );
  assert.match(
    database.state.activities[0].detail,
    /sourceAddressDigest=[0-9a-f]{64}/u,
  );
  assert.doesNotMatch(
    database.state.activities[0].detail,
    /44 Private Import Way|44%20Private%20Import%20Way|clients\.csv/u,
  );
  const atomicBatch = database.batches.find((batch) => (
    batch.some(({ sql }) => /^INSERT INTO clients /u.test(sql))
  ));
  assert.ok(atomicBatch, "the root insert must use the repository batch");
  assert.match(
    atomicBatch[0].sql,
    /^UPDATE google_drive_operations SET status = 'committing'/u,
  );
  assert.match(
    atomicBatch.at(-1).sql,
    /^UPDATE google_drive_operations SET status = 'completed'/u,
  );
  const rootInsert = atomicBatch.find(({ sql }) => /^INSERT INTO clients /u.test(sql));
  assert.match(
    rootInsert.sql,
    /EXISTS \(SELECT 1 FROM google_drive_operations WHERE operation_key = \? AND status = 'committing' AND lease_expires_at = \?\)/u,
  );
  assert.equal(rootInsert.values.at(-2), atomicBatch[0].values[1]);
  assert.equal(rootInsert.values.at(-1), atomicBatch[0].values[2]);
  assert.equal(atomicBatch.at(-1).values[1], atomicBatch[0].values[1]);
  assert.equal(atomicBatch.at(-1).values[2], atomicBatch[0].values[2]);

  const repeatPreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source },
    },
  ));
  const repeatPreview = await repeatPreviewResponse.json();
  assert.equal(repeatPreview.rows[0].state, "duplicate");
  assert.equal(
    repeatPreview.rows[1].state,
    "ready",
    JSON.stringify(repeatPreview.rows[1]),
  );
  const failedLeaseWritesBeforeReplay = database.writes.filter(({ sql }) => (
    /^UPDATE google_drive_operations SET status = 'failed'/u.test(sql)
  )).length;

  const repeated = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source,
        rows: [{ rowKey: repeatPreview.rows[0].rowKey }],
      },
    },
  ));
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 200);
  assert.equal(repeated.headers.get("cache-control"), "no-store");
  assert.equal(repeatedBody.created, 0);
  assert.equal(repeatedBody.duplicates, 1);
  assert.equal(repeatedBody.rejected, 0);
  assert.deepEqual(repeatedBody.results, [{
    rowKey: repeatPreview.rows[0].rowKey,
    rowNumber: 2,
    outcome: "duplicate",
    id: null,
    identifier: null,
  }]);
  assert.equal(database.state.clients.length, 1);
  assert.equal(database.state.activities.length, 1);
  assert.equal(
    database.writes.filter(({ sql }) => /^INSERT INTO clients /u.test(sql)).length,
    1,
    "durable duplicates are finalized without another root insert",
  );
  assert.equal(
    database.writes.filter(({ sql }) => (
      /^INSERT INTO activity_events /u.test(sql)
    )).length,
    1,
    "durable duplicates never enqueue a second provenance statement",
  );
  assert.equal(
    database.writes.filter(({ sql }) => (
      /^UPDATE google_drive_operations SET status = 'failed'/u.test(sql)
    )).length,
    failedLeaseWritesBeforeReplay,
    "an idempotent duplicate replay completes rather than failing the lease",
  );
  const replayBatch = database.batches.at(-1);
  assert.equal(replayBatch.length, 2);
  assert.match(
    replayBatch[0].sql,
    /^UPDATE google_drive_operations SET status = 'committing'/u,
  );
  assert.match(
    replayBatch[1].sql,
    /^UPDATE google_drive_operations SET status = 'completed'/u,
  );
  assert.equal(
    replayBatch.some(({ sql }) => (
      /^INSERT INTO (?:clients|contacts|activity_events) /u.test(sql)
    )),
    false,
  );
});

test("SET-25 stale confirmation replays an imported source alias as a safe duplicate", async () => {
  const firstSource = csvSource(csv([
    CLIENT_HEADERS,
    [
      "LEGACY-ALIAS-ONLY",
      "FCI TEST — DO NOT USE — alias winner",
      "active",
      "Commercial",
      "Alias Winner Contact",
      "alias-winner@example.test",
      "856-555-0160",
      "60 Alias Winner Way",
    ],
  ]), "alias-winner.csv");
  const staleSource = csvSource(csv([
    CLIENT_HEADERS,
    [
      "  legacy-alias-only  ",
      "FCI TEST — DO NOT USE — stale alias contender",
      "active",
      "Residential",
      "Alias Contender Contact",
      "alias-contender@example.test",
      "856-555-0161",
      "61 Alias Contender Way",
    ],
  ]), "alias-contender.csv");
  const database = fakeDatabase();
  setEnvironment(database);

  const stalePreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source: staleSource },
    },
  ));
  const stalePreview = await stalePreviewResponse.json();
  assert.equal(stalePreview.rows[0].state, "ready");

  const firstPreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source: firstSource },
    },
  ));
  const firstPreview = await firstPreviewResponse.json();
  const firstConfirmation = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source: firstSource,
        rows: [{ rowKey: firstPreview.rows[0].rowKey }],
      },
    },
  ));
  assert.equal(firstConfirmation.status, 201);
  assert.equal(database.state.clients.length, 1);
  assert.equal(database.state.activities.length, 1);
  assert.match(
    database.state.activities[0].detail,
    /sourceClientCode=legacy-alias-only/u,
  );

  const replay = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source: staleSource,
        rows: [{ rowKey: stalePreview.rows[0].rowKey }],
      },
    },
  ));
  const replayBody = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayBody.created, 0);
  assert.equal(replayBody.duplicates, 1);
  assert.equal(replayBody.rejected, 0);
  assert.deepEqual(replayBody.results.map(({ outcome, id, identifier }) => ({
    outcome,
    id,
    identifier,
  })), [{
    outcome: "duplicate",
    id: null,
    identifier: null,
  }]);
  assert.equal(database.state.clients.length, 1);
  assert.equal(database.state.activities.length, 1);
  assert.equal(
    database.state.clients.some(({ name }) => name.includes("stale alias contender")),
    false,
  );
  const replayBatch = database.batches.at(-1);
  assert.equal(replayBatch.length, 2);
  assert.match(
    replayBatch[0].sql,
    /^UPDATE google_drive_operations SET status = 'committing'/u,
  );
  assert.match(
    replayBatch[1].sql,
    /^UPDATE google_drive_operations SET status = 'completed'/u,
  );
  assert.equal(
    replayBatch.some(({ sql }) => (
      /^INSERT INTO (?:clients|contacts|activity_events) /u.test(sql)
    )),
    false,
    "normalized durable aliases are synthetic no-op duplicates",
  );
});

test("SET-25 project confirmation binds the reviewed client and effective segment", async () => {
  const source = csvSource(csv([
    PROJECT_HEADERS,
    [
      "FCI TEST — DO NOT USE — reviewed project",
      "CL-REVIEW01",
      "FCI TEST — DO NOT USE — Reviewed client",
      "reviewed@example.test",
      "25 Reviewed Way",
      "planning",
      "",
      "",
      "",
      "",
      "",
    ],
  ]), "projects.csv");

  const industryDatabase = fakeDatabase({
    clients: [{
      id: "client-reviewed",
      client_code: "CL-REVIEW01",
      name: "FCI TEST — DO NOT USE — Reviewed client",
      industry: "Residential",
      email: "reviewed@example.test",
      phone: null,
    }],
  });
  setEnvironment(industryDatabase);
  const industryPreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "projects", source },
    },
  ));
  const industryPreview = await industryPreviewResponse.json();
  assert.equal(industryPreview.rows[0].values.segment, "residential");
  industryDatabase.state.clients[0].industry = "Commercial";

  const staleSegment = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "projects",
        source,
        rows: [{
          rowKey: industryPreview.rows[0].rowKey,
          clientId: "client-reviewed",
          effectiveSegment: "residential",
        }],
      },
    },
  ));
  assert.equal(staleSegment.status, 409);
  assert.equal((await staleSegment.json()).code, "import_review_stale");
  assert.equal(industryDatabase.state.projects.length, 0);
  assert.equal(industryDatabase.state.activities.length, 0);

  const targetDatabase = fakeDatabase({
    clients: [{
      id: "client-reviewed",
      client_code: "CL-REVIEW01",
      name: "FCI TEST — DO NOT USE — Reviewed client",
      industry: "Residential",
      email: "reviewed@example.test",
      phone: null,
    }],
  });
  setEnvironment(targetDatabase);
  const targetPreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "projects", source },
    },
  ));
  const targetPreview = await targetPreviewResponse.json();
  Object.assign(targetDatabase.state.clients[0], {
    client_code: "CL-OLD0001",
    name: "FCI TEST — DO NOT USE — Old target",
    email: "old@example.test",
  });
  targetDatabase.state.clients.push({
    id: "client-new-target",
    client_code: "CL-REVIEW01",
    name: "FCI TEST — DO NOT USE — Reviewed client",
    industry: "Residential",
    email: "reviewed@example.test",
    phone: null,
  });

  const staleTarget = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "projects",
        source,
        rows: [{
          rowKey: targetPreview.rows[0].rowKey,
          clientId: "client-reviewed",
          effectiveSegment: "residential",
        }],
      },
    },
  ));
  assert.equal(staleTarget.status, 409);
  assert.equal((await staleTarget.json()).code, "import_review_stale");
  assert.equal(targetDatabase.state.projects.length, 0);
  assert.equal(targetDatabase.state.activities.length, 0);

  const confirmedDatabase = fakeDatabase({
    clients: [{
      id: "client-reviewed",
      client_code: "CL-REVIEW01",
      name: "FCI TEST — DO NOT USE — Reviewed client",
      industry: "Residential",
      email: "reviewed@example.test",
      phone: null,
    }],
  });
  setEnvironment(confirmedDatabase);
  const confirmedPreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "projects", source },
    },
  ));
  const confirmedPreview = await confirmedPreviewResponse.json();
  const confirmed = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "projects",
        source,
        rows: [{
          rowKey: confirmedPreview.rows[0].rowKey,
          clientId: "client-reviewed",
          effectiveSegment: "residential",
        }],
      },
    },
  ));
  assert.equal(confirmed.status, 201);
  assert.equal(confirmedDatabase.state.projects[0].client_id, "client-reviewed");
  assert.equal(confirmedDatabase.state.projects[0].segment, "residential");
});

test("SET-25 project root writes reject a client removed after review", async () => {
  const source = csvSource(csv([
    PROJECT_HEADERS,
    [
      "FCI TEST — DO NOT USE — removed-client project",
      "CL-REMOVED1",
      "FCI TEST — DO NOT USE — Removed client",
      "removed@example.test",
      "70 Removed Way",
      "planning",
      "",
      "",
      "",
      "",
      "",
    ],
  ]), "removed-client-project.csv");
  const database = fakeDatabase({
    clients: [{
      id: "client-removed",
      client_code: "CL-REMOVED1",
      name: "FCI TEST — DO NOT USE — Removed client",
      industry: "Commercial",
      email: "removed@example.test",
      phone: null,
    }],
  });
  setEnvironment(database);
  const previewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "projects", source },
    },
  ));
  const preview = await previewResponse.json();
  assert.equal(preview.rows[0].state, "ready");
  database.state.beforeNextBatch = () => {
    database.state.clients.length = 0;
  };

  const response = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "projects",
        source,
        rows: [{
          rowKey: preview.rows[0].rowKey,
          clientId: "client-removed",
          effectiveSegment: "commercial",
        }],
      },
    },
  ));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.created, 0);
  assert.equal(body.duplicates, 0);
  assert.equal(body.rejected, 1);
  assert.deepEqual(body.results.map(({ outcome, id, identifier }) => ({
    outcome,
    id,
    identifier,
  })), [{
    outcome: "missing-client",
    id: null,
    identifier: null,
  }]);
  assert.equal(database.state.projects.length, 0);
  assert.equal(database.state.activities.length, 0);
  assert.ok(database.reads.some(({ sql, values, kind }) => (
    kind === "first"
    && /^SELECT id FROM clients WHERE id = \? LIMIT 1$/u.test(sql)
    && values[0] === "client-removed"
  )));
});

test("SET-25 serializes overlapping confirmations and re-previews a conflicting retry", async () => {
  const firstSource = csvSource(csv([
    CLIENT_HEADERS,
    [
      "LEGACY-CONCURRENT-A",
      "FCI TEST — DO NOT USE — concurrent A",
      "active",
      "Commercial",
      "Concurrent Contact A",
      "concurrent@example.test",
      "856-555-0125",
      "25 Concurrent Way",
    ],
  ]), "concurrent-a.csv");
  const secondSource = csvSource(csv([
    CLIENT_HEADERS,
    [
      "LEGACY-CONCURRENT-B",
      "FCI TEST — DO NOT USE — concurrent B",
      "active",
      "Commercial",
      "Concurrent Contact B",
      "concurrent@example.test",
      "(856) 555-0125",
      "25 Concurrent Way",
    ],
  ]), "concurrent-b.csv");
  const database = fakeDatabase();
  setEnvironment(database);
  const [firstPreviewResponse, secondPreviewResponse] = await Promise.all([
    previewRoute.POST(request("/api/v1/settings/first-run-import/preview", {
      method: "POST",
      body: { entity: "clients", source: firstSource },
    })),
    previewRoute.POST(request("/api/v1/settings/first-run-import/preview", {
      method: "POST",
      body: { entity: "clients", source: secondSource },
    })),
  ]);
  const firstPreview = await firstPreviewResponse.json();
  const secondPreview = await secondPreviewResponse.json();
  const snapshotEntered = deferred();
  const releaseSnapshot = deferred();
  database.state.beforeNextClientSnapshot = async () => {
    snapshotEntered.resolve();
    await releaseSnapshot.promise;
  };

  const firstConfirmation = confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source: firstSource,
        rows: [{ rowKey: firstPreview.rows[0].rowKey }],
      },
    },
  ));
  await snapshotEntered.promise;

  const overlapping = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source: secondSource,
        rows: [{ rowKey: secondPreview.rows[0].rowKey }],
      },
    },
  ));
  assert.equal(overlapping.status, 409);
  assert.equal(overlapping.headers.get("cache-control"), "no-store");
  assert.equal((await overlapping.json()).code, "import_in_progress");
  assert.equal(database.state.clients.length, 0);
  assert.equal(database.state.activities.length, 0);

  releaseSnapshot.resolve();
  const first = await firstConfirmation;
  assert.equal(first.status, 201);
  assert.equal(database.state.clients.length, 1);
  assert.equal(database.state.activities.length, 1);

  const retry = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source: secondSource,
        rows: [{ rowKey: secondPreview.rows[0].rowKey }],
      },
    },
  ));
  const retryBody = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(retryBody.created, 0);
  assert.equal(retryBody.duplicates, 1);
  assert.equal(retryBody.rejected, 0);
  assert.deepEqual(retryBody.results.map(({ outcome, id, identifier }) => ({
    outcome,
    id,
    identifier,
  })), [{
    outcome: "duplicate",
    id: null,
    identifier: null,
  }]);
  assert.equal(database.state.clients.length, 1);
  assert.equal(database.state.activities.length, 1);
  assert.equal(
    database.writes.filter(({ sql }) => /^INSERT INTO clients /u.test(sql)).length,
    1,
  );
  const retryBatch = database.batches.at(-1);
  assert.equal(retryBatch.length, 2);
  assert.equal(
    retryBatch.some(({ sql }) => /^INSERT INTO /u.test(sql)),
    false,
  );
});

test("SET-25 atomically rechecks duplicate keys at the fenced root insert", async () => {
  const source = csvSource(csv([
    CLIENT_HEADERS,
    [
      "LEGACY-ATOMIC",
      "FCI TEST — DO NOT USE — atomic duplicate",
      "active",
      "Commercial",
      "Atomic Contact",
      "atomic@example.test",
      "856-555-0150",
      "50 Atomic Way",
    ],
  ]), "atomic-duplicate.csv");
  const database = fakeDatabase();
  setEnvironment(database);
  const previewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source },
    },
  ));
  const preview = await previewResponse.json();
  assert.equal(preview.rows[0].state, "ready");

  database.state.beforeNextBatch = () => {
    database.state.clients.push({
      id: "client-concurrent-winner",
      client_code: "CL-WINNER1",
      name: "FCI TEST — DO NOT USE — concurrent winner",
      industry: "Commercial",
      email: "ATOMIC@example.test",
      phone: null,
    });
  };
  const response = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source,
        rows: [{ rowKey: preview.rows[0].rowKey }],
      },
    },
  ));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.created, 0);
  assert.equal(body.duplicates, 1);
  assert.deepEqual(body.results.map(({ outcome, id, identifier }) => ({
    outcome,
    id,
    identifier,
  })), [{
    outcome: "duplicate",
    id: null,
    identifier: null,
  }]);
  assert.equal(database.state.clients.length, 1);
  assert.equal(database.state.activities.length, 0);
});

test("SET-25 rejects a replaced lease before the root batch and preserves the successor", async () => {
  const source = csvSource(csv([
    CLIENT_HEADERS,
    [
      "LEGACY-FENCE",
      "FCI TEST — DO NOT USE — fenced import",
      "active",
      "Commercial",
      "Fenced Contact",
      "fenced@example.test",
      "856-555-0151",
      "51 Fenced Way",
    ],
  ]), "lease-fence.csv");
  const database = fakeDatabase();
  setEnvironment(database);
  const previewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source },
    },
  ));
  const preview = await previewResponse.json();
  let operationKey = null;
  let successorExpiry = null;
  database.state.beforeNextBatch = () => {
    [operationKey] = database.state.leases.keys();
    const current = database.state.leases.get(operationKey);
    successorExpiry = current.leaseExpiresAt + 60_000;
    database.state.leases.set(operationKey, {
      status: "in-progress",
      leaseExpiresAt: successorExpiry,
      errorCode: null,
    });
  };

  const response = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source,
        rows: [{ rowKey: preview.rows[0].rowKey }],
      },
    },
  ));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.code, "import_confirmation_expired");
  assert.equal(database.state.clients.length, 0);
  assert.equal(database.state.activities.length, 0);
  assert.deepEqual(database.state.leases.get(operationKey), {
    status: "in-progress",
    leaseExpiresAt: successorExpiry,
    errorCode: null,
  });
  assert.equal(
    database.writes.some(({ sql, values }) => (
      /^UPDATE google_drive_operations SET status = 'failed'/u.test(sql)
      && values[3] === successorExpiry
    )),
    false,
    "the stale request must never release the replacement lease",
  );
});

test("SET-25 simulation source never calls Google and imported source aliases match projects without creating clients", async () => {
  const database = fakeDatabase({
    blueprint: importBlueprint(),
    resources: [importResource()],
  });
  setEnvironment(database);
  let googleCalls = 0;
  globalThis.fetch = async () => {
    googleCalls += 1;
    throw new Error("SET-25 simulation must never contact Google.");
  };

  const clientSource = csvSource(csv([
    CLIENT_HEADERS,
    [
      "LEGACY-SET25",
      "FCI TEST — DO NOT USE — SET-25 imported client",
      "active",
      "Commercial",
      "SET-25 Test Contact",
      "set25-import@example.test",
      "555-0125",
      "25 Simulation Way, Cherry Hill, NJ",
    ],
  ]), "alias-client.csv");
  const clientPreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source: clientSource },
    },
  ));
  const clientPreview = await clientPreviewResponse.json();
  const clientConfirm = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "clients",
        source: clientSource,
        rows: [{ rowKey: clientPreview.rows[0].rowKey }],
      },
    },
  ));
  assert.equal(clientConfirm.status, 201);
  const importedClientId = database.state.clients[0].id;
  assert.match(
    database.state.activities[0].detail,
    /sourceAddressDigest=[0-9a-f]{64}/u,
  );
  assert.doesNotMatch(
    database.state.activities[0].detail,
    /25 Simulation Way|25%20Simulation%20Way|alias-client\.csv/u,
  );

  const repeatedAddressSource = csvSource(csv([
    CLIENT_HEADERS,
    [
      "DIFFERENT-ALIAS",
      "FCI TEST — DO NOT USE — different client same address",
      "active",
      "Commercial",
      "",
      "",
      "",
      "25 Simulation Way, Cherry Hill, NJ",
    ],
  ]), "repeated-address.csv");
  const repeatedAddressResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "clients", source: repeatedAddressSource },
    },
  ));
  const repeatedAddress = await repeatedAddressResponse.json();
  assert.equal(repeatedAddress.rows[0].state, "duplicate");
  assert.match(repeatedAddress.rows[0].reasons[0], /address matches an existing client/u);

  const writesBeforeProject = database.writes.length;

  const spreadsheetSource = {
    kind: "spreadsheet",
    spreadsheetKey: "first-run-import",
  };
  const projectPreviewResponse = await previewRoute.POST(request(
    "/api/v1/settings/first-run-import/preview",
    {
      method: "POST",
      body: { entity: "projects", source: spreadsheetSource },
    },
  ));
  const projectPreview = await projectPreviewResponse.json();
  assert.equal(projectPreviewResponse.status, 200);
  assert.equal(projectPreview.rows[0].state, "ready");
  assert.equal(projectPreview.rows[0].clientId, importedClientId);
  assert.equal(googleCalls, 0);
  assert.equal(database.writes.length, writesBeforeProject);

  const projectConfirmResponse = await confirmRoute.POST(request(
    "/api/v1/settings/first-run-import/confirm",
    {
      method: "POST",
      body: {
        entity: "projects",
        source: spreadsheetSource,
        rows: [{
          rowKey: projectPreview.rows[0].rowKey,
          clientId: importedClientId,
          effectiveSegment: "commercial",
        }],
      },
    },
  ));
  const projectConfirm = await projectConfirmResponse.json();
  assert.equal(projectConfirmResponse.status, 201);
  assert.equal(projectConfirm.created, 1);
  assert.equal(database.state.projects.length, 1);
  assert.equal(database.state.clients.length, 1);
  assert.equal(googleCalls, 0);
  assert.equal(
    database.writes
      .slice(writesBeforeProject)
      .some(({ sql }) => /^INSERT INTO clients /u.test(sql)),
    false,
  );
  assert.equal(
    database.state.activities.at(-1).action,
    "Project imported",
  );
});

test("SET-25 live-sheet source derives its bounded row range from the batch limit", async () => {
  const sharedSource = await readFile(
    new URL("../app/api/v1/settings/first-run-import/_shared.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    sharedSource,
    /const metadata = await sheets\.metadata\(\);[\s\S]*sheets\.values\(importRange\(metadata, entity\)\)/u,
  );
  assert.match(
    sharedSource,
    /gridProperties\?\.columnCount[\s\S]*MAX_FIRST_RUN_IMPORT_SHEET_COLUMNS[\s\S]*FIRST_RUN_IMPORT_MAX_ROWS \+ 2/u,
  );
  assert.match(
    sharedSource,
    /acquireWorkspaceSetupLease[\s\S]*readRepository\.snapshot\(\)[\s\S]*Date\.now\(\) >= lease\.leaseExpiresAt[\s\S]*confirmFirstRunImport/u,
  );
  assert.doesNotMatch(sharedSource, /A1:Z102/u);
});

test("SET-25 D1 root writes pin every duplicate key and the exact lease fence", async () => {
  const adapterSource = await readFile(
    new URL("../app/adapters/d1/first-run-import-repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    adapterSource,
    /NOT EXISTS \(SELECT 1 FROM contacts WHERE LOWER\(TRIM\(COALESCE\(email, ''\)\)\) = \?/u,
  );
  assert.match(
    adapterSource,
    /REPLACE\(REPLACE\(REPLACE\(REPLACE\(REPLACE\(REPLACE\(REPLACE\(TRIM\(COALESCE\(phone, ''\)\)/u,
  );
  assert.match(
    adapterSource,
    /NOT EXISTS \(SELECT 1 FROM projects WHERE LOWER\(TRIM\(COALESCE\(site, ''\)\)\) = LOWER\(TRIM\(\?\)\)/u,
  );
  assert.match(
    adapterSource,
    /sourceClientCode=' \|\| \?/u,
  );
  assert.match(
    adapterSource,
    /sourceAddressDigest=' \|\| \?/u,
  );
  assert.match(
    adapterSource,
    /leaseCommitClaimStatement[\s\S]*status = 'committing'[\s\S]*leaseCompletionStatement[\s\S]*status = 'completed'/u,
  );
  assert.match(
    adapterSource,
    /const statements: D1PreparedStatement\[\] = \[\s*leaseCommitClaimStatement[\s\S]*statements\.push\(leaseCompletionStatement[\s\S]*database\.batch\(statements\)/u,
  );
  assert.match(
    adapterSource,
    /async function completeNoopLease[\s\S]*database\.batch\(\[\s*leaseCommitClaimStatement\(database, fence, now\),\s*leaseCompletionStatement\(database, fence, now\),\s*\]\)[\s\S]*rows\.length === 0[\s\S]*await completeNoopLease\(database, writeFence\)/u,
  );
});

test("SET-25 readiness exposes the real-data gate and exact import-source status without provider calls", async () => {
  const database = fakeDatabase({
    blueprint: importBlueprint(),
    resources: [importResource()],
  });
  setEnvironment(database);
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Readiness must not contact Google.");
  };

  const response = await statusRoute.GET(request(
    "/api/v1/settings/first-run-import",
  ));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    counts: { clients: 0, projects: 0 },
    recordsExist: false,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: "first-run-import",
      name: "FCI First-run Import",
      ready: true,
    }],
  });
  assert.equal(providerCalls, 0);
});

test("SET-25 saved-client lookup is admin-only, bounded, no-store, and finds clients beyond the preview cap", async () => {
  const deniedDatabase = {
    prepare() {
      throw new Error("Denied or invalid client searches must not touch D1.");
    },
  };
  setEnvironment(deniedDatabase);

  const denied = await clientLookupRoute.GET(request(
    "/api/v1/settings/first-run-import/clients?q=client",
    { email: OFFICE_EMAIL },
  ));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("cache-control"), "no-store");

  for (const query of ["", "x", "x".repeat(101), "valid%00control"]) {
    const invalid = await clientLookupRoute.GET(request(
      `/api/v1/settings/first-run-import/clients?q=${query}`,
    ));
    assert.equal(invalid.status, 400, query);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
    assert.deepEqual(await invalid.json(), {
      error: "Client search must be between 2 and 100 characters.",
    });
  }

  const clients = Array.from({ length: 130 }, (_, index) => ({
    id: `saved-client-${String(index).padStart(3, "0")}`,
    client_code: `CL-${String(index).padStart(8, "0")}`,
    name: index === 119
      ? "FCI TEST — DO NOT USE — Hidden Needle Account"
      : `FCI TEST — DO NOT USE — Lookup Account ${String(index).padStart(3, "0")}`,
    industry: index === 119 ? "Residential" : "Commercial",
    email: index === 119
      ? "needle@example.test"
      : `lookup-${index}@example.test`,
    phone: null,
  }));
  const database = fakeDatabase({ clients });
  setEnvironment(database);
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Saved-client lookup must not contact Google.");
  };

  const capped = await clientLookupRoute.GET(request(
    "/api/v1/settings/first-run-import/clients?q=%20%20lookup%20%20account%20",
  ));
  const cappedBody = await capped.json();
  assert.equal(capped.status, 200);
  assert.equal(capped.headers.get("cache-control"), "no-store");
  assert.equal(cappedBody.query, "lookup account");
  assert.equal(cappedBody.results.length, 20);
  assert.equal(cappedBody.more, true);
  assert.deepEqual(Object.keys(cappedBody.results[0]), [
    "id",
    "code",
    "name",
    "email",
    "defaultSegment",
  ]);

  const beyondPreviewCap = await clientLookupRoute.GET(request(
    "/api/v1/settings/first-run-import/clients?q=needle%40example.test",
  ));
  const beyondPreviewCapBody = await beyondPreviewCap.json();
  assert.equal(beyondPreviewCap.status, 200);
  assert.equal(beyondPreviewCap.headers.get("cache-control"), "no-store");
  assert.deepEqual(beyondPreviewCapBody, {
    query: "needle@example.test",
    results: [{
      id: "saved-client-119",
      code: "CL-00000119",
      name: "FCI TEST — DO NOT USE — Hidden Needle Account",
      email: "needle@example.test",
      defaultSegment: "residential",
    }],
    more: false,
  });
  assert.equal(database.writes.length, 0);
  assert.equal(providerCalls, 0);
});

test("SET-25 raises issues for contact values rejected for length or control characters", async () => {
  const overLongEmail = `${"e".repeat(250)}@example.test`;
  // Control characters (BEL, SOH) are rejected outright by the shared text normalizer.
  const controlEmail = `control${String.fromCharCode(7)}contact@example.test`;
  const controlPhone = `856-555${String.fromCharCode(1)}-0111`;
  const clients = await domain.previewFirstRunImport({
    entity: "clients",
    expectedHeaders: CLIENT_HEADERS,
    snapshot: emptySnapshot(),
    values: [
      CLIENT_HEADERS,
      [
        "LEN-EMAIL",
        "FCI TEST — DO NOT USE — over-long email",
        "active",
        "Commercial",
        "Length Contact",
        overLongEmail,
        "",
        "",
      ],
      [
        "CTRL-EMAIL",
        "FCI TEST — DO NOT USE — control-character email",
        "active",
        "Commercial",
        "Control Contact",
        controlEmail,
        "",
        "",
      ],
      [
        "LEN-PHONE",
        "FCI TEST — DO NOT USE — over-long phone",
        "active",
        "Commercial",
        "Phone Contact",
        "",
        "8".repeat(41),
        "",
      ],
      [
        "CTRL-PHONE",
        "FCI TEST — DO NOT USE — control-character phone",
        "active",
        "Commercial",
        "Phone Contact",
        "",
        controlPhone,
        "",
      ],
      [
        "BLANK-CONTACT",
        "FCI TEST — DO NOT USE — whitespace contact cells",
        "active",
        "Commercial",
        "Whitespace Contact",
        "   ",
        "   ",
        "",
      ],
    ],
  });

  assert.deepEqual(clients.rows.map(({ state }) => state), [
    "invalid",
    "invalid",
    "invalid",
    "invalid",
    "ready",
  ]);
  assert.deepEqual(
    clients.rows.map(({ issues }) => issues.map(({ code }) => code)),
    [
      ["contact_email_invalid"],
      ["contact_email_invalid"],
      ["contact_phone_invalid"],
      ["contact_phone_invalid"],
      [],
    ],
  );
  assert.equal(clients.confirmable, 1);

  const savedClient = storedClient({
    id: "client-contact-issues",
    code: "CL-CONTACT1",
    name: "FCI TEST — DO NOT USE — Contact issue client",
    email: "contact-issue@example.test",
  });
  const projects = await domain.previewFirstRunImport({
    entity: "projects",
    expectedHeaders: PROJECT_HEADERS,
    snapshot: emptySnapshot([savedClient]),
    values: [
      PROJECT_HEADERS,
      [
        "FCI TEST — DO NOT USE — over-long client email",
        savedClient.clientCode,
        savedClient.name,
        overLongEmail,
        "",
        "planning",
        "",
        "",
        "",
        "",
        "",
      ],
      [
        "FCI TEST — DO NOT USE — control-character client email",
        savedClient.clientCode,
        savedClient.name,
        controlEmail,
        "",
        "planning",
        "",
        "",
        "",
        "",
        "",
      ],
    ],
  });
  assert.deepEqual(projects.rows.map(({ state }) => state), ["invalid", "invalid"]);
  assert.deepEqual(
    projects.rows.map(({ issues }) => issues.map(({ code }) => code)),
    [["project_client_email_invalid"], ["project_client_email_invalid"]],
  );
  assert.equal(projects.confirmable, 0);
});

test("SET-25 hands reopen focus over from a commit effect, not an animation frame", async () => {
  const cardSource = await readFile(
    new URL("../app/import/components/FirstRunImportCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    cardSource,
    /pendingReopenFocusRef\.current = generation;\n\s*setOpened\(false\);/u,
  );
  assert.match(
    cardSource,
    /useEffect\(\(\) => \{\n\s*const generation = pendingReopenFocusRef\.current;[\s\S]*?const button = reopenButtonRef\.current;\n\s*if \(!button\) return;\n\s*pendingReopenFocusRef\.current = null;\n\s*button\.focus\(\);\n\s*\}\);/u,
  );
  assert.doesNotMatch(
    cardSource,
    /requestAnimationFrame\([\s\S]{0,120}?reopenButtonRef/u,
  );
});

test("SET-25 renders the exported real-data gate notice rather than restating it", async () => {
  const cardSource = await readFile(
    new URL("../app/import/components/FirstRunImportCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    cardSource,
    /import \{\n\s*FIRST_RUN_IMPORT_GATE_NOTICE,\n\s*FIRST_RUN_IMPORT_TEST_MARKER,\n\} from "\.\.\/\.\.\/domain\/first-run-import";/u,
  );
  assert.match(cardSource, /<span>\{FIRST_RUN_IMPORT_GATE_NOTICE\}<\/span>/u);
  assert.doesNotMatch(
    cardSource,
    /Real client and project data stays blocked until the WS-11 production acceptance gate passes/u,
  );
  assert.doesNotMatch(cardSource, /irreversible duplicate-check fingerprint/u);
  assert.match(
    cardSource,
    /<ul className=\{styles\.countList\} aria-label="Existing saved record counts">/u,
  );
});
