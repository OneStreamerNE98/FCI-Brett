# Testing and Google Workspace setup

## 1. Test the prototype before connecting company data

Use disposable test records first. The prototype now supports the following safe checks without sending email, modifying Gmail, or creating Google Drive files:

1. Add a test client, then create two independent projects for that client. Refresh and confirm the client code and project numbers stay consistent.
2. Open **Leads** and advance a lead through the pipeline. Confirm the column counts move with it.
3. Open **Projects**, switch between Active, Planning, Closeout, and Archived, and toggle the project-manager filter.
4. Use the top search field (or `Ctrl/Cmd + K`) to open a client or project.
5. Open **Schedule**, create a draft shift, open an assignment, acknowledge it, and resolve the displayed conflict.
6. Open **Inbox**, select messages, review them, and either record an approval or send them to review. These decisions are deliberately local until Gmail and Drive are connected.
7. Open **AI Assistant**, change the project context, ask a question, and open each source reference.
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

Use only sample/test messages and documents. Do not use the account's My Drive root, share this temporary folder widely, or upload live client records. The Drive-only test connection does not request Gmail, Calendar, or Sheets scopes, and Gmail filing remains disabled.

For personal Gmail testing, create a separate test label and use only messages you send to yourself. The email-review screen can be tested with its built-in sample messages now. Real Gmail reading, labeling, `.eml` archiving, and attachment copy are a later, separately authorized milestone—there is no switch that enables those actions in this release.

### Promote to company production later

When testing is complete, create a **separate** company Google OAuth client and company Shared Drive, then add the `GOOGLE_PRODUCTION_*` values and set `GOOGLE_CONNECTION_ENVIRONMENT=production`. Authorize the company Google account from the app. Do not overwrite the personal test connection or reuse its client secret, refresh token, or folder IDs.

## 3. Create two Google Cloud authorization applications

Keep the two OAuth configurations separate from the start. Google recommends separate projects for testing and production when restricted scopes are involved.

### Personal test application

1. Create a Google Cloud project just for testing and enable the **Drive API** only.
2. Create an **External** OAuth consent screen in **Testing** status and add your personal Gmail address as a test user. An Internal consent screen cannot authorize a personal Gmail account.
3. Create a **Web application** OAuth client and add the exact callback URL:

   `https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback`

4. Request only `openid`, `email`, and the Drive scope used by the app. The first Drive-only authorization does not need Gmail, Calendar, Sheets, or Pub/Sub APIs.

An External app in Testing will normally require reauthorization after seven days when it uses Drive access. That is expected for this temporary personal test profile.

### Company production application

1. Create a separate company-owned Google Cloud project and OAuth client.
2. Use an **Internal** consent screen for the company's Workspace domain, and have the Workspace administrator approve the client and required scopes.
3. Use a company-owned custom domain for the production site and register its exact HTTPS callback URL. Do not rely on the temporary `chatgpt.site` address for a production OAuth deployment.
4. Start with the same Drive-only scopes. Add Gmail, Calendar, Sheets, and Pub/Sub incrementally only when their adapters, webhooks, and permission tests are complete.

## 4. Add hosted configuration values

Add these as hosted environment values/secrets, never to source control or chat:

- `FCI_ADMIN_EMAILS`
- `GOOGLE_CONNECTION_ENVIRONMENT` (`test` initially)
- `GOOGLE_TEST_CLIENT_ID`
- `GOOGLE_TEST_CLIENT_SECRET` (secret)
- `GOOGLE_TEST_OAUTH_REDIRECT_URI`
- `GOOGLE_TEST_TOKEN_ENCRYPTION_KEY` (secret, exactly 32 bytes encoded as base64url)
- `GOOGLE_TEST_DRIVE_MODE=my-drive`
- `GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_TEST_AUTHORIZED_ACCOUNT_EMAILS` (your approved personal Google account)
- `GOOGLE_TEST_MY_DRIVE_BROAD_SCOPE_ACKNOWLEDGED=true` after you understand the test scope
- `GOOGLE_TEST_DRIVE_PROVISIONING_ENABLED=true` only after the app verifies the test root
- `GOOGLE_TEST_CLIENT_DIRECTORY_SHEET_ID` (reference only until Sheet sync is added)
- `GOOGLE_TEST_INTAKE_MAILBOX`, `GOOGLE_TEST_CLIENT_APPOINTMENTS_CALENDAR_ID`, `GOOGLE_TEST_FIELD_SCHEDULE_CALENDAR_ID`, and `GOOGLE_TEST_PUBSUB_TOPIC` (reserved for later separate integration work)

Use **Settings → Google Workspace → Check readiness** to confirm that the prototype has all configuration values. A green status there means only that configuration is present; it does not authorize access to Google data.

## 5. What is available now and what comes next

The current release includes a protected Drive-only OAuth flow: an approved administrator can connect the active profile, verify its root folder, and explicitly create an independent client/project folder tree. Refresh tokens are encrypted and test/production folder mappings stay separate.

Gmail watch handling, Gmail filing, Sheet synchronization, Calendar synchronization, and live SMS are still not enabled. They need their own least-privilege scope requests, explicit user approval, signed webhook processing, idempotency checks, and permission tests before real company data is used.

The first real Gmail test should use the personal test profile, a self-sent test message, and a dedicated test label. Company Gmail must wait for the separate company production OAuth client and security review.
