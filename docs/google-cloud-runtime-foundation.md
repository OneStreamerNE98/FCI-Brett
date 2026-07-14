# Google Cloud runtime foundation

Reviewed: July 13, 2026

Status: Implemented and tested in source only. Not provisioned, connected, migrated, or deployed.

## Read this boundary first

This slice creates the reviewable Cloud Run and Cloud SQL runtime foundation without changing the current Sites/Workers/D1/R2 development application. The new container is intentionally fail-closed:

- `GET` or `HEAD /healthz` reports process liveness.
- `GET` or `HEAD /readyz` reports ready only when the configured PostgreSQL schema is reachable, the current role has schema `USAGE` but not `CREATE`, and every migration version, name, and checksum exactly matches source.
- Every application path returns `503` with `production_app_not_composed`.

The last behavior is deliberate. The current page and API tree still imports `cloudflare:workers`, uses D1/R2 bindings, and depends on the Sites identity boundary. This source image is not yet the employee web application and must not be deployed as though it were. The production checklist item “Containerize the Next.js application” remains open until the remaining routes, object storage, and Workspace OIDC boundary are ported.

The [Workspace-first, cost-controlled rollout](architecture-decision-workspace-first-cost-controlled-rollout.md) controls how this source foundation may later be provisioned. Development remains on Sites, staging is created on demand, standalone and regional-HA Cloud SQL profiles must be priced before selection, and optional service modules remain disabled. Nothing in this document authorizes a continuously running development or staging database.

## What is implemented

- A dedicated Node/Cloud Run build that never loads the Sites plugin, Wrangler, Worker entry point, or D1/R2 configuration.
- A non-root multi-stage `Dockerfile.cloud-run` that listens on `0.0.0.0:$PORT` and can run the service or one-off commands from the same immutable image.
- Fail-closed production configuration with explicit application environment, deployment stage, database access mode, private Cloud SQL connection, schema, and bounded pool settings.
- Secret Manager-friendly password-file support. The password is non-enumerable in the in-memory configuration object and is never included in operational events.
- One bounded `pg.Pool` per service instance, with copied query parameters, statement/lock/idle-transaction timeouts, connection lifetime limits, redacted idle-client error evidence, and ordered pool-then-connector shutdown.
- Runtime composition for the completed PostgreSQL adapters. Client and project repositories are created per request so actor/idempotency metadata is not retained between requests; the outbox repository can be process-scoped.
- A separate migration command using a one-connection pool, the immutable checksum runner, a session advisory lock, and an explicit validated migration-owner `SET ROLE`. Normal requests never import or call the migration runner.
- Source-only capability roles and exact grants. The runtime role receives no schema creation, delete, truncate, reference, trigger, sequence, function, or broad future-table privilege.
- A bounded test-data rehearsal for production-compatible clients, contacts, projects, and explicitly classified client/project activity events.

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
| `FCI_POSTGRES_SCHEMA` | Lowercase target schema. Production should use a dedicated application schema; rehearsal schemas must begin `fci_rehearsal_`. |
| `FCI_POSTGRES_MIGRATION_ROLE` | Required only for migration mode; use the reviewed schema-owner role name. |
| `FCI_POSTGRES_POOL_MAX` | Runtime defaults to `5` and is capped at `10`; migration and rehearsal must be `1`. |
| `PORT` | Defaults to `8080`; Cloud Run supplies this for the ingress container. |

Optional bounded timeout/lifetime values are documented in `.env.example`. They are non-secret configuration; passwords and other credentials still belong only in Secret Manager or another approved encrypted runtime setting.

The Cloud SQL Node.js connector uses Application Default Credentials and private IP. Do not set `GOOGLE_APPLICATION_CREDENTIALS` to a committed or mounted service-account key in Cloud Run. Assign the service identity only the IAM permissions required to connect to its intended Cloud SQL instance and secrets.

## Build and process separation

```powershell
npm.cmd run build:cloud-run
```

The build produces three distinct entry points under `work/cloud-run`:

- `cloud-run-server.mjs` — fail-closed service and health endpoints;
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

Use [`infrastructure/postgres/rehearsal-importer-template.sql`](../infrastructure/postgres/rehearsal-importer-template.sql) only as a reviewed per-schema grant template after the isolated rehearsal schema has been migrated. It rejects non-rehearsal schema names and validates the expected core-table boundary; it has not been applied anywhere.

The environment-specific migration login must have permission to set the owner role, and the migration command verifies `CURRENT_USER` after `SET ROLE`. Inherited membership alone would leave new objects owned by the login and would not apply the owner role’s default privileges.

Runtime readiness receives `SELECT` on migration history only so it can compare immutable version/name/checksum metadata. It receives no ability to modify that history. Every future migration must update and test the explicit access policy; no default grant gives the runtime access to every future table.

## Bounded core rehearsal

The rehearsal snapshot is a strict, test-only exchange format rather than a raw D1 export. It:

- requires every client and project name to equal `FCI TEST — DO NOT USE` or begin with that exact marker plus a space;
- rejects snapshot files larger than 16 MiB and rejects more than 5,000 bounded core rows before row mapping;
- accepts only production-compatible UUIDs, codes, statuses, timestamps, relationships, and explicit activity results/correlation IDs;
- rejects identifier remapping, orphan relationships, duplicate normalized client names, multiple primary contacts, non-null legacy Drive fields, unknown fields, and any deferred source category with records;
- requires an empty, pre-migrated schema matching `^fci_rehearsal_[a-z0-9_]{1,49}$` and a restricted rehearsal importer role;
- verifies that every target migration version, name, and immutable checksum exactly matches the reviewed source registry before inserting;
- inserts in foreign-key order in one bounded transaction and preserves IDs, timestamps, relationships, and audit meaning;
- creates no idempotency requests, outbox events, or provider calls;
- reads the destination back and compares per-table counts, content SHA-256 evidence, and identifier SHA-256 evidence before commit; and
- always reports `cutoverReady: false`.

The current rehearsal does **not** migrate leads, meetings, generic records, Gmail archives, Drive mappings, OAuth attempts/tokens, Google connections, settings, user preferences, R2 objects, or unclassified legacy activity. OAuth and token material must never be exported into a snapshot; production Google authorization will be established again through the approved production connector.

This is evidence that the bounded core path can be rehearsed. It is not evidence that the complete development application can be cut over.

## What remains before any deployment

1. The owner approves the Google Cloud organization/billing account, region, hostname/DNS owner, alert recipients, RPO/RTO, deployment approver, and rollback owner. The isolated project boundaries, Sites development environment, and on-demand staging posture are already accepted.
2. Costed, unapplied infrastructure definitions are reviewed for private networking, separate standalone and regional-HA Cloud SQL profiles, service identities, Secret Manager, backups/PITR, zero-minimum/bounded-maximum Cloud Run scaling, monitoring, the `$50/month` pre-production alert, and an on-demand staging lifecycle. Optional service modules must default to disabled.
3. The administrator creates environment-specific login/IAM principals, applies the reviewed capability-role policy, and verifies grants with denial tests.
4. A staging migration and bounded rehearsal run with only test data; restore, reconciliation, rollback/forward-fix, and revision-overlap connection evidence are recorded.
5. Users/sessions/roles/project permissions, the remaining PostgreSQL schema and repositories, provider-neutral object storage, Google integration state, and Workspace OIDC are implemented.
6. The full application runs in the container, application paths stop returning the foundation `503`, route/browser/security tests pass, and the owner separately approves deployment.

Current Google guidance requires the ingress container to listen on `0.0.0.0:$PORT`, recommends bounded database pooling, supports startup/liveness/readiness probes, treats jobs as run-to-completion processes, and recommends Secret Manager for sensitive values. See [Cloud Run’s container contract](https://docs.cloud.google.com/run/docs/container-contract), [Cloud Run health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks), [Cloud Run jobs](https://cloud.google.com/run/docs/create-jobs), [Cloud SQL connections from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run), [Cloud SQL connection management](https://docs.cloud.google.com/sql/docs/postgres/manage-connections), and [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).
