import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Workspace setup is a four-stage endpoint-driven shell with callback refresh", async () => {
  const [panel, panelStyles, infoHint, checklist] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.module.css"),
    read("app/settings/components/workspace-setup-shell/WorkspaceInfoHint.tsx"),
    read("app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx"),
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
    "Verify each service",
    "Ongoing upkeep",
  ]) {
    assert.match(panel, new RegExp(`<h3(?: [^>]*)?>${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/h3>`));
  }
  for (const label of [
    "Gmail — labels & test email",
    "Calendar — appointments & test hold",
    "Sheets — mirror sync",
  ]) {
    assert.match(panel, new RegExp(`label="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }

  assert.match(panel, /className="workspace-stage-list"[^>]*role="group"[^>]*aria-label="Google Workspace setup stages"/);
  assert.match(panel, /const anchorId = `workspace-stage-\$\{number\}`/);
  assert.match(panel, /window\.location\.hash === `#\$\{anchorId\}`/);
  assert.match(panel, /window\.addEventListener\("hashchange", syncHashTarget\)/);
  assert.match(panel, /hashTargeted\.current = targeted[\s\S]+if \(targeted\) \{[\s\S]+setOpen\(true\)[\s\S]+scheduleAnchorScroll\(\)/);
  assert.match(panel, /const wasTargeted = hashTargeted\.current[\s\S]+else if \(wasTargeted\) \{[\s\S]+if \(!complete && firstIncomplete\) setOpen\(true\)[\s\S]+else closeStage\(\)/);
  assert.match(panel, /bodyRef\.current\?\.contains\(document\.activeElement\)[\s\S]+toggleRef\.current\?\.focus\(\)/);
  assert.match(panel, /if \(!hashTargeted\.current && complete && !previousComplete\.current\)/);
  assert.match(panel, /scheduleAnchorScroll[\s\S]+scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(panel, /if \(layoutSettled\) \{[\s\S]+if \(hashTargeted\.current\) scheduleAnchorScroll\(\)[\s\S]+return;[\s\S]+new ResizeObserver/);
  assert.match(panel, /observer\.observe\(stageList\)[\s\S]+observer\.disconnect\(\)/);
  assert.equal(panel.match(/layoutSettled=\{!statusSourcesLoading\}/g)?.length, 4);
  assert.match(panel, /if \(hashTargeted\.current\) scheduleAnchorScroll\(\)/);
  assert.match(panel, /ref=\{sectionRef\}/);
  assert.match(panel, /id=\{anchorId\}/);
  assert.match(panel, /className=\{`workspace-setup-stage \$\{panelStyles\.stageAnchor\}\$\{open/);
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
  assert.equal(panel.match(/tone=\{neutralStageStatus \? "neutral"/g)?.length, 3);
  assert.match(panel, /tone=\{stageFourStatusNeutral \? "neutral" : stageFourReady \? "ready"/);
  assert.match(panel, /panelStyles\.stageChipNeutral/);
  assert.match(panelStyles, /\.stageChipNeutral[\s\S]+background: #f0eeeb[\s\S]+color: #6c655f/);
  assert.match(panelStyles, /\.stageAnchor[\s\S]+scroll-margin-top: 86px/);
  assert.match(panel, /workspace-status-banner/);
  assert.match(panel, /workspace-status-mode/);
  assert.match(panel, /workspace-status-progress/);
  assert.doesNotMatch(panel, /workspace-mode-card|Company Google Workspace|Sample data only · no Google account connected · nothing is sent to Google|One administrator-approved organization connection/);
  const shellEnd = panel.indexOf("{filingMessage &&");
  const shell = panel.slice(0, shellEnd);
  assert.equal(shell.match(/workspace-status-mode/g)?.length, 1);
  assert.equal(shell.match(/workspace-stage-chip/g)?.length, 1);
  assert.doesNotMatch(
    `${shell}\n${checklist}`,
    /current mirror source:|Simulated Workspace Gmail|Workspace Gmail|Simulated shared calendars|Workspace shared calendars|Current check:|no OAuth account or Google token is connected|Google was connected\.|Connection ready|Local Workspace simulation is ready\. No Google account is connected\./,
  );
  assert.match(shell, /<strong>Gmail verification<\/strong>/);
  assert.match(shell, /<strong>Calendar verification<\/strong>/);
  assert.match(shell, /Google authorization completed\. Current Workspace status is shown above\./);
  assert.match(shell, /Workspace readiness refreshed\. Current status is shown above\./);

  for (const endpoint of [
    "/api/v1/google-workspace",
    "/api/v1/integrations/google/drive/verify",
    "/api/v1/integrations/google/gmail/labels/prepare",
    "/api/v1/integrations/google/gmail/send-test",
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

test("Stage 4 pins normative verification and ongoing-upkeep copy without inventing operations", async () => {
  const [panel, styles, chatCard] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.module.css"),
    read("app/settings/components/ChatNotificationSettingsCard.tsx"),
  ]);

  for (const [label, info] of [
    ["Gmail — labels & test email", "Creates the three FCI labels and sends one test email to yourself to confirm filing works. Nothing is ever sent to clients from here."],
    ["Calendar — appointments & test hold", "Reads the upcoming appointments window and can create one private test hold with no invitations — confirm access without touching anyone's calendar."],
    ["Sheets — mirror sync", "Runs one sync of the Client Directory and Project Register mirrors and reports exactly what changed."],
  ]) {
    assert.match(panel, new RegExp(`label="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(panel.includes(info), `exact InfoHint copy is pinned for ${label}`);
  }
  for (const copy of [
    "Ongoing upkeep",
    "Tools you'll come back to — these never block setup.",
    "Compares your blueprint with what's actually in Drive and shows any differences before you fix them.",
    "Rename managed folders safely — the app updates Drive and its own records together.",
  ]) {
    assert.ok(panel.includes(copy), `Stage 4 keeps normative copy: ${copy}`);
  }

  const notificationCopy = "Review the closed event-to-space map. Hosted webhook secrets stay outside the browser, application data, logs, and source control.";
  const notificationHint = "Choose which supported events can notify each approved Google Chat space. The routing page shows what is available before anything is enabled.";
  assert.equal(panel.match(new RegExp(notificationCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 1);
  assert.ok(panel.includes(notificationHint));
  assert.notEqual(notificationHint, notificationCopy);
  assert.ok(chatCard.includes(notificationCopy), "the existing operational notification card copy remains byte-identical");
  assert.match(panel, /href="\/settings\?section=workflow-notifications">Open notification routing<\/a>/);

  const stageFourStart = panel.indexOf("number={4}");
  const stageFourEnd = panel.indexOf("{filingMessage &&", stageFourStart);
  const stageFourSource = panel.slice(stageFourStart, stageFourEnd);
  for (const [rowKey, label] of [
    ["drift", "Drift check"],
    ["renames", "Renames"],
    ["notifications", "Notification routing"],
  ]) {
    assert.match(stageFourSource, new RegExp(`rowKey="${rowKey}"[\\s\\S]+label="${label}"`));
  }
  assert.doesNotMatch(stageFourSource, /label="(?:Drift check & reconcile|Managed folder renames)"/);
  assert.match(stageFourSource, /rowKey="drift"[\s\S]+state="PLANNED"[\s\S]+Planned for SET-18\. No reconcile action is available yet\./);
  const driftStart = stageFourSource.indexOf('rowKey="drift"');
  const renameStart = stageFourSource.indexOf('rowKey="renames"', driftStart);
  assert.doesNotMatch(stageFourSource.slice(driftStart, renameStart), /<button|<a /);
  assert.match(panel, /const \[sheetsVerificationPassed, setSheetsVerificationPassed\] = useState\(false\)/);
  assert.match(panel, /function sheetMirrorFullySynced[\s\S]+clients\.status === "synced" && mirror\.projects\.status === "synced"/);
  assert.ok((panel.match(/setSheetsVerificationPassed\(\(current\) => current \|\| sheetMirrorFullySynced\(mirror\)\)/g) ?? []).length >= 3);
  assert.match(panel, /const stageFourCompleteCount = \[gmailVerificationPassed, calendarChecked, sheetsVerificationPassed\]\.filter\(Boolean\)\.length/);
  assert.doesNotMatch(panel, /const stageFourCompleteCount = \[[^\]]*sheetsSynced/);
  assert.match(panel, /const stageFourReady = !stageFourVerificationUnavailable && stageFourCompleteCount === 3/);
  assert.doesNotMatch(panel, /const stageFourReady = stageThreeComplete/);
  assert.match(panel, /const stageFourStatus = statusSourcesLoading[\s\S]+CHECKING[\s\S]+statusSourcesUnavailable \|\| stageFourVerificationUnavailable[\s\S]+UNAVAILABLE[\s\S]+stageFourReady[\s\S]+READY[\s\S]+\$\{stageFourCompleteCount\} OF 3 VERIFIED/);
  assert.match(panel, /const gmailVerificationPassed = gmailLabelsReady && gmailTestEmailPassed/);
  assert.match(panel, /setGmailTestEmailPassed\(true\)/);
  assert.match(panel, /const dependencyDescriptionId = dependencyBlocked \? `workspace-verification-\$\{rowKey\}-dependency` : undefined/);
  assert.match(panel, /typeof children === "function" \? children\(dependencyDescriptionId\) : children/);
  assert.match(stageFourSource, /rowKey="gmail"[\s\S]+dependencyBlocked=\{!gmailActionsEnabled\}[\s\S]+id=\{dependencyDescriptionId\}[\s\S]+aria-describedby=\{dependencyDescriptionId\}/);
  assert.match(stageFourSource, /rowKey="calendar"[\s\S]+dependencyBlocked=\{!calendarActionsEnabled\}[\s\S]+id=\{dependencyDescriptionId\}[\s\S]+aria-describedby=\{dependencyDescriptionId\}/);
  assert.match(stageFourSource, /complete=\{false\}/);
  assert.doesNotMatch(stageFourSource, /status=\{stageFourReady \? "DONE"/);
  assert.match(styles, /\.verificationGroup[\s\S]+\.ongoingGroup[\s\S]+border: 1px dashed/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]+\.verificationBody :global\(\.workspace-actions > \*\)[\s\S]+min-height: 44px/);
  assert.match(styles, /\.verificationBody :global\(\.workspace-actions > \.administrator-action-control > button\)[\s\S]+width: 100%[\s\S]+max-width: none/);
});

test("Workspace cross-links target stage anchors while rendered personal settings use one name", async () => {
  const [directory, testing, navigation, personal, routes] = await Promise.all([
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/settings/components/TestingLaunchPanel.tsx"),
    read("app/settings/components/SettingsAudienceNavigation.tsx"),
    read("app/settings/components/MySettingsPanel.tsx"),
    read("app/lib/operations-routes.ts"),
  ]);

  assert.match(directory, /href="\/settings\?section=google-workspace#workspace-stage-3">Open Google Workspace setup<\/a>/);
  assert.match(testing, /href="\/settings\?section=google-workspace#workspace-stage-4">Open Google Workspace setup<\/a>/);
  assert.doesNotMatch(directory, /onClick=\{onConfigure\}/);
  assert.doesNotMatch(testing, /onClick=\{onGoogleSetup\}/);
  assert.match(navigation, /const PERSONAL_SECTION: SettingsSection = "My settings"/);
  assert.match(navigation, /<SectionButton section=\{PERSONAL_SECTION\} label="My settings"/);
  assert.doesNotMatch(navigation, /label="My account"/);
  assert.match(personal, /<h2>My settings<\/h2>/);
  assert.doesNotMatch(personal, /<h2>My account<\/h2>/);
  for (const [section, slug] of [
    ["My settings", "account"],
    ["Google Workspace", "google-workspace"],
    ["Calendar & appointments", "calendar"],
    ["Inbox & file rules", "inbox-rules"],
    ["Client Directory", "client-directory"],
    ["Workflow & notifications", "workflow-notifications"],
    ["Data & security", "data-security"],
    ["Testing & launch", "testing-launch"],
  ]) {
    assert.match(routes, new RegExp(`"${section}": "${slug}"`));
  }
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

test("Workspace resources stay endpoint-owned in one dependency-ordered Stage 3 surface", async () => {
  const [panel, actions, actionStyles, panelStyles] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/WorkspaceDriveResourceActions.tsx"),
    read("app/settings/components/WorkspaceDriveResourceActions.module.css"),
    read("app/settings/components/GoogleWorkspacePanel.module.css"),
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
  assert.match(stageThreeSource, /panelStyles\.stageThreeUnified/);
  assert.match(stageThreeSource, /data-stage-three-pane="creation"[\s\S]+WorkspaceDriveResourceActions/);
  assert.match(stageThreeSource, /data-stage-three-pane="blueprint"[\s\S]+WorkspaceBlueprintEditor/);
  assert.ok(
    stageThreeSource.indexOf('data-stage-three-pane="creation"') < stageThreeSource.indexOf('data-stage-three-pane="blueprint"'),
    "the primary creation workflow precedes the blueprint in visual, reading, and focus order",
  );
  assert.doesNotMatch(stageThreeSource, /Verify the Shared Drive[\s\S]+workspace-setup-step|workspace-resources-card|workspace-resource-table|Connected account ↔ intake mailbox/);
  assert.match(stageFourSource, /Gmail — labels & test email/);
  assert.match(stageFourSource, /Calendar — appointments & test hold/);
  assert.match(stageFourSource, /Sheets — mirror sync/);
  assert.match(stageFourSource, /WorkspaceFolderRenameActions/);
  assert.match(stageFourSource, /href="\/settings\?section=workflow-notifications"/);
  assert.doesNotMatch(`${stageTwoSource}\n${stageThreeSource}\n${stageFourSource}`, /workspace-env-note|Drive authority:|Sheets authority:|GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED|GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID/);

  for (const state of ["Found", "Created", "Adopted", "Not configured", "Simulated"]) {
    assert.match(`${panel}\n${actions}`, new RegExp(`"${state}"`));
  }
  for (const [endpoint, source] of [
    ["/api/v1/integrations/google/drive/shared-drive/adopt", actions],
    ["/api/v1/integrations/google/drive/folders/ensure-roots", actions],
    ["/api/v1/integrations/google/drive/folders/rename", actions],
    ["/api/v1/integrations/google/sheets/ensure", actions],
    ["/api/v1/integrations/google/drive/templates/ensure", actions],
    ["/api/v1/integrations/google/drive/verify", panel],
    ["/api/v1/integrations/google/calendar/events", panel],
  ]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.match(actions, /method: "POST",[\s\S]+headers: \{ "Content-Type": "application\/json" \},[\s\S]+body: JSON\.stringify\(body\)/);
  assert.match(actions, /selectedId \? \{ driveId: selectedId \} : \{\}/);
  assert.match(actions, /\{ key: resource\.key, name \}/);
  assert.match(panel, /fetch\("\/api\/v1\/integrations\/google\/drive\/verify", \{ method: "POST" \}\)/);
  assert.match(actions, /resourceSourceLabel[\s\S]+App-managed[\s\S]+Environment value/);
  assert.match(actions, /function resourceOperationalState[\s\S]+resource\.source === "none" \|\| !resource\.externalId[\s\S]+resource\.origin === "created"[\s\S]+resource\.origin === "adopted" \|\| resource\.origin === "env-adopted"[\s\S]+return "Found"/);
  assert.doesNotMatch(actions, /return "Ready"|\| "Ready"/);
  const resourceDetailsSource = actions.slice(actions.indexOf("function ResourceDetails"), actions.indexOf("function CreationRow"));
  assert.match(resourceDetailsSource, /const operationalState = resourceOperationalState\(resource\)/);
  assert.match(resourceDetailsSource, /data-resource-operational-state=\{operationalState\}/);
  assert.doesNotMatch(resourceDetailsSource, />\{resource\.state\}</);
  assert.doesNotMatch(actionStyles, /\.resourceStateSimulated/);
  assert.match(actions, /ResourceDetails/);
  assert.match(actions, /Every action is repeat-safe and never deletes Google content\./);

  for (const [label, info] of [
    ["Shared Drive", "The one company drive where every project folder lives. The app never creates a second drive — it adopts the one your admin set up."],
    ["Folder tree (from your blueprint)", "Creates the top-level folders exactly as your blueprint defines them. Rename them from this screen later — never directly in Drive."],
    ["Spreadsheets", "The Client Directory and Project Register the app keeps in sync, plus any extra sheets you defined. The app is the source of truth — the sheets are mirrors."],
    ["Templates", "Starter documents — estimate, work order, change order, checklist, budget — placed in your Templates folder. Edit their content in Google; the app only creates them."],
    ["Calendars", "Checks that the appointments calendar your admin shared is reachable. The app doesn't create calendars yet — that arrives with a later update."],
  ]) {
    assert.match(actions, new RegExp(`label="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.ok(actions.includes(info), `exact InfoHint copy is pinned for ${label}`);
  }
  const rowLabels = [
    'label="Shared Drive"',
    'label="Folder tree (from your blueprint)"',
    'label="Spreadsheets"',
    'label="Templates"',
    'label="Calendars"',
  ];
  let previousRowIndex = -1;
  for (const label of rowLabels) {
    const index = actions.indexOf(label);
    assert.ok(index > previousRowIndex, `${label} stays in the specified creation order`);
    previousRowIndex = index;
  }
  for (const chip of ["FOUND — ADOPT", "VERIFY", "DONE", "AFTER DRIVE", "CREATE", "AFTER FOLDERS", "VERIFY ONLY", "UNAVAILABLE"]) {
    assert.match(actions, new RegExp(`"${chip}"`));
  }
  assert.doesNotMatch(actions, /AFTER SPREADSHEETS|VERIFY-ONLY FOR NOW|Spreadsheets \(/);
  assert.match(actions, /const foldersEnabled = sharedDriveAdoptEnabled && progress\.sharedDriveComplete/);
  assert.match(actions, /const spreadsheetsEnabled = foldersEnabled && progress\.foldersComplete/);
  assert.match(actions, /const templatesEnabled = foldersEnabled && progress\.foldersComplete/);
  assert.match(actions, /const calendarsEnabled = templatesEnabled && progress\.templatesComplete/);
  assert.match(actions, /Unlocks after Workspace resource status is available\./);
  assert.match(actions, /Unlocks after Shared Drive\./);
  assert.match(actions, /Unlocks after Folder tree \(from your blueprint\)\./);
  assert.match(actions, /Unlocks after Templates\./);
  assert.match(actions, /const dependencyDescriptionId = lockedCaption[\s\S]+id=\{dependencyDescriptionId\}[\s\S]+children\(dependencyDescriptionId\)/);
  assert.match(actions, /const adoptDisabled = !adoptEnabled \|\| busy \|\| verifyWorking/);
  assert.match(actions, /const verifyDisabled = !verifyEnabled \|\| busy \|\| verifyWorking \|\| \(!simulation && !driveReady\)/);
  assert.match(actions, /aria-describedby=\{adoptDisabled \? describedBy : undefined\}/);
  assert.match(actions, /aria-describedby=\{verifyDisabled \? describedBy : undefined\}/);
  assert.match(actions, /registryUnavailable[\s\S]+sharedDriveState = registryUnavailable[\s\S]+UNAVAILABLE/);
  assert.match(actions, /const sharedDriveDependency = !stageReady[\s\S]+Unlocks after Connect\.[\s\S]+!driveVerificationReady[\s\S]+Unlocks after Drive is connected and Workspace storage is configured\.[\s\S]+sharedDrive && !sharedDriveAdoptEnabled[\s\S]+resourceStatusDependency/);
  assert.match(actions, /lockedCaption=\{sharedDriveDependency\}/);
  assert.match(actions, /const folderDependency[\s\S]+resourceStatusDependency[\s\S]+!stageReady[\s\S]+Unlocks after Connect\.[\s\S]+Unlocks after Shared Drive\./);
  assert.match(actions, /const spreadsheetDependency[\s\S]+!stageReady[\s\S]+Unlocks after Connect\.[\s\S]+Unlocks after Folder tree \(from your blueprint\)\./);
  assert.match(actions, /const templateDependency[\s\S]+!stageReady[\s\S]+Unlocks after Connect\.[\s\S]+Unlocks after Folder tree \(from your blueprint\)\./);
  assert.match(actions, /const calendarDependency[\s\S]+!stageReady[\s\S]+Unlocks after Connect\.[\s\S]+Unlocks after Templates\.[\s\S]+!simulation && !calendarReady[\s\S]+Unlocks after Calendar is enabled and connected\./);
  assert.match(actions, /label="Calendars"[\s\S]+lockedCaption=\{calendarDependency\}[\s\S]+aria-describedby=\{dependencyDescriptionId\}/);
  assert.match(actions, /resource\.resourceType === "drive\.shared-drive"[\s\S]+resource\.resourceType === "drive\.folder"[\s\S]+resource\.resourceType === "sheets\.spreadsheet"[\s\S]+resource\.resourceType === "drive\.file"/);
  const progressStart = actions.indexOf("export function deriveWorkspaceCreationProgress");
  const progressEnd = actions.indexOf("async function postJson", progressStart);
  assert.ok(progressStart >= 0 && progressEnd > progressStart);
  const progressSource = actions.slice(progressStart, progressEnd);
  assert.match(actions, /function resourceGroupComplete[\s\S]+emptyIsComplete \|\| resources\.length > 0[\s\S]+resources\.every/);
  assert.match(actions, /resourceGroupComplete\(templates, simulation, true\)/);
  assert.match(progressSource, /const sharedDriveComplete = sharedDriveReportedComplete/);
  assert.match(progressSource, /const foldersComplete = sharedDriveComplete && foldersReportedComplete/);
  assert.match(progressSource, /const spreadsheetsComplete = foldersComplete && spreadsheetsReportedComplete/);
  assert.match(progressSource, /const templatesComplete = foldersComplete && templatesReportedComplete/);
  assert.match(progressSource, /completedCount:[\s\S]+sharedDriveComplete,[\s\S]+foldersComplete,[\s\S]+spreadsheetsComplete,[\s\S]+templatesComplete/);
  const creationRowStart = actions.indexOf("function CreationRow");
  const creationRowEnd = actions.indexOf("export function WorkspaceFolderRenameActions", creationRowStart);
  assert.ok(creationRowStart >= 0 && creationRowEnd > creationRowStart);
  const creationRowSource = actions.slice(creationRowStart, creationRowEnd);
  assert.match(creationRowSource, /const locked = Boolean\(lockedCaption\)/);
  assert.match(creationRowSource, /const renderedComplete = complete && !locked/);
  assert.match(creationRowSource, /const renderedState = renderedComplete \? "DONE" : state/);
  assert.match(creationRowSource, /data-workspace-creation-state=\{renderedState\}/);
  assert.match(creationRowSource, /renderedComplete \? ` \$\{styles\.stateChipDone\}`/);
  assert.match(actions, /export function WorkspaceFolderRenameActions/);
  assert.match(actions, /label="managed folders"[\s\S]+FolderRenameAction/);
  assert.match(actions, /<ResourceDetails label="folders"[\s\S]+OpenResourceAction/);
  assert.doesNotMatch(actions.slice(progressStart, progressEnd), /calendar\.calendar/);
  assert.match(panel, /const stageThreeResourcesComplete = completeWorkspaceCreationCount === 4/);
  assert.match(panel, /const folderRenamesEnabled = stageTwoComplete[\s\S]+workspaceResourcesKnown[\s\S]+workspaceCreationProgress\.sharedDriveComplete/);
  assert.match(stageFourSource, /rowKey="renames"[\s\S]+state=\{folderRenamesEnabled \? "AVAILABLE" : "WAITING"\}[\s\S]+enabled=\{folderRenamesEnabled\}/);
  assert.doesNotMatch(stageFourSource, /rowKey="renames"[\s\S]+(?:state|enabled)=\{stageThreeComplete/);
  assert.match(panel, /IN PROGRESS · \$\{completeWorkspaceCreationCount\} of 4/);
  assert.match(panelStyles, /\.stageThreeFrame[\s\S]+container: stage-three \/ inline-size[\s\S]+\.stageThreeUnified[\s\S]+grid-template-columns:[\s\S]+@container stage-three \(max-width: 1000px\)[\s\S]+grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(actionStyles, /@media \(max-width: 560px\)[\s\S]+\.creationRow[\s\S]+grid-template-columns: 27px minmax\(0, 1fr\)[\s\S]+\.resourceDetails > summary[\s\S]+min-height: 44px/);
  assert.doesNotMatch(actionStyles, /font-size:\s*(?:10|11)px/);
  assert.match(actionStyles, /var\(--control-compact\)/);
  assert.match(actionStyles, /var\(--radius-(?:control|card|chip|pill)\)/);
  assert.match(actionStyles, /var\(--line\)/);
  assert.doesNotMatch(actionStyles, /(?:min-height:\s*34px|border-radius:\s*999px|var\(--line-soft\))/);
});

test("Workspace setup masks accounts and exposes copy-exact safe helpers", async () => {
  const [panel, checklist, helper] = await Promise.all([
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx"),
    read("app/settings/components/workspace-domain-checklist/workspace-domain-checklist.ts"),
  ]);

  assert.match(panel, /function maskWorkspaceAccountForDisplay/);
  assert.match(panel, /\.map\(\(account\) => maskWorkspaceAccountForDisplay\(account\)/);
  assert.match(panel, /maskWorkspaceAccountForDisplay\(connectionHealth\.connection\.account\)/);
  assert.doesNotMatch(panel, /workspace\?\.connectionAccount \?\?/);
  assert.doesNotMatch(panel, /<dd>\{connectionHealth\.connection\.account/);

  assert.doesNotMatch(panel, /Connected account ↔ intake mailbox|workspace-resource-identity/);
  assert.match(panel, /allowedDomainCount: workspaceResources\?\.identity\.allowedDomains\.length/);
  assert.match(panel, /sourceModes = \[[\s\S]+workspaceResources\?\.identity\.mode/);
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

  assert.match(panel, /<WorkspaceBlueprintEditor notify=\{notify\} refreshKey=\{blueprintEditorRevision\}/);
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
