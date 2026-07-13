# Production PostgreSQL foundation

Reviewed: July 13, 2026

Status: Implemented and tested in source. Not provisioned, applied, or deployed.

## Boundary

The production PostgreSQL foundation is deliberately separate from the current D1 development environment. It defines the first production data model and migration safety controls without changing API routes, D1 migration versions 1–3, the hosted development environment, Google Workspace, or any live data.

This slice contains schema and migration-runner code only. PostgreSQL repository adapters, application idempotency behavior, outbox workers, users/roles, Cloud SQL, Cloud Run, secrets, and development-data migration remain later assignments.

## Core model

The initial registry creates only these production tables:

| Table | Production purpose |
| --- | --- |
| `production_schema_migrations` | Immutable version, name, checksum, and application time for each applied migration. |
| `clients` | Unique client code and normalized client-name key, constrained state, audit actors/timestamps, and optimistic-concurrency version. |
| `contacts` | Client-owned contacts with a real foreign key and at most one primary contact per client. |
| `projects` | Client-owned projects with unique project numbers, constrained state, whole-number nonnegative estimated value, and a version field. |
| `activity_events` | Append-only client- or project-scoped activity/audit evidence with actor, correlation ID, result, optional reason, structured detail, and occurrence time. |
| `idempotency_requests` | Actor-scoped operation/request keys, request fingerprints, response state, expiry, and a version field. |
| `outbox_events` | Transactional delivery intent with actor/correlation evidence, an event-type-to-record constraint, retry availability, lease state, dead-letter time, and a version field. |

Every relationship in this bounded model uses a named foreign key and has an index on its referencing column. Identifiers supplied by the application use PostgreSQL `uuid`; actor identifiers remain text until the user/identity schema is approved. Time values use `timestamptz`, structured payloads use `jsonb`, and all table/check/foreign-key/unique identifiers are explicit lowercase snake case.

`projects.estimated_value` is exact PostgreSQL `numeric` with a database check that rejects fractions, negative values, and values above JavaScript’s safe-integer ceiling. `version` fields use `bigint`; a future repository adapter must read them as strings or use a guarded parser and must never silently coerce an out-of-range value to JavaScript `number`.

The repository worker must produce `clients.normalized_name_key` with this exact application-side algorithm before inserting: `name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()`. In words: Unicode NFKC normalization, trim outer whitespace, collapse internal Unicode whitespace to one ASCII space, then apply JavaScript's locale-independent lowercase conversion. Centralize that function and test composed/decomposed Unicode plus whitespace variants; never reimplement it per route. The database enforces a trimmed lowercase, nonempty, unique key, but PostgreSQL `lower()` alone is not a complete Unicode normalization algorithm.

## Migration safety

`app/platform/postgres/production-schema-migrations.ts` is the only production PostgreSQL migration registry in this slice.

The runner:

1. Validates positive contiguous versions, unique lowercase names, nonempty statements, and every declared SHA-256 checksum before connecting.
2. Normalizes CRLF/CR line endings to LF when calculating checksums. Any other change to an applied migration is a history mismatch; add a new version instead.
3. Obtains a dedicated database connection because the migration lock is session-scoped.
4. Acquires one explicit PostgreSQL session advisory lock with bounded `pg_try_advisory_lock` retries before any DDL, validates that the configured lowercase target schema exists, and sets a deterministic target-schema-plus-`pg_catalog` search path on that dedicated connection. The default lock wait is 10 seconds and the default target is `public`; production provisioning may pass another pre-created schema explicitly.
5. Creates the migration-history table if missing. This bootstrap is the only production statement allowed to use `IF NOT EXISTS`, and it is serialized by the advisory lock.
6. Re-reads history after acquiring the lock so a concurrent runner cannot use stale history.
7. Rejects unknown versions, gaps, reordered history, or changed names/checksums. Applied history must be an exact prefix of the source registry.
8. Applies each pending version in its own short transaction with local lock and statement timeouts. The history row is written last in that transaction.
9. Attempts to roll back a failed version, restores the connection's original search path, and releases the advisory lock and dedicated connection in `finally` paths without masking the primary migration failure. A restore/unlock cleanup failure marks the connection for discard instead of returning contaminated session state to the pool.

Do not use `CREATE INDEX CONCURRENTLY` inside these migration transactions. If a future large-table index requires concurrent creation, design and review a separate resumable maintenance procedure rather than weakening this runner.

## Idempotency and outbox contract for the next slice

The schema provides the constraints needed for atomic request claiming, but no route uses them yet. The PostgreSQL repository adapter should claim an idempotency key with one statement such as `INSERT ... ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING RETURNING ...`; do not implement a separate select-then-insert check.

Client/project creation and its matching outbox row must be committed in the same database transaction; the schema rejects a `client.created` event aimed at a project or a `project.created` event aimed at a client. A worker should claim a small ordered batch using the `outbox_events_pending_available_idx` partial index and `FOR UPDATE SKIP LOCKED`, update the claim/lease, and commit immediately. Google or other network work must happen after that claim transaction commits. A later short transaction records completion or returns the row to `pending` with a future `available_at`; exhausted work moves to `dead` with `dead_lettered_at` and audit evidence. The `outbox_events_expired_lease_idx` partial index supports a separate short recovery pass for crashed `processing` claims whose lease has expired.

## Rollback strategy

There are intentionally no automatic down migrations. Dropping production tables or columns can destroy data and cannot safely reverse an already-observed external effect.

- Before a staging or production migration, verify a restorable backup and record the restore point.
- Prefer a reviewed forward-fix migration for a compatible schema defect.
- If a migration or release requires environment rollback, stop writes, restore the verified database backup into a controlled target, reconcile counts/identifiers/audit evidence, and switch only with owner approval.
- Never edit an applied migration version, name, statement, or checksum to make a rollback appear successful.

The restore and cutover procedure must be rehearsed with test data before production approval.

## Test behavior

Fast unit tests run without PostgreSQL and cover registry validation, LF-normalized checksums, advisory-lock ordering, post-lock history reads, atomic version markers, rollback, unlock/release behavior, bounded table scope, named constraints, and foreign-key index declarations.

The GitHub workflow starts a PostgreSQL 16 service with test-only credentials and runs the integration suite against an isolated random schema. Integration coverage applies all versions concurrently from empty state, verifies no-op reruns, checks rollback of a failed version, exercises foreign keys/status/value/JSON/idempotency constraints, verifies the partial outbox index, and checks for missing foreign-key indexes. When `TEST_POSTGRES_URL` is present, connection or migration failure fails the suite; it cannot silently skip. Local `npm test` remains usable when that variable is absent.

Never point `TEST_POSTGRES_URL` at a shared, staging, or production database. The integration test creates and drops its own schema.

## Provisioning work intentionally deferred

- Create separate migration-owner and application-runtime database roles, with the runtime role limited to required DML and no schema-change privileges.
- Configure private Cloud SQL networking, connection pooling/caps, SSL requirements, backups, point-in-time recovery, monitoring, and Secret Manager references.
- Run migration and restore rehearsals in development and staging before production.
- Add repository adapters and contract tests, then transactional client/project writes with idempotency and outbox rows.
- Add users, secure sessions, roles/capabilities, and project memberships before a second employee is admitted.

No role grants, login credentials, Cloud resources, production connections, live migrations, deployments, or Workspace changes are part of this source-only foundation.
