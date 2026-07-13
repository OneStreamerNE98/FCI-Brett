# D1 pilot runtime schema migrations

Status: Implemented in source; not deployed or applied by this change
Scope: Controlled single-user, test-data pilot only

## Boundary

The runtime migration registry in `app/platform/pilot-schema-migrations.ts` replaces route-local `CREATE TABLE` and `CREATE INDEX` statements. It preserves the existing Cloudflare D1/SQLite pilot while the accepted Google Cloud production foundation is built.

This is **not** the future PostgreSQL production migration system. It does not satisfy the production migration, rollback, backup, restore, foreign-key, transaction, or cutover checklist. Production still requires Cloud SQL PostgreSQL migrations that are reviewed and exercised independently in development and staging.

## Runtime behavior

1. `ensureWorkspaceSchema()` keeps its existing public role for API callers.
2. Concurrent first requests in one runtime isolate share one ensure attempt.
3. The runner creates `pilot_schema_migrations` if it is missing, then checks the ordered registry one version at a time. An applied version must retain its original migration name.
4. Every pending migration uses one transactional D1 batch. Its version marker is the final statement in that same batch, so a failed table or index statement cannot leave the version marked as applied.
5. A failed ensure attempt is forgotten so a later request can retry safely.
6. Version-marker inserts are idempotent for concurrent first requests in separate isolates.

The current pilot versions baseline:

| Version | Pilot scope |
| --- | --- |
| 1 | Core clients, contacts, leads, projects, meetings, settings, events, generic webhook receipts, and required indexes |
| 2 | Google Workspace connector, Gmail archive, Drive mapping, Sheet state, integration-event, and local-simulation tables |
| 3 | The legacy generic `records` endpoint table and index |

## Existing pilot databases and limits

All schema statements use `IF NOT EXISTS`; the runner does not drop, delete, truncate, or rewrite data. For a database whose business tables predate `pilot_schema_migrations`, the runner attempts each additive statement and records the version only when the transactional D1 batch succeeds.

`IF NOT EXISTS` only creates a missing named object or accepts that an object with that name already exists. It does **not** prove that an existing table has every expected column or altered constraint, repair a mismatched table, or compare statement checksums. A successful version marker therefore means the registered batch completed without a D1 error; it is not comprehensive schema-drift validation.

Two named unique indexes intentionally verify invariants that were not guaranteed by every historical Drizzle-created table:

- `clients_code_unique_idx` on `clients.client_code`
- `projects_number_unique_idx` on `projects.project_number`

If existing test data conflicts with a required unique index—including duplicate client codes, client names, or project numbers—D1 rejects the index, the transactional migration version remains unapplied, and the request reports the underlying migration conflict. Review and correct the duplicate **test data** through an approved, backed-up maintenance procedure before retrying. The runner never deletes or automatically rewrites those records.

## Canonical-source bridge

- `app/platform/pilot-schema-migrations.ts` is the canonical source for route-time D1 pilot bootstrap SQL.
- `db/schema.ts` and `drizzle/*.sql` remain schema-generation and historical migration artifacts. A parity test confirms that their declared tables and named indexes are represented in the runtime bridge; routes do not execute those files.
- The future Cloud SQL PostgreSQL schema and migration/rollback runner is a separate production system governed by the accepted platform decision.

## Developer rules

- Add future pilot-only runtime DDL as the next ordered registry entry; do not put DDL back into routes.
- Keep pilot statements additive and idempotent.
- Never edit an already applied version; add a new version. Migration names are verified, but statement checksums are not yet stored.
- Do not use this runner to apply production PostgreSQL schema changes.
- Do not run a real migration, change hosted configuration, or deploy without owner approval.

Behavior tests cover migration order, already-applied versions, transactional marker placement, failed-batch retries, concurrent ensures, destructive-SQL guards, unique identifier indexes, the webhook-receipt baseline, and the rule that runtime DDL exists only in the pilot migration module.
