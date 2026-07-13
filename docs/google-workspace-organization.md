# Floor Coverings International Google Workspace organization

## Source of truth

FCI Operations owns clients, contacts, independent projects, schedules, tasks, filing decisions, and audit history. Google Workspace is the company collaboration layer:

- **Sheets:** generated Client Directory and Project Register views.
- **Shared Drive:** account documents, independent project folders, photos, archived emails, and attachments.
- **Gmail:** one controlled intake mailbox with broad FCI labels.
- **Calendar:** shared Client Appointments and Field Schedule calendars.

Local development uses Workspace simulation. It follows the same organization but creates no Google data.

## Shared Drive blueprint

Shared Drive membership is broader than application project membership: members normally see all content in the drive unless a folder is configured for limited access. Keep Project Managers and field staff off the Shared Drive root when their application role is narrower, and grant only approved project-folder access through role-aligned Google Groups.

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

Project folders do not live beneath client folders. One client may have many projects; each project keeps its own number, schedule, status, correspondence, closeout, and archive. The client account folder holds reusable account-level material and project shortcuts.

## Email and filing rules

Configure rules under **Settings → Inbox & file rules**. Rules may suggest a project or send a message to review, but filing always requires the office user to choose the exact independent project and confirm.

Recommended matching order:

1. Exact project number.
2. Explicit supported rule.
3. Known contact with one eligible project.
4. Known contact with several eligible projects → mandatory review.
5. Everything else → Needs Review and Unsorted Intake.

Use only these Gmail labels:

```text
FCI/Intake
FCI/Needs Review
FCI/Filed
```

After approval, live mode saves the original `.eml` and attachments in the selected project, records the action, and applies `FCI/Filed` without removing Inbox. Simulation stores equivalent local evidence without contacting Google.

## Calendar ownership

Use two company-owned calendars:

- `FCI • Client Appointments`
- `FCI • Field Schedule`

FCI Operations remains authoritative. App-created Workspace events are linked back to their project or shift. Conflicting edits are flagged for review instead of silently overwriting operational records.

## Workspace setup checklist

- Subscribe to or trial Google Workspace and verify a company-controlled domain.
- Approve the [20-user app-to-Google access matrix](task-checklists/06-20-user-operating-model-and-access.md), then create only the Google Groups required by that matrix.
- Create the `FCI Operations` Shared Drive.
- Create the Client Directory Sheet, intake mailbox, and two shared calendars.
- Create a Google Cloud project and enable Drive, Gmail, Calendar, Sheets, and Pub/Sub APIs.
- Create the OAuth consent configuration and Web client for the deployed application.
- Restrict the app to approved Workspace domains and administrators.
- Configure only `GOOGLE_WORKSPACE_*` runtime values and keep secrets outside source control.
- Verify the Shared Drive before enabling project-folder provisioning.

## Before staff launch

- Approve OAuth scopes with the Workspace administrator.
- Document retention and deletion rules.
- Complete permission tests for office, project managers, employees, and subcontractors.
- Validate backup restoration and account revocation.
- Complete the full lead-to-closeout scenario with non-production Workspace records.

See Google’s guidance for [Shared Drive access levels and limited-access folders](https://support.google.com/a/users/answer/12380484?hl=en), [Shared Drive best practices](https://support.google.com/a/users/answer/13015138?hl=en), and [managing Shared Drives with Google Groups](https://support.google.com/a/users/answer/7212025?hl=en).
