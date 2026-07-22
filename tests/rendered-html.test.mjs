import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const appSurfacePaths = [
  "app/FloorOpsApp.tsx",
  "app/settings/components/ChatNotificationSettingsCard.tsx",
  "app/settings/components/DataSecurityPanel.tsx",
  "app/settings/components/DirectorySyncPanel.tsx",
  "app/settings/components/GoogleWorkspacePanel.tsx",
  "app/settings/components/InboxRulesPanel.tsx",
  "app/settings/components/MySettingsPanel.tsx",
  "app/settings/components/SettingsAudienceNavigation.tsx",
  "app/settings/components/SettingsDataNotice.tsx",
  "app/settings/components/TestingLaunchPanel.tsx",
  "app/settings/components/WorkspaceDefaultsPanel.tsx",
  "app/settings/components/WorkspaceBlueprintEditor.tsx",
];
const readAppSurface = async () => (await Promise.all(appSurfacePaths.map(read))).join("\n");

test("renders feature-gated Google Chat routing without a webhook-value field", async () => {
  const [card, defaults, css] = await Promise.all([
    read("app/settings/components/ChatNotificationSettingsCard.tsx"),
    read("app/settings/components/WorkspaceDefaultsPanel.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(card, /const CHAT_CONFIG_URL = "\/api\/v1\/integrations\/google\/chat\/config"/);
  assert.match(card, /"lead\.created"[\s\S]+"gmail\.filing_review_needed"[\s\S]+"calendar\.schedule_changed"[\s\S]+"project\.warranty_follow_up_due"/);
  assert.match(card, /Simulation log only/);
  assert.match(card, /Read-only notification routing/);
  assert.match(card, /config\.missingDetails\.map/);
  assert.match(card, /space\.secretEnvVar/);
  assert.match(card, /body: JSON\.stringify\(\{ events: events\.map\(\(\{ type, enabled, spaceKey \}\)/);
  assert.doesNotMatch(card, /<input[^>]+type="url"|<textarea[^>]+(?:webhook|secret|token)/i);
  assert.match(defaults, /<div className="settings-panel-stack">[\s\S]+<ChatNotificationSettingsCard notify=\{notify\} isAdmin=\{isAdmin\}/);
  assert.match(defaults, /loadState !== "ready"[\s\S]+mode === "workflow" \? <WorkflowSettingsStack/);
  assert.match(css, /\.settings-panel-stack\{display:grid;min-width:0;gap:15px\}/);
  assert.match(css, /@media \(max-width:700px\)[\s\S]+\.chat-routing-list>li\{grid-template-columns:1fr\}/);
});

function containingSelector(css, declarationIndex) {
  const ruleStart = css.lastIndexOf("{", declarationIndex);
  const priorBoundary = Math.max(css.lastIndexOf("}", ruleStart), css.lastIndexOf("{", ruleStart - 1));
  return css.slice(priorBoundary + 1, ruleStart).trim();
}

function pxValue(value, unit) {
  return unit.toLowerCase() === "rem" ? value * 16 : value;
}

test("ships the Floor Coverings International product instead of starter content", async () => {
  const [page, routePage, layout, app, css, packageJson] = await Promise.all([
    read("app/page.tsx"), read("app/OperationsRoutePage.tsx"), read("app/layout.tsx"), readAppSurface(),
    read("app/globals.css"), read("package.json"),
  ]);
  assert.match(page, /OperationsRoutePage/);
  assert.match(routePage, /FloorOpsApp/);
  assert.match(layout, /Floor Coverings International \| Commercial Operations/);
  assert.match(app, /fci-logo-enhanced-master\.svg/);
  assert.match(app, /fci-app-icon-master\.svg/);
  assert.match(layout, /fci-app-icon-master\.svg/);
  assert.match(layout, /fci-app-icon-master\.png/);
  assert.match(layout, /shortcut: "\/fci-app-icon-master\.svg"/);
  assert.match(app, /Leads & opportunities/);
  assert.match(app, /Schedule & crews/);
  assert.match(app, /Gmail project inbox/);
  assert.match(app, /Workspace Gmail/);
  assert.match(app, /Load messages/);
  assert.match(app, /Ask FCI Assistant/);
  assert.match(css, /--cream:#f6f2ed/);
  assert.match(css, /\.sidebar \{ background:var\(--cream\); color:var\(--ink\);/);
  assert.match(css, /\.brand \{ height:82px; padding:0; margin:0 4px 26px; overflow:hidden; background:#fff;/);
  assert.match(css, /\.brand-full \{ display:block; width:100%; height:100%; object-fit:cover;/);
  assert.match(css, /\.sidebar\.collapsed \.brand \.brand-compact img\{display:block\}/);
  assert.match(css, /@media \(max-width:560px\)/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("keeps rendered typography at the audited 12px minimum", async () => {
  const css = (await read("app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const allowedZeroSelectors = new Set([
    ".main-nav>a>.feature-state",
    ".sidebar:not(.collapsed) .main-nav>a>.feature-state",
  ]);
  const violations = [];

  for (const match of css.matchAll(/\bfont-size\s*:\s*(-?(?:\d+(?:\.\d*)?|\.\d+))(px|rem)?(?=\s*(?:!important\s*)?[;}])/gi)) {
    const value = Number(match[1]);
    const unit = match[2]?.toLowerCase() ?? "";
    const selector = containingSelector(css, match.index);
    const isAllowedNonRenderedZero = value === 0 && unit === "" && allowedZeroSelectors.has(selector);
    const isBelowFloor = (unit === "px" || unit === "rem") && pxValue(value, unit) < 12;
    if (!isAllowedNonRenderedZero && (value === 0 || isBelowFloor)) {
      violations.push(`${selector} -> ${match[0]}`);
    }
  }

  for (const match of css.matchAll(/\bfont\s*:\s*([^;}]+)/gi)) {
    const size = match[1].match(/(?:^|\s)(\d+(?:\.\d*)?|\.\d+)(px|rem)(?=\s*(?:\/|\s|$))/i);
    if (size && pxValue(Number(size[1]), size[2]) < 12) {
      violations.push(`${containingSelector(css, match.index)} -> ${match[0]}`);
    }
  }

  assert.deepEqual(violations, [], `Typography below 12px:\n${violations.join("\n")}`);
});

test("keeps the design-critique interaction contracts in the rendered app", async () => {
  const app = await readAppSurface();
  const inbox = app.slice(app.indexOf("function InboxView"), app.indexOf("function AssistantView"));
  const assistant = app.slice(app.indexOf("function AssistantView"), app.indexOf("function ReportsView"));
  const reports = app.slice(app.indexOf("function ReportBarRow"), app.indexOf("function SettingsView"));
  const askBox = assistant.slice(assistant.indexOf('className="ask-box"'), assistant.indexOf("</form>"));

  assert.match(app, /<LeadDrawer lead=\{selectedLead\}/);
  assert.match(app, /function LeadDrawer\(/);
  assert.match(app, /This drawer is read-only/);
  assert.match(app, /placeholder="Name, code, or email"/);
  assert.match(app, /visibleClients\.map/);
  assert.equal(inbox.match(/inbox-state-strip/g)?.length, 1);
  assert.match(assistant, /className="assistant-project-scope"/);
  assert.ok(assistant.indexOf('className="assistant-project-scope"') < assistant.indexOf('className="ask-box"'));
  assert.doesNotMatch(askBox, /<select/);
  assert.match(reports, /projectLifecycleOrder\.indexOf/);
  assert.match(reports, /<ul className="bar-chart"/);
  assert.match(reports, /operationsHref\("Leads", \{ leadStage: item\.filter \}\)/);
  assert.match(reports, /operationsHref\("Projects", \{ projectLifecycle: lifecycle \}\)/);
  assert.match(reports, /otherStageLeads\.length > 0/);
  assert.doesNotMatch(reports, /role="img"/);
  assert.doesNotMatch(reports, /trend=/);
});

test("declares durable uploads and guarded integration endpoints", async () => {
  const [hosting, schema, uploadsApi, assistantApi] = await Promise.all([
    read(".openai/hosting.json"), read("db/schema.ts"),
    read("app/api/v1/uploads/route.ts"), read("app/api/v1/assistant/route.ts"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "FILES"/);
  assert.match(schema, /activityEvents/);
  assert.match(schema, /webhookReceipts/);
  assert.match(uploadsApi, /20 \* 1024 \* 1024/);
  assert.match(uploadsApi, /file type is not allowed/);
  assert.match(assistantApi, /read-only commercial flooring project assistant/);
  assert.match(assistantApi, /OPENAI_API_KEY/);
  assert.match(assistantApi, /projectEvidence/);
  assert.match(assistantApi, /citationIds/);
  assert.match(assistantApi, /records-only/);
  assert.match(assistantApi, /SELECT COUNT\(\*\) AS total FROM contacts/);
  assert.match(assistantApi, /AbortController/);
  assert.match(assistantApi, /Question request is too large/);
});

test("retires the legacy generic records endpoint and its unused actor helper", async () => {
  const workspaceData = await read("app/api/v1/_workspace-data.ts");
  await assert.rejects(
    access(new URL("app/api/v1/records/route.ts", root)),
    (error) => error?.code === "ENOENT",
  );
  assert.doesNotMatch(workspaceData, /\bactorFrom\b/);
});

test("includes migrations and preserves the supplied Floor Coverings International logo assets", async () => {
  await Promise.all([
    access(new URL("drizzle/0000_glossy_nekra.sql", root)),
    access(new URL("drizzle/0006_wide_sprite.sql", root)),
  ]);
  const [appIcon, fullLogo, appIconSvg, fullLogoSvg, manifest] = await Promise.all([
    readFile(new URL("public/fci-app-icon-master.png", root)),
    readFile(new URL("public/fci-logo-enhanced-master.png", root)),
    read("public/fci-app-icon-master.svg"),
    read("public/fci-logo-enhanced-master.svg"),
    read("public/manifest.webmanifest"),
  ]);

  const pngDimensions = (asset) => ({
    width: asset.readUInt32BE(16),
    height: asset.readUInt32BE(20),
  });
  assert.equal(appIcon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(fullLogo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.deepEqual(pngDimensions(appIcon), { width: 1254, height: 1254 });
  assert.deepEqual(pngDimensions(fullLogo), { width: 1254, height: 1254 });
  assert.equal(createHash("sha256").update(appIcon).digest("hex"), "f39b41e506baee0df8515c216b680e684ce71e7bbf8f7e3256c44abddb4e27e5");
  assert.equal(createHash("sha256").update(fullLogo).digest("hex"), "051752f82c9763ca1a23460ba3b00a0e531d691b44e31aa5f7711fe6cdd4eb05");
  assert.equal(createHash("sha256").update(appIconSvg.replaceAll("\r\n", "\n")).digest("hex"), "b510970816cefa2ca1d43b424de7de5f687910c902e95d369693d72315593050");
  assert.equal(createHash("sha256").update(fullLogoSvg.replaceAll("\r\n", "\n")).digest("hex"), "81946ae0e8d4a5a53b639f95708ef288615c9b1082adb5b9800602b39b971506");
  for (const svg of [appIconSvg, fullLogoSvg]) {
    assert.match(svg, /<svg\b/i);
    assert.match(svg, /\bwidth="1254"/i);
    assert.match(svg, /\bheight="1254"/i);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image)\b/i);
    assert.doesNotMatch(svg, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(svg, /\b(?:href|xlink:href)\s*=\s*["'](?!#)/i);
  }
  assert.deepEqual(JSON.parse(manifest).icons, [
    {
      src: "/fci-app-icon-master.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
    {
      src: "/fci-app-icon-master.png",
      sizes: "1254x1254",
      type: "image/png",
      purpose: "any",
    },
  ]);
});

test("adds a searchable, configurable inbox with draft-only Workspace replies", async () => {
  const [app, phonePanel, searchApi, settingsApi, ruleApi, replyApi, gmail, manifest] = await Promise.all([
    readAppSurface(), read("app/PhoneInstallPanel.tsx"), read("app/api/v1/search/route.ts"),
    read("app/api/v1/settings/workspace/route.ts"), read("app/api/v1/filing-rules/[ruleId]/route.ts"), read("app/api/v1/integrations/google/gmail/messages/[messageId]/reply-draft/route.ts"),
    read("app/lib/google-gmail.ts"), read("public/manifest.webmanifest"),
  ]);
  assert.match(app, /Search this Gmail mailbox/);
  assert.match(app, /Save a reply draft/);
  assert.match(app, /Calendar & appointments/);
  assert.match(app, /My settings/);
  assert.match(app, /WorkspaceDefaultsPanel/);
  assert.match(app, /Local Workspace simulation/);
  assert.match(app, /Reset simulation data/);
  assert.match(app, /PhoneInstallPanel/);
  assert.match(searchApi, /contacts ct JOIN clients/);
  assert.match(searchApi, /ESCAPE/);
  assert.match(settingsApi, /workspace_settings/);
  assert.match(settingsApi, /review-first/);
  assert.match(ruleApi, /export async function PATCH/);
  assert.match(ruleApi, /export async function DELETE/);
  assert.match(replyApi, /sent: false/);
  assert.match(replyApi, /getWorkspaceGmailClient/);
  assert.match(gmail, /createReplyDraft/);
  assert.match(gmail, /getReplyContext/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(phonePanel, /beforeinstallprompt/);
  assert.match(phonePanel, /Add to Home Screen/);
});

test("keeps My settings scoped to the authenticated office user and honest about planned consumers", async () => {
  const [schema, preferencesApi, app, mySettings, notificationCatalog] = await Promise.all([
    read("db/schema.ts"), read("app/api/v1/settings/me/route.ts"), readAppSurface(),
    read("app/settings/components/MySettingsPanel.tsx"), read("app/lib/user-settings.ts"),
  ]);
  assert.match(schema, /export const userPreferences = sqliteTable\("user_preferences"/);
  assert.match(schema, /userEmail: text\("user_email"\)\.primaryKey\(\)/);
  assert.match(schema, /notificationPreferencesJson: text\("notification_preferences_json"\)/);
  assert.match(preferencesApi, /requireOfficeUser\(request\)/);
  assert.match(preferencesApi, /requireSameOrigin\(request\)/);
  assert.match(preferencesApi, /WHERE user_email = \?/);
  assert.match(preferencesApi, /auth\.user\.email/);
  assert.match(preferencesApi, /notification_preferences_json/);
  assert.match(preferencesApi, /normalizeUserNotificationPreferences/);
  assert.match(preferencesApi, /displayTimezone/);
  assert.match(preferencesApi, /replySignature/);
  assert.doesNotMatch(preferencesApi, /display_name|displayName/);
  assert.doesNotMatch(preferencesApi, /personalCalendarDisplay/);
  assert.doesNotMatch(app, /personalCalendarDisplay/);
  assert.match(preferencesApi, /length > 2_000/);
  assert.match(preferencesApi, /Intl\.DateTimeFormat/);
  assert.match(mySettings, /data-session-profile="true"/);
  assert.match(mySettings, /data-preference-consumer="planned"/);
  assert.match(mySettings, /FeatureStateBadge state="Planned"/);
  assert.match(mySettings, /organization-level space routing only/);
  assert.match(notificationCatalog, /"lead\.created"/);
  assert.match(notificationCatalog, /"gmail\.filing_review_needed"/);
  assert.match(notificationCatalog, /"calendar\.schedule_changed"/);
  assert.match(notificationCatalog, /"project\.warranty_follow_up_due"/);
});

test("makes company shared calendars authoritative without a personal-calendar mode", async () => {
  const [app, settingsApi, guide] = await Promise.all([
    readAppSurface(), read("app/api/v1/settings/workspace/route.ts"), read("docs/google-workspace-organization.md"),
  ]);
  assert.match(app, /Plan to create two shared FCI calendars/);
  assert.match(app, /Keep company work in two shared FCI Workspace calendars/);
  assert.match(app, /one for client appointments and one for field scheduling/);
  assert.match(app, /Gmail and Calendar are separate/);
  assert.match(app, /company calendar IDs/);
  assert.match(settingsApi, /calendarSetupMode/);
  assert.match(settingsApi, /appointmentCalendarId/);
  assert.doesNotMatch(settingsApi, /personalAvailabilityPolicy/);
  assert.doesNotMatch(app, /personalAvailabilityPolicy/);
  assert.match(guide, /Calendar ownership/);
  assert.match(guide, /FCI • Client Appointments/);
});

test("models clients, independent projects, and review-first email filing", async () => {
  const [app, schema, clientsApi, projectsApi, rulesApi, workspace, blueprint] = await Promise.all([
    readAppSurface(), read("db/schema.ts"), read("app/api/v1/clients/route.ts"),
    read("app/api/v1/projects/route.ts"), read("app/api/v1/filing-rules/route.ts"), read("app/lib/google-workspace.ts"),
    read("app/lib/workspace-blueprint.ts"),
  ]);
  assert.match(app, /Client Directory/);
  assert.match(app, /multiple independent projects/);
  assert.match(app, /Multi-project protection/);
  assert.match(schema, /export const clients/);
  assert.match(schema, /export const projects/);
  assert.match(schema, /export const filingRules/);
  assert.match(clientsApi, /client_code/);
  assert.match(projectsApi, /client_id/);
  assert.match(rulesApi, /approval_required/);
  assert.match(workspace, /needs-project-selection/);
  assert.match(blueprint, /FCI\/Needs Review/);
});

test("applies enabled built-in filing rules to inbox hints without automatic Gmail writes", async () => {
  const [app, workspace, rulesApi] = await Promise.all([
    readAppSurface(), read("app/lib/google-workspace.ts"), read("app/api/v1/filing-rules/route.ts"),
  ]);
  assert.match(app, /evaluateInboxFilingRules/);
  assert.match(app, /clients=\{clients\} rules=\{filingRules\}/);
  assert.match(app, /Paused rules do not influence suggestions/);
  assert.match(workspace, /export function evaluateInboxFilingRules/);
  assert.match(workspace, /filter\(\(\{ rule \}\) => rule\.enabled\)/);
  assert.match(workspace, /requiresManualReview: true/);
  assert.match(workspace, /multiple-project-client/);
  assert.match(rulesApi, /Built-in rules must remain available/);
  assert.doesNotMatch(workspace, /applyFiledLabel/);
});

test("keeps the app authoritative while mirroring clients and projects to Google Sheets", async () => {
  const [oauth, sheets, clientsApi, projectsApi, statusApi, syncApi, schema, guide] = await Promise.all([
    read("app/lib/google-oauth.ts"), read("app/lib/google-sheets.ts"), read("app/api/v1/clients/route.ts"),
    read("app/api/v1/projects/route.ts"), read("app/api/v1/integrations/google/sheets/status/route.ts"),
    read("app/api/v1/integrations/google/sheets/sync/route.ts"), read("db/schema.ts"), read("docs/google-workspace-organization.md"),
  ]);
  assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/spreadsheets/);
  assert.match(oauth, /clientDirectorySheetId/);
  assert.match(sheets, /Account Notes is intentionally spreadsheet-owned/);
  assert.match(sheets, /Project Register/);
  assert.match(sheets, /valueInputOption=RAW/);
  assert.match(clientsApi, /trySyncGoogleDirectory/);
  assert.match(projectsApi, /trySyncGoogleDirectory/);
  assert.match(statusApi, /getGoogleSheetMirrorStatus/);
  assert.match(statusApi, /getEffectiveGoogleRuntimeSetup/);
  assert.match(statusApi, /effectiveResources\.clientDirectorySheet\.source/);
  assert.match(syncApi, /getEffectiveGoogleRuntimeSetup/);
  assert.match(syncApi, /requireSameOrigin/);
  assert.match(schema, /googleSheetSyncState/);
  assert.match(guide, /Project Register/);
});

test("wires development controls and exposes Workspace-only live configuration plus local simulation", async () => {
  const [app, workspaceApi, envExample, testGuide, oauth, driveWorkspace] = await Promise.all([
    readAppSurface(), read("app/api/v1/google-workspace/route.ts"),
    read(".env.example"), read("docs/testing-and-google-workspace-setup.md"),
    read("app/lib/google-oauth.ts"), read("app/lib/google-workspace.ts"),
  ]);
  assert.match(app, /workspace-search/);
  assert.match(app, /setNotificationsOpen/);
  assert.match(app, /onAdvance\(lead\.id\)/);
  assert.match(app, /scheduleDataAvailable/);
  assert.match(app, /Workspace Gmail/);
  assert.match(app, /Load messages/);
  assert.match(app, /GmailFilingModal/);
  assert.match(app, /sidebarCollapsed/);
  assert.match(app, /Workspace actions/);
  assert.match(app, /SourceDetailModal/);
  assert.match(app, /TestingLaunchPanel/);
  assert.match(app, /Development environment · Test data only/);
  assert.doesNotMatch(app, /3 email suggestions approved and filed/);
  assert.match(workspaceApi, /credentialsPresent/);
  assert.match(workspaceApi, /connected: connection\.connected/);
  assert.match(workspaceApi, /getEffectiveGoogleRuntimeSetup/);
  assert.match(workspaceApi, /const google = \(await getEffectiveGoogleRuntimeSetup\(\)\)\.config/);
  assert.match(workspaceApi, /runtimeMode: google\.environment/);
  assert.match(workspaceApi, /simulation: google\.simulation/);
  assert.match(app, /Local Workspace simulation/);
  assert.match(app, /Connect Google Workspace/);
  assert.match(app, /WorkspaceBlueprintEditor/);
  assert.doesNotMatch(app, /Simulated Shared Drive blueprint/);
  assert.match(envExample, /GOOGLE_INTEGRATION_MODE=simulation/);
  assert.match(envExample, /GOOGLE_WORKSPACE_ENABLED_SERVICES=drive,gmail,calendar,sheets/);
  assert.match(envExample, /GOOGLE_WORKSPACE_SHARED_DRIVE_ID=/);
  assert.match(testGuide, /Local Workspace simulation/);
  assert.match(testGuide, /Google Cloud and Google Workspace are separate products/);
  assert.match(oauth, /GoogleWorkspaceMode = "simulation" \| "workspace"/);
  assert.match(driveWorkspace, /mode: "shared-drive"/);

  const workspaceOnlySources = [app, workspaceApi, envExample, testGuide, oauth, driveWorkspace].join("\n");
  assert.doesNotMatch(workspaceOnlySources, /GOOGLE_TEST_/);
  assert.doesNotMatch(workspaceOnlySources, /GOOGLE_PRODUCTION_/);
  assert.doesNotMatch(workspaceOnlySources, /my-drive/i);
  assert.doesNotMatch(workspaceOnlySources, /personal (?:gmail|google|test) (?:account|profile|mode)/i);
});

test("uses durable live records without hardcoded business demonstrations", async () => {
  const [app, leadsApi, leadApi, leadAdapter, dashboardApi, workspaceSchema, auth] = await Promise.all([
    readAppSurface(), read("app/api/v1/leads/route.ts"),
    read("app/api/v1/leads/[leadId]/route.ts"), read("app/adapters/d1/lead-repository.ts"),
    read("app/api/v1/dashboard/route.ts"),
    read("db/schema.ts"), read("app/lib/workspace-auth.ts"),
  ]);

  assert.doesNotMatch(app, /Hudson Retail Group|Atlas Design Group|Westport Medical Center|One Harbor Plaza/);
  assert.doesNotMatch(app, /\$511\.7k|\$1\.28m|Saturday, July 11/);
  assert.match(app, /useState<Lead\[]>\(\[\]\)/);
  assert.match(app, /useState<Client\[]>\(\[\]\)/);
  assert.match(app, /useState<Project\[]>\(\[\]\)/);
  assert.match(app, /getJson\("\/api\/v1\/leads"\)/);
  assert.match(app, /fetch\(`\/api\/v1\/leads\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(app, /Live records could not be loaded/);
  assert.match(app, /not available as controls yet/);

  assert.match(workspaceSchema, /export const leads = sqliteTable\("leads"/);
  assert.match(leadsApi, /export async function GET/);
  assert.match(leadsApi, /export async function POST/);
  assert.match(leadsApi, /createD1LeadRepository/);
  assert.match(leadAdapter, /INSERT INTO activity_events/);
  assert.match(leadApi, /export async function PATCH/);
  assert.match(leadApi, /Lead stage changed/);
  assert.match(dashboardApi, /estimated_pipeline_value/);
  assert.match(dashboardApi, /scheduleDataAvailable: false/);
  assert.match(auth, /allowedEmails\.length === 0 && allowedDomains\.length === 0\) return false/);
});

test("keeps local Workspace simulation isolated from the one company Workspace connection", async () => {
  const [oauth, simulation, resetRoute, authorizeRoute, drive, auth, chatAuth, projectsApi, projectDriveApi, schema, guide] = await Promise.all([
    read("app/lib/google-oauth.ts"), read("app/lib/workspace-simulation.ts"),
    read("app/api/v1/integrations/google/simulation/reset/route.ts"), read("app/api/v1/integrations/google/authorize/route.ts"),
    read("app/lib/google-drive.ts"), read("app/lib/workspace-auth.ts"), read("app/chatgpt-auth.ts"),
    read("app/api/v1/projects/route.ts"), read("app/api/v1/projects/[projectId]/drive/route.ts"),
    read("db/schema.ts"), read("docs/testing-and-google-workspace-setup.md"),
  ]);
  assert.match(oauth, /GOOGLE_INTEGRATION_MODE/);
  assert.match(oauth, /connectionKey: simulation \? "workspace-simulation" : "google-workspace"/);
  assert.match(oauth, /simulation_has_no_google_token/);
  assert.match(oauth, /AES-GCM/);
  assert.match(oauth, /code_challenge_method/);
  assert.match(oauth, /GOOGLE_REVOCATION_URL/);
  assert.match(simulation, /WorkspaceSimulationGmailClient/);
  assert.match(simulation, /workspace_simulation_state/);
  assert.match(simulation, /resetWorkspaceSimulation/);
  assert.doesNotMatch(simulation, /googleapis\.com|accounts\.google\.com/);
  assert.match(resetRoute, /requireSameOrigin/);
  assert.match(resetRoute, /resetWorkspaceSimulation/);
  assert.match(resetRoute, /Simulation reset is available only/);
  assert.match(authorizeRoute, /Local Workspace simulation does not connect to a Google account/);
  assert.match(drive, /assertContained/);
  assert.match(drive, /fciProjectId/);
  assert.match(auth, /FCI_ADMIN_EMAILS/);
  assert.match(auth, /same-origin browser request/);
  assert.match(auth, /NODE_ENV !== "development"/);
  assert.match(chatAuth, /FCI_LOCAL_DEV_USER_EMAIL/);
  assert.match(projectsApi, /m\.connection_key = \?/);
  assert.doesNotMatch(projectsApi, /SELECT p\.\*/);
  assert.match(projectDriveApi, /drive_folder_mappings/);
  assert.doesNotMatch(projectDriveApi, /UPDATE projects SET drive_folder_id/);
  assert.match(schema, /drive_folder_mappings_profile_entity_folder_unique/);
  assert.match(guide, /creates no Google OAuth attempt, refresh token, API request/);
  assert.match(guide, /Live Google Workspace prerequisites/);
  assert.match(guide, /administrator connection account/);
  assert.match(guide, /Web application OAuth client/);
});

test("provides explicit Gmail and Calendar controls in simulation and Workspace modes", async () => {
  const [oauth, gmail, gmailHelper, gmailSend, calendar, calendarEvents, calendarHold, app, guide] = await Promise.all([
    read("app/lib/google-oauth.ts"), read("app/lib/google-gmail.ts"),
    read("app/api/v1/integrations/google/gmail/_route-helpers.ts"),
    read("app/api/v1/integrations/google/gmail/send-test/route.ts"),
    read("app/lib/google-calendar-client.ts"),
    read("app/lib/google-integration-events.ts"),
    read("app/api/v1/integrations/google/calendar/test-hold/route.ts"),
    readAppSurface(), read("docs/testing-and-google-workspace-setup.md"),
  ]);
  assert.match(oauth, /GOOGLE_WORKSPACE_/);
  assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
  assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/calendar\.events/);
  assert.match(gmailHelper, /getWorkspaceGmailClient/);
  assert.match(gmailHelper, /assertGoogleService\(config, "gmail"\)/);
  assert.match(gmailHelper, /config\.simulation/);
  assert.match(gmailHelper, /WorkspaceSimulationGmailClient/);
  assert.match(gmailHelper, /getGoogleAccessToken\(config, "gmail"\)/);
  assert.match(gmail, /allowedDomains\.includes/);
  assert.match(gmailSend, /requireSameOrigin/);
  assert.match(calendar, /visibility: "private"/);
  assert.match(calendarEvents, /attendees=none/);
  assert.match(calendarHold, /requireSameOrigin/);
  assert.match(calendarHold, /config\.simulation/);
  assert.match(app, /Google Workspace setup steps/);
  assert.match(app, /Simulated Workspace Gmail/);
  assert.match(app, /Add sample email/);
  assert.match(app, /Create test hold/);
  assert.match(guide, /GOOGLE_WORKSPACE_ENABLED_SERVICES=drive,gmail,calendar,sheets/);
});

test("files Gmail only after an explicit single-project review", async () => {
  const [app, schema, gmail, drive, filingRoute] = await Promise.all([
    readAppSurface(), read("db/schema.ts"), read("app/lib/google-gmail.ts"),
    read("app/lib/google-drive.ts"), read("app/api/v1/integrations/google/gmail/messages/[messageId]/file/route.ts"),
  ]);
  assert.match(app, /Review & copy/);
  assert.match(app, /GmailFilingModal/);
  assert.match(app, /Copy email \+ \$/);
  assert.doesNotMatch(app, /Label only|labelTestMessageFiled/);
  await assert.rejects(
    access(new URL("app/api/v1/integrations/google/gmail/messages/[messageId]/label/route.ts", root)),
    (error) => error?.code === "ENOENT",
  );
  assert.match(schema, /gmailFileArchives/);
  assert.match(schema, /gmailFileArchiveArtifacts/);
  assert.match(gmail, /getMessageArchive/);
  assert.match(gmail, /format: "raw"/);
  assert.match(drive, /resolveManagedProjectFolderPath/);
  assert.match(drive, /findOrUploadManagedFile/);
  assert.match(filingRoute, /requireSameOrigin/);
  assert.match(filingRoute, /project_drive_workspace_required/);
  assert.match(filingRoute, /gmail_message_already_assigned/);
  assert.match(filingRoute, /fciGmailMessageId/);
  assert.match(filingRoute, /applyFiledLabel/);
  assert.match(filingRoute, /inboxRetained: true/);
});

test("labels unfinished features without presenting placeholder controls", async () => {
  const [app, badge] = await Promise.all([
    readAppSurface(),
    read("app/components/FeatureStateBadge.tsx"),
  ]);
  const navItems = app.match(/const navItems:[\s\S]+?= \[([\s\S]+?)\n\];/)?.[1] ?? "";

  assert.match(navItems, /label: "Schedule"[\s\S]+?state: "Planned"/);
  assert.match(app, /state="Working"/);
  assert.match(app, /state="In development"/);
  assert.match(app, /"Setup required"/);
  assert.match(app, /state="Planned"/);
  assert.match(badge, /"Working" \| "In development" \| "Setup required" \| "Planned"/);
  for (const retiredLabel of [["pi", "lot"], ["proto", "type"]].map((parts) => parts.join(""))) {
    assert.doesNotMatch(`${app}\n${badge}`, new RegExp(retiredLabel, "i"));
  }
  assert.match(app, /\(\["Overview", "Meetings"\] as const\)/);
  assert.match(app, /Planned project capabilities/);
  assert.match(app, /planned-project-updates/);
  assert.doesNotMatch(app, /EmptyProjectTab|Project updates planned|disabled title="Project updates/);
  assert.doesNotMatch(app, /ProjectUpdateDraft|ProjectUpdateModal|projectUpdate|Project update composer opened|Send update/);
});

test("uses authorized project-manager identities and exposes the narrow admin correction", async () => {
  const app = await readAppSurface();

  assert.match(app, /managerId: string \| null/);
  assert.match(app, /project_manager_id === "string"/);
  assert.match(app, /projectManagerId: project\.managerId/);
  assert.doesNotMatch(app, /projectManager: project\.lead/);
  assert.match(app, /assigned-manager-field/);
  assert.match(app, /signed-in account/);
  assert.doesNotMatch(app, /name="manager"/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /JSON\.stringify\(\{ projectId: project\.id, projectManagerId \}\)/);
  assert.match(app, /<ProjectDrawer[\s\S]+?isAdmin=\{isAdmin\}/);
  assert.match(app, /Assign to me/);
  assert.match(app, /No authorized manager is assigned/);
});

test("keeps mobile project status, schedule truth, site, and value visible with readable audited text", async () => {
  const [app, css] = await Promise.all([readAppSurface(), read("app/globals.css")]);

  assert.match(app, /project-row-status/);
  assert.match(app, /project-row-details/);
  assert.match(app, /project-row-value/);
  assert.match(app, /Estimated value/);
  assert.match(css, /\.project-row-details\{grid-column:1\/4;grid-row:2;display:grid!important/);
  assert.match(css, /\.project-row-value\{grid-column:1\/4;grid-row:3;display:flex!important/);
  assert.doesNotMatch(css, /projects-table-row>span:nth-child\(3\),\.projects-table-row>strong:nth-child\(4\)\{display:none\}/);
  assert.match(css, /\.metric-top span,.metric-top small,.metric-card p,.panel-header span/);
  assert.match(css, /\.projects-table-row strong,.projects-table-row small\{font-size:12px\}/);
  assert.match(css, /color:#655f59/);
});

test("captures durable project meetings and bounded Otter evidence", async () => {
  const [schema, meetingsApi, meetingOperations, meetingDomain, meetingAdapter, app, assistantApi] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/v1/projects/[projectId]/meetings/route.ts"),
    read("app/application/project-meeting-operations.ts"),
    read("app/domain/project-meeting.ts"),
    read("app/adapters/d1/project-meeting-repository.ts"),
    readAppSurface(),
    read("app/api/v1/assistant/route.ts"),
  ]);

  assert.match(schema, /export const projectMeetings = sqliteTable\("project_meetings"/);
  assert.match(schema, /project_meetings_project_date_idx/);
  assert.match(schema, /sourceProvider: text\("source_provider"\)/);
  assert.match(schema, /transcript: text\("transcript"\)/);

  assert.match(meetingsApi, /export async function GET/);
  assert.match(meetingsApi, /export async function POST/);
  assert.match(meetingsApi, /requireOfficeUser\(request\)/);
  assert.match(meetingsApi, /requireSameOrigin\(request\)/);
  assert.match(meetingsApi, /createProjectMeeting\(/);
  assert.match(meetingOperations, /normalizeProjectMeeting\(input as Record<string, unknown>\)/);
  assert.match(meetingDomain, /Meeting title is required and must be 160 characters or fewer/);
  assert.match(meetingDomain, /optionalProjectMeetingText\(body\.transcript, 100_000\)/);
  assert.match(meetingDomain, /parsed\.protocol !== "https:"/);
  assert.match(meetingDomain, /hostname === "otter\.ai" \|\| hostname\.endsWith\("\.otter\.ai"\)/);
  assert.match(meetingDomain, /Add an Otter link, notes, summary, transcript, decision, or action item/);
  assert.match(meetingAdapter, /INSERT INTO project_meetings/);
  assert.match(meetingAdapter, /INSERT INTO activity_events/);
  assert.match(meetingOperations, /Meeting notes captured/);

  assert.match(app, /<ProjectMeetings project=\{project\} notify=\{notify\} \/>/);
  assert.match(app, /Recommended Otter workflow/);
  assert.match(app, /Capture meeting notes/);
  assert.match(app, /name="sourceUrl"/);
  assert.match(app, /name="attendees"/);
  assert.match(app, /name="summary"/);
  assert.match(app, /name="decisions"/);
  assert.match(app, /name="actionItems"/);
  assert.match(app, /name="notes"/);
  assert.match(app, /name="transcript"/);
  assert.match(app, /Open source/);

  assert.match(assistantApi, /FROM project_meetings WHERE project_id = \?/);
  assert.match(assistantApi, /id: `meeting:\$\{meeting\.id\}`/);
  assert.match(assistantApi, /Source: \$\{meeting\.source_provider\}/);
  assert.match(assistantApi, /Transcript excerpt: \$\{compact\(meeting\.transcript, 900\)\}/);
  assert.match(assistantApi, /SELECT COUNT\(\*\) AS total FROM project_meetings/);
});
