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
- [ ] Confirm no live control can apply `FCI/Filed` without an exact project archive and audit event.
- [ ] Remove or rename old test records so every remaining pilot record clearly says `FCI TEST — DO NOT USE`.

## Production acceptance

- [ ] Company Workspace domain and users are controlled by the business.
- [ ] Google Auth audience is Internal and API Controls trust is scoped.
- [ ] Secrets exist only in encrypted hosted/Google secret storage.
- [ ] Google Workspace employee login and signed-domain validation pass.
- [ ] Admin, Office, and Project Manager authorization tests pass.
- [ ] The approved app-to-Google access matrix passes, including removal of old Group, folder, mailbox, Calendar, and Sheet access.
- [ ] Project permissions exist before a second user is enabled.
- [ ] Backup restoration is tested and documented.
- [ ] Point-in-time recovery, RPO, RTO, cutover, and rollback procedures are tested and approved.
- [ ] Sensitive actions have audit events and an administrator viewer.
- [ ] File scanning/quarantine and retention controls pass.
- [ ] Session revocation, connector-account recovery, and token-encryption key rotation pass.
- [ ] Concurrent record edits produce a conflict instead of a lost update.
- [ ] Google timeouts, quota errors, retries, and duplicate webhook delivery do not create duplicate files, events, or records.
- [ ] Gmail watch and Calendar channel renewal/expiry monitoring pass.
- [ ] Security headers, request limits, rate limits, correlation IDs, logging, queue alerts, database alerts, and budget alerts pass.
- [ ] Keyboard, screen-reader, 200% zoom, mobile, tablet, and desktop acceptance passes for every released workflow.
- [ ] A 20-user representative load/concurrency test passes within approved response-time and cost limits.
- [ ] The full lead-to-closeout lifecycle passes with non-production records.
- [ ] Production cutover and rollback procedures are approved.

## Approval gate

Real client data and multi-user access remain prohibited until every applicable production item above is checked and the business owner records launch approval.
