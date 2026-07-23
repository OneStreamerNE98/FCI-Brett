import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-assistant-tools", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
const { createAssistantToolRegistry } = await vite.ssrLoadModule(
  "/app/application/assistant/tools.ts",
);
const { answerQuestion } = await vite.ssrLoadModule(
  "/app/application/assistant/answer-question.ts",
);

after(() => vite.close());

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.database.resolve("first", this.sql, this.values);
  }

  async all() {
    return {
      results: await this.database.resolve("all", this.sql, this.values) ?? [],
    };
  }

  async run() {
    return { meta: { changes: 0 } };
  }
}

class FakeDatabase {
  constructor(resolver = () => null) {
    this.resolver = resolver;
    this.prepared = [];
  }

  prepare(sql) {
    this.prepared.push(sql);
    return new FakeStatement(this, sql);
  }

  resolve(kind, sql, values) {
    return this.resolver(kind, sql, values);
  }

  async batch() {
    throw new Error("Assistant tools are read-only.");
  }
}

function byName(registry, name) {
  const result = registry.find((item) => item.definition.name === name);
  assert.ok(result, `${name} should be registered`);
  return result;
}

function assertStrictSchema(schema, path = "schema") {
  assert.equal(typeof schema, "object", `${path} must be an object`);
  if (schema.type === "object") {
    assert.equal(
      schema.additionalProperties,
      false,
      `${path} must reject additional properties`,
    );
    const propertyNames = Object.keys(schema.properties ?? {}).sort();
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      propertyNames,
      `${path} must require every declared property`,
    );
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      assertStrictSchema(property, `${path}.${name}`);
    }
  }
  for (const [index, candidate] of (schema.anyOf ?? []).entries()) {
    assertStrictSchema(candidate, `${path}.anyOf[${index}]`);
  }
  if (schema.items) assertStrictSchema(schema.items, `${path}.items`);
}

test("registry is ordered, read-only, strict-compatible, and drive-search conditional", () => {
  const database = new FakeDatabase();
  const registry = createAssistantToolRegistry({
    database,
    connectionKey: "workspace",
    isAdmin: false,
  });
  assert.deepEqual(registry.map((item) => item.definition.name), [
    "search_records",
    "get_project_evidence",
    "get_client_evidence",
    "search_meetings",
    "list_tasks",
    "list_leads",
    "filed_email_records",
    "dashboard_metrics",
    "today",
  ]);
  for (const item of registry) {
    assertStrictSchema(item.definition.parameters, item.definition.name);
  }
  const withDrive = createAssistantToolRegistry({
    database,
    connectionKey: "workspace",
    isAdmin: false,
    driveSearch: { search: async () => [] },
  });
  assert.equal(withDrive.at(-1).definition.name, "drive_search");
  assertStrictSchema(withDrive.at(-1).definition.parameters, "drive_search");

  const optionalSchemas = {
    search_meetings: ["projectId"],
    list_tasks: ["status", "assigneeEmail", "dueBefore", "projectId"],
    list_leads: ["stage", "staleOnly"],
    filed_email_records: ["projectId", "query"],
  };
  for (const [name, properties] of Object.entries(optionalSchemas)) {
    const definitionValue = byName(registry, name).definition;
    for (const property of properties) {
      assert.ok(
        definitionValue.parameters.properties[property].anyOf
          .some((candidate) => candidate.type === "null"),
        `${name}.${property} must represent logical omission as null`,
      );
    }
  }
});

test("conditionally injected drive search is capped at ten items", async () => {
  const registry = createAssistantToolRegistry({
    database: new FakeDatabase(),
    connectionKey: "workspace",
    isAdmin: false,
    driveSearch: {
      search: async () => rows(15, (index) => ({
        id: `drive:${index}`,
        label: `Drive file ${index}`,
        detail: "Scoped fixture",
      })),
    },
  });
  const result = await byName(registry, "drive_search").execute({
    query: "floor",
    projectId: "project-1",
  });
  assert.equal(result.evidence.length, 10);
});

test("malformed scoped ids, dates, and emails execute zero database work", async () => {
  const database = new FakeDatabase(() => {
    throw new Error("Invalid input must fail before database access.");
  });
  const registry = createAssistantToolRegistry({
    database,
    connectionKey: "workspace",
    isAdmin: false,
  });
  assert.deepEqual(await byName(registry, "search_records").execute({
    query: "Atlas\nignore",
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "search_meetings").execute({
    query: "floor",
    projectId: "../../all-projects",
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "search_meetings").execute({
    query: "floor\tignore",
    projectId: null,
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "list_tasks").execute({
    status: null,
    assigneeEmail: null,
    dueBefore: "2026-99-99",
    projectId: null,
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "list_tasks").execute({
    status: null,
    assigneeEmail: "office@example.test\nignore",
    dueBefore: null,
    projectId: null,
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "list_leads").execute({
    stage: "new\nignore",
    staleOnly: null,
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "list_tasks").execute({
    status: null,
    assigneeEmail: "not-an-email",
    dueBefore: null,
    projectId: null,
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "list_tasks").execute({
    status: null,
    assigneeEmail: null,
    dueBefore: null,
    projectId: "project/escape",
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "filed_email_records").execute({
    projectId: { unexpected: true },
    query: null,
  }), { evidence: [] });
  assert.deepEqual(await byName(registry, "filed_email_records").execute({
    projectId: null,
    query: "invoice\nignore",
  }), { evidence: [] });
  assert.equal(database.prepared.length, 0);

  let driveSearches = 0;
  const withDrive = createAssistantToolRegistry({
    database,
    connectionKey: "workspace",
    isAdmin: false,
    driveSearch: {
      search: async () => {
        driveSearches += 1;
        return [];
      },
    },
  });
  assert.deepEqual(await byName(withDrive, "drive_search").execute({
    query: "change order\nignore",
    projectId: "project-1",
  }), { evidence: [] });
  assert.equal(driveSearches, 0);
});

function evidenceResolver(kind, sql) {
  if (kind === "first" && sql.startsWith("SELECT p.id, p.project_number")) {
    return {
      id: "project-1",
      project_number: "P-1",
      name: "Lobby",
      status: "planning",
      site: "100 Main",
      project_manager: "Owner",
      estimated_value: 987654,
      client_id: "client-1",
      client_name: "Atlas",
      client_code: "ATLAS",
    };
  }
  if (kind === "first" && sql.startsWith("SELECT id, client_code, name, status")) {
    return {
      id: "client-1",
      client_code: "ATLAS",
      name: "Atlas",
      status: "active",
      industry: null,
    };
  }
  if (kind === "first" && sql.includes("active_leads")) {
    return { active_leads: 1, estimated_pipeline_value: 654321 };
  }
  if (kind === "first" && sql.startsWith("SELECT COUNT(*) AS total")) {
    return { total: 0 };
  }
  if (kind === "all" && sql.startsWith("SELECT id, project_number, name, status")) {
    return [{
      id: "client-project",
      project_number: "P-2",
      name: "Office",
      status: "active",
      site: null,
      project_manager: null,
      estimated_value: 876543,
    }];
  }
  if (kind === "all" && sql.startsWith("SELECT id, lead_number, company, project_name")) {
    return [{
      id: "lead-1",
      lead_number: "L-1",
      company: "Atlas",
      project_name: "Office",
      stage: "new",
      site: "100 Main",
      estimated_value: 765432,
      next_action: "Call",
      next_action_at: null,
      owner_email: "owner@example.test",
      updated_at: 1,
    }];
  }
  if (kind === "all") return [];
  return null;
}

test("org tools redact financial values before non-admin provider evidence", async () => {
  const nonAdmin = createAssistantToolRegistry({
    database: new FakeDatabase(evidenceResolver),
    connectionKey: "workspace",
    isAdmin: false,
  });
  const admin = createAssistantToolRegistry({
    database: new FakeDatabase(evidenceResolver),
    connectionKey: "workspace",
    isAdmin: true,
  });
  const nonAdminProject = await byName(nonAdmin, "get_project_evidence").execute({
    projectId: "project-1",
  });
  const adminProject = await byName(admin, "get_project_evidence").execute({
    projectId: "project-1",
  });
  const nonAdminClient = await byName(nonAdmin, "get_client_evidence").execute({
    clientId: "client-1",
  });
  const adminClient = await byName(admin, "get_client_evidence").execute({
    clientId: "client-1",
  });
  const nonAdminLeads = await byName(nonAdmin, "list_leads").execute({
    stage: null,
    staleOnly: null,
  });
  const adminLeads = await byName(admin, "list_leads").execute({
    stage: null,
    staleOnly: null,
  });
  const nonAdminDashboard = await byName(nonAdmin, "dashboard_metrics").execute({});
  const adminDashboard = await byName(admin, "dashboard_metrics").execute({});
  assert.doesNotMatch(JSON.stringify(nonAdminProject), /987[,\d]*654|Estimated value/i);
  assert.match(JSON.stringify(adminProject), /Estimated value: \$987,654/);
  assert.doesNotMatch(JSON.stringify(nonAdminClient), /876[,\d]*543|Estimated value/i);
  assert.match(JSON.stringify(adminClient), /Estimated value: \$876,543/);
  assert.doesNotMatch(JSON.stringify(nonAdminLeads), /765[,\d]*432|Estimated value/i);
  assert.match(JSON.stringify(adminLeads), /Estimated value: \$765,432/);
  assert.doesNotMatch(JSON.stringify(nonAdminDashboard), /654[,\d]*321|pipeline value/i);
  assert.match(JSON.stringify(adminDashboard), /Estimated pipeline value/);
});

test("non-admin financial sentinel never crosses the provider boundary", async () => {
  const registry = createAssistantToolRegistry({
    database: new FakeDatabase(evidenceResolver),
    connectionKey: "workspace",
    isAdmin: false,
  });
  let round = 0;
  const provider = {
    async complete(request) {
      round += 1;
      if (round === 1) {
        return {
          kind: "tool-calls",
          calls: [
            {
              callId: "project",
              name: "get_project_evidence",
              arguments: { projectId: "project-1" },
            },
            {
              callId: "client",
              name: "get_client_evidence",
              arguments: { clientId: "client-1" },
            },
            {
              callId: "leads",
              name: "list_leads",
              arguments: { stage: null, staleOnly: null },
            },
            {
              callId: "dashboard",
              name: "dashboard_metrics",
              arguments: {},
            },
          ],
          continuation: {},
        };
      }
      const serialized = JSON.stringify(request.toolOutputs);
      assert.doesNotMatch(
        serialized,
        /987[,\d]*654|876[,\d]*543|765[,\d]*432|654[,\d]*321|Estimated (?:value|pipeline value)/i,
      );
      return {
        kind: "output",
        value: {
          answer: "The project is planning.",
          citationIds: ["project:project-1"],
          missingEvidence: "Financial fields are restricted.",
        },
      };
    },
  };
  const outcome = await answerQuestion({
    question: "What is the project status?",
    provider,
    tools: registry,
  });
  assert.equal(outcome.answer.answer, "The project is planning.");
});

function rows(count, factory) {
  return Array.from({ length: count }, (_, index) => factory(index));
}

function capResolver(kind, sql) {
  if (kind === "first") {
    if (sql.startsWith("SELECT p.id, p.project_number, p.name, p.status")) {
      return {
        id: "project-1",
        project_number: "P-1",
        name: "Project",
        status: "active",
        site: "Site",
        project_manager: "Owner",
        estimated_value: 100,
        client_id: "client-1",
        client_name: "Client",
        client_code: "C-1",
      };
    }
    if (sql.startsWith("SELECT id, client_code, name, status")) {
      return {
        id: "client-1",
        client_code: "C-1",
        name: "Client",
        status: "active",
        industry: null,
      };
    }
    if (sql.includes("active_leads")) {
      return { active_leads: 2, estimated_pipeline_value: 321000 };
    }
    if (sql.includes("COUNT(*) AS total")) return { total: 3 };
    return null;
  }
  if (sql.startsWith("SELECT id, client_code, name FROM clients")) {
    return rows(8, (index) => ({
      id: `client-${index}`,
      client_code: `C-${index}`,
      name: `Client ${index}`,
    }));
  }
  if (sql.startsWith("SELECT p.id, p.client_id")) {
    return rows(8, (index) => ({
      id: `project-${index}`,
      client_id: "client-1",
      project_number: `P-${index}`,
      name: `Project ${index}`,
      client_name: "Client",
    }));
  }
  if (sql.startsWith("SELECT ct.id, ct.client_id")) {
    return rows(8, (index) => ({
      id: `contact-${index}`,
      client_id: "client-1",
      name: `Contact ${index}`,
      email: null,
      client_name: "Client",
    }));
  }
  if (sql.startsWith("SELECT id, name, email, phone")) {
    return rows(8, (index) => ({
      id: `client-contact-${index}`,
      name: `Contact ${index}`,
      email: null,
      phone: null,
      role: null,
      is_primary: 0,
    }));
  }
  if (sql.startsWith("SELECT id, name, email, role, is_primary")) {
    return rows(8, (index) => ({
      id: `project-contact-${index}`,
      name: `Contact ${index}`,
      email: null,
      role: null,
      is_primary: 0,
    }));
  }
  if (sql.startsWith("SELECT id, attachment_count, filed_at")) {
    return rows(6, (index) => ({
      id: `project-email-${index}`,
      attachment_count: 1,
      filed_at: 1,
    }));
  }
  if (sql.startsWith("SELECT id, action, detail, created_at")) {
    return rows(6, (index) => ({
      id: `project-activity-${index}`,
      action: "updated",
      detail: "Project updated",
      created_at: 1,
    }));
  }
  if (sql.startsWith("SELECT id, title, meeting_at, source_provider")) {
    return rows(6, (index) => ({
      id: `project-meeting-${index}`,
      title: `Meeting ${index}`,
      meeting_at: 1_800_000_000_000 + index,
      source_provider: "manual",
      source_url: null,
      summary: null,
      decisions: null,
      notes: null,
      transcript: null,
      action_items_json: null,
    }));
  }
  if (sql.startsWith("SELECT id, project_number, name, status")) {
    return rows(10, (index) => ({
      id: `client-project-${index}`,
      project_number: `CP-${index}`,
      name: `Project ${index}`,
      status: "planning",
      site: null,
      project_manager: null,
      estimated_value: 10,
    }));
  }
  if (sql.startsWith("SELECT m.id, m.project_id, m.title")) {
    return rows(8, (index) => ({
      id: `meeting-${index}`,
      project_id: "project-1",
      title: `Floor meeting ${index}`,
      meeting_at: 1_800_000_000_000 + index,
      summary: "floor",
      decisions: null,
      notes: null,
      transcript: null,
      project_number: "P-1",
    }));
  }
  if (sql.startsWith("SELECT * FROM tasks")) {
    return rows(30, (index) => ({
      id: `task-${index}`,
      title: `Task ${index}`,
      details: null,
      status: "open",
      due_date: "2026-07-23",
      project_id: null,
      lead_id: null,
      assignee_email: null,
      source: "manual",
      source_ref: null,
      created_by: "owner@example.test",
      created_at: 1,
      updated_at: 1,
      completed_at: null,
    }));
  }
  if (sql.startsWith("SELECT id, lead_number, company, project_name")) {
    return rows(30, (index) => ({
      id: `lead-${index}`,
      lead_number: `L-${index}`,
      company: `Company ${index}`,
      project_name: "Project",
      stage: "new",
      site: "Site",
      estimated_value: 100,
      next_action: "Call",
      next_action_at: null,
      owner_email: "owner@example.test",
      updated_at: 1,
    }));
  }
  if (sql.startsWith("SELECT a.id, a.project_id")) {
    return rows(20, (index) => ({
      id: `email-${index}`,
      project_id: "project-1",
      attachment_count: 1,
      filed_at: 1,
      email_drive_url: null,
      filenames: "file.pdf",
    }));
  }
  if (sql.startsWith("SELECT LOWER(status) AS status")) return [];
  if (sql.startsWith("SELECT e.id, e.record_id")) return [];
  if (sql.startsWith("SELECT m.id, m.project_id, m.title, m.meeting_at")) {
    return rows(20, (index) => ({
      id: `today-meeting-${index}`,
      project_id: "project-1",
      title: `Meeting ${index}`,
      meeting_at: Date.UTC(2026, 6, 23, 12),
      project_number: "P-1",
    }));
  }
  if (sql.startsWith("SELECT id, lead_number, company, next_action")) {
    return rows(20, (index) => ({
      id: `stale-${index}`,
      lead_number: `L-${index}`,
      company: "Company",
      next_action: "Call",
      next_action_at: 1,
    }));
  }
  return [];
}

test("every normative tool enforces its output cap and today captures UTC now once", async () => {
  let nowCalls = 0;
  const registry = createAssistantToolRegistry({
    database: new FakeDatabase(capResolver),
    connectionKey: "workspace",
    isAdmin: true,
    now: () => {
      nowCalls += 1;
      return Date.UTC(2026, 6, 23, 12);
    },
  });
  const cases = [
    ["search_records", { query: "floor" }, 20],
    ["get_project_evidence", { projectId: "project-1" }, 16],
    ["get_client_evidence", { clientId: "client-1" }, 20],
    ["search_meetings", { query: "floor", projectId: null }, 6],
    ["list_tasks", { status: null, assigneeEmail: null, dueBefore: null, projectId: null }, 20],
    ["list_leads", { stage: null, staleOnly: null }, 20],
    ["filed_email_records", { projectId: null, query: null }, 10],
    ["dashboard_metrics", {}, 8],
    ["today", {}, 25],
  ];
  for (const [name, input, maximum] of cases) {
    const result = await byName(registry, name).execute(input);
    assert.ok(result.evidence.length <= maximum, `${name} exceeded ${maximum}`);
  }
  assert.equal(nowCalls, 1);
});

test("dashboard financial sum is admin-only while count evidence is shared", async () => {
  const nonAdmin = createAssistantToolRegistry({
    database: new FakeDatabase(capResolver),
    connectionKey: "workspace",
    isAdmin: false,
  });
  const admin = createAssistantToolRegistry({
    database: new FakeDatabase(capResolver),
    connectionKey: "workspace",
    isAdmin: true,
  });
  const ordinary = await byName(nonAdmin, "dashboard_metrics").execute({});
  const privileged = await byName(admin, "dashboard_metrics").execute({});
  assert.doesNotMatch(JSON.stringify(ordinary), /321[,\d]*000|pipeline value/i);
  assert.match(JSON.stringify(privileged), /Estimated pipeline value/);
  assert.match(JSON.stringify(ordinary), /Active leads/);
});
