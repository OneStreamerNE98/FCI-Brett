# Portable client and project creation

Reviewed: July 13, 2026

Status: Implemented in source and covered by automated tests. Not deployed.

## Outcome

Client and project creation now use provider-neutral domain and application services instead of placing business rules directly in Next.js route handlers. The current D1 database and synchronous Google directory mirror remain pilot adapters behind those boundaries, so the hosted pilot can keep its existing HTTP behavior while later production adapters are added deliberately.

This is a bounded portability proof. The first [production PostgreSQL foundation](production-postgresql-foundation.md) is now defined separately, but PostgreSQL repository adapters, multi-user authorization, queued Google synchronization, and the live Workspace connection remain incomplete.

## Creation flow

1. The API route resolves the signed-in actor and checks the exact required capability before validating or writing data.
2. A provider-neutral domain module normalizes and validates the request.
3. An application service calls a repository port using the actor ID supplied by the route.
4. The D1 pilot adapter writes the primary record and activity evidence in one database batch. Client creation also includes its primary contact in that batch.
5. Only after the durable database write succeeds, the application service asks the optional directory-mirror port to synchronize.
6. A mirror failure does not roll back the accepted record. The response contains only a safe pending status and a stable error code/message.

The application and domain layers do not import Next.js, Cloudflare bindings, or Google connector code.

## Implemented boundaries

- `ClientRepository` atomically creates a client, primary contact, and activity entry.
- `ProjectRepository` atomically verifies the client and creates a project plus activity entry.
- `DirectoryMirror` is optional and runs only after a durable write.
- `CreationAuthorization` checks `clients:create` or `projects:create` before any creation side effects.
- D1 repository adapters preserve the current pilot identifiers, client codes, project numbers, duplicate handling, and response status codes.
- The Google pilot mirror adapter returns an explicitly allowlisted result instead of leaking provider or credential details.

## Pilot schema bootstrap

Runtime D1 bootstrap statements are now centralized in one ordered, versioned registry. Migration statements and their version marker share a transactional D1 batch, failed work is retryable, and schema-artifact parity tests detect route-local DDL or missing registered tables/indexes.

Read [Pilot D1 schema migrations](pilot-d1-schema-migrations.md) before deploying this branch. The runner is an additive bridge for the one-user D1 test pilot, not the production PostgreSQL migration system. Before any pilot deployment, back up the test database and inspect it for duplicate client codes or project numbers because the new uniqueness indexes intentionally fail instead of rewriting conflicting records.

## Compatibility and safety

- Existing client and project API response shapes, validation messages, duplicate conflict behavior, and not-found behavior are retained.
- Project names remain repeatable; project numbers are the unique business identifier.
- Mirror responses are sanitized and the mirror is invoked at most once after a successful durable write.
- No Google Workspace resources, Cloud resources, credentials, production schema, or live data were created or changed by this work.

## Remaining production work

The next platform assignment should extend the accepted ports rather than adding production behavior back into route handlers:

- Implement PostgreSQL repository adapters against the completed source-only schema and run repository contract tests against PostgreSQL 16.
- Add users, sessions, roles, and project memberships, then connect those identities to the existing append-only audit, idempotency, and outbox records.
- Implement request-idempotency behavior so a retry after a lost response cannot create a second project.
- Replace synchronous mirroring with a transactional outbox and queued worker before multi-user rollout.
- Add a real D1 integration test for batch rollback, uniqueness conflicts, and concurrent writes; keep the current source/behavior tests as fast coverage.
- Store a normalized database key for client-name uniqueness rather than relying on SQLite `LOWER`, which is not a complete Unicode normalization strategy.

Do not provision or migrate the production environment as part of this assignment. Infrastructure inputs, credentials, restore targets, and owner approval remain required first.
