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
