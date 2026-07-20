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
  assert.match(panel, /connectionHealth\.connection\.account/);
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
