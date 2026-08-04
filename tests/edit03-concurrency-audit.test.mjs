import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24718 } },
});
const [clientModule, projectModule] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/d1/client-repository.ts"),
  vite.ssrLoadModule("/app/adapters/d1/project-repository.ts"),
]);

after(async () => vite.close());

const { createD1ClientRepository } = clientModule;
const { createD1ProjectRepository } = projectModule;

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ACTIVITY_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ACTIVITY_ID = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = Date.UTC(2026, 6, 27, 14, 0, 0);

class StatefulStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  first() {
    return Promise.resolve(this.database.first(this));
  }

  all() {
    return Promise.resolve({ results: [] });
  }
}

class CoreRecordD1Database {
  constructor() {
    this.clients = new Map([[
      CLIENT_ID,
      {
        id: CLIENT_ID,
        client_code: "CL-11111111",
        name: "FCI TEST — DO NOT USE client",
        status: "active",
        industry: "Flooring",
        site_address: null,
        latitude: null,
        longitude: null,
        address_validation_verdict: null,
        updated_at: UPDATED_AT - 1_000,
        version: 1,
      },
    ]]);
    this.projects = new Map([[
      PROJECT_ID,
      {
        id: PROJECT_ID,
        project_number: "CF-2026-22222222",
        client_id: CLIENT_ID,
        name: "FCI TEST — DO NOT USE project",
        status: "planning",
        site: null,
        latitude: null,
        longitude: null,
        address_validation_verdict: null,
        project_manager: "manager@example.test",
        estimated_value: 125_000,
        flooring_category: "tile-stone",
        square_feet: 2_500,
        contract_value: 130_000,
        segment: "commercial",
        updated_at: UPDATED_AT - 1_000,
        version: 1,
      },
    ]]);
    this.activities = [];
    this.prepared = [];
    this.projectVersionReadBarrier = null;
  }

  armConcurrentProjectVersionReads() {
    const waiting = [];
    this.projectVersionReadBarrier = (version) => new Promise((resolve) => {
      waiting.push(() => resolve(version === null ? null : { version }));
      if (waiting.length === 2) {
        this.projectVersionReadBarrier = null;
        for (const release of waiting) release();
      }
    });
  }

  prepare(sql) {
    const statement = new StatefulStatement(this, sql);
    this.prepared.push(statement);
    return statement;
  }

  first(statement) {
    if (statement.sql === "SELECT version FROM clients WHERE id = ?") {
      const row = this.clients.get(statement.values[0]);
      return row ? { version: row.version } : null;
    }
    if (statement.sql.includes("FROM clients WHERE id = ?")) {
      return this.clients.get(statement.values[0]) ?? null;
    }
    if (statement.sql === "SELECT version FROM projects WHERE id = ?") {
      const row = this.projects.get(statement.values[0]);
      if (this.projectVersionReadBarrier) {
        return this.projectVersionReadBarrier(row?.version ?? null);
      }
      return row ? { version: row.version } : null;
    }
    if (statement.sql.startsWith("SELECT id FROM clients WHERE id = ?")) {
      return this.clients.has(statement.values[0]) ? { id: statement.values[0] } : null;
    }
    if (statement.sql.includes("FROM projects") && statement.sql.endsWith("WHERE id = ?")) {
      return this.projects.get(statement.values[0]) ?? null;
    }
    throw new Error(`Unexpected D1 first query: ${statement.sql}`);
  }

  async batch(statements) {
    const results = [];
    let previousChanges = 0;
    for (const statement of statements) {
      if (statement.sql.startsWith("UPDATE clients SET ")) {
        const [
          name,
          normalizedNameKey,
          status,
          industry,
          siteAddress,
          latitude,
          longitude,
          addressValidationVerdict,
          updatedAt,
          clientId,
          expectedVersion,
        ] = statement.values;
        const current = this.clients.get(clientId);
        const versionGuarded = statement.sql.includes("WHERE id = ? AND version = ?");
        if (!current || versionGuarded && String(current.version) !== String(expectedVersion)) {
          previousChanges = 0;
          results.push({ meta: { changes: 0 } });
          continue;
        }
        this.clients.set(clientId, {
          ...current,
          name,
          normalized_name_key: normalizedNameKey,
          status,
          industry,
          site_address: siteAddress,
          latitude,
          longitude,
          address_validation_verdict: addressValidationVerdict,
          updated_at: updatedAt,
          version: current.version + 1,
        });
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      if (statement.sql.startsWith("UPDATE projects SET ")) {
        const [
          clientId,
          name,
          status,
          site,
          latitude,
          longitude,
          addressValidationVerdict,
          estimatedValue,
          flooringCategory,
          squareFeet,
          contractValue,
          segment,
          updatedAt,
          projectId,
          expectedVersion,
        ] = statement.values;
        const current = this.projects.get(projectId);
        const versionGuarded = statement.sql.includes("WHERE id = ? AND version = ?");
        if (!current || versionGuarded && String(current.version) !== String(expectedVersion)) {
          previousChanges = 0;
          results.push({ meta: { changes: 0 } });
          continue;
        }
        this.projects.set(projectId, {
          ...current,
          client_id: clientId,
          name,
          status,
          site,
          latitude,
          longitude,
          address_validation_verdict: addressValidationVerdict,
          estimated_value: estimatedValue,
          flooring_category: flooringCategory,
          square_feet: squareFeet,
          contract_value: contractValue,
          segment,
          updated_at: updatedAt,
          version: current.version + 1,
        });
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      if (statement.sql.startsWith("INSERT INTO activity_events ")) {
        const [id, recordId, action, actor, detail, createdAt, targetId, version, updatedAt] =
          statement.values;
        const target = this.clients.get(targetId) ?? this.projects.get(targetId);
        if (
          previousChanges !== 1
          || !statement.sql.includes("WHERE changes() = 1 AND EXISTS")
          || !target
          || String(target.version) !== String(version)
          || target.updated_at !== updatedAt
        ) {
          previousChanges = 0;
          results.push({ meta: { changes: 0 } });
          continue;
        }
        this.activities.push({ id, recordId, action, actor, detail, createdAt });
        previousChanges = 1;
        results.push({ meta: { changes: 1 } });
        continue;
      }
      throw new Error(`Unexpected D1 batch statement: ${statement.sql}`);
    }
    return results;
  }
}

test("D1 client and project CAS admit one editor and leave zero stale-write audit rows", async () => {
  const database = new CoreRecordD1Database();
  const clientRepository = createD1ClientRepository(database);
  const projectRepository = createD1ProjectRepository(database);

  const clientIntent = {
    clientId: CLIENT_ID,
    expectedVersion: "1",
    values: {
      name: "FCI TEST — DO NOT USE client updated",
      status: "active",
      industry: "Flooring",
      siteAddress: null,
      latitude: null,
      longitude: null,
      addressValidationVerdict: null,
    },
    updatedAt: UPDATED_AT,
    updatedBy: "actor@example.test",
    activity: {
      id: CLIENT_ACTIVITY_ID,
      recordId: CLIENT_ID,
      action: "Client fields updated",
      actor: "actor@example.test",
      detail: "Name: FCI TEST — DO NOT USE client → FCI TEST — DO NOT USE client updated",
      createdAt: UPDATED_AT,
    },
  };
  const clientFirst = await clientRepository.update(clientIntent);
  assert.equal(clientFirst.outcome, "updated");
  assert.equal(clientFirst.value.version, "2");
  assert.deepEqual(await clientRepository.update({
    ...clientIntent,
    values: { ...clientIntent.values, name: "Stale editor must lose" },
  }), { outcome: "conflict", currentVersion: "2" });

  const projectIntent = {
    projectId: PROJECT_ID,
    expectedVersion: "1",
    values: {
      clientId: CLIENT_ID,
      name: "FCI TEST — DO NOT USE project updated",
      status: "planning",
      site: "Cherry Hill, NJ",
      latitude: null,
      longitude: null,
      addressValidationVerdict: "unvalidated",
      estimatedValue: 125_000,
      flooringCategory: "tile-stone",
      squareFeet: 2_500,
      contractValue: 130_000,
      segment: "commercial",
    },
    updatedAt: UPDATED_AT,
    updatedBy: "actor@example.test",
    activity: {
      id: PROJECT_ACTIVITY_ID,
      recordId: PROJECT_ID,
      action: "Project fields updated",
      actor: "actor@example.test",
      detail: "Name: FCI TEST — DO NOT USE project → FCI TEST — DO NOT USE project updated",
      createdAt: UPDATED_AT,
    },
  };
  database.armConcurrentProjectVersionReads();
  const projectResults = await Promise.all([
    projectRepository.update(projectIntent),
    projectRepository.update({
      ...projectIntent,
      values: { ...projectIntent.values, name: "Concurrent project editor" },
    }),
  ]);
  assert.equal(projectResults.filter(({ outcome }) => outcome === "updated").length, 1);
  assert.deepEqual(
    projectResults.filter(({ outcome }) => outcome === "conflict"),
    [{ outcome: "conflict", currentVersion: "2" }],
  );
  assert.equal(database.projects.get(PROJECT_ID).version, 2);

  assert.equal(database.activities.length, 2);
  assert.deepEqual(database.activities[0], clientIntent.activity);
  assert.equal(database.activities[1].action, "Project fields updated");
  assert.match(database.activities[1].detail, / → /u);
  const updateStatements = database.prepared.filter(({ sql }) =>
    sql.startsWith("UPDATE clients SET ") || sql.startsWith("UPDATE projects SET "));
  assert.equal(updateStatements.length, 4);
  assert.equal(updateStatements.every(({ sql }) =>
    /WHERE id = \? AND version = \?/u.test(sql)), true);
  assert.equal(updateStatements.filter(({ sql }) => sql.startsWith("UPDATE clients SET ")).every(({ sql }) =>
    /AND NOT EXISTS \(SELECT 1 FROM clients AS duplicate[\s\S]*LOWER\(duplicate\.name\) = LOWER\(\?\)/u
      .test(sql)), true);
  assert.equal(updateStatements.filter(({ sql }) => sql.startsWith("UPDATE projects SET ")).every(({ sql }) =>
    /WHERE id = \? AND version = \?$/u.test(sql)), true);
  const guardedAuditStatements = database.prepared.filter(({ sql }) =>
    sql.startsWith("INSERT INTO activity_events ") && sql.includes("changes() = 1"));
  assert.equal(guardedAuditStatements.length, 4);
  assert.equal(guardedAuditStatements.every(({ sql }) =>
    /WHERE changes\(\) = 1 AND EXISTS \(SELECT 1 FROM (?:clients|projects) WHERE id = \? AND version = \?/u
      .test(sql)), true);
});
