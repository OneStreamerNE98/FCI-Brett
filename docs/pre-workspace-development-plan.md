# Pre-Workspace development plan

Reviewed: July 13, 2026
Audience: Business owner, Workspace administrator, product owner, and developers

## Decision

Development does not need to wait for a live Google Workspace connection. The application already has an isolated Workspace simulation, and the highest-priority production work is the provider-neutral platform, authorization, core-record safety, interface accessibility, and test coverage.

The Workspace administrator can prepare the company resources in parallel. Keep the hosted application as a one-user development environment using test data, and do not admit staff or store real client data until the production, permission, recovery, and audit gates pass.

## Work that can start now

### Product and interface

- [x] Finish the shared accessible dialog/drawer foundation for every existing form and review workflow.
- [ ] Add typed success, information, warning, and error feedback; errors must not use a success icon.
- [ ] Give each major page a durable URL so refresh, Back, bookmarks, and support links preserve context.
- [ ] Add complete keyboard behavior to global search and navigation popovers.
- [ ] Split the large client component into route, feature, and shared-component modules.
- [ ] Add independent loading, error, retry, and last-updated states instead of one all-or-nothing screen state.
- [ ] Label operational surfaces as Working, In development, Setup required, or Planned.
- [ ] Raise very small operational text and verify keyboard use, 200% zoom, 390 px mobile, tablet, and desktop layouts.

### Production architecture

- [ ] Introduce provider-neutral database, object-storage, secret/configuration, and queued-job interfaces while retaining the existing D1/R2 development adapters.
- [x] Add the first source-only PostgreSQL core schema and concurrent-runner-safe migration system with immutable checksums, foreign keys, constrained states, timestamps, version columns, idempotency, audit evidence, and an outbox. See [Production PostgreSQL foundation](production-postgresql-foundation.md).
- [ ] Extend the production model with users, invitations, sessions, roles, capabilities, and project memberships, then connect those identities to the existing append-only audit, idempotency, and outbox records.
- [ ] Add Cloud Run container and runtime support without changing the hosted development environment.
- [ ] Add reviewable infrastructure definitions for development, staging, and production; do not apply them until owner inputs and deployment approval exist.
- [ ] Add Cloud Tasks handler contracts, retry/idempotency tests, and Cloud Storage quarantine interfaces using local fixtures.
- [ ] Add Gmail Pub/Sub and Calendar HTTPS webhook boundaries using fixtures only; do not create live watches or channels yet.
- [ ] Add structured errors, correlation IDs, security headers, request limits, and health/readiness endpoints.

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
- [ ] Fail browser smoke tests on unhandled console errors.
- [ ] Keep each milestone on a `codex/<short-feature-name>` branch and merge only through a reviewed, green pull request.

## Owner decisions that can happen before connection

- [ ] Confirm the operations connection account, super-administrator contact, initial application administrator, and second trained administrator.
- [ ] Approve Admin, Office Operations, and Project Manager responsibilities; decide whether Sales/Estimator is separate.
- [ ] Decide whether field leads receive limited accounts or expiring links and keep subcontractors account-free by default.
- [ ] Approve who may see financial values, file Gmail, create Calendar events, share files, export data, and view audit/recovery tools.
- [ ] Approve the Google Cloud organization/billing account, primary region, development/staging/production environments, hostname, and DNS owner.
- [ ] Set the monthly budget/alerts, recovery objectives, retention periods, deployment approver, and rollback owner.

Record only non-secret decisions in GitHub. Never enter passwords, OAuth client secrets, encryption keys, tokens, or production data.

## Work that must wait for Workspace resources or credentials

- Creating and verifying the company mailbox, Shared Drive, directory Sheet, calendars, Google Groups, and direct sharing rules.
- Creating/trusting the live OAuth client and saving its secret and encryption key in approved secret storage.
- Authorizing the operations account and testing real Gmail, Drive, Calendar, and Sheets behavior.
- Testing signed Google Workspace `hd=cherryhillfci.com` identity tokens against the final login client and hostname.
- Creating Gmail watches, Calendar channels, production quotas/alerts, and live reconciliation jobs.
- Production migration/cutover, a second employee login, or any real client data.

## Recommended worker sequence

1. **Completed frontend slice:** accessible dialog/drawer foundation and rendered keyboard QA.
2. **Completed portability slice:** provider-neutral client and project creation services, D1 development adapters, safe mirror boundaries, and a centralized versioned D1 development schema runner. See [Portable client and project creation](portable-record-creation.md).
3. **Completed PostgreSQL foundation slice:** constrained client/contact/project, activity/audit, idempotency, outbox, and immutable migration-history tables; checksum validation; advisory locking; transactional forward migrations; restore/forward-fix rollback guidance; and PostgreSQL 16 CI coverage. See [Production PostgreSQL foundation](production-postgresql-foundation.md).
4. **Next database worker:** implement PostgreSQL client/project repository adapters, atomic actor-scoped idempotency claims, transactional activity/outbox writes, and shared repository contract tests. Keep network calls outside database transactions and do not provision or migrate Cloud SQL.
5. **Authorization worker:** simulated identities, sessions, roles/capabilities, project memberships, scoped queries, and denial tests.
6. **Core-record worker:** edit/archive workflows, atomic lead conversion, dates, tasks, notes, file metadata, activity, and concurrency behavior.
7. **Frontend structure worker:** durable URLs, component split, typed feedback, partial-failure states, search keyboard behavior, and responsive/accessibility tests.
8. **Workspace integration worker:** live connection and resource verification only after the administrator completes the required resources and secrets.

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

- Two ordered migrations define only clients, contacts, projects, activity/audit events, actor-scoped idempotency requests, outbox events, and immutable migration history.
- Every core foreign key has a supporting index; business identifiers, client-name keys, statuses, JSON shapes, timestamps, version values, and estimated values have named database constraints.
- The runner uses a dedicated connection, a session advisory lock, a post-lock history read, exact prefix validation, LF-normalized SHA-256 checksums, and one short transaction per version.
- The outbox has a pending/available partial index, lease/retry state, correlation evidence, and a dead-letter timestamp. The future worker must claim work with `FOR UPDATE SKIP LOCKED` and perform provider calls after committing the claim.
- Unit tests run everywhere; GitHub CI adds a PostgreSQL 16 service for real migration, concurrency, rollback, index, and constraint coverage.
- Rollback is restore/forward-fix based. No destructive automatic down migration was added.

## Next bounded developer assignment

Assign one database worker to connect the existing provider-neutral creation services to the completed production schema without provisioning Cloud resources or changing the hosted development environment:

- Implement PostgreSQL client/project repository adapters against the existing provider-neutral contracts and run the same repository behavior suite against both adapters.
- Claim actor-scoped request-idempotency keys with atomic `INSERT ... ON CONFLICT`, reject fingerprint reuse, and return an accepted prior result without duplicating a record.
- Write the client/contact or project, activity evidence, and outbox row in one short PostgreSQL transaction with optimistic-concurrency versions.
- Add an outbox claim/complete/retry repository using small `FOR UPDATE SKIP LOCKED` batches; keep Google/network calls outside transactions and do not add a live worker yet.
- Parse PostgreSQL `bigint`/`numeric` values without unsafe JavaScript coercion and generate the documented Unicode-normalized client-name key.
- Document migration assumptions, identifier preservation, count/hash reconciliation, backup/restore prerequisites, and the owner approval required before any staging rehearsal.

This assignment may add source code, local fixtures, and automated tests only. It must not create Cloud SQL, add credentials, migrate development data, alter live Workspace resources, or deploy production.
