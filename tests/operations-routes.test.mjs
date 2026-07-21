import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalOperationsSearch,
  inboxBucketFromSearch,
  leadStageFromSearch,
  operationsHref,
  operationsPath,
  operationsReturnPath,
  operationsViewForPath,
  projectLifecycleFromSearch,
  projectStatusFromSearch,
  settingsSectionFromSearch,
} from "../app/lib/operations-routes.ts";

test("primary operations views have fixed round-trippable paths", () => {
  const routes = [
    ["Overview", "/"],
    ["Leads", "/leads"],
    ["Clients", "/clients"],
    ["Projects", "/projects"],
    ["Schedule", "/schedule"],
    ["Inbox", "/inbox"],
    ["AI Assistant", "/assistant"],
    ["Reports", "/reports"],
    ["Settings", "/settings"],
  ];

  for (const [view, path] of routes) {
    assert.equal(operationsPath(view), path);
    assert.equal(operationsViewForPath(path), view);
    if (path !== "/") assert.equal(operationsViewForPath(`${path}/`), view);
  }
  assert.equal(operationsViewForPath("/not-an-fci-route"), null);
});

test("only bounded non-default page state is included in durable URLs", () => {
  assert.equal(operationsHref("Overview"), "/");
  assert.equal(operationsHref("Leads", { leadStage: "site-visit" }), "/leads?stage=site-visit");
  assert.equal(operationsHref("Projects", { projectStatus: "Active" }), "/projects");
  assert.equal(operationsHref("Projects", { projectStatus: "Archived" }), "/projects?status=archived");
  assert.equal(operationsHref("Projects", { projectLifecycle: "mobilizing" }), "/projects?status=mobilizing");
  assert.equal(operationsHref("Settings", { settingsSection: "My account" }), "/settings");
  assert.equal(operationsHref("Settings", { settingsSection: "Google Workspace" }), "/settings?section=google-workspace");
  assert.equal(operationsHref("Inbox", { inboxBucket: "inbox" }), "/inbox");
  assert.equal(operationsHref("Inbox", { inboxBucket: "needs-review" }), "/inbox?bucket=needs-review");
});

test("keeps every SET-07 Settings slug pinned while My settings remains the canonical default", () => {
  const settingsRoutes = [
    ["My account", "/settings"],
    ["Google Workspace", "/settings?section=google-workspace"],
    ["Calendar & appointments", "/settings?section=calendar"],
    ["Inbox & file rules", "/settings?section=inbox-rules"],
    ["Client Directory", "/settings?section=client-directory"],
    ["Workflow & notifications", "/settings?section=workflow-notifications"],
    ["Data & security", "/settings?section=data-security"],
    ["Testing & launch", "/settings?section=testing-launch"],
  ];

  for (const [settingsSection, href] of settingsRoutes) {
    assert.equal(operationsHref("Settings", { settingsSection }), href);
  }
  assert.equal(settingsSectionFromSearch("section=account"), "My account");
});

test("route-state readers fail safely on invalid or duplicate values", () => {
  assert.equal(settingsSectionFromSearch("section=calendar"), "Calendar & appointments");
  assert.equal(settingsSectionFromSearch("section=unknown"), "My account");
  assert.equal(settingsSectionFromSearch("section=calendar&section=data-security"), "My account");
  assert.equal(leadStageFromSearch("stage=new-inquiry"), "new-inquiry");
  assert.equal(leadStageFromSearch("stage=other"), "other");
  assert.equal(leadStageFromSearch("stage=custom-stage"), null);
  assert.equal(leadStageFromSearch("stage=proposal&stage=decision"), null);
  assert.equal(projectStatusFromSearch("status=completed"), "Completed");
  assert.equal(projectStatusFromSearch("status=active"), "Active");
  assert.equal(projectStatusFromSearch("status=planning"), "Active");
  assert.equal(projectStatusFromSearch("status=archived&status=completed"), "Active");
  assert.equal(projectLifecycleFromSearch("status=planning"), "planning");
  assert.equal(projectLifecycleFromSearch("status=completed"), "completed");
  assert.equal(projectLifecycleFromSearch("status=unknown"), null);
  assert.equal(projectLifecycleFromSearch("status=planning&status=mobilizing"), null);
  assert.equal(inboxBucketFromSearch("bucket=filed"), "filed");
  assert.equal(inboxBucketFromSearch("bucket=unknown"), "inbox");
});

test("canonical query cleanup preserves unrelated callback state without leaking route state", () => {
  assert.equal(
    canonicalOperationsSearch("Settings", "section=calendar&google=connected&keep=1"),
    "google=connected&keep=1&section=calendar",
  );
  assert.equal(canonicalOperationsSearch("Settings", "section=account&keep=1"), "keep=1");
  assert.equal(canonicalOperationsSearch("Settings", "section=calendar&section=data-security&keep=1"), "keep=1");
  assert.equal(canonicalOperationsSearch("Leads", "stage=proposal&keep=1"), "keep=1&stage=proposal");
  assert.equal(canonicalOperationsSearch("Leads", "stage=proposal&stage=decision&keep=1"), "keep=1");
  assert.equal(canonicalOperationsSearch("Projects", "status=active"), "");
  assert.equal(canonicalOperationsSearch("Projects", "status=closeout&keep=1"), "keep=1&status=closeout");
  assert.equal(canonicalOperationsSearch("Projects", "status=invalid&keep=1"), "keep=1");
  assert.equal(canonicalOperationsSearch("Leads", "status=archived&section=calendar&keep=1"), "keep=1");
  assert.equal(canonicalOperationsSearch("Reports", "stage=proposal&status=planning&keep=1"), "keep=1");
});

test("sign-in return paths retain only validated route state", () => {
  assert.equal(operationsReturnPath("Leads", { stage: "decision", q: "private search" }), "/leads?stage=decision");
  assert.equal(operationsReturnPath("Leads", { stage: ["proposal", "decision"] }), "/leads");
  assert.equal(operationsReturnPath("Projects", { status: "mobilizing", q: "private search" }), "/projects?status=mobilizing");
  assert.equal(operationsReturnPath("Projects", { status: "archived", q: "private search" }), "/projects?status=archived");
  assert.equal(operationsReturnPath("Projects", { status: ["archived", "completed"] }), "/projects");
  assert.equal(operationsReturnPath("Settings", { section: "calendar", google: "connected" }), "/settings?section=calendar");
  assert.equal(operationsReturnPath("Inbox", { bucket: "filed", q: "from:client@example.com" }), "/inbox?bucket=filed");
});
