# Google Cloud operations runbooks

Status: Source-only templates. No Google Cloud resource, database role, backup,
migration, restore, cutover, rollback, or teardown exercise has been run by adding
these files.

These runbooks define the evidence expected from future, separately approved
staging and production work. They do not authorize provisioning, deployment,
configuration changes, data movement, or access to a live environment.

## Runbook index

| Runbook | Purpose |
| --- | --- |
| [On-demand staging lifecycle](staging-lifecycle.md) | Approve, create, validate, collect evidence from, and remove or scale down an isolated staging environment. |
| [Backup, PITR restore, and reconciliation](backup-pitr-restore-and-reconciliation.md) | Prove that a backup and a point-in-time restore can produce a usable, reconciled target without overwriting the source. |
| [Migration rehearsal, cutover, rollback, and forward-fix](migration-cutover-and-recovery.md) | Rehearse the complete migration path and control any later production cutover or recovery decision. |
| [Database role and grant denial checks](database-role-and-grant-denial-checks.md) | Verify the migration, runtime, rehearsal, and `PUBLIC` database boundaries with positive and negative evidence. |
| [Regional HA failover](regional-ha-failover.md) | Exercise zonal failover, reconnect/reconcile the application, measure RPO/RTO, and accept or reject the HA profile and regional-outage policy. |
| [Alert triage and escalation](alert-triage-and-escalation.md) | Verify notification delivery and route budget, database, backup, and application alerts without granting production-change authority. |

## Gates common to every runbook

- [ ] The business owner has approved the exact exercise, environment, scope,
  executor, verifier, cost window, and cleanup plan.
- [ ] Required owner inputs are recorded: organization/project boundary, region,
  billing authority, alert recipients, RPO/RTO, deployment approver, and rollback
  owner as applicable.
- [ ] Development, staging, and production projects, credentials, secrets, state,
  Workspace resources, and data remain isolated.
- [ ] The current Sites/Workers/D1/R2 environment remains the one-user,
  test-data development environment; no persistent development Cloud SQL
  instance is created.
- [ ] Optional Tasks, Scheduler, Pub/Sub, Calendar channel, quarantine/scanning,
  SMS, and `pgvector` capabilities remain disabled unless separately approved.
- [ ] Pre-production fixtures, snapshots, and evidence use only records clearly
  named `FCI TEST — DO NOT USE` and contain no OAuth/token material. An approved
  isolated smoke test may reference non-production credentials only through
  Secret Manager under the named staging identity; never copy their values into
  data, source, state attachments, or evidence.
- [ ] Secrets, tokens, passwords, database URLs, OAuth JSON, private business
  data, and unredacted logs will not be written to Git, tickets, or evidence
  attachments.
- [ ] A second qualified person will verify the result and cleanup evidence.

An unchecked gate is a blocker, not an invitation to infer approval.

## Evidence header

Copy this header into the approved private evidence record for each exercise.
Only a sanitized summary or non-secret evidence reference belongs in the public
repository.

```text
Exercise:
Change/approval reference:
Environment and project ID:
Source commit:
Immutable image digest, if used:
Database profile:
Region:
Started at (UTC):
Completed at (UTC):
Executor:
Independent verifier:
Result (pass/fail/aborted):
Safe evidence location/reference:
Exceptions and residual risk:
Cleanup completed at (UTC):
Cleanup verified by:
```

Do not mark a checklist or acceptance gate complete from a source review alone.
Completion requires dated execution evidence from the approved environment.
