import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalOperationsSearch,
  inboxBucketFromSearch,
  operationsHref,
  operationsPath,
  operationsReturnPath,
  operationsViewForPath,
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
  assert.equal(operationsHref("Projects", { projectStatus: "Active" }), "/projects");
  assert.equal(operationsHref("Projects", { projectStatus: "Archived" }), "/projects?status=archived");
  assert.equal(operationsHref("Settings", { settingsSection: "My account" }), "/settings");
  assert.equal(operationsHref("Settings", { settingsSection: "Google Workspace" }), "/settings?section=google-workspace");
  assert.equal(operationsHref("Inbox", { inboxBucket: "inbox" }), "/inbox");
  assert.equal(operationsHref("Inbox", { inboxBucket: "needs-review" }), "/inbox?bucket=needs-review");
});

test("route-state readers fail safely on invalid or duplicate values", () => {
  assert.equal(settingsSectionFromSearch("section=calendar"), "Calendar & appointments");
  assert.equal(settingsSectionFromSearch("section=unknown"), "My account");
  assert.equal(settingsSectionFromSearch("section=calendar&section=data-security"), "My account");
  assert.equal(projectStatusFromSearch("status=completed"), "Completed");
  assert.equal(projectStatusFromSearch("status=active"), "Active");
  assert.equal(projectStatusFromSearch("status=archived&status=completed"), "Active");
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
  assert.equal(canonicalOperationsSearch("Projects", "status=active"), "");
  assert.equal(canonicalOperationsSearch("Projects", "status=invalid&keep=1"), "keep=1");
  assert.equal(canonicalOperationsSearch("Leads", "status=archived&section=calendar&keep=1"), "keep=1");
});

test("sign-in return paths retain only validated route state", () => {
  assert.equal(operationsReturnPath("Projects", { status: "archived", q: "private search" }), "/projects?status=archived");
  assert.equal(operationsReturnPath("Projects", { status: ["archived", "completed"] }), "/projects");
  assert.equal(operationsReturnPath("Settings", { section: "calendar", google: "connected" }), "/settings?section=calendar");
  assert.equal(operationsReturnPath("Inbox", { bucket: "filed", q: "from:client@example.com" }), "/inbox?bucket=filed");
});
