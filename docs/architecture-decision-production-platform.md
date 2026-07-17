# Production platform decision

Status: Accepted  
Decision date: July 12, 2026

## Decision

The controlled development environment may continue on OpenAI Sites with Cloudflare Workers, D1, and R2. The production system will return to the approved Google Cloud architecture before scheduling, messaging, or AI document indexing is built. For the initial 20-person rollout, use one regional modular monolith rather than a microservice fleet. The list below is the target capability set, not a requirement to provision every service for launch; activation follows the [Workspace-first, cost-controlled rollout](architecture-decision-workspace-first-cost-controlled-rollout.md):

- One regional Cloud Run service for the web application, API, and authenticated task/webhook handlers.
- One Cloud SQL PostgreSQL database as the system of record, with connection pooling, constraints, transactions, backups, and point-in-time recovery.
- Cloud Tasks for explicit reminder delivery, synchronization, webhook follow-up, retries, and rate control. Terminal failures remain in application-owned durable failed-job records with alerts and controlled replay; Cloud Tasks is not the dead-letter system of record.
- Cloud Scheduler for outbox dispatch, expired-lease recovery, Gmail/Calendar renewal and reconciliation, cleanup, and materializing long-range reminders into the supported Cloud Tasks scheduling window.
- Pub/Sub where required by the upstream source, beginning with Gmail push notifications.
- Expiring HTTPS webhook channels for Google Calendar notifications; Calendar does not publish its changes through Pub/Sub.
- Cloud Storage for application-managed upload quarantine. Approved business documents remain in the company Shared Drive.
- Secret Manager for OAuth credentials, token-encryption keys, provider credentials, and application secrets.
- Google Workspace OIDC with explicit invitations, signed domain verification, roles, capabilities, and project permissions.
- `pgvector` only when permission-filtered semantic document retrieval is scheduled; it is not required for the first production launch.

Sites/D1/R2 is therefore a development environment, not the production data plane. Do not add real client data or expand access to multiple staff until the production access, backup, audit, and restore controls pass acceptance.

The development D1 schema changes use the checked-in [D1 development deployment migrations](development-d1-schema-migrations.md). Sites applies that ordered sequence during controlled deployment, and normal API requests execute no schema DDL. This is deliberately separate from, and does not replace, the required PostgreSQL production migration and rollback system.

The source-only [production PostgreSQL foundation](production-postgresql-foundation.md), [repository slice](production-postgresql-repositories.md), and [production persistence boundary](production-persistence-boundary.md) now define the core client/contact/project records, business activity evidence, idempotency, outbox, generic employee identity structures, append-only security audit, company-connector/file metadata, immutable migration history, aggregate repositories, and a provider-neutral object-storage contract. The [Google Cloud runtime foundation](google-cloud-runtime-foundation.md) adds validated private Cloud SQL composition, bounded pools, separate migration and rehearsal commands, exact privilege-aware readiness, least-privilege source policy, and a bounded test-data rehearsal. The source-only [authorization and employee-route boundary](authorization-simulation.md) adds the approved granular role ceilings, secure-session/CSRF checks, project-scoped PostgreSQL queries, fixed sensitive-operation gates, append-only decision evidence, functional dashboard/search/project/client/logout source routes, the five fixed Administrator commands, the People & Access read projection/page, and the minimized Activity reader/tab; file/Gmail/Calendar routes remain provider-unavailable after authorization. Reviewable [Google Cloud source definitions](../infrastructure/google-cloud/README.md) also exist with zero-resource defaults and optional modules disabled. The People/Activity presentation adapter is deployed only to private Sites development. Nothing has been applied to Cloud SQL, connected to live Workspace identity, migrated with live data, provisioned, or deployed to the production target. Durable invitation fulfillment/OIDC/session issuance, production employee-session/CSRF composition, Field Lead link issuance, live storage/integration adapters, staging rehearsal, and complete cutover still remain.

Provisioning and service activation follow the [Workspace-first, cost-controlled rollout](architecture-decision-workspace-first-cost-controlled-rollout.md). That supplemental decision changes rollout timing and cost gates, not this production architecture. It keeps Sites as development, staging on demand, and optional services disabled until their features are scheduled; the continuously provisioned launch core is limited to the approved Cloud Run, Cloud SQL, Secret Manager, identity/authorization, monitoring, backup, and restore boundary.

## Why

The remaining product roadmap is dominated by work that benefits from PostgreSQL transactions and durable asynchronous processing: lead conversion, appointment state changes, crew scheduling, Gmail and Calendar reconciliation, messaging retries, audit history, and permission-filtered vector search. Google Cloud also aligns the application's identity and integration boundary with the company's Google Workspace tenant.

Keeping D1/R2 for production would be workable for the current single-user surface, but it would require a separate job architecture and later rework of the schema, queries, migrations, files, authentication, and deployment. Moving before those modules are built is the smaller and safer migration.

## Migration boundary

The existing Sites deployment remains available only for controlled development validation while the Google Cloud foundation is prepared. Feature work during this period should be limited to portable domain behavior and development-critical fixes.

The production cutover must include:

1. Define isolated development, staging, and production project, credential, secret, and data boundaries; creating a project or provisioning resources remains separately approved. Continue using Sites for development, and create billable staging resources from reviewed definitions only when an approved rehearsal or release requires them.
2. Port the SQLite/D1 schema to PostgreSQL with explicit foreign keys, constraints, transactions, and audit fields.
3. Replace Cloudflare bindings with provider-neutral database and object-storage interfaces.
4. Extend the narrow source-composed dashboard/search/project/client/logout and fixed administration-command HTTP boundary across the accepted employee application. The People & Access projection/page and minimized Activity reader/tab now exist in source; next compose durable explicit-invitation fulfillment, Workspace OIDC verification, production session issuance/renewal, PostgreSQL migrations/grants, provider adapters, and rendered production permissions. The source routes and private Sites presentation adapter do not themselves admit an employee.
5. Add provider-neutral durable job and integration state first. Activate Cloud Scheduler, Cloud Tasks, Gmail Pub/Sub, and Calendar HTTPS channels only when their associated background features are approved; then apply idempotency, retry, reconciliation, failed-job, alert, and controlled-replay requirements.
6. Migrate only reviewed records and files, preserving identifiers and audit evidence where required.
7. Verify backup restoration, retention, audit access, and end-to-end behavior for every integration enabled at launch; require malware scanning evidence only if untrusted uploads are enabled.
8. Freeze writes to the development environment, perform a final reconciliation, switch the production URL, and retain a time-boxed rollback window.

## Consequences

- Near-term production feature work pauses behind the platform migration.
- The current UI and domain workflows can be reused, but Cloudflare-specific imports and D1 migrations must be replaced.
- The development environment is not promoted in place and is not treated as the authoritative production database.
- New background-processing and vector-search features are built once on their intended production boundaries, but their Google Cloud modules remain disabled until the feature and cost gates pass.
- The service count stays intentionally small for a 20-person company; split services only when scaling, deployment isolation, or security evidence justifies the operating cost.

## Implementation references

- [Google Cloud: Cloud Tasks compared with Pub/Sub](https://docs.cloud.google.com/tasks/docs/comp-pub-sub)
- [Google Cloud: Cloud Tasks quotas](https://docs.cloud.google.com/tasks/docs/quotas)
- [Google Cloud: Trigger Cloud Run with Cloud Scheduler](https://docs.cloud.google.com/run/docs/triggering/using-scheduler)
- [Google Workspace: Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Google Workspace: Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [Google Cloud SQL best practices](https://docs.cloud.google.com/sql/docs/best-practices?hl=en)
- [Cloud Run networking best practices](https://docs.cloud.google.com/run/docs/configuring/networking-best-practices)
- [Google Identity OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference)

