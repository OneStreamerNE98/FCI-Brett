# Workspace-first, cost-controlled rollout

Status: Accepted

Decision date: July 14, 2026

Amends: [Production platform decision](architecture-decision-production-platform.md)

## Relationship to the production platform decision

This decision changes rollout timing, cost controls, and service-activation gates; it does not replace the accepted production architecture. Production remains a small regional Cloud Run and Cloud SQL PostgreSQL modular monolith with Google Workspace OIDC, application-owned authorization and audit controls, and feature-triggered Google Cloud services. The current Sites/Workers/D1/R2 deployment remains the one-user, test-data development environment.

The target architecture describes capabilities the application may need over time. It does **not** authorize provisioning every listed service on day one.

## Decision

- Reuse the company's existing Google Workspace Business environment for employee identities, Google Groups, the operations mailbox, Shared Drive, shared calendars, Docs, and derived Sheets reporting.
- Keep the existing Sites deployment as the active development environment. Do not add a persistent development Cloud SQL instance now.
- Maintain separate development, staging, and production project, OAuth, secret, and data boundaries. A separate boundary does not require continuously running resources.
- Keep staging normally unprovisioned or scaled down. Create it from reviewed definitions only when migration, restore, release, or rollback evidence is needed, then remove or scale down billable resources under the approved runbook.
- Provision only the minimum approved production foundation continuously: one Cloud Run application, the selected Cloud SQL PostgreSQL profile, Secret Manager integration, required monitoring, backups/PITR, and budget alerts.
- Configure the production Cloud Run service with zero minimum instances and use two as the initial planning maximum, subject to the documented connection/revision-overlap budget and adjustment from measured demand.
- Define and price both standalone/zonal and regional high-availability Cloud SQL profiles. Do not select or provision one until the owner accepts RPO/RTO, reviews official cost estimates and restore evidence, and explicitly approves the profile.
- Keep every optional infrastructure module disabled and unapplied by default. Activation requires a scheduled feature, cost estimate, security and reliability evidence, an owner, and separate approval.
- Prefer Workspace email and Calendar workflows for the first reminder release. Defer paid SMS until the messaging policy, compliance controls, provider, and spending cap are approved.

## Workspace and application responsibilities

| Existing Workspace capability | Application responsibility |
| --- | --- |
| Company accounts and verified `cherryhillfci.com` identity | Explicit invitations, active/disabled state, secure sessions, roles, capabilities, project permissions, and security audit |
| Google Groups and direct Workspace sharing | Server-enforced application authorization; a hidden control or Group membership alone is not sufficient |
| Operations Gmail mailbox | Review-first filing decisions, workflow state, permitted activity evidence, and durable exceptions; never automatic sending |
| Shared Drive and Google Docs | Released business documents; the app owns metadata, project mapping, authorization, lifecycle, and any quarantine/release state |
| Shared calendars | Display of appointments and published assignments; the app owns operational states, links, assignments, and conflict rules |
| Google Sheets | Derived directory and reporting projections only; never transactional storage or a second system of record |

AppSheet Core may be evaluated for a narrow, non-authoritative internal workflow if it is already included in the company's Workspace edition. It is not a replacement for the core app, Cloud SQL, query-scoped authorization, audit controls, or migration/recovery evidence.

Field leads may use expiring, purpose-scoped links initially, and subcontractors should receive no application or Shared Drive account by default. Those recommendations still require the owner to approve the final role and access matrix.

## Phased service activation

| Phase | Active boundary |
| --- | --- |
| Current development | Existing Sites/Workers/D1/R2 application, one user, test data, and the development Workspace test connector |
| Costed source preparation | Unapplied infrastructure definitions, standalone-versus-HA estimates, connection budgets, backup/restore procedures, and an on-demand staging runbook |
| Minimum production foundation | Cloud Run, selected Cloud SQL profile, Secret Manager integration, Workspace OIDC, users/sessions/roles/project permissions, security audit, monitoring, backups/PITR, and tested restore |
| Durable background work | Cloud Tasks and Cloud Scheduler only when synchronization, reminders, or other durable jobs are scheduled |
| Gmail and Calendar automation | Pub/Sub only when Gmail watches are implemented; Calendar HTTPS channels only when background Calendar synchronization is implemented |
| Untrusted uploads | Cloud Storage quarantine and scanning before the application accepts untrusted uploads; keep production uploads disabled until then |
| Paid messaging | SMS only after provider, consent, STOP/START/HELP, quiet hours, exception handling, retention, and spend controls are approved |
| Document retrieval | `pgvector` only when permission-filtered document indexing has approved requirements and tests |

## Cost gates

- Use a `$50/month` pre-production accidental-spend budget alert as the default planning guardrail; the owner may change it before setup and must name recipients.
- Treat Google Cloud budgets as alerts, not hard spending caps.
- Before any production provisioning, provide official calculator estimates for both standalone and regional-HA Cloud SQL and identify fixed versus usage-based costs.
- Set the production alert budget only after the database profile and expected traffic are selected. Start the proposal at 120–150% of the reviewed estimate and have the owner approve the final threshold and recipients.
- Require an estimate and owner approval before enabling an optional module. Give SMS/provider spending a separate cap and alert.
- Review actual costs after the first month and monthly thereafter, then adjust maximum instances, database sizing, retention, and alerts from measured evidence.
- Keep infrastructure definitions unapplied until separate provisioning approval.

## Reliability tradeoffs

- Standalone Cloud SQL costs less but may require manual recovery and a longer outage after an instance or zone failure.
- Regional HA costs more but provides automated failover and should be selected only when the accepted outage cost and RTO justify it.
- Zero minimum Cloud Run instances can add an occasional cold start.
- On-demand staging reduces idle cost but adds preparation time before release and recovery exercises.
- Backups and PITR are required for either database profile; neither replaces a tested restore.
- The owner must approve the RPO, RTO, maintenance expectations, database profile, and regional-outage policy before production go-live.

## Acceptance

- Existing production security and data gates remain unchanged.
- Development, staging, and production credentials and data remain isolated even when staging is dormant.
- The selected database profile satisfies the documented connection and revision-overlap budget.
- A clean staging environment can be created reproducibly when needed and safely scaled down or removed afterward.
- Migration, restore, reconciliation, rollback/forward-fix, and application smoke tests pass in staging.
- Users, sessions, roles, project permissions, security audit, backup restoration, and denial tests pass before a second user or real client data.
- Every activated optional service has a feature owner, cost approval, least-privilege identity, monitoring, failure/replay behavior, and an off or rollback procedure.

## Open owner inputs

This decision does not select the billing owner, primary region, production hostname, DNS owner, named alert recipients, RPO/RTO, database profile, deployment approver, rollback owner, or initial application administrators. Record those non-secret decisions in the task checklists before the relevant provisioning or rollout gate.

## Non-goals

This decision does not:

- authorize provisioning, migration, deployment, or hosted configuration changes;
- make Sites/Workers/D1/R2 the production data plane;
- replace Cloud SQL with Sheets, Apps Script, or AppSheet;
- eliminate staging validation;
- authorize SMS, Gmail watches, Calendar channels, untrusted uploads, scanning, or AI indexing;
- authorize a second employee or real client data.

## Next worker assignment

Create `codex/google-cloud-infrastructure-definitions` and add reviewable, unapplied definitions that:

- preserve the existing Sites development environment;
- define isolated environment boundaries while keeping staging on demand;
- separate a minimum production core from optional modules that default to disabled;
- provide costed standalone and regional-HA Cloud SQL profiles without choosing one;
- configure Cloud Run with zero minimum instances and an initial planning maximum of two, validated against the connection/revision-overlap budget;
- define private networking, service identities, Secret Manager references, backups/PITR, probes, monitoring, and budget alerts;
- document connection and revision-overlap budgets, staging lifecycle, restore, migration rehearsal, and rollback/forward-fix evidence; and
- include safe placeholders for still-open owner inputs.

Do not provision resources, add credentials, apply roles or migrations, connect Workspace, migrate data, deploy, or merge.

## Official references

- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing/)
- [Cloud SQL high availability](https://docs.cloud.google.com/sql/docs/postgres/high-availability)
- [Cloud Tasks pricing](https://cloud.google.com/tasks/pricing)
- [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing)
- [Secret Manager pricing](https://cloud.google.com/secret-manager/pricing)
- [Cloud Billing budgets and alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [Google Cloud resource hierarchy](https://docs.cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy)
- [AppSheet licensing through Google Workspace](https://support.google.com/appsheet/answer/10105400)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Google Sheets API limits](https://developers.google.com/workspace/sheets/api/limits)
