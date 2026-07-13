# Action: Establish operations, recovery, and security controls

Owner: Business owner, Workspace administrator, and Codex/developer

Status: Not started

Depends on: [Production foundation and migration](07-production-foundation-and-migration.md)

For a 20-person company, operations must be simple enough that two named people can understand and exercise the recovery procedures. A checklist that has never been tested is not a recovery control.

## Recovery and continuity

- [ ] Record approved RPO and RTO targets.
- [ ] Enable database backups and point-in-time recovery; document retention and location.
- [ ] Export or snapshot required configuration and infrastructure definitions without exporting secrets into GitHub.
- [ ] Perform a staging restore from a production-format backup and reconcile clients, projects, activities, permissions, and audit records.
- [ ] Run restore testing quarterly and after material schema or infrastructure changes.
- [ ] Document production cutover, rollback, Google connector reconnection, and degraded read-only operation.
- [ ] Maintain at least two trained Administrators and a break-glass procedure with audited use.
- [ ] Use a company operations account for the Google data connector; document how to rotate or replace it without losing continuity.

## Audit, privacy, and retention

- [ ] Create one append-only audit event model with actor, action, entity type/ID, timestamp, result, reason, request/correlation ID, and safe metadata.
- [ ] Audit login outcomes, session revocation, role/project changes, connector changes, Gmail preview/file/draft actions, Drive sharing/provisioning, Calendar writes, exports, and recovery actions.
- [ ] Build an Administrator audit viewer with filters and export controls.
- [ ] Approve retention periods for client records, email copies, attachments, meeting transcripts, field photos, audit events, and backups.
- [ ] Document client/employee data export, correction, and deletion procedures.
- [ ] Prohibit tokens, message bodies, secrets, and unnecessary personal data in logs.

## Files and messaging safety

- [ ] Quarantine uploads, validate type and size, scan for malware, and release approved files before Shared Drive copy.
- [ ] Apply the same controls to Gmail attachments and direct project uploads.
- [ ] Remove the live Gmail `FCI/Filed` label-only action. Any repair action must reference an existing archive and exact project, capture a reason, and create an audit event.
- [ ] Preserve Inbox retention and human review before project filing.
- [ ] Keep replies as drafts until a person intentionally sends them.
- [ ] Before outbound SMS/email automation, implement consent, opt-out/STOP, provider-neutral delivery state, retries, dead letters, and a human exception queue.

## Monitoring and routine checks

- [ ] Create alerts for application errors, failed login spikes, database saturation/storage, queue age/depth, dead letters, failed Google calls, expiring Gmail watches, expiring Calendar channels, low storage, and backup failures.
- [ ] Create a Workspace health view with the connection account, enabled services, last success/failure, watch/channel expiry, queue health, and required owner action.
- [ ] Define severity levels, alert recipients, after-hours expectations, and escalation contacts.
- [ ] Review access quarterly, backups/restore quarterly, connector/key rotation at least annually, and incidents after every material event.
- [ ] Record service owners and vendor support links in a private operations runbook; do not put secrets in the runbook.
- [ ] Set Cloud budget thresholds and review actual cost monthly during the pilot.

## Incident drill

- [ ] Disable a user and prove existing sessions stop working.
- [ ] Remove a Project Manager from a project and prove app and direct Google access are removed.
- [ ] Simulate Google API timeout/quota failure and prove work retries once without duplicate files/events.
- [ ] Expire a Gmail watch and Calendar channel and prove monitoring and renewal recover them.
- [ ] Restore the database into staging and reconcile record and audit counts.
- [ ] Rotate the OAuth client secret and token-encryption key using the written procedure.
- [ ] Quarantine a harmless antivirus test file and prove it never reaches Shared Drive.

## Completion result

This action is complete when the controls exist, two named people can follow the runbooks, restore and incident drills have dated evidence, and the owner has accepted the residual risks.
