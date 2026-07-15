# On-demand staging lifecycle

Status: Source-only procedure and evidence template. Not executed.

Use this procedure only for an owner-approved migration, restore, release, or
rollback exercise. Staging is temporary and isolated; it is not a continuously
running development environment.

## 1. Approval and preflight

- [ ] Record the common gates from [the runbook index](README.md).
- [ ] Record the exercise objective, acceptance criteria, approved start/end
  time, maximum estimated cost, and named teardown owner.
- [ ] Confirm the staging project, infrastructure state, service identities,
  secrets, database, storage, and Workspace test resources are non-production
  and distinct from both development and production.
- [ ] Confirm the separately approved state bucket has environment isolation,
  uniform bucket-level access, public-access prevention, versioning/retention,
  reviewed encryption, keyless least-privilege IAM, recovery access, and audit
  logging. The checked-in backend file is only a placeholder.
- [ ] Confirm the reviewed infrastructure plan targets only the approved staging
  project and region. Attach a sanitized plan summary; never attach state or
  secret values.
- [ ] Confirm the pre-production budget alert and recipients are configured.
  A budget is an alert, not a hard spending cap.
- [ ] Confirm optional modules remain disabled and the selected staging database
  profile, backup settings, connection limit, Cloud Run maximum instances, and
  pool size fit the documented connection budget.
- [ ] Confirm test fixtures and any migration snapshot contain only
  `FCI TEST — DO NOT USE` records and no OAuth/token material.
- [ ] Name the executor, independent verifier, and person authorized to abort.

Approval record:

```text
Approval reference:
Approved objective:
Approved project ID and region:
Approved resources/profile:
Approved cost and time window:
Approved data classification:
Executor / verifier / teardown owner:
Abort authority and contact:
Guardrail-only apply and delivery-verification reference:
Network-range review reference:
```

## 2. Create and validate

- [ ] First apply only `enable_guardrails = true` with `enable_core = false` in
  the approved staging project. Verify the budget scope/thresholds and delivery
  to every named notification recipient, then record a safe evidence reference.
  Do not activate Cloud SQL or another billable core resource in this step.
- [ ] Add the verified guardrail reference to the core approval input. The core
  gate and Cloud SQL dependency block activation without it; never bypass that
  ordering with targeting or manual creation.
- [ ] Re-read the plan immediately before creation and stop on an unexpected
  project, region, resource, IAM binding, API, optional module, or deletion.
- [ ] Create only the resources in the approved plan using the approved
  identity. Do not create or change production or the Sites development stack.
- [ ] Record immutable infrastructure source and image identifiers.
- [ ] Verify private database connectivity, least-privilege identities, Secret
  Manager references, zero Cloud Run minimum instances, bounded maximum
  instances, probes, logging, database alerts, backup/PITR settings, and budget
  alerts.
- [ ] Run [database role and grant denial checks](database-role-and-grant-denial-checks.md)
  before application or migration testing.
- [ ] Verify `/healthz` and `/readyz` according to the staged application state.
  The current foundation may be healthy while employee application paths still
  intentionally return `503`; do not report that source boundary as a complete
  application smoke pass.

## 3. Run the approved exercise

- [ ] Execute only the procedure named in the approval record.
- [ ] Use the [restore runbook](backup-pitr-restore-and-reconciliation.md) for a
  backup/PITR exercise and the [migration runbook](migration-cutover-and-recovery.md)
  for migration or release work.
- [ ] Capture UTC timestamps, safe operation identifiers, expected/actual
  results, counts, hashes, latency, connection/revision overlap, alerts, and
  exceptions without capturing secrets or client content.
- [ ] Stop on target ambiguity, unexpected real data, privilege broadening,
  migration-history mismatch, failed reconciliation, unbounded cost, or a
  request to expand beyond the approved scope.

## 4. Teardown or scale-down

- [ ] Confirm the exercise is finished or formally aborted and the verifier has
  accepted the evidence needed before cleanup.
- [ ] Preserve only the approved sanitized evidence, infrastructure source, and
  required backup/restore metadata. Do not export secrets or Terraform state to
  the repository.
- [ ] Revoke temporary human, migration, rehearsal, and break-glass access.
- [ ] Remove temporary data and credentials according to the approved retention
  policy. Never delete the source backup or production data as staging cleanup.
- [ ] Review a destruction/scale-down plan and verify every target belongs to the
  approved staging boundary before executing it.
- [ ] Do not use `enable_core = false` as a teardown shortcut. Once activated,
  Terraform's core and guardrail locks block that transition. Teardown requires
  a separately reviewed source change that removes only the core lock for this
  approved exercise; keep `enable_guardrails = true`.
- [ ] Remove or scale down only the approved billable staging resources. Preserve
  separately approved project, audit, billing, and state records required for
  future accountability.
- [ ] Verify Cloud Run minimum instances are zero or the service is removed,
  temporary Cloud SQL resources are removed as approved, optional feature
  resources remain absent, temporary secrets/access are gone, and no staging
  cost continues unexpectedly. Previously enabled APIs may remain enabled and
  inert; disabling a project service requires separate dependency review.
- [ ] Retain the budget and email notification channels through the approved
  post-teardown billing window. Have the independent verifier record final UTC
  cleanup time, delayed/final charges, and separate approval before any later
  guardrail removal.

### Controlled activation-lock change

This is a future approval procedure, not authorization to run it:

- [ ] The business owner approves the exact staging state, resource inventory,
  cleanup scope, source commit, executor, independent verifier, and rollback
  response. Record why normal scale-to-zero is insufficient.
- [ ] In a reviewed branch, change only the staging core activation lock needed
  for the approved teardown. Do not use `terraform state rm`, remove the module,
  unlock production, or unlock the guardrail control in the same change.
- [ ] Run all Terraform/CI tests, obtain independent review, and produce a fresh
  destroy/scale-down plan proving that only approved staging core addresses are
  affected and `enable_guardrails = true` remains.
- [ ] Obtain a second explicit owner approval for that exact plan immediately
  before execution. Stop on drift or any unlisted deletion.
- [ ] After verified cleanup, restore the activation lock in source before any
  later staging activation and record source/state/plan evidence. Guardrail
  retirement, if ever approved after final charges, uses a separate change and
  the same two-person review.

## Evidence summary

```text
Creation plan summary/reference:
Created resources:
Validation and probe result:
Exercise result/reference:
Peak database connections and revision overlap:
Alerts observed:
Exceptions:
Teardown plan summary/reference:
Resources removed or scaled down:
Temporary access revoked:
Remaining resources and justification:
Expected final charges:
Independent verification:
```

Staging evidence does not authorize production provisioning, deployment,
cutover, a second user, or real client data.
