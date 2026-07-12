# Floor Coverings International Google Workspace organization

## Source of truth

FCI Operations owns operational records: clients, contacts, projects, schedules, tasks, email-filing decisions, and audit history. Google Workspace is the company-owned collaboration layer:

- **Google Sheets:** a generated `Client Directory` plus a `Project Register` tab that office staff can view, filter, and export.
- **Shared Drive:** all account and project documents, photos, archived emails, and attachments.
- **Gmail:** one controlled intake mailbox with broad labels, not thousands of per-project filters.
- **Calendar:** separate `Client Appointments` and `Field Schedule` calendars.

The first sync is one-way from FCI Operations to the Google spreadsheet. The existing `Client Directory` keeps its **Account Notes** column for office use; the app updates the other directory fields. `Project Register` is app-generated and rebuilt from independent project records. This prevents a spreadsheet sort or rename from breaking the relationship between a client and its projects. Add a controlled `Intake / Changes` tab later if spreadsheet-originated changes are needed.

## Temporary My Drive workspace

For an early prototype, use one empty, dedicated My Drive folder as the workspace root. Create the same structure shown below inside that folder; the application must never use the account's My Drive root. Configure `GOOGLE_TEST_DRIVE_MODE=my-drive` and `GOOGLE_TEST_DRIVE_ROOT_FOLDER_ID` with that folder's ID.

This is suitable only for testing and one-owner operation because the folder is owned by that Google account. Before adding wider staff access or live client documents, create a separate company profile with `GOOGLE_PRODUCTION_DRIVE_MODE=shared-drive`, `GOOGLE_PRODUCTION_SHARED_DRIVE_ID`, and `GOOGLE_CONNECTION_ENVIRONMENT=production`. The client and project data model does not change.

## Personal test profile → company production profile

FCI Operations treats personal testing and company production as separate connections, not a single connection that is renamed later.

- **Test profile:** a personal Google account, the dedicated `FCI Operations — Temporary` folder, self-sent test mail only, and deliberately enabled Drive/Sheets/Gmail/Calendar authorization.
- **Production profile:** a company Google account, company-owned Shared Drive, a distinct OAuth client/secret, and a new authorization. It never reuses the personal refresh token.

Folder mappings are saved by profile. When production is enabled, new company folders are created under the company workspace; personal test folders remain intact for reference but are not used by production projects.

The project and client APIs resolve Drive links from the active profile mapping only. A test-folder link is not shown or opened when the production profile is active, even though the same client and project records are retained.

Do not use a personal inbox for real client email or copy the test OAuth credentials into the production profile. Gmail test actions are explicit: the app can create labels, show a bounded test inbox, send to the approved test address, and apply a label after your click. It never automatically archives, removes `INBOX`, or sends to a client in the personal test profile.

## Shared Drive blueprint

```text
FCI Operations/
  00_Company Admin/
    Client Directory (Google Sheet; Project Register tab)
    Templates/
  01_Client Accounts/
    CL-0001 — Atlas Design Group/
      00_Client Profile & Master Documents/
      Projects/ (shortcuts only)
  02_Projects/
    2026/
      CF-2026-041 — Westport Medical Center/
        00_Admin/
        01_Lead & Proposal/
        02_Contract & Submittals/
        03_Schedule & Field/
        04_Photos & QA/
        05_Correspondence/
          Email Archive/
          Email Attachments/
        06_Closeout/
  99_Archive/
  99_Unsorted Intake/
```

Do not put project folders beneath a client folder. A client can have many projects, and every project needs an independent schedule, status, closeout, and archive. The client account folder holds account-wide material and shortcuts back to the independent projects.

## Email and file rules

Configure rules in **FCI Operations → Settings → Inbox & file rules**. Each rule has a priority, matching criteria, action, destination category, and mandatory approval. Keep the rules review-first: rules may suggest a project or send a message to review, but they never file a message without the office user choosing the exact independent project.

The first prototype actively evaluates the three built-in rules below in priority order. Pausing a built-in rule immediately removes that matcher from inbox suggestions. Custom free-text rules are saved as review-first policies, but do not run automatically until a supported matcher is added.

Recommended matching order:

1. Exact project number in subject or message body → suggest that project.
2. Explicit user rule → suggest the configured project or client destination.
3. Known contact with exactly one eligible project → suggest that project.
4. Known contact with two or more eligible projects → require project selection.
5. Everything else → `FCI/Needs Review` and `99_Unsorted Intake`.

Only use these broad Gmail labels:

```text
FCI/Intake
FCI/Needs Review
FCI/Filed
```

On approval, FCI Operations saves the original email as an `.eml` file in the selected project’s `05_Correspondence/Email Archive`, copies attachments to `Email Attachments`, records the Gmail/Drive identifiers and decision in the activity log, and applies `FCI/Filed`. The Gmail `INBOX` label is retained. For personal testing, replies are saved as Gmail drafts to the approved test account and are not sent by FCI Operations.

## Calendar ownership and sync

Use two company-owned calendars, not one new calendar for every person:

- `FCI • Client Appointments` for client meetings, site walks, and confirmation-driven appointments.
- `FCI • Field Schedule` for published crew shifts and work blocks.

The FCI app is the operational source of truth. When calendar synchronization is enabled, it should create or update one company event and invite the assigned project manager or employee to that same event; it should not copy the job into each person’s private calendar. Personal calendars are optional free/busy sources only, with each person explicitly authorizing their own Google account. Employees without Google accounts continue to receive their schedule by email/SMS action link.

Gmail and Calendar are separate Google services on the same account. An email can be linked to an appointment when staff deliberately schedule from that message, but Gmail-generated travel, reservation, or ticket events must never become company schedule records automatically. During the first real sync phase, app-created events flow from FCI Operations to the selected company calendar. Later calendar edits should be flagged for review instead of silently overwriting the project schedule.

The current personal test adapter remains intentionally limited to the approved test account’s primary calendar and private test holds. It does not yet create the two company calendars, read individual availability, or run two-way event synchronization.

## Personal web-app shortcut

The hosted FCI Operations site is an installable web app. In Chrome or Edge, use the browser’s **Install app** command to add it as a separate app window in the personal Google/Chrome profile. Google’s personal app launcher cannot add an arbitrary custom web URL; a true Gmail side panel is a separate Google Workspace Add-on project and should wait until individual Gmail connections are implemented.

## Workspace setup checklist

- For production, create a company-owned Shared Drive named `FCI Operations`. For early testing, create one dedicated My Drive folder instead.
- Create Google Groups for office staff, project managers, and field leads.
- Create the `Client Directory` Google Sheet in `00_Company Admin`. The app adds and manages the `Project Register` tab after Sheets is connected.
- Select a dedicated project-intake mailbox.
- Create the `Client Appointments` and `Field Schedule` calendars.
- Create a Google Cloud project; enable Drive, Gmail, Sheets, Calendar, and Pub/Sub APIs.
- Register the OAuth client and approve the least-privilege scopes needed by the application.
- Set `FCI_ADMIN_EMAILS`, then configure either the `GOOGLE_TEST_*` profile or the `GOOGLE_PRODUCTION_*` profile in the hosted environment. Keep client secrets and token-encryption keys out of source control. The active profile is selected with `GOOGLE_CONNECTION_ENVIRONMENT=test` or `production`.

## Operational controls still needed before live automation

- Workspace administrator approval for Google OAuth scopes.
- Retention and deletion policy for client emails, photos, and closed projects.
- Permission map for office, project managers, employees, and subcontractors.
- A standard naming convention for project numbers and client codes.
- A process for resolving a message that could match several projects.
- Backup/export cadence and a documented closeout/archive checklist.
