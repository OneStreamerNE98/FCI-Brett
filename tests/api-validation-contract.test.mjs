import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("client creation validates JSON field types before normalization", async () => {
  const [route, domain] = await Promise.all([
    read("app/api/v1/clients/route.ts"),
    read("app/domain/client-creation.ts"),
  ]);

  assert.match(domain, /typeof record\[field\] !== "string"/);
  assert.match(domain, /typeof record\.primaryContact !== "object"/);
  assert.match(domain, /typeof primaryContact\[field\] !== "string"/);
  assert.match(route, /Client details must be valid JSON/);
  assert.match(domain, /Client details must be valid JSON/);
});

test("duplicate client protection is atomic and leaves no dependent records", async () => {
  const adapter = await read("app/adapters/d1/client-repository.ts");

  assert.match(adapter, /INSERT INTO clients[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM clients WHERE LOWER\(name\) = LOWER\(\?\)/);
  assert.match(adapter, /INSERT INTO activity_events[\s\S]*WHERE EXISTS \(SELECT 1 FROM clients WHERE id = \? AND client_code = \?/);
  assert.match(adapter, /INSERT INTO contacts[\s\S]*WHERE EXISTS \(SELECT 1 FROM clients WHERE id = \? AND client_code = \?/);
  assert.match(adapter, /results\[0\]\?\.meta\.changes === 1/);
  assert.match(adapter, /outcome: "duplicate"/);
});

test("project creation validates string and numeric JSON fields before use", async () => {
  const [route, domain] = await Promise.all([
    read("app/api/v1/projects/route.ts"),
    read("app/domain/project-creation.ts"),
  ]);

  assert.match(domain, /\["clientId", "name", "status", "site", "projectManager", "projectManagerId"\]/);
  assert.match(domain, /typeof record\[field\] !== "string"/);
  assert.match(domain, /record\[field\] !== null && typeof record\[field\] !== "number"/);
  assert.match(domain, /Number\.isSafeInteger\(estimatedValue\)/);
  assert.match(domain, /FLOORING_CATEGORIES/);
  assert.match(domain, /typeof record\.flooringCategory !== "string"/);
  assert.match(domain, /\["estimatedValue", "squareFeet", "contractValue"\]/);
  assert.match(domain, /Number\.isSafeInteger\(squareFeet\).*squareFeet <= 0/);
  assert.match(domain, /Number\.isSafeInteger\(contractValue\).*contractValue < 0/);
  assert.match(domain, /normalizeProjectManagerId/);
  assert.match(route, /officeIdentityForEmail/);
  assert.match(route, /project_manager: projectManagerId,[\s\S]*project_manager_id: projectManagerId/);
  assert.match(route, /p\.flooring_category, p\.square_feet, p\.contract_value/);
  assert.match(route, /contract_value: auth\.user\.isAdmin \? record\.contract_value : null/);
  assert.match(route, /NextResponse\.json\(\{ projects \}, \{ headers: \{ "Cache-Control": "no-store" \} \}\)/);
  assert.match(route, /!auth\.user\.isAdmin && parsed\.body\.contractValue/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /requireSameOrigin\(request\)/);
  assert.match(route, /requireOfficeUser\(request, \{ admin: true \}\)/);
  assert.match(route, /assignProjectManager/);
  assert.match(route, /Project details must be valid JSON/);
  assert.match(domain, /Project details must be valid JSON/);
});

test("project creation makes the project and activity one conditional D1 batch", async () => {
  const adapter = await read("app/adapters/d1/project-repository.ts");

  assert.match(adapter, /INSERT INTO projects[\s\S]*WHERE EXISTS \(SELECT 1 FROM clients WHERE id = \?\)/);
  assert.match(adapter, /flooring_category, square_feet, contract_value/);
  assert.match(adapter, /project\.flooringCategory, project\.squareFeet, project\.contractValue/);
  assert.match(adapter, /INSERT INTO activity_events[\s\S]*WHERE EXISTS \(SELECT 1 FROM projects WHERE id = \? AND project_number = \?/);
  assert.match(adapter, /results\[0\]\?\.meta\.changes === 1/);
  assert.match(adapter, /outcome: "client-not-found"/);
  assert.match(adapter, /UPDATE projects SET project_manager = \?, updated_at = \? WHERE id = \?/);
  assert.match(adapter, /Project manager assigned|activity\.action/);
  assert.match(adapter, /outcome: "project-not-found"/);
});

test("KPI-02 D1 migration is immutable additive-only and has no backfill or constraint", async () => {
  const [migration, journal] = await Promise.all([
    read("drizzle/0012_green_magneto.sql"),
    read("drizzle/meta/_journal.json"),
  ]);

  assert.equal(migration.match(/ALTER TABLE/g)?.length, 3);
  assert.match(migration, /ALTER TABLE `projects` ADD `flooring_category` text;/);
  assert.match(migration, /ALTER TABLE `projects` ADD `square_feet` integer;/);
  assert.match(migration, /ALTER TABLE `projects` ADD `contract_value` integer;/);
  assert.doesNotMatch(migration, /NOT NULL|UNIQUE|UPDATE|INSERT|DELETE/i);
  assert.match(journal, /"idx": 12[\s\S]*"tag": "0012_green_magneto"/);
});

test("KPI-02 e2e cleanup removes reserved project activity before reserved projects", async () => {
  const seed = await read("tests/e2e/fixtures/seed.sql");
  const activityDelete = seed.indexOf("DELETE FROM activity_events");
  const projectDelete = seed.indexOf("DELETE FROM projects");

  assert.ok(activityDelete >= 0 && activityDelete < projectDelete);
  assert.match(seed, /DELETE FROM activity_events[\s\S]*record_id IN \([\s\S]*FROM projects[\s\S]*client_id = 'e2e-client-001'[\s\S]*\);/);
  assert.match(seed, /DELETE FROM projects[\s\S]*client_id = 'e2e-client-001'/);
  assert.doesNotMatch(seed, /DELETE FROM (?:activity_events|projects)\s*;/);
});
