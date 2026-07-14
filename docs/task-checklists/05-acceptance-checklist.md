# Task checklist: Complete development and production acceptance

Owner: Business owner and Workspace administrator

Status: Blocked by configuration and development

## Controlled development acceptance

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
- [ ] Confirm an unapproved ChatGPT login is denied in the development environment.
- [ ] Confirm no live control can apply `FCI/Filed` without an exact project archive and audit event.
- [ ] Remove or rename old test records so every remaining development record clearly says `FCI TEST — DO NOT USE`.

## Production acceptance

- [ ] `cherryhillfci.com` and its Workspace users are controlled by the business.
- [ ] Google Auth audience is Internal and API Controls trust is scoped.
- [ ] Secrets exist only in encrypted hosted/Google secret storage.
- [ ] Google Workspace employee login and signed-domain validation pass.
- [ ] Admin, Office, and Project Manager authorization tests pass.
- [ ] The approved app-to-Google access matrix passes, including removal of old Group, folder, mailbox, Calendar, and Sheet access.
- [ ] Project permissions exist before a second user is enabled.
- [ ] Backup restoration is tested and documented.
- [ ] Point-in-time recovery, RPO, RTO, cutover, and rollback procedures are tested and approved.
- [ ] Sensitive actions have audit events and an administrator viewer.
- [ ] Retention controls pass; if untrusted uploads are released, file scanning/quarantine controls also pass.
- [ ] Session revocation, connector-account recovery, and token-encryption key rotation pass.
- [ ] Concurrent record edits produce a conflict instead of a lost update.
- [ ] Google timeouts, quota errors, retries, and duplicate webhook delivery do not create duplicate files, events, or records.
- [ ] If Gmail watches or Calendar channels are released, renewal/expiry monitoring passes.
- [ ] Security headers, request limits, rate limits, correlation IDs, logging, database alerts, and budget alerts pass; queue/module alerts pass for every optional service enabled at launch.
- [ ] Keyboard, screen-reader, 200% zoom, mobile, tablet, and desktop acceptance passes for every released workflow.
- [ ] A 20-user representative load/concurrency test passes within approved response-time and cost limits.
- [ ] The full lead-to-closeout lifecycle passes with non-production records.
- [ ] Production cutover and rollback procedures are approved.

## Approval gate

Real client data and multi-user access remain prohibited until every applicable production item above is checked and the business owner records launch approval.
