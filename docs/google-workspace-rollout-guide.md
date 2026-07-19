# Google Workspace rollout guide for FCI Operations

This guide is written for a first-time Google Workspace administrator. It describes the current one-user development environment and the later company rollout separately.

## Read this distinction first

FCI Operations currently has two different identities:

1. **Application login:** identifies who may open the web application. The hosted development environment currently uses Sign in with ChatGPT and then checks `FCI_OFFICE_EMAILS` or `FCI_OFFICE_DOMAINS`.
2. **Google data connection:** authorizes one administrator-approved Google Workspace account to use Gmail, Calendar, Shared Drive, and Sheets for the company.

Connecting Google Workspace does **not** automatically change the app login to Google. A true “sign in with my company Google account” rollout requires a Google OpenID Connect login implementation in the application.

## Recommended rollout in two stages

### Stage 1: one-user development environment now

- Keep the current app login and allow only your email.
- Connect one company Google Workspace account for Gmail, Calendar, Drive, and Sheets.
- Install the web app on your computer and phone.
- Use non-production test projects until the full launch checklist passes.

### Stage 2: company login and employee rollout

- Replace or supplement ChatGPT sign-in with Google Identity Services/OpenID Connect.
- Validate the signed Google ID token on the server, including its signature, issuer, audience, expiry, and Workspace `hd` domain claim.
- Add application users, roles, and project permissions.
- Publish the application privately through Google Workspace Marketplace or deploy it as a managed Chrome web app.

Google’s OpenID Connect documentation explains that the `hd` request value is only a user-interface hint; the server must verify the returned `hd` claim. See [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Cost-aware production boundary

Reuse the company's existing Workspace subscription for employee accounts, Groups, the operations mailbox, Shared Drive, calendars, Docs, and derived Sheets reporting. This reduces duplicate products and licenses, but Workspace does not replace Cloud SQL, application authorization, security audit, backups, or recovery testing. Sheets is not the transactional database, and AppSheet or Apps Script must not become an unreviewed second system of record.

The current Sites application remains the development environment. Separate Google Cloud project boundaries must be defined, but the development project is the only one needed for the current connector. Staging and production projects are created only after the applicable owner gate; staging billable resources are created only for approved migration, restore, or release exercises, and optional services stay disabled until their features are scheduled. See the accepted [Workspace-first, cost-controlled rollout](architecture-decision-workspace-first-cost-controlled-rollout.md).

## Accounts to create

For development, create or select these accounts:

- **Workspace super administrator:** used for Google Admin and Cloud configuration. Do not use this account as a daily mailbox if a separate administrator is available.
- **FCI Operations connection account:** the one account that grants this app access to Gmail, Calendar, Drive, and Sheets. The proposed address is `operations@cherryhillfci.com`; confirm or create it before configuration.
- **Your normal company account:** your daily Workspace account. For the one-user development environment, this can also be the connection account.

Do not connect a personal `@gmail.com` account in live mode. The application requires an explicitly authorized account from the configured Workspace domain.

## Resource map

Create these resources before turning on live folder provisioning:

| Resource | Recommended name | Used for |
| --- | --- | --- |
| Shared Drive | `FCI Operations` | Canonical client/project files, email copies, attachments, photos, and closeout documents |
| Spreadsheet | `FCI Operations Directory` | Client Directory and Project Register mirror |
| Calendar 1 | `FCI • Client Appointments` | Site visits, measurements, client meetings, and confirmations |
| Calendar 2 | `FCI • Field Schedule` | Published job assignments and crew schedule |
| Mailbox | `operations@cherryhillfci.com` (proposed) | Company Gmail intake and app connection |
| Google Cloud projects | `FCI Operations Development` now, plus defined staging and production boundaries later | Isolated Google APIs, OAuth clients, secrets, and data; later project creation remains owner-controlled, and staging billable resources are created on demand rather than left running |

## Part 1: set up the Google Workspace organization

1. Sign in to [Google Admin](https://admin.google.com/) with a super administrator account.
2. Confirm your company domain is verified.
3. Create the user who will connect the application.
4. Make sure Gmail, Calendar, Drive and Docs, and Sheets are enabled for that user’s organizational unit.
5. Confirm that your Workspace edition supports Shared Drives and that users are allowed to create them.

Google explains that Shared Drive content is owned by the organization rather than one employee, so it remains when an employee leaves. See [Set up Shared Drives](https://support.google.com/a/answer/7337469).

## Part 2: create the Shared Drive

1. Sign in to [Google Drive](https://drive.google.com/) with the connection account.
2. In the left navigation, select **Shared drives**.
3. Select **New**.
4. Name the drive `FCI Operations`.
5. Open the drive and select **Manage members**.
6. Give the connection account **Manager** access.
7. For future office users, prefer **Content manager** unless they need to change membership and drive-wide settings.
8. Restrict external sharing unless there is a documented business need.
9. Copy the Shared Drive ID from the browser URL. It is the value after `/drive/folders/`.

Google’s current access table and creation steps are in [Create a Shared Drive](https://support.google.com/a/users/answer/9310249).

Do not create the full project folder tree manually. The application creates project folders after the drive is connected, verified, and provisioning is enabled.

## Part 3: create the Client Directory spreadsheet

1. In the `FCI Operations` Shared Drive, create a Google Sheet.
2. Name it `FCI Operations Directory`.
3. Leave the workbook otherwise empty; the application maintains its Client Directory and Project Register tabs.
4. Copy the spreadsheet ID from its URL. It is the value between `/d/` and `/edit`.
5. Keep the connection account as a Shared Drive member so it can update the sheet.

The application remains the source of truth. The spreadsheet is one-way: use it to view, filter, export, and maintain the intentionally spreadsheet-owned Account Notes column. Other spreadsheet edits do not write back into the application.

## Part 4: create the two company calendars

Calendars must be created in a desktop browser; Google does not allow creating a secondary calendar from the mobile Calendar app.

1. Open [Google Calendar](https://calendar.google.com/) with the connection account.
2. Next to **Other calendars**, select **Add other calendars** and then **Create new calendar**.
3. Create `FCI • Client Appointments`.
4. Repeat the process for `FCI • Field Schedule`.
5. For each calendar, open **Settings and sharing**.
6. Share it with the people or Google Group who should see or manage it.
7. Give the connection account permission to make changes and manage sharing.
8. In the calendar settings, open **Integrate calendar**.
9. Copy the **Calendar ID**.

Google’s current steps are in [Create a new calendar](https://support.google.com/calendar/answer/37095) and [Calendar sharing tips](https://support.google.com/a/users/answer/11617205).

Do not create one company calendar per employee. Keep the two company calendars authoritative, and invite assigned people to events later.

## Part 5: verify or create the Google Cloud project

Google Cloud and Google Workspace are separate products. The Workspace tenant owns the users and company data; the Cloud project owns API and OAuth configuration.

1. Open [Google Cloud Console](https://console.cloud.google.com/) with a managed company account.
2. Select Brett's reported company-account project candidate. Treat it as a candidate until the Google Cloud identifiers, parent, development purpose, IAM, billing status, and API inventory are verified. `FCI Operations Development` is the recommended display name, not a reason to create a duplicate if Brett used a different name.
3. Open **IAM & Admin → Manage resources** and confirm the project's parent is the `cherryhillfci.com` company organization or an approved folder beneath it—not **No organization**.
4. Confirm the project is intended only for the current one-user test connector and is administered by company-controlled individual accounts. Review personal Gmail accounts, unknown principals, unexpected service accounts, and broad basic roles before continuing.
5. Record the non-secret project display name, project ID, project number, parent organization, and billing-linked yes/no status. Do not record credentials, payment information, or the billing-account number in GitHub.
6. Confirm whether the project is linked to an active company-controlled Cloud Billing account. A billing link is separate from the Workspace subscription and does not authorize provisioning.
7. Inventory the enabled APIs without changing them and record whether each of these is enabled or missing:
   - Google Drive API
   - Gmail API
   - Google Calendar API
   - Google Sheets API
8. Record whether Pub/Sub is disabled. It is not needed until Gmail background processing is built; Calendar background notifications will use HTTPS webhook channels rather than Pub/Sub.
9. Stop and give the non-secret inventory to the owner. Do not change APIs, IAM, billing, Auth settings, OAuth clients, or Admin API Controls until the owner approves the exact changes.
10. After approval, enable only the missing Drive, Gmail, Calendar, and Sheets APIs and keep Pub/Sub disabled.

Define separate staging and production project boundaries for their own OAuth clients, secrets, APIs, and resources. Creating those projects remains owner-controlled and does not authorize billable resources. Do not add the current Sites development callback or credentials to the future production project.

Parts 6 through 8 change Google Cloud or Google Admin configuration. Complete them only after the Part 5 inventory has been reviewed and the owner has approved the exact changes.

**One-account invariant for Parts 6–10:** use one exact company account as both the OAuth data-connection account and `GOOGLE_WORKSPACE_INTAKE_MAILBOX`. The Gmail client calls Google as `users/me`, and domain-wide delegation is intentionally forbidden, so the app cannot read a different intake mailbox. Readiness fails closed when Gmail is enabled and these values do not identify the same single approved account. PR #32 merged that safeguard at `adc79b8`, and the exact commit is included in private Sites development version 40. The live Google connection and per-service acceptance evidence remain pending.

## Part 6: configure the Google Auth platform

In the Cloud project, open **Google Auth platform**.

### Branding

1. Use the app name `FCI Operations`.
2. Choose a monitored company support email.
3. Add the company logo only when you have permission to use it.
4. Add the application home page, privacy policy, and terms links before wider distribution.

### Audience

1. Choose **Internal** so only accounts in your Workspace organization can authorize the app.
2. Keep development and production OAuth clients in separate company-owned Cloud projects and restrict application access with explicit invitations and Google Admin API Controls.
3. Confirm Google Auth platform treats the application as **Internal**. Do not add test users or follow the External **Testing**/**In production** publishing workflow for this Internal application. If **Internal** is unavailable, stop and attach the project to the company Cloud organization rather than continuing as External.

Internal audience is available only to projects under a Google Workspace/Cloud organization. Google's current behavior table lists publishing status as not applicable for Internal apps; test-user allowlists and seven-day refresh-token expiry are External Testing behavior. Internal audience still does not replace the application's invitation, disabled-user, role, or project-permission checks. See Google's [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) and [Manage App Audience](https://support.google.com/cloud/answer/15549945).

### Data access scopes

The current application requests:

```text
openid
email
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/spreadsheets
```

These are broad scopes. Keep the app internal, limit authorization to the one account that also owns the intake mailbox, and configure the OAuth client as a trusted internal app in Google Admin. Before a broader release, review whether narrower Drive and Gmail scopes can satisfy the workflow.

## Part 7: create the server-side OAuth client

1. In the verified development project, go to **Google Auth platform → Clients**.
2. Look for `FCI Operations Workspace Connector — Development`.
3. If it exists, open it and confirm it is a **Web application**. If it does not exist, select **Create Client**, choose **Web application**, and use that name.
4. Confirm this authorized redirect URI exists exactly; add it only if it is missing:

```text
https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback
```

5. If this development environment later receives a development-only custom hostname, add its exact HTTPS callback before changing the development application setting. Never add the future production callback to this client.
6. Save only reviewed changes.
7. Record the client ID and confirm the approved secret custodian. Do not reveal, regenerate, download, or share an existing client secret merely to complete the inventory; handle any required rotation as a separate controlled action.

This client and callback are development-only. Create the production data-connector client in the production project only after the production hostname is approved, and give it only the exact production HTTPS callback.

Google requires an exact server-side redirect URI match. See [Create Google Workspace credentials](https://developers.google.com/workspace/guides/create-credentials).

Do not upload the client JSON file to Drive, commit it to Git, paste it into documentation, or send it by email.

## Part 8: trust the internal OAuth application

1. Open [Google Admin](https://admin.google.com/).
2. Go to **Security → Access and data control → API controls**.
3. Open **App access control**.
4. Find or add the OAuth client ID created above.
5. Review the requested Gmail, Calendar, Drive, and Sheets scopes.
6. Configure the app as **Trusted** or use **Specific Google data** with the exact services/scopes required.
7. Apply the setting only to the organizational unit or group that needs it.

Google documents these controls in [Control which apps access Google Workspace data](https://support.google.com/a/answer/7281227).

Do not configure domain-wide delegation for this development environment. The current application uses an interactive OAuth connection for one approved account. Domain-wide delegation is a different and much more powerful architecture.

## Part 9: create the token-encryption key

The app encrypts the Google refresh token before storing it. Generate a 32-byte base64url value on a trusted computer.

In PowerShell with OpenSSL installed:

```powershell
openssl rand -base64 32
```

Store the result as a secret. Do not place it in `.env.example`, Git, Drive, screenshots, or documentation.

## Part 10: configure hosted runtime values

The code expects the following values for the current hosted development connector. Enter them in the ChatGPT Sites project's runtime environment settings, not in source control. Mark the client secret and token-encryption key as secrets there. Google Secret Manager is for the future production environment, not this Sites development connector.

```dotenv
FCI_OFFICE_EMAILS=<authorized-chatgpt-sign-in-email>
FCI_OFFICE_DOMAINS=
FCI_ADMIN_EMAILS=<authorized-chatgpt-sign-in-email>

GOOGLE_INTEGRATION_MODE=workspace
GOOGLE_WORKSPACE_ENABLED_SERVICES=drive,gmail,calendar,sheets
GOOGLE_WORKSPACE_CLIENT_ID=<OAuth web client ID>
GOOGLE_WORKSPACE_CLIENT_SECRET=<secret>
GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI=https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY=<secret 32-byte base64url value>
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_VERSION=1
GOOGLE_WORKSPACE_ALLOWED_DOMAINS=cherryhillfci.com
GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS=<operations-account@cherryhillfci.com>
GOOGLE_WORKSPACE_SHARED_DRIVE_ID=<Shared Drive ID>
GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED=false
GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID=<spreadsheet ID>
GOOGLE_WORKSPACE_INTAKE_MAILBOX=<operations-account@cherryhillfci.com>
GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID=<calendar ID>
GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID=<calendar ID>
```

For the current development environment, `FCI_OFFICE_EMAILS` is the ChatGPT sign-in email. It is deliberately separate from `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS`, which is the company Google account allowed to connect data. `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS` must contain exactly one account, and `GOOGLE_WORKSPACE_INTAKE_MAILBOX` must be that same address.

Keep folder provisioning `false` until Drive verification passes. Saving source files or `.openai/hosting.json` does not configure these values; a saved Sites version must be deployed separately before a hosted environment-setting change takes effect.

## Part 11: connect and verify Google Workspace

1. Deploy the runtime values.
2. Open FCI Operations.
3. Go to **Settings → Google Workspace**.
4. Run **Check readiness**.
5. Resolve every missing item before selecting Connect.
6. Select **Connect Google Workspace**.
7. Sign in with the exact single account listed in `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS`; it must also be the address in `GOOGLE_WORKSPACE_INTAKE_MAILBOX`.
8. Review the consent screen and approve the required scopes.
9. Return to the application and confirm the connection account is correct.
10. Verify each service separately:
    - Shared Drive verification
    - Gmail message listing and label preparation
    - Calendar event listing and a test hold
    - Google Sheets synchronization
11. Use only clearly marked test records.
12. After Shared Drive verification, set `GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED=true` and deploy the environment update.
13. Create one test project folder and confirm it is inside the correct Shared Drive.

## Part 12: test the complete current development environment

Use a client and projects named `FCI TEST — DO NOT USE`.

1. Add the test client.
2. Add two independent projects for that client.
3. Confirm the directory sheet mirrors the client and both projects.
4. Create each project’s Drive folder.
5. Send a test email to the intake mailbox with one project number in the subject.
6. Load the Gmail inbox and verify the suggestion.
7. Open **Review & copy**, select the exact project, inspect the destination, and approve it.
8. Confirm the email remains in Gmail Inbox.
9. Confirm `.eml` and attachments exist in the intended Shared Drive project folder.
10. Create a reply draft and confirm it appears as a draft, not as a sent message.
11. Load Calendar events and create a test hold.
12. Add a meeting record with an Otter link, summary, decisions, and action items.
13. Ask the assistant about project status, contacts, email archives, and meeting notes; inspect every source.
14. Confirm an unapproved app login email sees Access not authorized.
15. Delete or archive the test data only after recording results.

## Part 13: make the app easy to open

### Best option for the one-user development environment: install the PWA

- On a computer, open the app in Chrome or Edge and use the browser’s Install app command.
- On iPhone/iPad, open it in Safari, select Share, then Add to Home Screen.
- On Android, open it in Chrome and select Install app or Add to Home screen.

This is the fastest option and does not require a Marketplace listing.

### Managed Chrome option

If the company manages Chrome browsers:

1. In Google Admin, go to **Devices → Chrome → Apps & extensions → Users & browsers**.
2. Choose the user, group, or organizational unit.
3. Select **Add → Add by URL**.
4. Enter the final FCI Operations HTTPS URL.
5. Choose Installed, Force install, or Force install + pin as appropriate.
6. Restart Chrome and verify the policy.

Google’s current instructions are in [Automatically install web apps](https://support.google.com/chrome/a/answer/9367354).

### Google apps launcher / Marketplace option

After the production hostname and Google Workspace login implementation are approved:

1. Enable the **Google Workspace Marketplace SDK** in the isolated production Cloud project, not `FCI Operations Development`.
2. Configure a **Web app** integration.
3. Use the production app URL as the Universal navigation URL.
4. Choose **Private** visibility for your organization.
5. For one user, use Private and Unlisted or Individual + Admin Install.
6. Provide the required 48×48 and 96×96 icons and private store listing.
7. Publish the private listing.

Google states that a Marketplace web app uses the Universal navigation URL to open from the Google apps menu, and private apps are available only in the organization. See [Configure the Marketplace SDK](https://developers.google.com/workspace/marketplace/enable-configure-sdk) and [Publish Marketplace apps](https://developers.google.com/workspace/marketplace/how-to-publish).

Do not publish the current build in the Workspace launcher yet if you expect Google-based app login: it would still direct the user through ChatGPT sign-in.

## Part 14: implement Google Workspace user login

This is development work, not an Admin-console toggle.

1. Create a separate OAuth/OIDC web client for application sign-in. Keeping login and the broad data connector separate makes scopes and revocation easier to understand.
2. Add Google Identity Services to the sign-in page.
3. Request only authentication scopes: `openid email profile`.
4. Send the Google ID token to the application server.
5. On the server, verify:
   - Google signature/JWK
   - `iss`
   - `aud`
   - `exp`
   - email verification
   - `hd=cherryhillfci.com`
6. Match the verified Google subject/email to an application `User` record.
7. Create a secure, HTTP-only, SameSite session cookie.
8. Replace the existing forwarded ChatGPT identity dependency in both pages and API routes.
9. Enforce Admin, Office, and Project Manager roles on the server.
10. Add project-level permission assignments before giving additional users access.
11. Test a company account, an outside Workspace account, a personal Gmail account, a revoked user, and an expired session.

Do not rely only on the email text or the requested `hd` parameter. Google’s [OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference) specifically says to use the signed `hd` claim to identify a hosted-domain account.

## Part 15: production acceptance checklist

Do not store real client data until every required item is complete.

- [ ] `cherryhillfci.com` and its Workspace users are controlled by the company.
- [ ] App audience is Internal.
- [ ] The production data-connector client has only the exact production HTTPS callback and no development callback.
- [ ] The separate production employee-login client has only the exact production origins/callbacks; OIDC verifies that client as the audience and verifies the signed `hd` claim.
- [ ] Admin API Controls trust only the intended production data-connector client.
- [ ] Authorized account and allowed domain are exact.
- [ ] Shared Drive is verified and external sharing is reviewed.
- [ ] Both calendars exist and their IDs are verified.
- [ ] Directory spreadsheet ID is correct.
- [ ] Secrets exist only in hosted secret storage.
- [ ] Gmail, Drive, Calendar, and Sheets tests pass independently.
- [ ] Review & copy retains Gmail Inbox and uses the selected project.
- [ ] Folder provisioning was enabled only after Drive verification.
- [ ] Backup restoration is tested.
- [ ] Audit events cover every sensitive action.
- [ ] Project permissions exist before a second user is allowed.
- [ ] Full lifecycle acceptance passes with non-production records.

## Troubleshooting

### `redirect_uri_mismatch`

- Copy the callback URI displayed in the Google error details.
- Compare it character-for-character with the OAuth client’s Authorized redirect URIs.
- Check `https`, hostname, path, slashes, and whether a custom domain was introduced.
- Save the OAuth client and wait several minutes before testing again.

### `org_internal`

- The authorizing account is outside the Cloud project’s Workspace organization, or the wrong Cloud project is selected.
- Use the approved company account and confirm the project is under the correct organization.

### App says the account is unauthorized

- Confirm the account is listed in `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS`.
- Confirm its domain is listed in `GOOGLE_WORKSPACE_ALLOWED_DOMAINS`.
- Reconnect after changing either setting; stored connections are revalidated.

### Gmail/Calendar/Drive/Sheets says reauthorization is required

- The enabled-services list changed or the prior connection did not grant every required scope.
- Disconnect and reconnect the exact authorized account, then approve every selected service.

### Shared Drive verification fails

- Confirm the ID is a Shared Drive ID, not a folder ID from My Drive.
- Confirm the connection account is a Shared Drive Manager.
- Keep provisioning disabled until verification passes.

### The app opens but employees cannot use Google login

- That is expected in the current development environment. Google data OAuth and app-user login are separate. Complete Part 14 before relying on Workspace identity for application access.
