# Database role and grant denial checks

Status: Source-only procedure and evidence template. No role, membership, grant,
or denial check has been applied to a database by adding this file.

Run active checks only in an owner-approved, isolated staging database populated
with `FCI TEST — DO NOT USE` records. Never aim destructive denial statements at
development, production, or a shared database. Production acceptance may repeat
safe catalog/readiness checks, but active destructive probes require a separately
approved disposable target.

The reviewed source policy is
[`infrastructure/postgres/least-privilege.sql`](../../../infrastructure/postgres/least-privilege.sql).
It defines capability roles, not environment login principals or passwords.

## 1. Preflight

- [ ] Record approval, staging target, source commit, expected migration history,
  executor, independent verifier, and cleanup plan.
- [ ] Confirm the target project, instance, database, and schema three ways:
  approved configuration, authenticated identity, and a read-only database query.
- [ ] Confirm environment-specific bootstrap, migration, runtime, and rehearsal
  logins are distinct and receive no committed key or password.
- [ ] Confirm the application schema is `fci_app`, rehearsal schemas match
  `^fci_rehearsal_[a-z0-9_]{1,49}$`, and all test rows are disposable.
- [ ] Capture the expected exact grants from reviewed source before comparing the
  live catalog.

## 2. Expected boundary

| Principal/capability | Must succeed | Must be denied |
| --- | --- | --- |
| External bootstrap administrator | Only the separately approved bootstrap and membership procedure | Routine application use |
| Migration login after validated `SET ROLE fci_migration_owner` | Own/use `fci_app`, run reviewed immutable migrations, update migration history | Runtime requests, broad administration, or bypassing the approved migration job |
| `fci_runtime` | `USAGE` on `fci_app`; exact table operations in the source policy; read-only migration history | Schema/table creation, `DELETE`, `TRUNCATE`, `DROP`, role/grant changes, broad future-table/function/sequence access, rehearsal-schema access |
| `fci_rehearsal_importer` | Bounded `SELECT`/`INSERT` only in one reviewed rehearsal schema | Any `fci_app` access, `UPDATE`, `DELETE`, `TRUNCATE`, schema creation, functions, sequences, or another rehearsal schema |
| `PUBLIC` | Only unavoidable database-connect behavior approved by the administrator | Application schema/table/sequence/function access |

The runtime currently needs the exact `SELECT`/`INSERT`/`UPDATE` grants listed in
the source policy. A passing test must not replace that allowlist with `GRANT ALL`
or a future-table wildcard.

## 3. Catalog and ownership checks

- [ ] Verify each capability role is `NOLOGIN`, non-superuser, cannot create
  roles/databases, cannot replicate, and cannot bypass row-level security.
- [ ] Verify `fci_app` is owned by `fci_migration_owner` and `PUBLIC` has no
  schema privileges.
- [ ] Verify every application table, sequence, and function owner and compare
  every non-owner grant to the reviewed allowlist.
- [ ] Verify global and `fci_app` default privileges cannot silently grant
  access to `PUBLIC`, runtime, or rehearsal roles.
- [ ] Verify the environment migration login can set the owner role but does not
  rely on inherited ownership; confirm `CURRENT_USER` only becomes
  `fci_migration_owner` after the explicit role change.
- [ ] Verify the runtime can read exact migration version/name/checksum history
  but cannot change it.
- [ ] Verify the runtime login cannot `SET ROLE fci_migration_owner` or
  `SET ROLE fci_rehearsal_importer` and has no application-schema sequence access.
- [ ] Verify the rehearsal importer has no `fci_app` grant and is a member only
  for the approved exercise window.

## 4. Positive and negative behavior checks

Use disposable test records and objects with an `fci_denial_` prefix. Wrap each
active probe in its own transaction and roll it back. Stop if rollback is
uncertain. Record only the statement category and safe SQLSTATE/error code, not
database URLs or row content.

- [ ] Runtime: allowed client/project reads and explicitly granted writes
  succeed and create the expected activity/outbox evidence.
- [ ] Runtime: schema/table creation, deletion, truncation, drop/alter, grant/role
  changes, migration-history writes, unlisted table access, and rehearsal-schema
  access fail with the expected authorization error.
- [ ] Migration login before `SET ROLE`: migration ownership checks fail.
- [ ] Migration login after `SET ROLE`: reviewed migration operations succeed,
  objects have the expected owner, and `RESET ROLE` always occurs.
- [ ] Rehearsal importer: bounded reads/inserts in its assigned schema succeed;
  writes outside the allowlist and every `fci_app` access fail.
- [ ] `PUBLIC`/an unprivileged test login: application schema and object access
  fail.
- [ ] A future test table created by the migration owner receives no unintended
  runtime or rehearsal access from default privileges.

## 5. Readiness and cleanup

- [ ] `/readyz` succeeds with the exact runtime boundary: schema `USAGE`, no
  schema `CREATE`, no privileged-role assumption or sequence access, and exact
  migration history.
- [ ] Prove readiness fails when schema `USAGE` is absent, schema `CREATE` is
  present, or migration history is missing, changed, reordered, or ahead.
- [ ] Roll back/remove every disposable object and row.
- [ ] Revoke temporary rehearsal and human memberships and verify revocation.
- [ ] Re-run the catalog comparison to prove the exercise left no grant drift.
- [ ] Have the independent verifier compare actual results to the exact source
  policy and record all deviations as blockers.

## Evidence matrix

```text
Target and approval reference:
Source policy commit:
Principal/capability:
Check category:
Expected result or SQLSTATE:
Actual result or safe SQLSTATE:
Pass/fail:
Safe evidence reference:
Cleanup verified:
Exception/follow-up:
```
