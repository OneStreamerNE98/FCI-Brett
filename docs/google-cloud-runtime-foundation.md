# Google Cloud runtime foundation

Reviewed: July 19, 2026

Status: Implemented and tested in source only. Not provisioned, connected, migrated, or deployed.

## Read this boundary first

This slice creates the reviewable Cloud Run and Cloud SQL runtime foundation without changing the current Sites/Workers/D1/R2 development application. The container remains fail-closed while now exposing a narrow source-only employee API boundary:

- `GET` or `HEAD /healthz` reports process liveness.
- `GET` or `HEAD /readyz` reports ready only when the configured PostgreSQL schema is reachable, the current role has schema `USAGE` but not `CREATE`, and every migration version, name, and checksum exactly matches source.
- Dashboard, search, project list/exact-project, client list/create, project create, lead list/create, project-meeting list/create, and logout paths are composed through hashed-session authorization, capability gates, PostgreSQL scopes, and the shared record use cases.
- File list/upload/share, Gmail filing, and Calendar creation pass through authorization, exact-project checks, and mutation CSRF checks but return `503 feature_unavailable` because production provider action adapters are absent.
- Unknown paths and methods fail closed. No route trusts `oai-authenticated-user-email` or supplies a fake production identity.

This is still not the employee web application. The current page and broader API tree imports `cloudflare:workers`, uses D1/R2 bindings, and depends on the Sites identity boundary. The source image has no seeded employee, no composed production file/Google provider actions, and no rendered interface. Workspace OIDC/session issuance, OIDC verifier/attempt-cookie hardening, the negative-case/real-PostgreSQL login test matrix, and an uncomposed GCS storage adapter now exist in source through PR #55, but that does not activate file routes, configure live identity, or admit an employee. It must not be deployed as though it were a usable employee rollout. The production checklist item “Containerize the Next.js application” remains open until the remaining routes, interface, object-storage composition, identity, and provider boundaries are ported and accepted.

The [Workspace-first, cost-controlled rollout](architecture-decision-workspace-first-cost-controlled-rollout.md) controls how this source foundation may later be provisioned. Development remains on Sites, staging is created on demand, standalone and regional-HA Cloud SQL profiles must be priced before selection, and optional service modules remain disabled. Nothing in this document authorizes a continuously running development or staging database.

## What is implemented

- A dedicated Node/Cloud Run build that never loads the Sites plugin, Wrangler, Worker entry point, or D1/R2 configuration.
- A non-root multi-stage `Dockerfile.cloud-run` that listens on `0.0.0.0:$PORT` and can run the service or one-off commands from the same immutable image.
- Fail-closed production configuration with explicit application environment, deployment stage, database access mode, private Cloud SQL connection, schema, and bounded pool settings.
- Secret Manager-friendly password-file support. The password is non-enumerable in the in-memory configuration object and is never included in operational events.
- One bounded `pg.Pool` per service instance, with copied query parameters, statement/lock/idle-transaction timeouts, connection lifetime limits, redacted idle-client error evidence, and ordered pool-then-connector shutdown.
- Runtime composition for the completed PostgreSQL adapters. Client, project, lead, and project-meeting creation repositories are created per request so actor/idempotency metadata is not retained between requests; the outbox repository can be process-scoped.
- Source-only employee request composition for dashboard, bounded search, project list/exact-project, client list/create, project create, lead list/create, project-meeting list/create, and idempotent logout. It reads one bounded host-only session cookie, hashes raw session/CSRF credentials immediately, requires exact same-origin plus live CSRF matching for mutations, clears unusable or confirmed-logout cookies while retaining retryable cookies after failed revocation, and applies generic `401`/`403`/`404` responses.
- Authorization-gated file, Gmail, and Calendar route contracts that cannot call work after denial and deliberately report provider unavailability while their production adapters are absent.
- Cloud-Run-compilable Drive, Gmail, Calendar, Sheets, and OAuth cores with injected fetch, clock, secret-store, and persistence seams. The source-only production OAuth workflow uses exact-version multi-key decryption and the version-3 integration port, but is deliberately absent from production route composition.
- A separate migration command using a one-connection pool, the immutable checksum runner, a session advisory lock, and an explicit validated migration-owner `SET ROLE`. Normal requests never import or call the migration runner.
- Source-only capability roles and exact grants. The runtime role receives no schema creation, delete, truncate, reference, trigger, sequence, function, or broad future-table privilege.
- A bounded test-data rehearsal for production-compatible clients, contacts, leads,
  projects, project meetings, and explicitly classified client/project/lead activity
  events.

## Employee API contract

The production Cloud Run boundary and controlled Sites development boundary deliberately
share portable application use cases without pretending they have the same transport
contract:

- Production employee requests use the host-only hashed session. Authenticated mutations
  require an exact same-origin request and a live session-bound CSRF credential. The four
  core-record creation POSTs additionally require one `Idempotency-Key` matching
  `[A-Za-z0-9][A-Za-z0-9._:-]{0,254}`. Creation keys are isolated by actor and operation;
  same-key/same-input replays return the first accepted `201` result, while reuse for
  different normalized details returns `409`. Their 24-hour `expiresAt` value is retention
  metadata for a future cleanup policy only. No cleanup or reuse behavior exists, so the
  timestamp does not make a key reusable.
- Successful production API responses use `{ "data": ... }`. The newly composed routes
  are `POST /api/v1/clients`, `POST /api/v1/projects`, `GET|POST /api/v1/leads`, and
  `GET|POST /api/v1/projects/:projectId/meetings`. Project Manager reads remain limited
  to assigned projects; because a lead has no approved project-membership mapping,
  Project Manager lead lists are empty rather than company-wide.
- The current Sites/Workers/D1 routes remain development-only. They retain ChatGPT-hosted
  identity, the office allowlist, same-origin mutation checks, and their existing
  top-level resource response shapes such as `{ "clients": ... }`, `{ "lead": ... }`,
  and `{ "meeting": ... }`; they do not claim the production session, CSRF, envelope, or
  PostgreSQL idempotency contract.
- The Sites presentation adapter has no secure employee-session bootstrap and no D1
  `/api/v1/admin/access` or `/api/v1/admin/audit` implementation. Both admin clients now
  feature-detect that boundary and return `secure_session_not_ready` before `fetch`,
  preventing development 404s without adding a second administration data plane.
- File, Gmail, and Calendar provider routes are unchanged: authorization runs first and
  absent production providers still return `503 feature_unavailable`.

## Runtime configuration contract

The Google Cloud entry points deliberately do not use the development environment fallback in `app/lib/app-environment.ts`. Missing or invalid selectors stop the process before a database connection is attempted.

| Value | Requirement |
| --- | --- |
| `FCI_APP_ENVIRONMENT` | Must be exactly `production` for every Google Cloud runtime stage. |
| `FCI_DEPLOYMENT_STAGE` | Exactly `dev`, `staging`, or `production`. |
| `FCI_POSTGRES_ACCESS_MODE` | Exactly `runtime`, `migration`, or `rehearsal`; each command enforces its own mode. |
| `FCI_POSTGRES_CONNECTION_MODE` | Use `cloud-sql-connector` with private IP. `direct-tcp` is restricted to loopback development rehearsals. |
| `FCI_CLOUD_SQL_INSTANCE_CONNECTION_NAME` | Non-secret `project:region:instance` identifier. |
| `FCI_CLOUD_SQL_IP_TYPE` | Must be exactly `PRIVATE`. The Cloud Run service/job still needs an approved VPC network path. |
| `FCI_POSTGRES_DATABASE` | Lowercase database identifier. |
| `FCI_POSTGRES_USER` | Environment-specific runtime, migration, or rehearsal login/IAM database principal. |
| `FCI_POSTGRES_PASSWORD` or `FCI_POSTGRES_PASSWORD_FILE` | Configure exactly one. Prefer a dedicated Secret Manager mount such as `/secrets/postgres/password`. |
| `FCI_POSTGRES_SCHEMA` | Required lowercase target schema in every stage and access mode. Staging and production must use a dedicated application schema unless the reviewed exception below is acknowledged; rehearsal schemas must begin `fci_rehearsal_`. |
| `FCI_POSTGRES_PUBLIC_SCHEMA_ACKNOWLEDGMENT` | Leave unset for a dedicated schema. If staging or production deliberately targets literal `public`, set exactly `I ACKNOWLEDGE THAT THIS STAGING OR PRODUCTION DATABASE USES THE PUBLIC POSTGRESQL SCHEMA`; any missing, approximate, or stale acknowledgment fails before secret access or a database connection. Dev-stage schema behavior is unchanged. |
| `FCI_POSTGRES_MIGRATION_ROLE` | Required only for migration mode; use the reviewed schema-owner role name. |
| `FCI_POSTGRES_POOL_MAX` | Runtime defaults to `5` and is capped at `10`; migration and rehearsal must be `1`. |
| `PORT` | Defaults to `8080`; Cloud Run supplies this for the ingress container. |

Optional bounded timeout/lifetime values are documented in `.env.example`. They are non-secret configuration; passwords and other credentials still belong only in Secret Manager or another approved encrypted runtime setting.

The low-level migration runner retains its `public` default for isolated library callers and existing development tests. Google Cloud service, migration, and rehearsal entry points all pass through `loadProductionConfig`, which requires an explicit `FCI_POSTGRES_SCHEMA`; staging and production therefore cannot silently inherit that low-level default. Literal `public` is an exceptional, acknowledged target rather than the production default.

The Cloud SQL Node.js connector uses Application Default Credentials and private IP. Do not set `GOOGLE_APPLICATION_CREDENTIALS` to a committed or mounted service-account key in Cloud Run. Assign the service identity only the IAM permissions required to connect to its intended Cloud SQL instance and secrets.

## Build and process separation

```powershell
npm.cmd run build:cloud-run
```

The build produces three distinct entry points under `work/cloud-run`:

- `cloud-run-server.mjs` — fail-closed health/readiness plus the source-only employee API boundary;
- `run-migrations.mjs` — one-off immutable schema migration job;
- `run-core-rehearsal.mjs` — non-production, test-data-only core migration rehearsal.

The source commands rebuild before local execution:

```powershell
npm.cmd run start:cloud-run:foundation
npm.cmd run db:migrate:postgres
npm.cmd run db:rehearse:postgres-core -- --snapshot tests/fixtures/production-core-rehearsal.json
```

Do not run the last two commands against any shared, staging, or production database without an approved environment procedure, verified backup/restore evidence, and owner authorization. Building or testing the commands does not authorize executing them.

For a future Cloud Run Job, use the exact reviewed service image and override only its command. A job exits `0` only after the migration/rehearsal completes and exits nonzero on failure; it does not start an HTTP server.

## Pool and scaling budget

The initial runtime pool defaults to five connections per Cloud Run instance. Migration and rehearsal use one connection each. Before provisioning, the Cloud administrator must satisfy and document this budget:

```text
(runtime pool max × possible simultaneous Cloud Run instances/revisions)
+ migration/rehearsal job connections
+ administrator and monitoring reserve
≤ usable Cloud SQL connection budget
```

For a company of about 20 staff, use zero minimum instances and a planning starting maximum of two instances. With a five-connection pool, two simultaneously active revisions could consume up to 20 runtime connections (`2 revisions × 2 instances × 5 connections`) before migration, rehearsal, administrator, and monitoring reserve. The infrastructure worker must validate the actual Cloud Run revision behavior and selected Cloud SQL connection limit rather than treating this planning value or the source default as a complete guarantee.

## Cost and availability gate

Before provisioning, the infrastructure worker must produce reviewable official-calculator inputs for both a standalone/zonal and a regional-HA Cloud SQL profile. The owner then selects a profile only after accepting RPO/RTO and reviewing restore evidence and expected monthly cost. Use a `$50/month` pre-production accidental-spend alert as the default planning guardrail, with owner-approved recipients; it is an alert, not a cap. The production alert budget remains open until the profile and expected traffic are selected.

Keep Cloud Run minimum instances at zero and optional Cloud Tasks, Scheduler, Pub/Sub, quarantine/scanning, SMS, and `pgvector` modules disabled unless a separately approved feature requires them. Infrastructure definitions remain unapplied until explicit provisioning approval.

## Database role boundary

[`infrastructure/postgres/least-privilege.sql`](../infrastructure/postgres/least-privilege.sql) is a source policy, not an automatic deployment script. It separates:

- an external bootstrap administrator;
- a `NOLOGIN` migration/schema-owner capability role;
- a `NOLOGIN` runtime capability role; and
- a development/staging-only rehearsal importer scoped to one isolated rehearsal schema.

Use [`infrastructure/postgres/rehearsal-importer-template.sql`](../infrastructure/postgres/rehearsal-importer-template.sql) only as a reviewed per-schema grant template after the isolated rehearsal schema has been migrated. It rejects non-rehearsal schema names and validates the exact nine-table migration/control boundary needed by the six imported tables. It has not been applied to a hosted or shared database; GitHub CI exercises equivalent exact grants in its disposable rehearsal schema without executing this template file.

The environment-specific migration login must have permission to set the owner role, and the migration command verifies `CURRENT_USER` after `SET ROLE`. Inherited membership alone would leave new objects owned by the login and would not apply the owner role’s default privileges.

Runtime readiness receives no direct migration-history table access. It compares immutable version/name/checksum metadata through one owner-checked, fixed-search-path security-definer reader and verifies the complete expected table/column privilege matrix, sequence denial, grant options, schema rights, executable-function boundary, and that the runtime login cannot assume the migration-owner or rehearsal roles. Every future migration must update and test that explicit matrix; no default grant gives the runtime access to every future table.

## Bounded core rehearsal

The format-version-2 rehearsal snapshot is a strict, test-only exchange format rather than a raw D1 export. It:

- inventories all 22 D1 schema tables plus R2 objects with a reason and one disposition (`migrated`, `transformed`, `excluded`, or `blocking`); a schema-derived test fails if a new D1 table is not classified, while the production runtime does not import the D1 schema;
- carries only clients, contacts, leads, projects, project meetings, and explicitly classified activity events as bounded row payloads; every inventory-only category must report zero even when its eventual disposition is excluded or transformed;
- requires every project to include `flooringCategory`, `squareFeet`, and `contractValue` as explicit null placeholders, keeps those keys in prepared rows and SHA-256 evidence, and refuses non-null values before database access until KPI-04 adds the reviewed PostgreSQL migration and importer mapping;
- requires client/project names, lead company/contact/project/site fields, and project-meeting titles to equal `FCI TEST — DO NOT USE` or begin with that exact marker plus a space;
- rejects snapshot files larger than 16 MiB and rejects more than 5,000 bounded core rows before row mapping;
- accepts only production-compatible UUIDs, codes, statuses, timestamps, relationships, and explicit activity results/correlation IDs;
- rejects identifier remapping, orphan relationships, duplicate normalized client names, multiple primary contacts, non-null legacy Drive fields, unknown fields, unclassified activity, and any nonzero inventory-only source category before database access;
- requires an empty, pre-migrated schema matching `^fci_rehearsal_[a-z0-9_]{1,49}$` and a restricted rehearsal importer role;
- verifies that every target migration version, name, and immutable checksum exactly matches the reviewed source registry before inserting;
- inserts in foreign-key order in one bounded transaction and preserves IDs, timestamps, relationships, and audit meaning;
- creates no idempotency requests, outbox events, or provider calls;
- reads the destination back and compares per-table counts, content SHA-256 evidence, and identifier SHA-256 evidence before commit; and
- always reports `cutoverReady: false`.

The current rehearsal does **not** migrate non-null flooring KPI values, generic records, Gmail archives, Drive mappings, OAuth attempts/tokens, Google connections, settings, user preferences, R2 objects, or unclassified legacy activity. Its Google-connection disposition documents separately approved production reauthorization; it does not authorize discarding a nonzero source count or copying credential ciphertext. OAuth and token material must never be exported into a snapshot; production Google authorization will be established again through the approved production connector.

This is evidence that the bounded core path can be rehearsed. It is not evidence that the complete development application can be cut over.

## What remains before any deployment

1. The owner approves the Google Cloud organization/billing account, region, hostname/DNS owner, alert recipients, RPO/RTO, deployment approver, and rollback owner. The isolated project boundaries, Sites development environment, and on-demand staging posture are already accepted.
2. Costed, unapplied infrastructure definitions are reviewed for private networking, separate standalone and regional-HA Cloud SQL profiles, service identities, Secret Manager, backups/PITR, zero-minimum/bounded-maximum Cloud Run scaling, default-off migration/rehearsal Job definitions, keyless image publication, monitoring, the `$50/month` pre-production alert, and an on-demand staging lifecycle. Optional service modules must default to disabled. The source workflow builds on pull requests and can publish an image only through a separately approved manual protected-environment job; it never applies Terraform, deploys Cloud Run, or starts a Job.
3. The administrator creates environment-specific login/IAM principals, applies the reviewed capability-role policy, and verifies grants with denial tests.
4. A staging migration and bounded rehearsal run with only test data; restore, reconciliation, rollback/forward-fix, and revision-overlap connection evidence are recorded.
5. The source-only [production persistence boundary](production-persistence-boundary.md), approved role matrix, fixed administration commands, People & Access projection/page, durable invitation fulfillment, OIDC verification/session issuance, verifier/attempt-cookie hardening, negative-case/real-PostgreSQL login test matrix, and expanded client/project/lead/project-meeting routes are accepted in source through PRs #51/#55.
   PR #51 is merged source-only and undeployed. Session renewal, remaining provider adapters, connector-specific credential grants and approved composition, PostgreSQL migration/grant apply, and live identity configuration then proceed in their gated order.
6. The full application and interface run in the container; supported provider routes stop returning `feature_unavailable`; route/browser/security tests pass; and the owner separately approves deployment.

No source route work in this branch applies a migration or infrastructure plan, provisions Cloud SQL/Cloud Run, deploys a revision, admits a second user, or moves real client/employee data.

Current Google guidance requires the ingress container to listen on `0.0.0.0:$PORT`, recommends bounded database pooling, supports startup/liveness/readiness probes, treats jobs as run-to-completion processes, and recommends Secret Manager for sensitive values. See [Cloud Run’s container contract](https://docs.cloud.google.com/run/docs/container-contract), [Cloud Run health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks), [Cloud Run jobs](https://cloud.google.com/run/docs/create-jobs), [Cloud SQL connections from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run), [Cloud SQL connection management](https://docs.cloud.google.com/sql/docs/postgres/manage-connections), and [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).
