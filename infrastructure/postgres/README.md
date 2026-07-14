# PostgreSQL access policy

`least-privilege.sql` is a reviewable source definition, not an automatic
provisioning or deployment script. It deliberately separates:

- an external, owner-approved bootstrap administrator;
- the `fci_migration_owner` schema owner;
- the `fci_runtime` Cloud Run capability role; and
- the development/staging-only `fci_rehearsal_importer` role.

Run its bootstrap and post-migration phases separately in a dedicated database.
The environment-specific login/IAM principals are created outside this file and
receive no passwords in source control.

The dedicated migration connection must explicitly run:

```sql
SET ROLE fci_migration_owner;
```

before the immutable migration runner executes. Merely inheriting migration
privileges leaves the login as `current_user`, which gives new objects the wrong
owner and bypasses `fci_migration_owner` default privileges. The migration
command must verify both `current_user` and schema ownership before DDL.

The bounded rehearsal runs `SET LOCAL ROLE fci_rehearsal_importer` inside its
transaction. That role has no access to `fci_app`. After an isolated schema has
been created with an `fci_rehearsal_*` name and migrated under the migration
owner, apply `rehearsal-importer-template.sql` with a reviewed schema value:

```powershell
psql <approved non-production connection> `
  --set=fci_rehearsal_schema=fci_rehearsal_<reviewed_run_identifier> `
  --file=infrastructure/postgres/rehearsal-importer-template.sql
```

The template validates the prefix, schema owner, and required migrated tables
before granting anything. It revokes runtime and `PUBLIC` access and gives the
importer only bounded core read/insert access plus read-only migration-history
and delivery-control checks. The rehearsal command then requires every source
migration version, name, and checksum to match exactly before inserting.
Provision importer membership only in development or staging, remove it after
the rehearsal, and never use it to load real data.

Do not run either phase, create memberships, provision a database, or change a
hosted environment without the repository owner's explicit approval.
