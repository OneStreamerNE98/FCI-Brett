# Production platform decision

Status: Accepted  
Decision date: July 12, 2026

## Decision

The controlled pilot may continue on OpenAI Sites with Cloudflare Workers, D1, and R2. The production system will return to the approved Google Cloud architecture before scheduling, messaging, or AI document indexing is built. For the initial 20-person rollout, use one regional modular monolith rather than a microservice fleet:

- One regional Cloud Run service for the web application, API, and authenticated task/webhook handlers.
- One Cloud SQL PostgreSQL database as the system of record, with connection pooling, constraints, transactions, backups, and point-in-time recovery.
- Cloud Tasks for explicit reminders, synchronization, webhook follow-up, retries, rate control, and dead-letter handling.
- Pub/Sub where required by the upstream source, beginning with Gmail push notifications.
- Expiring HTTPS webhook channels for Google Calendar notifications; Calendar does not publish its changes through Pub/Sub.
- Cloud Storage for application-managed upload quarantine. Approved business documents remain in the company Shared Drive.
- Secret Manager for OAuth credentials, token-encryption keys, provider credentials, and application secrets.
- Google Workspace OIDC with explicit invitations, signed domain verification, roles, capabilities, and project permissions.
- `pgvector` only when permission-filtered semantic document retrieval is scheduled; it is not required for the first production launch.

Sites/D1/R2 is therefore a pilot environment, not the production data plane. Do not add real client data or expand the pilot to multiple staff until the production access, backup, audit, and restore controls pass acceptance.

The pilot's route-time D1 bootstrap is centralized in the [D1 pilot runtime schema migrations](pilot-d1-schema-migrations.md). That ordered, additive bridge removes duplicated route-local DDL, but it is not a comprehensive drift detector or repair tool. It is deliberately separate from, and does not replace, the required PostgreSQL production migration and rollback system.

## Why

The remaining product roadmap is dominated by work that benefits from PostgreSQL transactions and durable asynchronous processing: lead conversion, appointment state changes, crew scheduling, Gmail and Calendar reconciliation, messaging retries, audit history, and permission-filtered vector search. Google Cloud also aligns the application's identity and integration boundary with the company's Google Workspace tenant.

Keeping D1/R2 for production would be workable for the current single-user surface, but it would require a separate job architecture and later rework of the schema, queries, migrations, files, authentication, and deployment. Moving before those modules are built is the smaller and safer migration.

## Migration boundary

The existing Sites deployment remains available only for controlled pilot validation while the Google Cloud foundation is prepared. Feature work during this period should be limited to portable domain behavior and pilot-critical fixes.

The production cutover must include:

1. Provision separate development, staging, and production Google Cloud environments.
2. Port the SQLite/D1 schema to PostgreSQL with explicit foreign keys, constraints, transactions, and audit fields.
3. Replace Cloudflare bindings with provider-neutral database and object-storage interfaces.
4. Implement Workspace OIDC, explicit invitations, office-domain restrictions, secure sessions, roles, capabilities, and project-level permissions.
5. Add Cloud Tasks workers with idempotency, retry limits, and dead-letter handling; route Gmail watches through Pub/Sub and Calendar notifications through HTTPS channels.
6. Migrate only reviewed records and files, preserving identifiers and audit evidence where required.
7. Verify backup restoration, retention, audit access, malware scanning, and end-to-end Google Workspace behavior.
8. Freeze writes to the pilot, perform a final reconciliation, switch the production URL, and retain a time-boxed rollback window.

## Consequences

- Near-term production feature work pauses behind the platform migration.
- The current UI and domain workflows can be reused, but Cloudflare-specific imports and D1 migrations must be replaced.
- The pilot is not promoted in place and is not treated as the authoritative production database.
- New background-processing and vector-search features are built once on their intended production services.
- The service count stays intentionally small for a 20-person company; split services only when scaling, deployment isolation, or security evidence justifies the operating cost.

## Implementation references

- [Google Cloud: Cloud Tasks compared with Pub/Sub](https://docs.cloud.google.com/tasks/docs/comp-pub-sub)
- [Google Workspace: Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Google Workspace: Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [Google Cloud SQL best practices](https://docs.cloud.google.com/sql/docs/best-practices?hl=en)
- [Cloud Run networking best practices](https://docs.cloud.google.com/run/docs/configuring/networking-best-practices)
- [Google Identity OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference)

