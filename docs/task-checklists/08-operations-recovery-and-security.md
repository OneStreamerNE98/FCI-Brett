# Task checklist: Establish operations, recovery, and security controls

Owner: Business owner, Workspace administrator, and Codex/developer

Status: In progress — audit model and minimized viewer complete in source; recovery, retention, export, and production composition remain open

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

- [x] Create one append-only audit event model with executor/originator, action, entity type/ID, timestamp, result, reason, request/correlation ID, and bounded safe metadata. The source migration, mutation-blocking trigger, insert-only grant, and atomic repository helper exist but remain unapplied; operational route coverage is tracked separately. See [Production persistence boundary](../production-persistence-boundary.md).
- [ ] Audit login outcomes, session revocation, role/project changes, connector changes, Gmail preview/file/draft actions, Drive sharing/provisioning, Calendar writes, exports, and recovery actions.
- [x] Build the minimized Administrator audit viewer with fixed filters and bounded pagination. Its presentation adapter first shipped in private Sites development version 37 and remains present in the current private Sites development version 40 (`adc79b8`, PR #32); production migration 5/reader grants and Cloud Run composition remain unapplied.
- [ ] Add approved audit export controls and complete the retention policy, production migration 5/reader grants, and Cloud Run composition.
- [ ] Approve retention periods for client records, email copies, attachments, meeting transcripts, field photos, audit events, and backups.
- [ ] Document client/employee data export, correction, and deletion procedures.
- [ ] Prohibit tokens, message bodies, secrets, and unnecessary personal data in logs.

## Files and messaging safety

- [ ] If launch accepts untrusted files, quarantine uploads, validate type and size, scan for malware, and release approved files before Shared Drive copy.
- [ ] If launch accepts Gmail attachments or direct project uploads, apply the same quarantine, scanning, release, and authorized-download controls to those sources.
- [x] Remove the live Gmail `FCI/Filed` label-only action and standalone API route. Any future repair action must reference an existing archive and exact project, capture a reason, and create an audit event.
- [ ] Preserve Inbox retention and human review before project filing.
- [ ] Keep replies as drafts until a person intentionally sends them.
- [ ] Before outbound SMS/email automation, implement consent, opt-out/STOP, provider-neutral delivery state, retries, application-owned durable failed jobs/dead letters, and a human exception queue.

## Monitoring and routine checks

- [ ] Create alerts for application errors, failed login spikes, database saturation/storage, and backup failures. Add queue, failed-job, Gmail-watch, Calendar-channel, quarantine, and scanner alerts only when those modules are activated.
- [ ] Create a Workspace health view with the connection account, enabled services, last success/failure, watch/channel expiry, queue health, and required owner action.
- [ ] Define severity levels, alert recipients, after-hours expectations, and escalation contacts.
- [ ] Review access quarterly, backups/restore quarterly, connector/key rotation at least annually, and incidents after every material event.
- [ ] Record service owners and vendor support links in a private operations runbook; do not put secrets in the runbook.
- [ ] Configure the default `$50/month` pre-production accidental-spend alert with named recipients; approve the estimate-based production alert separately and review actual cost monthly. Budgets alert but do not cap spend.

## Incident drill

- [ ] Disable a user and prove existing sessions stop working.
- [ ] Remove a Project Manager from a project and prove app and direct Google access are removed.
- [ ] Simulate Google API timeout/quota failure and prove work retries once without duplicate files/events.
- [ ] If Gmail watches or Calendar channels are released, expire each one and prove monitoring and renewal recover it.
- [ ] Restore the database into staging and reconcile record and audit counts.
- [ ] Drill token-encryption key rotation using the current [disconnect/reconnect procedure](../google-workspace-rollout-guide.md#token-encryption-key-rotation-current-disconnectreconnect-procedure): disconnect while the old key works, advance the non-secret version, deploy the new secret, reconnect, and verify every enabled service. Record no key or token values.
- [ ] Drill OAuth client-secret rotation using the [same-client-ID procedure](../google-workspace-rollout-guide.md#oauth-client-secret-rotation-same-client-id-no-reconnect): deploy the new secret, prove the existing connection can refresh, and prove no reconnect/consent is required. Record no secret values.
- [ ] In an approved test environment, revoke the refresh grant and follow the [`invalid_grant` recovery procedure](../google-workspace-rollout-guide.md#invalid_grant-or-revoked-refresh-token-recovery): prove the safe readiness response reports `workspace.connectionStatus = reauthorization-required`, retries stop, the authorized connection `DELETE` succeeds, the exact account reauthorizes, and independent service checks pass. The current Settings label/delete-control limitation requires authorized API support; keep this drill open if that evidence is unavailable.
- [ ] If untrusted uploads are released, quarantine a harmless antivirus test file and prove it never reaches Shared Drive.

## Completion result

This action is complete when the controls exist, two named people can follow the runbooks, restore and incident drills have dated evidence, and the owner has accepted the residual risks.
