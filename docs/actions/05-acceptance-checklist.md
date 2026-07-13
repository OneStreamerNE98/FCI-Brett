# Action: Complete pilot and production acceptance

Owner: Business owner and Workspace administrator

Status: Blocked by configuration and development

## Controlled pilot acceptance

Use only a client and projects named `FCI TEST — DO NOT USE`.

- [ ] Add one test client and two independent projects.
- [ ] Confirm both projects appear in the directory Sheet mirror.
- [ ] Create each project's Shared Drive folder.
- [ ] Send a test email containing one project number to the intake mailbox.
- [ ] Review and copy the email to the exact project.
- [ ] Confirm Gmail Inbox is retained and the `.eml` plus attachments exist in the intended project folder.
- [ ] Create a reply draft and confirm nothing was sent.
- [ ] List Calendar events and create a test hold.
- [ ] Save a meeting with notes, decisions, and action items.
- [ ] Ask the assistant about the selected project and inspect every citation.
- [ ] Confirm an unapproved ChatGPT login is denied during the pilot.

## Production acceptance

- [ ] Company Workspace domain and users are controlled by the business.
- [ ] Google Auth audience is Internal and API Controls trust is scoped.
- [ ] Secrets exist only in encrypted hosted/Google secret storage.
- [ ] Google Workspace employee login and signed-domain validation pass.
- [ ] Admin, Office, and Project Manager authorization tests pass.
- [ ] Project permissions exist before a second user is enabled.
- [ ] Backup restoration is tested and documented.
- [ ] Sensitive actions have audit events and an administrator viewer.
- [ ] File scanning/quarantine and retention controls pass.
- [ ] The full lead-to-closeout lifecycle passes with non-production records.
- [ ] Production cutover and rollback procedures are approved.

## Approval gate

Real client data and multi-user access remain prohibited until every applicable production item above is checked and the business owner records launch approval.
