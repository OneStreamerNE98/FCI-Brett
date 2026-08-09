import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_RECORD_LIST_PREFERENCES,
  normalizeRecordListPreferences,
  normalizeRecordListPreferencesForWrite,
  parseStoredRecordListPreferences,
} from "../app/lib/record-list-preferences.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("DES-15 defaults Leads to board and normalizes stored per-user list preferences", () => {
  assert.equal(DEFAULT_RECORD_LIST_PREFERENCES.leads.view, "board");
  assert.deepEqual(parseStoredRecordListPreferences(JSON.stringify({
    overview: {},
    reports: {},
    recordLists: {
      leads: { view: "list", sortKey: "value", sortDirection: "descending" },
      clients: { sortKey: "projects", sortDirection: "descending" },
      projects: { sortKey: "schedule", sortDirection: "ascending" },
    },
  })), {
    leads: { view: "list", sortKey: "value", sortDirection: "descending" },
    clients: { sortKey: "projects", sortDirection: "descending" },
    projects: { sortKey: "schedule", sortDirection: "ascending" },
  });
  assert.equal(normalizeRecordListPreferences({ leads: { view: "unknown" } }).leads.view, "board");
});

test("DES-15 rejects incomplete or unknown preference writes", () => {
  assert.equal(normalizeRecordListPreferencesForWrite({}), null);
  assert.equal(normalizeRecordListPreferencesForWrite({
    leads: { view: "list", sortKey: "unknown", sortDirection: "ascending" },
    clients: { sortKey: "client", sortDirection: "ascending" },
    projects: { sortKey: "project", sortDirection: "ascending" },
  }), null);
  assert.ok(normalizeRecordListPreferencesForWrite(DEFAULT_RECORD_LIST_PREFERENCES));
});

test("DES-15 extracted views implement search, sorting, progressive reveal, and shared lead rows", () => {
  const shared = read("app/components/operations/OperationsActionableList.tsx");
  const leads = read("app/leads/components/LeadsView.tsx");
  const clients = read("app/clients/components/ClientsView.tsx");
  const projects = read("app/projects/components/ProjectsView.tsx");
  const shell = read("app/FloorOpsApp.tsx");
  assert.match(shared, /sortable \? <div role="table" aria-label=\{`\$\{ariaLabel\} sorting controls`\}>\{header\}<\/div> : header/u);
  assert.match(shared, /aria-sort=\{active \? sortDirection : "none"\}/u);
  assert.match(shared, /className="operations-sort-header"/u);
  assert.match(leads, /preference\.view === "list" \? <LeadStatusPanel/u);
  assert.match(leads, /function LeadStatusRow/u);
  assert.match(leads, /useDeferredValue\(leadSearch\)/u);
  assert.match(clients, /visibleClients\.slice\(0, rowCap\)/u);
  assert.match(projects, /filteredProjects\.slice\(0, rowCap\)/u);
  assert.match(projects, /useDeferredValue\(projectSearch\)/u);
  assert.match(shell, /function openProject\([\s\S]*?revealMobileTopbar\(\);[\s\S]*?setSelectedProject\(project\)/u);
});

test("DES-15 persists through the existing account preference and page-layout JSON boundary", () => {
  const route = read("app/api/v1/settings/me/route.ts");
  const domain = read("app/domain/user-preferences.ts");
  assert.match(domain, /"recordListPreferences"/u);
  assert.match(route, /recordLists: persistedRecordListPreferences/u);
  assert.match(route, /normalizeRecordListPreferencesForWrite/u);
});

test("DES-15 records the owner-approved design exception and 821px idiom split", () => {
  const spec = read("docs/specs/dashboard-design-spec.md");
  const styles = read("app/globals.css");
  assert.match(spec, /Record-page list views \(owner-approved amendment, August 3, 2026\)/u);
  assert.match(spec, /deliberate, owner-approved exception/u);
  assert.match(styles, /@media \(min-width:821px\)/u);
  assert.match(styles, /@media \(max-width:820px\)/u);
  assert.match(styles, /\.operations-sort-header\{width:100%;min-height:44px/u);
});
