# Floor Coverings International Google Workspace organization

## Source of truth

FCI Operations owns operational records: clients, contacts, projects, schedules, tasks, email-filing decisions, and audit history. Google Workspace is the company-owned collaboration layer:

- **Google Sheets:** a generated `Client Directory` that office staff can view, filter, and export.
- **Shared Drive:** all account and project documents, photos, archived emails, and attachments.
- **Gmail:** one controlled intake mailbox with broad labels, not thousands of per-project filters.
- **Calendar:** separate `Client Appointments` and `Field Schedule` calendars.

The first sync is one-way from FCI Operations to the Client Directory Sheet. This prevents a spreadsheet sort or rename from breaking the relationship between a client and its independent projects. Add a controlled `Intake / Changes` tab later if spreadsheet-originated changes are needed.

## Shared Drive blueprint

```text
FCI Operations/
  00_Company Admin/
    Client Directory (Google Sheet)
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

Configure rules in **FCI Operations → Settings → Email & file rules**. Each rule has a priority, matching criteria, action, destination category, and mandatory approval.

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

On approval, FCI Operations should save the original email as an `.eml` file in the selected project’s `05_Correspondence/Email Archive/YYYY-MM`, copy attachments to `Email Attachments/YYYY-MM`, record the Gmail/Drive identifiers and decision in the activity log, and apply `FCI/Filed`. Remove the Gmail `INBOX` label only when a user explicitly chooses to archive it.

## Workspace setup checklist

- Create a company-owned Shared Drive named `FCI Operations`.
- Create Google Groups for office staff, project managers, and field leads.
- Create the `Client Directory` Google Sheet in `00_Company Admin`.
- Select a dedicated project-intake mailbox.
- Create the `Client Appointments` and `Field Schedule` calendars.
- Create a Google Cloud project; enable Drive, Gmail, Sheets, Calendar, and Pub/Sub APIs.
- Register the OAuth client and approve the least-privilege scopes needed by the application.
- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_SHARED_DRIVE_ID`, `GOOGLE_CLIENT_DIRECTORY_SHEET_ID`, `GOOGLE_INTAKE_MAILBOX`, `GOOGLE_CLIENT_APPOINTMENTS_CALENDAR_ID`, `GOOGLE_FIELD_SCHEDULE_CALENDAR_ID`, and `GOOGLE_PUBSUB_TOPIC` in the hosted environment. Keep secrets out of source control.

## Operational controls still needed before live automation

- Workspace administrator approval for Google OAuth scopes.
- Retention and deletion policy for client emails, photos, and closed projects.
- Permission map for office, project managers, employees, and subcontractors.
- A standard naming convention for project numbers and client codes.
- A process for resolving a message that could match several projects.
- Backup/export cadence and a documented closeout/archive checklist.
