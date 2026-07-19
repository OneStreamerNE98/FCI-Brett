# Production PostgreSQL foundation

Reviewed: July 19, 2026

Status: Implemented and tested in source. Not provisioned, applied, or deployed.

## Boundary

The production PostgreSQL foundation is deliberately separate from the current D1 development environment. It defines the first production data model and migration safety controls without changing API routes, D1 migration versions 1–3, the hosted development environment, Google Workspace, or any live data.

This document describes the schema and migration-runner boundary through immutable migration v6. The source-only [PostgreSQL repository slice](production-postgresql-repositories.md) implements client/project/lead/project-meeting adapters, application idempotency, and worker-safe outbox state transitions. The [Google Cloud runtime foundation](google-cloud-runtime-foundation.md) composes those adapters around a bounded private Cloud SQL pool, provides separate service/migration/rehearsal entry points, and defines least-privilege source policy. The full application runtime, a live outbox worker, provisioned Cloud resources/secrets, and complete development-data migration remain later assignments.

## Core model

The record and delivery migrations create these production tables; the generic persistence and administration tables added by v3–v5 are documented in their dedicated boundaries:

| Table | Production purpose |
| --- | --- |
| `production_schema_migrations` | Immutable version, name, checksum, and application time for each applied migration. |
| `clients` | Unique client code and normalized client-name key, constrained state, audit actors/timestamps, and optimistic-concurrency version. |
| `contacts` | Client-owned contacts with a real foreign key and at most one primary contact per client. |
| `projects` | Client-owned projects with unique project numbers, constrained state, whole-number nonnegative estimated value, and a version field. |
| `leads` | Independent flooring leads with `L-YYYY-XXXXXXXX` identifiers, bounded contact/project/action fields, constrained status/value, audit actors/timestamps, and a version field. Added by migration v6. |
| `project_meetings` | Project-owned meeting evidence with bounded type/source/link/text/list fields and a required evidence invariant. Added by migration v6. |
| `activity_events` | Append-only client-, project-, or lead-scoped business activity evidence with actor, correlation ID, result, optional reason, structured detail, and occurrence time. It is not the general security-audit store. |
| `idempotency_requests` | Actor-scoped operation/request keys, request fingerprints, response state, expiry, and a version field. |
| `outbox_events` | Transactional delivery intent with actor/correlation evidence, an event-type-to-record constraint, retry availability, lease state, dead-letter time, and a version field. |

A future general append-only `audit_events` model must cover authentication failures, sessions, invitations, roles/capabilities, memberships, exports, files, connector administration, jobs, and recovery. It should have separate access and retention rules from the user-facing client/project activity timeline.

Every relationship in this bounded model uses a named foreign key and has an index on its referencing column. Identifiers supplied by the application use PostgreSQL `uuid`; actor identifiers remain text until the user/identity schema is approved. Time values use `timestamptz`, structured payloads use `jsonb`, and all table/check/foreign-key/unique identifiers are explicit lowercase snake case.

`projects.estimated_value` is exact PostgreSQL `numeric` with a database check that rejects fractions, negative values, and values above JavaScript’s safe-integer ceiling. `version` fields use `bigint`; the repository adapter validates and returns them as canonical decimal strings rather than silently coercing an out-of-range value to JavaScript `number`.

The repository produces `clients.normalized_name_key` with this exact application-side algorithm before inserting: `name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()`. In words: Unicode NFKC normalization, trim outer whitespace, collapse internal Unicode whitespace to one ASCII space, then apply JavaScript's locale-independent lowercase conversion. The function is centralized and tested with composed/decomposed Unicode plus whitespace variants. The database enforces a trimmed lowercase, nonempty, unique key, but PostgreSQL `lower()` alone is not a complete Unicode normalization algorithm.

## Migration safety

`app/platform/postgres/production-schema-migrations.ts` is the only production PostgreSQL migration registry in this slice.

The runner:

1. Validates positive contiguous versions, unique lowercase names, nonempty statements, and every declared SHA-256 checksum before connecting.
2. Normalizes CRLF/CR line endings to LF when calculating checksums. Any other change to an applied migration is a history mismatch; add a new version instead.
3. Obtains a dedicated database connection because the migration lock is session-scoped.
4. Acquires one explicit PostgreSQL session advisory lock with bounded `pg_try_advisory_lock` retries before any DDL, validates that the configured lowercase target schema exists, verifies its activated owner role when supplied, and sets a deterministic target-schema, `pg_catalog`, then `pg_temp` search path on that dedicated connection. Explicitly placing `pg_temp` last prevents a reused session's temporary relation from shadowing migration history. The default lock wait is 10 seconds and the default target is `public`; production provisioning may pass another pre-created schema explicitly.
5. Creates the migration-history table if missing. This bootstrap is the only production statement allowed to use `IF NOT EXISTS`, and it is serialized by the advisory lock.
6. Re-reads history after acquiring the lock so a concurrent runner cannot use stale history.
7. Rejects unknown versions, gaps, reordered history, or changed names/checksums. Applied history must be an exact prefix of the source registry.
8. Applies each pending version in its own short transaction with separately validated, configured local lock and statement timeouts. The history row is written last in that transaction.
9. Attempts to roll back a failed version, restores the connection's original search path, and releases the advisory lock and dedicated connection in `finally` paths without masking the primary migration failure. A restore/unlock cleanup failure marks the connection for discard instead of returning contaminated session state to the pool.

The runtime foundation may also pass a strictly validated migration-owner role. The runner executes and verifies `SET ROLE` before acquiring the lock/creating objects and resets the role before releasing the dedicated connection. This makes PostgreSQL object ownership and default privileges deterministic instead of relying on inherited membership.

Do not use `CREATE INDEX CONCURRENTLY` inside these migration transactions. If a future large-table index requires concurrent creation, design and review a separate resumable maintenance procedure rather than weakening this runner.

## Implemented idempotency and outbox contract

The later [PostgreSQL repository slice](production-postgresql-repositories.md) uses the schema constraints for atomic actor/operation/key claims. Client/project/lead/project-meeting creation, activity evidence, matching outbox intent, and the completed replay response commit in one short transaction. Deterministic 404/409 failures also retain the key binding. A same-fingerprint retry returns the stored winning response or failure; a changed normalized request is rejected.

The outbox adapter claims small ordered batches with `FOR UPDATE SKIP LOCKED` and commits before any provider work. Version-fenced completion, retry/dead-letter, and expired-lease recovery prevent stale workers from overwriting a newer claim. A live queue worker and provider calls remain deliberately unwired.

## Rollback strategy

There are intentionally no automatic down migrations. Dropping production tables or columns can destroy data and cannot safely reverse an already-observed external effect.

- Before a staging or production migration, verify a restorable backup and record the restore point.
- Prefer a reviewed forward-fix migration for a compatible schema defect.
- If a migration or release requires environment rollback, stop writes, restore the verified database backup into a controlled target, reconcile counts/identifiers/audit evidence, and switch only with owner approval.
- Never edit an applied migration version, name, statement, or checksum to make a rollback appear successful.

The restore and cutover procedure must be rehearsed with test data before production approval.

## Test behavior

Fast unit tests run without PostgreSQL and cover registry validation, LF-normalized checksums, advisory-lock ordering, post-lock history reads, atomic version markers, rollback, unlock/release behavior, bounded table scope, named constraints, and foreign-key index declarations.

The GitHub workflow starts a PostgreSQL 16 service with test-only credentials and runs the integration suites against isolated random schemas. Foundation coverage applies all versions concurrently from empty state, verifies no-op reruns, checks rollback of a failed version, exercises foreign keys/status/value/JSON/idempotency constraints, verifies the partial outbox index, and checks for missing foreign-key indexes. Repository coverage exercises concurrent idempotent replay, atomic rollback, Unicode uniqueness, exact numeric/version handling, audited project assignment, disjoint outbox claims, fenced transitions, dead-letter evidence, and lease recovery. When `TEST_POSTGRES_URL` is present, connection or migration failure fails the suite; it cannot silently skip. Local `npm test` remains usable when that variable is absent.

Never point `TEST_POSTGRES_URL` at a shared, staging, or production database. The integration test creates and drops its own schema.

## Runtime work now defined in source

- Private Cloud SQL connector composition and one bounded pool per process.
- A fail-closed Cloud Run service with process-only liveness and exact migration/privilege-aware readiness.
- Separate one-connection migration and rehearsal commands built from the same immutable image.
- Explicit runtime/migration/rehearsal access modes, Secret Manager-friendly password-file input, redacted operational errors, and ordered shutdown.
- Source-only capability roles/exact grants plus a bounded test-data rehearsal that preserves supported core IDs and audit evidence while always reporting that full cutover is not ready.

See [Google Cloud runtime foundation](google-cloud-runtime-foundation.md) for the exact boundary and remaining work.

## Provisioning work intentionally deferred

- Provision environment-specific login/IAM database principals and apply the reviewed migration-owner/runtime/rehearsal capability policy; source definitions alone do not change any database.
- Configure private Cloud SQL networking, connection pooling/caps, SSL requirements, backups, point-in-time recovery, monitoring, and Secret Manager references.
- Run the bounded core migration, full data inventory, restore, and rollback/forward-fix rehearsals in development and staging before production.
- Port the remaining application routes/schema/object storage and implement the live queue/provider worker only after runtime and authorization review.
- Add users, secure sessions, roles/capabilities, and project memberships before a second employee is admitted.

No applied role grants, login credentials, Cloud resources, production connections, live migrations, deployments, or Workspace changes are part of this source-only foundation.
