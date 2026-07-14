# Task checklist: Build the production foundation and migration path

Owner: Codex/developer and Google Cloud administrator

Status: In progress

Depends on: Approved company domain, region, budget alert, production hostname, recovery targets, and [20-user operating model](06-20-user-operating-model-and-access.md)

The current Sites/Workers/D1/R2 deployment remains a one-user development environment using test data. Production should use the smallest Google Cloud topology that safely supports about 20 staff.

## Owner inputs

- [ ] Select the Google Cloud organization/billing account and primary region.
- [ ] Approve separate development, staging, and production environments.
- [ ] Approve the production hostname and DNS owner.
- [ ] Set a monthly budget and alert recipients.
- [ ] Set recovery targets: RPO (acceptable data loss window) and RTO (acceptable outage duration).
- [ ] Name the deployment approver and emergency rollback owner.

## Minimum topology

- [ ] Containerize the Next.js application for one regional Cloud Run service.
- [ ] Keep authenticated task and webhook handlers in the modular monolith initially; do not create microservices without an operational reason.
- [ ] Provision one private Cloud SQL PostgreSQL database per environment with pooling, connection caps, backups, point-in-time recovery, and alerting.
- [ ] Put OAuth credentials, token-encryption keys, session secrets, and provider credentials in Secret Manager.
- [ ] Provision Cloud Tasks queues for explicit synchronization, filing, retry, reminder, and webhook work, with idempotency keys and bounded retry policies.
- [ ] Persist jobs, execution attempts, terminal failures, alert state, and controlled replay in application-owned records; Cloud Tasks is not the durable dead-letter/replay system of record.
- [ ] Use Cloud Scheduler for outbox dispatch, expired-lease recovery, Gmail/Calendar renewal and reconciliation, cleanup, and materializing long-range reminders into the supported Cloud Tasks scheduling window.
- [ ] Use Pub/Sub for Gmail push notifications. Renew Gmail watches at least every seven days; daily renewal is safer.
- [ ] Use expiring HTTPS notification channels for Google Calendar and enqueue processing into Cloud Tasks. Do not design Calendar notifications as Pub/Sub events.
- [ ] Provision Cloud Storage quarantine for untrusted uploads before an approved file reaches Shared Drive.
- [ ] Defer `pgvector` until permission-filtered document indexing has approved requirements and tests.
- [ ] Co-locate Cloud Run, Cloud SQL, Tasks, and Storage where practical and reuse pooled network connections.

## Data and code migration

- [x] Move the D1 development schema and integrity indexes into the ordered Drizzle/Sites deployment migration sequence, remove schema DDL from normal request paths, and retain an explicit local-only migration command. This development migration path does not complete the provider-neutral production database work below.
- [x] Prove the provider-neutral creation boundary for clients and projects with application services, repository/mirror ports, D1 development adapters, capability tests, and preserved HTTP behavior. Source-only PostgreSQL composition now exists; employee-facing production routing remains open.
- [x] Add the source-only PostgreSQL core schema for clients, contacts, projects, business activity events, actor-scoped idempotency requests, outbox events, and immutable migration history. It is tested but not applied to Cloud SQL. See [Production PostgreSQL foundation](../production-postgresql-foundation.md).
- [ ] Add a separate general append-only security-audit model for authentication, sessions, roles, permissions, exports, files, connectors, jobs, and recovery. The client/project activity timeline cannot provide this coverage.
- [x] Add source-only PostgreSQL client/project adapters with atomic actor-scoped idempotency, transactional activity/outbox writes, safe `bigint`/`numeric` handling, version-fenced outbox transitions, and PostgreSQL 16 repository tests. They are composed into the fail-closed source runtime but not employee-facing routes. See [Production PostgreSQL repositories](../production-postgresql-repositories.md).
- [x] Add a source-only, fail-closed Cloud Run runtime boundary with validated private Cloud SQL configuration, bounded runtime/migration/rehearsal pools, exact database readiness, separate job entry points, and production repository composition. Every employee application path still returns `503` until its Cloudflare dependencies are ported. See [Google Cloud runtime foundation](../google-cloud-runtime-foundation.md).
- [x] Define source-only least-privilege migration-owner, runtime, and isolated rehearsal-role policies. No roles or grants have been applied to a database.
- [x] Add a strict bounded core rehearsal harness and safe fixture that preserve test identifiers and verify per-table counts plus content/identifier hashes. This is automated source evidence, not the required staging rehearsal or cutover rehearsal below.
- [ ] Replace remaining development text relationship IDs with PostgreSQL foreign keys; the bounded client/contact/project production foundation now uses indexed foreign keys.
- [ ] Add constrained status values, timestamps, version fields, and normalized meeting/action/task records.
- [ ] Extend the completed client/project request-idempotency constraints to Google archives, Drive mappings, Calendar channels, and later queued operations.
- [ ] Wrap lead conversion and other multi-record state changes in database transactions.
- [ ] Define provider-neutral database and object-storage interfaces before replacing Cloudflare bindings.
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
- [ ] Store multiple token-encryption key versions during rotation and test decrypt/re-encrypt behavior.

## Infrastructure and delivery controls

- [ ] Define infrastructure as code or an equivalently reviewable, repeatable provisioning procedure.
- [ ] Use least-privilege service accounts and keep production deployment access separate from routine development.
- [ ] Complete production observability. Source-only process liveness and exact database readiness exist; structured logs, trace/correlation IDs, queue-depth alerts, database alerts, connector health, and budget alerts remain.
- [ ] Add security headers, request-size limits, authentication rate limits, and sensitive-route rate limits.
- [ ] Run lint, build, unit, integration, route, migration, authorization, and browser smoke tests in CI.
- [ ] Document how staging uses non-production Workspace resources and credentials.

## Completion result

This action is complete when a clean staging environment can be provisioned reproducibly, test data can be migrated and rolled back, concurrent writes are protected, Gmail/Calendar events survive retries, restore and failover procedures pass, and the owner approves the production cutover plan.
