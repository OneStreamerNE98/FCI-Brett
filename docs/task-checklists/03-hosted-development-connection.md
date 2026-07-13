# Task checklist: Configure and connect the hosted development environment

Owner: Business owner and Codex/developer

Status: Blocked by Workspace resources and OAuth client

Depends on: [Workspace resources](01-workspace-resources.md) and [Google Cloud/OAuth](02-google-cloud-and-oauth.md)

The live Settings page currently reports the company Workspace connection as not configured. Add these values to the hosting platform, never to GitHub.

## Non-secret hosted values

```dotenv
GOOGLE_INTEGRATION_MODE=workspace
GOOGLE_WORKSPACE_ENABLED_SERVICES=drive,gmail,calendar,sheets
GOOGLE_WORKSPACE_CLIENT_ID=<data-connector-client-id>
GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI=https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION=1
GOOGLE_WORKSPACE_ALLOWED_DOMAINS=cherryhillfci.com
GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS=<operations-account>
GOOGLE_WORKSPACE_SHARED_DRIVE_ID=<shared-drive-id>
GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED=false
GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID=<spreadsheet-id>
GOOGLE_WORKSPACE_INTAKE_MAILBOX=<operations-account>
GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID=<calendar-id>
GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID=<calendar-id>
```

Keep the current ChatGPT development identity separately allowlisted through `FCI_OFFICE_EMAILS` and `FCI_ADMIN_EMAILS` until employee Google login is implemented.

## Secret hosted values

- [ ] `GOOGLE_WORKSPACE_CLIENT_SECRET`
- [ ] `GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY` — a random 32-byte base64url value

Do not paste either value into GitHub, documentation, email, Drive, screenshots, or chat.

## Connect and verify

- [ ] Deploy the hosted configuration with Drive provisioning disabled.
- [ ] Open **Settings → Google Workspace → Check readiness**.
- [ ] Resolve every missing item.
- [ ] Select **Connect Google Workspace** and authorize the exact approved operations account.
- [ ] Verify the Shared Drive.
- [ ] Prepare Gmail labels and list test messages.
- [ ] List Calendar events and create a test hold.
- [ ] Run the Google Sheets mirror.
- [ ] Only after Drive verification, enable Drive provisioning and deploy the setting change.
- [ ] Create one test project folder and confirm it is inside the correct Shared Drive.

## Completion result

This action is complete when all four services show connected and the test folder, message copy, draft, calendar hold, and Sheet mirror use only `FCI TEST — DO NOT USE` records.
