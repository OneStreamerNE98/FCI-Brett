# Action: Configure Google Cloud and OAuth

Owner: Google Workspace/Cloud administrator

Status: Not started

Depends on: [Setup inputs](00-setup-inputs.md) and [Workspace resources](01-workspace-resources.md)

## Google Cloud project

- [ ] Create `FCI Operations Production` under the company Google Cloud organization.
- [ ] Create separate development/staging projects before testing production credentials in development.
- [ ] Enable the Google Drive, Gmail, Calendar, and Sheets APIs.
- [ ] Leave Pub/Sub disabled until its background processing is implemented.

## Google Auth platform

- [ ] Configure branding for `FCI Operations` with a monitored company support address.
- [ ] Set the audience to **Internal**.
- [ ] Add approved application, privacy, and terms URLs before wider distribution.

## OAuth client 1: company data connector

- [ ] Create a Web application client named `FCI Operations Workspace Connector`.
- [ ] Add this authorized redirect URI exactly:

  `https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback`

- [ ] Configure the requested scopes: `openid`, `email`, Drive, `gmail.modify`, `calendar.events`, and Sheets.
- [ ] Store the client ID in the hosted configuration.
- [ ] Store the client secret only in encrypted hosted secret storage.

## OAuth client 2: employee login

Do not reuse the broad data-connector client for employee sign-in.

- [ ] Create this client after the production hostname is known.
- [ ] Request only `openid email profile`.
- [ ] Add only the approved production and development origins/callbacks.
- [ ] Keep it disconnected from Gmail, Drive, Calendar, and Sheets authorization.

## Google Admin API controls

- [ ] In **Security → Access and data control → API controls**, locate the data-connector client ID.
- [ ] Mark it Trusted or grant Specific Google data for the exact required services.
- [ ] Limit the setting to the organizational unit or group that needs it.
- [ ] Do not configure domain-wide delegation for the pilot.

## Completion result

This action is complete when the Internal application and data-connector client exist, the exact callback is accepted, API Controls trust is scoped, and the client secret is stored outside GitHub.
