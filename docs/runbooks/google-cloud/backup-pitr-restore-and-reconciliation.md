# Backup, PITR restore, and reconciliation

Status: Source-only procedure and evidence template. No backup or restore has
been executed.

The objective is to prove that reviewed backup and point-in-time recovery
controls can restore into a new isolated staging target, preserve required
evidence, and meet the approved RPO/RTO. Never overwrite the source database as
part of a restore test.

## 1. Gates and inputs

- [ ] Complete the common gates in [the runbook index](README.md) and obtain
  separate approval for this restore exercise.
- [ ] Record the approved RPO, RTO, backup retention/location policy, source
  database profile, restore region, restore-point time, executor, verifier, and
  cleanup owner.
- [ ] Confirm the destination is a new isolated staging target with equivalent
  security, encryption, logging, and restricted access.
- [ ] Before real client data exists, use only production-format test data named
  `FCI TEST — DO NOT USE`. A future drill using a production backup requires
  explicit sensitive-data approval, production-equivalent controls, and an
  approved deletion/retention plan.
- [ ] Confirm a known-good source checkpoint: UTC timestamp, immutable migration
  history, canonical table counts, identifier/content hashes, and application
  source/image identifiers.
- [ ] Confirm no secret, token, database URL, or row content will enter the
  evidence record.

## 2. Backup and PITR configuration evidence

- [ ] Record automated-backup schedule, retention, backup region/location,
  transaction-log retention, PITR window, deletion protection, and alert state.
- [ ] Verify the selected recovery point is inside the retained window.
- [ ] Record a safe backup or operation identifier and its completion time.
- [ ] Verify the backup is restorable before freezing the recovery timer.

Do not treat “backup enabled” or an operation marked complete as restore proof.

## 3. Restore exercises

Run both paths when required by the approved acceptance scope:

### Backup restore

- [ ] Start the RTO timer at the approved trigger point.
- [ ] Restore the selected completed backup into a newly named staging target.
- [ ] Record operation start/completion, target identity, and safe failure codes.

### Point-in-time restore

- [ ] Start the RTO timer at the approved PITR trigger point.
- [ ] Choose and record an unambiguous UTC target time tied to the checkpoint.
- [ ] Restore into a separate new staging target; do not reuse or overwrite the
  backup-restore target unless the approved plan explicitly permits it.
- [ ] Record the last expected committed record and the first record that must be
  absent after the chosen point.
- [ ] Record operation start/completion, target identity, and safe failure codes.

For each target, keep network access restricted until database-level
reconciliation passes.

## 4. Reconciliation

- [ ] Confirm the target project, instance, database, schema, and restore point.
- [ ] Confirm migration version, name, and checksum history exactly matches the
  reviewed source registry; do not edit applied history.
- [ ] Run database integrity checks for constraints, foreign keys, required
  indexes, duplicate identifiers, and orphan relationships.
- [ ] Compare canonical per-table counts, identifier hashes, and content hashes
  for every in-scope table, including clients, contacts, projects, activities,
  idempotency/outbox control records, users, permissions, and security audit when
  those schemas exist.
- [ ] Mark a required but unimplemented schema or reconciliation tool as a
  blocker. Do not convert it to a passing “not applicable” result.
- [ ] Verify the runtime role has the expected grants and denial behavior.
- [ ] Start the approved application image, verify health/readiness, and run
  authorized and denied smoke paths without contacting production Workspace
  resources or sending messages.
- [ ] Stop the RTO timer only when the restored application is usable under the
  approved acceptance definition.
- [ ] Calculate observed recovery-point loss and elapsed recovery time, then
  compare both with approved RPO/RTO.

## 5. Disposition and cleanup

- [ ] The verifier records pass, fail, or aborted; unresolved differences block
  cutover and production acceptance.
- [ ] Preserve a sanitized reconciliation summary and safe operation references.
- [ ] Follow the [staging lifecycle](staging-lifecycle.md) to revoke temporary
  access and remove the restored targets within the approved retention window.
- [ ] Confirm the source database and source backup were not changed or deleted.
- [ ] Create tracked follow-up work for every exception before closing the drill.

## Evidence summary

```text
Approval reference:
Approved RPO / observed recovery point:
Approved RTO / observed elapsed time:
Source checkpoint (UTC):
Backup and PITR configuration summary:
Safe backup/operation references:
Backup restore target and result:
PITR target time, target, and result:
Migration history comparison:
Counts/hash reconciliation result:
Integrity and denial-check result:
Application smoke result:
Differences and blockers:
Cleanup and independent verification:
```
