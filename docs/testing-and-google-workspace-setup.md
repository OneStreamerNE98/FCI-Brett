# Testing and Google Workspace setup

## 1. Test the prototype before connecting company data

Use disposable test records first. The prototype now supports the following safe checks without sending email, modifying Gmail, or creating Google Drive files:

1. Add a test client, then create two independent projects for that client. Refresh and confirm the client code and project numbers stay consistent. In **Settings → Client Directory**, run **Sync now** and confirm the Client Directory and Project Register tabs match the app.
2. Open **Leads** and advance a lead through the pipeline. Confirm the column counts move with it.
3. Open **Projects**, switch between Active, Planning, Closeout, and Archived, and toggle the project-manager filter.
4. Use the top search field (press `Enter`, click the search button, or use `Ctrl/Cmd + K`) to find and open a client, contact, or project.
5. Open **Schedule**, create a draft shift, open an assignment, acknowledge it, and resolve the displayed conflict.
6. Open **Inbox** and confirm it identifies the approved Google test account. Select a mailbox and click **Load messages** to request no more than 20 message summaries. Use **Review & file** only with a sample message, choose the project, inspect the preview, and explicitly confirm before Gmail labels or Drive copies are changed.
7. Open **AI Assistant**, choose a project, ask a question, and open each cited source reference. The first release is intentionally grounded in saved project, client, contact, activity, and archived-email metadata—not raw Drive documents, transcript contents, or a semantic document index.
8. In **Settings → Testing & launch**, work through the displayed checklist.

Do not use real client documents, a live mailbox, or crew schedules for these tests yet.

## 2. Prepare Google Workspace

For the production workspace, your Google Workspace administrator should create or identify these company-owned resources:

- Shared Drive: `FCI Operations`
- Google Sheet: `Client Directory`, inside `00_Company Admin`
- Dedicated project-intake Gmail mailbox
- Calendar: `Client Appointments`
- Calendar: `Field Schedule`
- Google Groups for office staff, project managers, and field leads

Keep each project under `02_Projects`, not inside its client folder. The client folder is for account-level material and project shortcuts only.

### Personal test profile

For a safe early prototype, use your personal Google account with one empty My Drive folder dedicated to FCI Operations and put the same structure inside it. Configure the hosted site with `GOOGLE_CONNECTION_ENVIRONMENT=test`, the `GOOGLE_TEST_*` values, and the new Client Directory Sheet ID.

The active hosted test profile is the personal Gmail profile; it is not a company Workspace connection. If **Settings → Google connections → Check readiness** says that the Google OAuth client ID or client secret is missing, the hosted app cannot start Google authorization yet. Add `GOOGLE_TEST_CLIENT_ID` and the secret `GOOGLE_TEST_CLIENT_SECRET` in the hosting provider's secure runtime settings, keep the existing token-encryption secret in place, then run the readiness check again. Do not paste a client secret into chat or source control. Once readiness is complete, select **Connect personal test Google** and approve the connection while signed in to the approved personal Gmail account.

Use only sample/test messages and documents. Do not use the account's My Drive root, share this temporary folder widely, or upload live client records. The personal test profile can request Drive, Sheets, Gmail, and Calendar scopes together when you deliberately set `GOOGLE_TEST_ENABLED_SERVICES=drive,gmail,calendar,sheets` and reconnect.

For personal Gmail testing, use only messages you send to yourself. The Inbox deliberately does not load mail automatically: it first checks the approved Google connection, then requires an explicit **Load messages** action. It can prepare the three FCI test labels, show a small bounded inbox view, create a self-test email, save a reply as an unsent Gmail draft, and apply `FCI/Filed` only after you click the action. It does not automatically archive, remove `INBOX`, or file mail into a project folder. The app sign-in name and the connected Google account are displayed separately; they are not assumed to be the same identity.

Use **Settings → Inbox & file rules** to manage the simple review-first filing rules. Keep Gmail to three broad labels—`FCI/Intake`, `FCI/Needs Review`, and `FCI/Filed`—and let the selected project Drive folder be the permanent location. Project-number matches can be suggested, but a client with multiple projects must always be reviewed and assigned to the exact project before filing.

For personal Calendar testing, the app reads a bounded upcoming window from your primary calendar and can create one private, attendee-free 30-minute test hold. It does not invite clients or change existing events.

### Promote to company production later

When testing is complete, create a **separate** company Google OAuth client and company Shared Drive, then add the `GOOGLE_PRODUCTION_*` values and set `GOOGLE_CONNECTION_ENVIRONMENT=production`. Authorize the company Google account from the app. Do not overwrite the personal test connection or reuse its client secret, refresh token, or folder IDs.

## 3. Create two Google Cloud authorization applications

Keep the two OAuth configurations separate from the start. Google recommends separate projects for testing and production when restricted scopes are involved.

### Personal test application

1. Create a Google Cloud project just for testing and enable the **Drive API**, **Google Sheets API**, **Gmail API**, and **Google Calendar API**.
2. Create an **External** OAuth consent screen in **Testing** status and add your personal Gmail address as a test user. An Internal consent screen cannot authorize a personal Gmail account.
3. Create a **Web application** OAuth client and add the exact callback URL:

   `https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback`

4. Set `GOOGLE_TEST_ENABLED_SERVICES=drive,gmail,calendar,sheets` in the hosted site, then reconnect. The test authorization requests `openid`, `email`, Drive, Sheets, `gmail.modify`, and `calendar.events`. Gmail access is restricted, so keep this External app in Testing and use only the personal Gmail account listed as a test user.

An External app in Testing will normally require reauthorization after seven days when it uses Drive access. That is expected for this temporary personal test profile.

### Company production application

1. Create a separate company-owned Google Cloud project and OAuth client.
2. Use an **Internal** consent screen for the company's Workspace domain, and have the Workspace administrator approve the client and required scopes.
3. Use a company-owned custom domain for the production site and register its exact HTTPS callback URL. Do not rely on the temporary `chatgpt.site` address for a production OAuth deployment.
4. Start with Drive and Sheets for the generated directory mirror. Add Gmail, Calendar, and Pub/Sub incrementally only when their adapters, webhooks, and permission tests are complete.

## 4. Add hosted configuration values

Add these as hosted environment values/secrets, never to source control or chat:

- `FCI_ADMIN_EMAILS`
- `GOOGLE_CONNECTION_ENVIRONMENT` (`test` initially)
- `GOOGLE_TEST_ENABLED_SERVICES=drive,gmail,calendar,sheets`
- `GOOGLE_TEST_CLIENT_ID`
- `GOOGLE_TEST_CLIENT_SECRET` (secret)
- `GOOGLE_TEST_OAUTH_REDIRECT_URI`
- `GOOGLE_TEST_TOKEN_ENCRYPTION_KEY` (secret, exactly 32 bytes encoded as base64url)
- `GOOGLE_TEST_DRIVE_MODE=my-drive`
- `GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_TEST_AUTHORIZED_ACCOUNT_EMAILS` (your approved personal Google account)
- `GOOGLE_TEST_MY_DRIVE_BROAD_SCOPE_ACKNOWLEDGED=true` after you understand the test scope
- `GOOGLE_TEST_DRIVE_PROVISIONING_ENABLED=true` only after the app verifies the test root
- `GOOGLE_TEST_CLIENT_DIRECTORY_SHEET_ID` (the existing Client Directory spreadsheet ID)
- `GOOGLE_TEST_INTAKE_MAILBOX`, `GOOGLE_TEST_CLIENT_APPOINTMENTS_CALENDAR_ID`, `GOOGLE_TEST_FIELD_SCHEDULE_CALENDAR_ID`, and `GOOGLE_TEST_PUBSUB_TOPIC` (reserved for later separate integration work)

Use **Settings → Google Workspace → Check readiness** to confirm that the prototype has all configuration values. A green status there means only that configuration is present; it does not authorize access to Google data.

## 5. Use the hosted app on a phone

Do not copy this site into Google Drive. Drive stores project files; the phone-friendly app is the hosted website itself. Open `https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/` on the phone, sign in to the same account that has access to the private site, and add it to the home screen:

- **Android:** open the site in Chrome, tap the three-dot menu, then choose **Install app** or **Add to Home screen**.
- **iPhone/iPad:** open the site in Safari, tap **Share**, then **Add to Home Screen**, turn on **Open as Web App**, and tap **Add**.

The same instructions are shown in **Settings → Data & security → Use FCI Operations like a phone app**. Installation creates a shortcut/app window but does not make the site available offline or bypass the site's sign-in protection.

## 6. What is available now and what comes next

The current release includes a protected personal-test OAuth flow: an approved administrator can connect Drive, Sheets, Gmail, and Calendar together, verify the dedicated Drive root, explicitly create an independent client/project folder tree, sync an app-owned Project Register plus the protected Client Directory fields, prepare test Gmail labels, send a self-test message, and create a private calendar test hold. Refresh tokens are encrypted and test/production folder mappings stay separate.

Automatic Gmail watches, two-way production calendar synchronization, live SMS, and spreadsheet-to-app import are still not enabled. The current Sheets mirror is one-way: the app is authoritative, the Client Directory preserves its Account Notes column, and the generated Project Register is rebuilt from app data. These remaining integrations need their own least-privilege scope requests, explicit user approval, signed webhook processing, idempotency checks, and permission tests before real company data is used.

The first real Gmail test should use the personal test profile, a self-sent test message, and a dedicated test label. Company Gmail and Calendar must wait for the separate company production OAuth client and security review.
