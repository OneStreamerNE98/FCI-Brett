# Production persistence boundary

Status: Source complete; unapplied and not composed into employee routes
Branch: `codex/production-persistence-boundary`
Date: July 15, 2026

## Outcome

The repository now defines the production-owned persistence and storage seams that must exist before authorization behavior or Google Workspace employee login is implemented. This is a source-only foundation:

- PostgreSQL migration `3`, `production_persistence_boundary`, adds generic identity, security-audit, integration, and file metadata.
- Aggregate-oriented PostgreSQL repositories keep protected mutations and their audit evidence in one bounded transaction.
- A provider-neutral object-storage port and in-memory contract adapter define conditional write, exact-generation metadata, and chunked reads without exposing provider URLs or overwrite/list/delete operations.
- Production composition creates singleton identity, audit, integration, and file repositories around the existing bounded pool. Employee routes still fail closed and do not use them.
- Runtime readiness verifies an exact relation/privilege matrix as well as the immutable migration history.

No database, role, grant, Google Cloud resource, hosted configuration, Workspace connector, or production route was changed or applied.

## Migration-owned structures

### Employee identity and authorization data

- `users`
- `external_identities`
- `invitations`
- `sessions`
- `roles`
- `capabilities`
- `role_capabilities`
- `user_roles`
- `project_memberships`

These are generic structures only. No role, capability, invitation, user, or access-policy row is seeded. External identities are unique by issuer plus immutable provider subject; email is not the stable identity key. Invitation, session, state, and browser-nonce values are stored only as canonical SHA-256 digests.

### Security evidence

- `audit_events`

Security audit is separate from the client/project activity timeline. It records executor and originating actor independently, action, target, result, reason, correlation, minimized JSON metadata, occurrence time, and retention-policy evidence. A database trigger rejects update and delete with SQLSTATE `55000`; the runtime receives insert-only table access and no audit read privilege.

### Company data connector metadata

- `integration_connections`
- `integration_credentials`
- `integration_connection_scopes`
- `integration_oauth_attempts`
- `integration_resources`
- `integration_cursors`
- `integration_events`

The company connector remains separate from employee OIDC identity. Credential, PKCE, and cursor material is encrypted and key-versioned where represented. The general runtime has no direct access to `integration_credentials`; a later connector-specific credential boundary must be reviewed before live authorization. Operational integration events are append-only at the database layer, but the runtime has no access until a reviewed event-writer adapter exists.

The development D1 Workspace connector and its encrypted token remain untouched. Its credential is not eligible for automatic production migration; production connection requires a separately approved reauthorization.

### File and provider-neutral object metadata

- `files`
- `file_versions`
- `storage_objects`
- `file_links`

Production file reservations require a typed client or project relationship at the database level. The implemented repository permits only project-associated reservations and creates the logical file, version, quarantine object intent, project link, and security audit atomically. Object bytes are written outside the database transaction. Finalization uses row-version and state fences and records a stored upload as `quarantined`, not released; no scanner or download authorization is claimed.

Original filenames are metadata and cannot be used as opaque storage keys. The storage port supports only:

- `putIfAbsent`
- exact-generation `head`
- exact-generation `openRead` using `AsyncIterable<Uint8Array>`

It deliberately has no overwrite, list, delete, public URL, or signed URL surface.

## Repository boundary

The source includes these ports and adapters:

- `IdentityPersistenceRepository`: user/external-identity registration, invitations, secure sessions, and generic role/capability/project-membership persistence. It does not evaluate permissions.
- `SecurityAuditRepository`: standalone append plus a same-client helper for atomic evidence inside another repository transaction.
- `IntegrationMetadataRepository`: connection, one-time OAuth-attempt, and typed external-resource metadata. It does not call Google or decrypt credentials.
- `FileMetadataRepository`: atomic project upload reservation, stored-object confirmation/failure, and released-reference lookup. It does not stream bytes inside PostgreSQL.
- `ObjectStorage`: provider-neutral conditional object storage with an in-memory contract adapter. No Cloud Storage adapter or bucket is provisioned.

Network, provider, encryption, and decryption work must stay outside PostgreSQL transactions. Mutable transitions use state and `bigint` version fences; versions remain decimal strings in TypeScript so values above JavaScript's safe-integer range are not truncated. Session issuance holds a shared user-row lock and rejects disabled users, changed authorization versions, and issuance before `sessions_valid_after`. Each mutation repository derives its own audit action, target, result, and stale/conflict reason instead of trusting caller-selected semantics. Named uniqueness conflicts roll back all attempted state and then require a separate denied audit transaction before returning a conflict result; if that audit cannot be recorded, the repository fails closed instead of reporting a handled conflict.

## Runtime privileges and readiness

`infrastructure/postgres/least-privilege.sql` resets privileges before granting the exact reviewed matrix. Important restrictions include:

- no runtime schema `CREATE`, grant option, sequence access, `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege;
- only `UPDATE(id)` on `users` to satisfy PostgreSQL's shared-row-lock requirement; identity/security columns have no runtime update grant;
- insert-only access to `audit_events`;
- no direct runtime access to migration history, credentials, connector scopes/cursors/events, or any not-yet-implemented integration writer;
- a single owner-checked, fixed-search-path security-definer function for readiness to read non-secret migration history;
- no rehearsal-importer access to identity, audit, integration, or file tables.

Database readiness now fails for missing or extra expected relations, incorrect table or column privileges, sequence access, grant-option drift, unexpected executable functions, unsafe schema rights, a runtime login able to assume migration/rehearsal capability roles, or an incomplete/changed migration history.

The SQL policy and readiness checks remain source-only. Applying the role policy and capturing positive/negative statements under an actual runtime login is still an owner-approved isolated staging/CI acceptance step; the local PostgreSQL migration integration test does not claim that evidence.

## Intentionally deferred

- role/capability seeds and the business meaning of roles;
- atomic secure-session rotation; non-null predecessor rotation is rejected until implemented;
- access-context resolution, capability evaluation, project-scoped queries, denial behavior, and RLS;
- Google Workspace employee OIDC or a second user;
- live company-connector OAuth, credential brokering, watches, notification channels, or provider calls;
- Cloud Storage provisioning or adapter composition;
- malware scanning, release decisions, retention holds, purge, download/share authorization, and untrusted uploads;
- D1/R2 route replacement, data migration, staging application, and production cutover;
- scheduling, messaging, durable job expansion, and AI document indexing.

## Acceptance and next gate

This source boundary was accepted without Brett's open Google Cloud/Workspace inputs because it did not apply or configure anything. The follow-on [authorization and employee-route work](authorization-simulation.md) now adds explicit access contexts, the approved granular Administrator/Office/Project Manager ceilings, secure session/CSRF behavior, project-scoped queries, fixed-operation provider gates, denial evidence, and a narrow dashboard/search/project/client/logout Cloud Run source boundary. Durable admission/session issuance, administration persistence/APIs, provider adapters, the broader application surface, migration/apply, and deployment remain open.

Live Workspace OIDC, staging migration/restore, a second employee, and real client data remain blocked by their separate platform, owner-approval, recovery, authorization, and acceptance gates.
