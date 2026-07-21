# D1 development deployment migrations

Status: Implemented in source; not deployed or applied by this change
Scope: Controlled single-user development environment using test data only

## Boundary

The development environment uses the checked-in Drizzle migration sequence under `drizzle/` as its only schema-change path. Sites packages that sequence with the built worker and applies pending D1 migrations as part of the controlled deployment flow. Normal API requests do not create tables, create indexes, or otherwise bootstrap schema.

This is **not** the future PostgreSQL production migration system. It does not satisfy the production migration, rollback, backup, restore, foreign-key, transaction, or cutover checklist. Production still requires Cloud SQL PostgreSQL migrations that are reviewed and exercised independently in development and staging.

## Deployment and local behavior

1. `db/schema.ts` declares the desired development schema and named indexes.
2. `npm run db:generate` creates the next immutable migration and updates Drizzle history metadata.
3. `npm run build` copies the complete sequence to `dist/.openai/drizzle/` for Sites packaging.
4. A Sites deployment applies pending migrations before the new worker version serves requests. Do not deploy or apply the hosted migration without owner approval.
5. `ensureWorkspaceSchema()` remains temporarily as a DDL-free compatibility helper while route callers are removed. It does not import the D1 binding or query the database.
6. A developer explicitly runs `npm run db:migrate:local` before local development or after pulling a new migration. The command is fixed to the placeholder local D1 database and cannot target the hosted database.

## July 2026 request-time bootstrap removal

Migration `0011_lazy_big_bertha.sql` moves the remaining runtime-only integrity and lookup indexes into the versioned Sites/D1 sequence:

- unique client code and client name;
- client-contact lookup;
- project number uniqueness and client-project lookup;
- filing-rule priority and mail-status lookup;
- Google integration event chronology; and
- generic-record type lookup.

The application runtime contains no `CREATE TABLE` or `CREATE INDEX` statements. This removes the former first-request schema batch from every worker isolate while preserving the portable client/project creation invariants.

## KPI-02 additive project fields — merged PR #52

Migration `0012_green_magneto.sql` is now in `main` through merged PR #52. It adds three nullable columns to the development `projects` table:

- `flooring_category` (`text`) stores one server-validated value from `hardwood`, `carpet`, `luxury-vinyl`, `tile-stone`, `laminate`, `specialty`, or `mixed`;
- `square_feet` (`integer`) stores a server-validated positive whole number; and
- `contract_value` (`integer`) stores a server-validated non-negative whole-dollar sold price. The development API accepts and returns this financial field only for Administrators.

All three columns are nullable so existing project rows remain valid. The migration has no backfill, index, constraint, data rewrite, drop, delete, or truncate operation. PostgreSQL parity is intentionally deferred to KPI-04; this D1 migration does not alter or apply any production migration.

PR #52 is merged source-only and undeployed. Its merge did not apply migration `0012` to the hosted D1 database. A contributor may apply it only to the fixed placeholder local database with `npm run db:migrate:local`. The hosted migration remains behind a separate owner-approved Sites deployment: back up the controlled development database, deploy the reviewed merged source, verify that Sites recorded the pending migration successfully, and smoke-test project creation and the new optional fields. Until that deployment completes, the live development site must be treated as not having these columns.

## SET-13 Workspace resource registry — source only

Migration `0013` adds the `workspace_resources` registry for app-managed Google Workspace
resource IDs. Rows are isolated by `connection_key` and uniquely identify one
`resource_type` + `resource_key` pair. The registry records created/adopted external IDs,
optional parent and URL metadata, origin, metadata JSON, actor, and timestamps.

The migration is additive only: it creates one table and its unique index, with no
backfill, rewrite, drop, delete, or truncate. The production Google connector does not
consume this D1 table; a future approved production flow reconciles these identities into
the existing PostgreSQL `integration_resources` boundary after fresh production
authorization. Migration `0013` is source-only and unapplied to Sites until a separate
owner-approved controlled deployment.

## Migration 0011 existing development database safety

Migration `0011` is additive and does not drop, delete, truncate, rewrite, or backfill data. Its unique indexes intentionally fail if existing test records contain duplicate client codes, duplicate client names, or duplicate project numbers.

Before the first hosted deployment containing this migration:

1. back up the development D1 database;
2. inspect the test records for duplicates in those fields;
3. correct conflicts only through an approved maintenance procedure; and
4. apply the migration, verify its recorded success, and smoke-test client and project creation.

Do not weaken the unique indexes or automatically discard records to make deployment pass.

## Canonical sources and developer rules

- `db/schema.ts` is the desired SQLite/D1 schema definition.
- `drizzle/*.sql` and `drizzle/meta/` are the immutable, ordered deployment history.
- `.openai/hosting.json` declares the logical `DB` binding; Sites owns the hosted D1 resource and deployment wiring.
- `wrangler.local.jsonc` exists only for explicit local migration and uses the non-routable placeholder database identifier.
- Never add schema DDL to route handlers or other application runtime modules.
- Never edit an applied migration. Change `db/schema.ts`, generate a new migration, inspect its SQL, and commit the migration and metadata together.
- Never apply a real migration, change hosted configuration, or deploy without owner approval.

Regression tests verify that request helpers and runtime modules contain no schema DDL, required indexes exist in both the schema and migration history, the Drizzle journal is complete, the local command cannot target a remote database, and the build packages the full migration sequence for Sites.
