# Google Cloud alert triage and escalation

Status: Source-only response matrix. No notification channel, alert delivery,
incident response, or escalation exercise has been run by adding this file.

Before core activation, apply the budget/email guardrails alone, verify delivery
to every recipient, and record the safe evidence reference required by the
Terraform gate. Alert delivery is not proven by a successful plan.

## Response levels

| Level | Meaning | Initial owner | Escalation |
| --- | --- | --- | --- |
| Advisory | Forecast or early threshold; no current service failure | Cloud administrator | Business owner if trend persists or budget/profile assumptions change |
| Urgent | Capacity, application, or backup signal needs prompt investigation | On-call operations/recovery administrator | Deployment/rollback owner and business owner when user impact, data risk, or unapproved spend is possible |
| Critical | Confirmed data-integrity, authorization, unrecoverable availability, or uncontrolled-spend risk | Rollback/recovery owner | Business owner immediately; stop writes or rollout under the approved incident policy |

The owner must supply names, contacts, coverage hours, acknowledgement targets,
and accepted emergency delegations before live use. This matrix does not grant
deployment, migration, teardown, or production-change authority.

## Defined source alerts

| Signal | Initial level | First checks | Required next evidence |
| --- | --- | --- | --- |
| Budget 50% or forecast 100% | Advisory | Correct project/billing scope, expected staging window, delayed charges, active resources | Dated cost review and owner decision; a budget is not a cap |
| Budget 90% or current 100% | Urgent | Same checks plus unapproved resources/traffic and teardown status | Owner-approved continue/scale-down response and final-charge verification |
| Cloud SQL CPU or disk above 80% | Urgent | Exact instance, workload/revision change, query/storage trend, backup state | Safe metric timeline, cause, approved remediation, post-change result |
| Cloud SQL connections above 80% of reviewed usable budget | Urgent | Exact instance, pool/max instances, overlapping revisions, jobs/admin sessions | Compare planned/observed connections; stop rollout on an unbounded surge |
| Automated backup failed, attempt failed, or skipped | Urgent; Critical if recovery window is at risk | Exact instance, system-event status/message, last successful backup/PITR window | Follow the backup runbook; record safe operation/result and RPO impact |
| Cloud Run application 5xx | Urgent | Exact service/revision/digest, readiness, database/connectivity, rollout timing | Safe error/correlation summary and approved rollback/forward-fix decision |

Cloud SQL exposes automated-backup status through system-event audit logs, not a
native backup-age metric. The source alert catches failed/attempt-failed/skipped
events; the operator must still verify last-success age during daily/approved
operational checks until a separately approved health-check design exists.

## Universal response steps

- [ ] Acknowledge with UTC time, signal, environment, exact resource, responder,
  and safe incident reference; never paste secrets, state, plan JSON, tokens, or
  client data.
- [ ] Verify the alert belongs to FCI and is not an unrelated project resource.
- [ ] Classify advisory/urgent/critical and notify the named authority.
- [ ] Preserve service and data safety. Stop rollout/writes when target,
  authorization, integrity, recovery point, or decision authority is ambiguous.
- [ ] Use the applicable backup, failover, migration/recovery, or staging
  runbook. Do not improvise production changes or auto-send messages.
- [ ] Record cause, decision authority, action, user/data/cost impact, recovery,
  remaining risk, and independent verification.
- [ ] Close only after the signal is healthy, reconciliation passes, follow-up
  work is tracked, and notification/monitoring gaps are recorded.

## Delivery exercise evidence

```text
Approval and source commit:
Environment/project:
Channel and intended recipients:
Test signal and UTC time:
Delivery/acknowledgement times by recipient:
Routing level and escalation result:
Missing/delayed notifications:
Safe evidence reference:
Independent verifier:
Owner acceptance or blocker:
```
