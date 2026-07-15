# Regional HA failover and recovery evidence

Status: Source-only procedure and evidence template. No failover exercise has
been executed.

Use this runbook only when evaluating the `regional_ha` Cloud SQL profile. A
staging HA plan requires approval for this exact exercise. A production HA plan
cannot pass without a safe reference to completed staging failover evidence and
an accepted regional-outage policy. Source review alone is not evidence.

## 1. Approval and prerequisites

- [ ] Complete the common gates in [the runbook index](README.md) and obtain
  separate owner approval for the exact isolated staging exercise.
- [ ] Record the approved RPO/RTO, outage assumptions, database region/profile,
  source commit, immutable image, executor, independent verifier, abort owner,
  cost window, and cleanup plan.
- [ ] Define the regional-outage policy: what regional HA covers, what still
  requires restore or another region, who declares an outage, and who may
  authorize recovery and traffic changes.
- [ ] Use only `FCI TEST — DO NOT USE` data and non-production Workspace
  resources. Keep production and the Sites development environment unchanged.
- [ ] Pass backup/PITR restore, database grant-denial, connection-budget, and
  application readiness checks before inducing failover.
- [ ] Verify the target actually reports regional HA, its primary/standby zones
  are distinct, and no application, network, secret, DNS, or operator dependency
  silently assumes one zone.

## 2. Baseline evidence

- [ ] Record the last successful backup, PITR window, migration history, safe
  per-table counts/hashes, open database connections, active Cloud Run
  revisions, and current primary zone without recording secrets or row content.
- [ ] Start the approved availability timer and establish bounded canary reads
  and writes with deterministic identifiers and idempotency keys.
- [ ] Confirm database, application, backup, and budget alert channels are
  active and name the observer for each signal.

## 3. Controlled staging failover

- [ ] Reconfirm project, instance, profile, executor identity, and abort
  authority immediately before the operation.
- [ ] Invoke only the approved Cloud SQL failover operation. Do not combine it
  with migration, scaling, IAM, networking, secret, DNS, or Workspace changes.
- [ ] Record safe operation identifiers and UTC times for request, detected
  unavailability, new-primary readiness, application reconnection, and restored
  canary success.
- [ ] Observe connection errors, pool recovery, old/new revision behavior,
  duplicate/retried writes, latency, and alerts. Stop on target ambiguity,
  authorization drift, data mismatch, or an unbounded retry/connection surge.

## 4. Reconciliation and acceptance

- [ ] Verify the instance is healthy in regional HA after failover and record
  the new primary zone.
- [ ] Reconcile migration history, counts, identifier/content hashes,
  constraints, canary results, activity/audit evidence, idempotency records, and
  outbox state.
- [ ] Re-run runtime, migration, rehearsal, `PUBLIC`, and cross-boundary denial
  checks applicable to the exercise.
- [ ] Measure observed unavailable time and any committed-data loss against the
  approved RTO/RPO. A provider operation marked successful is not enough.
- [ ] Verify alerts fired or document why a reviewed threshold did not apply.
- [ ] Have the independent verifier record pass, fail, or aborted. Any mismatch,
  unexplained retry, exceeded target, or missing alert blocks HA selection.

## 5. Recovery, cleanup, and policy decision

- [ ] If failover is incomplete or reconciliation fails, stop writes and follow
  the approved restore-based recovery path; do not repeatedly force failover.
- [ ] Remove canary data and temporary access, preserve only sanitized evidence,
  and follow the [staging lifecycle](staging-lifecycle.md).
- [ ] Record whether regional HA plus the documented restore/regional-outage
  policy meets business needs relative to standalone cost and recovery evidence.
- [ ] The business owner accepts or rejects the profile and records a safe
  evidence reference. Do not place logs, state, data, or credentials in Git.

## Evidence summary

```text
Approval reference:
Project / region / instance / HA profile:
Source commit and image digest:
Approved RPO / observed data loss:
Approved RTO / observed unavailable time:
Old and new primary zones:
Safe failover operation reference and UTC timeline:
Connection/revision/pool observations:
Migration, count/hash, canary, audit, and denial reconciliation:
Alert result:
Exceptions and recovery action:
Regional-outage policy reference:
Independent verifier and result:
Owner HA decision and safe evidence reference:
Cleanup verification:
```
