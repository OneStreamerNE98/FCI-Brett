# Production platform decision

Status: Accepted  
Decision date: July 12, 2026

## Decision

The controlled pilot may continue on OpenAI Sites with Cloudflare Workers, D1, and R2. The production system will return to the approved Google Cloud architecture before scheduling, messaging, or AI document indexing is built:

- Cloud Run for the web application and API workers.
- Cloud SQL for PostgreSQL as the system of record.
- `pgvector` in PostgreSQL for permission-filtered semantic retrieval.
- Cloud Tasks and Pub/Sub for reminders, synchronization, webhook processing, retries, and dead-letter handling.
- Cloud Storage for application-managed uploads and quarantine. Approved business documents remain in the company Shared Drive.
- Secret Manager for OAuth credentials, token-encryption keys, provider credentials, and application secrets.
- Google Workspace OIDC with domain restrictions for staff identity.

Sites/D1/R2 is therefore a pilot environment, not the production data plane. Do not add real client data or expand the pilot to multiple staff until the production access, backup, audit, and restore controls pass acceptance.

## Why

The remaining product roadmap is dominated by work that benefits from PostgreSQL transactions and durable asynchronous processing: lead conversion, appointment state changes, crew scheduling, Gmail and Calendar reconciliation, messaging retries, audit history, and permission-filtered vector search. Google Cloud also aligns the application's identity and integration boundary with the company's Google Workspace tenant.

Keeping D1/R2 for production would be workable for the current single-user surface, but it would require a separate job architecture and later rework of the schema, queries, migrations, files, authentication, and deployment. Moving before those modules are built is the smaller and safer migration.

## Migration boundary

The existing Sites deployment remains available only for controlled pilot validation while the Google Cloud foundation is prepared. Feature work during this period should be limited to portable domain behavior and pilot-critical fixes.

The production cutover must include:

1. Provision separate development, staging, and production Google Cloud environments.
2. Port the SQLite/D1 schema to PostgreSQL with explicit foreign keys, constraints, transactions, and audit fields.
3. Replace Cloudflare bindings with provider-neutral database and object-storage interfaces.
4. Implement Workspace OIDC, office-domain restrictions, roles, and project-level permissions.
5. Add Cloud Tasks/Pub/Sub workers with idempotency, retry limits, and dead-letter handling.
6. Migrate only reviewed records and files, preserving identifiers and audit evidence where required.
7. Verify backup restoration, retention, audit access, malware scanning, and end-to-end Google Workspace behavior.
8. Freeze writes to the pilot, perform a final reconciliation, switch the production URL, and retain a time-boxed rollback window.

## Consequences

- Near-term production feature work pauses behind the platform migration.
- The current UI and domain workflows can be reused, but Cloudflare-specific imports and D1 migrations must be replaced.
- The pilot is not promoted in place and is not treated as the authoritative production database.
- New background-processing and vector-search features are built once on their intended production services.

