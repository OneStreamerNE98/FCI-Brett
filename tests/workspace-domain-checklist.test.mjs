import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveWorkspaceDomainChecklist,
  missingWorkspaceDotenvTemplate,
  visibleWorkspacePrerequisites,
  WORKSPACE_OAUTH_REDIRECT_URI,
  WORKSPACE_TOKEN_KEY_COMMAND,
  workspaceCopyHelperState,
  workspaceDomainChecklistSummary,
} from "../app/settings/components/workspace-domain-checklist/workspace-domain-checklist.ts";

const detail = (envVar, secret = false) => ({ label: `Missing ${envVar}`, envVar, secret });

function evidence(overrides = {}) {
  return {
    isAdmin: true,
    simulation: false,
    readinessKnown: true,
    missingDetails: [],
    resourcesKnown: true,
    connectReady: false,
    allowedDomainCount: 1,
    intakeMailboxMatches: null,
    hasConnectionAccount: false,
    connectionKnown: true,
    connectionStatus: "not-connected",
    requiresReauthorization: false,
    ...overrides,
  };
}

function statuses(input) {
  return Object.fromEntries(deriveWorkspaceDomainChecklist(input).map((result) => [result.key, result.status]));
}

test("unconfigured tenant evidence reports only bounded setup and manual-check claims", () => {
  const missingDetails = [
    detail("GOOGLE_WORKSPACE_ALLOWED_DOMAINS"),
    detail("GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS"),
    detail("GOOGLE_WORKSPACE_INTAKE_MAILBOX"),
    detail("GOOGLE_WORKSPACE_CLIENT_ID"),
    detail("GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI"),
    detail("GOOGLE_WORKSPACE_CLIENT_SECRET", true),
    detail("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY", true),
  ];
  const result = deriveWorkspaceDomainChecklist(evidence({
    missingDetails,
    allowedDomainCount: 0,
  }));

  assert.deepEqual(Object.fromEntries(result.map((row) => [row.key, row.status])), {
    domain: "Setup required",
    "operations-account": "Setup required",
    apis: "Manual check",
    oauth: "Setup required",
    secrets: "Setup required",
    groups: "Manual check",
  });
  assert.equal(workspaceDomainChecklistSummary(result), "Setup required");
  assert.ok(Object.isFrozen(result));
});

test("partial evidence distinguishes configuration presence from incomplete OAuth and secrets", () => {
  assert.deepEqual(statuses(evidence({
    missingDetails: [
      detail("GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI"),
      detail("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY", true),
    ],
  })), {
    domain: "Configuration present",
    "operations-account": "Configuration present",
    apis: "Manual check",
    oauth: "Partially configured",
    secrets: "Partially configured",
    groups: "Manual check",
  });
});

test("connectReady ignores resource-ID gaps without claiming manual Google work is verified", () => {
  const result = deriveWorkspaceDomainChecklist(evidence({
    connectReady: true,
    missingDetails: [
      detail("GOOGLE_WORKSPACE_SHARED_DRIVE_ID"),
      detail("GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID"),
      detail("GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID"),
      detail("GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID"),
    ],
  }));

  assert.deepEqual(Object.fromEntries(result.map((row) => [row.key, row.status])), {
    domain: "Configuration present",
    "operations-account": "Ready to connect",
    apis: "Manual check",
    oauth: "Ready to connect",
    secrets: "Secrets present",
    groups: "Manual check",
  });
  assert.equal(workspaceDomainChecklistSummary(result), "Ready to connect");
  assert.ok(result.every((row) => !/verified/i.test(row.status)));
});

test("connected evidence claims only the saved connection and exact account match", () => {
  const result = deriveWorkspaceDomainChecklist(evidence({
    connectReady: true,
    intakeMailboxMatches: true,
    hasConnectionAccount: true,
    connectionStatus: "connected",
  }));

  assert.equal(statuses(evidence({
    connectReady: true,
    intakeMailboxMatches: true,
    hasConnectionAccount: true,
    connectionStatus: "connected",
  }))["operations-account"], "Account matched");
  assert.equal(Object.fromEntries(result.map((row) => [row.key, row.status])).oauth, "Connected");
  assert.equal(Object.fromEntries(result.map((row) => [row.key, row.status])).apis, "Manual check");
  assert.equal(Object.fromEntries(result.map((row) => [row.key, row.status])).groups, "Manual check");
  assert.equal(workspaceDomainChecklistSummary(result), "Connected");
});

test("compound account mismatch and reauthorization evidence fail closed", () => {
  const mismatch = statuses(evidence({
    connectReady: true,
    missingDetails: [{
      label: "Google Workspace intake mailbox matching the single approved connection account",
      envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS",
      secret: false,
    }],
  }));
  assert.equal(mismatch["operations-account"], "Account mismatch");

  const reconnect = statuses(evidence({
    connectReady: true,
    intakeMailboxMatches: true,
    hasConnectionAccount: true,
    connectionStatus: "reauthorization-required",
    requiresReauthorization: true,
  }));
  assert.equal(reconnect["operations-account"], "Reconnect required");
  assert.equal(reconnect.oauth, "Reconnect required");
});

test("Office and simulation variants ignore live administrator evidence", () => {
  const connected = evidence({
    connectReady: true,
    intakeMailboxMatches: true,
    hasConnectionAccount: true,
    connectionStatus: "connected",
  });
  assert.ok(Object.values(statuses({ ...connected, isAdmin: false })).every((status) => status === "Administrator setup"));
  assert.ok(Object.values(statuses({ ...connected, simulation: true })).every((status) => status === "Simulated"));
});

test("unknown payload state never turns an empty array into a configured claim", () => {
  const result = statuses(evidence({ readinessKnown: false, resourcesKnown: false, connectionKnown: false }));
  assert.equal(result.domain, "Unavailable");
  assert.equal(result["operations-account"], "Unavailable");
  assert.equal(result.oauth, "Unavailable");
  assert.equal(result.secrets, "Unavailable");
  assert.equal(result.apis, "Manual check");
  assert.equal(result.groups, "Manual check");
});

test("known negative connection evidence remains visible when readiness is unavailable", () => {
  const mismatch = statuses(evidence({
    readinessKnown: false,
    resourcesKnown: true,
    intakeMailboxMatches: false,
  }));
  assert.equal(mismatch["operations-account"], "Account mismatch");

  const reconnect = statuses(evidence({
    readinessKnown: false,
    connectionKnown: true,
    connectionStatus: "reauthorization-required",
    requiresReauthorization: true,
  }));
  assert.equal(reconnect["operations-account"], "Reconnect required");
  assert.equal(reconnect.oauth, "Reconnect required");
});

test("SET-13 copy-exact helpers retain safe placeholders and filter app-managed resource fallbacks", () => {
  const details = [
    detail("GOOGLE_WORKSPACE_CLIENT_SECRET", true),
    detail("GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS"),
    detail("GOOGLE_WORKSPACE_SHARED_DRIVE_ID"),
  ];
  const resources = [
    { key: "primary", source: "app" },
    { key: "client-directory", source: "none" },
  ];

  assert.equal(WORKSPACE_OAUTH_REDIRECT_URI, "https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback");
  assert.equal(WORKSPACE_TOKEN_KEY_COMMAND, "openssl rand -base64 32");
  assert.equal(missingWorkspaceDotenvTemplate(details, resources, false), [
    "GOOGLE_WORKSPACE_CLIENT_SECRET=<secret>",
    "GOOGLE_WORKSPACE_INTAKE_MAILBOX=<operations-account@company.example>",
    "GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS=<operations-account@company.example>",
    "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID=<spreadsheet ID>",
  ].join("\n"));
  assert.deepEqual(visibleWorkspacePrerequisites(details, resources), details.slice(0, 2));
  assert.equal(missingWorkspaceDotenvTemplate([], resources, true), "");
});

test("copy-helper availability requires both successful payloads", () => {
  assert.equal(workspaceCopyHelperState("ready", "ready", true), "ready");
  assert.equal(workspaceCopyHelperState("loading", "ready", true), "loading");
  assert.equal(workspaceCopyHelperState("ready", "ready", false), "unavailable");
  assert.equal(workspaceCopyHelperState("error", "ready", true), "unavailable");
  assert.equal(workspaceCopyHelperState("ready", "error", true), "unavailable");
});

test("the extracted card is route-free, admin-aware, and contains no decorative controls", async () => {
  const component = await readFile(new URL("../app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx", import.meta.url), "utf8");
  const helper = await readFile(new URL("../app/settings/components/workspace-domain-checklist/workspace-domain-checklist.ts", import.meta.url), "utf8");

  assert.equal((component.match(/title: "/g) ?? []).length, 6);
  assert.equal((component.match(/Hosted Workspace configuration/g) ?? []).length, 1);
  assert.match(component, /!isAdmin && <p className="workspace-admin-readonly"/);
  assert.match(component, /isAdmin && item\.href/);
  assert.match(component, /isAdmin && <div className="workspace-copy-helpers"/);
  assert.doesNotMatch(component, /\bfetch\s*\(|cachedGetJson|process\.env|import\.meta\.env|<input\b|type="checkbox"/);
  assert.doesNotMatch(component, /\.md(?:["'#?])|repo-doc|secretValue|configuredValue|detail\.value|externalId/);
  assert.doesNotMatch(helper, /process\.env|import\.meta\.env|secretValue|configuredValue|detail\.value|externalId/);

  const hrefs = [...component.matchAll(/href: "([^"]+)"/g)].map((match) => new URL(match[1]));
  assert.equal(hrefs.length, 5);
  assert.ok(hrefs.every((url) => ["admin.google.com", "console.cloud.google.com"].includes(url.hostname)));
  assert.equal((component.match(/target="_blank" rel="noreferrer"/g) ?? []).length, 1, "one mapped anchor renders every approved external URL with safe attributes");
});
