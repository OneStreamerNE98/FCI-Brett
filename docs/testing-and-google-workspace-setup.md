# Testing and Google Workspace setup

## What Google Cloud and Google Workspace do

Google Cloud and Google Workspace are separate products. Google Cloud supplies the API project and OAuth credentials. Google Workspace supplies managed company accounts, Gmail, Calendar, Shared Drives, Sheets, and the Admin console. Creating a Google Cloud project does not create a Workspace organization.

## Local Workspace simulation

Local development requires no Google account, domain, or OAuth credentials. Use:

```dotenv
FCI_LOCAL_DEV_USER_EMAIL=you@example.com
FCI_ADMIN_EMAILS=you@example.com
GOOGLE_INTEGRATION_MODE=simulation
```

Start the app with `npm.cmd run dev` on Windows and open `http://localhost:3000`.

Simulation provides:

- Seeded Workspace Gmail messages, FCI labels, local reply drafts, and review-first filing.
- Seeded shared-calendar events and locally stored appointment holds.
- Simulated Shared Drive project folders and email archive destinations.
- A simulated Client Directory and Project Register Sheet mirror.
- A reset action under **Settings → Google Workspace**.

Simulation creates no Google OAuth attempt, refresh token, API request, email, calendar event, Drive file, or spreadsheet update. Use only non-production client/project records while validating the prototype.

## Local lifecycle test

1. Add a client and create two independent projects for that client.
2. Create a simulated Shared Drive workspace for each project.
3. Open Inbox, load sample mail, search by project number, and review a filing suggestion.
4. Save a reply draft and confirm it remains simulated.
5. File one sample email to the exact project and confirm Inbox is retained.
6. Load shared-calendar events and create a simulated hold.
7. Sync the simulated Client Directory and Project Register.
8. Add and acknowledge a draft shift.
9. Ask the project assistant a question and inspect every returned source.
10. Reset simulation data and confirm the seeded mailbox and calendars return.

## Live Google Workspace prerequisites

Use a Google Workspace Business trial or subscription when real integration testing begins. A Google Cloud project alone is insufficient.

Before switching modes:

- Verify a company-controlled domain in Google Workspace.
- Create the company users and select an administrator connection account.
- Create a Shared Drive named `FCI Operations`.
- Create `FCI • Client Appointments` and `FCI • Field Schedule` calendars.
- Create the Client Directory spreadsheet and choose the intake mailbox.
- Enable Drive, Gmail, Calendar, Sheets, and Pub/Sub APIs in the Google Cloud project.
- Configure the OAuth consent screen and a Web application OAuth client.
- Register the exact HTTPS callback URL for the deployed application.
- Keep client secrets and token-encryption keys in secure runtime settings, never source control.

Use these live settings:

```dotenv
GOOGLE_INTEGRATION_MODE=workspace
GOOGLE_WORKSPACE_ENABLED_SERVICES=drive,gmail,calendar,sheets
GOOGLE_WORKSPACE_CLIENT_ID=
GOOGLE_WORKSPACE_CLIENT_SECRET=
GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI=
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY=
GOOGLE_WORKSPACE_ALLOWED_DOMAINS=
GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS=
GOOGLE_WORKSPACE_SHARED_DRIVE_ID=
GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED=false
GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID=
GOOGLE_WORKSPACE_INTAKE_MAILBOX=
GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID=
GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID=
```

Connect Workspace, verify the Shared Drive, then enable Drive provisioning. The application rejects consumer domains that are not listed in `GOOGLE_WORKSPACE_ALLOWED_DOMAINS`.

## Launch boundary

The simulator verifies application workflows, not Google's permissions, quotas, delivery, webhook behavior, or administrator policies. Complete real Workspace integration tests with non-production company records before staff use.
