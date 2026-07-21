import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Workspace setup is a five-step endpoint-driven flow with callback refresh", async () => {
  const panel = await read("app/settings/components/GoogleWorkspacePanel.tsx");

  for (const [step, heading] of [
    ["1", "Connect Google Workspace"],
    ["2", "Verify the Shared Drive"],
    ["3", "Prepare Gmail"],
    ["4", "Verify Calendar"],
    ["5", "Sync the Sheets mirror"],
  ]) {
    assert.match(panel, new RegExp(`<span className="workspace-step-number">${step}<\\/span><div><h3>${heading}`));
  }

  for (const endpoint of [
    "/api/v1/google-workspace",
    "/api/v1/integrations/google/drive/verify",
    "/api/v1/integrations/google/gmail/labels/prepare",
    "/api/v1/integrations/google/calendar/events",
    "/api/v1/integrations/google/sheets/status",
    "/api/v1/integrations/google/sheets/sync",
  ]) {
    assert.match(panel, new RegExp(endpoint.replaceAll("/", "\\/")));
  }

  assert.match(panel, /searchParams\.get\("google"\)/);
  assert.match(panel, /invalidateCachedGet\("\/api\/v1\/google-workspace"\)[\s\S]+checkSetup\(true\)/);
  assert.doesNotMatch(panel, /Run the readiness check to refresh this panel/);
  assert.match(panel, /GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED[\s\S]+hosted environment value, not an in-app toggle/);
});

test("Workspace prerequisites use a semantic metadata-only table", async () => {
  const [panel, readinessRoute, oauth] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/api/v1/google-workspace/route.ts"),
    read("app/lib/google-oauth.ts"),
  ]);

  assert.match(panel, /OperationsDataTable[\s\S]+WORKSPACE_PREREQUISITE_COLUMNS/);
  assert.match(panel, /Configured in the hosting environment, not this app/);
  assert.match(panel, /Hosted environment value/);
  assert.match(panel, /Hosted secret — never in the app or Git/);
  assert.match(readinessRoute, /missingDetails/);
  assert.match(readinessRoute, /FCI_ADMIN_EMAILS/);
  assert.match(oauth, /export type GoogleMissingConfiguration/);
  assert.match(oauth, /label: "Google Workspace intake mailbox matching the single approved connection account"/);
  assert.match(oauth, /envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS"/);
});

test("administrator connection health maps the bounded payload without inventing provider health", async () => {
  const [panel, route, oauth] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/api/v1/integrations/google/connection/route.ts"),
    read("app/lib/google-oauth.ts"),
  ]);

  assert.match(panel, /if \(!isAdmin\) return;[\s\S]+cachedGetJson<ConnectionHealthPayload>\("\/api\/v1\/integrations\/google\/connection"/);
  assert.match(panel, /isAdmin && <section className="workspace-connection-health"/);
  assert.match(panel, /maskWorkspaceAccountForDisplay\(connectionHealth\.connection\.account\)/);
  assert.match(panel, /connectionHealth\.runtimeMode/);
  assert.match(panel, /connectionHealth\.connection\.status/);
  assert.match(panel, /connectionHealth\.connection\.requiresReauthorization/);
  assert.match(panel, /connectionHealth\.enabledServices\.includes\(service\.key\)/);
  assert.match(panel, /connectionHealth\.connection\.grantedServices\?\.\[service\.key\]/);
  for (const service of ["drive", "gmail", "calendar", "sheets"]) {
    assert.match(panel, new RegExp(`key: "${service}"`));
  }
  assert.match(panel, /Not applicable — simulated/);
  assert.match(panel, /Recorded permission reflects the saved Google consent only\. It is not a live provider-health or freshness check\./);
  assert.equal(panel.match(/Disconnect Workspace/g)?.length, 1);
  assert.match(route, /runtimeMode: config\.environment[\s\S]+connection: await getGoogleConnectionStatus\(config\)[\s\S]+enabledServices: config\.enabledServices/);
  assert.match(oauth, /grantedServices: null/);
  assert.match(oauth, /const grantedServices = grantedGoogleServices\(config, scopes\)/);
  const payloadType = panel.slice(panel.indexOf("type ConnectionHealthPayload"), panel.indexOf("type ConnectionHealthState"));
  assert.doesNotMatch(payloadType, /lastSuccess|lastChecked|expiresAt|freshness/i);
});

test("Workspace resources are an admin-only sibling card with endpoint-owned states", async () => {
  const panel = await read("app/settings/components/GoogleWorkspacePanel.tsx");

  assert.match(panel, /if \(!isAdmin\) return;[\s\S]+cachedGetJson<WorkspaceSetupResourcesPayload>\("\/api\/v1\/integrations\/google\/setup\/resources"/);
  assert.match(panel, /isAdmin \? loadWorkspaceResources\(force\) : Promise\.resolve\(\)/);
  assert.match(panel, /No administrator setup request is made for this Office view\./);
  assert.match(panel, /const configured = simulation \|\| workspaceResources\?\.connectReady === true/);
  assert.match(panel, /disabled=\{!configured \|\| working\}/);

  const stepListStart = panel.indexOf('<ol className="workspace-setup-steps"');
  const stepListEnd = panel.indexOf("</ol>", stepListStart);
  const resourcesCard = panel.indexOf('<section className="workspace-setup-card workspace-resources-card"');
  const healthCard = panel.indexOf('{isAdmin && <section className="workspace-connection-health"');
  assert.ok(stepListStart >= 0 && stepListEnd > stepListStart);
  assert.ok(resourcesCard > stepListEnd, "Resources must be a sibling after the five-step list");
  assert.ok(healthCard > stepListEnd, "Connection health must be a sibling, not nested in Step 1");

  for (const state of ["Found", "Created", "Adopted", "Not configured", "Simulated"]) {
    assert.match(panel, new RegExp(`"${state}"`));
  }
  assert.match(panel, /workspaceResourceSourceLabel[\s\S]+App-managed[\s\S]+Environment value/);
  assert.match(panel, /workspace-resource-state/);
  assert.match(panel, /workspace-resource-source/);

  const resourceTableStart = panel.indexOf('<OperationsDataTable className="workspace-resource-table"');
  const resourceTableEnd = panel.indexOf("</OperationsDataTable>", resourceTableStart);
  assert.ok(resourceTableStart >= 0 && resourceTableEnd > resourceTableStart);
  assert.doesNotMatch(panel.slice(resourceTableStart, resourceTableEnd), /<button|AdministratorActionButton/);
});

test("Workspace setup masks accounts and exposes copy-exact safe helpers", async () => {
  const panel = await read("app/settings/components/GoogleWorkspacePanel.tsx");

  assert.match(panel, /function maskWorkspaceAccountForDisplay/);
  assert.match(panel, /connected \? `\$\{maskedWorkspaceAccount\} is connected with \$\{selectedServices\}\.`/);
  assert.match(panel, /maskWorkspaceAccountForDisplay\(workspaceResources\.identity\.connectionAccount\)/);
  assert.match(panel, /maskWorkspaceAccountForDisplay\(connectionHealth\.connection\.account\)/);
  assert.doesNotMatch(panel, /workspace\?\.connectionAccount \?\?/);
  assert.doesNotMatch(panel, /<dd>\{connectionHealth\.connection\.account/);

  assert.match(panel, /Connected account ↔ intake mailbox/);
  assert.match(panel, /workspaceResources\.identity\.allowedDomains/);
  assert.match(panel, /workspaceResources\.identity\.mode/);
  assert.match(panel, /https:\/\/groundwork-flooring-ops\.jaggerisagoodboy\.chatgpt\.site\/api\/v1\/integrations\/google\/callback/);
  assert.match(panel, /openssl rand -base64 32/);
  assert.match(panel, /Missing hosted keys/);
  assert.match(panel, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(panel, /GOOGLE_WORKSPACE_CLIENT_SECRET: "<secret>"/);
  assert.match(panel, /GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: "<secret 32-byte base64 value>"/);
  assert.match(panel, /GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "<OAuth redirect URI shown above>"/);
  assert.match(panel, /GOOGLE_INTEGRATION_MODE: "<workspace or simulation>"/);
  assert.match(panel, /detail\.envVar\.match\(\/\[A-Z\]\[A-Z0-9_\]\+\/g\)/);
  assert.match(panel, /resource\.source === "none"[\s\S]+WORKSPACE_RESOURCE_ENV_BY_KEY\[resource\.key\]/);
  assert.match(panel, /"client-directory": "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID"/);
  assert.match(panel, /if \(!simulation\) \{[\s\S]+resource\.source === "none"/);
  assert.match(panel, /const copyHelperStateReady = workspaceReadinessState === "ready" && workspaceResourcesState === "ready" && workspaceResources !== null/);
  assert.match(panel, /copyHelperStateReady && missingDotenvTemplate/);
  assert.match(panel, /copyHelperStateUnavailable[\s\S]+Missing-key status is unavailable/);
  assert.doesNotMatch(panel, /detail\.(value|secretValue|configuredValue)/);

  const connectionActions = panel.indexOf('className="workspace-connection-card-actions"');
  const healthCard = panel.indexOf('{isAdmin && <section className="workspace-connection-health"');
  const blueprint = panel.indexOf('<div className="drive-blueprint"');
  assert.ok(connectionActions >= 0 && healthCard > connectionActions);
  assert.match(panel.slice(connectionActions, healthCard), /Disconnect Workspace/);
  assert.doesNotMatch(panel.slice(healthCard, blueprint), /Disconnect Workspace/);
  assert.equal(panel.match(/Disconnect Workspace/g)?.length, 1);
});

test("Office viewers make no resource request and receive an access-owned connection status", async () => {
  const panel = await read("app/settings/components/GoogleWorkspacePanel.tsx");

  assert.match(panel, /if \(!isAdmin\) return;[\s\S]+\/api\/v1\/integrations\/google\/setup\/resources/);
  assert.match(panel, /isAdmin \? loadWorkspaceResources\(force\) : Promise\.resolve\(\)/);
  assert.match(panel, /!isAdmin \? "Administrator access" : configured/);
  assert.match(panel, /!isAdmin \? "Administrator setup only" : configured/);
  assert.match(panel, /An Administrator can review connection prerequisites and authorize the approved company account\./);
});
