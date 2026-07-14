# Task checklist: Configure Google Cloud and OAuth

Owner: Google Workspace/Cloud administrator

Status: Not started

Depends on: [Setup inputs](00-setup-inputs.md) and [Workspace resources](01-workspace-resources.md)

## Google Cloud projects

- [ ] Confirm the company Cloud organization/billing account and approved names for separate development, staging, and production projects.
- [ ] Create `FCI Operations Development` for the current one-user test connector.
- [ ] Keep staging and production clients, secrets, callbacks, and resources isolated; never reuse development credentials in production.
- [ ] Enable the Google Drive, Gmail, Calendar, and Sheets APIs in the development project.
- [ ] Leave Pub/Sub disabled until its background processing is implemented.

## Google Auth platform

- [ ] Configure branding for `FCI Operations` with a monitored company support address.
- [ ] Set the audience to **Internal**.
- [ ] Confirm Google Auth platform treats the application as **Internal**. Do not add test users or follow the External **Testing**/**In production** publishing workflow; if **Internal** is unavailable, stop and attach the project to the company Cloud organization.
- [ ] Keep explicit application invitations and disabled-user checks; Internal audience does not limit access to the intended 20 employees by itself.
- [ ] Add approved application, privacy, and terms URLs before wider distribution.

## OAuth client 1: company data connector

- [ ] In the development project, create a Web application client named `FCI Operations Workspace Connector — Development`.
- [ ] Add this development authorized redirect URI exactly:

  `https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback`

- [ ] Configure the requested scopes: `openid`, `email`, Drive, `gmail.modify`, `calendar.events`, and Sheets.
- [ ] Store the client ID in the hosted configuration.
- [ ] Store the client secret only in encrypted hosted secret storage.
- [ ] Create the production data-connector client only after the production hostname is approved; give it only the exact production HTTPS callback and never add the Sites development callback.

## OAuth client 2: employee login

Do not reuse the broad data-connector client for employee sign-in.

- [ ] Create a development employee-login client only when development staff login is scheduled; add only the approved development origins and callbacks.
- [ ] Create a separate production employee-login client after the production hostname is known; add only the exact production origins and callbacks.
- [ ] Request only `openid email profile` for each employee-login client.
- [ ] Keep both employee-login clients disconnected from Gmail, Drive, Calendar, and Sheets authorization.

## Google Admin API controls

- [ ] In **Security → Access and data control → API controls**, locate the data-connector client ID.
- [ ] Mark it Trusted or grant Specific Google data for the exact required services.
- [ ] Limit the setting to the organizational unit or group that needs it.
- [ ] Do not configure domain-wide delegation for the development environment.

## Completion result

The development portion of this action is complete when the Internal development application and data-connector client exist, the exact development callback is accepted, API Controls trust is scoped, and the client secret is stored outside GitHub. Production remains incomplete until its separately approved project, hostname, client, callback, and secret storage exist.
