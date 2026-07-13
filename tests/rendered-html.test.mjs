import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ships the Floor Coverings International product instead of starter content", async () => {
  const [page, layout, app, css, packageJson] = await Promise.all([
    read("app/page.tsx"), read("app/layout.tsx"), read("app/FloorOpsApp.tsx"),
    read("app/globals.css"), read("package.json"),
  ]);
  assert.match(page, /FloorOpsApp/);
  assert.match(layout, /Floor Coverings International \| Commercial Operations/);
  assert.match(app, /floor-coverings-international-logo\.png/);
  assert.match(app, /Leads & opportunities/);
  assert.match(app, /Schedule & crews/);
  assert.match(app, /Gmail project inbox/);
  assert.match(app, /Workspace Gmail/);
  assert.match(app, /Load messages/);
  assert.match(app, /Ask FCI Assistant/);
  assert.match(css, /--cream:#f6f2ed/);
  assert.match(css, /\.sidebar \{ background:var\(--cream\); color:var\(--ink\);/);
  assert.match(css, /\.brand \{ padding:0; margin:0 4px 26px; background:transparent;/);
  assert.match(css, /@media \(max-width:560px\)/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("declares durable records, uploads, and guarded integration endpoints", async () => {
  const [hosting, schema, recordsApi, uploadsApi, assistantApi] = await Promise.all([
    read(".openai/hosting.json"), read("db/schema.ts"), read("app/api/v1/records/route.ts"),
    read("app/api/v1/uploads/route.ts"), read("app/api/v1/assistant/route.ts"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "FILES"/);
  assert.match(schema, /activityEvents/);
  assert.match(schema, /webhookReceipts/);
  assert.match(recordsApi, /activity_events/);
  assert.match(recordsApi, /type and payload are required/);
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

test("includes migrations and the Floor Coverings International logo asset", async () => {
  await Promise.all([
    access(new URL("drizzle/0000_glossy_nekra.sql", root)),
    access(new URL("drizzle/0006_wide_sprite.sql", root)),
    access(new URL("public/floor-coverings-international-logo.png", root)),
    access(new URL("public/manifest.webmanifest", root)),
  ]);
});

test("adds a searchable, configurable inbox with draft-only Workspace replies", async () => {
  const [app, phonePanel, searchApi, settingsApi, ruleApi, replyApi, gmail, manifest] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("app/PhoneInstallPanel.tsx"), read("app/api/v1/search/route.ts"),
    read("app/api/v1/settings/workspace/route.ts"), read("app/api/v1/filing-rules/[ruleId]/route.ts"), read("app/api/v1/integrations/google/gmail/messages/[messageId]/reply-draft/route.ts"),
    read("app/lib/google-gmail.ts"), read("public/manifest.webmanifest"),
  ]);
  assert.match(app, /Search this Gmail mailbox/);
  assert.match(app, /Save a reply draft/);
  assert.match(app, /Calendar & appointments/);
  assert.match(app, /My account/);
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

test("keeps user preferences scoped to the authenticated office user without a personal-calendar profile", async () => {
  const [schema, preferencesApi, app] = await Promise.all([
    read("app/api/v1/_workspace-data.ts"), read("app/api/v1/settings/me/route.ts"), read("app/FloorOpsApp.tsx"),
  ]);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_preferences/);
  assert.match(schema, /user_email TEXT PRIMARY KEY/);
  assert.match(preferencesApi, /requireOfficeUser\(request\)/);
  assert.match(preferencesApi, /requireSameOrigin\(request\)/);
  assert.match(preferencesApi, /WHERE user_email = \?/);
  assert.match(preferencesApi, /auth\.user\.email/);
  assert.match(preferencesApi, /displayTimezone/);
  assert.match(preferencesApi, /replySignature/);
  assert.doesNotMatch(preferencesApi, /personalCalendarDisplay/);
  assert.doesNotMatch(app, /personalCalendarDisplay/);
  assert.match(preferencesApi, /length > 2_000/);
  assert.match(preferencesApi, /Intl\.DateTimeFormat/);
});

test("makes company shared calendars authoritative without a personal-calendar mode", async () => {
  const [app, settingsApi, guide] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("app/api/v1/settings/workspace/route.ts"), read("docs/google-workspace-organization.md"),
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
  const [app, schema, clientsApi, projectsApi, rulesApi, workspace] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("db/schema.ts"), read("app/api/v1/clients/route.ts"),
    read("app/api/v1/projects/route.ts"), read("app/api/v1/filing-rules/route.ts"), read("app/lib/google-workspace.ts"),
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
  assert.match(workspace, /FCI\/Needs Review/);
});

test("applies enabled built-in filing rules to inbox hints without automatic Gmail writes", async () => {
  const [app, workspace, rulesApi] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("app/lib/google-workspace.ts"), read("app/api/v1/filing-rules/route.ts"),
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
  assert.match(syncApi, /requireSameOrigin/);
  assert.match(schema, /googleSheetSyncState/);
  assert.match(guide, /Project Register/);
});

test("wires prototype controls and exposes Workspace-only live configuration plus local simulation", async () => {
  const [app, workspaceApi, envExample, testGuide, oauth, driveWorkspace] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("app/api/v1/google-workspace/route.ts"),
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
  assert.doesNotMatch(app, /3 email suggestions approved and filed/);
  assert.match(workspaceApi, /credentialsPresent/);
  assert.match(workspaceApi, /connected: connection\.connected/);
  assert.match(workspaceApi, /getGoogleRuntimeConfig/);
  assert.match(workspaceApi, /runtimeMode: google\.environment/);
  assert.match(workspaceApi, /simulation: google\.simulation/);
  assert.match(app, /Local Workspace simulation/);
  assert.match(app, /Connect Google Workspace/);
  assert.match(app, /Simulated Shared Drive blueprint/);
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
  const [app, leadsApi, leadApi, dashboardApi, workspaceSchema, auth] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("app/api/v1/leads/route.ts"),
    read("app/api/v1/leads/[leadId]/route.ts"), read("app/api/v1/dashboard/route.ts"),
    read("app/api/v1/_workspace-data.ts"), read("app/lib/workspace-auth.ts"),
  ]);

  assert.doesNotMatch(app, /Hudson Retail Group|Atlas Design Group|Westport Medical Center|One Harbor Plaza/);
  assert.doesNotMatch(app, /\$511\.7k|\$1\.28m|Saturday, July 11/);
  assert.match(app, /useState<Lead\[]>\(\[\]\)/);
  assert.match(app, /useState<Client\[]>\(\[\]\)/);
  assert.match(app, /useState<Project\[]>\(\[\]\)/);
  assert.match(app, /getJson\("\/api\/v1\/leads"\)/);
  assert.match(app, /fetch\(`\/api\/v1\/leads\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(app, /Live records could not be loaded/);
  assert.match(app, /not implemented yet/);

  assert.match(workspaceSchema, /CREATE TABLE IF NOT EXISTS leads/);
  assert.match(leadsApi, /export async function GET/);
  assert.match(leadsApi, /export async function POST/);
  assert.match(leadsApi, /INSERT INTO activity_events/);
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
  const [oauth, gmail, gmailHelper, gmailSend, calendar, calendarHold, app, guide] = await Promise.all([
    read("app/lib/google-oauth.ts"), read("app/lib/google-gmail.ts"),
    read("app/api/v1/integrations/google/gmail/_route-helpers.ts"),
    read("app/api/v1/integrations/google/gmail/send-test/route.ts"),
    read("app/lib/google-calendar-client.ts"),
    read("app/api/v1/integrations/google/calendar/test-hold/route.ts"),
    read("app/FloorOpsApp.tsx"), read("docs/testing-and-google-workspace-setup.md"),
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
  assert.match(calendar, /attendees=none/);
  assert.match(calendarHold, /requireSameOrigin/);
  assert.match(calendarHold, /config\.simulation/);
  assert.match(app, /Simulation controls/);
  assert.match(app, /Add sample email/);
  assert.match(app, /Create test hold/);
  assert.match(guide, /GOOGLE_WORKSPACE_ENABLED_SERVICES=drive,gmail,calendar,sheets/);
});

test("files Gmail only after an explicit single-project review", async () => {
  const [app, schema, gmail, drive, filingRoute] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("db/schema.ts"), read("app/lib/google-gmail.ts"),
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

test("keeps unfinished project updates visibly planned and non-operational", async () => {
  const app = await read("app/FloorOpsApp.tsx");

  assert.match(app, /Project updates planned/);
  assert.match(app, /disabled title="Project updates are planned after durable Gmail draft support is implemented"/);
  assert.doesNotMatch(app, /ProjectUpdateDraft|ProjectUpdateModal|projectUpdate|Project update composer opened|Send update/);
});

test("captures durable project meetings and bounded Otter evidence", async () => {
  const [workspaceSchema, schema, meetingsApi, app, assistantApi] = await Promise.all([
    read("app/api/v1/_workspace-data.ts"), read("db/schema.ts"),
    read("app/api/v1/projects/[projectId]/meetings/route.ts"), read("app/FloorOpsApp.tsx"),
    read("app/api/v1/assistant/route.ts"),
  ]);

  assert.match(workspaceSchema, /CREATE TABLE IF NOT EXISTS project_meetings/);
  assert.match(workspaceSchema, /project_meetings_project_date_idx/);
  assert.match(schema, /export const projectMeetings = sqliteTable\("project_meetings"/);
  assert.match(schema, /sourceProvider: text\("source_provider"\)/);
  assert.match(schema, /transcript: text\("transcript"\)/);

  assert.match(meetingsApi, /export async function GET/);
  assert.match(meetingsApi, /export async function POST/);
  assert.match(meetingsApi, /requireOfficeUser\(request\)/);
  assert.match(meetingsApi, /requireSameOrigin\(request\)/);
  assert.match(meetingsApi, /Meeting title is required and must be 160 characters or fewer/);
  assert.match(meetingsApi, /optionalText\(body\.transcript, 100_000\)/);
  assert.match(meetingsApi, /parsed\.protocol !== "https:"/);
  assert.match(meetingsApi, /hostname === "otter\.ai" \|\| hostname\.endsWith\("\.otter\.ai"\)/);
  assert.match(meetingsApi, /Add an Otter link, notes, summary, transcript, decision, or action item/);
  assert.match(meetingsApi, /INSERT INTO project_meetings/);
  assert.match(meetingsApi, /INSERT INTO activity_events/);
  assert.match(meetingsApi, /Meeting notes captured/);

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
