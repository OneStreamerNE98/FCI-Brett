# Task checklist: Configure Google Cloud and OAuth

Owner: Google Workspace/Cloud administrator

Status: Company-account project candidate reported by Brett; Google Cloud verification pending

Depends on: [Setup inputs](00-setup-inputs.md) and [Workspace resources](01-workspace-resources.md)

## Reported project candidate verification

Brett reports that a project was created with the company's managed Google Workspace account. Treat it as a project candidate until the Google Cloud identifiers, parent organization, development purpose, IAM, billing status, and API inventory are verified. Google normally places a managed user's Cloud project under the associated company organization, but “Google Workspace project” is not the formal Cloud resource name.

- [ ] Select Brett's reported project candidate. `FCI Operations Development` is the recommended display name; if Brett used a different name, record the actual identifiers and confirm the intended use rather than creating a duplicate.
- [ ] In **IAM & Admin → Manage resources**, confirm its parent is the `cherryhillfci.com` company organization or an approved folder beneath it—not **No organization**.
- [ ] Record the non-secret project display name, immutable project ID, numeric project number, parent organization, and billing-linked `yes`/`no` status in the approved configuration inventory.
- [ ] Confirm the project is development-only for the one-user test connector, not a production project.
- [ ] Confirm Brett used a managed company account and that company-controlled individuals administer the project. Flag personal Gmail accounts, unknown principals, unexpected service accounts, and broad basic roles for review.
- [ ] Confirm whether an active company-controlled Cloud Billing account is linked and who owns the billing relationship. A billing link is not authorization to provision resources.
- [ ] Inventory enabled APIs without changing them. Confirm Drive, Gmail, Calendar, and Sheets are enabled or still need enabling, and confirm Pub/Sub is disabled.
- [ ] Check whether `FCI Operations Workspace Connector — Development` already exists before creating a client. Never expose, download, or share an existing client secret during inventory.

Do not place OAuth secrets, credential JSON, service-account keys, tokens, payment details, or production data in this checklist. The project name, project ID, project number, organization parent, and billing-linked yes/no status are safe non-secret identifiers.

## Inventory-only owner checkpoint

Complete the section above as a read-only inventory, then stop and report the non-secret facts to the owner. Until the owner approves the exact follow-up changes:

- Do not enable or disable APIs.
- Do not change IAM, organization policy, billing links, budgets, or alert recipients.
- Do not change Google Auth branding, audience, scopes, clients, callbacks, or secrets.
- Do not change Google Admin API Controls or create domain-wide delegation.

The remaining checkboxes describe the approved setup path, but they are not authorization to perform external writes.

## Project policy and API setup

- [ ] Confirm the company Cloud organization/billing account and approved names for the development, staging, and production boundaries.
- [x] Keep staging and production clients, secrets, callbacks, and resources isolated; never reuse development credentials in production.
- [ ] Enable the Google Drive, Gmail, Calendar, and Sheets APIs in the verified development project if the inventory shows they are missing.
- [x] Keep Pub/Sub disabled until its background processing is implemented.
- [ ] Verify the Pub/Sub API is disabled in the verified development project.

## Google Auth platform

- [ ] Configure branding for `FCI Operations` with a monitored company support address.
- [ ] Set the audience to **Internal**.
- [ ] Confirm Google Auth platform treats the application as **Internal**. Do not add test users or follow the External **Testing**/**In production** publishing workflow; if **Internal** is unavailable, stop and attach the project to the company Cloud organization.
- [ ] Keep explicit application invitations and disabled-user checks; Internal audience does not limit access to the intended 20 employees by itself.
- [ ] Add approved application, privacy, and terms URLs before wider distribution.

## OAuth client 1: company data connector

- [ ] Reuse `FCI Operations Workspace Connector — Development` if the exact development client already exists and passes callback/scope review; otherwise create it in the verified development project.
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

The development portion of this action is complete when the candidate is verified as the company development project; its parent, identifiers, company-controlled administration, billing state, and API inventory are recorded; the owner has approved the exact setup changes; the Internal development application and data-connector client exist; the exact development callback is accepted; API Controls trust is scoped; and the client secret is stored outside GitHub. Production remains incomplete until its separately approved project, hostname, client, callback, and secret storage exist.

## What to report back to Codex

Report only these non-secret facts:

- Project display name, project ID, and project number
- Parent shown in **Manage resources**
- Billing linked: `yes` or `no`
- Company-managed accounts with administrative access
- Whether Drive, Gmail, Calendar, and Sheets are enabled and Pub/Sub is disabled
- Whether the Auth audience already shows **Internal** and whether the development connector client already exists

Do not send a client secret, OAuth JSON, token, API key, service-account key, password, billing-account number, or payment information.

## Official verification references

- [Google Cloud resource hierarchy and Workspace organization association](https://docs.cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy)
- [Verify or change a project's Cloud Billing status](https://docs.cloud.google.com/billing/docs/how-to/modify-project)
- [Enable Google Workspace APIs](https://developers.google.com/workspace/guides/enable-apis)
- [Manage the Google Auth application audience](https://support.google.com/cloud/answer/15549945)
- [Control which apps access Google Workspace data](https://support.google.com/a/answer/7281227)
- [Gmail push notifications and their Pub/Sub requirement](https://developers.google.com/workspace/gmail/api/guides/push)
