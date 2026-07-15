# Task checklist: Confirm setup inputs

Owner: Business owner

Status: Partially complete — company domain, login/platform direction, and cost-controlled rollout posture recorded

Secrets required in GitHub: None

Record only the following non-secret decisions in this file or a GitHub issue. Leave secret values in Google Secret Manager or the hosted platform's encrypted settings.

## Required inputs

- [x] Company Google Workspace primary domain: `cherryhillfci.com`
- [ ] Google Workspace super administrator contact: `TBD`
- [ ] Proposed FCI Operations connection account: `operations@cherryhillfci.com` — confirm or create
- [ ] Initial application administrator Workspace email: `TBD`
- [x] Additional development users: `None — single-user development environment`
- [ ] Final production hostname or custom domain: `TBD`
- [x] Development login policy: keep allowlisted ChatGPT sign-in during the single-user development phase
- [x] Production login policy: individual Google Workspace accounts; no application passwords
- [x] Production platform: Google Cloud Run and Cloud SQL PostgreSQL

## Account policy

- Use a separate Workspace super administrator for tenant administration when practical.
- Use the proposed operations account for the Gmail, Calendar, Drive, and Sheets connection. It should be a normal company-controlled account, not a personal Gmail account.
- Give the operations account only the Workspace permissions required by the documented workflow.
- Use individual employee Workspace identities for application login. Never share the operations-account password with employees.

## Production cost and Cloud inputs

These non-secret decisions are tracked in detail in [Production foundation and migration](07-production-foundation-and-migration.md). They are not required to finish the one-user Workspace test connector, but they must be complete before production resources are provisioned.

- [x] Reuse existing Workspace for employee identity and collaboration; keep Cloud SQL as the application system of record.
- [x] Keep Sites as development, define isolated environment boundaries, and make billable staging resources on demand.
- [x] Keep optional Tasks, Scheduler, Pub/Sub, quarantine/scanning, SMS, and `pgvector` infrastructure disabled until its feature is approved.
- [x] Use `$50/month` as the default pre-production accidental-spend alert planning value; it is an alert, not a cap.
- [ ] Select the Google Cloud organization/billing owner and primary US region.
- [ ] Name the pre-production budget-alert recipients.
- [ ] Review official estimates for standalone/zonal and regional-HA Cloud SQL.
- [ ] Approve RPO, RTO, the database profile, and the estimate-based production alert budget.
- [ ] Name the deployment approver and emergency rollback owner.

See the accepted [Workspace-first, cost-controlled rollout](../architecture-decision-workspace-first-cost-controlled-rollout.md) for the complete decision, tradeoffs, and service-activation gates.

## Completion result

The development inputs are complete when the domain, operations connection account, and initial application administrator are known. The production hostname may remain `TBD` until the Cloud Run deployment and employee-login client are prepared. No password, OAuth secret, encryption key, or token should be recorded here.

## Your next steps after completing the inputs

Complete these actions in order. Do not start with employee login; connect and verify the single-user development environment first.

### 1. Create the company Workspace resources

Follow [Google Workspace accounts and resources](01-workspace-resources.md).

- Create or confirm the operations connection account.
- Create the `FCI Operations` Shared Drive.
- Create the `FCI Operations Directory` Google Sheet inside that Shared Drive.
- Create the `FCI • Client Appointments` and `FCI • Field Schedule` calendars.
- Confirm the operations account can manage each resource.
- Keep the Shared Drive, spreadsheet, and calendar IDs available for hosted configuration. These are not passwords, but do not paste them into public documentation.

### 2. Verify the Google Cloud project and create the OAuth client

Follow [Google Cloud, OAuth, and API controls](02-google-cloud-and-oauth.md).

- Inventory Brett's reported company-account project candidate; verify that it is a Google Cloud development project under the company organization before calling it the FCI development project.
- Stop after the read-only inventory and report the non-secret findings for owner review. Do not change APIs, IAM, billing, Auth settings, OAuth clients, or Admin API Controls until the owner approves the exact changes.
- After approval, reuse the verified candidate. `FCI Operations Development` is the recommended display name, not a reason to create a duplicate if Brett used a different name.
- Record only its non-secret project name, project ID, project number, parent organization, and billing-linked yes/no status. Never record credentials or payment details.
- Enable the Drive, Gmail, Calendar, and Sheets APIs.
- Keep Pub/Sub disabled until the Gmail background-processing worker is implemented.
- Configure the Google Auth audience as **Internal**.
- Create the `FCI Operations Workspace Connector — Development` web OAuth client.
- Add the exact hosted callback URI from the instructions.
- Trust that client through Google Admin API Controls.
- Store the OAuth client secret securely; never enter it in GitHub.
- Create the separate production project and OAuth client only after the production hostname is approved; never reuse the development callback or credentials.

### 3. Add the hosted application settings

Follow [Hosted development configuration and connection](03-hosted-development-connection.md).

- Add the company domain, operations account, Shared Drive ID, spreadsheet ID, and calendar IDs to the hosted application configuration.
- Add the OAuth client secret and token-encryption key only through encrypted secret settings.
- Keep `GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED=false` during initial verification.

### 4. Connect and test Google Workspace

- Open the [hosted FCI Operations application](https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/).
- Go to **Settings → Google Workspace → Check readiness**.
- Resolve every missing item before selecting **Connect Google Workspace**.
- Authorize only the approved operations connection account.
- Verify Drive, Gmail, Calendar, and Sheets independently.
- Enable Drive provisioning only after Shared Drive verification succeeds.

### 5. Run the controlled development checklist

Follow [Development and production acceptance](05-acceptance-checklist.md) using only records named `FCI TEST — DO NOT USE`.

- Test two projects for one client.
- Test the Sheet mirror and project folders.
- Test reviewed Gmail copying and an unsent reply draft.
- Test the Calendar hold, meeting records, and assistant citations.
- Do not add employees or real client data yet.

### 6. Begin employee Google login only after development acceptance passes

The production login work is documented in [Staff Google login, roles, and permissions](04-staff-login-and-permissions.md). Codex/development must implement users, secure sessions, Admin/Office/Project Manager roles, and project permissions before a second user is admitted.

## What to report back after each topic

You can return to Codex with a status update such as:

> Workspace resources are complete. The operations account can manage the Shared Drive, directory Sheet, and both calendars. No secrets are included. Please update the Task Checklists and guide me through Google Cloud/OAuth next.

Do not send passwords, OAuth client secrets, token-encryption keys, access tokens, or refresh tokens in the status update.
