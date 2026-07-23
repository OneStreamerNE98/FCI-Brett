import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Workspace setup is a four-stage endpoint-driven shell with callback refresh", async () => {
  const [panel, panelStyles, infoHint] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.module.css"),
    read("app/settings/components/workspace-setup-shell/WorkspaceInfoHint.tsx"),
  ]);

  assert.equal(panel.match(/<SetupStage\b/g)?.length, 4);
  for (const [stage, heading] of [
    ["1", "Prepare the tenant"],
    ["2", "Connect"],
    ["3", "Define & create your workspace"],
    ["4", "Verify & maintain"],
  ]) {
    assert.match(panel, new RegExp(`number=\\{${stage}\\}[\\s\\S]{0,240}title="${heading.replace(/[&]/g, "\\&")}"`));
  }
  for (const heading of [
    "Company account authorization",
    "Verify the Shared Drive",
    "Prepare Gmail",
    "Verify Calendar",
    "Sync the Sheets mirror",
  ]) {
    assert.match(panel, new RegExp(`<h3(?: [^>]*)?>${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/h3>`));
  }

  assert.match(panel, /className="workspace-stage-list"[^>]*role="group"[^>]*aria-label="Google Workspace setup stages"/);
  assert.match(panel, /className=\{`workspace-setup-stage\$\{open/);
  assert.match(panel, /data-workspace-stage=\{number\}/);
  assert.match(panel, /className="workspace-stage-toggle"/);
  assert.match(panel, /aria-label=\{`\$\{open \? "Collapse" : "Expand"\} Stage \$\{number\}: \$\{title\}`\}/);
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /aria-controls=\{bodyId\}/);
  assert.match(panel, /className="workspace-stage-body" hidden=\{!open\}/);
  assert.match(infoHint, /export function WorkspaceInfoHint/);
  assert.match(infoHint, /aria-describedby=\{descriptionId\}/);
  assert.match(infoHint, /role="tooltip"/);
  assert.match(infoHint, /event\.key !== "Escape"/);
  assert.match(panel, /Checking current status…/);
  assert.match(panel, /statusSourcesLoading[\s\S]+CHECKING[\s\S]+statusSourcesUnavailable[\s\S]+UNAVAILABLE/);
  assert.match(panel, /statusSourcesLoading[\s\S]+Stage status pending[\s\S]+statusSourcesUnavailable[\s\S]+Current stage unavailable/);
  assert.match(panel, /statusSourcesLoading \|\| statusSourcesUnavailable[\s\S]+panelStyles\.statusModeNeutral/);
  assert.match(panelStyles, /\.statusModeNeutral[\s\S]+background: #f0eeeb[\s\S]+color: #6c655f/);
  assert.match(panel, /const neutralStageStatus = statusSourcesLoading[\s\S]+CHECKING[\s\S]+statusSourcesUnavailable[\s\S]+UNAVAILABLE/);
  assert.equal(panel.match(/tone=\{neutralStageStatus \? "neutral"/g)?.length, 4);
  assert.match(panel, /panelStyles\.stageChipNeutral/);
  assert.match(panelStyles, /\.stageChipNeutral[\s\S]+background: #f0eeeb[\s\S]+color: #6c655f/);
  assert.match(panel, /workspace-status-banner/);
  assert.match(panel, /workspace-status-mode/);
  assert.match(panel, /workspace-status-progress/);
  assert.doesNotMatch(panel, /workspace-mode-card|Company Google Workspace|Sample data only · no Google account connected · nothing is sent to Google|One administrator-approved organization connection/);

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
});

test("Workspace prerequisites use a semantic metadata-only Stage 1 sequence", async () => {
  const [panel, checklist, readinessRoute, oauth] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx"),
    read("app/api/v1/google-workspace/route.ts"),
    read("app/lib/google-oauth.ts"),
  ]);

  assert.match(checklist, /OperationsDataTable[\s\S]+WORKSPACE_PREREQUISITE_COLUMNS/);
  assert.match(checklist, /Configured in the hosting environment, not this app/);
  assert.match(checklist, /Hosted environment value/);
  assert.match(checklist, /Hosted secret — never in the app or Git/);
  const checklistRows = checklist.indexOf('<ol className={styles.list}>');
  const prerequisites = checklist.indexOf('className={styles.hostedPrerequisites}');
  const copyHelpers = checklist.indexOf('className="workspace-copy-helpers"');
  const environmentNotes = checklist.indexOf("{isAdmin && environmentNotes}");
  assert.ok(
    checklistRows >= 0
      && prerequisites > checklistRows
      && copyHelpers > prerequisites
      && environmentNotes > copyHelpers,
    "Stage 1 renders checklist rows, hosted prerequisites, copy helpers, then relocated environment notes",
  );
  assert.match(panel, /<WorkspaceDomainChecklistCard/);
  assert.doesNotMatch(panel, /WORKSPACE_PREREQUISITE_COLUMNS|workspace-prerequisite-table/);
  assert.match(readinessRoute, /missingDetails/);
  assert.match(readinessRoute, /FCI_ADMIN_EMAILS/);
  assert.match(oauth, /export type GoogleMissingConfiguration/);
  assert.match(oauth, /label: "Google Workspace intake mailbox matching the single approved connection account"/);
  assert.match(oauth, /envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS"/);
});

test("Workspace readiness surfaces only Google Chat missing-secret names without changing OAuth readiness", async () => {
  const route = await read("app/api/v1/google-workspace/route.ts");

  assert.match(route, /import \{ readGoogleChatPublicConfig \} from "\.\.\/\.\.\/\.\.\/lib\/google-chat-notifier-sites"/);
  assert.match(route, /const \[connection, chatNotifications\] = await Promise\.all\(/);
  assert.match(route, /\.\.\.chatNotifications\.missingDetails/);
  assert.match(route, /const credentialsPresent = google\.connectReady && adminAllowlistPresent/);
  assert.match(route, /const configured = google\.oauthReady && adminAllowlistPresent/);
  assert.doesNotMatch(route, /credentialsPresent\s*=.*chatNotifications/);
  assert.doesNotMatch(route, /chatNotifications\.(?:webhook|url|secretValue)/i);
});

test("administrator connection health is a bounded Stage 2 expander without duplicate mode or status", async () => {
  const [panel, route, oauth] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/api/v1/integrations/google/connection/route.ts"),
    read("app/lib/google-oauth.ts"),
  ]);

  assert.match(panel, /if \(!isAdmin\) return;[\s\S]+cachedGetJson<ConnectionHealthPayload>\("\/api\/v1\/integrations\/google\/connection"/);
  assert.match(panel, /isAdmin && <details className=\{`workspace-connection-health/);
  assert.match(panel, /<summary className=\{panelStyles\.connectionHealthToggle\}/);
  assert.match(panel, /Account and recorded service permissions/);
  assert.match(panel, /maskWorkspaceAccountForDisplay\(connectionHealth\.connection\.account\)/);
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
  const healthStart = panel.indexOf('{isAdmin && <details className={`workspace-connection-health');
  const healthEnd = panel.indexOf("</details>}", healthStart);
  assert.ok(healthStart >= 0 && healthEnd > healthStart);
  const healthSource = panel.slice(healthStart, healthEnd);
  assert.match(healthSource, /<dt>Account<\/dt>/);
  assert.doesNotMatch(healthSource, /<dt>Mode<\/dt>|<dt>Status<\/dt>|<Status\b/);
  assert.doesNotMatch(healthSource, /Disconnect Workspace|Reconnect Google Workspace|Reset simulation data/);
});

test("Workspace resources stay endpoint-owned inside the Stage 3 shell", async () => {
  const [panel, actions] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/WorkspaceDriveResourceActions.tsx"),
  ]);

  assert.match(panel, /if \(!isAdmin\) return;[\s\S]+cachedGetJson<WorkspaceSetupResourcesPayload>\("\/api\/v1\/integrations\/google\/setup\/resources"/);
  assert.match(panel, /isAdmin \? loadWorkspaceResources\(force\) : Promise\.resolve\(\)/);
  assert.match(panel, /No administrator setup request is made for this Office view\./);
  assert.match(panel, /const configured = simulation \|\| workspaceResources\?\.connectReady === true/);
  assert.match(panel, /disabled=\{!configured \|\| working\}/);

  const stageOne = panel.indexOf("number={1}");
  const stageTwo = panel.indexOf("number={2}", stageOne + 1);
  const stageThree = panel.indexOf("number={3}", stageTwo + 1);
  const stageFour = panel.indexOf("number={4}", stageThree + 1);
  const stageEnd = panel.indexOf("{filingMessage &&", stageFour);
  assert.ok(stageOne >= 0 && stageTwo > stageOne && stageThree > stageTwo && stageFour > stageThree && stageEnd > stageFour);
  const stageOneSource = panel.slice(stageOne, stageTwo);
  const stageTwoSource = panel.slice(stageTwo, stageThree);
  const stageThreeSource = panel.slice(stageThree, stageFour);
  const stageFourSource = panel.slice(stageFour, stageEnd);
  assert.match(stageOneSource, /WorkspaceDomainChecklistCard/);
  assert.match(stageOneSource, /simulation=\{simulation\}/);
  assert.doesNotMatch(stageOneSource, /bannerSimulation/);
  assert.match(stageOneSource, /Drive authority:[\s\S]+GOOGLE_WORKSPACE_SHARED_DRIVE_ID[\s\S]+GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED/);
  assert.match(stageOneSource, /Sheets authority:[\s\S]+GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID[\s\S]+first-boot fallback/);
  assert.match(stageTwoSource, /Company account authorization/);
  assert.match(stageTwoSource, /Simulation runs locally, and nothing is sent to Google/);
  assert.match(stageTwoSource, /<details className=\{`workspace-connection-health/);
  assert.doesNotMatch(stageTwoSource, /<section className="workspace-connection-health"|workspace-connection-status|Simulated connection ready|Google Workspace connected/);
  assert.match(stageThreeSource, /Verify the Shared Drive/);
  assert.match(stageThreeSource, /WorkspaceBlueprintEditor/);
  assert.match(stageThreeSource, /workspace-resources-card/);
  assert.match(stageFourSource, /Prepare Gmail/);
  assert.match(stageFourSource, /Verify Calendar/);
  assert.match(stageFourSource, /Sync the Sheets mirror/);
  assert.doesNotMatch(`${stageTwoSource}\n${stageThreeSource}\n${stageFourSource}`, /workspace-env-note|Drive authority:|Sheets authority:|GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED|GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID/);

  for (const state of ["Found", "Created", "Adopted", "Not configured", "Simulated"]) {
    assert.match(`${panel}\n${actions}`, new RegExp(`"${state}"`));
  }
  assert.match(actions, /\/api\/v1\/integrations\/google\/drive\/shared-drive\/adopt/);
  assert.match(actions, /\/api\/v1\/integrations\/google\/drive\/folders\/ensure-roots/);
  assert.match(actions, /\/api\/v1\/integrations\/google\/drive\/folders\/rename/);
  assert.match(actions, /\/api\/v1\/integrations\/google\/sheets\/ensure/);
  assert.match(panel, /workspaceResourceSourceLabel[\s\S]+App-managed[\s\S]+Environment value/);
  assert.match(panel, /workspace-resource-state/);
  assert.match(panel, /workspace-resource-source/);

  const resourceTableStart = panel.indexOf('<OperationsDataTable className="workspace-resource-table"');
  const resourceTableEnd = panel.indexOf("</OperationsDataTable>", resourceTableStart);
  assert.ok(resourceTableStart >= 0 && resourceTableEnd > resourceTableStart);
  assert.doesNotMatch(panel.slice(resourceTableStart, resourceTableEnd), /<button|AdministratorActionButton/);
});

test("Workspace setup masks accounts and exposes copy-exact safe helpers", async () => {
  const [panel, checklist, helper] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx"),
    read("app/settings/components/workspace-domain-checklist/workspace-domain-checklist.ts"),
  ]);

  assert.match(panel, /function maskWorkspaceAccountForDisplay/);
  assert.match(panel, /maskWorkspaceAccountForDisplay\(workspaceResources\.identity\.connectionAccount\)/);
  assert.match(panel, /maskWorkspaceAccountForDisplay\(connectionHealth\.connection\.account\)/);
  assert.doesNotMatch(panel, /workspace\?\.connectionAccount \?\?/);
  assert.doesNotMatch(panel, /<dd>\{connectionHealth\.connection\.account/);

  assert.match(panel, /Connected account ↔ intake mailbox/);
  assert.match(panel, /workspaceResources\.identity\.allowedDomains/);
  assert.match(panel, /workspaceResources\.identity\.mode/);
  assert.match(helper, /https:\/\/groundwork-flooring-ops\.jaggerisagoodboy\.chatgpt\.site\/api\/v1\/integrations\/google\/callback/);
  assert.match(helper, /openssl rand -base64 32/);
  assert.match(checklist, /Missing hosted keys/);
  assert.match(checklist, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(helper, /GOOGLE_WORKSPACE_CLIENT_SECRET: "<secret>"/);
  assert.match(helper, /GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: "<secret 32-byte base64 value>"/);
  assert.match(helper, /GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "<OAuth redirect URI shown above>"/);
  assert.match(helper, /GOOGLE_INTEGRATION_MODE: "<workspace or simulation>"/);
  assert.match(helper, /detail\.envVar\.match\(ENVIRONMENT_KEY_PATTERN\)/);
  assert.match(helper, /function workspaceResourceEnvironmentKey\(resource: WorkspaceChecklistResourceSource\)/);
  assert.match(helper, /primary: "drive\.shared-drive"[\s\S]+resource\.resourceType && resource\.resourceType !== expectedType/);
  assert.match(helper, /resource\.source === "none"[\s\S]+workspaceResourceEnvironmentKey\(resource\)/);
  assert.match(helper, /"client-directory": "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID"/);
  assert.match(helper, /if \(!simulation\) \{[\s\S]+resource\.source === "none"/);
  assert.match(checklist, /workspaceCopyHelperState\(readinessState, resourcesState, resourcesAvailable\)/);
  assert.match(checklist, /copyState === "ready" && dotenvTemplate/);
  assert.match(checklist, /copyState === "unavailable"[\s\S]+Missing-key status is unavailable/);
  assert.doesNotMatch(`${panel}\n${checklist}\n${helper}`, /detail\.(value|secretValue|configuredValue)/);
  assert.equal((`${panel}\n${checklist}`.match(/Copy-exact setup helpers/g) ?? []).length, 1);
  assert.doesNotMatch(panel, /workspace-copy-helpers|copySetupHelper|missingWorkspaceDotenvTemplate/);

  const connectionActions = panel.indexOf("className={panelStyles.connectionActions}");
  const healthCard = panel.indexOf('{isAdmin && <details className={`workspace-connection-health');
  const healthCardEnd = panel.indexOf("</details>}", healthCard);
  assert.ok(connectionActions >= 0 && healthCard > connectionActions && healthCardEnd > healthCard);
  assert.match(panel.slice(connectionActions, healthCard), /Reconnect Google Workspace[\s\S]+Disconnect Workspace/);
  assert.doesNotMatch(panel.slice(healthCard, healthCardEnd), /Disconnect Workspace|Reconnect Google Workspace|Reset simulation data/);
  assert.equal(panel.match(/Disconnect Workspace/g)?.length, 1);
  assert.doesNotMatch(panel, /workspace-checklist|type="checkbox"/);
  assert.match(checklist, /Keep authorization restricted to the approved Workspace domain/);
  assert.match(checklist, /Keep Gmail filing review-first and project-specific/);
  assert.match(checklist, /verify the company-owned Shared Drive and sender mailbox, both shared calendars, and the Sheets mirror/);
});

test("Workspace blueprint is a structured admin editor and the legacy static card is removed", async () => {
  const [panel, editor, blueprint, css] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/WorkspaceBlueprintEditor.tsx"),
    read("app/lib/workspace-blueprint.ts"),
    read("app/globals.css"),
  ]);

  assert.match(panel, /isAdmin && <WorkspaceBlueprintEditor notify=\{notify\} refreshKey=\{blueprintEditorRevision\}/);
  assert.match(panel, /setBlueprintEditorRevision\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(panel, /DRIVE_BLUEPRINT|className="drive-blueprint"|project-folder-list/);
  assert.doesNotMatch(css, /\.drive-blueprint|\.project-folder-list/);

  assert.match(editor, /fetch\("\/api\/v1\/integrations\/google\/setup\/blueprint", \{ cache: "no-store" \}\)/);
  assert.match(editor, /method: "PUT"[\s\S]+expectedVersion: version/);
  assert.match(editor, /response\.status === 409[\s\S]+setConflictVersion/);
  assert.match(editor, /Load latest/);
  assert.match(editor, /Save blueprint/);
  assert.doesNotMatch(editor, /setInterval|debounce|auto-?save/i);
  for (const section of ["Business and naming", "Folder tree", "Templates", "Spreadsheets", "Calendar defaults", "Gmail filing labels"]) {
    assert.match(editor, new RegExp(section));
  }
  for (const contract of ["05_Correspondence", "Email Archive", "Email Attachments", "FCI Holidays", "client-directory"]) {
    assert.match(`${editor}\n${blueprint}`, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(editor, /System[\s\S]+role="tooltip"/);
  assert.match(editor, /Add folder/);
  assert.match(editor, /Add template/);
  assert.match(editor, /Add spreadsheet/);
  assert.match(editor, /spreadsheet role/);
  assert.match(editor, /System mirror/);
  assert.match(editor, /Client &amp; project import/);
  assert.match(editor, /Reference \(read-only\)/);
  assert.match(editor, /WORKSPACE_BLUEPRINT_NAMING_TOKENS/);
  assert.match(editor, /FeatureStateBadge state="Planned"/);
});

test("Office viewers make no resource request and receive an access-owned connection status", async () => {
  const panel = await read("app/settings/components/GoogleWorkspacePanel.tsx");

  assert.match(panel, /if \(!isAdmin\) return;[\s\S]+\/api\/v1\/integrations\/google\/setup\/resources/);
  assert.match(panel, /isAdmin \? loadWorkspaceResources\(force\) : Promise\.resolve\(\)/);
  assert.match(panel, /isAdmin && <details className=\{`workspace-connection-health/);
  assert.match(panel, /AdministratorActionButton className="primary-button" isAdmin=\{isAdmin\}/);
  assert.doesNotMatch(panel, /isAdmin \|\| connectionHealth|isAdmin \|\| workspaceResources/);
});
