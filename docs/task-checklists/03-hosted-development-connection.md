# Task checklist: Configure and connect the hosted development environment

Owner: Business owner and Codex/developer

Status: Connection not established; Workspace resource and OAuth verification remain pending. The last direct Settings check was on private Sites development version 37 on July 18, 2026; PR #32 at `adc79b8` is the current private Sites development version 40 baseline. The intervening releases did not connect Workspace or change its hosted credentials.

Depends on: [Workspace resources](01-workspace-resources.md) and [Google Cloud/OAuth](02-google-cloud-and-oauth.md)

The last direct Settings check reported **Workspace connection: Not connected**. Add these values to the ChatGPT Sites project's runtime environment settings only after the resource and OAuth prerequisites are approved; never add them to GitHub or `.openai/hosting.json`. A saved Sites version must be deployed separately before an environment-setting change takes effect.

## Non-secret hosted values

```dotenv
GOOGLE_INTEGRATION_MODE=workspace
GOOGLE_WORKSPACE_ENABLED_SERVICES=drive,gmail,calendar,sheets
GOOGLE_WORKSPACE_CLIENT_ID=<data-connector-client-id>
GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI=https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION=1
GOOGLE_WORKSPACE_ALLOWED_DOMAINS=cherryhillfci.com
GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS=<operations-account@cherryhillfci.com>
GOOGLE_WORKSPACE_SHARED_DRIVE_ID=<shared-drive-id>
GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED=false
# Optional legacy/first-boot fallback; leave unset for app-managed spreadsheet setup
GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID=<existing-spreadsheet-id>
GOOGLE_WORKSPACE_INTAKE_MAILBOX=<operations-account@cherryhillfci.com>
GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID=<calendar-id>
GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID=<calendar-id>
```

Keep the current ChatGPT development identity separately allowlisted through `FCI_OFFICE_EMAILS` and `FCI_ADMIN_EMAILS` until employee Google login is implemented.

When Gmail is enabled, `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS` must contain exactly one account and `GOOGLE_WORKSPACE_INTAKE_MAILBOX` must be that same address. Gmail operates as the connected account (`users/me`); the application does not use domain-wide delegation to read another mailbox, and readiness fails closed when the two values differ. PR #32 merged that safeguard at `adc79b8`, and the exact commit is included in private Sites development version 40. The connection remains unconfigured, so the future per-service acceptance run must still capture live evidence.

## Secret hosted values

Enter these in the same ChatGPT Sites runtime environment settings and mark both as secrets. Secret Manager is reserved for the future Google Cloud production environment.

- [ ] `GOOGLE_WORKSPACE_CLIENT_SECRET`
- [ ] `GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY` — a random 32-byte base64url value

Do not paste either value into GitHub, documentation, email, Drive, screenshots, or chat.

## Connect and verify

- [ ] Deploy the hosted configuration with Drive provisioning disabled.
- [ ] Open **Settings → Google Workspace → Check readiness**.
- [ ] Resolve every OAuth, identity, domain, and mailbox prerequisite. Resource-ID rows
      may remain unset until the app-managed Resources actions run.
- [ ] Select **Connect Google Workspace** and authorize the exact approved operations account.
- [ ] Verify the Shared Drive.
- [ ] In Resources, ensure the Shared Drive root folders and then ensure the blueprint spreadsheets.
- [ ] Prepare Gmail labels and list test messages.
- [ ] List Calendar events and create a test hold.
- [ ] Confirm the directory row is app-managed (or explicitly labeled environment fallback), then run the Google Sheets mirror.
- [ ] Only after Drive verification, enable Drive provisioning and deploy the setting change.
- [ ] Create one test project folder and confirm it is inside the correct Shared Drive.

## Completion result

This action is complete when all four services show connected and the test folder, message copy, draft, calendar hold, and Sheet mirror use only `FCI TEST — DO NOT USE` records.
