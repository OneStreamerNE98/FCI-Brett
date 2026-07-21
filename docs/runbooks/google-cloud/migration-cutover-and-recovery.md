# Migration rehearsal, cutover, rollback, and forward-fix

Status: Source-only procedure and evidence template. No staging migration,
production cutover, rollback, or forward-fix has been executed.

There are no automatic down migrations. Applied migration versions, names,
statements, and checksums are immutable. Prefer a reviewed forward-fix for a
compatible defect; a restore-based rollback requires stopped writes,
reconciliation, and explicit owner approval.

Implementation status: the repository now defines default-off migration and
staging rehearsal Cloud Run Jobs, a keyless repository-scoped image-publisher
identity, and a pull-request build/manual-approved image-publish workflow. The
workflow publishes an immutable image candidate only; it cannot apply
Terraform, deploy a service, or execute a Job. These definitions are source-only
and unapplied. Every execution step remains blocked until the owner separately
approves the protected GitHub environment and Workload Identity pool, exact
image digest and Terraform plan, database principals and pinned secret versions,
test-only rehearsal snapshot, least-privilege review, executor/verifier, cost
window, and cleanup procedure.

## 1. Staging migration rehearsal

- [ ] Complete the common gates in [the runbook index](README.md), the
  [staging lifecycle](staging-lifecycle.md), and the
  [restore runbook](backup-pitr-restore-and-reconciliation.md).
- [ ] Approve the exact source commit, immutable image digest, migration
  registry, source snapshot format, destination schema, identities, timeouts,
  and abort criteria.
- [ ] Inventory every source category and record its disposition: migrated,
  transformed, intentionally excluded, or blocking. Unknown categories block
  completion.
- [ ] Confirm all rehearsal data is test-only and clearly named
  `FCI TEST — DO NOT USE`; exclude OAuth attempts, refresh/access tokens,
  credentials, and secret material.
- [ ] Verify a restorable pre-migration backup and record the restore point.
- [ ] Apply the reviewed database role policy and pass denial checks.
- [ ] Run the immutable migration command with the dedicated migration identity,
  one connection, approved schema owner role, advisory lock, and bounded
  timeouts. Normal application requests must not run migrations.
- [ ] Run the bounded core rehearsal only in an isolated `fci_rehearsal_*`
  schema with the restricted importer.
- [ ] Record per-table source/destination counts, identifiers, content hashes,
  relationships, audit meaning, duplicates, exclusions, duration, and errors.
- [ ] Run application smoke and denial paths using only non-production Workspace
  resources and credentials.
- [ ] Exercise the approved forward-fix or restore-based rollback path and repeat
  reconciliation after recovery.

The current format-version-2 bounded core rehearsal always reports
`cutoverReady: false`. Its report inventories all 22 D1 tables plus R2 with a
reasoned disposition. Only clients, contacts, leads, projects, project meetings,
and classified activity carry bounded rows and receive end-to-end hash
reconciliation. Project rows must include explicit null `flooringCategory`,
`squareFeet`, and `contractValue` placeholders in the hashed format-v2 shape;
non-null KPI values remain deferred to KPI-04 and fail before database access.
Every inventory-only category must likewise remain zero or the command fails
before database access. Passing it is useful source evidence but is not a
complete migration or cutover rehearsal.

## 2. Production go/no-go gate

Do not schedule production cutover until every item is checked and the owner
gives a separate dated approval:

- [ ] The complete production schema, persistence/storage boundaries,
  employee application composition, secure sessions, authorization, project
  scoping, security audit, and denial tests pass.
- [ ] The selected Cloud SQL profile, RPO/RTO, restore evidence, connection and
  revision-overlap budget, monitoring, alerts, production hostname/DNS owner,
  deployment approver, and rollback owner are accepted.
- [ ] A clean staging environment has reproduced migration, restore,
  reconciliation, rollback/forward-fix, and application smoke evidence.
- [ ] The production migration mapping covers every record/file/integration
  category and explicitly excludes tokens and development credentials.
- [ ] The write-freeze owner, communication plan, cutover window, rollback
  deadline, rollback triggers, degraded-mode plan, and decision authority are
  recorded.
- [ ] The connector recovery plan identifies the company connection account,
  separate employee-login and data-connector OAuth clients, reauthorization
  owner, scope verification, token-key version/rotation response, Gmail watch
  and Calendar channel renewal, Drive/Sheets reconciliation, and duplicate-safe
  replay. Never record a client secret or token in this plan.
- [ ] Define exactly which application paths remain usable when Google is
  unavailable and which writes/side effects fail closed. No generic read-only
  or queued degraded mode exists today; that remains a blocker until its data,
  authorization, user messaging, recovery, and reconciliation behavior is
  implemented and tested.
- [ ] A final production plan shows only approved resources and changes.
- [ ] The current development deployment and data remain preserved until the
  rollback window closes and the owner approves disposition.

## 3. Controlled production cutover

- [ ] Announce the approved window and confirm executor, verifier, deployment
  approver, rollback owner, and incident channel are present.
- [ ] Freeze source writes and prove the freeze; do not rely on a UI-only notice.
- [ ] Record final source counts/hashes and create/verify the approved restore
  point before any production migration.
- [ ] Deploy only the approved immutable image and infrastructure revision.
- [ ] Run migrations through the separate migration job/identity and record the
  exact immutable migration-history result.
- [ ] Transform/import reviewed data in bounded, restartable steps with durable
  checkpoints and no provider side effects.
- [ ] Reconcile counts, identifiers, content hashes, relationships, permissions,
  security audit, files, and integration mappings before opening access.
- [ ] Run health/readiness plus authorized, unauthorized, and critical workflow
  smoke tests. Do not automatically send Gmail or SMS messages.
- [ ] Have the deployment approver make and record the go/no-go decision before
  switching the production hostname or admitting users.
- [ ] Monitor errors, latency, database connections/storage, audit events, and
  budget signals throughout the time-boxed rollback window.
- [ ] If Workspace authorization or a connector fails, stop Google side effects,
  preserve safe failure/correlation evidence, follow the approved
  reauthorization/reconciliation path, and re-run duplicate/omission checks
  before resuming. Do not auto-send messages while recovering.

## 4. Recovery decision

| Condition | Default response | Required authority |
| --- | --- | --- |
| Compatible application defect; database and audit evidence remain valid | Stop rollout as needed and deploy a reviewed forward-fix | Business owner plus deployment approver, or an exact pre-approved emergency delegation |
| Compatible schema defect with a safe additive correction | Add a new immutable forward-fix migration; never edit applied history | Business owner, migration reviewer, and deployment approver, or an exact pre-approved emergency delegation |
| Reconciliation mismatch, destructive schema defect, corrupted state, or unsafe authorization | Stop writes and invoke the restore-based rollback plan | Rollback owner and business owner |
| Target, data classification, restore point, or authority is ambiguous | Abort and preserve evidence; make no switch | Any executor may stop; owner decides next action |

### Forward-fix controls

- [ ] Use a new reviewed commit, image, and migration version where applicable.
- [ ] Preserve the original failure and applied migration evidence.
- [ ] Re-run migration-history, reconciliation, denial, readiness, and smoke
  checks before resuming access.

### Restore-based rollback controls

- [ ] Keep writes stopped and record the exact rollback decision time.
- [ ] Restore the verified pre-cutover backup into a controlled target; do not
  destructively rewrite the only copy of either database.
- [ ] Reconcile restored counts, identifiers, hashes, permissions, and audit
  evidence before switching traffic.
- [ ] Switch only with explicit rollback-owner and business-owner approval.
- [ ] Record the disposition of post-freeze/post-cutover events and any accepted
  data loss against the approved RPO.

## Evidence summary

```text
Approval and change references:
Source commit / image digest / migration registry:
Source inventory and exclusions:
Pre-change backup and restore point:
Write-freeze evidence:
Migration job result and exact history:
Counts/hash/relationship reconciliation:
Authorization, denial, readiness, and smoke results:
Go/no-go decision and decision maker:
Production switch time (UTC), if approved:
Rollback window and monitoring result:
Forward-fix or rollback decision/result:
Connector/degraded-mode and reconciliation result:
Exceptions, accepted loss, and residual risk:
Final independent verification:
```
