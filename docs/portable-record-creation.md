# Portable client and project creation

Reviewed: July 13, 2026

Status: Implemented in source and covered by automated tests. Not deployed.

## Outcome

Client and project creation now use provider-neutral domain and application services instead of placing business rules directly in Next.js route handlers. The current D1 database and synchronous Google directory mirror remain development adapters behind those boundaries, so the hosted development environment keeps its existing HTTP behavior while production adapters are developed separately.

This is a bounded portability proof. The first [production PostgreSQL foundation](production-postgresql-foundation.md) and the source-only [PostgreSQL repository slice](production-postgresql-repositories.md) are now implemented separately. Production runtime composition, multi-user authorization, live queued Google synchronization, and the Workspace connection remain incomplete.

## Creation flow

1. The API route resolves the signed-in actor and checks the exact required capability before validating or writing data.
2. A provider-neutral domain module normalizes and validates the request.
3. An application service calls a repository port using the actor ID supplied by the route.
4. The D1 development adapter writes the primary record and activity evidence in one database batch. Client creation also includes its primary contact in that batch.
5. Only after the durable database write succeeds, the application service asks the optional directory-mirror port to synchronize.
6. A mirror failure does not roll back the accepted record. The response contains only a safe pending status and a stable error code/message.

The unwired PostgreSQL adapters use the same application services with an atomic record/activity/outbox/idempotency transaction. Their accepted or replayed result reports synchronization as queued and returns the persisted winning record; it never invokes the synchronous development mirror.

The application and domain layers do not import Next.js, Cloudflare bindings, or Google connector code.

## Implemented boundaries

- `ClientRepository` atomically creates a client, primary contact, and activity entry.
- `ProjectRepository` atomically verifies the client and creates a project plus activity entry.
- `DirectoryMirror` is optional and runs only after a durable write.
- `CreationAuthorization` checks the canonical dotted capability keys `clients.create` or `projects.create` before any creation side effects.
- D1 repository adapters preserve the current development identifiers, client codes, project numbers, duplicate handling, and response status codes.
- PostgreSQL adapters preserve the ports while adding atomic actor-scoped request replay, transactionally queued delivery intent, and exact persisted version values.
- The Google development mirror adapter returns an explicitly allowlisted result instead of leaking provider or credential details.

## Development schema bootstrap

Development D1 schema changes now use the checked-in, ordered Drizzle sequence that Sites packages for controlled deployment. Normal API requests execute no schema DDL, and regression tests detect runtime DDL or missing schema/index artifacts.

Read [Development D1 deployment migrations](development-d1-schema-migrations.md) before deploying this branch. The checked-in Sites/Drizzle sequence is for the one-user D1 test-data development environment, not the production PostgreSQL migration system. Before any development deployment, back up the test database and inspect it for duplicate client codes, client names, or project numbers because the new uniqueness indexes intentionally fail instead of rewriting conflicting records.

## Compatibility and safety

- Existing client and project API response shapes, validation messages, duplicate conflict behavior, and not-found behavior are retained.
- Project names remain repeatable; project numbers are the unique business identifier.
- Mirror responses are sanitized and the mirror is invoked at most once after a successful durable write.
- No Google Workspace resources, Cloud resources, credentials, production schema, or live data were created or changed by this work.

## Remaining production work

The next platform assignments should extend the accepted ports rather than adding production behavior back into route handlers:

- Add users, sessions, roles, and project memberships, then connect those identities to the existing append-only audit, idempotency, and outbox records.
- Compose the PostgreSQL adapters into the approved production runtime after authorization and platform inputs are accepted.
- Wire the transactional outbox to a live queued worker before multi-user rollout; keep provider calls outside repository transactions.
- Add a real D1 integration test for batch rollback, uniqueness conflicts, and concurrent writes; keep the current source/behavior tests as fast coverage.

Do not provision or migrate the production environment as part of this assignment. Infrastructure inputs, credentials, restore targets, and owner approval remain required first.
