import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, rootUrl), "utf8");
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(
    new URL("../node_modules/.vite-ws18-filed-email-read-decoupling", import.meta.url),
  ),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});
const { projectEvidence } = await vite.ssrLoadModule(
  "/app/application/assistant/project-evidence.ts",
);
const { createAssistantToolRegistry } = await vite.ssrLoadModule(
  "/app/application/assistant/tools.ts",
);
const { dashboardData } = await vite.ssrLoadModule(
  "/app/application/dashboard-data.ts",
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
}

class FakeDatabase {
  constructor(resolver) {
    this.resolver = resolver;
    this.statements = [];
  }

  prepare(sql) {
    const statement = new FakeStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  resolve(kind, sql, values) {
    return this.resolver(kind, sql, values);
  }
}

function projectFixtureResolver(archives) {
  return (kind, sql, values) => {
    if (kind === "first" && sql.startsWith("SELECT p.id, p.project_number")) {
      return {
        id: "project-1",
        project_number: "P-100",
        name: "Lobby",
        status: "planning",
        site: null,
        project_manager: null,
        estimated_value: null,
        client_id: "client-1",
        client_name: "Atlas",
        client_code: "ATLAS",
      };
    }
    if (kind === "all" && sql.includes("FROM gmail_file_archives")) {
      // Project-keyed, plus the environment scope that keeps simulation
      // archives out of live evidence. What must NOT appear is scoping to one
      // caller-supplied connection.
      assert.match(sql, /WHERE project_id = ?/u);
      assert.doesNotMatch(sql, /connection_key = \? AND project_id/u);
      assert.deepEqual(values, ["project-1", "workspace-simulation"]);
      return archives;
    }
    if (kind === "first" && sql.includes("FROM gmail_file_archives")) {
      assert.doesNotMatch(sql, /connection_key = \? AND project_id/u);
      assert.deepEqual(values, ["project-1", "workspace-simulation"]);
      return {
        total: archives.length,
        connection_total: new Set(
          archives.map((archive) => archive.connection_key),
        ).size,
      };
    }
    if (kind === "first" && sql.includes("COUNT(*) AS total")) {
      return { total: 0 };
    }
    if (kind === "all") return [];
    return null;
  };
}

test("single-connection project evidence remains byte-identical", async () => {
  const database = new FakeDatabase(projectFixtureResolver([{
    id: "email-one",
    connection_key: "google-workspace",
    attachment_count: 1,
    filed_at: null,
  }]));
  const result = await projectEvidence(database, "project-1");
  const legacyPayload = {
    project: {
      id: "project-1",
      project_number: "P-100",
      name: "Lobby",
      status: "planning",
      site: null,
      project_manager: null,
      estimated_value: null,
      client_id: "client-1",
      client_name: "Atlas",
      client_code: "ATLAS",
    },
    evidence: [{
      id: "project:project-1",
      label: "Project record · P-100",
      detail: "Lobby · Atlas · planning",
    }, {
      id: "summary:project-1",
      label: "Available project evidence · P-100",
      detail: "0 client contacts · 1 filed email archive in the active Google Workspace connection · 0 meeting records",
    }, {
      id: "email:email-one",
      label: "Filed email archive",
      detail: "1 attachment",
    }],
    totals: {
      contacts: 0,
      archives: 1,
      meetings: 0,
    },
    primaryContact: null,
    meetings: [],
  };
  assert.equal(JSON.stringify(result), JSON.stringify(legacyPayload));
});

test("project evidence returns archives filed by two different connections", async () => {
  const database = new FakeDatabase(projectFixtureResolver([{
    id: "email-company",
    connection_key: "company-workspace",
    attachment_count: 1,
    filed_at: null,
  }, {
    id: "email-user",
    connection_key: "user-workspace",
    attachment_count: 2,
    filed_at: null,
  }]));
  const result = await projectEvidence(database, "project-1");
  assert.equal(result.totals.archives, 2);
  assert.deepEqual(
    result.evidence
      .filter((item) => item.id.startsWith("email:"))
      .map((item) => item.id),
    ["email:email-company", "email:email-user"],
  );
  assert.match(
    result.evidence.find((item) => item.id === "summary:project-1").detail,
    /2 filed email archives across 2 Google Workspace connections/u,
  );
});

test("filed-email tool filters by project, never by connection", async () => {
  const database = new FakeDatabase((kind, sql, values) => {
    if (kind === "all" && sql.startsWith("SELECT a.id, a.project_id")) {
      assert.match(sql, /a\.project_id = \?/u);
      // The environment scope is required; scoping to one caller-supplied
      // connection is the defect WS-18 removes.
      assert.doesNotMatch(sql, /a\.connection_key = \? AND a\.project_id/u);
      assert.deepEqual(values, ["workspace-simulation", "project-1"]);
      return [{
        id: "archive-company",
        project_id: "project-1",
        attachment_count: 1,
        filed_at: null,
        email_drive_url: null,
        filenames: "company.eml",
      }, {
        id: "archive-user",
        project_id: "project-1",
        attachment_count: 1,
        filed_at: null,
        email_drive_url: null,
        filenames: "user.eml",
      }];
    }
    return kind === "all" ? [] : null;
  });
  const registry = createAssistantToolRegistry({
    database,
    isAdmin: false,
  });
  const filedEmailTool = registry.find(
    (item) => item.definition.name === "filed_email_records",
  );
  assert.ok(filedEmailTool);
  const result = await filedEmailTool.execute({
    projectId: "project-1",
    query: null,
  });
  assert.deepEqual(
    result.evidence.map((item) => item.id),
    ["email:archive-company", "email:archive-user"],
  );
});

test("dashboard filed-email count is global across the business", async () => {
  const database = new FakeDatabase((kind, sql, values) => {
    if (kind === "first" && sql.includes("FROM gmail_file_archives")) {
      assert.doesNotMatch(sql, /connection_key = \? AND/u);
      assert.deepEqual(values, ["workspace-simulation"]);
      return { total: 2 };
    }
    if (kind === "first" && sql.includes("active_leads")) {
      return { active_leads: 0, estimated_pipeline_value: 0 };
    }
    if (kind === "first") return { total: 0 };
    return [];
  });
  const result = await dashboardData(database);
  assert.equal(result.metrics.filedEmailCount, 2);
});

test("filed-email evidence read modules expose no connection-key filter parameter", async () => {
  const [
    projectEvidenceSource,
    toolsSource,
    dashboardSource,
    assistantRouteSource,
    dashboardRouteSource,
    filingRouteSource,
  ] = await Promise.all([
    read("app/application/assistant/project-evidence.ts"),
    read("app/application/assistant/tools.ts"),
    read("app/application/dashboard-data.ts"),
    read("app/api/v1/assistant/route.ts"),
    read("app/api/v1/dashboard/route.ts"),
    read("app/api/v1/integrations/google/gmail/messages/[messageId]/file/route.ts"),
  ]);
  const readSources = [
    projectEvidenceSource,
    toolsSource,
    dashboardSource,
    assistantRouteSource,
    dashboardRouteSource,
  ];
  // What WS-18 forbids is a caller-supplied CONNECTION KEY threaded into reads —
  // not every mention of the column. Banning the string outright was too broad:
  // it also forbade the environment scope that keeps simulation archives out of
  // live evidence, which a review found this packet had removed along with the
  // per-connection filter. Test the contract instead of the vocabulary.
  for (const source of readSources) {
    assert.doesNotMatch(
      source,
      /connectionKey\s*[,:)]/u,
      "filed-email evidence reads must not accept a connection key parameter",
    );
    assert.doesNotMatch(
      source,
      /connection_key\s*=\s*\?\s*AND\s*(?:a\.)?project_id/u,
      "filed-email reads must be project-keyed, never scoped to one connection",
    );
  }
  // The isolation itself is centralised, so there is exactly one place to audit.
  for (const source of [projectEvidenceSource, toolsSource, dashboardSource]) {
    assert.match(
      source,
      /archiveScope\(/u,
      "every filed-email read must apply the shared environment scope",
    );
  }
  assert.doesNotMatch(
    projectEvidenceSource,
    /projectEvidence\(\s*database:\s*D1Database,\s*connectionKey/u,
  );
  assert.doesNotMatch(
    toolsSource,
    /connectionKey:\s*string|a\.connection_key\s*=/u,
  );
  assert.doesNotMatch(
    dashboardSource,
    /connectionKey:\s*string|connection_key\s*=/u,
  );
  assert.match(
    filingRouteSource,
    /ON CONFLICT\(connection_key, gmail_message_id\)/u,
    "the filing write path must keep connection-scoped idempotency",
  );
  assert.match(
    filingRouteSource,
    /WHERE connection_key = \? AND gmail_message_id = \?/u,
    "the filing write path must keep stamping and locating the writing connection",
  );
});

test("live evidence never adopts simulation archives, and simulation sees only its own", async () => {
  // The defect this pins (WS-18 review, P1): dropping the connection predicate
  // opened reads across connections AND across environments. Simulation filings
  // are written into the same table under the simulation connection, so a live
  // deployment began reporting pretend filings as real evidence — and once
  // adopted, a simulation reset could not purge them. Reads must stay open
  // across every REAL connection while never mixing the two environments.
  const liveCalls = [];
  const live = new FakeDatabase((kind, sql, values) => {
    if (sql.includes("FROM gmail_file_archives")) liveCalls.push({ sql, values });
    return kind === "all" ? [] : { total: 0, connection_total: 0 };
  });
  await projectEvidence(live, "project-1", {
    includeFinancials: true,
    simulation: false,
  });
  assert.ok(liveCalls.length > 0, "the read must actually query archives");
  for (const call of liveCalls) {
    assert.match(
      call.sql,
      /connection_key <> \?/u,
      "a live read must exclude the simulation connection",
    );
    assert.ok(
      call.values.includes("workspace-simulation"),
      "the excluded key must be the simulation connection",
    );
  }

  const simulationCalls = [];
  const simulated = new FakeDatabase((kind, sql, values) => {
    if (sql.includes("FROM gmail_file_archives")) simulationCalls.push({ sql, values });
    return kind === "all" ? [] : { total: 0, connection_total: 0 };
  });
  await projectEvidence(simulated, "project-1", {
    includeFinancials: true,
    simulation: true,
  });
  for (const call of simulationCalls) {
    assert.match(
      call.sql,
      /connection_key = \?/u,
      "a simulation read must see only the simulation connection",
    );
    assert.ok(call.values.includes("workspace-simulation"));
  }
});
