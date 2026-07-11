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

Your Google Workspace administrator should create or identify these company-owned resources:

- Shared Drive: `FCI Operations`
- Google Sheet: `Client Directory`, inside `00_Company Admin`
- Dedicated project-intake Gmail mailbox
- Calendar: `Client Appointments`
- Calendar: `Field Schedule`
- Google Groups for office staff, project managers, and field leads

Keep each project under `02_Projects`, not inside its client folder. The client folder is for account-level material and project shortcuts only.

## 3. Create the Google Cloud authorization application

1. Create separate Google Cloud projects for testing and production.
2. Enable the Drive, Gmail, Sheets, Calendar, and Pub/Sub APIs.
3. Configure an **Internal** OAuth consent screen for your Workspace domain.
4. Create a Web application OAuth client and add this exact production callback URL when the OAuth feature is implemented:

   `https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback`

5. Ask the Workspace administrator to approve the app and the least-privilege scopes. Gmail mailbox access is sensitive; do not request more than the intake workflow needs.
6. Create a Pub/Sub topic for Gmail intake notifications. Gmail watches must be renewed before their seven-day expiry.

## 4. Add hosted configuration values

Add these as hosted environment values/secrets, never to source control or chat:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET` (secret)
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY` (secret, high-entropy)
- `GOOGLE_SHARED_DRIVE_ID`
- `GOOGLE_CLIENT_DIRECTORY_SHEET_ID`
- `GOOGLE_INTAKE_MAILBOX`
- `GOOGLE_CLIENT_APPOINTMENTS_CALENDAR_ID`
- `GOOGLE_FIELD_SCHEDULE_CALENDAR_ID`
- `GOOGLE_PUBSUB_TOPIC`

Use **Settings → Google Workspace → Check readiness** to confirm that the prototype has all configuration values. A green status there means only that configuration is present; it does not authorize access to Google data.

## 5. What remains before real Google data can be connected

The current release provides the client/project data model, a safe review-first inbox workflow, and a configuration preflight. It does not yet include a production OAuth callback, encrypted refresh-token storage, Google API adapter, Gmail watch handler, Calendar sync worker, or role enforcement for API mutations.

Build and test those controls before authorizing the application against a live mailbox or Shared Drive. The first live integration test should use a test mailbox and a non-production Shared Drive folder.
