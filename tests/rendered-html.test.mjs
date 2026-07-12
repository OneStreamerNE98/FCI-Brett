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
  assert.match(app, /Connected inbox/);
  assert.match(app, /Connected Gmail/);
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
    access(new URL("public/floor-coverings-international-logo.png", root)),
    access(new URL("public/manifest.webmanifest", root)),
  ]);
});

test("adds a searchable, configurable inbox with draft-only personal replies", async () => {
  const [app, searchApi, settingsApi, ruleApi, replyApi, gmail, manifest] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("app/api/v1/search/route.ts"), read("app/api/v1/settings/workspace/route.ts"),
    read("app/api/v1/filing-rules/[ruleId]/route.ts"), read("app/api/v1/integrations/google/gmail/messages/[messageId]/reply-draft/route.ts"),
    read("app/lib/google-gmail.ts"), read("public/manifest.webmanifest"),
  ]);
  assert.match(app, /Search this Gmail mailbox/);
  assert.match(app, /Save Gmail draft/);
  assert.match(app, /Calendar & appointments/);
  assert.match(app, /My account/);
  assert.match(app, /WorkspaceDefaultsPanel/);
  assert.match(app, /Shared Google test account/);
  assert.match(app, /reset to its built-in default/);
  assert.match(searchApi, /contacts ct JOIN clients/);
  assert.match(searchApi, /ESCAPE/);
  assert.match(settingsApi, /workspace_settings/);
  assert.match(settingsApi, /review-first/);
  assert.match(ruleApi, /export async function PATCH/);
  assert.match(ruleApi, /export async function DELETE/);
  assert.match(replyApi, /sent: false/);
  assert.match(replyApi, /validateTestRecipient/);
  assert.match(gmail, /createReplyDraft/);
  assert.match(gmail, /getReplyContext/);
  assert.match(manifest, /"display": "standalone"/);
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

test("wires prototype controls and exposes an honest Workspace readiness check", async () => {
  const [app, workspaceApi, envExample, testGuide] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("app/api/v1/google-workspace/route.ts"),
    read(".env.example"), read("docs/testing-and-google-workspace-setup.md"),
  ]);
  assert.match(app, /workspace-search/);
  assert.match(app, /setNotificationsOpen/);
  assert.match(app, /onAdvance\(lead\.id\)/);
  assert.match(app, /ShiftModal/);
  assert.match(app, /Connected Gmail/);
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
  assert.match(app, /Temporary Drive folder configured/);
  assert.match(app, /Move the workspace to a company Shared Drive/);
  assert.match(app, /Personal test mode/);
  assert.match(envExample, /GOOGLE_TEST_TOKEN_ENCRYPTION_KEY/);
  assert.match(envExample, /GOOGLE_TEST_DRIVE_MODE/);
  assert.match(envExample, /GOOGLE_PRODUCTION_DRIVE_MODE/);
  assert.match(envExample, /GOOGLE_TEST_CLIENT_APPOINTMENTS_CALENDAR_ID/);
  assert.match(testGuide, /Test the prototype before connecting company data/);
});

test("keeps personal Google testing isolated from company production", async () => {
  const [oauth, drive, auth, chatAuth, projectsApi, projectDriveApi, schema, guide] = await Promise.all([
    read("app/lib/google-oauth.ts"), read("app/lib/google-drive.ts"), read("app/lib/workspace-auth.ts"),
    read("app/chatgpt-auth.ts"), read("app/api/v1/projects/route.ts"), read("app/api/v1/projects/[projectId]/drive/route.ts"),
    read("db/schema.ts"), read("docs/testing-and-google-workspace-setup.md"),
  ]);
  assert.match(oauth, /GOOGLE_CONNECTION_ENVIRONMENT/);
  assert.match(oauth, /AES-GCM/);
  assert.match(oauth, /code_challenge_method/);
  assert.match(oauth, /GOOGLE_REVOCATION_URL/);
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
  assert.match(guide, /External\*\* OAuth consent screen in \*\*Testing/);
  assert.match(guide, /company-owned Google Cloud project and OAuth client/);
});

test("provides explicit, test-only Gmail and Calendar controls", async () => {
  const [oauth, gmail, gmailHelper, gmailLabel, gmailSend, calendar, calendarHold, app, guide] = await Promise.all([
    read("app/lib/google-oauth.ts"), read("app/lib/google-gmail.ts"),
    read("app/api/v1/integrations/google/gmail/_route-helpers.ts"),
    read("app/api/v1/integrations/google/gmail/messages/[messageId]/label/route.ts"),
    read("app/api/v1/integrations/google/gmail/send-test/route.ts"),
    read("app/lib/google-calendar-client.ts"),
    read("app/api/v1/integrations/google/calendar/test-hold/route.ts"),
    read("app/FloorOpsApp.tsx"), read("docs/testing-and-google-workspace-setup.md"),
  ]);
  assert.match(oauth, /ENABLED_SERVICES/);
  assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
  assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/calendar\.events/);
  assert.match(gmailHelper, /assertGoogleTestService\(config, "gmail"\)/);
  assert.match(gmailHelper, /getGoogleAccessToken\(config, "gmail"\)/);
  assert.match(gmail, /expectedGoogleEmails\.includes\(recipient\)/);
  assert.match(gmailLabel, /inbox_retained=true/);
  assert.match(gmailSend, /requireSameOrigin/);
  assert.match(calendar, /visibility: "private"/);
  assert.match(calendar, /attendees=none/);
  assert.match(calendarHold, /requireSameOrigin/);
  assert.match(app, /Gmail & Calendar test controls/);
  assert.match(app, /Send self-test email/);
  assert.match(app, /Create test hold/);
  assert.match(guide, /GOOGLE_TEST_ENABLED_SERVICES=drive,gmail,calendar/);
});

test("files Gmail only after an explicit single-project review", async () => {
  const [app, schema, gmail, drive, filingRoute] = await Promise.all([
    read("app/FloorOpsApp.tsx"), read("db/schema.ts"), read("app/lib/google-gmail.ts"),
    read("app/lib/google-drive.ts"), read("app/api/v1/integrations/google/gmail/messages/[messageId]/file/route.ts"),
  ]);
  assert.match(app, /File to project/);
  assert.match(app, /GmailFilingModal/);
  assert.match(app, /Copy email \+ \$/);
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
