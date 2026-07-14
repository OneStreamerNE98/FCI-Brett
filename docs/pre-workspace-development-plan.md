# Pre-Workspace development plan

Reviewed: July 14, 2026
Audience: Business owner, Workspace administrator, product owner, and developers

## Decision

Development does not need to wait for a live Google Workspace connection. The application already has an isolated Workspace simulation, and the highest-priority production work is the provider-neutral platform, authorization, core-record safety, interface accessibility, and test coverage.

Use the [complete product and Google Cloud architecture audit](complete-product-and-google-cloud-architecture-audit.md) as the broader system blueprint. Its [owner checklist](task-checklists/10-complete-product-and-integration-architecture.md) covers decisions for estimating, procurement, field work, messaging/reminders, closeout, warranty, files, recovery, and authoritative external systems.

Follow the accepted [Workspace-first, cost-controlled rollout](architecture-decision-workspace-first-cost-controlled-rollout.md): reuse existing Workspace, keep Sites as development, create staging only when evidence is needed, price both database profiles before selection, and leave optional infrastructure disabled.

The Workspace administrator can prepare the company resources in parallel. Keep the hosted application as a one-user development environment using test data, and do not admit staff or store real client data until the production, permission, recovery, and audit gates pass.

## Work that can start now

### Product and interface

- [x] Finish the shared accessible dialog/drawer foundation for every existing form and review workflow.
- [x] Add typed success, information, warning, and error feedback; persistent errors use an alert icon, explicit dismissal, and retry where the operation is safe to repeat.
- [ ] Give each major page a durable URL so refresh, Back, bookmarks, and support links preserve context.
- [x] Give global search full keyboard behavior and make disclosure popovers close on Escape/outside click without false menu semantics.
- [ ] Split the large client component into route, feature, and shared-component modules.
- [ ] Add independent loading, error, retry, and last-updated states instead of one all-or-nothing screen state.
- [x] Label operational surfaces as Working, In development, Setup required, or Planned.
- [ ] Raise very small operational text and verify keyboard use, 200% zoom, 390 px mobile, tablet, and desktop layouts.

### Production architecture

- [ ] Introduce provider-neutral database, object-storage, secret/configuration, and queued-job interfaces while retaining the existing D1/R2 development adapters.
- [x] Add the first source-only PostgreSQL core schema and concurrent-runner-safe migration system with immutable checksums, foreign keys, constrained states, timestamps, version columns, idempotency, audit evidence, and an outbox. See [Production PostgreSQL foundation](production-postgresql-foundation.md).
- [x] Add source-only PostgreSQL client/project adapters, atomic actor-scoped request replay, transactional activity/outbox writes, worker-safe outbox transitions, guarded PostgreSQL value parsing, and PostgreSQL 16 repository coverage. See [Production PostgreSQL repositories](production-postgresql-repositories.md).
- [ ] Extend the production model with users, invitations, sessions, roles, capabilities, project memberships, and a separate general append-only security audit; the existing client/project activity timeline is not the security-audit store.
- [x] Add the source-only fail-closed Cloud Run container/runtime, private Cloud SQL connector composition, bounded pools, separate migration/rehearsal commands, exact readiness, and least-privilege source policy without changing the hosted development environment. See [Google Cloud runtime foundation](google-cloud-runtime-foundation.md). The full employee application is not yet containerized.
- [ ] Add costed, reviewable infrastructure definitions that preserve Sites development, support on-demand staging, define standalone and regional-HA production database profiles, and keep optional modules disabled; do not apply them.
- [ ] Add Cloud Tasks handler contracts, retry/idempotency tests, and Cloud Storage quarantine interfaces using local fixtures.
- [ ] Add Gmail Pub/Sub and Calendar HTTPS webhook boundaries using fixtures only; do not create live watches or channels yet.
- [ ] Add structured errors, correlation IDs, security headers, request limits, connector health, and employee-application readiness integration. Source-only process liveness and exact database/migration/privilege readiness already exist.

### Authorization and core records

- [ ] Build the authorization domain layer with simulated users before the Google OIDC adapter exists.
- [ ] Enforce capabilities and project scope inside queries and API handlers; hidden controls are never the permission boundary.
- [ ] Add negative tests for disabled users, expired sessions, outside-domain identities, and cross-project access.
- [ ] After the production schema exists, add safe edit/archive workflows for clients, contacts, leads, projects, and meetings.
- [ ] Implement lead conversion as one transaction with duplicate protection and audit evidence.
- [ ] Add project dates, durable tasks/follow-ups, notes, file metadata, activity history, and optimistic-concurrency handling.

### Testing and delivery

- [ ] Add rendered interaction tests for dialogs/drawers, navigation/Back, global search, error states, and responsive layouts.
- [x] Add PostgreSQL 16 core constraint/migration integration coverage in CI while allowing the normal local suite to run without PostgreSQL.
- [ ] Add route/repository integration tests, permission-denial tests, application retry/idempotency tests, and partial-API-failure tests.
- [x] Run lint as an explicit CI step.
- [ ] Fail every browser smoke path on unhandled console errors.
  - Primary page/sidebar smoke coverage currently enforces console health; extend the guard to the remaining Playwright paths.
- [ ] Keep each milestone on a `codex/<short-feature-name>` branch and merge only through a reviewed, green pull request.

## Owner decisions that can happen before connection

- [ ] Confirm the operations connection account, super-administrator contact, initial application administrator, and second trained administrator.
- [ ] Approve Admin, Office Operations, and Project Manager responsibilities; decide whether Sales/Estimator is separate.
- [ ] Decide whether field leads receive limited accounts or expiring links and keep subcontractors account-free by default.
- [ ] Approve who may see financial values, file Gmail, create Calendar events, share files, export data, and view audit/recovery tools.
- [x] Approve isolated development/staging/production project, credential, and data boundaries, with Sites development and on-demand staging.
- [ ] Approve the Google Cloud organization/billing account, primary region, hostname, and DNS owner.
- [ ] Name recipients for the default `$50/month` pre-production alert; approve the estimate-based production budget, recovery objectives, retention periods, deployment approver, and rollback owner.

Record only non-secret decisions in GitHub. Never enter passwords, OAuth client secrets, encryption keys, tokens, or production data.

## Work that must wait for Workspace resources or credentials

- Creating and verifying the company mailbox, Shared Drive, directory Sheet, calendars, Google Groups, and direct sharing rules.
- Creating/trusting the live OAuth client and saving its secret and encryption key in approved secret storage.
- Authorizing the operations account and testing real Gmail, Drive, Calendar, and Sheets behavior.
- Testing signed Google Workspace `hd=cherryhillfci.com` identity tokens against the final login client and hostname.
- Creating Gmail watches, Calendar channels, production quotas/alerts, and live reconciliation jobs.
- Production migration/cutover, a second employee login, or any real client data.

## Recommended worker sequence

1. **Completed frontend correctness slices:** accessible dialog/drawer foundation, rendered keyboard QA, typed persistent notifications, safe retry behavior, protected Settings loading, and OAuth query cleanup.
2. **Completed portability slice:** provider-neutral client and project creation services, D1 development adapters, safe mirror boundaries, and a centralized versioned D1 development schema runner. See [Portable client and project creation](portable-record-creation.md).
3. **Completed PostgreSQL foundation slice:** constrained client/contact/project, business activity evidence, idempotency, outbox, and immutable migration-history tables; checksum validation; advisory locking; transactional forward migrations; restore/forward-fix rollback guidance; and PostgreSQL 16 CI coverage. General security audit remains a separate required model. See [Production PostgreSQL foundation](production-postgresql-foundation.md).
4. **Completed PostgreSQL repository slice:** client/project adapters, atomic actor-scoped idempotency and truthful replay, transactional activity/outbox intent, guarded exact-value parsing, version-fenced outbox claim/complete/retry/recovery, and PostgreSQL 16 repository tests. See [Production PostgreSQL repositories](production-postgresql-repositories.md).
5. **Completed production runtime foundation:** a separate fail-closed Cloud Run image, private Cloud SQL connector composition, bounded runtime/migration/rehearsal pools, exact health/readiness, explicit migration ownership, least-privilege source policy, and a bounded core test-data rehearsal. See [Google Cloud runtime foundation](google-cloud-runtime-foundation.md).
6. **Accepted cost posture:** reuse Workspace, preserve Sites development, keep staging on demand, price standalone and HA Cloud SQL before selection, and default optional service modules to disabled.
7. **Owner approval in parallel:** approve the 20-user role model and cross-system Google access matrix plus Cloud organization/billing, region, hostname, alert recipients, recovery, deployment, and rollback inputs.
8. **Next infrastructure-definition worker:** begin with safe placeholders and add costed, unapplied core/profile definitions and an on-demand staging procedure. Missing owner inputs must remain explicit variables and provisioning blockers.
9. **Source-only authorization worker after both gates:** after the runtime-foundation pull request is merged and the access matrix is approved, add simulated identities, sessions, roles/capabilities, project memberships, scoped queries, and denial tests without enabling employee login or live data. Google Workspace OIDC and live authorization rollout wait for the accepted production foundation, tested migration/cutover path, and provider-neutral database/storage boundaries.
10. **Core-record worker:** edit/archive workflows, atomic lead conversion, dates, tasks, notes, file metadata, activity, and concurrency behavior.
11. **Frontend structure worker:** durable URLs, component split, broader partial-failure/freshness states, and responsive/accessibility tests.
12. **Workspace integration worker:** live connection and resource verification only after the administrator completes the required resources and secrets.

Do not assign scheduling, outbound messaging, or AI document indexing until the production platform and authorization foundation are accepted.

## Completed portable creation assignment

The portable creation worker completed the following bounded slice without changing the established HTTP response or development behavior:

- Client/contact and project normalization, validation, and status rules now live in domain modules with no Next.js, Cloudflare, or Google imports.
- Client and project repository ports define atomic creation intent; the client operation includes its primary contact and activity entry.
- A directory-mirror port requests synchronization only after the durable database write succeeds.
- D1 and synchronous Google mirror adapters preserve the current development behavior and are explicitly bounded to development use.
- Behavioral tests cover validation, duplicate/not-found results, atomic record intent, exact authorization capabilities, and a successful database write when the optional mirror fails.
- The D1 development bootstrap is centralized in an ordered, versioned, retryable migration registry with parity tests.

## Completed PostgreSQL foundation assignment

The source-only PostgreSQL worker completed the first constrained production schema and migration safety layer without provisioning Cloud SQL, changing route handlers, or applying a live migration:

- Two ordered migrations define only clients, contacts, projects, client/project business activity events, actor-scoped idempotency requests, outbox events, and immutable migration history. They do not provide the general security-audit coverage required for identity, permissions, files, integrations, jobs, exports, or recovery.
- Every core foreign key has a supporting index; business identifiers, client-name keys, statuses, JSON shapes, timestamps, version values, and estimated values have named database constraints.
- The runner uses a dedicated connection, a session advisory lock, a post-lock history read, exact prefix validation, LF-normalized SHA-256 checksums, and one short transaction per version.
- The outbox has a pending/available partial index, lease/retry state, correlation evidence, and a dead-letter timestamp. The completed repository slice now claims work with `FOR UPDATE SKIP LOCKED`, commits the claim before provider calls, and version-fences completion, retry, and recovery updates.
- Unit tests run everywhere; GitHub CI adds a PostgreSQL 16 service for real migration, concurrency, rollback, index, and constraint coverage.
- Rollback is restore/forward-fix based. No destructive automatic down migration was added.

## Completed PostgreSQL repository assignment

The source-only repository worker connected the portable creation services to the production schema without wiring a production runtime or changing D1/Sites behavior:

- Actor/operation/key request claims use one atomic insert; a same-fingerprint retry returns the winning stored record, and fingerprint reuse is rejected.
- Client/contact or project creation, append-only activity evidence, outbox intent, and the completed replay response commit in one short transaction.
- The documented Unicode client-name key is centralized, PostgreSQL `bigint` versions remain strings, and constrained `numeric` values use guarded safe-integer conversion.
- Outbox claims use small ordered `FOR UPDATE SKIP LOCKED` batches; version-fenced complete/retry/recovery prevents stale-worker writes, and terminal dead letters append activity evidence atomically.
- Fast tests run without PostgreSQL; GitHub CI supplies PostgreSQL 16 for real concurrency, rollback, replay, exact-value, and outbox lifecycle coverage.
- No provider callback is accepted inside a repository transaction, and no Cloud, Workspace, migration, deployment, credential, or live-data state changed.

## Completed production runtime assignment

The source-only production-runtime worker completed the next bounded foundation without changing any external system:

- A separate fail-closed Cloud Run image exposes process liveness and exact database readiness while all employee application paths remain unavailable until their Cloudflare dependencies are ported.
- Validated private Cloud SQL connector composition provides one bounded runtime pool per instance and single-connection migration/rehearsal pools.
- Migrations run only through a separate command/job with immutable history checks and explicit schema-owner role activation.
- Source-only least-privilege role definitions keep the runtime from creating schema objects or mutating migration history.
- A strict test-data-only core rehearsal preserves identifiers and verifies counts plus content/identifier hashes inside an isolated non-production schema.
- No Cloud resources, credentials, database roles, migrations, rehearsal data, Workspace connections, hosted configuration, or deployments were created or changed.

See [Google Cloud runtime foundation](google-cloud-runtime-foundation.md) for the exact boundary and acceptance gates.

## Next bounded developer assignment

Assign one infrastructure-definition worker now. The worker must use safe variables for still-open owner inputs from [Production foundation and migration](task-checklists/07-production-foundation-and-migration.md); those inputs remain blockers to applying any definition, not blockers to preparing source for review.

- Preserve Sites development and define isolated project/credential/data boundaries without creating a development Cloud SQL instance.
- Add reviewable, costed standalone and regional-HA Cloud SQL profiles, zero-minimum/bounded-maximum Cloud Run, private networking, Secret Manager references, environment-specific identities, backups/PITR, probes, monitoring, and budget alerts.
- Separate the minimum production core from disabled optional modules for Tasks, Scheduler, Pub/Sub, quarantine/scanning, SMS, and `pgvector`.
- Document official calculator inputs, connection/revision-overlap budgets, the on-demand staging lifecycle, role bootstrap/grant verification, restore exercise, migration rehearsal, and forward-fix/rollback evidence.
- Keep every definition unapplied. Do not provision resources, add credentials, apply roles or migrations, connect Workspace, migrate data, deploy, or merge.

PR #11 has merged the runtime foundation, so a source-only authorization worker may begin simulated identity and denial-test work after the owner approves the role/access matrix. Employee Google Workspace OIDC, live sessions, and production authorization rollout remain blocked until the production foundation, tested migration/cutover path, and provider-neutral database/storage boundaries pass acceptance.
