# Task checklist: Build the production foundation and migration path

Owner: Codex/developer and Google Cloud administrator

Status: In progress — BE-12/#53 remains in draft review and is not merged, applied, configured, or deployed.
BE-09/#51 is complete in source, merged, and undeployed; no migration, grant, hosted configuration, or infrastructure was applied.

Source-definition prerequisite: Approved company domain and the accepted rollout guardrails below. Region, billing, hostname, alert recipients, recovery targets, database profile, and the [20-user operating model](06-20-user-operating-model-and-access.md) may remain explicit variables while definitions are prepared, but they are mandatory blockers to applying resources, staging rehearsal, or production rollout.

The current Sites/Workers/D1/R2 deployment remains a one-user development environment using test data. Production should use the smallest Google Cloud topology that safely supports about 20 staff.

Merged PR #51 provides the production core-record route slice in source without completing any checkbox below.
Draft PR #53 proposes the expanded test-only rehearsal inventory. Its review status does not complete any checkbox below. In particular, #53's disposable PostgreSQL CI evidence is not an approved hosted staging rehearsal, production migration/grant apply, or live-data operation.

The accepted [Workspace-first, cost-controlled rollout](../architecture-decision-workspace-first-cost-controlled-rollout.md) preserves the target architecture while separating day-one production core from feature-gated services.

The source-only [Google Workspace watch, queue, and sync-state design](../google-workspace-watch-and-queue-design.md) now records the future Gmail polling and Calendar HTTPS-channel decisions and supplies provider-neutral local contract fakes. It activates nothing; every unchecked infrastructure, persistence, reliability, and drill gate below remains open.

## Accepted rollout guardrails

- [x] Reuse existing Google Workspace for company identity and collaboration while keeping Cloud SQL as the operational system of record.
- [x] Keep Sites/Workers/D1/R2 as the active development environment; do not run a persistent development Cloud SQL instance now.
- [x] Isolate development, staging, and production project/credential/data boundaries while keeping billable staging resources on demand.
- [x] Define a minimum production core separately from optional modules, which remain disabled and unapplied until their feature gates pass.
- [x] Price standalone/zonal and regional-HA Cloud SQL profiles before the owner selects one.
- [x] Use `$50/month` as the default pre-production accidental-spend alert planning value. This is an alert, not a cap; the owner still must name recipients and may change the amount before setup.

## Owner inputs

- [ ] Select the Google Cloud organization/billing account and primary region.
- [x] Approve separate development, staging, and production project, credential, and data boundaries; staging is on demand rather than continuously running.
- [ ] Approve the production hostname and DNS owner.
- [ ] Confirm pre-production alert recipients and approve the estimate-based production alert budget and recipients.
- [ ] Set recovery targets: RPO (acceptable data loss window) and RTO (acceptable outage duration).
- [ ] Name the deployment approver and emergency rollback owner.

## Minimum topology

- [ ] Containerize the complete Next.js employee application for one regional Cloud Run service. The source-only Cloud Run image, narrow employee API/OIDC boundary, and default-off service/job definitions are merged, but the full interface and remaining routes/providers are not yet composed.
- [ ] Keep authenticated task and webhook handlers in the modular monolith initially; do not create microservices without an operational reason.
- [ ] Define separate standalone/zonal and regional-HA Cloud SQL production profiles with private connectivity, pooling, connection caps, backups, PITR, and alerting; provide official cost estimates and keep both unapplied until the owner selects one. The [source-only Terraform definitions](../../infrastructure/google-cloud/README.md) and [dated rate-based illustration](../../infrastructure/google-cloud/cost/README.md) now exist and are unapplied; the approved region, backup location, calculator export, all-service estimate, and profile selection remain open.
- [x] Define an isolated staging database that is created only for approved migration, restore, release, or rollback exercises and safely scaled down or removed afterward. The staging root defaults off, development is inert, and the [staging lifecycle runbook](../runbooks/google-cloud/staging-lifecycle.md) requires separate approval and teardown evidence. No staging or development database was created.
- [ ] Put OAuth credentials, token-encryption keys, session secrets, and provider credentials in Secret Manager.
- [ ] Define disabled Cloud Tasks queue modules for future synchronization, filing, retry, reminder, and webhook work, with idempotency keys and bounded retry policies. Provision only when the associated feature is scheduled and approved.
- [ ] Persist jobs, execution attempts, terminal failures, alert state, and controlled replay in application-owned records; Cloud Tasks is not the durable dead-letter/replay system of record.
- [ ] Define disabled Cloud Scheduler modules for future outbox dispatch, expired-lease recovery, Gmail/Calendar renewal and reconciliation, cleanup, and long-range reminder materialization. Activate only with approved durable jobs.
- [ ] Define Pub/Sub only when Gmail push notifications are scheduled. Renew live Gmail watches at least every seven days; daily renewal is safer.
- [ ] Define expiring HTTPS notification channels only when Calendar background synchronization is scheduled. Calendar does not publish changes through Pub/Sub.
- [ ] Keep production untrusted uploads disabled until Cloud Storage quarantine, scanning, release, and exception handling are approved and provisioned.
- [ ] Defer `pgvector` until permission-filtered document indexing has approved requirements and tests.
- [ ] Co-locate active Cloud Run, Cloud SQL, Tasks, and Storage resources where practical and reuse pooled network connections; dormant modules create no resources.

## Data and code migration

- [x] Move the D1 development schema and integrity indexes into the ordered Drizzle/Sites deployment migration sequence, remove schema DDL from normal request paths, and retain an explicit local-only migration command. This development migration path does not complete the provider-neutral production database work below.
- [x] Prove the provider-neutral creation boundary for clients and projects with application services, repository/mirror ports, D1 development adapters, capability tests, and preserved development HTTP behavior. Source-only PostgreSQL composition now includes client/project/lead/project-meeting writes and scoped lead/meeting reads; its four core-record creation POSTs use the production session/CSRF/idempotency/envelope contract. Broader employee routing remains open.
- [x] Add the source-only PostgreSQL core schema for clients, contacts, projects, business activity events, actor-scoped idempotency requests, outbox events, and immutable migration history. It is tested but not applied to Cloud SQL. See [Production PostgreSQL foundation](../production-postgresql-foundation.md).
- [x] Add a separate general append-only security-audit model for authentication, sessions, roles, permissions, exports, files, connectors, jobs, and recovery. The source model, trigger, atomic repository helper, insert-only runtime grant, negative tests, and narrow employee-route authorization evidence exist; broader operational route coverage remains open. See [Production persistence boundary](../production-persistence-boundary.md).
- [x] Add source-only PostgreSQL client/project adapters with atomic actor-scoped idempotency, transactional activity/outbox writes, safe `bigint`/`numeric` handling, version-fenced outbox transitions, and PostgreSQL 16 repository tests. They are composed into the fail-closed source runtime and its narrow employee routes but are not migrated, applied, or deployed. See [Production PostgreSQL repositories](../production-postgresql-repositories.md).
- [x] Add a source-only, fail-closed Cloud Run runtime boundary with validated private Cloud SQL configuration, bounded runtime/migration/rehearsal pools, exact database readiness, separate job entry points, and production repository composition. Dashboard, search, project/client/lead/project-meeting read/write, administration, and logout routes are source-composed; protected file, Gmail, and Calendar routes return `503 feature_unavailable` after authorization because live provider adapters are absent. See [Google Cloud runtime foundation](../google-cloud-runtime-foundation.md).
- [x] Define source-only least-privilege migration-owner, runtime, and isolated rehearsal-role policies. No roles or grants have been applied to a database.
- [x] Add a strict bounded core rehearsal harness and safe fixture that preserve test identifiers and verify per-table counts plus content/identifier hashes. BE-12's source-only format v2 inventory classifies all 21 D1 tables plus R2 and expands the bounded import to clients, contacts, leads, projects, project meetings, and classified activity; every inventory-only category remains zero-only. This is automated source evidence, not the required staging rehearsal or cutover rehearsal below, and it has not been executed against a database.
- [ ] Replace remaining development text relationship IDs with PostgreSQL foreign keys; the bounded client/contact/project production foundation now uses indexed foreign keys.
- [ ] Add constrained status values, timestamps, version fields, and normalized meeting/action/task records.
- [ ] Extend the completed client/project request-idempotency constraints to Google archives, Drive mappings, Calendar channels, and later queued operations.
- [ ] Wrap lead conversion and other multi-record state changes in database transactions.
- [x] Define provider-neutral production database and object-storage interfaces before replacing Cloudflare bindings. Identity, security-audit, integration, and file repositories plus conditional opaque-generation object storage now exist in source; D1/R2 routes and hosted data remain unchanged. See [Production persistence boundary](../production-persistence-boundary.md).
- [x] Add a production migration runner with LF-normalized immutable checksums, a dedicated-connection advisory lock, post-lock prefix validation, one transaction per version, PostgreSQL 16 CI coverage, and a reviewed restore/forward-fix rollback strategy. No environment has been migrated.
- [ ] Rehearse development-to-staging migration using test data, preserving identifiers and audit evidence.
- [ ] Freeze development writes, reconcile counts and hashes, cut over, and retain a time-boxed rollback window only after acceptance.

## Multi-user and Google reliability work

- [ ] Add optimistic concurrency to editable records and show users a conflict instead of overwriting newer work.
- [ ] Wire the completed transactional outbox repository to a live queued mirror and add single-flight synchronization.
- [ ] Add timeouts, bounded retries with backoff, quota handling, idempotency, and correlation IDs to every Google operation.
- [ ] Persist Gmail watch/history and Calendar channel/sync-token state, renew it safely, and reconcile periodically because notifications are change hints rather than an authoritative event stream.
- [ ] Refresh OAuth tokens through a cache/single-flight path and distinguish transient Google failure from required reauthorization.
- [ ] Remove the dual source of truth for saved versus environment Calendar and Workspace resource IDs.
- [x] Implement and test source-only exact-version multi-key decrypt/re-encrypt behavior (BE-08 / PR #45). Live secret delivery, credential grants, provider composition, and a production rotation drill remain gated.

## Infrastructure and delivery controls

- [ ] Define costed infrastructure as code or an equivalently reviewable, repeatable procedure with Sites development preserved, staging on demand, zero-minimum/bounded-maximum Cloud Run, separate database profiles, and optional modules disabled by default. The [Google Cloud source definitions](../../infrastructure/google-cloud/README.md), mocked plan tests, lifecycle locks, dated Cloud SQL comparison, and PR #47's default-off image/service/migration/rehearsal release definitions are complete and unapplied; approved all-service calculator evidence and final cost review remain before this item can close.
- [ ] Use least-privilege service accounts and keep production deployment access separate from routine development.
- [ ] Complete production observability. Source-only process liveness and exact database readiness exist; structured logs, trace/correlation IDs, queue-depth alerts, database alerts, connector health, and budget alerts remain.
- [ ] Add security headers, request-size limits, authentication rate limits, and sensitive-route rate limits.
- [ ] Run lint, build, unit, integration, route, migration, authorization, and browser smoke tests in CI.
- [ ] Document how staging uses non-production Workspace resources and credentials.

## Completion result

This action is complete when a clean staging environment can be provisioned reproducibly on demand, test data can be migrated and rolled back, concurrent writes are protected, backup/PITR restore passes for the selected database profile, failover passes if HA is selected, every launch-enabled Gmail/Calendar/file feature passes its applicable retry and recovery tests, and the owner approves the production cutover plan. Dormant features do not require live resources but retain their future security and reliability gates.
